# Company Edge GUI / EXE

Windows desktop app to run **IP Camera Viewer** on a company PC (local RTSP cameras + web UI + WebSocket + AI).

**Full install guide (English):** [../../INSTALL-COMPANY-GUI.md](../../INSTALL-COMPANY-GUI.md)

## Quick run

Double-click from project root:

```bat
START-CAMERA-GUI.bat
```

Or manually:

```bat
cd C:\path\to\ip-cam-viewer-main
pip install -r scripts\company-edge-gui\requirements.txt
python scripts\company-edge-gui\app.py
```

## Build EXE

On Windows:

```bat
scripts\company-edge-gui\build-windows.bat
```

Output: `dist-launcher\CompanyEdgeLauncher.exe` — copy next to `package.json`.

## GUI actions

| Button | Action |
|--------|--------|
| **Initial setup** | `npm install`, build client/server, go2rtc, database |
| **Start server** | Node on port 3000 (UI + API + WS + go2rtc) |
| **Discover and link cameras** | Auto-discover and provision all cameras |
| **Camera wizard** | ① Scan ② Test login ③ Stream + WebSocket |
| **Stop** | Stop server |
| **Open browser** | `http://PC-LAN-IP:3000` |

## Requirements

- Windows 10/11
- Node.js LTS
- Python 3.10+
- FFmpeg in PATH (recordings)

## Network

- Cameras must be visible from the **same PC** running this app.
- Remote access: VPN only — do not expose RTSP to the internet.
