import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requirePermission } from '../lib/auth-middleware.js';
import { config } from '../config.js';
import { encrypt, decrypt } from '../lib/crypto.js';

const router = Router();
router.use(requireAuth);

router.get('/export', requirePermission('backup'), async (_req, res) => {
  const cameras = await prisma.camera.findMany();
  const groups = await prisma.cameraGroup.findMany();
  const channels = await prisma.notificationChannel.findMany();
  const floorPlans = await prisma.floorPlan.findMany();

  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    cameras: cameras.map((c) => ({
      ...c,
      password: decrypt(c.passwordEnc),
      passwordEnc: undefined,
    })),
    groups,
    channels,
    floorPlans,
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="ip-cam-export.json"');
  res.send(JSON.stringify(data, null, 2));
});

router.post('/import', requirePermission('backup'), async (req, res) => {
  const data = req.body;
  if (!data.cameras) return res.status(400).json({ error: 'Invalid export file' });

  for (const cam of data.cameras) {
    const { password, passwordEnc, id, ...rest } = cam;
    await prisma.camera.upsert({
      where: { id: id || 'new' },
      create: { ...rest, passwordEnc: encrypt(password || '') },
      update: { ...rest, passwordEnc: encrypt(password || '') },
    }).catch(async () => {
      await prisma.camera.create({
        data: { ...rest, passwordEnc: encrypt(password || '') },
      });
    });
  }

  res.json({ ok: true, imported: data.cameras.length });
});

router.post('/backup', requirePermission('backup'), async (_req, res) => {
  const backupDir = path.join(config.root, 'data/backups');
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = Date.now();
  const backupFolder = path.join(backupDir, `backup_${stamp}`);
  await fs.mkdir(backupFolder, { recursive: true });

  const dbPath = path.resolve(config.root, 'data/app.db');
  try {
    await fs.copyFile(dbPath, path.join(backupFolder, 'app.db'));
  } catch { /* db may not exist yet */ }

  try {
    await fs.cp(path.dirname(config.go2rtcConfig), path.join(backupFolder, 'config'), { recursive: true });
  } catch { /* ignore */ }

  const exportData = await prisma.camera.findMany();
  await fs.writeFile(
    path.join(backupFolder, 'cameras.json'),
    JSON.stringify(exportData.map((c) => ({ ...c, password: decrypt(c.passwordEnc) })), null, 2)
  );

  res.json({ ok: true, folder: backupFolder, timestamp: stamp });
});

router.get('/backups', requirePermission('backup'), async (_req, res) => {
  const backupDir = path.join(config.root, 'data/backups');
  try {
    const files = await fs.readdir(backupDir);
    res.json({ backups: files.filter((f) => f.startsWith('backup_')) });
  } catch {
    res.json({ backups: [] });
  }
});

export default router;
