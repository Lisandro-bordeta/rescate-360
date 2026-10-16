import { Server as HttpServer } from 'http';
import { Server as SocketIoServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

/**
 * Canal de tiempo real (Socket.io).
 * Canales:
 *  - `usuario:<id>`  → alertas y asignaciones dirigidas a un ciudadano.
 *  - `rol:rescatista` / `rol:admin` → actualizaciones de la cola de rescate y SOS.
 */
let io: SocketIoServer | null = null;

export const initSocket = (httpServer: HttpServer): SocketIoServer => {
  io = new SocketIoServer(httpServer, {
    cors: { origin: env.SOCKET_IO_CORS_ORIGIN.split(','), methods: ['GET', 'POST'] },
  });

  // Autenticación por JWT de sesión SHIELD en el handshake.
  io.use((socket: Socket, next) => {
    const token = (socket.handshake.auth as { token?: string })?.token;
    if (!token) return next(new Error('Token requerido'));

    try {
      const payload = jwt.verify(token, env.JWT_SECRET, {
        issuer: 'shield-api',
        audience: 'shield-app',
      }) as jwt.JwtPayload;
      socket.data.usuarioId = payload.sub;
      socket.data.rol = payload.rol;
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const { usuarioId, rol } = socket.data as { usuarioId: string; rol: string };
    socket.join(`usuario:${usuarioId}`);
    if (rol === 'rescatista' || rol === 'admin') {
      socket.join(`rol:${rol}`);
    }
    socket.on('disconnect', () => socket.removeAllListeners());
  });

  return io;
};

export const getIo = (): SocketIoServer | null => io;
