import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from './prisma.js';
import { hasPermission, type Permission } from './permissions.js';
import type { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as AuthUser;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function requirePermission(...perms: Permission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'admin') return next();
    for (const p of perms) {
      if (!hasPermission(req.user.role, p)) {
        return res.status(403).json({ error: 'Forbidden', permission: p });
      }
    }
    next();
  };
}

export async function getAccessibleCameraIds(userId: string, role: Role): Promise<string[] | null> {
  if (role === 'admin') return null;
  const access = await prisma.cameraAccess.findMany({ where: { userId }, select: { cameraId: true } });
  if (access.length === 0) {
    const all = await prisma.camera.findMany({ where: { enabled: true }, select: { id: true } });
    return all.map((c) => c.id);
  }
  return access.map((a) => a.cameraId);
}
