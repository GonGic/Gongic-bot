const {
  Client, GatewayIntentBits, Events, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');
const cfg = require('./config');
const db = require('./db');
const roles = require('./roles');
const horas = require('./horas');
const comandos = require('./comandos');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // para leer los roles de cada colaborador
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const EF = MessageFlags.Ephemeral;
let canales = new Set(); // IDs de los canales de voz que cuentan (se cargan de Mongo)

// Está en un canal que cuenta y tiene rol de colaborador.
const cuenta = (estado) => !!estado?.channelId && canales.has(estado.channelId)
  && !estado.member?.user.bot && roles.esColaborador(estado.member);

async function recargarCanales() {
  canales = new Set((await db.listarCanales()).map((c) => c._id));
}

// Deja las sesiones abiertas igual que lo que se ve en voz: cierra las de quien ya no está
// (a la hora de ahora, p. ej. al encender el bot) y abre las de quien está sin sesión.
async function sincronizar() {
  const guild = client.guilds.cache.get(cfg.guildId);
  if (!guild) return;
  const ahora = new Date();
  for (const s of await db.sesionesAbiertas()) {
    if (!cuenta(guild.voiceStates.cache.get(s.userId))) await db.cerrarSesion(s.userId, ahora);
  }
  for (const estado of guild.voiceStates.cache.values()) {
    if (cuenta(estado)) await db.abrirSesion(estado.id, estado.channel, ahora);
  }
}

// ---------- Inicio ----------
client.once(Events.ClientReady, async (c) => {
  const guild = await c.guilds.fetch(cfg.guildId);
  await guild.commands.set(comandos.map((cmd) => cmd.toJSON()));
  await guild.members.fetch(); // para tener los roles de quienes ya están en voz
  await recargarCanales();
  await sincronizar(); // si el bot estuvo apagado, quien sigue en voz continúa su sesión
  console.log(`${c.user.tag} listo en ${guild.name}`);

  // Quien está en voz puede llegar a la meta en cualquier minuto.
  const revisarAbiertas = async () => {
    for (const s of await db.sesionesAbiertas()) await revisarMeta(s.userId);
  };
  revisarAbiertas().catch((e) => console.error('Error al revisar el servicio social:', e));
  setInterval(() => revisarAbiertas().catch((e) => console.error('Error al revisar el servicio social:', e)), 60_000);
});

// ---------- Servicio social: aviso al completar la meta (una sola vez) ----------
async function revisarMeta(userId) {
  const guild = client.guilds.cache.get(cfg.guildId);
  const miembro = guild?.members.cache.get(userId);
  if (!roles.esSS(miembro)) return;
  const { minutos } = await db.totalServicio(userId);
  if (minutos < horas.META_MIN || !(await db.marcarCompletado(userId))) return;
  client.users.send(userId, { embeds: [armarEmbed(horas.textoCompletado(userId, miembro.displayName, minutos, false), COLORES.SS)] })
    .catch(() => {}); // si tiene los DMs cerrados, se ignora
  const canal = await client.channels.fetch(cfg.canalAvisosId).catch(() => null);
  await canal?.send({ embeds: [armarEmbed(horas.textoCompletado(userId, miembro.displayName, minutos, true), COLORES.SS)] }); // las menciones en un embed no notifican
}

// ---------- Registro de horas ----------
// Los cambios de cada persona se procesan en orden (si sale y vuelve rápido, no se cruzan).
const colas = new Map();
function enOrden(userId, fn) {
  const sigue = (colas.get(userId) ?? Promise.resolve()).then(fn).catch((e) => console.error('Error en voz:', e));
  colas.set(userId, sigue);
  sigue.then(() => { if (colas.get(userId) === sigue) colas.delete(userId); });
}

client.on(Events.VoiceStateUpdate, (antes, ahora) => {
  if (ahora.guild.id !== cfg.guildId || ahora.member?.user.bot) return;
  const canal = ahora.channel;
  const sigue = cuenta(ahora);
  if (!sigue && !antes.channelId) return;
  // Moverse entre canales que cuentan no corta la sesión.
  enOrden(ahora.id, async () => {
    if (sigue) await db.abrirSesion(ahora.id, canal);
    else if (await db.cerrarSesion(ahora.id)) await revisarMeta(ahora.id);
  });
});

// ---------- Embeds ----------
// Color de la barra del embed según el rol de la persona consultada.
const COLORES = { SS: 0x2ecc71, Programador: 0x3498db, PM: 0x9b59b6 };
const COLOR_OTRO = 0x95a5a6;
const COLOR_BOT = 0x3498db; // mensajes de administración
const COLOR_ERROR = 0xe74c3c;

// datos = { titulo?, descripcion, campos?, pie? } (lo que devuelve horas.js)
function armarEmbed(datos, color) {
  const e = new EmbedBuilder().setColor(color).setDescription(datos.descripcion.slice(0, 4096)).setTimestamp();
  if (datos.titulo) e.setTitle(datos.titulo);
  if (datos.campos?.length) e.addFields(datos.campos);
  e.setFooter({ text: datos.pie ?? horas.PIE });
  return e;
}

const responder = (i, datos, color) => i.reply({ embeds: [armarEmbed(datos, color)], flags: EF });
const error = (i, texto) => responder(i, { descripcion: `⚠️ ${texto}` }, COLOR_ERROR);
const colorDe = (miembro) => COLORES[roles.tipo(miembro)] ?? COLOR_OTRO;

// ---------- Comandos ----------
client.on(Events.InteractionCreate, async (i) => {
  if (i.guildId !== cfg.guildId) return;
  if (!i.isChatInputCommand() && !(i.isButton() && i.customId.startsWith('limpiar:'))) return;
  try {
    if (i.isButton()) await botonLimpiar(i);
    else await manejarComando(i);
  } catch (e) {
    console.error(e);
    const r = { embeds: [armarEmbed({ descripcion: '⚠️ Ocurrió un error, intenta de nuevo.' }, COLOR_ERROR)], flags: EF };
    if (i.replied || i.deferred) await i.followUp(r).catch(() => {});
    else await i.reply(r).catch(() => {});
  }
});

const TEXTOS = { dia: horas.textoDia, semana: horas.textoSemana, mes: horas.textoMes };

async function manejarComando(i) {
  const sub = i.options.getSubcommand(false); // /limpiar no tiene subcomandos
  switch (i.commandName) {
    case 'mis-horas':
    case 'horas-de': {
      let userId = i.user.id;
      let quien = null;
      let miembro = i.member;
      if (i.commandName === 'horas-de') {
        const permitidos = roles.textoConsultables(i.member);
        if (!permitidos) return error(i, 'Solo ADMIN y PM pueden ver las horas de otros.');
        miembro = i.options.getMember('usuario');
        if (!roles.puedeConsultar(i.member, miembro)) return error(i, `Solo puedes consultar a colaboradores con rol ${permitidos}.`);
        userId = miembro.id;
        quien = miembro.displayName;
      }
      const fecha = horas.leerFecha(i.options.getString('fecha'));
      if (!fecha) return error(i, 'Fecha inválida. Usa `dd/mm` o `dd/mm/yyyy`, por ejemplo `21/10` o `21/10/2026`.');
      const datos = await TEXTOS[sub](userId, fecha, quien);
      if (roles.esSS(miembro)) datos.campos.push(horas.campoServicio((await db.totalServicio(userId)).minutos));
      return responder(i, datos, colorDe(miembro));
    }

    case 'servicio-social': {
      if (sub === 'progreso') {
        if (!roles.esSS(i.member)) return error(i, 'Solo los colaboradores con rol SS tienen servicio social.');
        const [total, hechos, ajustes] = await Promise.all([
          db.totalServicio(i.user.id), db.completados([i.user.id]), db.ajustesDe(i.user.id),
        ]);
        return responder(i, horas.textoProgreso(total, hechos.get(i.user.id), ajustes), colorDe(i.member));
      }
      if (sub === 'lista') {
        if (!roles.puedeVerListaSS(i.member)) return error(i, 'Solo ADMIN y PM pueden ver la lista.');
        const ss = [...i.guild.members.cache.filter((m) => !m.user.bot && roles.esSS(m)).values()];
        const totales = await db.totalesServicio(ss.map((m) => m.id));
        return responder(i, horas.textoListaSS(ss.map((m) => ({ nombre: m.displayName, minutos: totales.get(m.id).minutos }))), COLORES.SS);
      }
      // ajustar
      if (!roles.esAdmin(i.member)) return error(i, 'Solo ADMIN puede ajustar horas de servicio social.');
      const miembro = i.options.getMember('usuario');
      if (!roles.esSS(miembro)) return error(i, 'Solo se ajustan horas a colaboradores con rol SS.');
      const minutos = i.options.getInteger('horas') * 60 + (i.options.getInteger('minutos') ?? 0);
      if (minutos === 0) return error(i, 'El ajuste no puede ser de 0 minutos.');
      const motivo = i.options.getString('motivo').trim();
      const nuevo = await db.ajustarServicio(miembro.id, minutos, motivo, i.user.id);
      if (nuevo === null) return error(i, 'Ese ajuste dejaría el servicio social por debajo de 0.');
      await responder(i, horas.textoAjuste(miembro.id, minutos, motivo, nuevo), COLORES.SS);
      return revisarMeta(miembro.id);
    }

    case 'canales': {
      if (!roles.esAdmin(i.member)) return error(i, 'Solo ADMIN puede administrar los canales.');
      if (sub === 'lista') {
        const lista = await db.listarCanales();
        return responder(i, {
          titulo: '🎙️ Canales de trabajo',
          descripcion: lista.length
            ? lista.map((c) => `🔊 <#${c._id}>\n╰ \`${c._id}\``).join('\n\n')
            : '💤 No hay canales. Agrégalos con `/canales agregar`.',
          campos: [{ name: '📋 Total', value: `**${lista.length}** ${lista.length === 1 ? 'canal' : 'canales'} donde se cuentan las horas`, inline: false }],
        }, COLOR_BOT);
      }
      const canal = i.options.getChannel('canal');
      const cambio = sub === 'agregar' ? await db.agregarCanal(canal, i.user.id) : await db.quitarCanal(canal.id);
      await recargarCanales();
      await sincronizar(); // abre o cierra las sesiones de quienes están en ese canal ahora mismo
      if (!cambio) return error(i, sub === 'agregar' ? `${canal} ya estaba en la lista.` : `${canal} no estaba en la lista.`);
      return responder(i, {
        titulo: sub === 'agregar' ? '✅ Canal agregado' : '🗑️ Canal quitado',
        descripcion: sub === 'agregar' ? `🔊 Ahora se cuentan las horas en ${canal}.` : `🔇 ${canal} ya no cuenta para las horas.`,
      }, COLOR_BOT);
    }

    case 'limpiar': {
      if (!roles.esAdmin(i.member)) return error(i, 'Solo ADMIN puede limpiar canales.');
      const canal = i.options.getChannel('canal') ?? i.channel;
      const faltan = permisosFaltantes(canal);
      if (faltan) return error(i, `No puedo limpiar ${canal}: me falta el permiso ${faltan} en ese canal.`);
      const botones = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`limpiar:confirmar:${canal.id}:${Date.now()}`).setLabel('Sí, borrar todo').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('limpiar:cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
      );
      return i.reply({
        embeds: [armarEmbed({
          titulo: '🧹 ¿Borrar todos los mensajes?',
          descripcion: `Se borrarán **TODOS** los mensajes de ${canal}, incluidos los fijados.\n\n⚠️ **No se puede deshacer.**`,
          pie: `⌛ Tienes ${LIMPIAR_EXPIRA_MIN} minutos para confirmar · GonGic`,
        }, COLOR_ERROR)],
        components: [botones],
        flags: EF,
      });
    }

    default:
      return null;
  }
}

// ---------- /limpiar ----------
const LIMPIAR_EXPIRA_MIN = 2;
const CATORCE_DIAS = 14 * 24 * 3600 * 1000 - 60_000; // con un minuto de margen
const limpiando = new Set(); // canales que se están limpiando ahora mismo

function permisosFaltantes(canal) {
  const p = canal.permissionsFor(canal.guild.members.me);
  const necesarios = { 'Ver canal': PermissionFlagsBits.ViewChannel, 'Leer el historial': PermissionFlagsBits.ReadMessageHistory, 'Gestionar mensajes': PermissionFlagsBits.ManageMessages };
  return Object.entries(necesarios).filter(([, bit]) => !p?.has(bit)).map(([n]) => `**${n}**`).join(', ') || null;
}

// Botones de confirmación. Solo quien pidió /limpiar los ve, porque la respuesta es privada.
async function botonLimpiar(i) {
  if (i.customId === 'limpiar:cancelar') {
    return i.update({ embeds: [armarEmbed({ titulo: '↩️ Cancelado', descripcion: 'No se borró nada.' }, COLOR_OTRO)], components: [] });
  }
  const [, , canalId, creado] = i.customId.split(':');
  if (!roles.esAdmin(i.member)) return error(i, 'Solo ADMIN puede limpiar canales.');
  if (Date.now() - Number(creado) > LIMPIAR_EXPIRA_MIN * 60_000) {
    return i.update({ embeds: [armarEmbed({ titulo: '⌛ Confirmación expirada', descripcion: 'Usa `/limpiar` otra vez.' }, COLOR_OTRO)], components: [] });
  }
  const canal = await client.channels.fetch(canalId).catch(() => null);
  if (!canal) return i.update({ embeds: [armarEmbed({ descripcion: '⚠️ Ese canal ya no existe.' }, COLOR_ERROR)], components: [] });
  if (limpiando.has(canal.id)) return i.update({ embeds: [armarEmbed({ descripcion: `⏳ ${canal} ya se está limpiando.` }, COLOR_OTRO)], components: [] });

  limpiando.add(canal.id);
  await i.update({ embeds: [armarEmbed({ titulo: '🧹 Limpiando…', descripcion: `Borrando los mensajes de ${canal}. Te aviso al terminar.` }, COLOR_BOT)], components: [] });
  let borrados = 0;
  let sinBorrar = 0;
  try {
    let progreso = Date.now();
    for (;;) {
      const lote = await canal.messages.fetch({ limit: 100 });
      if (!lote.size) break;
      const antes = borrados;
      // Discord solo deja borrar en bloque (2 a 100) los de menos de 14 días; los demás van uno por uno.
      const recientes = lote.filter((m) => Date.now() - m.createdTimestamp < CATORCE_DIAS);
      const enBloque = recientes.size > 1 ? recientes : new Map();
      if (enBloque.size) borrados += (await canal.bulkDelete(enBloque, true)).size;
      for (const m of lote.values()) {
        if (enBloque.has(m.id)) continue;
        if (await m.delete().then(() => true).catch(() => false)) borrados += 1;
      }
      // Si en esta vuelta no se pudo borrar nada (p. ej. mensajes del sistema), se detiene para no ciclarse.
      if (borrados === antes) {
        sinBorrar = lote.size;
        break;
      }
      if (Date.now() - progreso > 10_000) { // avance cada 10 s
        progreso = Date.now();
        await i.editReply({ embeds: [armarEmbed({ titulo: '🧹 Limpiando…', descripcion: `Borrando los mensajes de ${canal}.`, campos: [{ name: '🗑️ Borrados hasta ahora', value: `**${borrados}**`, inline: true }] }, COLOR_BOT)] }).catch(() => {});
      }
    }
    // El mensaje privado del comando solo se puede editar 15 minutos; si ya expiró, se avisa por DM.
    const fin = armarEmbed({
      titulo: '✅ Canal limpio',
      descripcion: `${canal} quedó limpio.${sinBorrar ? `\n⚠️ Quedaron **${sinBorrar}** que Discord no deja borrar.` : ''}`,
      campos: [{ name: '🗑️ Mensajes borrados', value: `**${borrados}**`, inline: true }],
    }, COLOR_BOT);
    await i.editReply({ embeds: [fin] }).catch(() => i.user.send({ embeds: [fin] }).catch(() => {}));
  } catch (e) {
    console.error('Error al limpiar:', e);
    const mal = armarEmbed({ descripcion: `⚠️ Se detuvo la limpieza de ${canal} después de borrar **${borrados}** mensajes. Intenta de nuevo.` }, COLOR_ERROR);
    await i.editReply({ embeds: [mal] }).catch(() => i.user.send({ embeds: [mal] }).catch(() => {}));
  } finally {
    limpiando.delete(canal.id);
  }
}

// ---------- Arranque: primero MongoDB, luego Discord ----------
(async () => {
  const faltan = ['DISCORD_TOKEN', 'GUILD_ID', 'CANAL_AVISOS_ID', 'MONGODB_URI'].filter((k) => !process.env[k]);
  if (faltan.length) {
    console.error(`Faltan variables en el archivo .env: ${faltan.join(', ')}`);
    process.exit(1);
  }
  try {
    await db.conectar();
    console.log('Conectado a MongoDB');
    await client.login(cfg.token);
  } catch (e) {
    console.error('No se pudo iniciar el bot:', e);
    process.exit(1);
  }
})();
