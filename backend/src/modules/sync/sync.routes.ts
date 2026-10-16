import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { In } from 'typeorm';
import { AppDataSource } from '../../database/datasource';
import { TrackingUbicacion } from '../../entities/TrackingUbicacion';
import { ColaSmsSos } from '../../entities/ColaSmsSos';
import { authenticate } from '../../middleware/auth.middleware';

/**
 * Sincronización offline-first.
 *
 * La app móvil acumula trazas GPS y eventos SOS localmente (SQLite) y los
 * vuelca en lote al recuperar conectividad. `secuencia_local` + `dispositivo_id`
 * permiten deduplicar de forma idempotente (reintentos de backoff pueden
 * reproducir el mismo lote sin duplicar filas).
 */
export const syncRouter = Router();

syncRouter.post(
  '/locations-batch',
  authenticate,
  [
    body('dispositivo_id').isString().notEmpty(),
    body('ubicaciones').isArray({ max: 1000 }),
    body('ubicaciones.*.secuencia_local').isInt({ min: 0 }),
    body('ubicaciones.*.latitud').isFloat({ min: -90, max: 90 }),
    body('ubicaciones.*.longitud').isFloat({ min: -180, max: 180 }),
    body('ubicaciones.*.precision').optional({ nullable: true }).isFloat({ min: 0 }),
    body('ubicaciones.*.bateria').optional({ nullable: true }).isInt({ min: 0, max: 100 }),
    body('ubicaciones.*.fecha_registro').isISO8601(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(422).json({ error: 'Lote inválido.', detalles: errors.array() });
      return;
    }

    const usuarioId = req.user!.id;
    const { dispositivo_id, ubicaciones } = req.body as {
      dispositivo_id: string;
      ubicaciones: Array<{
        secuencia_local: number;
        latitud: number;
        longitud: number;
        precision?: number | null;
        bateria?: number | null;
        fecha_registro: string;
      }>;
    };

    const repo = AppDataSource.getRepository(TrackingUbicacion);

    // Deduplicación idempotente: qué secuencias de este dispositivo/usuario ya existen.
    const secuencias = ubicaciones.map((u) => u.secuencia_local);
    const existentes = await repo.find({
      where: { usuario_id: usuarioId, dispositivo_id, secuencia_local: In(secuencias) },
      select: ['secuencia_local'],
    });
    const setExistente = new Set(existentes.map((e) => e.secuencia_local));

    const nuevas = ubicaciones
      .filter((u) => !setExistente.has(u.secuencia_local))
      .map((u) =>
        repo.create({
          usuario_id: usuarioId,
          dispositivo_id,
          secuencia_local: u.secuencia_local,
          latitud: u.latitud,
          longitud: u.longitud,
          precision: u.precision ?? null,
          bateria: u.bateria ?? null,
          fecha_registro: new Date(u.fecha_registro),
          sincronizado: true,
          enviado_en: new Date(),
        }),
      );

    if (nuevas.length > 0) {
      await repo.save(nuevas, { chunk: 500 });
    }

    res.json({
      recibidas: ubicaciones.length,
      nuevas: nuevas.length,
      duplicadas: ubicaciones.length - nuevas.length,
    });
  },
);

/**
 * Ingesta de eventos SOS generados offline.
 * Crea la fila en `cola_sms_sos` (estado pendiente) y el evento llega por el
 * canal de datos; el worker de SMS solo actúa si el evento no se confirma a tiempo.
 */
syncRouter.post(
  '/sos',
  authenticate,
  [
    body('latitud').isFloat({ min: -90, max: 90 }),
    body('longitud').isFloat({ min: -180, max: 180 }),
    body('mensaje').optional().isString().isLength({ max: 320 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(422).json({ error: 'Evento SOS inválido.', detalles: errors.array() });
      return;
    }

    const { latitud, longitud, mensaje } = req.body as {
      latitud: number;
      longitud: number;
      mensaje?: string;
    };

    const usuario = req.user!;
    const texto =
      mensaje ??
      `SOS SHIELD: usuario ${usuario.id} en ${latitud.toFixed(6)},${longitud.toFixed(6)}`;

    const cola = AppDataSource.getRepository(ColaSmsSos);
    const registro = await cola.save(
      cola.create({
        usuario_id: usuario.id,
        mensaje: texto,
        telefono_destino: '+5491100000000', // TODO: resolver destino desde env/config del gateway
      }),
    );

    res.status(201).json({ id: registro.id, estado: registro.estado });
  },
);
