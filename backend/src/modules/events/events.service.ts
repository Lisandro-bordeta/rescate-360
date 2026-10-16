import { pool } from '../../../database/pool';

export type TipoEvento = 'ubicacion' | 'sos' | 'estado_salud';

export interface EventoEntrante {
  usuario_id: string;
  tipo: TipoEvento;
  payload: any;
}

export interface EventoRegistrado {
  id: string;
  creado_en: Date;
  estado: string;
}

/**
 * Registro de eventos entrantes desde la app móvil (SOS, estado de salud,
 * marcas de ubicación). Se persiste para trazabilidad incluso si el procesamiento
 * en tiempo real falla.
 */
export class EventsService {
  async registrar(evento: EventoEntrante): Promise<EventoRegistrado> {
    const { rows } = await pool.query(
      `INSERT INTO cola_eventos (usuario_id, tipo, payload)
       VALUES ($1, $2, $3)
       RETURNING id, creado_en, estado`,
      [evento.usuario_id, evento.tipo, JSON.stringify(evento.payload ?? {})]
    );
    return rows[0];
  }
}
