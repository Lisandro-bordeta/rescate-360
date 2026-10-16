import { useCallback, useEffect, useState } from 'react';
import { restoreSession, signIn, signOut } from '../services/authService';
import type { Usuario } from '../types';

/**
 * Hook de sesión: rehidrata el token cacheado (modo offline de emergencia) y
 * expone `login` / `logout`. El token vive en SecureStore, así que sobrevive
 * reinicios de la app sin red.
 */
export const useAuth = () => {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const sesion = await restoreSession();
        if (sesion) setUsuario(sesion.usuario);
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  const login = useCallback(async () => {
    setError(null);
    try {
      const sesion = await signIn();
      if (sesion) setUsuario(sesion.usuario);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut();
    setUsuario(null);
  }, []);

  return { usuario, cargando, error, login, logout };
};
