const { SlashCommandBuilder, ChannelType } = require('discord.js');
const cfg = require('./config');

const FECHA = 'Fecha dd/mm o dd/mm/yyyy (por defecto hoy)';

// Subcomandos dia / semana / mes. conUsuario agrega la persona a consultar.
function periodos(cmd, conUsuario) {
  const sub = (nombre, desc) => cmd.addSubcommand((s) => {
    s.setName(nombre).setDescription(desc);
    if (conUsuario) s.addUserOption((o) => o.setName('usuario').setDescription('Colaborador a consultar').setRequired(true));
    return s.addStringOption((o) => o.setName('fecha').setDescription(FECHA));
  });
  sub('dia', 'Sesiones de un día');
  sub('semana', 'Resumen de lunes a domingo de la semana de la fecha');
  sub('mes', 'Resumen del mes de la fecha');
  return cmd;
}

module.exports = [
  // ---------- Colaboradores ----------
  periodos(new SlashCommandBuilder().setName('mis-horas').setDescription('Tus horas en voz'), false),

  new SlashCommandBuilder().setName('servicio-social').setDescription(`Servicio social (meta de ${cfg.metaServicioHoras} horas)`)
    .addSubcommand((s) => s.setName('progreso').setDescription('(SS) Tu avance, lo que falta y los ajustes'))
    .addSubcommand((s) => s.setName('lista').setDescription('(ADMIN/PM) Avance de todos los SS'))
    .addSubcommand((s) => s.setName('ajustar').setDescription('(ADMIN) Sumar o restar horas de servicio social a un SS')
      .addUserOption((o) => o.setName('usuario').setDescription('Colaborador con rol SS').setRequired(true))
      .addIntegerOption((o) => o.setName('horas').setDescription('Horas (negativo para restar)').setRequired(true)
        .setMinValue(-cfg.metaServicioHoras).setMaxValue(cfg.metaServicioHoras))
      .addStringOption((o) => o.setName('motivo').setDescription('Motivo del ajuste').setRequired(true).setMaxLength(200))
      .addIntegerOption((o) => o.setName('minutos').setDescription('Minutos extra (negativo para restar)').setMinValue(-59).setMaxValue(59))),

  // ---------- ADMIN / PM ----------
  periodos(new SlashCommandBuilder().setName('horas-de').setDescription('(ADMIN/PM) Horas en voz de un colaborador'), true),

  // ---------- Solo ADMIN ----------
  new SlashCommandBuilder().setName('canales').setDescription('(ADMIN) Canales de voz donde se cuentan las horas')
    .addSubcommand((s) => s.setName('agregar').setDescription('Agregar un canal de voz')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal de voz (o pega su ID)').setRequired(true)
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)))
    .addSubcommand((s) => s.setName('quitar').setDescription('Quitar un canal de voz')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal de voz (o pega su ID)').setRequired(true)
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)))
    .addSubcommand((s) => s.setName('lista').setDescription('Ver los canales que cuentan')),
  new SlashCommandBuilder().setName('limpiar').setDescription('(ADMIN) Borrar TODOS los mensajes de un canal de texto')
    .addChannelOption((o) => o.setName('canal').setDescription('Canal a limpiar (por defecto, este canal)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice)),
];
