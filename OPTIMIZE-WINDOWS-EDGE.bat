@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

:: Run as Administrator (needed to disable Defender / stop system apps)
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting Administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 0
)

echo ========================================
echo  IP Camera Viewer - Windows optimize
echo ========================================
echo.
echo Project: %CD%
echo.

set "PY=py -3"
py -3 --version >nul 2>&1
if errorlevel 1 set "PY=python"

set EDGE_WINDOWS_OPTIMIZE=true
set EDGE_DISABLE_DEFENDER=true

%PY% -c "from pathlib import Path; import sys; sys.path.insert(0, 'scripts/company-edge-gui'); from win_optimize import apply_windows_optimizations; apply_windows_optimizations(Path(r'%CD%'), print)"

echo.
echo Done. You can now run START-CAMERA-GUI.bat
pause
