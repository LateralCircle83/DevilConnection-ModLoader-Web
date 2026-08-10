@echo off
setlocal

cd /d "%~dp0"

set "PORT=%~1"
if not defined PORT set "PORT=4173"

echo(%PORT%| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 (
  echo Invalid port: %PORT%
  echo Usage: %~nx0 [port]
  pause
  exit /b 1
)

echo.
echo Devil Connection Web Shell
echo URL: http://127.0.0.1:%PORT%/
echo Press Ctrl+C to stop the temporary server.
echo.

where py >nul 2>nul
if not errorlevel 1 (
  py -3 -m http.server %PORT% --bind 127.0.0.1
  exit /b
)

where python >nul 2>nul
if not errorlevel 1 (
  python -m http.server %PORT% --bind 127.0.0.1
  exit /b
)

echo Python 3 was not found.
echo Install Python or add python.exe to PATH, then run this file again.
pause
exit /b 1
