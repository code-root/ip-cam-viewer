@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

set /p VER=Release version (e.g. 1.0.1): 
if "%VER%"=="" (
  echo Version required.
  pause
  exit /b 1
)

if "%EDGE_UPDATES_API%"=="" (
  set /p EDGE_UPDATES_API=API base URL (e.g. https://api.example.com/api/internal): 
)
if "%EDGE_UPDATES_TOKEN%"=="" (
  set /p EDGE_UPDATES_TOKEN=API x-api-key token: 
)

echo.
echo Publishing %VER% ...
python scripts\publish-release.py --version %VER% --api "%EDGE_UPDATES_API%" --token "%EDGE_UPDATES_TOKEN%"
pause
