@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1

REM ينتقل إلى جذر المشروع (ip-cam-viewer)
cd /d "%~dp0.."
set "ROOT=%CD%"

echo ========================================
echo  IP Camera Viewer - Face Detection (Windows)
echo ========================================
echo Project: %ROOT%
echo.

REM --- البحث عن Python 3 ---
set "PY="
where py >nul 2>&1 && (
  py -3 -c "import sys" >nul 2>&1 && set "PY=py -3"
)
if not defined PY where python >nul 2>&1 && (
  python -c "import sys; exit(0 if sys.version_info[0]>=3 else 1)" >nul 2>&1 && set "PY=python"
)
if not defined PY where python3 >nul 2>&1 && set "PY=python3"

if not defined PY (
  echo [ERROR] Python 3 not found.
  echo Install from https://www.python.org/ and enable "Add Python to PATH".
  pause
  exit /b 1
)

echo Using: %PY%
%PY% --version
echo.

REM --- بيئة افتراضية ---
set "VENV_PY=%ROOT%\.venv\Scripts\python.exe"
set "VENV_PIP=%ROOT%\.venv\Scripts\pip.exe"

if not exist "%VENV_PY%" (
  echo Creating virtual environment at %ROOT%\.venv ...
  %PY% -m venv "%ROOT%\.venv"
  if errorlevel 1 (
    echo [ERROR] Failed to create venv.
    pause
    exit /b 1
  )
)

echo Upgrading pip and installing packages...
echo (face_recognition may take several minutes on first install)
"%VENV_PIP%" install --upgrade pip "setuptools<81"
if errorlevel 1 goto :pip_fail

"%VENV_PIP%" install face_recognition pillow numpy opencv-python-headless mediapipe ultralytics
if errorlevel 1 goto :pip_fail

goto :after_pip

:pip_fail
echo.
echo [ERROR] pip install failed.
echo On Windows, face_recognition needs dlib. Try:
echo   1. Install "Visual Studio Build Tools" with C++ workload, OR
echo   2. pip install cmake then pip install dlib then run this script again.
echo.
pause
exit /b 1

:after_pip
echo.

REM --- تحميل النماذج ---
set "MODELS_DIR=%ROOT%\server\models"
echo Downloading detection models...
"%VENV_PY%" "%ROOT%\scripts\download_face_models.py"
if errorlevel 1 echo [WARN] Model download had issues; retry or check network.

echo.
echo Verifying imports...
"%VENV_PY%" -c "import face_recognition, mediapipe, cv2; from ultralytics import YOLO; print('face_recognition OK'); print('mediapipe OK'); print('ultralytics OK')"
if errorlevel 1 (
  echo [ERROR] Import verification failed.
  pause
  exit /b 1
)

echo.
echo ========================================
echo  Setup complete.
echo ========================================
echo Add to .env:
echo   PYTHON_BIN=.venv\Scripts\python.exe
echo   FACE_PERSON_DETECT=true
echo   FACE_MODELS_DIR=./server/models
echo.
echo To test detection, run:
echo   scripts\run-detect-faces.bat path\to\image.jpg
echo.

REM إذا مُرّر مسار صورة كوسيط، شغّل الكشف مباشرة
if not "%~1"=="" (
  echo Running detect_faces.py on: %~1
  echo.
  set "FACE_MODELS_DIR=%MODELS_DIR%"
  "%VENV_PY%" "%ROOT%\server\scripts\detect_faces.py" "%~1"
  echo.
)

pause
endlocal
