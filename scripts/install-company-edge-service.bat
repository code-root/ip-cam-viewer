@echo off
chcp 65001 >nul 2>&1
REM إنشاء اختصار في مجلد بدء التشغيل لتشغيل الخادم عند فتح Windows
setlocal
cd /d "%~dp0.."
set "ROOT=%CD%"
set "START_BAT=%ROOT%\scripts\start-company-edge.bat"

echo سيُنشأ اختصار في Startup لتشغيل عارض الكاميرات تلقائياً.
set /p CONFIRM="متابعة؟ [Y/n] "
if /I "%CONFIRM%"=="n" exit /b 0

powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $startup = [Environment]::GetFolderPath('Startup'); ^
   $lnk = Join-Path $startup 'IP-Camera-Viewer-Edge.lnk'; ^
   $s = $ws.CreateShortcut($lnk); ^
   $s.TargetPath = '%START_BAT%'; ^
   $s.WorkingDirectory = '%ROOT%'; ^
   $s.WindowStyle = 7; ^
   $s.Description = 'IP Camera Viewer company edge server'; ^
   $s.Save(); ^
   Write-Host 'تم:' $lnk"

echo.
echo لإزالة التشغيل التلقائي: احذف الاختصار من
echo %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
pause
