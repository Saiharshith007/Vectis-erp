@echo off
title Vectis Launcher
cd /d "%~dp0"

:: Runs on 8010 so it doesn't clash with anything already on 8000.
:: Change VECTIS_PORT here if 8010 is taken too.
set "VECTIS_PORT=8010"

echo ==================================================
echo   Vectis Launcher
echo ==================================================
echo.

:: Check if Python is installed
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python was not found in your PATH.
    echo Please install Python and try again.
    pause
    exit /b
)

:: Warn (don't silently fail) if the chosen port is already in use, so the
:: browser can't accidentally open some other app already on this port.
netstat -ano | findstr /r /c:"LISTENING" | findstr /c:":%VECTIS_PORT% " >nul
if %errorlevel% equ 0 (
    echo [WARNING] Port %VECTIS_PORT% is already in use by another program.
    echo The browser may open that other app instead of Vectis.
    echo Close whatever is using port %VECTIS_PORT%, or change VECTIS_PORT in run.bat.
    echo.
    pause
)

:: Start the Python HTTP server in a separate window (server.py honors VECTIS_PORT)
echo Starting Python HTTP server on port %VECTIS_PORT%...
start "Vectis Server" cmd /c "set VECTIS_PORT=%VECTIS_PORT% && python server.py"

:: Wait 2 seconds for the server to initialize
timeout /t 2 >nul

:: Open the default web browser
echo Opening browser to http://127.0.0.1:%VECTIS_PORT%...
start "" "http://127.0.0.1:%VECTIS_PORT%"

echo.
echo Server is running! You can close this launcher window.
echo To stop the server, close the "Vectis Server" window.
echo.
timeout /t 5 >nul
