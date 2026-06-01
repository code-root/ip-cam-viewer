import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requirePermission } from '../lib/auth-middleware.js';
import { config } from '../config.js';
import * as onvif from '../onvif/service.js';

const router = Router();
router.use(requireAuth);

router.get('/schedule', async (_req, res) => {
  const schedules = await prisma.scheduledSnapshot.findMany({ include: { camera: { select: { name: true } } } });
  res.json({ schedules });
});

router.post('/schedule', requirePermission('manage_cameras'), async (req, res) => {
  const { cameraId, intervalMin, enabled } = req.body;
  const schedule = await prisma.scheduledSnapshot.create({
    data: { cameraId, intervalMin: intervalMin || 15, enabled: enabled !== false },
  });
  res.status(201).json({ schedule });
});

router.patch('/schedule/:id', requirePermission('manage_cameras'), async (req, res) => {
  const id = String(req.params.id);
  const schedule = await prisma.scheduledSnapshot.update({
    where: { id },
    data: req.body,
  });
  res.json({ schedule });
});

router.delete('/schedule/:id', requirePermission('manage_cameras'), async (req, res) => {
  const id = String(req.params.id);
  await prisma.scheduledSnapshot.delete({ where: { id } });
  res.json({ ok: true });
});

router.get('/archive', async (req, res) => {
  const { cameraId } = req.query;
  const dir = path.join(config.snapshotsPath, cameraId ? String(cameraId) : '');
  try {
    const files = await fs.readdir(dir);
    res.json({ snapshots: files.filter((f) => f.endsWith('.jpg')).sort().reverse() });
  } catch {
    res.json({ snapshots: [] });
  }
});

export async function runScheduledSnapshots() {
  const schedules = await prisma.scheduledSnapshot.findMany({
    where: { enabled: true },
    include: { camera: true },
  });

  for (const sched of schedules) {
    const now = Date.now();
    const last = sched.lastRunAt?.getTime() || 0;
    if (now - last < sched.intervalMin * 60 * 1000) continue;

    try {
      const buf = await onvif.getSnapshot(
        sched.camera.host,
        sched.camera.onvifPort,
        sched.camera.username,
        sched.camera.passwordEnc
      );
      const dir = path.join(config.snapshotsPath, sched.cameraId);
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `snap_${Date.now()}.jpg`);
      await fs.writeFile(file, buf);
      await prisma.scheduledSnapshot.update({
        where: { id: sched.id },
        data: { lastRunAt: new Date() },
      });
    } catch (e) {
      console.error('[scheduled snapshot]', sched.cameraId, e);
    }
  }
}

export default router;
