#!/usr/bin/env bash
# macOS/Linux: يبني مشغّلاً محلياً (ليس .exe). لـ Windows استخدم build-windows.bat أو CI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
python3 -m pip install -q pyinstaller
python3 -m PyInstaller \
  --noconfirm \
  --onefile \
  --windowed \
  --name CompanyEdgeLauncher \
  --distpath "$ROOT/dist-launcher" \
  --workpath "$ROOT/scripts/company-edge-gui/build" \
  --specpath "$ROOT/scripts/company-edge-gui" \
  --hidden-import edge_agent \
  --hidden-import edge_ws \
  --hidden-import camera_panel \
  --collect-all socketio \
  --collect-all engineio \
  "$ROOT/scripts/company-edge-gui/app.py"
echo "Built: $ROOT/dist-launcher/CompanyEdgeLauncher"
