@echo off
node "%~dp0runtime\teammate-demo.mjs" start
if errorlevel 1 pause
