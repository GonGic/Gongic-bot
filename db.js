const dns = require('node:dns');
const { MongoClient } = require('mongodb');
const cfg = require('./config');

const NOMBRES = {
  sesiones: 'sesiones',
  canales: 'canales',
  ajustes: 'ajustes_servicio',
  servicio: 'servicio_social',
};

let client;
let col;

async function conectar() {
  if (!cfg.mongoUri) throw new Error('Falta MONGODB_URI en el archivo .env');
  // Los registros SRV de "mongodb+srv://" siempre se resuelven con DNS públicos (Cloudflare y Google),
  // no con los de la red o del servidor, porque algunos no los resuelven.
  dns.setServers(['1.1.1.1', '8.8.8.8']);
  client = new MongoClient(cfg.mongoUri);
  await client.connect();
  const db = client.db(cfg.mongoDb);
  col = Object.fromEntries(Object.entries(NOMBRES).map(([k, n]) => [k, db.collection(n)]));

  await Promise.all([
    // Garantiza que nadie tenga dos sesiones abiertas a la vez.
    col.sesiones.createIndex({ userId: 1 }, { unique: true, partialFilterExpression: { abierta: true } }),
    col.sesiones.createIndex({ userId: 1, inicio: 1 }),
    col.ajustes.createIndex({ userId: 1, fecha: 1 }),
  ]);
  return client;
}

// ---------- Sesiones ----------
// Abre una sesión si no tiene una abierta. Devuelve true si la abrió.
async function abrirSesion(userId, canal, inicio = new Date()) {
  try {
    await col.sesiones.insertOne({ userId, canalId: canal.id, canalNombre: canal.name, inicio, fin: null, abierta: true });
    return true;
  } catch (e) {
    if (e.code === 11000) return false; // ya tenía una abierta
    throw e;
  }
}

// Cierra la sesión abierta. Devuelve true si había una.
async function cerrarSesion(userId, fin = new Date()) {
  const r = await col.sesiones.updateOne({ userId, abierta: true }, { $set: { fin }, $unset: { abierta: '' } });
  return r.modifiedCount === 1;
}

async function sesionesAbiertas() {
  return col.sesiones.find({ abierta: true }).toArray();
}

// Sesiones que se cruzan con [desde, hasta): las que empezaron antes de "hasta" y no habían terminado en "desde".
async function sesionesEntre(userId, desde, hasta) {
  return col.sesiones.find({
    userId, inicio: { $lt: hasta }, $or: [{ fin: null }, { fin: { $gt: desde } }],
  }).sort({ inicio: 1 }).toArray();
}

// ---------- Servicio social ----------
// Minutos acumulados por usuario: todas sus sesiones (las abiertas, hasta ahora) más los ajustes. Nunca negativo.
// Devuelve Map userId -> { minutos, primeraSesion }.
async function totalesServicio(userIds) {
  const [sesiones, ajustes] = await Promise.all([
    col.sesiones.aggregate([
      { $match: { userId: { $in: userIds } } },
      {
        $group: {
          _id: '$userId',
          ms: { $sum: { $subtract: [{ $ifNull: ['$fin', '$$NOW'] }, '$inicio'] } },
          primera: { $min: '$inicio' },
        },
      },
    ]).toArray(),
    col.ajustes.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$userId', minutos: { $sum: '$minutos' } } },
    ]).toArray(),
  ]);
  const totales = new Map(userIds.map((id) => [id, { minutos: 0, primeraSesion: null }]));
  for (const s of sesiones) totales.set(s._id, { minutos: s.ms / 60000, primeraSesion: s.primera });
  for (const a of ajustes) totales.get(a._id).minutos += a.minutos;
  for (const t of totales.values()) t.minutos = Math.max(0, Math.floor(t.minutos));
  return totales;
}

async function totalServicio(userId) {
  return (await totalesServicio([userId])).get(userId);
}

// Suma o resta minutos a mano. Rechaza el ajuste si deja el total por debajo de 0. Devuelve el total nuevo o null.
async function ajustarServicio(userId, minutos, motivo, adminId) {
  const { minutos: antes } = await totalServicio(userId);
  if (antes + minutos < 0) return null;
  await col.ajustes.insertOne({ userId, minutos, motivo, adminId, fecha: new Date() });
  // Si un ajuste lo baja de la meta, vuelve a quedar pendiente (y se avisará otra vez al completar).
  if (antes + minutos < cfg.metaServicioHoras * 60) await col.servicio.deleteOne({ _id: userId });
  return antes + minutos;
}

async function ajustesDe(userId) {
  return col.ajustes.find({ userId }).sort({ fecha: 1 }).toArray();
}

// Marca que completó el servicio. Devuelve true solo la primera vez (para avisar una sola vez).
async function marcarCompletado(userId) {
  try {
    const r = await col.servicio.updateOne({ _id: userId }, { $setOnInsert: { completadoEn: new Date() } }, { upsert: true });
    return r.upsertedCount === 1;
  } catch (e) {
    if (e.code === 11000) return false; // otra revisión simultánea ya lo marcó
    throw e;
  }
}

// Map userId -> fecha en que completó.
async function completados(userIds) {
  const docs = await col.servicio.find({ _id: { $in: userIds } }).toArray();
  return new Map(docs.map((d) => [d._id, d.completadoEn]));
}

// ---------- Canales que cuentan ----------
async function agregarCanal(canal, adminId) {
  const r = await col.canales.updateOne(
    { _id: canal.id },
    { $set: { nombre: canal.name }, $setOnInsert: { agregadoPor: adminId, agregadoEn: new Date() } },
    { upsert: true },
  );
  return r.upsertedCount === 1;
}

async function quitarCanal(canalId) {
  const r = await col.canales.deleteOne({ _id: canalId });
  return r.deletedCount === 1;
}

async function listarCanales() {
  return col.canales.find().toArray();
}

module.exports = {
  conectar, abrirSesion, cerrarSesion, sesionesAbiertas, sesionesEntre,
  totalesServicio, totalServicio, ajustarServicio, ajustesDe, marcarCompletado, completados,
  agregarCanal, quitarCanal, listarCanales,
};
