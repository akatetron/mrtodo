@echo off
REM Mr. Todo — one-click start for Windows.
REM Double-click this file (or run it from a terminal) to install
REM dependencies (only if needed) and launch the Expo dev server.

cd /d "%~dp0"

echo ============================================
echo   Mr. Todo - starting the app
echo ============================================
echo.

if not exist "node_modules" (
    echo Installing dependencies for the first time - this can take a few minutes...
    call npm install
    if errorlevel 1 (
        echo.
        echo Something went wrong during npm install. Make sure Node.js is
        echo installed from https://nodejs.org, then run this file again.
        pause
        exit /b 1
    )
)

echo.
echo Starting Expo... a QR code will appear below.
echo Scan it with the "Expo Go" app on your phone (free, App Store / Play Store)
echo to open Mr. Todo live. Press "w" in this window for a quick web preview,
echo or Ctrl+C to stop the server.
echo.

call npm start

pause
