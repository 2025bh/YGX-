@echo off
cd /d "%~dp0"
".venv\Scripts\python.exe" "prepare_lan.py"
".venv\Scripts\python.exe" "run.py" --lan
pause
