@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" goto install
if not exist "node_modules\ws\package.json" goto install
if not exist "node_modules\microsoft-cognitiveservices-speech-sdk\package.json" goto install
if not exist "node_modules\ffmpeg-static\ffmpeg.exe" goto install
if not exist "node_modules\uiohook-napi\package.json" goto install
goto launch

:install
where npm >nul 2>&1
if errorlevel 1 goto no_node
where node >nul 2>&1
if errorlevel 1 goto no_node
call npm ci --no-audit --no-fund
if errorlevel 1 goto install_failed

:launch
start "" "node_modules\electron\dist\electron.exe" .
exit /b 0

:no_node
echo Node.js LTS is required for the first launch.
pause
exit /b 1

:install_failed
echo Failed to install application components.
pause
exit /b 1
