import { AppDataSource } from '../../database/datasource';
import { env } from '../../config/env';

/**
 * Lógica de búsqueda y rescate, reutilizable por endpoints y jobs.
 *
 * La evaluación espacial se delega a PostGIS en una única consulta:
 *  1. Última ubicación por usuario (`DISTINCT ON`).
 *  2. `ST_DWithin` contra la zona segura del refugio (buffer configurable)
 *     → detecta usuarios FUERA de la zona segura.
 *  3. Antigüedad de la última traza > `OFFLINE_IMMOBILE_MINUTES`
 *     → detecta "señales quietas" (inmóviles o sin reportar).
 *  4. Score compuesto por vulnerabilidad + situación + minutos sin señal.
 */

export interface ItemPrioridad {
  usuario_id: string;
  nombre: string;
  apellido: string;
  dni: string;
  nivel_vulnerabilidad: string;
  latitud: number;
  longitud: number;
  ultima_actualizacion: Date;
  refugio_asignado: string | null;
  minutos_sin_senal: number;
  fuera_zona_segura: boolean;
  inmovil: boolean;
  prioridad: 'alta' | 'media' | 'baja';
  score: number;
}

export interface OpcionesPrioridad {
  /** Máximo de resultados a devolver. Default 200, tope 1000. */
  limite?: number;
  /** Si true, solo devuelve filas fuera de zona o inmóviles ("señal quieta"). */
  soloSenalQuieta?: boolean;
}

const PESO_VULNERABILIDAD: Record<string, number> = {
  discapacidad: 40,
  adulto_mayor: 35,
  niño: 30,
  estandar: 10,
};

export const calcularPrioridad = (score: number): 'alta' | 'media' | 'baja' =>
  score >= 60 ? 'alta' : score >= 35 ? 'media' : 'baja';

export const obtenerListaPrioridad = async (
  opciones: OpcionesPrioridad = {},
): Promise<ItemPrioridad[]> => {
  const limite = Math.min(opciones.limite ?? 200, 1000);

  const rows: ItemPrioridad[] = await AppDataSource.query(
    `
    WITH ultima AS (
      SELECT DISTINCT ON (t.usuario_id)
        t.usuario_id,
        t.latitud,
        t.longitud,
        t.ubicacion,
        t.fecha_registro,
        u.nombre,
        u.apellido,
        u.dni,
        u.nivel_vulnerabilidad,
        r.nombre AS refugio_asignado,
        r.zona_segura
      FROM tracking_ubicacion t
      JOIN usuarios u ON u.id = t.usuario_id AND u.activo = TRUE
      LEFT JOIN refugios r ON r.id = u.refugio_asignado_id AND r.activo = TRUE
      WHERE u.rol = 'ciudadano'
      ORDER BY t.usuario_id, t.fecha_registro DESC
    )
    SELECT
      usuario_id,
      nombre,
      apellido,
      dni,
      nivel_vulnerabilidad,
      latitud,
      longitud,
      fecha_registro AS ultima_actualizacion,
      refugio_asignado,
      ROUND(EXTRACT(EPOCH FROM (NOW() - fecha_registro)) / 60)::int AS minutos_sin_senal,
      (
        zona_segura IS NOT NULL
        AND NOT ST_DWithin(ubicacion, zona_segura::geography, $1)
      ) AS fuera_zona_segura,
      (fecha_registro < NOW() - make_interval(mins => $2)) AS inmovil,
      (
        CASE nivel_vulnerabilidad
          WHEN 'discapacidad' THEN 40
          WHEN 'adulto_mayor' THEN 35
          WHEN 'niño' THEN 30
          ELSE 10
        END
        + CASE WHEN zona_segura IS NOT NULL
                 AND NOT ST_DWithin(ubicacion, zona_segura::geography, $1)
               THEN 30 ELSE 0 END
        + CASE WHEN fecha_registro < NOW() - make_interval(mins => $2)
               THEN 20 ELSE 0 END
        + LEAST(10, GREATEST(0, EXTRACT(EPOCH FROM (NOW() - fecha_registro)) / 300)::int)
      ) AS score
    FROM ultima
    ORDER BY score DESC, fecha_registro ASC
    LIMIT $3
    `,
    [env.SAFE_ZONE_BUFFER_METERS, env.OFFLINE_IMMOBILE_MINUTES, limite],
  );

  return rows
    .map((r) => ({ ...r, prioridad: calcularPrioridad(Number(r.score)) }))
    .filter((r) => !opciones.soloSenalQuieta || r.inmovil || r.fuera_zona_segura);
};
