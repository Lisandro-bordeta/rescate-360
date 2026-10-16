import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import type { AlertaInundacionCollection, Refugio } from '../types';

/**
 * Servicio geográfico con caché local (offline-first).
 *
 * Estrategia: "stale-while-revalidate" orientada a emergencias.
 *  - Al iniciar, se lee SIEMPRE la caché local (rápido y disponible sin red).
 *  - Si hay red, se revalida contra la API y se actualiza la caché.
 *  - La última capa conocida (aunque esté vieja) es mejor que un mapa vacío
 *    durante una evacuación.
 */

const CACHE_ALERTS = 'shield.cache.alertas';
const CACHE_REFUGIOS = 'shield.cache.refugios';
const CACHE_TS = 'shield.cache.timestamp';

export interface CapaGeografica {
  alertas: AlertaInundacionCollection | null;
  refugios: Refugio[];
  /** true si los datos provienen de la caché (sin red o fallo de API). */
  desdeCache: boolean;
  actualizadoEn: string | null;
}

interface CachePayload {
  alertas: AlertaInundacionCollection | null;
  refugios: Refugio[];
  actualizadoEn: string;
}

const leerCache = async (): Promise<CachePayload | null> => {
  const [alertasRaw, refugiosRaw, ts] = await AsyncStorage.multiGet([
    CACHE_ALERTS,
    CACHE_REFUGIOS,
    CACHE_TS,
  ]);

  const alertas = alertasRaw[1] ? (JSON.parse(alertasRaw[1]) as AlertaInundacionCollection) : null;
  const refugios = refugiosRaw[1] ? (JSON.parse(refugiosRaw[1]) as Refugio[]) : [];
  if (!alertas && refugios.length === 0) return null;

  return { alertas, refugios, actualizadoEn: ts[1] ?? new Date(0).toISOString() };
};

const escribirCache = async (payload: CachePayload): Promise<void> => {
  await AsyncStorage.multiSet([
    [CACHE_ALERTS, JSON.stringify(payload.alertas)],
    [CACHE_REFUGIOS, JSON.stringify(payload.refugios)],
    [CACHE_TS, payload.actualizadoEn],
  ]);
};

/**
 * Devuelve las capas geográficas (alertas + refugios).
 * `ubicacion` opcional filtra refugios por cercanía para acotar la descarga.
 */
export const obtenerCapas = async (
  ubicacion?: { latitud: number; longitud: number },
): Promise<CapaGeografica> => {
  const cache = await leerCache();

  try {
    const queryRefugios = ubicacion
      ? `/shelters?cerca=${ubicacion.latitud},${ubicacion.longitud}&radio_km=25`
      : '/shelters';

    const [alertas, refugiosResp] = await Promise.all([
      api.get<AlertaInundacionCollection>('/alerts/active'),
      api.get<{ total: number; resultados: Refugio[] }>(queryRefugios),
    ]);

    const actualizadoEn = new Date().toISOString();
    await escribirCache({ alertas, refugios: refugiosResp.resultados, actualizadoEn });

    return {
      alertas,
      refugios: refugiosResp.resultados,
      desdeCache: false,
      actualizadoEn,
    };
  } catch (err) {
    console.warn('[Geo] Sin red o API caída, usando caché local:', err);
    if (cache) {
      return {
        alertas: cache.alertas,
        refugios: cache.refugios,
        desdeCache: true,
        actualizadoEn: cache.actualizadoEn,
      };
    }
    return { alertas: null, refugios: [], desdeCache: true, actualizadoEn: null };
  }
};

/** Limpia la caché geográfica (p. ej. al cerrar sesión o forzar recalibración). */
export const limpiarCacheGeografica = async (): Promise<void> => {
  await AsyncStorage.multiRemove([CACHE_ALERTS, CACHE_REFUGIOS, CACHE_TS]);
};
