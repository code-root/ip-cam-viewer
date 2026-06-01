import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requirePermission } from '../lib/auth-middleware.js';
import type { Role } from '@prisma/client';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('manage_users'));

const userSchema = z.object({
  username: z.string().min(2),
  password: z.string().min(6).optional(),
  role: z.enum(['admin', 'operator', 'viewer']),
});

router.get('/users', async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, role: true, totpEnabled: true, createdAt: true },
  });
  res.json({ users });
});

router.post('/users', async (req, res) => {
  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { username, password, role } = parsed.data;
  if (!password) return res.status(400).json({ error: 'Password required' });

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      role: role as Role,
    },
    select: { id: true, username: true, role: true },
  });
  res.status(201).json({ user });
});

router.patch('/users/:id', async (req, res) => {
  const data: { role?: Role; passwordHash?: string } = {};
  if (req.body.role) data.role = req.body.role;
  if (req.body.password) data.passwordHash = await bcrypt.hash(req.body.password, 10);

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data,
    select: { id: true, username: true, role: true },
  });
  res.json({ user });
});

router.delete('/users/:id', async (req, res) => {
  if (req.params.id === req.user!.id) return res.status(400).json({ error: 'Cannot delete self' });
  await prisma.user.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

router.get('/users/:id/camera-access', async (req, res) => {
  const access = await prisma.cameraAccess.findMany({
    where: { userId: req.params.id },
    include: { camera: { select: { id: true, name: true } } },
  });
  res.json({ access });
});

router.put('/users/:id/camera-access', async (req, res) => {
  const { cameraIds } = req.body as { cameraIds: string[] };
  await prisma.cameraAccess.deleteMany({ where: { userId: req.params.id } });
  if (cameraIds?.length) {
    await prisma.cameraAccess.createMany({
      data: cameraIds.map((cameraId) => ({ userId: req.params.id, cameraId })),
    });
  }
  res.json({ ok: true });
});

router.get('/audit', async (_req, res) => {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { username: true } } },
  });
  res.json({ logs });
});

export default router;
