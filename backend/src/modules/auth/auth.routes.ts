import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../database/datasource';
import { Usuario, NivelVulnerabilidad } from '../../entities/Usuario';
import { verifyIdToken, MiArgentinaClaims } from '../../utils/oidc';
import { signShieldToken, authenticate } from '../../middleware/auth.middleware';

/**
 * Login SSO con Mi Argentina (OIDC).
 *
 * La app móvil inicia el flujo Authorization Code + PKCE contra el IdP y nos
 * entrega el `id_token` resultante. Este endpoint valida firma/issuer/audience
 * contra los JWKS de AUTENTICAR, sincroniza el perfil y emite el JWT de sesión SHIELD.
 */
export const authRouter = Router();

interface LoginBody {
  id_token: string;
  fcm_token?: string;
  telefono?: string;
}

/** Mapea los claims del IdP a los campos del perfil SHIELD. */
const claimsToProfile = (claims: MiArgentinaClaims): Partial<Usuario> => {
  const profile: Partial<Usuario> = {};

  // El claim exacto del documento depende de los scopes de identidad otorgados.
  const dni = (claims.dni ?? claims.document_number ?? claims['custom:dni']) as string | undefined;
  if (dni) profile.dni = String(dni);

  const nombre = (claims.nombre ?? claims.given_name) as string | undefined;
  if (nombre) profile.nombre = nombre;
  const apellido = (claims.apellido ?? claims.family_name) as string | undefined;
  if (apellido) profile.apellido = apellido;
  if (claims.email) profile.email = String(claims.email);
  if (claims.phone_number) profile.telefono = String(claims.phone_number);

  return profile;
};

authRouter.post('/mi-argentina/login', async (req: Request, res: Response) => {
  const { id_token, fcm_token, telefono } = req.body as LoginBody;

  if (!id_token || typeof id_token !== 'string') {
    res.status(400).json({ error: 'id_token requerido.' });
    return;
  }

  try {
    const claims = await verifyIdToken(id_token);
    const repo = AppDataSource.getRepository(Usuario);

    let usuario = await repo.findOneBy({ sub_mi_arg: claims.sub });
    const profile = claimsToProfile(claims);

    if (!usuario) {
      usuario = repo.create({
        sub_mi_arg: claims.sub,
        dni: profile.dni ?? `PEND-${claims.sub.slice(0, 12)}`,
        nombre: profile.nombre ?? 'Sin nombre',
        apellido: profile.apellido ?? 'Sin apellido',
        email: profile.email ?? null,
        telefono: telefono ?? profile.telefono ?? null,
        nivel_vulnerabilidad: 'estandar' as NivelVulnerabilidad,
        rol: 'ciudadano',
        activo: true,
      });
    } else {
      // Sincronización de atributos de identidad en cada login.
      Object.assign(usuario, {
        nombre: profile.nombre ?? usuario.nombre,
        apellido: profile.apellido ?? usuario.apellido,
        email: profile.email ?? usuario.email,
        telefono: telefono ?? profile.telefono ?? usuario.telefono,
      });
    }

    if (fcm_token) usuario.fcm_token = fcm_token;
    usuario = await repo.save(usuario);

    const token = signShieldToken({
      id: usuario.id,
      rol: usuario.rol,
      nivel_vulnerabilidad: usuario.nivel_vulnerabilidad,
    });

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        rol: usuario.rol,
        nivel_vulnerabilidad: usuario.nivel_vulnerabilidad,
        refugio_asignado_id: usuario.refugio_asignado_id ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error de autenticación.';
    console.warn('[Auth] Login OIDC rechazado:', message);
    res.status(401).json({ error: message });
  }
});

/** Perfil del usuario autenticado (útil para rehidratar sesión offline). */
authRouter.get('/me', authenticate, async (req: Request, res: Response) => {
  const usuario = await AppDataSource.getRepository(Usuario).findOneBy({
    id: req.user!.id,
    activo: true,
  });
  if (!usuario) {
    res.status(404).json({ error: 'Usuario no encontrado.' });
    return;
  }
  res.json({
    id: usuario.id,
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    rol: usuario.rol,
    nivel_vulnerabilidad: usuario.nivel_vulnerabilidad,
    refugio_asignado_id: usuario.refugio_asignado_id ?? null,
  });
});
