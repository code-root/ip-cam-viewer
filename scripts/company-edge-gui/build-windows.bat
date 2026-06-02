@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"
set "ROOT=%~dp0..\.."
cd /d "%ROOT%"

echo ========================================
echo  بناء CompanyEdgeLauncher.exe
echo ========================================
echo.

where python >nul 2>&1 || (
  echo [ERROR] Python غير مثبت — https://www.python.org/downloads/
  pause
  exit /b 1
)

python -m pip install --upgrade pip
python -m pip install -r "%~dp0requirements-build.txt"
if errorlevel 1 goto :fail

echo.
echo جاري البناء ^(دقيقة أو دقيقتان^)...
python -m PyInstaller ^
  --noconfirm ^
  --onefile ^
  --windowed ^
  --name CompanyEdgeLauncher ^
  --distpath "%ROOT%\dist-launcher" ^
  --workpath "%~dp0build" ^
  --specpath "%~dp0" ^
  "%~dp0app.py"

if errorlevel 1 goto :fail

echo.
echo ========================================
echo  تم: %ROOT%\dist-launcher\CompanyEdgeLauncher.exe
echo ========================================
echo.
echo انسخ CompanyEdgeLauncher.exe إلى مجلد ip-cam-viewer
echo ^(نفس المجلد الذي فيه package.json^)
echo ثم شغّله بالنقر المزدوج.
echo.
pause
exit /b 0

:fail
echo [ERROR] فشل البناء
pause
exit /b 1
