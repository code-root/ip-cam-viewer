@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0.."
set "ROOT=%CD%"

echo ========================================
echo  IP Camera Viewer - Windows setup
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install from nodejs.org
  pause
  exit /b 1
)

if not exist "%ROOT%\.env" (
  echo Creating .env from .env.example ...
  copy /Y "%ROOT%\.env.example" "%ROOT%\.env" >nul
  echo Update JWT_SECRET and ENCRYPTION_KEY in .env before production use.
)

echo Installing npm packages...
call npm install
if errorlevel 1 goto :fail
call npm install http-proxy@^1.18.1 -w server
if errorlevel 1 goto :fail

echo.
echo Setting up database...
call npm run db:generate
if errorlevel 1 goto :fail

cd /d "%ROOT%\server"
set "DATABASE_URL=file:./data/app.db"
call npx prisma migrate deploy
if errorlevel 1 goto :fail
cd /d "%ROOT%"

call npm run db:seed
if errorlevel 1 goto :fail

echo.
echo Installing go2rtc (streaming)...
node scripts\install-go2rtc.mjs
if errorlevel 1 echo [WARN] go2rtc install failed — download manually or set GO2RTC_BIN in .env

echo.
echo Face recognition (optional, may take several minutes)...
set /p FACE_SETUP="Run face detection setup now? [Y/n] "
if /I "%FACE_SETUP%"=="n" goto :done
call "%ROOT%\scripts\setup-face-python.bat"

:done
echo.
echo ========================================
echo  Done.
echo ========================================
echo  Development:  npm run dev
echo    Web UI:  http://localhost:5173
echo    API:     http://localhost:3000
echo.
echo  Company PC (production, one port):
echo    scripts\start-company-edge.bat
echo    Web+API+WebSocket: http://YOUR-LAN-IP:3000
echo  Login:   admin / admin123
echo.
echo  Add to .env if not already set:
echo    GO2RTC_BIN=./bin/go2rtc.exe
echo    PYTHON_BIN=.venv\Scripts\python.exe
echo.
pause
exit /b 0

:fail
echo.
echo [ERROR] Setup failed.
pause
exit /b 1
