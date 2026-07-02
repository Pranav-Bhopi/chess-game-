@echo off
setlocal enabledelayedexpansion
title Chess - Installer
cd /d "%~dp0"

echo ==================================================
echo    Chess ^(Electron^) - Dependency Installer
echo ==================================================
echo.

REM --- Check Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found on your PATH.
  echo.
  echo Install the Node.js LTS build ^(v18 or newer^) from:
  echo     https://nodejs.org/
  echo.
  echo Then close this window and run install.bat again.
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
echo   Found Node.js !NODE_VER!

REM --- Check npm ---
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. It normally ships with Node.js.
  echo Reinstall Node.js from https://nodejs.org/ and try again.
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('npm -v') do set "NPM_VER=%%v"
echo   Found npm v!NPM_VER!
echo.

REM --- Install dependencies ---
echo Installing dependencies ^(this downloads Electron on first run^)...
echo.
call npm install
if errorlevel 1 (
  echo.
  echo [ERROR] npm install failed. Review the messages above and retry.
  echo.
  pause
  exit /b 1
)

echo.
echo ==================================================
echo    Done - dependencies installed successfully.
echo ==================================================
echo.
echo    Start the app with:  run.bat     ^(or: npm start^)
echo.
pause
endlocal
