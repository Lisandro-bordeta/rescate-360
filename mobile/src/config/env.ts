/**
 * Configuración de la app: valores de app.json `extra` (EAS build) con
 * fallbacks de desarrollo. En producción inyectar vía variables de entorno
 * de EAS (expo.extra) sin hardcodear endpoints.
 */
import Constants from 'expo-constants';

interface MiArgentinaConfig {
  issuer: string;
  clientId: string;
  scopes: string[];
}

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiUrl?: string;
  miArgentina?: MiArgentinaConfig;
  smsGatewayNumber?: string;
};

export const config = {
  API_URL: extra.apiUrl ?? 'http://localhost:3001',
  SMS_GATEWAY_NUMBER: extra.smsGatewayNumber ?? '+5491100000000',
  MI_ARGENTINA: {
    issuer: extra.miArgentina?.issuer ?? 'https://auth.miargentina.gob.ar',
    clientId: extra.miArgentina?.clientId ?? 'shield-client-id',
    scopes: extra.miArgentina?.scopes ?? ['openid', 'profile', 'email', 'phone'],
  },
  /** Minutos sin red antes de activar el fallback SMS de emergencia. */
  SMS_FALLBACK_MINUTES: 10,
  /** Intervalo de trazas GPS en segundo plano (ms). */
  TRACKING_INTERVAL_MS: 15_000,
  /** Backoff de sincronización offline. */
  SYNC_BASE_DELAY_MS: 1_000,
  SYNC_MAX_DELAY_MS: 60_000,
  SYNC_MAX_ATTEMPTS: 5,
} as const;

// Endpoints OIDC derivados del issuer (estándar OIDC).
export const OIDC_ENDPOINTS = {
  authorization: `${config.MI_ARGENTINA.issuer}/authorize`,
  token: `${config.MI_ARGENTINA.issuer}/token`,
  revocation: `${config.MI_ARGENTINA.issuer}/revoke`,
} as const;
