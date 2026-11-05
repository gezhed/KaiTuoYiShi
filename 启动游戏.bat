@echo off
setlocal
cd /d "%~dp0"
title KaiTuoYiShi

echo ============================================
echo    KaiTuoYiShi - Local Launcher
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 goto NONODE

for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo Node.js detected: %NODEV%
echo.

node -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo [WARN] Node.js 20 or newer is recommended. Current version: %NODEV%
  echo.
)

if exist "node_modules\vite\bin\vite.js" goto RUN

echo First launch: installing dependencies ^(needs internet, may take a few minutes^)...
set "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
where corepack >nul 2>nul
if errorlevel 1 (
  call npm install
) else (
  call corepack pnpm install
  if errorlevel 1 (
    echo.
    echo pnpm install failed, retrying with npm...
    call npm install
  )
)
if not exist "node_modules\vite\bin\vite.js" goto INSTALLFAIL
echo.

:RUN
echo Starting server at http://localhost:5173 ...
echo The browser will open automatically.
echo Keep this window open while playing. Close it to stop the server.
echo.
node "node_modules\vite\bin\vite.js" --port 5173 --strictPort --open
set "EXITCODE=%errorlevel%"
echo.
if "%EXITCODE%"=="1" (
  echo [ERROR] The server failed to start.
  echo If port 5173 is already in use, close the other program and try again.
  echo.
) else (
  echo Server stopped.
  echo.
)
pause
exit /b %EXITCODE%

:NONODE
echo [ERROR] Node.js not found.
echo Please install Node.js 20 LTS or newer from: https://nodejs.org/
echo Then double-click this file again.
echo.
pause
exit /b 1

:INSTALLFAIL
echo.
echo [ERROR] Dependency installation failed. Please check your network and try again.
echo.
pause
exit /b 1
