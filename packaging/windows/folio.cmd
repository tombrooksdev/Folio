@echo off
rem Folio command line for Windows: start, stop, open, add-user, backup, config
setlocal EnableExtensions EnableDelayedExpansion
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "NODE=%ROOT%\runtime\node.exe"
if not exist "%NODE%" (
  echo folio: runtime\node.exe was not found next to this script.
  exit /b 1
)

rem Installed copies keep data in %ProgramData%\Folio; the portable zip keeps it beside the program.
if exist "%ROOT%\portable.txt" (set "DATA=%ROOT%\data") else (set "DATA=%ProgramData%\Folio")
if not exist "%DATA%" mkdir "%DATA%"
set "FOLIO_DB=%DATA%\folio.db"
set "FOLIO_UPLOAD_DIR=%DATA%\uploads"
set "FOLIO_HOST=127.0.0.1"
set "PORT=3000"
set "FOLIO_PID_FILE=%DATA%\folio.pid"
rem config.txt holds NAME=value lines (lines starting with # are comments)
if exist "%DATA%\config.txt" for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%DATA%\config.txt") do set "%%A=%%B"

set "CMD=%~1"
if "%CMD%"=="" set "CMD=start"
if /i "%CMD%"=="start"    goto :start
if /i "%CMD%"=="stop"     goto :stop
if /i "%CMD%"=="open"     goto :open
if /i "%CMD%"=="add-user" goto :adduser
if /i "%CMD%"=="reset-password" goto :resetpw
if /i "%CMD%"=="backup"   goto 
:resetpw
if "%~2"=="" (
  echo Usage: folio reset-password NAME
  exit /b 1
)
"%NODE%" --disable-warning=ExperimentalWarning "%ROOT%\app\scripts\reset-password.js" "%~2"
exit /b %errorlevel%

:backup
if /i "%CMD%"=="config"   goto :config
goto :usage

:start
"%NODE%" --disable-warning=ExperimentalWarning "%ROOT%\app\src\server.js"
exit /b %errorlevel%

:stop
if not exist "%FOLIO_PID_FILE%" (
  echo Folio is not running.
  exit /b 0
)
set /p FOLIO_PID=<"%FOLIO_PID_FILE%"
taskkill /PID %FOLIO_PID% /F >nul 2>&1
del "%FOLIO_PID_FILE%" >nul 2>&1
echo Folio stopped.
exit /b 0

:open
start "" "http://localhost:%PORT%"
exit /b 0

:adduser
if "%~2"=="" (
  echo Usage: folio add-user NAME
  exit /b 1
)
"%NODE%" --disable-warning=ExperimentalWarning "%ROOT%\app\scripts\add-user.js" %2 %3 %4
exit /b %errorlevel%

:backup
"%NODE%" --disable-warning=ExperimentalWarning "%ROOT%\app\scripts\backup.js" %2
exit /b %errorlevel%

:config
for /f "delims=" %%V in ('"%NODE%" -p "require('%ROOT:\=/%/app/package.json').version"') do set "VER=%%V"
echo Version:      %VER%
echo Install:      %ROOT%
echo Database:     %FOLIO_DB%
echo Attachments:  %FOLIO_UPLOAD_DIR%
echo Config file:  %DATA%\config.txt
echo Address:      http://localhost:%PORT%
exit /b 0

:usage
echo Folio: self-hosted wiki and Scrum board
echo.
echo Usage: folio ^<command^>
echo.
echo   start             Run the server in this window
echo   stop              Stop a running server
echo   open              Open Folio in your browser
echo   add-user NAME [--role admin^|member^|viewer]   Create a user (asks for a password)
echo   reset-password NAME   Set a new password and sign that user out everywhere
echo   backup [FILE]     Back up the database and attachments
echo   config            Show where things live
exit /b 0
