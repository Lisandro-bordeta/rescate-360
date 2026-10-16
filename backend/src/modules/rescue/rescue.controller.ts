import { Request, Response } from 'express';
import { RescueService } from './rescue.service';
import { AuthRequest } from '../../../middleware/auth.middleware';
import { env } from '../../../config/env';
import { query } from 'express-validator';

export class RescueController {
  private readonly rescueService = new RescueService();

  validationRules = [
    query('zona').optional().isString(),
    query('nivel_vulnerabilidad').optional().isIn(['estandar', 'niño', 'adulto_mayor', 'discapacidad']),
    query('limite').optional().isInt({ min: 1, max: 1000 }),
  ];

  obtenerListaPrioridad = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const resultado = await this.rescueService.obtenerListaPrioridad({
        zona: req.query.zona as string | undefined,
        nivel_vulnerabilidad: req.query.nivel_vulnerabilidad as string | undefined,
        limite: req.query.limite ? Number(req.query.limite) : undefined,
      });

      res.json({
        total: resultado.length,
        generado_en: new Date().toISOString(),
        criterios: {
          immobile_minutes: env.OFFLINE_IMMOBILE_MINUTES,
          buffer_metros: env.SAFE_ZONE_BUFFER_METERS,
        },
        resultados: resultado,
      });
    } catch (err) {
      res.status(500).json({
        error: 'Error calculando lista de prioridad de rescate',
        detalle: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
