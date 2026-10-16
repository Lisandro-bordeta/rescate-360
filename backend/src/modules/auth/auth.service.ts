import { AppDataSource } from '../../../database/datasource';
import { Usuario } from '../../../entities/Usuario';
import jwt from 'jsonwebtoken';
import { env } from '../../../config/env';

export interface MiArgentinaProfile {
  sub: string;
  dni?: string;
  email?: string;
  nombre?: string;
  apellido?: string;
  telefono?: string;
}

/**
 * Servicio de autenticación federada con Mi Argentina (AUTENTICAR - OIDC).
 *
 * NOTA DE PRODUCCIÓN: este es el esqueleto. El `id_token` de Mi Argentina debe
 * verificarse firmando contra los JWKS publicados por Mi Argentina
 * (MI_ARGENTINA_JWKS_URI), validando issuer, audience, expiration y nonce.
 * Se recomienda la librería `jwks-rsa` + `jsonwebtoken`. Aquí se decodifica
 * sin verificar firma solo como esqueleto de integración.
 */
export class AuthService {
  private readonly usuarioRepo = AppDataSource.getRepository(Usuario);

  /**
   * Decodifica y valida estructuralmente el ID token de Mi Argentina.
   */
  validateMiArgentinaIdToken(idToken: string): MiArgentinaProfile {
    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded || typeof decoded !== 'object') {
      throw new Error('ID token mal formado');
    }
    const payload = (decoded as { payload: Record<string, unknown> }).payload;
    const iss = payload.iss;
    if (iss && iss !== env.MI_ARGENTINA_ISSUER) {
      throw new Error(`Issuer no confiable: ${iss}`);
    }
    const exp = payload.exp as number | undefined;
    if (exp && Date.now() >= exp * 1000) {
      throw new Error('ID token expirado');
    }

    return {
      sub: String(payload.sub || ''),
      dni: payload.dni ? String(payload.dni) : undefined,
      email: payload.email ? String(payload.email) : undefined,
      nombre: payload.given_name ? String(payload.given_name) : undefined,
      apellido: payload.family_name ? String(payload.family_name) : undefined,
      telefono: payload.phone_number ? String(payload.phone_number) : undefined,
    };
  }

  /**
   * Crea o recupera el usuario local a partir del perfil de Mi Argentina.
   */
  async findOrCreateUsuario(profile: MiArgentinaProfile): Promise<Usuario> {
    if (!profile.sub) {
      throw new Error('Perfil de Mi Argentina sin subject (sub)');
    }

    let usuario = await this.usuarioRepo.findOneBy({ sub_mi_arg: profile.sub });

    if (!usuario) {
      const dni = profile.dni || `MIARG-${profile.sub.slice(0, 12)}`;
      usuario = this.usuarioRepo.create({
        dni,
        nombre: profile.nombre || 'Usuario',
        apellido: profile.apellido || 'Mi Argentina',
        email: profile.email,
        telefono: profile.telefono,
        sub_mi_arg: profile.sub,
        nivel_vulnerabilidad: 'estandar',
        rol: 'ciudadano',
        activo: true,
      });
      await this.usuarioRepo.save(usuario);
    }

    return usuario;
  }

  /**
   * Emite el JWT de sesión SHIELD.
   */
  issueShieldToken(usuario: Usuario): string {
    return jwt.sign(
      {
        sub: usuario.id,
        dni: usuario.dni,
        rol: usuario.rol,
        nivel_vulnerabilidad: usuario.nivel_vulnerabilidad,
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN, subject: usuario.id, audience: 'shield-mobile' }
    );
  }
}
