import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../database/datasource';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { env } from '../../config/env';
import { broadcastRescate } from '../../services/notification.service';
import { obtenerListaPrioridad } from './rescue.service';

/**
 * Búsqueda y rescate: lista de prioridad basada en la última posición conocida,
 * evaluación de zona segura (buffer PostGIS) y detección de "señales quietas".
 */
export const rescueRouter = Router();

/**
 * GET /rescue/priority-list
 * Query: ?solo_senal_quieta=true&limite=200
 */
rescueRouter.get(
  '/priority-list',
  authenticate,
  requireRole('rescatista', 'admin'),
  async (req: Request, res: Response) => {
    const resultados = await obtenerListaPrioridad({
      soloSenalQuieta: req.query.solo_senal_quieta === 'true',
      limite: Number(req.query.limite ?? 200),
    });

    res.json({
      total: resultados.length,
      umbral_buffer_m: env.SAFE_ZONE_BUFFER_METERS,
      umbral_inmovil_min: env.OFFLINE_IMMOBILE_MINUTES,
      resultados,
    });
  },
);

/**
 * POST /rescue/priority-list/notify
 * Recalcula la lista priorizada y la emite por WebSocket a los equipos conectados
 * (dispara la alerta de trabajo en los tableros de rescate).
 */
rescueRouter.post(
  '/priority-list/notify',
  authenticate,
  requireRole('admin'),
  async (_req: Request, res: Response) => {
    const resultados = await obtenerListaPrioridad({ soloSenalQuieta: true, limite: 200 });
    broadcastRescate('rescate:actualizacion', {
      emitido_en: new Date().toISOString(),
      total: resultados.length,
      alta_prioridad: resultados.filter((r) => r.prioridad === 'alta').length,
    });
    res.json({ emitido: true, total: resultados.length });
  },
);

/**
 * POST /rescue/users/:id/asignar-refugio
 * Asignación dinámica de refugio (urbano con capacidad, o punto de rescate rural).
 */
rescueRouter.post(
  '/users/:id/asignar-refugio',
  authenticate,
  requireRole('rescatista', 'admin'),
  async (req: Request, res: Response) => {
    const { refugioId } = req.body as { refugioId: string };

    const result = await AppDataSource.query(
      `
      UPDATE usuarios u
      SET refugio_asignado_id = $2,
          fecha_actualizacion = NOW()
      FROM refugios r
      WHERE u.id = $1
        AND r.id = $2
        AND r.activo = TRUE
        AND (r.capacidad = 0 OR r.ocupacion_actual < r.capacidad)
      RETURNING u.id
      `,
      [req.params.id, refugioId],
    );

    if (result.length === 0) {
      res.status(409).json({ error: 'Refugio inexistente, inactivo o sin capacidad disponible.' });
      return;
    }
    res.json({ asignado: true, usuario_id: result[0].id, refugio_id: refugioId });
  },
);
