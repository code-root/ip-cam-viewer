import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth-middleware.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const presets = await prisma.layoutPreset.findMany({ where: { userId: req.user!.id } });
  res.json({
    presets: presets.map((p) => ({
      ...p,
      cameraIds: JSON.parse(p.cameraIds || '[]'),
    })),
  });
});

router.post('/', async (req, res) => {
  const { name, gridSize, cameraIds } = req.body;
  const preset = await prisma.layoutPreset.create({
    data: {
      userId: req.user!.id,
      name,
      gridSize: gridSize || 4,
      cameraIds: JSON.stringify(cameraIds || []),
    },
  });
  res.status(201).json({ preset: { ...preset, cameraIds } });
});

router.delete('/:id', async (req, res) => {
  await prisma.layoutPreset.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
  res.json({ ok: true });
});

export default router;
