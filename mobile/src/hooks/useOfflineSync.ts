import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { AppState } from 'react-native';
import { syncService, SyncEstado } from '../services/syncService';
import { config } from '../config/env';

/**
 * Hook de captura de ubicación + sincronización offline.
 *
 * - Arranca `SyncService` (NetInfo + cola SQLite).
 * - Toma una traza GPS cada TRACKING_INTERVAL_MS y la encola localmente.
 * - Expone el estado de red / pendientes y las acciones SOS.
 *
 * Nota de producción: para tracking en segundo plano usar
 * `expo-location` `startLocationUpdatesAsync` con TaskManager; aquí se
 * usa un intervalo en primer plano para mantener el ejemplo portable.
 */
export const useOfflineSync = () => {
  const [estado, setEstado] = useState<SyncEstado | null>(null);
  const [permitido, setPermitido] = useState(false);
  const [ultimaUbicacion, setUltimaUbicacion] = useState<{
    latitud: number;
    longitud: number;
  } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const capturar = useCallback(async () => {
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const nivel = await Battery.getBatteryLevelAsync().catch(() => -1);

      setUltimaUbicacion({ latitud: pos.coords.latitude, longitud: pos.coords.longitude });

      await syncService.captureLocation({
        latitud: pos.coords.latitude,
        longitud: pos.coords.longitude,
        precision: pos.coords.accuracy,
        bateria: nivel >= 0 ? Math.round(nivel * 100) : null,
      });
    } catch (err) {
      console.warn('[Tracking] No se pudo obtener ubicación:', err);
    }
  }, []);

  useEffect(() => {
    let activo = true;

    void (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (!activo) return;
      const ok = status === 'granted';
      setPermitido(ok);
      if (!ok) return;

      syncService.start();
      await capturar();
      intervalRef.current = setInterval(() => void capturar(), config.TRACKING_INTERVAL_MS);
    })();

    const unsubscribe = syncService.subscribe(setEstado);

    // Reanudar la captura al volver del background (y forzar un flush).
    const subAppState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void capturar();
        void syncService.flush();
      }
    });

    return () => {
      activo = false;
      unsubscribe();
      subAppState.remove();
      if (intervalRef.current) clearInterval(intervalRef.current);
      syncService.stop();
    };
  }, [capturar]);

  const enviarSos = useCallback(async (mensaje?: string) => {
    await syncService.triggerSos(mensaje);
  }, []);

  const forzarSincronizacion = useCallback(async () => {
    await syncService.flush();
  }, []);

  return { estado, permitidoUbicacion: permitido, ultimaUbicacion, enviarSos, forzarSincronizacion };
};
