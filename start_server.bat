@echo off
setlocal

cd /d "%~dp0"

set "PORT=%~1"
if not defined PORT set "PORT=4173"

where node >nul 2>nul
if errorlevel 1 goto node_missing

node "%~dp0tools\static-server.js" "%PORT%"
set "SERVER_EXIT=%ERRORLEVEL%"
if not "%SERVER_EXIT%"=="0" pause
exit /b %SERVER_EXIT%

:node_missing
echo Node.js was not found.
echo Install Node.js or add node.exe to PATH, then run this file again.
pause
exit /b 1
