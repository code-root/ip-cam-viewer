#!/usr/bin/env node
/**
 * Download runtime ML weights (no Python). Used after release install / auto-update.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const modelsDir = path.join(root, 'server', 'models');
const faceApiDir = path.join(modelsDir, 'face-api');

const downloads = [
  {
    dest: path.join(modelsDir, 'blaze_face_full_range.tflite'),
    url: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite',
  },
  {
    dest: path.join(modelsDir, 'yolov8n.pt'),
    url: 'https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n.pt',
  },
];

const faceApiBase = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model';
const faceApiFiles = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model.bin',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model.bin',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin',
];

async function fetchToFile(url, dest) {
  if (fs.existsSync(dest)) {
    console.log('skip', path.relative(root, dest));
    return;
  }
  console.log('download', path.relative(root, dest));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  fs.mkdirSync(faceApiDir, { recursive: true });
  for (const { url, dest } of downloads) {
    await fetchToFile(url, dest);
  }
  for (const file of faceApiFiles) {
    await fetchToFile(`${faceApiBase}/${file}`, path.join(faceApiDir, file));
  }
  console.log('Models ready in', path.relative(root, modelsDir));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
