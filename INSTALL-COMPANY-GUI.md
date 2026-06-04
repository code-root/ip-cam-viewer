# Company Edge GUI — Full Installation (Windows)

Run everything from the **project root** (the folder that contains `package.json`).

Example path:

`C:\Users\CEO Mostafa Elbagory\Desktop\ip-cam-viewer-main`

---

## 1. Prerequisites

Install these once on the company PC:

| Software | Download | Notes |
|----------|----------|--------|
| **Python 3.10+** | https://www.python.org/downloads/ | Check **"Add python.exe to PATH"** during setup |
| **Node.js LTS** | https://nodejs.org/ | Required for the server (API + web UI + streams) |
| **FFmpeg** | https://ffmpeg.org/download.html | Add `ffmpeg` to PATH (for recording) |

Optional: Python `.venv` for face recognition — run `scripts\setup-face-python.bat` later.

---

## 2. Windows performance (optional, company PC only)

On a **dedicated** camera server PC, run **once as Administrator**:

```bat
OPTIMIZE-WINDOWS-EDGE.bat
```

Or right-click **`START-CAMERA-GUI.bat`** → **Run as administrator**.

This will (when `EDGE_DISABLE_DEFENDER=true` in `.env`):

- Add Windows Defender **exclusions** for the project, Node, go2rtc, FFmpeg
- Turn off Defender **real-time scanning** (less CPU while streaming)
- Stop heavy background apps (Teams, OneDrive, etc. — configurable)

**Security warning:** Only do this on a PC used only for cameras, on a trusted LAN, behind VPN for remote access. Do not disable Defender on a general office laptop.

In `.env`:

```env
EDGE_WINDOWS_OPTIMIZE=true
EDGE_DISABLE_DEFENDER=true
EDGE_STOP_PROCESSES=OneDrive,MicrosoftTeams,GameBar
```

---

## 3. Quick start (recommended)

1. Open the project folder in File Explorer.
2. Double-click:

   **`START-CAMERA-GUI.bat`**

   This will:
   - Install `python-socketio` (WebSocket client)
   - Launch the desktop GUI

---

## 4. Manual install (Command Prompt)

Open **cmd** and run **one command per line** (press Enter after each line).

```bat
cd "C:\Users\CEO Mostafa Elbagory\Desktop\ip-cam-viewer-main"
```

```bat
pip install -r scripts\company-edge-gui\requirements.txt
```

```bat
scripts\company-edge-gui\run-gui.bat
```

Or:

```bat
python scripts\company-edge-gui\app.py
```

**Do not paste two commands on one line.** Wrong:

```bat
pip install -r scripts\company-edge-gui\requirements.txtscripts\company-edge-gui\run-gui.bat
```

Correct: two separate lines (see above).

---

## 5. First-time server setup (inside the GUI)

1. Click **Initial setup** — runs `npm install`, builds the app, installs go2rtc, database.
2. Wait until the log says setup is complete.
3. Click **Start server** — listens on port **3000**.
4. Use the **Camera wizard** (low CPU / light mode):
   - **Host API:** `http://127.0.0.1:3000` (starts Node server automatically if stopped)
   - Enter camera + API username/password
   - **① Discover** — light ONVIF scan only (no full subnet scan)
   - Select camera → **② Test login** → **③ Stream API** (real-time WebSocket)
   - Or **▶ All for selected** — runs test + stream in one step

5. Open in browser: `http://YOUR-PC-LAN-IP:3000`

---

## 6. Environment file (optional)

Copy the example env file:

```bat
copy .env.company-edge.example .env
```

Edit `.env` for camera credentials:

```env
EDGE_CAMERA_USERNAME=admin
EDGE_CAMERA_PASSWORD=admin123
EDGE_API_USERNAME=admin
EDGE_API_PASSWORD=admin123
EDGE_AUTO_PROVISION=true
```

---

## 7. Build standalone EXE (optional)

On Windows only:

```bat
cd "C:\Users\CEO Mostafa Elbagory\Desktop\ip-cam-viewer-main"
scripts\company-edge-gui\build-windows.bat
```

Output:

`dist-launcher\CompanyEdgeLauncher.exe`

Copy **`CompanyEdgeLauncher.exe`** next to **`package.json`**, then run it.

---

## 8. Remote access (host PC)

- Cameras stay on the local LAN (`192.168.x.x`).
- The company PC runs the server and pulls RTSP locally.
- Remote viewers use **VPN** (e.g. Tailscale) and open:

  `http://COMPANY-PC-IP:3000`

- Do **not** expose RTSP ports to the internet.

---

## 9. Troubleshooting

| Problem | Fix |
|---------|-----|
| `Could not open requirements file` | You are in the wrong folder, or two commands were pasted as one line. Use section 3. |
| `requirements.txt` missing | Update/copy the full project from the latest source. |
| `Python is not installed` | Install Python and enable PATH. |
| `Node.js` missing in GUI | Install Node LTS, restart cmd, run **Initial setup** again. |
| `pip` user install warning | Normal on Windows; not an error. |
| Server won't start | Run **Initial setup** first; check log in the GUI. |
| Camera test fails | Check username/password; camera must be on the same LAN as this PC. |
| WebSocket not connected | Run: `pip install "python-socketio[client]"` then restart the GUI. |

---

## 10. File map

```
ip-cam-viewer-main/
  package.json
  START-CAMERA-GUI.bat          ← double-click to install + run GUI
  INSTALL-COMPANY-GUI.md        ← this guide
  scripts/
    company-edge-gui/
      app.py                    ← main GUI
      requirements.txt          ← pip: python-socketio
      run-gui.bat
      build-windows.bat         ← build EXE
```
