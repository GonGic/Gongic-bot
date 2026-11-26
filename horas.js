const cfg = require('./config');
const db = require('./db');

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

// ---------- Fechas (días calendario de Ciudad de México, como 'YYYY-MM-DD') ----------
function hoy() {
  return new Date().toLocaleDateString('en-CA', { timeZone: cfg.zonaHoraria });
}

function partes(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  return { y, m, d };
}

// Suma (o resta) días a una fecha 'YYYY-MM-DD'.
function sumarDias(fecha, n) {
  const { y, m, d } = partes(fecha);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const inicioDelDia = (fecha) => new Date(`${fecha}T00:00:00.000${cfg.offsetUTC}`);
const ddmm = (fecha) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
const diaSemana = (fecha) => new Date(`${fecha}T00:00:00Z`).getUTCDay(); // 0 = domingo

// Lee "dd/mm" o "dd/mm/yyyy". Sin año, toma el actual. Sin texto, devuelve hoy. Si no es válida, null.
function leerFecha(texto) {
  if (!texto) return hoy();
  const m = texto.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mes = Number(m[2]);
  const y = m[3] ? Number(m[3]) : partes(hoy()).y;
  const f = new Date(Date.UTC(y, mes - 1, d));
  if (f.getUTCFullYear() !== y || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null; // p. ej. 31/02
  return f.toISOString().slice(0, 10);
}

// Lunes de la semana en la que cae la fecha.
const lunesDe = (fecha) => sumarDias(fecha, -((diaSemana(fecha) + 6) % 7));

function diasDelMes(fecha) {
  const { y, m } = partes(fecha);
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: total }, (_, k) => `${fecha.slice(0, 8)}${String(k + 1).padStart(2, '0')}`);
}

// ---------- Formato ----------
const hora = (d) => d.toLocaleTimeString('es-MX', { timeZone: cfg.zonaHoraria, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// 53m, 8h 5m, 11h
function duracion(ms) {
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ---------- Cálculo ----------
// Recorta cada sesión al día (una sesión que cruza la medianoche se parte en dos días).
async function tramosDelDia(userId, fecha, sesiones) {
  const desde = inicioDelDia(fecha);
  const hasta = inicioDelDia(sumarDias(fecha, 1));
  const lista = sesiones ?? await db.sesionesEntre(userId, desde, hasta);
  const ahora = new Date();
  return lista
    .map((s) => {
      const fin = s.fin ?? ahora;
      const ini = s.inicio < desde ? desde : s.inicio;
      const fi = fin > hasta ? hasta : fin;
      return { canal: s.canalNombre, inicio: ini, fin: fi, enCurso: !s.fin && fi === fin, cortado: fi === hasta, ms: fi - ini };
    })
    .filter((t) => t.ms > 0);
}

// Totales por día de una lista de fechas consecutivas, con una sola consulta.
async function totalesPorDia(userId, fechas) {
  const sesiones = await db.sesionesEntre(userId, inicioDelDia(fechas[0]), inicioDelDia(sumarDias(fechas[fechas.length - 1], 1)));
  const dias = [];
  for (const f of fechas) {
    const tramos = await tramosDelDia(userId, f, sesiones);
    dias.push({ fecha: f, ms: tramos.reduce((s, t) => s + t.ms, 0), sesiones: tramos.length });
  }
  return dias;
}

// ---------- Embeds ----------
// Cada función devuelve { titulo, descripcion, campos, pie } y index.js arma el embed.
// quien = null para "Tus horas", o el nombre de la persona consultada.
const campo = (name, value, inline = true) => ({ name, value, inline });
const PIE = 'GonGic · Zona horaria MX';
const DIAS_LARGOS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Barra de 10 bloques: ▰▰▰▱▱▱▱▱▱▱ (p de 0 a 100).
function barra(p) {
  const llenos = Math.max(0, Math.min(10, Math.floor(p / 10)));
  return `${'▰'.repeat(llenos)}${'▱'.repeat(10 - llenos)}`;
}

const sesionesTexto = (n) => `${n} ${n === 1 ? 'sesión' : 'sesiones'}`;

async function textoDia(userId, fecha, quien) {
  const dia = `${DIAS_LARGOS[diaSemana(fecha)]} ${ddmm(fecha)}`;
  const titulo = quien ? `🕒 Horas de ${quien} · ${dia}` : `🕒 Tus horas · ${dia}`;
  const tramos = await tramosDelDia(userId, fecha);
  if (!tramos.length) return { titulo, descripcion: '💤 No hay registro para ese día.', campos: [], pie: PIE };
  const bloques = tramos.map((t, n) => {
    const fin = t.enCurso ? '⏳ en curso' : `🔴 ${t.cortado ? '23:59' : hora(t.fin)}`; // si cruza la medianoche, este día termina a las 23:59
    return `🎙️ **Sesión ${n + 1}** · ${t.canal}\n🟢 ${hora(t.inicio)}  →  ${fin}   ⏱️ **${duracion(t.ms)}**`;
  });
  return {
    titulo,
    descripcion: bloques.join('\n\n'),
    campos: [
      campo('⏱️ Total trabajado', `**${duracion(tramos.reduce((s, t) => s + t.ms, 0))}**`),
      campo('📋 Sesiones', `**${tramos.length}**`),
    ],
    pie: PIE,
  };
}

// Línea de un día con barra relativa al día con más horas del periodo.
function lineaDia(etiqueta, d, maxMs) {
  if (!d.sesiones) return `\`${etiqueta}\` ${barra(0)} _Sin actividad_`;
  return `\`${etiqueta}\` ${barra(maxMs ? (d.ms / maxMs) * 100 : 0)} **${duracion(d.ms)}** · ${sesionesTexto(d.sesiones)}`;
}

function camposResumen(dias, etiquetaTotal) {
  const total = dias.reduce((s, d) => s + d.ms, 0);
  const conActividad = dias.filter((d) => d.sesiones).length;
  return [
    campo(`⏱️ ${etiquetaTotal}`, `**${duracion(total)}**`),
    campo('📅 Días con actividad', `**${conActividad}** de ${dias.length}`),
    campo('📈 Promedio diario', `**${duracion(conActividad ? total / conActividad : 0)}**`),
  ];
}

async function textoSemana(userId, fecha, quien) {
  const lunes = lunesDe(fecha);
  const fechas = Array.from({ length: 7 }, (_, k) => sumarDias(lunes, k));
  const dias = await totalesPorDia(userId, fechas);
  const max = Math.max(...dias.map((d) => d.ms));
  return {
    titulo: quien ? `📆 Semana de ${quien}` : '📆 Tu semana',
    descripcion: [
      `Del **${ddmm(fechas[0])}** al **${ddmm(fechas[6])}**`,
      '',
      ...dias.map((d) => lineaDia(`${DIAS_SEMANA[diaSemana(d.fecha)]} ${ddmm(d.fecha)}`, d, max)),
    ].join('\n'),
    campos: camposResumen(dias, 'Total semanal'),
    pie: PIE,
  };
}

async function textoMes(userId, fecha, quien) {
  const fechas = diasDelMes(fecha);
  const dias = await totalesPorDia(userId, fechas);
  const { y, m } = partes(fecha);
  const nombreMes = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('es-MX', { month: 'long', timeZone: 'UTC' });
  const mes = `${nombreMes[0].toUpperCase()}${nombreMes.slice(1)} ${y}`;
  // Dos columnas (días 1-15 y 16-fin) para que el mes no sea una lista tan larga.
  const linea = (d) => (d.sesiones ? `\`${ddmm(d.fecha)}\` **${duracion(d.ms)}**` : `\`${ddmm(d.fecha)}\` _Sin actividad_`);
  return {
    titulo: quien ? `🗓️ ${mes} · ${quien}` : `🗓️ Tu mes · ${mes}`,
    descripcion: 'Tiempo trabajado por día.',
    campos: [
      campo('Del 1 al 15', dias.slice(0, 15).map(linea).join('\n')),
      campo(`Del 16 al ${dias.length}`, dias.slice(15).map(linea).join('\n')),
      campo('​', '​', false),
      ...camposResumen(dias, 'Total mensual'),
    ],
    pie: PIE,
  };
}

// ---------- Servicio social ----------
const META_MIN = cfg.metaServicioHoras * 60;
const fechaLarga = (d) => d.toLocaleDateString('es-MX', { timeZone: cfg.zonaHoraria, day: '2-digit', month: '2-digit', year: 'numeric' });
const porcentaje = (min) => Math.min(100, Math.floor((min / META_MIN) * 100));
const conSigno = (min) => `${min < 0 ? '➖' : '➕'} ${duracion(Math.abs(min) * 60000)}`;
const falta = (min) => (min >= META_MIN ? '✅ Completado' : `faltan **${duracion((META_MIN - min) * 60000)}**`);

// Avance del servicio: barra, porcentaje, acumulado y lo que falta.
const avance = (min) => `${barra(porcentaje(min))} **${porcentaje(min)}%**\n${duracion(min * 60000)} de ${cfg.metaServicioHoras}h · ${falta(min)}`;

// Campo que se agrega a /mis-horas y /horas-de cuando la persona es SS.
function campoServicio(min) {
  return campo('🎓 Servicio social', avance(min), false);
}

const MAX_AJUSTES = 10; // un campo de embed admite 1,024 caracteres

// total = { minutos, primeraSesion }, completadoEn = Date o undefined.
function textoProgreso(total, completadoEn, ajustes, quien) {
  const min = total.minutos;
  const campos = [
    campo('⏱️ Acumulado', `**${duracion(min * 60000)}**`),
    min >= META_MIN
      ? campo('✅ Completado', `**${completadoEn ? fechaLarga(completadoEn) : 'hoy'}**`)
      : campo('⏳ Faltan', `**${duracion((META_MIN - min) * 60000)}**`),
    campo('🚀 Inicio', total.primeraSesion ? `**${fechaLarga(total.primeraSesion)}**` : '_Sin sesiones aún_'),
  ];
  if (ajustes.length) {
    const ultimos = ajustes.slice(-MAX_AJUSTES);
    const lineas = ultimos.map((a) => `${conSigno(a.minutos)} · ${a.motivo}\n╰ por <@${a.adminId}> · ${fechaLarga(a.fecha)}`);
    if (ajustes.length > MAX_AJUSTES) lineas.unshift(`_…y ${ajustes.length - MAX_AJUSTES} anteriores_`);
    campos.push(campo('🛠️ Ajustes de ADMIN', lineas.join('\n').slice(0, 1024), false));
  }
  return {
    titulo: quien ? `🎓 Servicio social de ${quien}` : '🎓 Tu servicio social',
    descripcion: `**Meta: ${cfg.metaServicioHoras} horas**\n\n${barra(porcentaje(min))} **${porcentaje(min)}%**`,
    campos,
    pie: `Los ajustes solo cuentan para el servicio social · ${PIE}`,
  };
}

// filas = [{ nombre, minutos }]. Orden alfabético: no es una competencia.
function textoListaSS(filas) {
  const titulo = `🎓 Servicio social · Meta ${cfg.metaServicioHoras}h`;
  if (!filas.length) return { titulo, descripcion: 'No hay miembros con rol SS.', campos: [], pie: PIE };
  const orden = [...filas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  const hechos = orden.filter((f) => f.minutos >= META_MIN).length;
  return {
    titulo,
    descripcion: orden.map((f) => `👤 **${f.nombre}**\n${avance(f.minutos)}`).join('\n\n').slice(0, 4096),
    campos: [
      campo('✅ Completados', `**${hechos}** de ${orden.length}`),
      campo('👥 En servicio', `**${orden.length - hechos}**`),
    ],
    pie: PIE,
  };
}

// Confirmación de /servicio-social ajustar.
function textoAjuste(miembroId, minutos, motivo, total) {
  return {
    titulo: '🛠️ Ajuste de servicio social',
    descripcion: `Se ajustaron las horas de <@${miembroId}>.`,
    campos: [
      campo('Ajuste', `**${conSigno(minutos)}**`),
      campo('📝 Motivo', motivo.slice(0, 1024)),
      campoServicio(total),
    ],
    pie: `Los ajustes solo cuentan para el servicio social · ${PIE}`,
  };
}

// Aviso al completar la meta. paraCanal = true para el canal de ADMIN, false para el mensaje privado.
function textoCompletado(miembroId, nombre, minutos, paraCanal) {
  const total = duracion(minutos * 60000);
  return paraCanal
    ? {
      titulo: '✅ Servicio social completado',
      descripcion: `<@${miembroId}> (**${nombre}**) completó su servicio social.`,
      campos: [
        campo('🎯 Meta', `**${cfg.metaServicioHoras}h**`),
        campo('⏱️ Acumulado', `**${total}**`),
      ],
      pie: PIE,
    }
    : {
      titulo: '🎉 ¡Felicidades!',
      descripcion: `Completaste tus **${cfg.metaServicioHoras} horas** de servicio social. ¡Gracias por tu esfuerzo! 💚\n\n${barra(100)} **100%**`,
      campos: [campo('⏱️ Acumulado', `**${total}**`)],
      pie: PIE,
    };
}

module.exports = {
  hoy, leerFecha, lunesDe, duracion, textoDia, textoSemana, textoMes,
  campoServicio, textoProgreso, textoListaSS, textoAjuste, textoCompletado, META_MIN, PIE, barra,
};
