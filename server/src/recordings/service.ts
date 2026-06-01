import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { buildRtspWithAuth, getRtspUrl } from '../streams/go2rtc.js';
import { decrypt } from '../lib/crypto.js';

const activeRecordings = new Map<string, { process: ReturnType<typeof spawn>; recordingId: string }>();

export async function startRecording(cameraId: string, userId: string) {
  const camera = await prisma.camera.findUnique({ where: { id: cameraId } });
  if (!camera) throw new Error('Camera not found');

  if (activeRecordings.has(cameraId)) throw new Error('Already recording');

  const rtsp = getRtspUrl(camera, 'main');
  if (!rtsp) throw new Error('No RTSP URL');

  const password = decrypt(camera.passwordEnc);
  const src = buildRtspWithAuth(rtsp, camera.username, password);

  const dir = path.join(config.recordingsPath, cameraId);
  await fs.mkdir(dir, { recursive: true });

  const filename = `rec_${Date.now()}.mp4`;
  const filepath = path.join(dir, filename);
  const watermark = `drawtext=text='${config.siteName} %{localtime}':x=10:y=10:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.5`;

  const args = [
    '-rtsp_transport', 'tcp',
    '-i', src,
    '-vf', watermark,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-c:a', 'aac',
    '-t', '3600',
    '-y',
    filepath,
  ];

  const proc = spawn('ffmpeg', args, { stdio: 'ignore' });

  const recording = await prisma.recording.create({
    data: {
      cameraId,
      filename,
      path: filepath,
      startedAt: new Date(),
    },
  });

  activeRecordings.set(cameraId, { process: proc, recordingId: recording.id });

  await prisma.auditLog.create({
    data: { userId, action: 'recording_start', details: JSON.stringify({ cameraId, recordingId: recording.id }) },
  });

  return recording;
}

export async function stopRecording(cameraId: string, userId: string) {
  const active = activeRecordings.get(cameraId);
  if (!active) throw new Error('Not recording');

  active.process.kill('SIGINT');
  activeRecordings.delete(cameraId);

  const stat = await fs.stat(
    (await prisma.recording.findUnique({ where: { id: active.recordingId } }))!.path
  ).catch(() => null);

  const recording = await prisma.recording.update({
    where: { id: active.recordingId },
    data: {
      endedAt: new Date(),
      sizeBytes: stat?.size,
    },
  });

  await prisma.auditLog.create({
    data: { userId, action: 'recording_stop', details: JSON.stringify({ cameraId, recordingId: recording.id }) },
  });

  return recording;
}

export function isRecording(cameraId: string) {
  return activeRecordings.has(cameraId);
}
