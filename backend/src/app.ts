import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { env } from './config/env';
import { authRouter } from './modules/auth/auth.routes';
import { syncRouter } from './modules/sync/sync.routes';
import { rescueRouter } from './modules/rescue/rescue.routes';
import { alertsRouter } from './modules/alerts/alerts.routes';
import { sheltersRouter } from './modules/shelters/shelters.routes';

/** Construcción de la app Express (sin levantar el servidor HTTP: ver server.ts). */
export const createApp = (): Express => {
  const app = express();

  app.use(cors({ origin: env.SOCKET_IO_CORS_ORIGIN.split(','), methods: ['GET', 'POST', 'PATCH'] }));
  // Límite generoso para lotes offline (≈1000 trazas por request).
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', env: env.NODE_ENV, ts: new Date().toISOString() });
  });

  app.use('/auth', authRouter);
  app.use('/sync', syncRouter);
  app.use('/rescue', rescueRouter);
  app.use('/alerts', alertsRouter);
  app.use('/shelters', sheltersRouter);

  // Manejador global de errores: nunca filtrar stack traces al cliente en producción.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[API] Error no controlado:', err);
    res.status(500).json({
      error: env.NODE_ENV === 'production' ? 'Error interno.' : err.message,
    });
  });

  return app;
};
