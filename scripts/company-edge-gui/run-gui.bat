@echo off
chcp 65001 >nul 2>&1
REM شغّل من جذر المشروع عبر START-CAMERA-GUI.bat — أو نفّذ هنا بعد cd إلى هذا المجلد

cd /d "%~dp0"
set "ROOT=%~dp0..\.."
if exist "%ROOT%\package.json" cd /d "%ROOT%"

set "PY=py -3"
py -3 --version >nul 2>&1
if errorlevel 1 set "PY=python"
%PY% --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python is not installed. Install from python.org
  pause
  exit /b 1
)

echo Installing: scripts\company-edge-gui\requirements.txt
%PY% -m pip install -r "scripts\company-edge-gui\requirements.txt"
if errorlevel 1 pause

echo Starting GUI...
%PY% "scripts\company-edge-gui\app.py"
pause
