import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs/promises';
import cron from 'node-cron';
import { config } from './config.js';
import { mountEdgeClient } from './lib/edge-server.js';
import { faceSetupCommand, portInUseHint } from './lib/platform.js';
import { startGo2rtc, syncCameraStreams, stopGo2rtc } from './streams/go2rtc.js';
import { prisma } from './lib/prisma.js';
import { initWebSocket, simulateMotionEvents } from './ws/hub.js';
import { runScheduledSnapshots } from './routes/snapshots.js';
import { loadFaceAnalysisSettings } from './face/analysis-settings.js';
import { startFaceScanner, stopFaceScanner } from './face/scanner.js';
import { loadFaceModels } from './face/service.js';
import employeeRoutes from './routes/employees.js';

import authRoutes from './routes/auth.js';
import cameraRoutes from './routes/cameras.js';
import streamRoutes from './routes/streams.js';
import recordingRoutes from './routes/recordings.js';
import adminRoutes from './routes/admin.js';
import groupRoutes from './routes/groups.js';
import layoutRoutes from './routes/layouts.js';
import notificationRoutes from './routes/notifications.js';
import systemRoutes from './routes/system.js';
import floorPlanRoutes from './routes/floor-plans.js';
import snapshotRoutes from './routes/snapshots.js';

process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  const msg = String(err);
  const stack = err instanceof Error ? err.stack || '' : '';
  if (/reading 'slice'/i.test(msg) && /onvif[\\/]lib[\\/]cam\.js/i.test(stack)) {
    console.warn('[onvif] digest parse error on a device (ignored) — use camera username/password');
    return;
  }
  console.error('[server] uncaught exception (process kept alive):', err);
});

const app = express();
const server = http.createServer(app);

app.use(
  cors({
    origin: config.serveClient
      ? (origin, cb) => cb(null, origin ?? config.clientUrl)
      : config.clientUrl,
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, site: config.siteName });
});

app.use('/api/auth', authRoutes);
app.use('/api/cameras', cameraRoutes);
app.use('/api/streams', streamRoutes);
app.use('/api/recordings', recordingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/layouts', layoutRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/floor-plans', floorPlanRoutes);
app.use('/api/snapshots', snapshotRoutes);
app.use('/api/employees', employeeRoutes);

app.use('/uploads/floor-plans', express.static(path.join(config.root, 'data/floor-plans')));

async function mountEdgeStack() {
  if (!config.serveClient) return;
  const { mountGo2rtcHttpProxy, attachGo2rtcWsProxy } = await import('./lib/go2rtc-proxy.js');
  mountGo2rtcHttpProxy(app);
  mountEdgeClient(app);
  attachGo2rtcWsProxy(server);
}

async function bootstrap() {
  await fs.mkdir(path.join(config.root, 'data'), { recursive: true });
  await fs.mkdir(config.recordingsPath, { recursive: true });
  await fs.mkdir(config.snapshotsPath, { recursive: true });
  await fs.mkdir(config.facesPath, { recursive: true });

  const analysisMode = await loadFaceAnalysisSettings();
  console.log('[face] Analysis mode:', analysisMode);

  const cameras = await prisma.camera.findMany({ where: { enabled: true } });
  await syncCameraStreams(cameras);
  await startGo2rtc();
  await mountEdgeStack();

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[api] unhandled error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: String(err) });
    }
  });

  initWebSocket(server);
  simulateMotionEvents();

  cron.schedule('* * * * *', () => {
    void runScheduledSnapshots();
  });

  void loadFaceModels().then((ok) => {
    if (!ok) {
      console.warn('[face] Recognition unavailable at startup — run:', faceSetupCommand);
    }
  });

  if (config.faceScanEnabled) {
    startFaceScanner();
  } else {
    console.log('[face] Background scanner disabled (FACE_SCAN_ENABLED=false)');
  }

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[server] Port ${config.port} is already in use. Stop the other process: ${portInUseHint(config.port)}`
      );
    } else {
      console.error('[server]', err);
    }
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    const mode = config.serveClient ? 'edge (UI+API+WS)' : 'api';
    console.log(`[server] Mode: ${mode}`);
    console.log(`[server] API http://${config.host}:${config.port}`);
    if (config.serveClient) {
      console.log(`[server] Open in browser: ${config.clientUrl}`);
      console.log('[server] Cameras must be reachable from THIS PC (same LAN RTSP).');
    } else {
      console.log(`[server] Dev client: ${config.clientUrl}`);
    }
  });
}

bootstrap().catch(console.error);

process.on('SIGTERM', () => {
  stopFaceScanner();
  stopGo2rtc();
  process.exit(0);
});
