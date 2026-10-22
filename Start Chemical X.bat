@echo off
cd /d "%~dp0"
if not exist scripts\launch.js (
  echo Extract the entire ZIP first, then open this launcher inside the extracted folder.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 24.5 or newer from https://nodejs.org/ and reopen this launcher.
  pause
  exit /b 1
)
node scripts\launch.js
if errorlevel 1 (
  echo Startup failed. Copy the error above.
  pause
  exit /b 1
)
