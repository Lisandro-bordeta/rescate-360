import { pool } from '../../../database/pool';

export interface OfflineLocation {
  usuario_id: string;
  latitud: number;
  longitud: number;
  precision?: number | null;
  bateria?: number | null;
  dispositivo_id?: string | null;
  fecha_registro: string | Date;
  secuencia_local: number;
}

export interface BatchResult {
  received: number;
  inserted: number;
  duplicados: number;
  ids: string[];
}

/**
 * Servicio de sincronización de trazas guardadas en modo offline.
 * Recibe lotes (batch) de ubicaciones, las inserta con deduplicación por
 * (usuario_id, secuencia_local) y permite marcar los registros como
 * sincronizados una vez procesados.
 */
export class SyncService {
  async receiveBatch(locations: OfflineLocation[]): Promise<BatchResult> {
    if (!locations || locations.length === 0) {
      return { received: 0, inserted: 0, duplicados: 0, ids: [] };
    }

    // Deduplicación aplicativa: por usuario, conservar la secuencia local más alta.
    const porUsuario = new Map<string, OfflineLocation>();
    for (const loc of locations) {
      const prev = porUsuario.get(loc.usuario_id);
      if (!prev || loc.secuencia_local > prev.secuencia_local) {
        porUsuario.set(loc.usuario_id, loc);
      }
    }

    const unicos = Array.from(porUsuario.values());
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const values: unknown[] = [];
      const placeholders = unicos.map((loc, i) => {
        const base = i * 8;
        values.push(
          loc.usuario_id,
          loc.latitud,
          loc.longitud,
          loc.precision ?? null,
          loc.bateria ?? null,
          loc.dispositivo_id ?? null,
          loc.secuencia_local,
          loc.fecha_registro
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
      });

      const sql = `
        INSERT INTO tracking_ubicacion
          (usuario_id, latitud, longitud, precision, bateria, dispositivo_id, secuencia_local, fecha_registro)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (usuario_id, secuencia_local) DO NOTHING
        RETURNING id, usuario_id, secuencia_local;
      `;

      const result = await client.query(sql, values);
      await client.query('COMMIT');

      const inserted = result.rowCount;
      return {
        received: locations.length,
        inserted,
        duplicados: unicos.length - inserted,
        ids: result.rows.map((r) => r.id),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async marcarSincronizados(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE tracking_ubicacion SET sincronizado = TRUE, enviado_en = NOW() WHERE id = ANY($1)`,
        [ids]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
