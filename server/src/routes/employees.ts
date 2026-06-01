import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requirePermission } from '../lib/auth-middleware.js';
import { config } from '../config.js';
import { defaultPythonDisplay, faceSetupCommand } from '../lib/platform.js';
import {
  extractFaceFromBuffer,
  descriptorToJson,
  loadFaceModels,
  isFaceRecognitionAvailable,
  getFaceLoadError,
} from '../face/service.js';
import { runFaceScanCycle, fetchCameraFrame } from '../face/scanner.js';
import { getAllScanStatuses } from '../face/scanner-status.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const router = Router();
router.use(requireAuth);

const employeeSchema = z.object({
  employeeCode: z.string().min(1),
  fullName: z.string().min(1),
  department: z.string().optional(),
  jobTitle: z.string().optional(),
  notes: z.string().optional(),
});

router.get('/status', async (_req, res) => {
  try {
    const available = await loadFaceModels();
    res.json({
      available,
      error: available ? null : getFaceLoadError(),
      python: available ? process.env.PYTHON_BIN || defaultPythonDisplay : undefined,
    });
  } catch (e) {
    res.status(500).json({ available: false, error: String(e) });
  }
});

router.get('/attendance/report', requirePermission('view_attendance'), async (req, res) => {
  const day = req.query.day ? new Date(String(req.query.day)) : new Date();
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);

  const employees = await prisma.employee.findMany({ where: { isActive: true } });
  const report = [];

  for (const emp of employees) {
    const logs = await prisma.movementLog.findMany({
      where: { employeeId: emp.id, enteredAt: { gte: start, lte: end } },
      include: { camera: { select: { name: true } } },
      orderBy: { enteredAt: 'asc' },
    });

    const cameras = [...new Set(logs.map((l) => l.camera.name))];
    const firstSeen = logs[0]?.enteredAt;
    const lastSeen = logs.reduce(
      (max, l) => {
        const t = l.exitedAt || l.lastSeenAt;
        return t > max ? t : max;
      },
      logs[0]?.lastSeenAt || start
    );

    report.push({
      employeeId: emp.id,
      employeeCode: emp.employeeCode,
      fullName: emp.fullName,
      department: emp.department,
      firstSeen,
      lastSeen: logs.length ? lastSeen : null,
      visitCount: logs.length,
      cameras,
      logs,
    });
  }

  res.json({ day: start.toISOString().slice(0, 10), report });
});

router.get('/detections/recent', requirePermission('view_attendance'), async (_req, res) => {
  const events = await prisma.faceDetectionEvent.findMany({
    orderBy: { detectedAt: 'desc' },
    take: 50,
    include: {
      employee: { select: { fullName: true, employeeCode: true } },
      camera: { select: { name: true } },
    },
  });
  res.json({ events });
});

router.get('/scanner-status', requirePermission('view_attendance'), async (_req, res) => {
  res.json({ cameras: getAllScanStatuses() });
});

router.post('/scan-now', requirePermission('manage_employees'), async (_req, res) => {
  void runFaceScanCycle().catch((e) => console.error('[face] scan-now failed:', e));
  res.json({ ok: true, message: 'Scan started' });
});

router.get('/', requirePermission('view_attendance'), async (req, res) => {
  try {
    const { department, active } = req.query;
    const employees = await prisma.employee.findMany({
      where: {
        ...(department ? { department: String(department) } : {}),
        ...(active === 'false' ? { isActive: false } : active === 'true' ? { isActive: true } : {}),
      },
      include: {
        faceProfiles: { select: { id: true, label: true, photoPath: true, createdAt: true } },
        _count: { select: { movementLogs: true } },
      },
      orderBy: { fullName: 'asc' },
    });
    res.json({ employees });
  } catch (e) {
    console.error('[employees] list failed:', e);
    res.status(500).json({
      error: String(e),
      hint: 'Run: npm run db:migrate from project root',
    });
  }
});

router.get('/:id', requirePermission('view_attendance'), async (req, res) => {
  const id = String(req.params.id);
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: {
      faceProfiles: true,
      movementLogs: {
        orderBy: { enteredAt: 'desc' },
        take: 100,
        include: { camera: { select: { id: true, name: true } } },
      },
    },
  });
  if (!employee) return res.status(404).json({ error: 'Not found' });
  res.json({ employee });
});

router.post('/', requirePermission('manage_employees'), async (req, res) => {
  const parsed = employeeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const employee = await prisma.employee.create({ data: parsed.data });
  res.status(201).json({ employee });
});

router.patch('/:id', requirePermission('manage_employees'), async (req, res) => {
  const id = String(req.params.id);
  const employee = await prisma.employee.update({
    where: { id },
    data: req.body,
  });
  res.json({ employee });
});

router.delete('/:id', requirePermission('manage_employees'), async (req, res) => {
  const id = String(req.params.id);
  await prisma.employee.delete({ where: { id } });
  res.json({ ok: true });
});

router.post('/:id/enroll-descriptor', requirePermission('manage_employees'), async (req, res) => {
  const id = String(req.params.id);
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) return res.status(404).json({ error: 'Not found' });

  const { descriptor, label } = req.body as { descriptor: number[]; label?: string };
  if (!descriptor?.length) return res.status(400).json({ error: 'descriptor array required' });

  const profile = await prisma.faceProfile.create({
    data: {
      employeeId: employee.id,
      descriptor: JSON.stringify(descriptor),
      photoPath: '',
      label: label || 'browser',
    },
  });

  res.status(201).json({ profile });
});

router.post('/:id/enroll-from-camera/:cameraId', requirePermission('manage_employees'), async (req, res) => {
  const started = Date.now();
  try {
    const id = String(req.params.id);
    const cameraId = String(req.params.cameraId);
    const employee = await prisma.employee.findUnique({ where: { id } });
    const camera = await prisma.camera.findUnique({ where: { id: cameraId } });
    if (!employee) return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found' });
    if (!camera) return res.status(404).json({ error: 'CAMERA_NOT_FOUND', message: 'Camera not found' });
    if (!camera.enabled) {
      return res.status(400).json({ error: 'CAMERA_DISABLED', message: 'Camera is disabled' });
    }

    if (!(await loadFaceModels())) {
      return res.status(503).json({
        error: 'FACE_NOT_READY',
        message: getFaceLoadError() || 'Face recognition not available',
      });
    }

    console.log(`[employees] enroll-from-camera: ${employee.fullName} ← ${camera.name}`);
    const frame = await fetchCameraFrame(camera);
    if (!frame || frame.length < 500) {
      return res.status(400).json({
        error: 'FRAME_CAPTURE_FAILED',
        message: 'Could not capture image from camera — check stream is online',
      });
    }

    const { descriptor, bbox } = await extractFaceFromBuffer(frame);
    const photoDir = path.join(config.facesPath, employee.id);
    await fs.mkdir(photoDir, { recursive: true });
    const photoPath = path.join(photoDir, `camera_${camera.id}_${Date.now()}.jpg`);
    await fs.writeFile(photoPath, frame);

    const profile = await prisma.faceProfile.create({
      data: {
        employeeId: employee.id,
        descriptor: descriptorToJson(descriptor),
        photoPath,
        label: `camera:${camera.name}`,
      },
    });

    console.log(`[employees] enroll-from-camera OK in ${Date.now() - started}ms`);
    res.status(201).json({
      ok: true,
      message: `Face enrolled from ${camera.name}`,
      profile: {
        id: profile.id,
        label: profile.label,
        photoPath: `/api/employees/${employee.id}/photos/${path.basename(photoPath)}`,
        bbox,
        cameraName: camera.name,
      },
    });
  } catch (e) {
    console.error('[employees] enroll-from-camera failed:', e);
    const raw = String(e);
    if (raw.includes('NO_FACE_DETECTED')) {
      return res.status(400).json({
        error: 'NO_FACE_DETECTED',
        message: 'No face in camera image — stand in front of the camera and try again',
      });
    }
    res.status(400).json({ error: 'ENROLL_FAILED', message: raw.replace(/^Error:\s*/i, '') });
  }
});

router.post('/:id/enroll-face', requirePermission('manage_employees'), upload.single('photo'), async (req, res) => {
  try {
  const id = String(req.params.id);
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'photo file required' });

  if (!(await loadFaceModels())) {
    return res.status(503).json({
      error: getFaceLoadError() || 'Face recognition not available',
      hint: `Run: ${faceSetupCommand}  or set PYTHON_BIN in .env to your Python with face_recognition`,
    });
  }
  const { descriptor, bbox } = await extractFaceFromBuffer(req.file.buffer);

  const photoDir = path.join(config.facesPath, employee.id);
  await fs.mkdir(photoDir, { recursive: true });
  const photoPath = path.join(photoDir, `enroll_${Date.now()}.jpg`);
  await fs.writeFile(photoPath, req.file.buffer);

  const profile = await prisma.faceProfile.create({
    data: {
      employeeId: employee.id,
      descriptor: descriptorToJson(descriptor),
      photoPath,
      label: (req.body.label as string) || 'primary',
    },
  });

  res.status(201).json({
    profile: {
      id: profile.id,
      label: profile.label,
      photoPath: `/api/employees/${employee.id}/photos/${path.basename(photoPath)}`,
      bbox,
    },
  });
  } catch (e) {
    console.error('[employees] enroll-face failed:', e);
    const raw = String(e);
    if (raw.includes('NO_FACE_DETECTED')) {
      return res.status(400).json({ error: 'NO_FACE_DETECTED', message: 'No face detected in photo' });
    }
    if (/dlib|tensor_conv|cuda/i.test(raw)) {
      return res.status(400).json({
        error: 'FACE_DETECT_FAILED',
        message: 'Face detection failed — use a clear front-facing photo (not a distant camera shot)',
      });
    }
    res.status(400).json({ error: raw.replace(/^Error:\s*/i, '') });
  }
});

router.get('/:id/photos/:filename', requirePermission('view_attendance'), async (req, res) => {
  const id = String(req.params.id);
  const filename = String(req.params.filename);
  const filePath = path.join(config.facesPath, id, filename);
  try {
    await fs.access(filePath);
    res.sendFile(filePath);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

router.get('/:id/movement', requirePermission('view_attendance'), async (req, res) => {
  const id = String(req.params.id);
  const { from, to, cameraId } = req.query;
  const logs = await prisma.movementLog.findMany({
    where: {
      employeeId: id,
      ...(cameraId ? { cameraId: String(cameraId) } : {}),
      ...(from || to
        ? {
            enteredAt: {
              ...(from ? { gte: new Date(String(from)) } : {}),
              ...(to ? { lte: new Date(String(to)) } : {}),
            },
          }
        : {}),
    },
    include: { camera: { select: { id: true, name: true } } },
    orderBy: { enteredAt: 'desc' },
    take: 500,
  });
  res.json({ logs });
});

router.get('/:id/timeline', requirePermission('view_attendance'), async (req, res) => {
  const id = String(req.params.id);
  const day = req.query.day ? new Date(String(req.query.day)) : new Date();
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);

  const logs = await prisma.movementLog.findMany({
    where: {
      employeeId: id,
      enteredAt: { gte: start, lte: end },
    },
    include: { camera: { select: { name: true } } },
    orderBy: { enteredAt: 'asc' },
  });

  const events = await prisma.faceDetectionEvent.findMany({
    where: {
      employeeId: id,
      detectedAt: { gte: start, lte: end },
    },
    include: { camera: { select: { name: true } } },
    orderBy: { detectedAt: 'asc' },
  });

  res.json({ day: start.toISOString().slice(0, 10), logs, events });
});

export default router;
