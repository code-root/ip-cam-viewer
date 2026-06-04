#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VER="${1:-$(tr -d ' \n' < VERSION 2>/dev/null || echo 1.0.1)}"

if [[ -f "$ROOT/.env.release" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.release"
  set +a
fi

echo "==> v$VER — patch + build"
node scripts/patch-onvif-lib.js
npm run build

echo "==> zip"
python3 scripts/publish-release.py --version "$VER" --zip-only

if [[ -n "${EDGE_UPDATES_API:-}" && -n "${EDGE_UPDATES_TOKEN:-}" ]]; then
  echo "==> upload"
  python3 scripts/publish-release.py --version "$VER" \
    --api "$EDGE_UPDATES_API" \
    --token "$EDGE_UPDATES_TOKEN" \
    --notes "v${VER}: ONVIF fix, light edge, auto-update, per-camera credentials"
else
  echo "Upload: copy .env.release.example → .env.release then re-run, or:"
  echo "  python scripts/publish-release.py --version $VER --api URL --token TOKEN"
fi
