import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthRequest } from '../../../middleware/auth.middleware';

export class AuthController {
  private readonly authService = new AuthService();

  loginWithMiArgentina = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id_token, access_token } = req.body;
      if (!id_token) {
        res.status(400).json({ error: 'id_token requerido' });
        return;
      }

      const profile = this.authService.validateMiArgentinaIdToken(id_token);
      // access_token podría usarse para consultar endpoints de usuario de Mi Argentina (opcional).
      void access_token;

      const usuario = await this.authService.findOrCreateUsuario(profile);
      const token = this.authService.issueShieldToken(usuario);

      res.json({
        token,
        expires_in: 8 * 60 * 60,
        usuario: {
          id: usuario.id,
          dni: usuario.dni,
          nombre: usuario.nombre,
          apellido: usuario.apellido,
          email: usuario.email,
          telefono: usuario.telefono,
          rol: usuario.rol,
          nivel_vulnerabilidad: usuario.nivel_vulnerabilidad,
          refugio_asignado_id: usuario.refugio_asignado_id,
        },
      });
    } catch (err) {
      res.status(401).json({
        error: 'Fallo en autenticación con Mi Argentina',
        detalle: err instanceof Error ? err.message : String(err),
      });
    }
  };

  me = (req: AuthRequest, res: Response): void => {
    if (!req.usuario) {
      res.status(401).json({ error: 'No autenticado' });
      return;
    }
    res.json({ usuario: req.usuario });
  };
}
