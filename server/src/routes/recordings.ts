import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requirePermission } from '../lib/auth-middleware.js';
import * as rec from '../recordings/service.js';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('recordings_read'), async (req, res) => {
  const { cameraId } = req.query;
  const recordings = await prisma.recording.findMany({
    where: cameraId ? { cameraId: String(cameraId) } : undefined,
    orderBy: { startedAt: 'desc' },
    take: 100,
    include: { camera: { select: { name: true } } },
  });
  res.json({ recordings });
});

router.post('/:cameraId/start', requirePermission('recordings_write'), async (req, res) => {
  try {
    const cameraId = String(req.params.cameraId);
    const recording = await rec.startRecording(cameraId, req.user!.id);
    res.json({ recording });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

router.post('/:cameraId/stop', requirePermission('recordings_write'), async (req, res) => {
  try {
    const cameraId = String(req.params.cameraId);
    const recording = await rec.stopRecording(cameraId, req.user!.id);
    res.json({ recording });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

router.get('/:cameraId/status', async (req, res) => {
  const cameraId = String(req.params.cameraId);
  res.json({ recording: rec.isRecording(cameraId) });
});

router.get('/file/:id/stream', requirePermission('recordings_read'), async (req, res) => {
  const id = String(req.params.id);
  const recording = await prisma.recording.findUnique({ where: { id } });
  if (!recording || !fs.existsSync(recording.path)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const stat = fs.statSync(recording.path);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(recording.path).pipe(res);
});

router.delete('/:id', requirePermission('recordings_write'), async (req, res) => {
  const id = String(req.params.id);
  const recording = await prisma.recording.findUnique({ where: { id } });
  if (recording && fs.existsSync(recording.path)) fs.unlinkSync(recording.path);
  await prisma.recording.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
