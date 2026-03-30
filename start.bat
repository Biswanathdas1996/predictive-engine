@echo off
setlocal
cd /d "%~dp0"

where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm is not installed or not on PATH.
  echo Install Node.js from https://nodejs.org then run: npm install -g pnpm
  exit /b 1
)

if not exist "node_modules\.modules.yaml" (
  echo Installing dependencies...
  call pnpm install
  if errorlevel 1 exit /b 1
)

set "PORT=5173"
set "BASE_PATH=/"
set "API_PORT=3000"

where python >nul 2>nul
if errorlevel 1 (
  echo Python is not installed or not on PATH.
  echo Install Python 3.11+ from https://www.python.org and re-run start.bat
  exit /b 1
)

echo.
echo Open http://localhost:%PORT%/ in your browser.
echo API: FastAPI on port %API_PORT% ^(proxied as /api^).
echo Close the spawned windows or run stop.bat to stop.
echo.

start "PredictiveEngine API" /D "%~dp0artifacts\api-server-py" cmd /k "python -m pip install -e . -q && set PORT=%API_PORT%&& python -m uvicorn app.main:app --host 0.0.0.0 --port %API_PORT%"

timeout /t 2 /nobreak >nul

start "PredictiveEngine Dev" /D "%~dp0" cmd /k "set PORT=%PORT%&& set BASE_PATH=%BASE_PATH%&& set API_PORT=%API_PORT%&& pnpm --filter @workspace/prediction-engine dev"

endlocal
