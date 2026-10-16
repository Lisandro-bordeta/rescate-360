import * as SMS from 'expo-sms';
import { Linking } from 'react-native';
import { config } from '../config/env';

/**
 * Canal de emergencia SMS / Mesh (fallback).
 *
 * Cuando no hay datos (4G/3G/Wi-Fi) se envía un SMS compacto al gateway estatal.
 * Formato del payload (≤ 60 caracteres para caber en cualquier GSM-7 y permitir
 * concatenación en redes mesh):
 *
 *   SHD1;<lat>;<lon>;<bateria>;<ts>
 *
 * - lat/lon con 5 decimales (~1 m) → suficiente para búsqueda y rescate.
 * - ts = epoch en segundos.
 * El gateway decodifica el mensaje y lo inyecta en `cola_sms_sos`.
 */

export interface SmsPayload {
  latitud: number;
  longitud: number;
  bateria?: number | null;
  timestamp?: number;
}

/** Codifica coordenadas a un payload SMS compacto. */
export const encodeSosPayload = (payload: SmsPayload): string => {
  const lat = payload.latitud.toFixed(5);
  const lon = payload.longitud.toFixed(5);
  const bat = payload.bateria ?? -1;
  const ts = payload.timestamp ?? Math.floor(Date.now() / 1000);
  return `SHD1;${lat};${lon};${bat};${ts}`;
};

/** Decodifica un payload SMS (también usado por tests y por el gateway). */
export const decodeSosPayload = (
  body: string,
): { latitud: number; longitud: number; bateria: number | null; timestamp: number } | null => {
  const partes = body.trim().split(';');
  if (partes.length < 5 || partes[0] !== 'SHD1') return null;

  const latitud = Number(partes[1]);
  const longitud = Number(partes[2]);
  const bateria = Number(partes[3]);
  const timestamp = Number(partes[4]);

  if (
    !Number.isFinite(latitud) ||
    !Number.isFinite(longitud) ||
    Math.abs(latitud) > 90 ||
    Math.abs(longitud) > 180
  ) {
    return null;
  }

  return {
    latitud,
    longitud,
    bateria: bateria >= 0 ? bateria : null,
    timestamp: Number.isFinite(timestamp) ? timestamp : Math.floor(Date.now() / 1000),
  };
};

/**
 * Envía el SOS por SMS al gateway estatal.
 * Devuelve true si el SO reportó el envío (o el usuario lo confirmó en el composer).
 * Si `expo-sms` no está disponible (simulador/tablet), cae a un deep link `sms:`.
 */
export const sendSosSms = async (payload: SmsPayload): Promise<boolean> => {
  const body = encodeSosPayload(payload);

  try {
    if (await SMS.isAvailableAsync()) {
      const { result } = await SMS.sendSMSAsync([config.SMS_GATEWAY_NUMBER], body);
      return result === 'sent' || result === 'unknown';
    }
  } catch (err) {
    console.warn('[SMS] Falló el envío nativo, probando deep link:', err);
  }

  const url = `sms:${config.SMS_GATEWAY_NUMBER}?body=${encodeURIComponent(body)}`;
  const soportado = await Linking.canOpenURL('sms:');
  if (soportado) {
    await Linking.openURL(url);
    return true;
  }
  return false;
};
