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

async function textoDia(userId, fecha, quien) {
  const titulo = quien ? `Horas de voz de ${quien} - ${ddmm(fecha)}` : `Tus horas de voz - ${ddmm(fecha)}`;
  const tramos = await tramosDelDia(userId, fecha);
  if (!tramos.length) return { titulo, descripcion: 'No hay registro para ese día', campos: [], pie: 'Zona horaria: MX' };
  const bloques = tramos.map((t, n) => [
    `**Sesión ${n + 1}** (${t.canal})`,
    `Inicio: ${hora(t.inicio)} MX`,
    `Fin: ${t.enCurso ? 'en curso' : `${t.cortado ? '23:59' : hora(t.fin)} MX`}`, // si cruza la medianoche, este día termina a las 23:59
    `Tiempo activo: **${duracion(t.ms)}**`,
  ].join('\n'));
  return {
    titulo,
    descripcion: [
      ...bloques.map((b) => `${b}\n`),
      '---',
      `**Total horas trabajadas:** ${duracion(tramos.reduce((s, t) => s + t.ms, 0))}`,
      `**Sesiones:** ${tramos.length}`,
    ].join('\n'),
    campos: [],
    pie: 'Zona horaria: MX',
  };
}

const sesionesTexto = (n) => `${n} ${n === 1 ? 'sesión' : 'sesiones'}`;

async function textoSemana(userId, fecha, quien) {
  const lunes = lunesDe(fecha);
  const fechas = Array.from({ length: 7 }, (_, k) => sumarDias(lunes, k));
  const dias = await totalesPorDia(userId, fechas);
  return {
    titulo: quien ? `Resumen semanal de voz de ${quien}` : 'Tu resumen semanal de voz',
    descripcion: [
      ...dias.map((d) => `**${DIAS_SEMANA[diaSemana(d.fecha)]} ${ddmm(d.fecha)}:** ${d.sesiones ? `${duracion(d.ms)} (${sesionesTexto(d.sesiones)})` : 'Sin actividad'}`),
      '',
      '---',
      `**Total semanal:** ${duracion(dias.reduce((s, d) => s + d.ms, 0))}`,
    ].join('\n'),
    campos: [],
    pie: `Semana del ${ddmm(fechas[0])} al ${ddmm(fechas[6])} (MX)`,
  };
}

async function textoMes(userId, fecha, quien) {
  const fechas = diasDelMes(fecha);
  const dias = await totalesPorDia(userId, fechas);
  const { y, m } = partes(fecha);
  const nombreMes = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('es-MX', { month: 'long', timeZone: 'UTC' });
  const mes = `${nombreMes[0].toUpperCase()}${nombreMes.slice(1)} ${y}`;
  const total = dias.reduce((s, d) => s + d.ms, 0);
  const conActividad = dias.filter((d) => d.sesiones).length;
  return {
    titulo: quien ? `Resumen mensual de voz de ${quien} - ${mes}` : `Tu resumen mensual de voz - ${mes}`,
    descripcion: [
      ...dias.map((d) => `**${ddmm(d.fecha)}:** ${d.sesiones ? `${duracion(d.ms)} (${d.sesiones} ses.)` : 'Sin actividad'}`),
      '',
      '---',
      `**Total mensual:** ${duracion(total)}`,
      `**Días con actividad:** ${conActividad}`,
      `**Promedio diario:** ${duracion(conActividad ? total / conActividad : 0)}`,
    ].join('\n'),
    campos: [],
    pie: 'Zona horaria: MX',
  };
}

// ---------- Servicio social ----------
const META_MIN = cfg.metaServicioHoras * 60;
const fechaLarga = (d) => d.toLocaleDateString('es-MX', { timeZone: cfg.zonaHoraria, day: '2-digit', month: '2-digit', year: 'numeric' });
const porcentaje = (min) => Math.min(100, Math.floor((min / META_MIN) * 100));
const conSigno = (min) => `${min < 0 ? '-' : '+'}${duracion(Math.abs(min) * 60000)}`;

// Campo del embed: barra de 10 bloques, porcentaje y lo que falta.
function campoServicio(min) {
  const p = porcentaje(min);
  const llenos = Math.floor(p / 10);
  const fin = min >= META_MIN ? '✅ Completado' : `faltan ${duracion((META_MIN - min) * 60000)}`;
  return campo('🎓 Servicio social', `${'▰'.repeat(llenos)}${'▱'.repeat(10 - llenos)} **${p}%**\n${duracion(min * 60000)} / ${cfg.metaServicioHoras}h · ${fin}`, false);
}

const MAX_AJUSTES = 10; // un campo de embed admite 1,024 caracteres

// total = { minutos, primeraSesion }, completadoEn = Date o undefined.
function textoProgreso(total, completadoEn, ajustes, quien) {
  const min = total.minutos;
  const campos = [campoServicio(min)];
  if (ajustes.length) {
    const ultimos = ajustes.slice(-MAX_AJUSTES);
    const lineas = ultimos.map((a) => `• **${conSigno(a.minutos)}** — ${a.motivo} (por <@${a.adminId}>, ${fechaLarga(a.fecha)})`);
    if (ajustes.length > MAX_AJUSTES) lineas.unshift(`_…y ${ajustes.length - MAX_AJUSTES} anteriores_`);
    campos.push(campo('Ajustes de ADMIN', lineas.join('\n').slice(0, 1024), false));
  }
  return {
    titulo: quien ? `Servicio social de ${quien}` : 'Tu servicio social',
    descripcion: [
      `**Acumulado:** ${duracion(min * 60000)} / ${cfg.metaServicioHoras}h`,
      min >= META_MIN
        ? `**Completado:** ✅ ${completadoEn ? fechaLarga(completadoEn) : 'hoy'}`
        : `**Faltan:** ${duracion((META_MIN - min) * 60000)}`,
      `**Inicio:** ${total.primeraSesion ? `${fechaLarga(total.primeraSesion)} (primera sesión)` : 'sin sesiones aún'}`,
    ].join('\n'),
    campos,
    pie: 'Los ajustes solo cuentan para el servicio social · Zona horaria: MX',
  };
}

// filas = [{ nombre, minutos }]
function textoListaSS(filas) {
  const titulo = `Servicio social (meta ${cfg.metaServicioHoras}h)`;
  if (!filas.length) return { titulo, descripcion: 'No hay miembros con rol SS.', campos: [], pie: 'Zona horaria: MX' };
  const orden = [...filas].sort((a, b) => b.minutos - a.minutos);
  const hechos = orden.filter((f) => f.minutos >= META_MIN).length;
  return {
    titulo,
    descripcion: [
      ...orden.map((f, n) => `**${n + 1}. ${f.nombre}:** ${duracion(f.minutos * 60000)} (${porcentaje(f.minutos)}%)${f.minutos >= META_MIN ? ' ✅' : ''}`),
      '',
      '---',
      `**Completados:** ${hechos} de ${orden.length}`,
    ].join('\n'),
    campos: [],
    pie: 'Zona horaria: MX',
  };
}

// Confirmación de /servicio-social ajustar.
function textoAjuste(miembroId, minutos, motivo, total) {
  return {
    titulo: 'Ajuste de servicio social',
    descripcion: [
      `**Colaborador:** <@${miembroId}>`,
      `**Ajuste:** ${conSigno(minutos)}`,
      `**Motivo:** ${motivo}`,
    ].join('\n'),
    campos: [campoServicio(total)],
    pie: 'Zona horaria: MX',
  };
}

// Aviso al completar la meta. paraCanal = true para el canal de ADMIN, false para el mensaje privado.
function textoCompletado(miembroId, nombre, minutos, paraCanal) {
  const total = duracion(minutos * 60000);
  return paraCanal
    ? {
      titulo: '✅ Servicio social completado',
      descripcion: [
        `**Colaborador:** <@${miembroId}> (${nombre})`,
        `**Meta:** ${cfg.metaServicioHoras}h`,
        `**Acumulado:** ${total}`,
      ].join('\n'),
      campos: [],
      pie: 'Zona horaria: MX',
    }
    : {
      titulo: '🎉 ¡Felicidades!',
      descripcion: `Completaste tus **${cfg.metaServicioHoras} horas** de servicio social.\n\n**Acumulado:** ${total}`,
      campos: [],
      pie: 'GonGic',
    };
}

module.exports = {
  hoy, leerFecha, lunesDe, duracion, textoDia, textoSemana, textoMes,
  campoServicio, textoProgreso, textoListaSS, textoAjuste, textoCompletado, META_MIN,
};
