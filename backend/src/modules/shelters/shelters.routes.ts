import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../database/datasource';
import { Refugio } from '../../entities/Refugio';
import { authenticate } from '../../middleware/auth.middleware';

/**
 * Refugios. La app descarga este listado para uso offline (junto con los tiles
 * del mapa), de modo que la ruta segura se puede calcular sin conexión.
 */
export const sheltersRouter = Router();

/**
 * GET /shelters
 * Filtros opcionales:
 *  - `cerca=lat,lon&radio_km=10` → refugios ordenados por distancia.
 * Sirve tanto a la app como al sobrevuelo de logística de rescate rural.
 */
sheltersRouter.get('/', authenticate, async (req: Request, res: Response) => {
  const cerca = req.query.cerca as string | undefined;
  const radioKm = Number(req.query.radio_km ?? 25);

  if (cerca) {
    const [lat, lon] = cerca.split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.status(400).json({ error: 'Parámetro `cerca` inválido. Formato: lat,lon' });
      return;
    }

    const refugios = await AppDataSource.query(
      `
      SELECT r.*,
             ROUND((ST_Distance(
               r.ubicacion,
               ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
             ) / 1000)::numeric, 2) AS distancia_km
      FROM refugios r
      WHERE r.activo = TRUE
        AND ST_DWithin(
          r.ubicacion,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $3 * 1000
        )
      ORDER BY distancia_km ASC
      `,
      [lat, lon, radioKm],
    );

    res.json({ total: refugios.length, resultados: refugios });
    return;
  }

  const refugios = await AppDataSource.getRepository(Refugio).find({
    where: { activo: true },
    order: { nombre: 'ASC' },
  });
  res.json({ total: refugios.length, resultados: refugios });
});

/** GET /shelters/:id → detalle de un refugio. */
sheltersRouter.get('/:id', authenticate, async (req: Request, res: Response) => {
  const refugio = await AppDataSource.getRepository(Refugio).findOneBy({
    id: req.params.id as string,
    activo: true,
  });
  if (!refugio) {
    res.status(404).json({ error: 'Refugio no encontrado.' });
    return;
  }
  res.json(refugio);
});
