import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config, OIDC_ENDPOINTS } from '../config/env';
import { api, setAuthToken } from './api';
import type { LoginResponse, Usuario } from '../types';

/**
 * Login SSO con Mi Argentina (OIDC Authorization Code + PKCE).
 *
 * Flujo:
 *  1. `signIn()` arma el AuthRequest con PKCE y los scopes de identidad básica.
 *  2. Mi Argentina autentica y redirige con el authorization code.
 *  3. Se intercambia por `id_token` / `access_token` (expo-auth-session).
 *  4. El `id_token` se valida en la API SHIELD, que devuelve el JWT de sesión.
 *
 * Caché offline del token de sesión:
 *  - SecureStore (Keychain/Keystore): token JWT de sesión SHIELD.
 *  - AsyncStorage: perfil y TTL, para rehidratar UI sin red.
 */

// Completa el intercambio en apps nativas con expo-web-browser.
WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = 'shield.session.jwt';
const USER_KEY = 'shield.session.user';
const REFRESH_HINT_KEY = 'shield.session.refresh_hint';

export const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: OIDC_ENDPOINTS.authorization,
  tokenEndpoint: OIDC_ENDPOINTS.token,
  revocationEndpoint: OIDC_ENDPOINTS.revocation,
};

/** Punto de retorno registrado en el portal de desarrollo de Mi Argentina. */
export const redirectUri = AuthSession.makeRedirectUri({
  scheme: 'shield',
  path: 'auth/callback',
});

let cachedSession: { token: string; usuario: Usuario } | null = null;

const BASE64_ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decodifica base64url sin depender de `atob` (no garantizado en Hermes/RN).
 * Suficiente para leer el claim `exp` de un JWT (no valida firma, eso lo hace el backend).
 */
const base64UrlToString = (input: string): string => {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  let salida = '';
  let buffer = 0;
  let bits = 0;

  for (const char of base64) {
    if (char === '=') break;
    const valor = BASE64_ALFABETO.indexOf(char);
    if (valor < 0) continue;
    buffer = (buffer << 6) | valor;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      salida += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return salida;
};

/** Intercambia el authorization code por tokens y cierra la sesión en la API. */
const completeLogin = async (idToken: string): Promise<{ token: string; usuario: Usuario }> => {
  const respuesta = await api.post<LoginResponse>('/auth/mi-argentina/login', {
    id_token: idToken,
  });

  // Persistencia offline-first: JWT en Keychain/Keystore, perfil en AsyncStorage.
  await SecureStore.setItemAsync(TOKEN_KEY, respuesta.token, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK, // accesible tras boot (contexto de emergencia)
  });
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(respuesta.usuario));

  setAuthToken(respuesta.token);
  cachedSession = respuesta;
  return respuesta;
};

/**
 * Inicia el flujo OIDC completo. Devuelve la sesión SHIELD o null si el
 * usuario canceló. Lanza ApiError si la API rechaza el id_token.
 */
export const signIn = async (): Promise<{ token: string; usuario: Usuario } | null> => {
  const request = new AuthSession.AuthRequest({
    clientId: config.MI_ARGENTINA.clientId,
    scopes: config.MI_ARGENTINA.scopes,
    redirectUri,
    usePKCE: true, // obligatorio en clients públicos (móvil)
    extraParams: { access_type: 'offline' }, // solicita refresh token cuando el IdP lo permite
  });

  const result = await request.promptAsync(discovery, {
    showInRecents: true,
  });

  if (result.type !== 'success' || !result.authentication) {
    return null;
  }

  // Si el IdP entrega directamente un id_token (response_type=id_token), usarlo.
  if (result.authentication.idToken) {
    return completeLogin(result.authentication.idToken);
  }

  // Flujo Authorization Code: intercambiar el code por tokens.
  const tokenResponse = await AuthSession.exchangeCodeAsync(
    {
      clientId: config.MI_ARGENTINA.clientId,
      code: result.params.code,
      redirectUri,
      extraParams: request.codeVerifier
        ? { code_verifier: request.codeVerifier }
        : {},
    },
    discovery,
  );

  if (!tokenResponse.idToken) {
    throw new Error('Mi Argentina no devolvió un id_token (verifique los scopes solicitados).');
  }

  if (tokenResponse.refreshToken) {
    // Guardar hint de refresh (el refresh real requiere otro intercambio OIDC).
    await AsyncStorage.setItem(REFRESH_HINT_KEY, tokenResponse.refreshToken);
  }

  return completeLogin(tokenResponse.idToken);
};

/**
 * Restaura la sesión cacheada sin red (arranque offline en emergencia).
 * El JWT se verifica localmente por expiración; el backend lo valida criptográficamente.
 */
export const restoreSession = async (): Promise<{ token: string; usuario: Usuario } | null> => {
  if (cachedSession) return cachedSession;

  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  const userRaw = await AsyncStorage.getItem(USER_KEY);
  if (!token || !userRaw) return null;

  // Verificación básica de expiración sin red (el payload es un JWT).
  try {
    const payload = JSON.parse(base64UrlToString(token.split('.')[1] ?? '')) as { exp?: number };
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      await signOut();
      return null;
    }
  } catch {
    await signOut();
    return null;
  }

  const usuario = JSON.parse(userRaw) as Usuario;
  setAuthToken(token);
  cachedSession = { token, usuario };
  return cachedSession;
};

/** Limpia la sesión local (tokens y caché). */
export const signOut = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await AsyncStorage.multiRemove([USER_KEY, REFRESH_HINT_KEY]);
  setAuthToken(null);
  cachedSession = null;
};
