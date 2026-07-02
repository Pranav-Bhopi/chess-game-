@echo off
title Chess
cd /d "%~dp0"

REM --- Check Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install it from https://nodejs.org/
  echo then run install.bat before launching.
  echo.
  pause
  exit /b 1
)

REM --- Ensure dependencies are installed ---
if not exist "node_modules\" (
  echo [!] Dependencies are not installed yet.
  echo     Please run install.bat first.
  echo.
  pause
  exit /b 1
)

echo Starting Chess...
call npm start
if errorlevel 1 (
  echo.
  echo [ERROR] The app exited with an error. See the messages above.
  echo.
  pause
)
