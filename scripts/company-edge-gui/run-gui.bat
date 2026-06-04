@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

set "PY=py -3"
py -3 --version >nul 2>&1
if errorlevel 1 set "PY=python"
%PY% --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python is not installed. Install from python.org
  pause
  exit /b 1
)

%PY% -m pip install -q -r "%~dp0requirements.txt" 2>nul
%PY% "%~dp0app.py"
pause
