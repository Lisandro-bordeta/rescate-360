import { Request, Response } from 'express';
import { EventsService } from './events.service';
import { AuthRequest } from '../../../middleware/auth.middleware';

export class EventsController {
  private readonly eventsService = new EventsService();

  registrar = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { tipo, payload } = req.body;
      if (!tipo || !['ubicacion', 'sos', 'estado_salud'].includes(tipo)) {
        res.status(400).json({ error: 'tipo requerido (ubicacion | sos | estado_salud)' });
        return;
      }

      const evento = await this.eventsService.registrar({
        usuario_id: req.usuario!.id,
        tipo,
        payload,
      });

      // Si es SOS, notificar en tiempo real al equipo de rescate vía WebSocket.
      if (tipo === 'sos') {
        const { getIO } = require('../../server');
        const io = getIO();
        if (io) io.to('equipo-rescate').emit('sos_nuevo', { usuarioId: req.usuario!.id, payload });
      }

      res.status(202).json({ aceptado: true, evento });
    } catch (err) {
      res.status(500).json({
        error: 'Error registrando evento',
        detalle: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
