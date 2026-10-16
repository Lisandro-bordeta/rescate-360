/** Tipos compartidos entre la app móvil y la API SHIELD. */

export type NivelVulnerabilidad = 'estandar' | 'niño' | 'adulto_mayor' | 'discapacidad';
export type RolUsuario = 'ciudadano' | 'rescatista' | 'admin';

export interface Usuario {
  id: string;
  nombre: string;
  apellido: string;
  rol: RolUsuario;
  nivel_vulnerabilidad: NivelVulnerabilidad;
  refugio_asignado_id: string | null;
}

export interface LoginResponse {
  token: string;
  usuario: Usuario;
}

/** Evento de ubicación tal como se persiste en SQLite y se envía en lote. */
export interface UbicacionEvent {
  secuencia_local: number;
  latitud: number;
  longitud: number;
  precision: number | null;
  bateria: number | null;
  fecha_registro: string; // ISO 8601
  /** true si el usuario presionó SOS; viaja en el mismo lote. */
  es_sos?: boolean;
}

export interface LocationsBatchResponse {
  recibidas: number;
  nuevas: number;
  duplicadas: number;
}

export interface Refugio {
  id: string;
  nombre: string;
  direccion: string | null;
  tipo: 'urbano' | 'rural';
  capacidad: number;
  ocupacion_actual: number;
  ubicacion_lat: number;
  ubicacion_lon: number;
}

export interface AlertaInundacionFeature {
  type: 'Feature';
  id: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  properties: {
    zona: string;
    nivel_agua: number;
    tipo_alerta: 'verde' | 'amarilla' | 'naranja' | 'roja';
    fecha_inicio: string;
  };
}

export interface AlertaInundacionCollection {
  type: 'FeatureCollection';
  features: AlertaInundacionFeature[];
}

export interface ItemPrioridadRescate {
  usuario_id: string;
  nombre: string;
  apellido: string;
  dni: string;
  nivel_vulnerabilidad: NivelVulnerabilidad;
  latitud: number;
  longitud: number;
  ultima_actualizacion: string;
  refugio_asignado: string | null;
  minutos_sin_senal: number;
  fuera_zona_segura: boolean;
  inmovil: boolean;
  prioridad: 'alta' | 'media' | 'baja';
  score: number;
}

export interface PriorityListResponse {
  total: number;
  umbral_buffer_m: number;
  umbral_inmovil_min: number;
  resultados: ItemPrioridadRescate[];
}

/** Estado de la red observado por NetInfo. */
export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  type: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace GeoJSON {
    interface Polygon {
      type: 'Polygon';
      coordinates: number[][][];
    }
    interface MultiPolygon {
      type: 'MultiPolygon';
      coordinates: number[][][][];
    }
  }
}

export {};
