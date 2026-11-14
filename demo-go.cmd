@echo off
rem Starts the demo: flicker + wrong-amount tickets through the helpdesk, Grafana spike, two threads in #monitor.
cd /d "%~dp0tool"
call npm run demo-both
echo.
echo Demo started. Watch #monitor.
pause
