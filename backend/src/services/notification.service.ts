import { env } from '../config/env';
import { getIo } from '../realtime/socket';

/**
 * Fachada única de notificaciones: WebSocket (Socket.io) + FCM.
 * El WebSocket entrega tiempo real a la app; FCM cubre el caso de app en segundo plano.
 */

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Envía un push FCM (HTTP Legacy API como puente simple).
 * En producción migrar a FCM HTTP v1 con `firebase-admin` y service account.
 */
const sendFcmPush = async (fcmToken: string, payload: PushPayload): Promise<void> => {
  if (!env.FCM_SERVER_KEY) return; // push deshabilitado en este despliegue

  const res = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `key=${env.FCM_SERVER_KEY}`,
    },
    body: JSON.stringify({
      to: fcmToken,
      notification: { title: payload.title, body: payload.body },
      data: payload.data ?? {},
      priority: 'high',
    }),
  });

  if (!res.ok) {
    console.warn(`[Notify] FCM respondió HTTP ${res.status}: ${await res.text()}`);
  }
};

/** Notifica a un usuario por WebSocket y push. */
export const notifyUsuario = async (
  usuarioId: string,
  fcmToken: string | null | undefined,
  payload: PushPayload,
): Promise<void> => {
  getIo()?.to(`usuario:${usuarioId}`).emit('notificacion', payload);
  if (fcmToken) await sendFcmPush(fcmToken, payload);
};

/** Emite un evento a todos los equipos de rescate conectados. */
export const broadcastRescate = <T>(evento: string, data: T): void => {
  getIo()?.to('rol:rescatista').to('rol:admin').emit(evento, data);
};
