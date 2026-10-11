@echo off
node "%~dp0runtime\teammate-demo.mjs" watchdog
if errorlevel 1 pause
