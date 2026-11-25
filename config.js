// Configuración de GonGic. Los canales de voz que cuentan se administran desde Discord con /canales.
module.exports = {
  // ---- Variables del archivo .env ----
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  canalAvisosId: process.env.CANAL_AVISOS_ID, // canal de ADMIN donde se avisa cuando un SS completa su servicio
  mongoUri: process.env.MONGODB_URI,
  mongoDb: process.env.MONGODB_DB || 'gongic',

  // ---- Roles (se comparan sin emojis, espacios ni mayúsculas) ----
  // Quien tenga SS y además Programador o PM se trata como SS.
  rolesSS: ['SS'], // servicio social: tienen meta de horas
  rolesEmpleado: ['Programador', 'PM'], // empleados: sin meta
  rolesAdmin: ['ADMIN'], // administran /canales y los ajustes del servicio social
  // A quién puede ver cada rol con /horas-de (el tipo del colaborador es SS, Programador o PM).
  consultas: {
    ADMIN: ['SS', 'Programador', 'PM'],
    PM: ['SS', 'Programador'],
  },
  rolesListaSS: ['ADMIN', 'PM'], // pueden ver /servicio-social lista

  // ---- Servicio social ----
  metaServicioHoras: 480,

  zonaHoraria: 'America/Mexico_City',
  offsetUTC: '-06:00', // Ciudad de México ya no usa horario de verano
};
