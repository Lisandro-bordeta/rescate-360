import { Pool } from 'pg';
import { env } from '../config/env';

/**
 * Pool de conexiones de PostgreSQL utilizado para consultas espaciales
 * crudas con PostGIS (ST_DWithin, ST_Contains, ST_Buffer, etc.).
 * TypeORM se encarga del ORM; este pool da acceso directo a PostGIS.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('connect', () => {
  // Asegurar PostGIS en cada sesión (no es estrictamente necesario si la extensión está en la DB)
  // void pool.query('CREATE EXTENSION IF NOT EXISTS postgis');
});

pool.on('error', (err) => {
  console.error('[Pool] Error inesperado de cliente idle', err);
});

export default pool;
