@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo ========================================
echo  Rebuild server + patch ONVIF library
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not installed
  pause
  exit /b 1
)

echo [1/3] Patch onvif library...
node scripts\patch-onvif-lib.js
if errorlevel 1 pause

echo.
echo [2/3] Build server...
call npm run build
if errorlevel 1 (
  echo [ERROR] Build failed
  pause
  exit /b 1
)

echo.
echo [3/3] Done. Restart START-CAMERA-GUI.bat
pause
