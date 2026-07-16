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
tasklist /FI "IMAGENAME eq V.exe" 2>nul | find /I "V.exe" >nul
if not errorlevel 1 goto installed_running
where python >nul 2>&1
if errorlevel 1 goto launch_without_sheets
python -c "import gspread, google_auth_oauthlib, googleapiclient" >nul 2>&1
if errorlevel 1 python -m pip install --disable-pip-version-check --no-input "gspread>=6.2,<7" "google-auth-oauthlib>=1.2,<2" "google-api-python-client>=2.170,<3"
if errorlevel 1 goto launch_without_sheets

:launch_app
start "" "node_modules\electron\dist\electron.exe" .
exit /b 0

:launch_without_sheets
echo WARNING: Google Sheets synchronization is unavailable because Python 3 or its Google libraries were not found.
goto launch_app

:installed_running
echo The installed V is already running. Exit it from the tray, then run this file again.
pause
exit /b 1

:no_node
echo Node.js LTS is required for the first launch.
pause
exit /b 1

:install_failed
echo Failed to install application components.
pause
exit /b 1
