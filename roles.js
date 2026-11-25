const cfg = require('./config');

// Quita emojis, espacios, acentos y mayúsculas: "ADMIN 👑" -> "ADMIN"
const normalizar = (s) => s.normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();

// Devuelve el nombre (tal como está en config) del primer rol de la lista que tenga el miembro.
function rolDe(member, nombres) {
  if (!member) return null;
  const mapa = new Map(nombres.map((n) => [normalizar(n), n]));
  const rol = member.roles.cache.find((r) => mapa.has(normalizar(r.name)));
  return rol ? mapa.get(normalizar(rol.name)) : null;
}

// 'SS', 'Programador', 'PM' o null. SS tiene prioridad si tiene varios.
const tipo = (m) => rolDe(m, cfg.rolesSS) ?? rolDe(m, cfg.rolesEmpleado);
const esColaborador = (m) => !!tipo(m);
const esSS = (m) => !!rolDe(m, cfg.rolesSS);
const esAdmin = (m) => !!rolDe(m, cfg.rolesAdmin);
const puedeVerListaSS = (m) => !!rolDe(m, cfg.rolesListaSS);

// Si "quien" puede ver las horas de "objetivo" con /horas-de.
function puedeConsultar(quien, objetivo) {
  const t = tipo(objetivo);
  if (!t) return false;
  return Object.entries(cfg.consultas).some(([rol, tipos]) => rolDe(quien, [rol]) && tipos.includes(t));
}

// Texto para el mensaje de error de /horas-de: "SS, Programador y PM".
function textoConsultables(quien) {
  const tipos = new Set(Object.entries(cfg.consultas).filter(([rol]) => rolDe(quien, [rol])).flatMap(([, t]) => t));
  return [...tipos].join(', ').replace(/, ([^,]*)$/, ' y $1');
}

module.exports = { normalizar, rolDe, tipo, esColaborador, esSS, esAdmin, puedeVerListaSS, puedeConsultar, textoConsultables };
