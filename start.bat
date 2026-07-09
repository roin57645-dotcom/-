@echo off
cd /d "%~dp0"

echo Starting backend on port 8000...
start "backend" /d "%~dp0backend" cmd /k python main.py --port 8000

echo Starting frontend on port 3000...
start "frontend" /d "%~dp0frontend" cmd /k npm start

echo Done. Open http://localhost:3000 when ready.
pause
