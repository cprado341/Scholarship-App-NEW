[CmdletBinding()]
param(
  [string]$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$ServiceName = "ScholarshipAgent",
  [string]$NssmExe = "C:\Tools\nssm\nssm.exe",
  [string]$NodeExe = "C:\Program Files\nodejs\node.exe"
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated PowerShell window."
  }
}

Assert-Administrator

if (-not (Test-Path $NssmExe)) {
  throw "NSSM was not found at '$NssmExe'. Download NSSM and pass -NssmExe with the correct path."
}

if (-not (Test-Path $NodeExe)) {
  throw "Node.js was not found at '$NodeExe'. Install Node.js 24+ or pass -NodeExe with the correct path."
}

$AppRoot = (Resolve-Path $AppRoot).Path
$Launcher = Join-Path $AppRoot "iis\start-scholarship-agent.cmd"
$EnvFile = Join-Path $AppRoot "iis\scholarship-agent.env.cmd"
$EnvExample = Join-Path $AppRoot "iis\scholarship-agent.env.example.cmd"
$LogDir = Join-Path $AppRoot "logs"
$DataDir = Join-Path $AppRoot "data\documents"

if (-not (Test-Path $Launcher)) {
  throw "Launcher not found at '$Launcher'. Make sure you copied the IIS package contents."
}

if (-not (Test-Path $EnvFile) -and (Test-Path $EnvExample)) {
  Copy-Item $EnvExample $EnvFile
  Write-Warning "Created '$EnvFile'. Edit it before exposing the site publicly."
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$CmdExe = Join-Path $env:SystemRoot "System32\cmd.exe"
$CmdArgs = "/c `"$Launcher`""

& $NssmExe status $ServiceName *> $null
$ServiceExists = ($LASTEXITCODE -eq 0)

if (-not $ServiceExists) {
  & $NssmExe install $ServiceName $CmdExe $CmdArgs
} else {
  & $NssmExe set $ServiceName Application $CmdExe
  & $NssmExe set $ServiceName AppParameters $CmdArgs
}

& $NssmExe set $ServiceName AppDirectory $AppRoot
& $NssmExe set $ServiceName DisplayName "Scholarship Agent"
& $NssmExe set $ServiceName Description "Runs the Scholarship Agent Node portal behind IIS."
& $NssmExe set $ServiceName Start SERVICE_AUTO_START
& $NssmExe set $ServiceName AppStdout (Join-Path $LogDir "service.out.log")
& $NssmExe set $ServiceName AppStderr (Join-Path $LogDir "service.err.log")
& $NssmExe set $ServiceName AppRotateFiles 1
& $NssmExe set $ServiceName AppRotateOnline 1
& $NssmExe set $ServiceName AppRotateBytes 10485760
& $NssmExe set $ServiceName AppEnvironmentExtra "NODE_EXE=$NodeExe"

& $NssmExe restart $ServiceName

Write-Host "Installed and started Windows service '$ServiceName'."
Write-Host "Node should now be listening at http://127.0.0.1:4317."
