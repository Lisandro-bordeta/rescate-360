import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  onPress: () => void;
  deshabilitado?: boolean;
  /** Segundos restantes de una cuenta regresiva anti-abuso (evita SOS duplicados). */
  cooldownSegundos?: number;
}

/**
 * Botón SOS: emite la alerta de emergencia.
 * Si no hay conectividad, `SyncService` deriva automáticamente al canal SMS.
 */
export const SOSButton: React.FC<Props> = ({ onPress, deshabilitado, cooldownSegundos = 0 }) => {
  const activo = !deshabilitado && cooldownSegundos === 0;

  return (
    <View style={styles.wrapper}>
      <Pressable
        onPress={onPress}
        disabled={!activo}
        accessibilityRole="button"
        accessibilityLabel="Emitir alerta SOS de emergencia"
        style={({ pressed }) => [
          styles.boton,
          !activo && styles.botonInactivo,
          pressed && activo && styles.botonPresionado,
        ]}
      >
        <Text style={styles.texto}>
          {cooldownSegundos > 0 ? `SOS enviado (${cooldownSegundos}s)` : 'SOS'}
        </Text>
      </Pressable>
      <Text style={styles.leyenda}>Envía tu ubicación al equipo de rescate</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', marginVertical: 12 },
  boton: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: '#D32F2F',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFCDD2',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  botonInactivo: { backgroundColor: '#9E9E9E', borderColor: '#E0E0E0' },
  botonPresionado: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  texto: { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: 2 },
  leyenda: { color: '#B0BEC5', fontSize: 12, marginTop: 10, textAlign: 'center' },
});
