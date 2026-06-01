import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requirePermission } from '../lib/auth-middleware.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res) => {
  const groups = await prisma.cameraGroup.findMany({ include: { cameras: true } });
  res.json({ groups });
});

router.post('/', requirePermission('manage_cameras'), async (req, res) => {
  const group = await prisma.cameraGroup.create({ data: { name: req.body.name } });
  res.status(201).json({ group });
});

router.patch('/:id', requirePermission('manage_cameras'), async (req, res) => {
  const id = String(req.params.id);
  const group = await prisma.cameraGroup.update({
    where: { id },
    data: { name: req.body.name },
  });
  res.json({ group });
});

router.delete('/:id', requirePermission('manage_cameras'), async (req, res) => {
  const id = String(req.params.id);
  await prisma.camera.updateMany({ where: { groupId: id }, data: { groupId: null } });
  await prisma.cameraGroup.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
