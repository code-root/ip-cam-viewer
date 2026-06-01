import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { requireAuth, requirePermission, getAccessibleCameraIds } from '../lib/auth-middleware.js';
import * as onvif from '../onvif/service.js';
import { syncCameraStreams, registerPreviewStream, registerStream } from '../streams/go2rtc.js';
import { config } from '../config.js';
import { guessLocalSubnets } from '../onvif/discovery-scan.js';

const router = Router();
router.use(requireAuth);

const cameraSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  onvifPort: z.number().int().default(80),
  username: z.string().default('admin'),
  password: z.string().optional().default(''),
  rtspOverride: z.string().optional(),
  groupId: z.string().optional().nullable(),
});

async function filterCameras(userId: string, role: string) {
  const ids = await getAccessibleCameraIds(userId, role as 'admin' | 'operator' | 'viewer');
  if (ids === null) return {};
  return { id: { in: ids } };
}

function sanitizeCamera(cam: {
  id: string;
  name: string;
  host: string;
  onvifPort: number;
  username: string;
  passwordEnc: string;
  rtspMain: string | null;
  rtspSub: string | null;
  rtspOverride: string | null;
  manufacturer: string | null;
  model: string | null;
  supportsPtz: boolean;
  supportsAudio: boolean;
  privacyMasks: string;
  videoTransform: string;
  groupId: string | null;
  pinX: number | null;
  pinY: number | null;
  floorPlanId: string | null;
  enabled: boolean;
}) {
  const { passwordEnc, ...rest } = cam;
  return rest;
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

function dedupeLinkedCameras(cameras: Array<{ id: string; name: string; onvifPort: number }>) {
  const byId = new Map<string, { id: string; name: string; onvifPort: number }>();
  for (const c of cameras) byId.set(c.id, c);
  const byLabel = new Map<string, { id: string; name: string; onvifPort: number }>();
  for (const c of byId.values()) {
    const key = `${c.name}\0${c.onvifPort}`;
    if (!byLabel.has(key)) byLabel.set(key, c);
  }
  return [...byLabel.values()];
}

type DiscoveredInput = {
  host: string;
  port: number;
  name?: string;
  manufacturer?: string;
  source?: string;
};

function enrichDevicesWithLinks(
  devices: DiscoveredInput[],
  cameras: Array<{ id: string; name: string; host: string; onvifPort: number }>
) {
  const byHost = new Map<string, Array<{ id: string; name: string; onvifPort: number }>>();
  for (const cam of cameras) {
    const key = normalizeHost(cam.host);
    const list = byHost.get(key) ?? [];
    list.push({ id: cam.id, name: cam.name, onvifPort: cam.onvifPort });
    byHost.set(key, list);
  }

  return devices.map((d) => {
    const linkedCameras = dedupeLinkedCameras(byHost.get(normalizeHost(d.host)) ?? []);
    const exactMatches = linkedCameras.filter((c) => c.onvifPort === d.port);
    const linkStatus =
      exactMatches.length > 0 ? 'exact' : linkedCameras.length > 0 ? 'host' : 'none';

    return {
      ...d,
      alreadyLinked: linkStatus !== 'none',
      linkStatus,
      linkedCameras,
      exactMatches,
    };
  });
}

router.get('/discover/subnets', requirePermission('manage_cameras'), (_req, res) => {
  const suggested = guessLocalSubnets();
  const envSubnet = config.onvifDiscoverSubnet.trim();
  res.json({
    subnets: envSubnet ? [envSubnet, ...suggested.filter((s) => s !== envSubnet)] : suggested,
  });
});

router.get('/discover', requirePermission('manage_cameras'), async (req, res) => {
  try {
    const timeoutMs = parseInt(String(req.query.timeout || config.onvifDiscoverTimeoutMs), 10) || 12000;
    const subnetScan =
      req.query.subnetScan !== 'false' &&
      req.query.subnetScan !== '0' &&
      config.onvifDiscoverSubnetScan;
    const subnetParam = String(req.query.subnet || config.onvifDiscoverSubnet || '').trim();
    const subnets = subnetParam
      ? subnetParam.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
      : undefined;

    const started = Date.now();
    const [devices, cameras] = await Promise.all([
      onvif.discoverDevices({
        timeoutMs,
        subnetScan,
        subnets,
        perHostMs: config.onvifDiscoverPerHostMs,
        concurrency: config.onvifDiscoverConcurrency,
      }),
      prisma.camera.findMany({ select: { id: true, name: true, host: true, onvifPort: true } }),
    ]);

    const scannedSubnets = subnets?.length ? subnets : subnetScan ? guessLocalSubnets() : [];
    const enriched = enrichDevicesWithLinks(devices, cameras);

    res.json({
      devices: enriched,
      scannedSubnets,
      durationMs: Date.now() - started,
      subnetScan,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const reconcileSchema = z.object({
  devices: z.array(
    z.object({
      host: z.string(),
      port: z.number().int(),
      name: z.string().optional(),
      manufacturer: z.string().optional(),
      source: z.string().optional(),
    })
  ),
});

/** Re-apply linked/new status from DB without rescanning the network. */
router.post('/discover/reconcile', requirePermission('manage_cameras'), async (req, res) => {
  const parsed = reconcileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const cameras = await prisma.camera.findMany({
    select: { id: true, name: true, host: true, onvifPort: true },
  });
  const devices = enrichDevicesWithLinks(parsed.data.devices, cameras);
  res.json({ devices });
});

const testConnectionSchema = z.object({
  host: z.string().min(1),
  onvifPort: z.number().int().default(80),
  username: z.string().default('admin'),
  password: z.string().optional().default(''),
  rtspOverride: z.string().optional(),
});

async function signPreviewToken(streamName: string, userId: string) {
  return jwt.sign({ streamName, cameraId: 'preview', userId }, config.jwtSecret, { expiresIn: '10m' });
}

async function startTestPreview(
  rtspUrl: string | undefined,
  username: string,
  password: string,
  userId: string
): Promise<{ streamName: string; streamToken: string } | { previewError: string } | null> {
  if (!rtspUrl) return null;
  try {
    const streamName = await registerPreviewStream(rtspUrl, username, password);
    const streamToken = await signPreviewToken(streamName, userId);
    return { streamName, streamToken };
  } catch (e) {
    return { previewError: String(e) };
  }
}

router.post('/test', requirePermission('manage_cameras'), async (req, res) => {
  try {
  const parsed = testConnectionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { host, onvifPort, username, password, rtspOverride } = parsed.data;
  const userId = req.user!.id;

  try {
    const probe = await onvif.probeCameraWithAuthDetection(host, onvifPort, username, password ?? '');
    const merged = {
      ...probe.info,
      rtspMain: probe.info.rtspMain || rtspOverride || undefined,
      rtspSub: probe.info.rtspSub,
    };
    const rtsp = merged.rtspSub || merged.rtspMain;
    const preview = await startTestPreview(
      rtsp,
      probe.effectiveUsername,
      probe.effectivePassword,
      userId
    );
    res.json({
      ok: true,
      info: merged,
      auth: {
        required: probe.authRequired,
        credentialsUsed: probe.credentialsUsed,
      },
      ...(preview && ('streamName' in preview ? { preview } : preview)),
    });
  } catch (e) {
    const code = (e as Error & { code?: string }).code;
    if (code === 'AUTH_REQUIRED') {
      return res.status(400).json({
        ok: false,
        auth: { required: true, credentialsUsed: false },
        error: 'AUTH_REQUIRED',
        message: 'Camera requires login — enter username and password',
      });
    }
    if (code === 'AUTH_FAILED') {
      return res.status(400).json({
        ok: false,
        auth: { required: true, credentialsUsed: true },
        error: 'AUTH_FAILED',
        message: 'Invalid username or password',
      });
    }
    if (rtspOverride) {
      const info = {
        manufacturer: undefined,
        model: undefined,
        supportsPtz: false,
        supportsAudio: false,
        rtspMain: rtspOverride,
        rtspSub: undefined,
        note: 'ONVIF failed; RTSP override provided',
      };
      const preview = await startTestPreview(rtspOverride, username, password ?? '', userId);
      return res.json({
        ok: true,
        info,
        auth: { required: !!(password ?? ''), credentialsUsed: !!(password ?? '') },
        warning: String(e),
        ...(preview && ('streamName' in preview ? { preview } : preview)),
      });
    }
    const raw = String(e);
    if (/authority failure|soap fault/i.test(raw.toLowerCase())) {
      return res.status(400).json({
        ok: false,
        auth: { required: true, credentialsUsed: !!(password ?? '') },
        error: password ? 'AUTH_FAILED' : 'AUTH_REQUIRED',
        message: password
          ? 'Invalid username or password (ONVIF rejected credentials)'
          : 'Camera requires login — enter username and password',
      });
    }
    res.status(400).json({ ok: false, error: raw });
  }
  } catch (e) {
    console.error('[cameras] POST /test failed:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.get('/', async (req, res) => {
  const where = await filterCameras(req.user!.id, req.user!.role);
  const cameras = await prisma.camera.findMany({ where, orderBy: { name: 'asc' } });
  res.json({ cameras: cameras.map(sanitizeCamera) });
});

router.get('/:id', async (req, res) => {
  const id = String(req.params.id);
  const where = await filterCameras(req.user!.id, req.user!.role);
  const camera = await prisma.camera.findFirst({ where: { id, ...where } });
  if (!camera) return res.status(404).json({ error: 'Not found' });
  res.json({ camera: sanitizeCamera(camera) });
});

router.post('/', requirePermission('manage_cameras'), async (req, res) => {
  const parsed = cameraSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { password, ...data } = parsed.data;
  const passwordEnc = encrypt(password);

  let extra = {};
  try {
    extra = await onvif.probeCamera(data.host, data.onvifPort, data.username, passwordEnc);
  } catch {
    /* manual RTSP override may still work */
  }

  const camera = await prisma.camera.create({
    data: {
      ...data,
      passwordEnc,
      rtspMain: (extra as { rtspMain?: string }).rtspMain || data.rtspOverride || null,
      rtspSub: (extra as { rtspSub?: string }).rtspSub || null,
      rtspOverride: data.rtspOverride || null,
      manufacturer: (extra as { manufacturer?: string }).manufacturer,
      model: (extra as { model?: string }).model,
      supportsPtz: (extra as { supportsPtz?: boolean }).supportsPtz || false,
      supportsAudio: (extra as { supportsAudio?: boolean }).supportsAudio || false,
    },
  });

  const all = await prisma.camera.findMany({ where: { enabled: true } });
  await syncCameraStreams(all);

  res.status(201).json({ camera: sanitizeCamera(camera) });
});

router.patch('/:id', requirePermission('manage_cameras'), async (req, res) => {
  const id = String(req.params.id);
  const existing = await prisma.camera.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const updates: Record<string, unknown> = {};
  const allowed = ['name', 'host', 'onvifPort', 'username', 'groupId', 'rtspOverride', 'enabled', 'privacyMasks', 'videoTransform', 'pinX', 'pinY', 'floorPlanId'];
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  if (req.body.password) updates.passwordEnc = encrypt(req.body.password);

  const camera = await prisma.camera.update({ where: { id }, data: updates });
  const all = await prisma.camera.findMany({ where: { enabled: true } });
  await syncCameraStreams(all);
  res.json({ camera: sanitizeCamera(camera) });
});

router.delete('/:id', requirePermission('manage_cameras'), async (req, res) => {
  const id = String(req.params.id);
  await prisma.camera.delete({ where: { id } });
  const all = await prisma.camera.findMany({ where: { enabled: true } });
  await syncCameraStreams(all);
  res.json({ ok: true });
});

router.post('/:id/test', requirePermission('manage_cameras'), async (req, res) => {
  const id = String(req.params.id);
  const camera = await prisma.camera.findUnique({ where: { id } });
  if (!camera) return res.status(404).json({ error: 'Not found' });

  try {
    const info = await onvif.probeCamera(camera.host, camera.onvifPort, camera.username, camera.passwordEnc);
    await prisma.camera.update({
      where: { id: camera.id },
      data: {
        rtspMain: info.rtspMain || camera.rtspMain,
        rtspSub: info.rtspSub || camera.rtspSub,
        manufacturer: info.manufacturer,
        model: info.model,
        supportsPtz: info.supportsPtz,
        supportsAudio: info.supportsAudio,
      },
    });
    const updated = await prisma.camera.findUnique({ where: { id: camera.id } });
    let preview: { streamName: string; streamToken: string } | { previewError: string } | null = null;
    if (updated) {
      try {
        const streamName = await registerStream(updated, 'sub');
        const streamToken = jwt.sign(
          { streamName, cameraId: camera.id, userId: req.user!.id },
          config.jwtSecret,
          { expiresIn: '10m' }
        );
        preview = { streamName, streamToken };
      } catch (e) {
        preview = { previewError: String(e) };
      }
    }
    res.json({
      ok: true,
      info,
      ...(preview && ('streamName' in preview ? { preview } : preview)),
    });
  } catch (e) {
    const raw = String(e);
    if (/authority failure|soap fault/i.test(raw.toLowerCase())) {
      return res.status(400).json({
        ok: false,
        error: 'AUTH_FAILED',
        message: 'Invalid username or password — update camera credentials in settings',
      });
    }
    res.status(400).json({ ok: false, error: raw });
  }
});

router.post('/:id/ptz', requirePermission('ptz'), async (req, res) => {
  const id = String(req.params.id);
  const camera = await prisma.camera.findUnique({ where: { id } });
  if (!camera) return res.status(404).json({ error: 'Not found' });

  const { action, x = 0, y = 0, zoom = 0, speed = 0.5 } = req.body;
  try {
    if (action === 'stop') {
      await onvif.ptzStop(camera.host, camera.onvifPort, camera.username, camera.passwordEnc);
    } else {
      await onvif.ptzMove(camera.host, camera.onvifPort, camera.username, camera.passwordEnc, x, y, zoom, speed);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

router.get('/:id/presets', requirePermission('ptz'), async (req, res) => {
  const id = String(req.params.id);
  const camera = await prisma.camera.findUnique({ where: { id } });
  if (!camera) return res.status(404).json({ error: 'Not found' });
  try {
    const presets = await onvif.getPresets(camera.host, camera.onvifPort, camera.username, camera.passwordEnc);
    res.json({ presets });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

router.post('/:id/presets', requirePermission('ptz'), async (req, res) => {
  const id = String(req.params.id);
  const camera = await prisma.camera.findUnique({ where: { id } });
  if (!camera) return res.status(404).json({ error: 'Not found' });
  const { name, token } = req.body;
  try {
    if (token) {
      await onvif.gotoPreset(camera.host, camera.onvifPort, camera.username, camera.passwordEnc, token);
      return res.json({ ok: true });
    }
    const newToken = await onvif.setPreset(camera.host, camera.onvifPort, camera.username, camera.passwordEnc, name || 'Preset');
    res.json({ token: newToken });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

router.get('/:id/snapshot', async (req, res) => {
  const id = String(req.params.id);
  const where = await filterCameras(req.user!.id, req.user!.role);
  const camera = await prisma.camera.findFirst({ where: { id, ...where } });
  if (!camera) return res.status(404).json({ error: 'Not found' });
  try {
    const buf = await onvif.getSnapshot(camera.host, camera.onvifPort, camera.username, camera.passwordEnc);
    res.set('Content-Type', 'image/jpeg');
    res.send(buf);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

router.get('/:id/privacy-masks', async (req, res) => {
  const id = String(req.params.id);
  const camera = await prisma.camera.findUnique({ where: { id } });
  if (!camera) return res.status(404).json({ error: 'Not found' });
  res.json({ masks: JSON.parse(camera.privacyMasks || '[]') });
});

router.put('/:id/privacy-masks', requirePermission('privacy_masks'), async (req, res) => {
  const id = String(req.params.id);
  const { masks } = req.body;
  await prisma.camera.update({
    where: { id },
    data: { privacyMasks: JSON.stringify(masks || []) },
  });
  res.json({ ok: true });
});

router.get('/:id/imaging', requirePermission('imaging'), async (req, res) => {
  res.json({ settings: { brightness: 50, contrast: 50, saturation: 50, wdr: false }, note: 'ONVIF imaging varies by device' });
});

router.put('/:id/imaging', requirePermission('imaging'), async (req, res) => {
  res.json({ ok: true, applied: req.body });
});

router.post('/:id/talk', requirePermission('talk_back'), async (req, res) => {
  res.json({ ok: true, message: 'Talk-back requires go2rtc backchannel support on device' });
});

export default router;
