@echo off
node "%~dp0runtime\teammate-demo.mjs" stop
if errorlevel 1 pause
