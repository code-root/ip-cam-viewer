@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
where python >nul 2>&1 || (
  echo ثبّت Python من https://www.python.org/
  pause
  exit /b 1
)
python "%~dp0app.py"
