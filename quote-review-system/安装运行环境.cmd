@echo off
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  echo Python 3.12 or later is required.
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 or later is required.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" python -m venv .venv
if errorlevel 1 exit /b 1
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 exit /b 1
call npm ci --ignore-scripts
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
echo Setup complete. Open the launcher to start the review app.
pause
