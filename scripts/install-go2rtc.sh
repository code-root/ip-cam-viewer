#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/bin"
TMP="$ROOT/.tmp-go2rtc"
mkdir -p "$BIN" "$TMP"

ARCH=$(uname -m)
OS=$(uname -s)
if [ "$OS" != "Darwin" ]; then
  echo "This script supports macOS only. For Linux see: https://github.com/AlexxIT/go2rtc/releases"
  exit 1
fi

if [ "$ARCH" = "arm64" ]; then
  ZIP="go2rtc_mac_arm64.zip"
else
  ZIP="go2rtc_mac_amd64.zip"
fi

VER=$(curl -s https://api.github.com/repos/AlexxIT/go2rtc/releases/latest | python3 -c "import json,sys; print(json.load(sys.stdin)['tag_name'])")
URL="https://github.com/AlexxIT/go2rtc/releases/download/${VER}/${ZIP}"

echo "Downloading $URL ..."
curl -fsSL "$URL" -o "$TMP/go2rtc.zip"
unzip -o "$TMP/go2rtc.zip" -d "$TMP"
mv "$TMP/go2rtc" "$BIN/go2rtc"
chmod +x "$BIN/go2rtc"
rm -rf "$TMP"

echo "Installed: $BIN/go2rtc ($VER)"
"$BIN/go2rtc" -version 2>/dev/null || "$BIN/go2rtc" --version 2>/dev/null || true
