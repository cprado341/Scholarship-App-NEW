[CmdletBinding()]
param(
  [string]$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$ServiceName = "ScholarshipAgent"
)

$ErrorActionPreference = "Stop"

function Read-EnvFile {
  param([string]$Path)
  $Values = @{}
  if (-not (Test-Path $Path)) {
    return $Values
  }

  Get-Content $Path | ForEach-Object {
    $Line = $_.Trim()
    if ($Line -match '^set\s+"([^=]+)=(.*)"$') {
      $Values[$Matches[1]] = $Matches[2]
    }
  }
  return $Values
}

function Test-WebUrl {
  param([string]$Url)
  try {
    $Response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
    return [pscustomobject]@{ Ok = $true; StatusCode = [int]$Response.StatusCode; Error = "" }
  } catch {
    $StatusCode = 0
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $StatusCode = [int]$_.Exception.Response.StatusCode
    }
    return [pscustomobject]@{ Ok = ($StatusCode -ge 200 -and $StatusCode -lt 500); StatusCode = $StatusCode; Error = $_.Exception.Message }
  }
}

$AppRoot = (Resolve-Path $AppRoot).Path
$EnvPath = Join-Path $AppRoot "iis\scholarship-agent.env.cmd"
$EnvValues = Read-EnvFile -Path $EnvPath
$PublicAppUrl = ""
if ($EnvValues.ContainsKey("PUBLIC_APP_URL")) {
  $PublicAppUrl = (($EnvValues["PUBLIC_APP_URL"]) -replace '/$', '')
}

Write-Host "Scholarship Agent IIS share readiness"
Write-Host "App root: $AppRoot"

if (-not $PublicAppUrl) {
  Write-Warning "PUBLIC_APP_URL is not set in $EnvPath."
} elseif ($PublicAppUrl -match '^http://') {
  Write-Warning "PUBLIC_APP_URL uses http. Use https before sharing publicly: $PublicAppUrl"
} elseif ($PublicAppUrl -match '127\.0\.0\.1|localhost|scholarship-agent-app\.vercel\.app') {
  Write-Warning "PUBLIC_APP_URL does not look like the IIS public domain: $PublicAppUrl"
} else {
  Write-Host "PUBLIC_APP_URL: $PublicAppUrl"
}

$Service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $Service) {
  Write-Warning "Windows service '$ServiceName' was not found."
} else {
  Write-Host "Service $ServiceName status: $($Service.Status)"
}

$Local = Test-WebUrl -Url "http://127.0.0.1:4317/api/me"
if ($Local.Ok) {
  Write-Host "Local Node portal responded with HTTP $($Local.StatusCode)."
} else {
  Write-Warning "Local Node portal did not respond: $($Local.Error)"
}

if ($PublicAppUrl) {
  $LoginUrl = "$PublicAppUrl/login.html?next=/portal.html"
  $Public = Test-WebUrl -Url $LoginUrl
  if ($Public.Ok) {
    Write-Host "Public login URL responded with HTTP $($Public.StatusCode): $LoginUrl"
  } else {
    Write-Warning "Public login URL did not respond: $($Public.Error)"
  }
}

Write-Host ""
Write-Host "Next: sign in as Admin, open Settings, create a new user with role Admin, then share the Latest Invite link."
