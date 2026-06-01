import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requirePermission } from '../lib/auth-middleware.js';
import { config } from '../config.js';

const upload = multer({ dest: path.join(config.root, 'data/floor-plans') });
const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res) => {
  const plans = await prisma.floorPlan.findMany({ include: { cameras: { select: { id: true, name: true, pinX: true, pinY: true } } } });
  res.json({ floorPlans: plans });
});

router.post('/', requirePermission('manage_cameras'), upload.single('image'), async (req, res) => {
  const { name, width, height } = req.body;
  const imagePath = req.file?.path || '';
  const plan = await prisma.floorPlan.create({
    data: {
      name: name || 'Floor Plan',
      imagePath,
      width: parseInt(width) || 800,
      height: parseInt(height) || 600,
    },
  });
  res.status(201).json({ floorPlan: plan });
});

router.patch('/cameras/:cameraId/pin', requirePermission('manage_cameras'), async (req, res) => {
  const cameraId = String(req.params.cameraId);
  const { floorPlanId, pinX, pinY } = req.body;
  const camera = await prisma.camera.update({
    where: { id: cameraId },
    data: { floorPlanId, pinX, pinY },
  });
  res.json({ camera });
});

export default router;
