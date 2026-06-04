@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo ========================================
echo  IP Camera Viewer - Company Edge GUI
echo ========================================
echo.
echo Project folder: %CD%
echo.
echo Tip: Right-click this file - Run as administrator
echo      to disable Windows Defender and free CPU on first start.
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [NOTE] Not running as Admin — Windows Security may stay on.
) else (
  echo [OK] Running as Administrator.
)
echo.

if not exist "scripts\company-edge-gui\app.py" (
  echo [ERROR] Wrong folder. Run this file from the project root ^(where package.json is^).
  pause
  exit /b 1
)

if not exist "scripts\company-edge-gui\requirements.txt" (
  echo [ERROR] Missing scripts\company-edge-gui\requirements.txt
  echo Copy the latest project files and try again.
  pause
  exit /b 1
)

set "PY=py -3"
py -3 --version >nul 2>&1
if errorlevel 1 set "PY=python"
%PY% --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python is not installed.
  echo Download from https://www.python.org/ and check "Add Python to PATH".
  pause
  exit /b 1
)

where node >nul 2>&1
if not errorlevel 1 (
  echo [0/3] Patch ONVIF + quick server check...
  node scripts\patch-onvif-lib.js 2>nul
  if exist "server\dist\index.js" (
    echo Server build OK
  ) else (
    echo [WARN] Run REBUILD-SERVER.bat once after copying new files
  )
  echo.
)

echo [1/3] Installing Python packages ^(python-socketio^)...
%PY% -m pip install -r "scripts\company-edge-gui\requirements.txt"
if errorlevel 1 (
  echo.
  echo [WARNING] pip failed. Try manually:
  echo   %PY% -m pip install "python-socketio[client]"
  pause
)

echo.
echo [2/3] Starting GUI ^(checks API updates, rebuild if needed^)...
%PY% "scripts\company-edge-gui\app.py"
if errorlevel 5 exit /b 0
pause
