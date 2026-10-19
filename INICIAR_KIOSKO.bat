@echo off
title ToolTrack - Servidor local
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js en esta computadora.
  echo Instala Node.js LTS o abre index.html con la extension Live Server de Visual Studio Code.
  pause
  exit /b 1
)

set "TOOLTRACK_URL=http://localhost:8080"
set "EDGE_X86=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE_X64=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

start "ToolTrack Server" /min cmd /k node "%~dp0server.js"
timeout /t 2 /nobreak >nul

if exist "%EDGE_X86%" start "" "%EDGE_X86%" --kiosk "%TOOLTRACK_URL%" --edge-kiosk-type=fullscreen
if not exist "%EDGE_X86%" if exist "%EDGE_X64%" start "" "%EDGE_X64%" --kiosk "%TOOLTRACK_URL%" --edge-kiosk-type=fullscreen
if not exist "%EDGE_X86%" if not exist "%EDGE_X64%" start "" "%TOOLTRACK_URL%"
exit /b 0
