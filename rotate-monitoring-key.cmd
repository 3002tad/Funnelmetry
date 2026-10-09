@echo off
cd /d "%~dp0"
node runtime\manage-monitoring-key.mjs rotate
if errorlevel 1 (
  echo Rotation did not complete. Read the reported stage; keep pending state.
  pause
  exit /b 1
)
pause
