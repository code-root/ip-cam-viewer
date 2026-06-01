@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0.."
node scripts\install-go2rtc.mjs
if errorlevel 1 pause
exit /b %ERRORLEVEL%
