@echo off
setlocal
chcp 65001 >nul 2>&1

cd /d "%~dp0.."
set "ROOT=%CD%"
set "VENV_PY=%ROOT%\.venv\Scripts\python.exe"
set "SCRIPT=%ROOT%\server\scripts\detect_faces.py"

if "%~1"=="" (
  echo Usage: %~nx0 ^<image_path^>
  echo Example: %~nx0 C:\photos\test.jpg
  echo.
  echo First-time setup: run setup-face-python.bat
  pause
  exit /b 1
)

if not exist "%VENV_PY%" (
  echo Virtual environment not found. Running setup first...
  call "%~dp0setup-face-python.bat"
  if errorlevel 1 exit /b 1
)

if not exist "%SCRIPT%" (
  echo [ERROR] Script not found: %SCRIPT%
  pause
  exit /b 1
)

set "FACE_MODELS_DIR=%ROOT%\server\models"
"%VENV_PY%" "%SCRIPT%" "%~1"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if %EXIT_CODE% neq 0 (
  echo Detection finished with errors (exit %EXIT_CODE%).
) else (
  echo Done.
)
pause
exit /b %EXIT_CODE%
