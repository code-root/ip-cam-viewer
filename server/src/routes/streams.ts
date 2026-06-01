import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { requireAuth, getAccessibleCameraIds } from '../lib/auth-middleware.js';
import {
  registerStream,
  releaseStream,
  getStreamUrls,
  getStreamHealth,
  resolveStreamName,
  fetchGo2rtcFrame,
} from '../streams/go2rtc.js';
import { config } from '../config.js';

const router = Router();

/** Stream media (HLS/MJPEG) — authenticated via ?token= only; browsers cannot send Bearer headers. */
const proxyRouter = Router();

function verifyStreamToken(token: string): { streamName: string; cameraId: string; userId: string } {
  return jwt.verify(token, config.jwtSecret) as { streamName: string; cameraId: string; userId: string };
}

proxyRouter.get('/webrtc', async (req, res) => {
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: 'token required' });
  try {
    const { streamName } = verifyStreamToken(token);
    res.redirect(`${config.go2rtcApi}/api/webrtc?src=${encodeURIComponent(streamName)}`);
  } catch {
    res.status(401).json({ error: 'Invalid stream token' });
  }
});

proxyRouter.get('/hls.m3u8', async (req, res) => {
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: 'token required' });
  try {
    const { streamName } = verifyStreamToken(token);
    const upstream = await fetch(
      `${config.go2rtcApi}/api/stream.m3u8?src=${encodeURIComponent(streamName)}`
    );
    if (!upstream.ok) {
      return res.status(502).json({ error: 'Stream unavailable' });
    }
    const body = await upstream.text();
    const rewritten = body.replace(/^(?!#)(\S+)/gm, (line) => {
      if (line.startsWith('http')) return line;
      return `/go2rtc/api/${line}`;
    });
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.set('Cache-Control', 'no-cache');
    res.send(rewritten);
  } catch {
    res.status(401).json({ error: 'Invalid stream token' });
  }
});

proxyRouter.get('/frame.jpeg', async (req, res) => {
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: 'token required' });
  try {
    const { streamName } = verifyStreamToken(token);
    const r = await fetchGo2rtcFrame(streamName);
    if (!r.ok) {
      return res.status(502).json({ error: 'Frame capture failed' });
    }
    const buf = await r.arrayBuffer();
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-cache');
    res.send(Buffer.from(buf));
  } catch {
    res.status(401).json({ error: 'Invalid stream token' });
  }
});

router.use('/proxy', proxyRouter);

const authRouter = Router();
authRouter.use(requireAuth);

authRouter.post('/:cameraId/start', async (req, res) => {
  const quality = (req.body.quality as 'main' | 'sub') || 'sub';
  const ids = await getAccessibleCameraIds(req.user!.id, req.user!.role);
  if (ids && !ids.includes(req.params.cameraId)) {
    return res.status(403).json({ error: 'No access to camera' });
  }

  const camera = await prisma.camera.findUnique({ where: { id: req.params.cameraId } });
  if (!camera?.enabled) return res.status(404).json({ error: 'Camera not found' });

  try {
    const name = await registerStream(camera, quality);
    const streamToken = jwt.sign(
      { streamName: name, cameraId: camera.id, userId: req.user!.id },
      config.jwtSecret,
      { expiresIn: '2h' }
    );

    const q = encodeURIComponent(streamToken);
    const src = encodeURIComponent(name);
    res.json({
      streamName: name,
      streamToken,
      urls: {
        webrtc: `/api/streams/proxy/webrtc?token=${q}`,
        hls: `/api/streams/proxy/hls.m3u8?token=${q}`,
        mjpeg: `/api/streams/proxy/frame.jpeg?token=${q}`,
        /** Vite-proxied go2rtc snapshot (fewer hops; stream must be warmed via /start). */
        frame: `/go2rtc/api/frame.jpeg?src=${src}`,
        direct: getStreamUrls(name),
      },
    });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

authRouter.post('/:cameraId/stop', async (req, res) => {
  const quality = (req.body.quality as 'main' | 'sub') || 'sub';
  releaseStream(req.params.cameraId, quality);
  res.json({ ok: true });
});

authRouter.get('/:cameraId/health', async (req, res) => {
  const quality = (req.query.quality as 'main' | 'sub') || 'sub';
  const camera = await prisma.camera.findUnique({ where: { id: req.params.cameraId } });
  if (!camera) return res.status(404).json({ error: 'Camera not found' });
  const name = resolveStreamName(camera, quality);
  const health = await getStreamHealth(name);
  res.json({ streamName: name, ...health, timestamp: new Date().toISOString() });
});

router.use(authRouter);

export default router;
