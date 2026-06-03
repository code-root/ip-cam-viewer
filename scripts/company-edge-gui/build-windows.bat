@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

REM Double-click this file. Do NOT paste lines into CMD.

cd /d "%~dp0"
set "GUI=%~dp0"
if "!GUI:~-1!"=="\" set "GUI=!GUI:~0,-1!"

set "ROOT="
for /L %%i in (1,1,6) do (
  if exist "!CD!\package.json" (
    set "ROOT=!CD!"
    goto :root_ok
  )
  cd ..
)

echo [ERROR] package.json not found.
echo Put the full project on Desktop, then double-click build-windows.bat
pause
exit /b 1

:root_ok
echo ========================================
echo  Build CompanyEdgeLauncher.exe
echo ========================================
echo.
echo Project: !ROOT!
echo.

where py >nul 2>&1
if not errorlevel 1 (
  set "PY_LAUNCHER=py"
  set "PY_VER=-3"
  goto :py_ok
)
where python >nul 2>&1
if not errorlevel 1 (
  set "PY_LAUNCHER=python"
  set "PY_VER="
  goto :py_ok
)
echo [ERROR] Python not installed. Install from python.org - Add to PATH
pause
exit /b 1

:py_ok
echo Python: !PY_LAUNCHER! !PY_VER!
echo.

!PY_LAUNCHER! !PY_VER! -m pip install --upgrade pip
if errorlevel 1 goto :fail

!PY_LAUNCHER! !PY_VER! -m pip install -r "!GUI!\requirements-build.txt"
if errorlevel 1 goto :fail

if not exist "!ROOT!\dist-launcher" mkdir "!ROOT!\dist-launcher"

set "SCRIPT=!GUI!\app.py"
set "WORKDIR=!GUI!\build"
set "SPECDIR=!GUI!\."

echo Building EXE (1-2 min)...
!PY_LAUNCHER! !PY_VER! -m PyInstaller --noconfirm --onefile --windowed --name CompanyEdgeLauncher --distpath "!ROOT!\dist-launcher" --workpath "!WORKDIR!" --specpath "!SPECDIR!" "!SCRIPT!"
if errorlevel 1 goto :fail

if not exist "!ROOT!\dist-launcher\CompanyEdgeLauncher.exe" (
  echo [ERROR] EXE not created.
  goto :fail
)

echo.
echo SUCCESS:
echo !ROOT!\dist-launcher\CompanyEdgeLauncher.exe
echo.
echo Copy the EXE next to package.json and run it.
pause
exit /b 0

:fail
echo.
echo [ERROR] Build failed.
pause
exit /b 1
