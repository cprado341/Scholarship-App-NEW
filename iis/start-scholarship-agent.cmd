@echo off
setlocal

cd /d "%~dp0\.."

if exist "%~dp0scholarship-agent.env.cmd" (
  call "%~dp0scholarship-agent.env.cmd"
)

if "%HOST%"=="" set "HOST=127.0.0.1"
if "%PORT%"=="" set "PORT=4317"
if "%NODE_EXE%"=="" set "NODE_EXE=node"

if not exist "data\documents" mkdir "data\documents"

"%NODE_EXE%" --disable-warning=ExperimentalWarning src\server.ts
