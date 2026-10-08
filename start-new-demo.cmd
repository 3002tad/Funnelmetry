@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\new-demo.ps1" -Action start
if errorlevel 1 pause
