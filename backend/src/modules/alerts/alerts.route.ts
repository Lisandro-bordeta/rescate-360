import { Router } from 'express';
import { authenticate, authorizeRoles } from '../../middleware/auth.middleware';

// Esqueleto de rutas de alertas de inundación.
// GET  /alertas-inundacion  -> alertas activas con geometría GeoJSON (ST_AsGeoJSON).
// POST /alertas-inundacion  -> crear alerta (solo admin/rescatista).
const router = Router();

router.get('/', authenticate, (_req, res) => {
  res.json({ mensaje: 'Endpoint GET alertas activas - implementar con ST_AsGeoJSON(geom)' });
});

router.post('/', authenticate, authorizeRoles('admin', 'rescatista'), (_req, res) => {
  res.json({ mensaje: 'Endpoint POST crear alerta de inundación - implementar' });
});

export default router;
