import { createRequire } from 'module';
import { decrypt } from '../lib/crypto.js';
import { patchOnvifCam } from './patch-cam.js';

const require = createRequire(import.meta.url);
patchOnvifCam();
const { Cam, Discovery } = require('onvif') as {
  Cam: new (
    options: { hostname: string; port?: number; username?: string; password?: string; path?: string },
    callback: (err: Error | null) => void
  ) => OnvifCam;
  Discovery: {
    probe: (
      options: { timeout?: number; resolve?: boolean },
      callback: (err: Error | null | Error[], cams: OnvifCam[]) => void
    ) => void;
  };
};

interface OnvifCam {
  hostname: string;
  port: number | string;
  name?: string;
  manufacturer?: string;
  getDeviceInformation: (cb: (err: Error | null, info: { manufacturer?: string; model?: string }) => void) => void;
  getCapabilities: (cb: (err: Error | null, caps: { PTZ?: unknown; audio?: unknown }) => void) => void;
  getProfiles: (cb: (err: Error | null, profiles: Array<{ token: string }>) => void) => void;
  getStreamUri: (opts: { protocol: string; profileToken: string }, cb: (err: Error | null, stream: { uri?: string }) => void) => void;
  continuousMove: (opts: object, cb: (err: Error | null) => void) => void;
  stop: (opts: object, cb: (err: Error | null) => void) => void;
  getPresets: (cb: (err: Error | null, presets: Record<string, OnvifPresetRaw>) => void) => void;
  gotoPreset: (opts: { preset: string }, cb: (err: Error | null) => void) => void;
  setPreset: (opts: { presetName: string }, cb: (err: Error | null, result: { preset?: { token?: string } }) => void) => void;
  getSnapshotUri: (cb: (err: Error | null, data: { uri?: string }) => void) => void;
}

type OnvifPresetRaw = { $?: { token?: string }; name?: string | { _?: string } };

export function normalizePresets(presets: unknown): Array<{ token: string; name?: string }> {
  if (!presets) return [];
  if (Array.isArray(presets)) {
    return presets.map((p) => ({
      token: (p as OnvifPresetRaw).$?.token || (p as { token?: string }).token || '',
      name: presetName(p as OnvifPresetRaw),
    })).filter((p) => p.token);
  }
  if (typeof presets === 'object') {
    return Object.entries(presets as Record<string, OnvifPresetRaw>).map(([key, p]) => ({
      token: p.$?.token || key,
      name: presetName(p),
    }));
  }
  return [];
}

function presetName(p: OnvifPresetRaw): string | undefined {
  if (typeof p.name === 'string') return p.name;
  if (p.name && typeof p.name === 'object' && typeof p.name._ === 'string') return p.name._;
  return undefined;
}

export interface OnvifDeviceInfo {
  manufacturer?: string;
  model?: string;
  rtspMain?: string;
  rtspSub?: string;
  supportsPtz: boolean;
  supportsAudio: boolean;
}

export interface ProbeAuthResult {
  info: OnvifDeviceInfo;
  /** Camera requires username/password for ONVIF/RTSP. */
  authRequired: boolean;
  /** Connection succeeded with the credentials the user entered. */
  credentialsUsed: boolean;
  effectiveUsername: string;
  effectivePassword: string;
}

/** ONVIF / HTTP errors that mean missing or wrong credentials. */
export function isAuthError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    /unauthorized|not authorized|notauthorized|authentication failed|invalid credentials|wrong password|access denied|authority failure|sender not authorized|invalid user(name)?|bad credentials|login failed|ter:notauthorized|notpermitted.*auth/i.test(
      msg
    ) ||
    /\b401\b|\b403\b/.test(msg) ||
    /soap fault.*(auth|authority|credential|denied|not authorized)/i.test(msg)
  );
}

/** User-facing message for ONVIF auth failures (Arabic-friendly via API codes). */
export function onvifAuthErrorCode(err: unknown): 'AUTH_REQUIRED' | 'AUTH_FAILED' | null {
  if (!isAuthError(err)) return null;
  const msg = String(err).toLowerCase();
  if (/authority failure|invalid credentials|wrong password|bad credentials|login failed|auth_failed/i.test(msg)) {
    return 'AUTH_FAILED';
  }
  return 'AUTH_REQUIRED';
}

/** onvif@0.8.1 can throw in digestAuth when WWW-Authenticate is malformed. */
function isOnvifDigestLibraryBug(err: unknown): boolean {
  const s = String(err);
  return /cannot read properties of null.*slice/i.test(s) || /reading 'slice'/i.test(s);
}

function normalizeConnectError(err: unknown): Error {
  if (isOnvifDigestLibraryBug(err)) {
    const e = new Error('Camera requires login — enter username and password');
    (e as Error & { code?: string }).code = 'AUTH_REQUIRED';
    return e;
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

function connectCam(host: string, port: number, username: string, password: string): Promise<OnvifCam> {
  return new Promise((resolve, reject) => {
    const fail = (err: unknown) => reject(normalizeConnectError(err));
    try {
      const cam = new Cam(
        { hostname: host, port, username, password },
        (err: Error | null) => (err ? fail(err) : resolve(cam))
      );
      void cam;
    } catch (err) {
      fail(err);
    }
  });
}

export interface DiscoverOptions {
  timeoutMs?: number;
  subnetScan?: boolean;
  subnets?: string[];
  perHostMs?: number;
  concurrency?: number;
}

export async function discoverDevices(
  options: DiscoverOptions = {}
): Promise<Array<{ host: string; port: number; name?: string; manufacturer?: string; source?: string }>> {
  const timeoutMs = options.timeoutMs ?? 10000;

  const multicast = await new Promise<
    Array<{ host: string; port: number; name?: string; manufacturer?: string; source: string }>
  >((resolve) => {
    /** resolve:false — do not open ONVIF sessions during scan (faster, fewer digest errors). */
    Discovery.probe({ timeout: timeoutMs, resolve: false }, (err, cams) => {
      const found: Array<{ host: string; port: number; name?: string; manufacturer?: string; source: string }> = [];
      const seen = new Set<string>();
      for (const cam of cams || []) {
        const host = cam.hostname;
        const port = parseInt(String(cam.port), 10) || 80;
        const key = `${host}:${port}`;
        if (!host || seen.has(key)) continue;
        seen.add(key);
        found.push({
          host,
          port,
          name: cam.name,
          manufacturer: cam.manufacturer,
          source: 'multicast',
        });
      }
      if (err && found.length === 0) {
        console.warn('[onvif] multicast discovery errors:', err);
      }
      resolve(found);
    });
  });

  if (options.subnetScan === false) return multicast;

  const { scanSubnetForOnvif, guessLocalSubnets, mergeDiscovered } = await import('./discovery-scan.js');

  let subnets = options.subnets?.filter(Boolean) ?? [];
  if (subnets.length === 0) {
    subnets = guessLocalSubnets();
  }

  const scanned: Array<{ host: string; port: number; name?: string; manufacturer?: string; source?: string }> = [];
  for (const spec of subnets) {
    try {
      const part = await scanSubnetForOnvif(spec, {
        perHostMs: options.perHostMs,
        concurrency: options.concurrency,
      });
      scanned.push(...part);
      console.log(`[onvif] subnet scan ${spec}: ${part.length} device(s)`);
    } catch (e) {
      console.warn(`[onvif] subnet scan failed for ${spec}:`, e);
    }
  }

  return mergeDiscovered([multicast, scanned]);
}

export async function probeCamera(
  host: string,
  onvifPort: number,
  username: string,
  passwordEnc: string
): Promise<OnvifDeviceInfo> {
  const password = decrypt(passwordEnc);
  return probeCameraPlain(host, onvifPort, username, password);
}

export async function probeCameraPlain(
  host: string,
  onvifPort: number,
  username: string,
  password: string
): Promise<OnvifDeviceInfo> {
  const cam = await connectCam(host, onvifPort, username, password);

  return new Promise((resolve, reject) => {
    cam.getDeviceInformation((err: Error | null, info: { manufacturer?: string; model?: string }) => {
      if (err) return reject(err);

      const result: OnvifDeviceInfo = {
        manufacturer: info?.manufacturer,
        model: info?.model,
        supportsPtz: false,
        supportsAudio: false,
      };

      cam.getCapabilities((capErr: Error | null, caps: { PTZ?: unknown; audio?: unknown }) => {
        if (!capErr && caps) {
          result.supportsPtz = !!caps.PTZ;
          result.supportsAudio = !!caps.audio;
        }

        cam.getProfiles((profErr: Error | null, profiles: Array<{ token: string; name?: string; videoEncoderConfiguration?: unknown }>) => {
          if (profErr || !profiles?.length) {
            return resolve(result);
          }

          const urls: string[] = [];
          let pending = profiles.length;

          profiles.forEach((profile, i) => {
            cam.getStreamUri(
              { protocol: 'RTSP', profileToken: profile.token },
              (uriErr: Error | null, stream: { uri?: string }) => {
                pending--;
                if (!uriErr && stream?.uri) {
                  urls.push(stream.uri);
                }
                if (pending === 0) {
                  if (urls[0]) result.rtspMain = urls[0];
                  if (urls[1]) result.rtspSub = urls[1];
                  else if (urls[0] && !result.rtspSub) result.rtspSub = urls[0];
                  resolve(result);
                }
              }
            );
            if (profiles.length === 0) resolve(result);
          });
        });
      });
    });
  });
}

/**
 * Try without credentials first, then with provided username/password if needed.
 */
export async function probeCameraWithAuthDetection(
  host: string,
  onvifPort: number,
  username: string,
  password: string
): Promise<ProbeAuthResult> {
  const user = (username || 'admin').trim();
  const pass = password ?? '';

  /** If user entered a password, connect once (avoids digest bugs on empty-auth probes). */
  const attempts: Array<[string, string]> = pass
    ? [[user, pass]]
    : [
        ['', ''],
        [user, ''],
      ];

  let lastAuthErr: unknown = null;

  for (const [u, p] of attempts) {
    try {
      const info = await probeCameraPlain(host, onvifPort, u, p);
      return {
        info,
        authRequired: false,
        credentialsUsed: false,
        effectiveUsername: u,
        effectivePassword: p,
      };
    } catch (e) {
      if (isAuthError(e)) {
        lastAuthErr = e;
        continue;
      }
      throw e;
    }
  }

  if (!pass) {
    const err = new Error('AUTH_REQUIRED');
    (err as Error & { code?: string }).code = 'AUTH_REQUIRED';
    throw err;
  }

  try {
    const info = await probeCameraPlain(host, onvifPort, user, pass);
    return {
      info,
      authRequired: true,
      credentialsUsed: true,
      effectiveUsername: user,
      effectivePassword: pass,
    };
  } catch (e) {
    if (isAuthError(e) || lastAuthErr) {
      const err = new Error('AUTH_FAILED');
      (err as Error & { code?: string }).code = 'AUTH_FAILED';
      throw err;
    }
    throw e;
  }
}

export async function ptzMove(
  host: string,
  onvifPort: number,
  username: string,
  passwordEnc: string,
  x: number,
  y: number,
  zoom: number,
  speed = 0.5
) {
  const password = decrypt(passwordEnc);
  const cam = await connectCam(host, onvifPort, username, password);
  return new Promise<void>((resolve, reject) => {
    cam.continuousMove({ x: x * speed, y: y * speed, zoom: zoom * speed }, (err: Error | null) =>
      err ? reject(err) : resolve()
    );
  });
}

export async function ptzStop(host: string, onvifPort: number, username: string, passwordEnc: string) {
  const password = decrypt(passwordEnc);
  const cam = await connectCam(host, onvifPort, username, password);
  return new Promise<void>((resolve, reject) => {
    cam.stop({ panTilt: true, zoom: true }, (err: Error | null) => (err ? reject(err) : resolve()));
  });
}

export async function getPresets(host: string, onvifPort: number, username: string, passwordEnc: string) {
  const password = decrypt(passwordEnc);
  const cam = await connectCam(host, onvifPort, username, password);
  return new Promise<Array<{ token: string; name?: string }>>((resolve, reject) => {
    cam.getPresets((err: Error | null, presets: Record<string, OnvifPresetRaw>) =>
      err ? reject(err) : resolve(normalizePresets(presets))
    );
  });
}

export async function gotoPreset(
  host: string,
  onvifPort: number,
  username: string,
  passwordEnc: string,
  presetToken: string
) {
  const password = decrypt(passwordEnc);
  const cam = await connectCam(host, onvifPort, username, password);
  return new Promise<void>((resolve, reject) => {
    cam.gotoPreset({ preset: presetToken }, (err: Error | null) => (err ? reject(err) : resolve()));
  });
}

export async function setPreset(
  host: string,
  onvifPort: number,
  username: string,
  passwordEnc: string,
  presetName: string
) {
  const password = decrypt(passwordEnc);
  const cam = await connectCam(host, onvifPort, username, password);
  return new Promise<string>((resolve, reject) => {
    cam.setPreset({ presetName }, (err: Error | null, result: { preset?: { token?: string } }) => {
      if (err) reject(err);
      else resolve(result?.preset?.token || '');
    });
  });
}

export async function getSnapshot(
  host: string,
  onvifPort: number,
  username: string,
  passwordEnc: string
): Promise<Buffer> {
  const password = decrypt(passwordEnc);
  const cam = await connectCam(host, onvifPort, username, password);
  return new Promise((resolve, reject) => {
    cam.getSnapshotUri((err: Error | null, data: { uri?: string }) => {
      if (err || !data?.uri) return reject(err || new Error('No snapshot URI'));
      const url = data.uri.replace(/:\/\/([^/]+)/, `://${username}:${encodeURIComponent(password)}@$1`);
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((buf) => resolve(Buffer.from(buf)))
        .catch(reject);
    });
  });
}
