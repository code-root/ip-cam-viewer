/**
 * Fix onvif@0.8.1 digest parser — malformed WWW-Authenticate crashes with null.slice.
 */
export function patchOnvifCam(): void {
  const { Cam } = require('onvif') as {
    Cam: { prototype: { _parseChallenge?: (digest: string) => Record<string, string> } };
  };
  const proto = Cam.prototype;
  if ((proto as { __digestPatched?: boolean }).__digestPatched) return;

  proto._parseChallenge = function (digest: string) {
    if (!digest || typeof digest !== 'string') return {};
    const prefix = 'Digest ';
    const idx = digest.indexOf(prefix);
    if (idx < 0) return {};
    const challenge = digest.substring(idx + prefix.length);
    const out: Record<string, string> = {};
    for (const part of challenge.split(',')) {
      const m = part.match(/^\s*?([a-zA-Z0-9]+)="?([^"]*)"?\s*?$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  };
  (proto as { __digestPatched?: boolean }).__digestPatched = true;
}
