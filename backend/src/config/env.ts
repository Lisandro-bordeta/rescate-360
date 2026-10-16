/**
 * Variables de entorno de la API SHIELD.
 * En producción proveer todos los valores mediante el entorno del contenedor.
 */
const required = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Falta variable de entorno requerida: ${key}`);
  }
  return value;
};

export const env = {
  PORT: Number(process.env.PORT || 3001),
  NODE_ENV: (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test',
  DATABASE_URL: required('DATABASE_URL'),
  JWT_SECRET: required('JWT_SECRET'),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',

  // Mi Argentina - OIDC / AUTENTICAR
  MI_ARGENTINA_ISSUER: process.env.MI_ARGENTINA_ISSUER || 'https://auth.miargentina.gob.ar',
  MI_ARGENTINA_CLIENT_ID: process.env.MI_ARGENTINA_CLIENT_ID || '',
  MI_ARGENTINA_JWKS_URI:
    process.env.MI_ARGENTINA_JWKS_URI ||
    'https://auth.miargentina.gob.ar/.well-known/jwks.json',

  // Tiempo real y notificaciones
  SOCKET_IO_CORS_ORIGIN: process.env.SOCKET_IO_CORS_ORIGIN || '*',
  FCM_SERVER_KEY: process.env.FCM_SERVER_KEY || '',

  // Canal de emergencia SMS
  SMS_GATEWAY_NUMBER: process.env.SMS_GATEWAY_NUMBER || '+5491100000000',
  SMS_PROVIDER: process.env.SMS_PROVIDER || 'twilio', // twilio | gsm-modem | mock
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
  TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER || '',
  /** Endpoint HTTP del servicio local del modem GSM gubernamental (SMS_PROVIDER=gsm-modem). */
  SMS_MODEM_URL: process.env.SMS_MODEM_URL || '',
  /** Intervalo del worker que drena la cola de SMS (ms). */
  SMS_QUEUE_INTERVAL_MS: Number(process.env.SMS_QUEUE_INTERVAL_MS || 15000),

  // Umbrales de resiliencia / búsqueda y rescate
  OFFLINE_IMMOBILE_MINUTES: Number(process.env.OFFLINE_IMMOBILE_MINUTES || 30),
  OFFLINE_SMS_FALLBACK_MINUTES: Number(process.env.OFFLINE_SMS_FALLBACK_MINUTES || 10),
  SAFE_ZONE_BUFFER_METERS: Number(process.env.SAFE_ZONE_BUFFER_METERS || 500),
} as const;
