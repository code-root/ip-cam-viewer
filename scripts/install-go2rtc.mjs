#!/usr/bin/env node
/**
 * Download go2rtc for the current OS (macOS, Linux, Windows).
 */
import { execSync } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const binDir = path.join(root, 'bin');
const tmpDir = path.join(root, '.tmp-go2rtc');

const isWin = process.platform === 'win32';
const arch = process.arch;

function assetName() {
  if (isWin) {
    return arch === 'arm64' ? 'go2rtc_win_arm64.zip' : 'go2rtc_win64.zip';
  }
  if (process.platform === 'darwin') {
    return arch === 'arm64' ? 'go2rtc_mac_arm64.zip' : 'go2rtc_mac_amd64.zip';
  }
  return arch === 'arm64' ? 'go2rtc_linux_arm64.zip' : 'go2rtc_linux_amd64.zip';
}

function binaryName() {
  return isWin ? 'go2rtc.exe' : 'go2rtc';
}

async function latestTag() {
  const res = await fetch('https://api.github.com/repos/AlexxIT/go2rtc/releases/latest');
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const json = await res.json();
  return json.tag_name;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  await pipeline(res.body, createWriteStream(dest));
}

function extractZip(zipPath, outDir) {
  if (isWin) {
    const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`;
    execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'inherit' });
    return;
  }
  execSync(`unzip -o "${zipPath}" -d "${outDir}"`, { stdio: 'inherit' });
}

async function findBinary(dir, name) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name === name) return full;
    if (e.isDirectory()) {
      const nested = await findBinary(full, name);
      if (nested) return nested;
    }
  }
  return null;
}

async function main() {
  const zip = assetName();
  const tag = await latestTag();
  const url = `https://github.com/AlexxIT/go2rtc/releases/download/${tag}/${zip}`;
  const destBin = path.join(binDir, binaryName());

  await fsp.mkdir(binDir, { recursive: true });
  await fsp.rm(tmpDir, { recursive: true, force: true });
  await fsp.mkdir(tmpDir, { recursive: true });

  const zipPath = path.join(tmpDir, zip);
  console.log(`Downloading ${url} ...`);
  await download(url, zipPath);
  extractZip(zipPath, tmpDir);

  const found = await findBinary(tmpDir, binaryName());
  if (!found) throw new Error(`${binaryName()} not found inside ${zip}`);

  await fsp.copyFile(found, destBin);
  if (!isWin) await fsp.chmod(destBin, 0o755);

  await fsp.rm(tmpDir, { recursive: true, force: true });

  console.log(`Installed: ${destBin} (${tag})`);
  try {
    execSync(`"${destBin}" -version`, { stdio: 'inherit' });
  } catch {
    try {
      execSync(`"${destBin}" --version`, { stdio: 'inherit' });
    } catch {
      /* optional */
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
