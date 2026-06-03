@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion
cd /d "%~dp0.."
set "ROOT=%CD%"

title IP Camera Viewer - Company Edge

echo ========================================
echo  IP Camera Viewer - تشغيل جهاز الشركة
echo  UI + API + WebSocket + AI (محلي)
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed. Install from nodejs.org
  pause
  exit /b 1
)

if not exist "%ROOT%\.env" (
  if exist "%ROOT%\.env.company-edge.example" (
    echo إنشاء .env من .env.company-edge.example ...
    copy /Y "%ROOT%\.env.company-edge.example" "%ROOT%\.env" >nul
    echo عدّل JWT_SECRET و ENCRYPTION_KEY في .env قبل الاستخدام الفعلي.
  ) else (
    copy /Y "%ROOT%\.env.example" "%ROOT%\.env" >nul
  )
)

REM --- اكتشاف IP الشبكة المحلية للواجهة ---
set "LAN_IP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$ip = (Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.PrefixOrigin -ne 'WellKnown' -and $_.InterfaceAlias -notmatch 'vEthernet|Virtual|VPN' } ^| Select-Object -First 1 -ExpandProperty IPAddress); if ($ip) { $ip }"`) do set "LAN_IP=%%i"

if not defined LAN_IP (
  for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i /c:"IPv4"') do (
    set "LAN_IP=%%a"
    set "LAN_IP=!LAN_IP: =!"
    echo !LAN_IP! | findstr /r "^127\." >nul && set "LAN_IP=" && continue
    if defined LAN_IP goto :gotip
  )
)
:gotip

if not defined LAN_IP set "LAN_IP=localhost"

REM --- إعدادات التشغيل على جهاز الشركة ---
set "HOST=0.0.0.0"
set "PORT=3000"
set "SERVE_CLIENT=true"
set "NODE_ENV=production"
set "CLIENT_URL=http://!LAN_IP!:3000"
set "GO2RTC_BIN=%ROOT%\bin\go2rtc.exe"
set "PYTHON_BIN=%ROOT%\.venv\Scripts\python.exe"
set "DATABASE_URL=file:./server/data/app.db"

if not exist "%ROOT%\bin\go2rtc.exe" (
  echo [WARN] go2rtc.exe غير موجود — جاري التحميل...
  call npm run go2rtc:install
)

if not exist "%ROOT%\node_modules" (
  echo تثبيت الحزم npm...
  call npm install
  if errorlevel 1 goto :fail
)
if not exist "%ROOT%\node_modules\http-proxy" (
  echo تثبيت http-proxy ^(بروكسي البث^)...
  call npm install http-proxy@^1.18.1 -w server
  if errorlevel 1 goto :fail
)

if not exist "%ROOT%\client\dist\index.html" (
  echo بناء الواجهة والسيرفر ^(أول مرة قد تستغرق دقائق^)...
  call npm run build
  if errorlevel 1 goto :fail
) else (
  if /I "%~1"=="--rebuild" (
    call npm run build
    if errorlevel 1 goto :fail
  )
)

echo.
echo تطبيق قاعدة البيانات...
cd /d "%ROOT%\server"
call npx prisma migrate deploy
if errorlevel 1 goto :fail
cd /d "%ROOT%"

echo.
echo ========================================
echo  جاهز — افتح من أي جهاز على نفس الشبكة:
echo  %CLIENT_URL%
echo  تسجيل الدخول الافتراضي: admin / admin123
echo ========================================
echo.
echo  الكاميرات: يجب أن يرى هذا الجهاز RTSP المحلي ^(192.168.x.x^)
echo  من الإنترنت: استخدم VPN أو Cloudflare Tunnel ^(لا تفتح RTSP^)
echo.
echo  API:      http://127.0.0.1:3000/api/health
echo  WebSocket: نفس المنفذ 3000 ^(socket.io^)
echo  go2rtc:   داخلي 1984 — عبر /go2rtc من الواجهة
echo.
echo  اضغط Ctrl+C لإيقاف الخدمة
echo ========================================
echo.

node "%ROOT%\server\dist\index.js"
set "EXIT_CODE=!ERRORLEVEL!"
if !EXIT_CODE! neq 0 (
  echo.
  echo [ERROR] توقف السيرفر ^(رمز !EXIT_CODE!^)
  echo إن كان المنفذ 3000 مشغولاً: netstat -ano ^| findstr :3000
)
pause
exit /b %EXIT_CODE%

:fail
echo.
echo [ERROR] فشل التشغيل. جرّب: scripts\setup-windows.bat
pause
exit /b 1
