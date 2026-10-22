@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 or newer, then open this launcher again.
  pause
  exit /b 1
)
node scripts\launch.js
if errorlevel 1 pause
