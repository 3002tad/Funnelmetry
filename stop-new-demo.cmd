@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\new-demo.ps1" -Action stop
if errorlevel 1 pause
