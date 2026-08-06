@echo off
REM Monitor de estoque FBA — clique duas vezes neste arquivo para subir.
REM A janela precisa ficar aberta; feche-a (ou Ctrl+C) para parar.
REM Abre em http://localhost:4310

cd /d "%~dp0.."

set "TMP=G:\sc-temp"
set "TEMP=G:\sc-temp"

echo.
echo  Subindo o monitor de estoque FBA...
echo  Depois de aparecer "Monitor de estoque FBA em ...", abra:
echo.
echo      http://localhost:4310
echo.

node --experimental-transform-types --import ./scripts/ts-resolver.mjs --env-file=.env.local scripts/fba-monitor.mjs

echo.
echo  Monitor encerrado.
pause
