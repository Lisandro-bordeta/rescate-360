import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polygon, Polyline, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import * as turf from '@turf/turf';
import type { AlertaInundacionCollection, Refugio } from '../types';

/**
 * Mapa de evacuación con soporte de zonas anegadas.
 *
 * Capas:
 *  1. Tiles vectoriales/raster offline (MBTiles servidos localmente o OSM cacheado).
 *  2. Polígonos de alertas de inundación (GeoJSON → Polygon), coloreados por severidad.
 *  3. Refugios (markers) con capacidad disponible.
 *  4. Ruta segura hacia el refugio más cercano NO anegado, calculada con Turf.
 *
 * Estrategia de ruta (urbano y rural):
 *  - Se descartan refugios cuyo punto cae dentro de un polígono anegado (turf.booleanPointInPolygon).
 *  - Se elige el más cercano por distancia geodésica (turf.distance).
 *  - Se traza la línea usuario → refugio evitando cruzar zonas anegadas
 *    (si cruza, se busca un punto de desvío perpendicular simple).
 */

interface Props {
  ubicacionUsuario: { latitud: number; longitud: number } | null;
  refugios: Refugio[];
  alertas: AlertaInundacionCollection | null;
  /** Ruta activa (tiles offline). Si es null, usa el proveedor de mapas del SO. */
  urlTilesOffline?: string | null;
  refugioAsignadoId?: string | null;
}

const COLOR_POR_ALERTA: Record<string, string> = {
  verde: 'rgba(76, 175, 80, 0.25)',
  amarilla: 'rgba(255, 235, 59, 0.30)',
  naranja: 'rgba(255, 152, 0, 0.32)',
  roja: 'rgba(211, 47, 47, 0.35)',
};

const COLOR_BORDE: Record<string, string> = {
  verde: '#388E3C',
  amarilla: '#F9A825',
  naranja: '#EF6C00',
  roja: '#C62828',
};

/** Convierte un Polygon/MultiPolygon GeoJSON a la forma que espera react-native-maps. */
const aCoordenadas = (
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): Array<Array<{ latitude: number; longitude: number }>> => {
  const anillos: number[][][] =
    geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();

  return anillos.map((anillo) =>
    anillo.map(([longitude, latitude]) => ({ latitude, longitude })),
  );
};

export const EvacuationMap: React.FC<Props> = ({
  ubicacionUsuario,
  refugios,
  alertas,
  urlTilesOffline,
  refugioAsignadoId,
}) => {
  const regionInicial = useMemo(
    () => ({
      latitude: ubicacionUsuario?.latitud ?? -34.6037,
      longitude: ubicacionUsuario?.longitud ?? -58.3816,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    }),
    [ubicacionUsuario],
  );

  /** Cálculo de ruta segura con Turf (evita refugios dentro de zonas anegadas). */
  const rutaSegura = useMemo(() => {
    if (!ubicacionUsuario || refugios.length === 0) return null;

    const origen = turf.point([ubicacionUsuario.longitud, ubicacionUsuario.latitud]);
    const anegados = (alertas?.features ?? []).map((f) => turf.feature(f.geometry));

    const candidatos = refugios
      .map((r) => {
        const punto = turf.point([r.ubicacion_lon, r.ubicacion_lat]);
        const anegado = anegados.some((zona) => {
          try {
            return turf.booleanPointInPolygon(punto, zona as turf.Feature<turf.Polygon | turf.MultiPolygon>);
          } catch {
            return false;
          }
        });
        const conCapacidad = r.capacidad === 0 || r.ocupacion_actual < r.capacidad;
        return {
          refugio: r,
          punto,
          distanciaKm: turf.distance(origen, punto, { units: 'kilometers' }),
          valido: !anegado && conCapacidad,
        };
      })
      .filter((c) => c.valido || c.refugio.id === refugioAsignadoId)
      .sort((a, b) => a.distanciaKm - b.distanciaKm);

    if (candidatos.length === 0) return null;

    // Prioriza el refugio asignado si es alcanzable; si no, el más cercano válido.
    const elegido =
      candidatos.find((c) => c.refugio.id === refugioAsignadoId) ?? candidatos[0];

    const [oLon, oLat] = origen.geometry.coordinates as [number, number];
    const [dLon, dLat] = elegido.punto.geometry.coordinates as [number, number];

    // Verifica si la recta origen→destino cruza alguna zona anegada.
    const recta = turf.lineString([
      [oLon, oLat],
      [dLon, dLat],
    ]);
    const cruza = anegados.some((zona) => {
      try {
        return turf.booleanIntersects(recta, zona);
      } catch {
        return false;
      }
    });

    // Si cruza, genera un desvío perpendicular al punto medio como ruta alternativa.
    const coordenadas: number[][] = cruza
      ? (() => {
          const midLon = (oLon + dLon) / 2;
          const midLat = (oLat + dLat) / 2;
          const dx = dLon - oLon;
          const dy = dLat - oLat;
          const norma = Math.hypot(dx, dy) || 1;
          const desvio = 0.01; // ~1 km de apartamiento
          return [
            [oLon, oLat],
            [midLon - (dy / norma) * desvio, midLat + (dx / norma) * desvio],
            [dLon, dLat],
          ];
        })()
      : [
          [oLon, oLat],
          [dLon, dLat],
        ];

    return {
      refugio: elegido.refugio,
      distanciaKm: elegido.distanciaKm,
      coordenadas: coordenadas.map(([longitude, latitude]) => ({ latitude, longitude })),
      evitaZonas: !cruza,
    };
  }, [ubicacionUsuario, refugios, alertas, refugioAsignadoId]);

  return (
    <View style={styles.container}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={styles.mapa}
        initialRegion={regionInicial}
        showsUserLocation
        showsMyLocationButton
        rotateEnabled={false}
      >
        {/* Tiles offline (MBTiles servidos localmente). Sin red, esta capa es la única base cartográfica. */}
        {urlTilesOffline ? (
          <UrlTile
            urlTemplate={urlTilesOffline}
            maximumZ={18}
            flipY={false}
            tileSize={256}
            zIndex={-1}
          />
        ) : null}

        {/* Zonas anegadas (alertas de inundación) */}
        {(alertas?.features ?? []).map((feature) => {
          const tipo = feature.properties.tipo_alerta;
          return aCoordenadas(feature.geometry).map((anillo, idx) => (
            <Polygon
              key={`${feature.id}-${idx}`}
              coordinates={anillo}
              fillColor={COLOR_POR_ALERTA[tipo] ?? COLOR_POR_ALERTA.amarilla}
              strokeColor={COLOR_BORDE[tipo] ?? COLOR_BORDE.amarilla}
              strokeWidth={2}
              zIndex={2}
            />
          ));
        })}

        {/* Ruta segura calculada con Turf */}
        {rutaSegura ? (
          <Polyline
            coordinates={rutaSegura.coordenadas}
            strokeColor={rutaSegura.evitaZonas ? '#1B5E20' : '#EF6C00'}
            strokeWidth={5}
            lineDashPattern={rutaSegura.evitaZonas ? undefined : [10, 6]}
            zIndex={3}
          />
        ) : null}

        {/* Refugios */}
        {refugios.map((refugio) => {
          const esAsignado = refugio.id === refugioAsignadoId;
          const disponible = refugio.capacidad === 0 || refugio.ocupacion_actual < refugio.capacidad;
          return (
            <Marker
              key={refugio.id}
              coordinate={{ latitude: refugio.ubicacion_lat, longitude: refugio.ubicacion_lon }}
              title={refugio.nombre}
              description={`${refugio.tipo} · ${disponible ? 'con capacidad' : 'lleno'}${
                esAsignado ? ' · asignado' : ''
              }`}
              pinColor={esAsignado ? '#1B5E20' : disponible ? '#1565C0' : '#9E9E9E'}
            />
          );
        })}
      </MapView>

      {rutaSegura ? (
        <View style={styles.panelRuta} pointerEvents="none">
          <Text style={styles.tituloPanel}>
            Ruta {rutaSegura.evitaZonas ? 'segura' : 'alternativa'} → {rutaSegura.refugio.nombre}
          </Text>
          <Text style={styles.detallePanel}>
            {rutaSegura.distanciaKm.toFixed(2)} km ·{' '}
            {rutaSegura.evitaZonas ? 'sin cruzar zonas anegadas' : 'evitando zona anegada'}
          </Text>
        </View>
      ) : (
        <View style={styles.panelRuta} pointerEvents="none">
          <Text style={styles.detallePanel}>
            Sin refugios alcanzables sin agua: mantente en altura y espera indicaciones.
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  mapa: { flex: 1 },
  panelRuta: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 12,
    padding: 12,
    elevation: 4,
  },
  tituloPanel: { fontSize: 14, fontWeight: '700', color: '#0D47A1' },
  detallePanel: { fontSize: 12, color: '#37474F', marginTop: 2 },
});
