@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Please run the local setup first.
  pause
  exit /b 1
)
start "Quote Review" /min ".venv\Scripts\python.exe" "run.py"
timeout /t 2 /nobreak >nul
start "" "http://localhost:4188"
