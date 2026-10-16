import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { AuthUser } from '../types/express';
import type { RolUsuario } from '../entities/Usuario';

/** Payload del JWT de sesión SHIELD. */
export interface ShieldJwtPayload extends jwt.JwtPayload {
  sub: string; // usuario.id
  rol: RolUsuario;
  nivel_vulnerabilidad: string;
}

/**
 * Emite el JWT de sesión SHIELD tras un login OIDC exitoso.
 * Válido `JWT_EXPIRES_IN` (default 8h); se cachea en el dispositivo para uso offline.
 */
export const signShieldToken = (user: AuthUser): string =>
  jwt.sign(
    { rol: user.rol, nivel_vulnerabilidad: user.nivel_vulnerabilidad },
    env.JWT_SECRET,
    { subject: user.id, expiresIn: env.JWT_EXPIRES_IN, issuer: 'shield-api', audience: 'shield-app' },
  );

/**
 * Autentica `Authorization: Bearer <JWT>` y adjunta `req.user`.
 * El token de sesión SHIELD es offline-verificable (no requiere roundtrip al IdP).
 */
export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Falta token de acceso (Authorization: Bearer <token>).' });
    return;
  }

  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET, {
      issuer: 'shield-api',
      audience: 'shield-app',
    }) as ShieldJwtPayload;

    req.user = {
      id: payload.sub,
      rol: payload.rol,
      nivel_vulnerabilidad: payload.nivel_vulnerabilidad as AuthUser['nivel_vulnerabilidad'],
    };
    next();
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    res.status(401).json({
      error: expired ? 'Token expirado: reautenticar con Mi Argentina.' : 'Token inválido.',
    });
  }
};

/** Guard de rol para endpoints de operación (búsqueda y rescate, administración). */
export const requireRole =
  (...roles: RolUsuario[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado.' });
      return;
    }
    if (!roles.includes(req.user.rol)) {
      res.status(403).json({ error: 'Permisos insuficientes para este recurso.' });
      return;
    }
    next();
  };
