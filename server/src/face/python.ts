import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { config } from '../config.js';

let resolvedPython: string | null = null;
let resolveLogged = false;

function exists(file: string): boolean {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

/** Python interpreters to try (first with face_recognition wins). */
export function getPythonCandidates(): string[] {
  const root = config.root;
  const candidates: string[] = [];

  if (config.pythonBin) {
    candidates.push(config.pythonBin);
    if (!path.isAbsolute(config.pythonBin)) {
      candidates.push(path.join(root, config.pythonBin));
    }
  }

  if (process.env.VIRTUAL_ENV) {
    candidates.push(path.join(process.env.VIRTUAL_ENV, 'bin', 'python3'));
    candidates.push(path.join(process.env.VIRTUAL_ENV, 'bin', 'python'));
  }

  candidates.push(
    path.join(root, '.venv', 'bin', 'python3'),
    path.join(root, '.venv', 'bin', 'python'),
    path.join(root, 'venv', 'bin', 'python3'),
    'python3',
    'python'
  );

  const normalized = candidates
    .filter(Boolean)
    .map((bin) => {
      if (path.isAbsolute(bin)) return bin;
      if (bin.includes('/')) return path.resolve(root, bin);
      return bin;
    });

  return [...new Set(normalized)];
}

function runImportCheck(pythonBin: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const code =
      'import face_recognition_models, face_recognition; import numpy, PIL; print("ok")';
    const proc = spawn(pythonBin, ['-c', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => {
      out += d.toString();
    });
    proc.stderr.on('data', (d) => {
      err += d.toString();
    });
    proc.on('error', (e) => resolve({ ok: false, detail: String(e) }));
    proc.on('close', (code) => {
      if (code === 0 && out.includes('ok')) resolve({ ok: true, detail: pythonBin });
      else resolve({ ok: false, detail: err.trim() || `exit ${code}` });
    });
  });
}

/** Resolve a Python binary that has face_recognition installed. */
export async function resolvePythonBin(): Promise<string | null> {
  if (resolvedPython) return resolvedPython;

  const tried: Array<{ bin: string; error: string }> = [];

  for (const bin of getPythonCandidates()) {
    if (bin.includes('/') && !exists(bin)) continue;

    const { ok, detail } = await runImportCheck(bin);
    if (ok) {
      resolvedPython = bin;
      if (!resolveLogged) {
        console.log(`[face] Using Python: ${bin}`);
        resolveLogged = true;
      }
      return bin;
    }
    tried.push({ bin, error: detail.slice(0, 200) });
  }

  if (!resolveLogged) {
    console.warn('[face] No Python with face_recognition found. Tried:', tried.map((t) => t.bin).join(', '));
    resolveLogged = true;
  }
  return null;
}

export function resetPythonCache(): void {
  resolvedPython = null;
  resolveLogged = false;
}
