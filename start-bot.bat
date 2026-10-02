@echo off
REM Smart Lab - Bot auf diesem PC starten (Doppelklick). Fenster offen lassen; beenden mit Strg+C.
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ist nicht installiert. Bitte zuerst Node.js LTS von https://nodejs.org installieren ^(Windows Installer .msi^).
  pause
  exit /b 1
)
node server\bot.js %*
echo.
echo Bot beendet.
pause
