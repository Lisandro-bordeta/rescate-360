import { AppDataSource } from '../database/datasource';
import { ColaSmsSos } from '../entities/ColaSmsSos';
import { sendSms } from './sms.gateway';
import { env } from '../config/env';
import { broadcastRescate } from './notification.service';

/**
 * Worker que drena `cola_sms_sos`:
 *  - envía cada SMS pendiente por el gateway configurado,
 *  - aplica exponential backoff en reintentos (duplica por `intentos`),
 *  - marca `fallido` al superar `max_intentos`,
 *  - notifica a los equipos de rescate de cada SOS confirmado.
 *
 * El intervalo se configura con SMS_QUEUE_INTERVAL_MS (default 15s).
 */
export const startSmsQueueWorker = (): NodeJS.Timeout => {
  const interval = setInterval(() => {
    void drainSmsQueue();
  }, env.SMS_QUEUE_INTERVAL_MS);

  // No bloquear el shutdown del proceso.
  interval.unref?.();
  return interval;
};

export const drainSmsQueue = async (): Promise<void> => {
  const repo = AppDataSource.getRepository(ColaSmsSos);

  const pendientes = await repo.find({
    where: { estado: 'pendiente' },
    order: { creado_en: 'ASC' },
    take: 50,
  });

  for (const sms of pendientes) {
    // Backoff: reintentos espaciados ~ (2^intentos) * 15s, respetando el worker.
    const esperaMs = 2 ** sms.intentos * env.SMS_QUEUE_INTERVAL_MS;
    if (Date.now() - sms.creado_en.getTime() < esperaMs) continue;

    try {
      await sendSms(sms.telefono_destino, sms.mensaje);
      sms.estado = 'enviado';
      sms.enviado_en = new Date();
      broadcastRescate('sos:confirmado', { id: sms.id, usuario_id: sms.usuario_id });
    } catch (err) {
      sms.intentos += 1;
      sms.ultimo_error = err instanceof Error ? err.message : String(err);
      if (sms.intentos >= sms.max_intentos) {
        sms.estado = 'fallido';
        broadcastRescate('sos:fallo_envio', { id: sms.id, usuario_id: sms.usuario_id });
      }
    }
    await repo.save(sms);
  }
};
