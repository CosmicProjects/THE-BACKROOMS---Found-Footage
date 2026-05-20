@echo off
setlocal

cd /d "%~dp0"
set PORT=8001

echo Starting local server for Horror Game at http://127.0.0.1:%PORT%

echo Checking for Python 3...
where python >nul 2>nul
if %ERRORLEVEL%==0 (
    start "" "http://127.0.0.1:%PORT%/index.html"
    python -m http.server %PORT% --bind 127.0.0.1
    goto :EOF
)

where py >nul 2>nul
if %ERRORLEVEL%==0 (
    start "" "http://127.0.0.1:%PORT%/index.html"
    py -3 -m http.server %PORT% --bind 127.0.0.1
    goto :EOF
)

echo.
echo ERROR: Python 3 was not found on this system.
echo Install Python 3 and try again, or run this folder in a local web server.
pause
