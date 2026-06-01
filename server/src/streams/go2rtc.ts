import fs from 'fs/promises';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import YAML from 'yaml';
import { config } from '../config.js';
import { isWindows } from '../lib/platform.js';
import { decrypt } from '../lib/crypto.js';
import type { Camera } from '@prisma/client';

let go2rtcProcess: ChildProcess | null = null;
const activeStreams = new Set<string>();

export function streamKey(cameraId: string, quality: 'main' | 'sub' = 'main') {
  return `cam_${cameraId}_${quality}`;
}

export function getRtspUrl(camera: Camera, quality: 'main' | 'sub' = 'main'): string | null {
  if (camera.rtspOverride) return camera.rtspOverride;
  return quality === 'sub' ? camera.rtspSub || camera.rtspMain : camera.rtspMain || camera.rtspSub;
}

export function buildRtspWithAuth(rtspUrl: string, username: string, password: string): string {
  try {
    const u = new URL(rtspUrl);
    u.username = username;
    u.password = password;
    return tuneRtspForLowLatency(u.toString());
  } catch {
    return tuneRtspForLowLatency(rtspUrl);
  }
}

/** go2rtc source modifiers — shorter timeout, TCP, video-only for lower delay. */
export function tuneRtspForLowLatency(rtspUrl: string): string {
  if (!rtspUrl.startsWith('rtsp')) return rtspUrl;
  if (rtspUrl.includes('#')) return rtspUrl;
  return `${rtspUrl}#timeout=5#media=video`;
}

export async function loadYamlConfig(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(config.go2rtcConfig, 'utf8');
    return YAML.parse(raw) as Record<string, unknown>;
  } catch {
    return defaultGo2rtcConfig();
  }
}

function defaultGo2rtcConfig(): Record<string, unknown> {
  return {
    api: { listen: ':1984' },
    rtsp: { listen: ':8554' },
    webrtc: { listen: ':8555' },
    streams: {},
  };
}

export async function saveYamlConfig(cfg: Record<string, unknown>) {
  await fs.mkdir(path.dirname(config.go2rtcConfig), { recursive: true });
  await fs.writeFile(config.go2rtcConfig, YAML.stringify(cfg), 'utf8');
}

export async function syncCameraStreams(cameras: Camera[]) {
  const cfg = await loadYamlConfig();
  const streams: Record<string, string> = {};

  for (const cam of cameras) {
    if (!cam.enabled) continue;
    const password = decrypt(cam.passwordEnc);
    const main = getRtspUrl(cam, 'main');
    const sub = getRtspUrl(cam, 'sub');
    if (main) streams[streamKey(cam.id, 'main')] = buildRtspWithAuth(main, cam.username, password);
    if (sub) {
      const subKey = streamKey(cam.id, 'sub');
      const subSrc = buildRtspWithAuth(sub, cam.username, password);
      if (sub !== main) {
        streams[subKey] = subSrc;
      } else {
        // Same URL as main — sub viewers use the main stream entry in go2rtc
        streams[subKey] = streams[streamKey(cam.id, 'main')];
      }
    }
  }

  cfg.streams = streams;
  await saveYamlConfig(cfg);
}

async function isGo2rtcApiUp(): Promise<boolean> {
  try {
    const res = await fetch(`${config.go2rtcApi}/api`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function startGo2rtc(): Promise<void> {
  if (go2rtcProcess) return;

  if (await isGo2rtcApiUp()) {
    console.log('[go2rtc] Using existing instance at', config.go2rtcApi);
    return;
  }

  try {
    await fs.access(config.go2rtcBin);
  } catch {
    console.warn('[go2rtc] Binary not found at', config.go2rtcBin, '- streams will use API if already running');
    return;
  }

  const spawnEnv = { ...process.env };
  if (!isWindows) {
    spawnEnv.PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`;
  }

  go2rtcProcess = spawn(config.go2rtcBin, ['-config', config.go2rtcConfig], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: spawnEnv,
  });

  go2rtcProcess.stdout?.on('data', (d) => console.log('[go2rtc]', d.toString().trim()));
  go2rtcProcess.stderr?.on('data', (d) => console.error('[go2rtc]', d.toString().trim()));
  go2rtcProcess.on('exit', () => {
    go2rtcProcess = null;
  });

  await new Promise((r) => setTimeout(r, 1500));
}

export function stopGo2rtc() {
  go2rtcProcess?.kill();
  go2rtcProcess = null;
}

export async function getStreamHealth(streamName: string) {
  try {
    const res = await fetch(`${config.go2rtcApi}/api/streams`);
    if (!res.ok) return { online: false };
    const data = (await res.json()) as Record<string, unknown>;
    const info = data[streamName];
    return {
      online: !!info,
      info: info || null,
    };
  } catch {
    return { online: false };
  }
}

export function getStreamUrls(streamName: string, baseUrl?: string) {
  const api = baseUrl || config.go2rtcApi;
  return {
    webrtc: `${api}/api/webrtc?src=${streamName}`,
    hls: `${api}/api/stream.m3u8?src=${streamName}`,
    mjpeg: `${api}/api/frame.jpeg?src=${streamName}`,
    streamName,
  };
}

async function upsertGo2rtcStream(name: string, src: string): Promise<void> {
  const params = new URLSearchParams({ name, src });
  const res = await fetch(`${config.go2rtcApi}/api/streams?${params}`, { method: 'PUT' });
  if (res.ok) return;

  const cfg = await loadYamlConfig();
  const streams = (cfg.streams as Record<string, string>) || {};
  streams[name] = src;
  cfg.streams = streams;
  await saveYamlConfig(cfg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** go2rtc may return 5xx until RTSP is connected — retry briefly. */
export async function fetchGo2rtcFrame(streamName: string, attempts = 4): Promise<Response> {
  const url = `${config.go2rtcApi}/api/frame.jpeg?src=${encodeURIComponent(streamName)}`;
  let last: Response | null = null;
  for (let i = 0; i < attempts; i++) {
    last = await fetch(url);
    if (last.ok) return last;
    if (i < attempts - 1) await sleep(150 * (i + 1));
  }
  return last!;
}

async function warmStream(streamName: string): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const r = await fetchGo2rtcFrame(streamName, 1);
    if (r.ok) return;
    await sleep(200);
  }
}

/** go2rtc stream name — may alias sub → main when RTSP URLs are identical. */
export function resolveStreamName(camera: Camera, quality: 'main' | 'sub'): string {
  const main = getRtspUrl(camera, 'main');
  const sub = getRtspUrl(camera, 'sub');
  if (quality === 'sub' && sub && main && sub === main) {
    return streamKey(camera.id, 'main');
  }
  return streamKey(camera.id, quality);
}

export async function registerStream(camera: Camera, quality: 'main' | 'sub' = 'main') {
  const key = streamKey(camera.id, quality);
  const go2rtcName = resolveStreamName(camera, quality);
  if (activeStreams.size >= config.maxConcurrentStreams && !activeStreams.has(key)) {
    throw new Error('Max concurrent streams reached');
  }

  const password = decrypt(camera.passwordEnc);
  const rtsp = getRtspUrl(camera, quality);
  if (!rtsp) throw new Error('No RTSP URL configured');

  const src = buildRtspWithAuth(rtsp, camera.username, password);

  try {
    await upsertGo2rtcStream(go2rtcName, src);
  } catch {
    const cfg = await loadYamlConfig();
    const streams = (cfg.streams as Record<string, string>) || {};
    streams[go2rtcName] = src;
    cfg.streams = streams;
    await saveYamlConfig(cfg);
  }

  await warmStream(go2rtcName);

  activeStreams.add(key);
  return go2rtcName;
}

export function releaseStream(cameraId: string, quality: 'main' | 'sub' = 'main') {
  activeStreams.delete(streamKey(cameraId, quality));
}

/** Temporary stream for connection test (not counted in activeStreams). */
export async function registerPreviewStream(
  rtspUrl: string,
  username: string,
  password: string
): Promise<string> {
  const name = `preview_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const src = buildRtspWithAuth(rtspUrl, username, password);
  await upsertGo2rtcStream(name, src);
  await warmStream(name);
  return name;
}
