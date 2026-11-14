@echo off
rem Resets the demo: card app back to the planted state, #monitor emptied, helpdesk inbox emptied.
cd /d "%~dp0tool"
if not exist artifacts mkdir artifacts
echo [1/3] Card app back to the start (about 30 s)...
call npm run reset > artifacts\last-reset.log 2>&1
if errorlevel 1 (echo       RESET FAILED: see tool\artifacts\last-reset.log) else (echo       done)
echo [2/3] Emptying #monitor...
call npm run clear-monitor
echo [3/3] Emptying the helpdesk inbox...
node ..\helpdesk\restart-empty.mjs
echo.
echo Ready for the next demo.
pause
