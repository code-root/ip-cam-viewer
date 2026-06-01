import path from 'path';

export const isWindows = process.platform === 'win32';

export const defaultGo2rtcRel = isWindows ? 'bin/go2rtc.exe' : 'bin/go2rtc';

export const defaultPythonRel = isWindows ? '.venv/Scripts/python.exe' : '.venv/bin/python3';

/** Relative path shown in API / UI when PYTHON_BIN is unset. */
export const defaultPythonDisplay = defaultPythonRel.replace(/\\/g, '/');

export const faceSetupCommand = isWindows
  ? 'scripts\\setup-face-python.bat'
  : 'bash scripts/setup-face-python.sh';

export function portInUseHint(port: number): string {
  return isWindows ? `netstat -ano | findstr :${port}` : `lsof -i :${port}`;
}

export function venvPythonPaths(root: string): string[] {
  if (isWindows) {
    return [
      path.join(root, '.venv', 'Scripts', 'python.exe'),
      path.join(root, '.venv', 'Scripts', 'python'),
      path.join(root, 'venv', 'Scripts', 'python.exe'),
    ];
  }
  return [
    path.join(root, '.venv', 'bin', 'python3'),
    path.join(root, '.venv', 'bin', 'python'),
    path.join(root, 'venv', 'bin', 'python3'),
  ];
}

export function virtualEnvPythonPaths(venvRoot: string): string[] {
  if (isWindows) {
    return [
      path.join(venvRoot, 'Scripts', 'python.exe'),
      path.join(venvRoot, 'Scripts', 'python'),
    ];
  }
  return [
    path.join(venvRoot, 'bin', 'python3'),
    path.join(venvRoot, 'bin', 'python'),
  ];
}

/** True when the candidate looks like a filesystem path (not a PATH lookup name). */
export function isFilesystemPythonCandidate(bin: string): boolean {
  return path.isAbsolute(bin) || bin.includes(path.sep) || bin.includes('/');
}
