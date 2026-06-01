import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { AuthUser } from '../lib/auth-middleware.js';
import { dispatchEvent } from '../routes/notifications.js';

let io: Server | null = null;

export function initWebSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: config.clientUrl, credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string;
    if (!token) return next(new Error('Unauthorized'));
    try {
      const user = jwt.verify(token, config.jwtSecret) as AuthUser;
      socket.data.user = user;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.user.id}`);
    socket.emit('connected', { userId: socket.data.user.id });

    socket.on('subscribe:camera', (cameraId: string) => {
      socket.join(`camera:${cameraId}`);
    });
  });

  return io;
}

export function emitToAll(event: string, data: object) {
  io?.emit(event, data);
}

export function emitCameraEvent(cameraId: string, event: string, data: object) {
  io?.to(`camera:${cameraId}`).emit(event, data);
  void dispatchEvent(event, { cameraId, ...data });
}

export function simulateMotionEvents() {
  setInterval(() => {
    emitToAll('heartbeat', { ts: Date.now() });
  }, 30000);
}
