import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { api, ApiError } from './api';
import { config } from '../config/env';
import {
  contarPendientes,
  confirmarSosServidor,
  insertarEvento,
  marcarSincronizadas,
  marcarSosEnviadoSms,
  nextSecuenciaLocal,
  obtenerPendientes,
  registrarSos,
  sosSinConfirmar,
  ultimaUbicacionLocal,
} from '../database/localDB';
import { sendSosSms } from './smsService';
import type { LocationsBatchResponse, NetworkStatus, UbicacionEvent } from '../types';

/**
 * SyncService — corazón de la resiliencia offline.
 *
 * Responsabilidades:
 *  1. Detectar pérdida/recuperación de red con NetInfo.
 *  2. Persistir cada traza GPS y evento SOS en SQLite (fuente de verdad local).
 *  3. Drenar la cola con retry + exponential backoff al recuperar conexión.
 *  4. Activar el fallback SMS cuando la pérdida de datos supera el umbral.
 *
 * Diseño sin dependencias de UI: emite estado por callbacks suscribibles.
 */

type Listener = (estado: SyncEstado) => void;

export interface SyncEstado {
  red: NetworkStatus;
  pendientes: number;
  sincronizando: boolean;
  ultimaSincronizacion: string | null;
  ultimoError: string | null;
  /** Minutos acumulados sin red durante la sesión actual. */
  minutosOffline: number;
}

const DISPOSITIVO_ID = `shield-${Math.random().toString(36).slice(2, 10)}`;

export class SyncService {
  private listeners = new Set<Listener>();
  private unsubscribeNet: (() => void) | null = null;
  private estado: SyncEstado = {
    red: { isConnected: true, isInternetReachable: null, type: 'unknown' },
    pendientes: 0,
    sincronizando: false,
    ultimaSincronizacion: null,
    ultimoError: null,
    minutosOffline: 0,
  };

  private offlineDesde: number | null = null;
  private backoffMs = config.SYNC_BASE_DELAY_MS;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  /** Arranca NetInfo y programa el primer drenado. */
  start(): void {
    this.unsubscribeNet = NetInfo.addEventListener(this.onNetInfo);
    void this.refreshPendientes();
  }

  stop(): void {
    this.unsubscribeNet?.();
    this.unsubscribeNet = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.estado);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener({ ...this.estado });
  }

  private get hayRed(): boolean {
    return this.estado.red.isConnected && this.estado.red.isInternetReachable !== false;
  }

  /** Callback de NetInfo: al recuperar red, drena de inmediato. */
  private onNetInfo = (state: NetInfoState): void => {
    const online = state.isConnected === true && state.isInternetReachable !== false;

    this.estado.red = {
      isConnected: state.isConnected === true,
      isInternetReachable: state.isInternetReachable,
      type: state.type,
    };

    if (online) {
      this.offlineDesde = null;
      this.estado.minutosOffline = 0;
      this.backoffMs = config.SYNC_BASE_DELAY_MS;
      void this.flush();
    } else if (this.offlineDesde === null) {
      this.offlineDesde = Date.now();
    }

    this.emit();
  };

  private async refreshPendientes(): Promise<void> {
    this.estado.pendientes = await contarPendientes();
    if (this.offlineDesde) {
      this.estado.minutosOffline = Math.floor((Date.now() - this.offlineDesde) / 60_000);
    }
    this.emit();
  }

  /**
   * Encola una traza GPS localmente. Si no hay red, queda pendiente y
   * el drenado ocurrirá al recuperar conectividad.
   */
  async captureLocation(coords: {
    latitud: number;
    longitud: number;
    precision?: number | null;
    bateria?: number | null;
  }): Promise<void> {
    const secuencia = await nextSecuenciaLocal();
    await insertarEvento({
      secuencia_local: secuencia,
      latitud: coords.latitud,
      longitud: coords.longitud,
      precision: coords.precision ?? null,
      bateria: coords.bateria ?? null,
      fecha_registro: new Date().toISOString(),
      es_sos: false,
    });
    await this.refreshPendientes();
    if (this.hayRed) void this.flush();
  }

  /**
   * Registra un SOS: persiste localmente y dispara el envío inmediato.
   * Si no hay datos, envía el SMS de emergencia de inmediato (sin esperar umbral).
   */
  async triggerSos(mensaje?: string): Promise<void> {
    const ultima = await ultimaUbicacionLocal();
    if (!ultima) throw new Error('Sin ubicación conocida: no se puede emitir el SOS.');

    const secuencia = await nextSecuenciaLocal();
    await insertarEvento({
      secuencia_local: secuencia,
      latitud: ultima.latitud,
      longitud: ultima.longitud,
      precision: null,
      bateria: null,
      fecha_registro: new Date().toISOString(),
      es_sos: true,
    });
    await registrarSos(secuencia, ultima.latitud, ultima.longitud, mensaje);
    await this.refreshPendientes();

    if (this.hayRed) {
      void this.flush();
    } else {
      await this.enviarSosPorSms();
    }
  }

  /** Fuerza el envío por SMS de los SOS no confirmados. */
  async enviarSosPorSms(): Promise<void> {
    const pendientes = await sosSinConfirmar();
    for (const sos of pendientes) {
      const enviado = await sendSosSms({ latitud: sos.latitud, longitud: sos.longitud });
      if (enviado) await marcarSosEnviadoSms(sos.secuencia_local);
    }
  }

  /**
   * Drena la cola de sincronización.
   * - Éxito: marca eventos como sincronizados y resetea el backoff.
   * - Fallo: reprograma con exponential backoff (base 1s, tope 60s) + jitter.
   */
  async flush(): Promise<void> {
    if (this.flushing || !this.hayRed) return;

    const pendientes = await obtenerPendientes(200);
    if (pendientes.length === 0) {
      // Aun sin eventos, verificar SOS que deban confirmarse por datos.
      this.estado.pendientes = 0;
      this.emit();
      return;
    }

    this.flushing = true;
    this.estado.sincronizando = true;
    this.emit();

    try {
      const payload: UbicacionEvent[] = pendientes.map((p) => ({
        secuencia_local: p.secuencia_local,
        latitud: p.latitud,
        longitud: p.longitud,
        precision: p.precision,
        bateria: p.bateria,
        fecha_registro: p.fecha_registro,
        es_sos: p.es_sos,
      }));

      const respuesta = await api.post<LocationsBatchResponse>('/sync/locations-batch', {
        dispositivo_id: DISPOSITIVO_ID,
        ubicaciones: payload,
      });

      await marcarSincronizadas(pendientes.map((p) => p.secuencia_local));
      // Confirmar en el servidor los SOS ya transmitidos por datos.
      await confirmarSosServidor(pendientes.filter((p) => p.es_sos).map((p) => p.secuencia_local));

      this.backoffMs = config.SYNC_BASE_DELAY_MS;
      this.estado.ultimaSincronizacion = new Date().toISOString();
      this.estado.ultimoError = null;
      console.log(`[Sync] Lote enviado: ${respuesta.nuevas} nuevas / ${respuesta.duplicadas} duplicadas`);
    } catch (err) {
      const mensaje = err instanceof ApiError ? `${err.status}: ${err.message}` : String(err);
      this.estado.ultimoError = mensaje;
      console.warn('[Sync] Falló el envío del lote:', mensaje);

      // Backoff exponencial con jitter para evitar thundering herd al reconectar.
      const jitter = Math.random() * 0.3 * this.backoffMs;
      const espera = Math.min(this.backoffMs + jitter, config.SYNC_MAX_DELAY_MS);
      this.backoffMs = Math.min(this.backoffMs * 2, config.SYNC_MAX_DELAY_MS);

      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.flush(), espera);

      // Si la caída supera el umbral, el SMS es el último recurso viable.
      if (this.offlineDesde && (Date.now() - this.offlineDesde) / 60_000 >= config.SMS_FALLBACK_MINUTES) {
        await this.enviarSosPorSms();
      }
    } finally {
      this.flushing = false;
      this.estado.sincronizando = false;
      await this.refreshPendientes();
    }
  }
}

/** Instancia única compartida por toda la app. */
export const syncService = new SyncService();
