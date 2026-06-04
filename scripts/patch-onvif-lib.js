#!/usr/bin/env node
/**
 * Patch node_modules/onvif digest parser (null.slice crash).
 * Safe to run multiple times. Run after npm install: node scripts/patch-onvif-lib.js
 */
const fs = require('fs');
const path = require('path');

const camPath = path.join(__dirname, '..', 'node_modules', 'onvif', 'lib', 'cam.js');
if (!fs.existsSync(camPath)) {
  console.log('[patch-onvif] onvif not installed — skip');
  process.exit(0);
}

let src = fs.readFileSync(camPath, 'utf8');
const marker = '__digestPatchedIpCam';
if (src.includes(marker)) {
  console.log('[patch-onvif] already patched');
  process.exit(0);
}

const oldFn = `Cam.prototype._parseChallenge = function(digest) {
\tconst prefix = 'Digest ';
\tconst challenge = digest.substring(digest.indexOf(prefix) + prefix.length);
\tconst parts = challenge.split(',')
\t\t.map(part => part.match(/^\\s*?([a-zA-Z0-9]+)="?([^"]*)"?\\s*?$/).slice(1));
\treturn Object.fromEntries(parts);
};`;

const newFn = `Cam.prototype._parseChallenge = function(digest) { /* ${marker} */
\tif (!digest || typeof digest !== 'string') return {};
\tconst prefix = 'Digest ';
\tconst idx = digest.indexOf(prefix);
\tif (idx < 0) return {};
\tconst challenge = digest.substring(idx + prefix.length);
\tconst out = {};
\tfor (const part of challenge.split(',')) {
\t\tconst m = part.match(/^\\s*?([a-zA-Z0-9]+)="?([^"]*)"?\\s*?$/);
\t\tif (m) out[m[1]] = m[2];
\t}
\treturn out;
};`;

const legacyRe =
  /Cam\.prototype\._parseChallenge = function\(digest\) \{[\s\S]*?return Object\.fromEntries\(parts\);\r?\n\};/;

if (src.includes(marker)) {
  console.log('[patch-onvif] already patched');
  process.exit(0);
}

if (src.includes(oldFn)) {
  src = src.replace(oldFn, newFn);
} else if (legacyRe.test(src)) {
  src = src.replace(legacyRe, newFn);
} else {
  console.warn('[patch-onvif] cam.js format changed — manual check needed');
  process.exit(1);
}

fs.writeFileSync(camPath, src);
console.log('[patch-onvif] patched', camPath);
