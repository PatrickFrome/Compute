@echo off
setlocal
cd /d "%~dp0"
set "ELECTRON_EXE=%CD%\node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON_EXE%" (
  echo METAENGINE Browser TEST: Electron runtime is missing.
  echo This launcher is intended for the prepared CI portable artifact or a local checkout after npm install.
  pause
  exit /b 2
)
echo Starting METAENGINE Browser TEST 0.5.0-test.1...
"%ELECTRON_EXE%" .
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Browser exited with code %EXIT_CODE%.
  echo Reopen it and check the embedded Dev Console for the last runtime events.
  pause
)
exit /b %EXIT_CODE%
