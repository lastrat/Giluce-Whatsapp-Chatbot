@echo off
chcp 65001 >nul
title Webtoon Downloader API

echo ========================================
echo   Webtoon Downloader API Server
echo ========================================
echo.

cd /d "%~dp0"

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python is not installed or not in PATH
    pause
    exit /b 1
)

REM Check if virtual environment exists
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
call venv\Scripts\activate.bat

REM Install dependencies
echo Installing dependencies...
pip install -r requirements.txt -q

REM Start the server
echo.
echo Starting Webtoon Downloader API...
echo Server will be available at http://localhost:8001
echo Documentation at http://localhost:8001/docs
echo.
echo Press Ctrl+C to stop the server
echo.

uvicorn main:app --host 0.0.0.0 --port 8001 --reload

pause
