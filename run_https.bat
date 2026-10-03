@echo off
title Vectis (HTTPS)
cd /d "%~dp0"

echo ==================================================
echo   Vectis - HTTPS Launcher
echo ==================================================
echo.
echo NOTE: port 443 requires running this as Administrator
echo (right-click this file -^> Run as administrator).
echo.

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python was not found in your PATH. Install Python and retry.
    pause
    exit /b
)

:: If no certificate exists, make a self-signed one (encrypts traffic; browsers
:: will warn it is "not trusted" -- fine for a LAN, NOT for a public website).
:: For a public site, put a real cert at certs\cert.pem + certs\key.pem instead
:: and just run "python server.py".
if not exist "certs\cert.pem" (
    echo No certificate found - generating a self-signed one for localhost...
    python make_cert.py localhost
    echo.
)

echo Starting Vectis over HTTPS...
start "Vectis Server" python server.py

timeout /t 2 >nul
start "" "https://localhost"

echo.
echo Server is running. To stop it, close the "Vectis Server" window.
echo.
timeout /t 5 >nul
