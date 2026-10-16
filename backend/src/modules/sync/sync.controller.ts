import { Request, Response } from 'express';
import { SyncService } from './sync.service';
import { AuthRequest } from '../../../middleware/auth.middleware';
import { body, validationResult } from 'express-validator';

export class SyncController {
  private readonly syncService = new SyncService();

  validationRules = [
    body('ubicaciones').isArray({ min: 1 }).withMessage('ubicaciones debe ser un array no vacío'),
    body('ubicaciones.*.usuario_id').isUUID(),
    body('ubicaciones.*.latitud').isFloat({ min: -90, max: 90 }),
    body('ubicaciones.*.longitud').isFloat({ min: -180, max: 180 }),
    body('ubicaciones.*.secuencia_local').isInt({ min: 0 }),
  ];

  recibirLoteUbicaciones = async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: 'Validación fallida', detalles: errors.array() });
      return;
    }

    try {
      const { ubicaciones } = req.body as { ubicaciones: any[] };
      const resultado = await this.syncService.receiveBatch(ubicaciones);
      res.status(202).json({
        aceptado: true,
        ...resultado,
        procesado_en: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({
        error: 'Error procesando lote de ubicaciones',
        detalle: err instanceof Error ? err.message : String(err),
      });
    }
  };

  confirmarSincronizados = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { ids } = req.body as { ids: string[] };
      if (!Array.isArray(ids) || !ids.length) {
        res.status(400).json({ error: 'ids requerido' });
        return;
      }
      await this.syncService.marcarSincronizados(ids);
      res.json({ aceptado: true, ids });
    } catch (err) {
      res.status(500).json({ error: 'Error confirmando sincronización', detalle: String(err) });
    }
  };
}
