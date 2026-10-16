import 'dotenv/config';
import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { initializeDatabase } from './database/datasource';
import { initSocket } from './realtime/socket';
import { startSmsQueueWorker } from './services/sms-queue.worker';

const bootstrap = async (): Promise<void> => {
  await initializeDatabase();

  const app = createApp();
  const server = http.createServer(app);

  initSocket(server);
  const smsWorker = startSmsQueueWorker();

  server.listen(env.PORT, () => {
    console.log(`[SHIELD] API escuchando en :${env.PORT} (${env.NODE_ENV})`);
  });

  // Graceful shutdown: cerrar conexiones activas antes de salir.
  const shutdown = (signal: string) => {
    console.log(`[SHIELD] Recibido ${signal}, cerrando...`);
    clearInterval(smsWorker);
    server.close(() => process.exit(0));
    // Fuerza salida si hay conexiones colgadas.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

bootstrap().catch((err) => {
  console.error('[SHIELD] Fallo fatal en el arranque:', err);
  process.exit(1);
});
