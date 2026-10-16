import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../database/datasource';
import { AlertaInundacion } from '../../entities/AlertaInundacion';
import { authenticate } from '../../middleware/auth.middleware';

/**
 * Alertas de inundación (detección por sensores / cámaras / satélite).
 * Los polígonos anegados se sirven como GeoJSON listo para renderizar en el mapa.
 */
export const alertsRouter = Router();

/** GET /alerts/active → FeatureCollection de zonas anegadas vigentes. */
alertsRouter.get('/active', authenticate, async (_req: Request, res: Response) => {
  const features = await AppDataSource.query(`
    SELECT
      id,
      zona,
      nivel_agua,
      tipo_alerta,
      fecha_inicio,
      ST_AsGeoJSON(geom)::json AS geometry
    FROM alertas_inundacion
    WHERE activo = TRUE
      AND fecha_fin IS NULL
    ORDER BY fecha_inicio DESC
  `);

  res.type('application/geo+json').json({
    type: 'FeatureCollection',
    features: features.map((f: Record<string, unknown>) => ({
      type: 'Feature',
      id: f.id,
      geometry: f.geometry,
      properties: {
        zona: f.zona,
        nivel_agua: f.nivel_agua,
        tipo_alerta: f.tipo_alerta,
        fecha_inicio: f.fecha_inicio,
      },
    })),
  });
});

/**
 * POST /alerts
 * Ingesta desde el backend de sensores (nivel de agua). Requiere autenticación;
 * en producción, además, restringir a red interna o mTLS del proveedor de datos.
 */
alertsRouter.post('/', authenticate, async (req: Request, res: Response) => {
  const { zona, nivel_agua, tipo_alerta, geom_wkt } = req.body as {
    zona: string;
    nivel_agua: number;
    tipo_alerta: AlertaInundacion['tipo_alerta'];
    geom_wkt: string;
  };

  if (!zona || nivel_agua === undefined || !geom_wkt) {
    res.status(400).json({ error: 'zona, nivel_agua y geom_wkt son requeridos.' });
    return;
  }

  const repo = AppDataSource.getRepository(AlertaInundacion);
  const alerta = await repo.save(
    repo.create({ zona, nivel_agua, tipo_alerta, geom_wkt, activo: true }),
  );

  res.status(201).json({ id: alerta.id, creada_en: alerta.fecha_inicio });
});

/** PATCH /alerts/:id/close → cierra una alerta vigente. */
alertsRouter.patch('/:id/close', authenticate, async (req: Request, res: Response) => {
  const repo = AppDataSource.getRepository(AlertaInundacion);
  const alerta = await repo.findOneBy({ id: req.params.id as string });
  if (!alerta) {
    res.status(404).json({ error: 'Alerta no encontrada.' });
    return;
  }
  alerta.activo = false;
  alerta.fecha_fin = new Date();
  await repo.save(alerta);
  res.json({ cerrada: true, id: alerta.id });
});
