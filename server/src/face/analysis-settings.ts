import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

export type FaceAnalysisMode = 'people_only' | 'people_and_objects';

const SETTINGS_PATH = path.join(config.root, 'data/face-analysis-settings.json');

let mode: FaceAnalysisMode =
  process.env.FACE_ANALYSIS_MODE === 'people_and_objects' ? 'people_and_objects' : 'people_only';

export function getFaceAnalysisMode(): FaceAnalysisMode {
  return mode;
}

export function sceneObjectsEnabled(): boolean {
  return mode === 'people_and_objects';
}

function applyToProcessEnv() {
  process.env.FACE_SCENE_OBJECTS = sceneObjectsEnabled() ? 'true' : 'false';
  process.env.FACE_FURNITURE_FILTER = 'true';
}

export async function loadFaceAnalysisSettings(): Promise<FaceAnalysisMode> {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { mode?: string };
    if (parsed.mode === 'people_and_objects' || parsed.mode === 'people_only') {
      mode = parsed.mode;
    }
  } catch {
    /* use env default */
  }
  applyToProcessEnv();
  return mode;
}

export async function setFaceAnalysisMode(next: FaceAnalysisMode): Promise<FaceAnalysisMode> {
  mode = next;
  applyToProcessEnv();
  await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  await fs.writeFile(SETTINGS_PATH, JSON.stringify({ mode }, null, 2), 'utf8');
  return mode;
}
