import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from './src/hooks/useAuth';
import { useOfflineSync } from './src/hooks/useOfflineSync';
import { LoginScreen } from './src/components/LoginScreen';
import { EvacuationMap } from './src/components/EvacuationMap';
import { SOSButton } from './src/components/SOSButton';
import { obtenerCapas, CapaGeografica } from './src/services/geoService';

/**
 * SHIELD — raíz de la app.
 *
 * Composición:
 *  - `useAuth`      : sesión OIDC + caché offline del token.
 *  - `useOfflineSync`: tracking GPS, cola SQLite, NetInfo, fallback SMS.
 *  - `EvacuationMap`: mapa con zonas anegadas, refugios y ruta segura (Turf).
 */
export default function App() {
  const { usuario, cargando, error, login, logout } = useAuth();
  const { estado, permitidoUbicacion, ultimaUbicacion, enviarSos, forzarSincronizacion } =
    useOfflineSync();

  const [capas, setCapas] = useState<CapaGeografica>({
    alertas: null,
    refugios: [],
    desdeCache: true,
    actualizadoEn: null,
  });
  const [cooldown, setCooldown] = useState(0);

  // Carga inicial (y revalidación) de capas geográficas.
  useEffect(() => {
    if (!usuario) return;
    void obtenerCapas().then(setCapas);
  }, [usuario]);

  // Cuenta regresiva anti-abuso del botón SOS.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleSos = useCallback(async () => {
    try {
      await enviarSos();
      setCooldown(60);
    } catch (err) {
      Alert.alert('SOS', err instanceof Error ? err.message : 'No se pudo emitir el SOS.');
    }
  }, [enviarSos]);

  const bannerRed = useMemo(() => {
    if (!estado) return null;
    if (!estado.red.isConnected) {
      return `Sin conexión · ${estado.pendientes} evento(s) guardados localmente${
        estado.minutosOffline > 0 ? ` · ${estado.minutosOffline} min offline` : ''
      }`;
    }
    if (estado.pendientes > 0) {
      return `Sincronizando · ${estado.pendientes} pendiente(s)`;
    }
    return 'Conectado · datos al día';
  }, [estado]);

  if (!usuario) {
    return (
      <SafeAreaView style={styles.fondoOscuro}>
        <StatusBar style="light" />
        <LoginScreen
          onLogin={login}
          usuario={null}
          error={error}
          cargando={cargando}
          onContinuarOffline={undefined}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.encabezado}>
        <View>
          <Text style={styles.saludo}>
            Hola, {usuario.nombre}
          </Text>
          <Text style={styles.subSaludo}>
            {usuario.rol === 'ciudadano' ? 'Evacuación asistida' : `Modo ${usuario.rol}`}
          </Text>
        </View>
        <Text onPress={logout} style={styles.salir}>
          Salir
        </Text>
      </View>

      <View
        style={[
          styles.banner,
          estado?.red.isConnected ? styles.bannerOk : styles.bannerOffline,
        ]}
      >
        <Text style={styles.bannerTexto}>{bannerRed}</Text>
      </View>

      {!permitidoUbicacion ? (
        <View style={styles.avisoPermiso}>
          <Text style={styles.avisoTexto}>
            Concede permiso de ubicación para el guiado y la búsqueda y rescate.
          </Text>
        </View>
      ) : null}

      <View style={styles.mapaWrapper}>
        <EvacuationMap
          ubicacionUsuario={ultimaUbicacion}
          refugios={capas.refugios}
          alertas={capas.alertas}
          refugioAsignadoId={usuario.refugio_asignado_id}
          urlTilesOffline={null}
        />
      </View>

      <ScrollView contentContainerStyle={styles.pie}>
        <SOSButton
          onPress={handleSos}
          deshabilitado={!permitidoUbicacion}
          cooldownSegundos={cooldown}
        />
        <Text onPress={forzarSincronizacion} style={styles.reintentar}>
          Reintentar sincronización ahora
        </Text>
        <Text style={styles.meta}>
          Capas {capas.desdeCache ? 'cacheadas' : 'actualizadas'}
          {capas.actualizadoEn
            ? ` · ${new Date(capas.actualizadoEn).toLocaleString('es-AR')}`
            : ''}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ECEFF1' },
  fondoOscuro: { flex: 1, backgroundColor: '#0D47A1' },
  encabezado: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0D47A1',
  },
  saludo: { color: '#fff', fontSize: 18, fontWeight: '700' },
  subSaludo: { color: '#BBDEFB', fontSize: 12 },
  salir: { color: '#90CAF9', fontSize: 13 },
  banner: { paddingHorizontal: 16, paddingVertical: 6 },
  bannerOk: { backgroundColor: '#C8E6C9' },
  bannerOffline: { backgroundColor: '#FFE0B2' },
  bannerTexto: { fontSize: 12, color: '#37474F' },
  avisoPermiso: { backgroundColor: '#FFF3E0', padding: 12 },
  avisoTexto: { fontSize: 12, color: '#E65100' },
  mapaWrapper: { flex: 1, minHeight: 300 },
  pie: { padding: 16, alignItems: 'center' },
  reintentar: { color: '#1565C0', fontSize: 13, marginTop: 8, textDecorationLine: 'underline' },
  meta: { color: '#78909C', fontSize: 11, marginTop: 8, textAlign: 'center' },
});
