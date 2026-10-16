import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Usuario } from '../types';

/**
 * Pantalla de login con Mi Argentina (SSO OIDC).
 * El flujo real lo dispara `useAuth().login` (expo-auth-session + PKCE);
 * este componente solo orquesta la UI y el estado de carga.
 */
interface Props {
  onLogin: () => Promise<void>;
  usuario: Usuario | null;
  error: string | null;
  cargando: boolean;
  onContinuarOffline?: () => void;
}

export const LoginScreen: React.FC<Props> = ({
  onLogin,
  usuario,
  error,
  cargando,
  onContinuarOffline,
}) => {
  const [enviando, setEnviando] = useState(false);

  const vulnerabilidad = useMemo(() => {
    switch (usuario?.nivel_vulnerabilidad) {
      case 'discapacidad':
        return { etiqueta: 'Prioridad alta — Discapacidad', color: '#b71c1c' };
      case 'adulto_mayor':
        return { etiqueta: 'Prioridad alta — Adulto mayor', color: '#e65100' };
      case 'niño':
        return { etiqueta: 'Prioridad alta — Niño/a', color: '#e65100' };
      default:
        return { etiqueta: 'Prioridad estándar', color: '#2e7d32' };
    }
  }, [usuario]);

  const handleLogin = async () => {
    setEnviando(true);
    try {
      await onLogin();
    } finally {
      setEnviando(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>SHIELD</Text>
      <Text style={styles.subtitulo}>
        Respuesta rápida y evacuación ante inundaciones
      </Text>

      {usuario ? (
        <View style={styles.perfil}>
          <Text style={styles.nombre}>
            {usuario.nombre} {usuario.apellido}
          </Text>
          <View style={[styles.badge, { backgroundColor: vulnerabilidad.color }]}>
            <Text style={styles.badgeTexto}>{vulnerabilidad.etiqueta}</Text>
          </View>
        </View>
      ) : (
        <Text style={styles.ayuda}>
          Autenticate con tu identidad de Mi Argentina para recibir alertas,
          refugio asignado y asistencia priorizada.
        </Text>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={({ pressed }) => [styles.botonPrincipal, pressed && styles.botonPresionado]}
        onPress={handleLogin}
        disabled={enviando || cargando}
        accessibilityRole="button"
        accessibilityLabel="Iniciar sesión con Mi Argentina"
      >
        {enviando || cargando ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.botonTexto}>Iniciar sesión con Mi Argentina</Text>
        )}
      </Pressable>

      {onContinuarOffline ? (
        <Pressable onPress={onContinuarOffline} accessibilityRole="button">
          <Text style={styles.enlace}>Continuar sin conexión (modo emergencia)</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0D47A1' },
  titulo: { fontSize: 44, fontWeight: '800', color: '#fff', textAlign: 'center' },
  subtitulo: { fontSize: 15, color: '#bbdefb', textAlign: 'center', marginTop: 8, marginBottom: 32 },
  ayuda: { color: '#e3f2fd', fontSize: 14, textAlign: 'center', marginBottom: 24 },
  perfil: { alignItems: 'center', marginBottom: 24 },
  nombre: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  badge: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  badgeTexto: { color: '#fff', fontSize: 12, fontWeight: '600' },
  error: { color: '#ffcdd2', textAlign: 'center', marginBottom: 16 },
  botonPrincipal: {
    backgroundColor: '#1565C0',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#64B5F6',
  },
  botonPresionado: { opacity: 0.8 },
  botonTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
  enlace: { color: '#90caf9', textAlign: 'center', marginTop: 20, fontSize: 13 },
});
