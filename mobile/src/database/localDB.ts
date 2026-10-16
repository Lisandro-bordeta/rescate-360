import * as SQLite from 'expo-sqlite';

/**
 * Base de datos local offline-first (SQLite).
 *
 * Tablas:
 *  - `eventos_ubicacion`: trazas GPS encoladas (sincronizadas o pendientes).
 *  - `sos_pendientes`: eventos SOS aún no confirmados por el canal de datos.
 *
 * `secuencia_local` es un contador monótono por dispositivo, usado por el
 * backend para deduplicar lotes reenviados tras un retry con backoff.
 *
 * La apertura es sincrónica (openDatabaseSync); las consultas son async.
 */

const DB_NAME = 'shield.db';

let db: SQLite.SQLiteDatabase | null = null;
let migracion: Promise<void> | null = null;

const getDb = (): SQLite.SQLiteDatabase => {
  if (!db) {
    db = SQLite.openDatabaseSync(DB_NAME);
    migracion = aplicarEsquema(db);
  }
  return db;
};

/** Crea tablas e índices si no existen (idempotente). */
const aplicarEsquema = (database: SQLite.SQLiteDatabase): Promise<void> =>
  database.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS eventos_ubicacion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      secuencia_local INTEGER NOT NULL UNIQUE,
      latitud REAL NOT NULL,
      longitud REAL NOT NULL,
      precision REAL,
      bateria INTEGER,
      fecha_registro TEXT NOT NULL,
      es_sos INTEGER NOT NULL DEFAULT 0,
      sincronizado INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_eventos_pendientes
      ON eventos_ubicacion (sincronizado, secuencia_local)
      WHERE sincronizado = 0;

    CREATE TABLE IF NOT EXISTS sos_pendientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      secuencia_local INTEGER NOT NULL UNIQUE,
      latitud REAL NOT NULL,
      longitud REAL NOT NULL,
      mensaje TEXT,
      enviado_sms INTEGER NOT NULL DEFAULT 0,
      confirmado_servidor INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

/** Espera a que el esquema esté listo (lo invocan todas las operaciones). */
const listo = async (): Promise<SQLite.SQLiteDatabase> => {
  const database = getDb();
  await migracion;
  return database;
};

export interface NuevoEvento {
  secuencia_local: number;
  latitud: number;
  longitud: number;
  precision: number | null;
  bateria: number | null;
  fecha_registro: string;
  es_sos: boolean;
}

/** Siguiente número de secuencia monótono para este dispositivo. */
export const nextSecuenciaLocal = async (): Promise<number> => {
  const database = await listo();
  const row = await database.getFirstAsync<{ max_seq: number | null }>(
    'SELECT MAX(secuencia_local) AS max_seq FROM eventos_ubicacion',
  );
  return (row?.max_seq ?? 0) + 1;
};

/** Inserta una traza GPS (o SOS) en la cola local. */
export const insertarEvento = async (evento: NuevoEvento): Promise<void> => {
  const database = await listo();
  await database.runAsync(
    `INSERT INTO eventos_ubicacion
       (secuencia_local, latitud, longitud, precision, bateria, fecha_registro, es_sos)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      evento.secuencia_local,
      evento.latitud,
      evento.longitud,
      evento.precision,
      evento.bateria,
      evento.fecha_registro,
      evento.es_sos ? 1 : 0,
    ],
  );
};

/** Traza más reciente registrada (para SOS offline y cálculo de inmovilidad). */
export const ultimaUbicacionLocal = async (): Promise<{
  latitud: number;
  longitud: number;
  fecha_registro: string;
} | null> => {
  const database = await listo();
  return database.getFirstAsync(
    'SELECT latitud, longitud, fecha_registro FROM eventos_ubicacion ORDER BY secuencia_local DESC LIMIT 1',
  );
};

/** Lote de eventos pendientes de sincronizar (más antiguos primero). */
export const obtenerPendientes = async (limite = 200): Promise<NuevoEvento[]> => {
  const database = await listo();
  const rows = await database.getAllAsync<{
    secuencia_local: number;
    latitud: number;
    longitud: number;
    precision: number | null;
    bateria: number | null;
    fecha_registro: string;
    es_sos: number;
  }>(
    `SELECT secuencia_local, latitud, longitud, precision, bateria, fecha_registro, es_sos
       FROM eventos_ubicacion
      WHERE sincronizado = 0
      ORDER BY secuencia_local ASC
      LIMIT ?`,
    [limite],
  );

  return rows.map((r) => ({
    secuencia_local: r.secuencia_local,
    latitud: r.latitud,
    longitud: r.longitud,
    precision: r.precision,
    bateria: r.bateria,
    fecha_registro: r.fecha_registro,
    es_sos: r.es_sos === 1,
  }));
};

/** Marca un conjunto de secuencias como sincronizadas (ack del backend). */
export const marcarSincronizadas = async (secuencias: number[]): Promise<void> => {
  if (secuencias.length === 0) return;
  const database = await listo();
  const placeholders = secuencias.map(() => '?').join(',');
  await database.runAsync(
    `UPDATE eventos_ubicacion SET sincronizado = 1 WHERE secuencia_local IN (${placeholders})`,
    secuencias,
  );
};

/** Registra un SOS offline para fallback por SMS. */
export const registrarSos = async (
  secuencia: number,
  latitud: number,
  longitud: number,
  mensaje?: string,
): Promise<void> => {
  const database = await listo();
  await database.runAsync(
    `INSERT INTO sos_pendientes (secuencia_local, latitud, longitud, mensaje)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(secuencia_local) DO NOTHING`,
    [secuencia, latitud, longitud, mensaje ?? null],
  );
};

/** SOS aún no confirmados por el servidor (candidatos a envío SMS). */
export const sosSinConfirmar = async (): Promise<
  Array<{ secuencia_local: number; latitud: number; longitud: number; mensaje: string | null }>
> => {
  const database = await listo();
  return database.getAllAsync(
    `SELECT secuencia_local, latitud, longitud, mensaje
       FROM sos_pendientes
      WHERE confirmado_servidor = 0 AND enviado_sms = 0
      ORDER BY creado_en ASC`,
  );
};

/** Marca un SOS como enviado por SMS (para no reenviar en cada reintento). */
export const marcarSosEnviadoSms = async (secuencia: number): Promise<void> => {
  const database = await listo();
  await database.runAsync('UPDATE sos_pendientes SET enviado_sms = 1 WHERE secuencia_local = ?', [
    secuencia,
  ]);
};

/** Confirma un SOS cuando el backend lo recibió por el canal de datos. */
export const confirmarSosServidor = async (secuencias: number[]): Promise<void> => {
  if (secuencias.length === 0) return;
  const database = await listo();
  const placeholders = secuencias.map(() => '?').join(',');
  await database.runAsync(
    `UPDATE sos_pendientes SET confirmado_servidor = 1 WHERE secuencia_local IN (${placeholders})`,
    secuencias,
  );
};

/** Cantidad de eventos pendientes (para UI de estado offline). */
export const contarPendientes = async (): Promise<number> => {
  const database = await listo();
  const row = await database.getFirstAsync<{ total: number }>(
    'SELECT COUNT(*) AS total FROM eventos_ubicacion WHERE sincronizado = 0',
  );
  return row?.total ?? 0;
};
