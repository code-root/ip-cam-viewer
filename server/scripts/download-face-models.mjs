import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dest = path.resolve(__dirname, '../models/face-api');
const base = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model';

const files = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model.bin',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model.bin',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin',
];

fs.mkdirSync(dest, { recursive: true });

for (const file of files) {
  const url = `${base}/${file}`;
  const out = path.join(dest, file);
  if (fs.existsSync(out)) {
    console.log('skip', file);
    continue;
  }
  console.log('download', file);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(out, buf);
}

console.log('Done. Models in', dest);
