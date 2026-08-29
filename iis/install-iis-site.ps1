[CmdletBinding()]
param(
  [string]$SiteName = "Scholarship Agent",
  [string]$PhysicalPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$BindingHost = "",
  [int]$BindingPort = 80,
  [string]$AppPoolName = "ScholarshipAgentPool"
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

$PhysicalPath = (Resolve-Path $PhysicalPath).Path
$WebConfig = Join-Path $PhysicalPath "web.config"

if (-not (Test-Path $WebConfig)) {
  throw "web.config was not found at '$WebConfig'. Point -PhysicalPath to the app package root."
}

$Features = @(
  "IIS-WebServerRole",
  "IIS-WebServer",
  "IIS-ManagementConsole",
  "IIS-StaticContent",
  "IIS-DefaultDocument",
  "IIS-HttpErrors",
  "IIS-RequestFiltering"
)

foreach ($Feature in $Features) {
  $State = (Get-WindowsOptionalFeature -Online -FeatureName $Feature).State
  if ($State -ne "Enabled") {
    Enable-WindowsOptionalFeature -Online -FeatureName $Feature -All -NoRestart | Out-Null
  }
}

Import-Module WebAdministration

try {
  Set-WebConfigurationProperty `
    -PSPath "MACHINE/WEBROOT/APPHOST" `
    -Filter "system.webServer/proxy" `
    -Name "enabled" `
    -Value "True" | Out-Null
} catch {
  Write-Warning "Could not enable ARR proxy. Install IIS URL Rewrite and Application Request Routing, then enable Proxy in ARR settings."
}

if (-not (Test-Path "IIS:\AppPools\$AppPoolName")) {
  New-WebAppPool -Name $AppPoolName | Out-Null
}

Set-ItemProperty "IIS:\AppPools\$AppPoolName" -Name managedRuntimeVersion -Value ""
Set-ItemProperty "IIS:\AppPools\$AppPoolName" -Name enable32BitAppOnWin64 -Value $false

if (Test-Path "IIS:\Sites\$SiteName") {
  Set-ItemProperty "IIS:\Sites\$SiteName" -Name physicalPath -Value $PhysicalPath
  Set-ItemProperty "IIS:\Sites\$SiteName" -Name applicationPool -Value $AppPoolName
  Write-Host "Updated existing IIS site '$SiteName'."
} else {
  New-Website `
    -Name $SiteName `
    -PhysicalPath $PhysicalPath `
    -Port $BindingPort `
    -HostHeader $BindingHost `
    -ApplicationPool $AppPoolName | Out-Null
  Write-Host "Created IIS site '$SiteName'."
}

Write-Host "IIS will proxy '$SiteName' to http://127.0.0.1:4317."
Write-Host "Add an HTTPS binding and certificate in IIS Manager before public use."
