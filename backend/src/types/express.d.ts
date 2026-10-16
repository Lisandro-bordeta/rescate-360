import type { RolUsuario, NivelVulnerabilidad } from '../entities/Usuario';

/**
 * Usuario autenticado inyectado por el middleware `authenticate`.
 * Se mapea desde el JWT de sesión SHIELD emitido tras validar el OIDC de Mi Argentina.
 */
export interface AuthUser {
  id: string;
  rol: RolUsuario;
  nivel_vulnerabilidad: NivelVulnerabilidad;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
