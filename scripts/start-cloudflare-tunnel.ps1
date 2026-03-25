$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Log {
  param([string]$Message)
  Write-Host "[cloudflare-tunnel-win] $Message"
}

function Throw-Fail {
  param([string]$Message)
  throw "[cloudflare-tunnel-win] $Message"
}

function Get-EnvOrDefault {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Default
  )

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $Default
  }
  return $value
}

function Resolve-CloudflaredExe {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd -and (Test-Path $cmd.Source)) {
    return $cmd.Source
  }

  $candidates = @(
    (Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe')
  )
  foreach ($path in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path $path)) {
      return $path
    }
  }
  return ''
}

$CloudflareTokenDefault = 'eyJhIjoiNzMyNGQ3ZjU3MGY5MzBlMjRjODRlYTY2ZmNkM2IwYjUiLCJ0IjoiYTk1OTZiMDgtNDZjOC00NmRlLWIzZGYtN2NjYjQ4OTJhM2NkIiwicyI6Ik5EWmlaREV4TjJFdFpXRXdNeTAwWlRNNExXSTJZakF0TWpFek5HRmlNVEl4WXpCaiJ9'
$CloudflareTunnelToken = [Environment]::GetEnvironmentVariable('MECO_CLOUDFLARE_TUNNEL_TOKEN')
if ([string]::IsNullOrWhiteSpace($CloudflareTunnelToken)) {
  $CloudflareTunnelToken = [Environment]::GetEnvironmentVariable('CLOUDFLARE_TUNNEL_TOKEN')
}
if ([string]::IsNullOrWhiteSpace($CloudflareTunnelToken)) {
  $CloudflareTunnelToken = $CloudflareTokenDefault
}

$CloudflareRuntimeDir = Get-EnvOrDefault -Name 'CLOUDFLARE_RUNTIME_DIR' -Default (Join-Path $env:USERPROFILE '.meco-studio\cloudflare')
$CloudflareLogFile = Get-EnvOrDefault -Name 'CLOUDFLARE_LOG_FILE' -Default (Join-Path $CloudflareRuntimeDir 'tunnel.log')
$CloudflareErrFile = Get-EnvOrDefault -Name 'CLOUDFLARE_ERR_FILE' -Default (Join-Path $CloudflareRuntimeDir 'tunnel.err.log')
$CloudflarePidFile = Get-EnvOrDefault -Name 'CLOUDFLARE_PID_FILE' -Default (Join-Path $CloudflareRuntimeDir 'tunnel.pid')
$CloudflareProtocol = Get-EnvOrDefault -Name 'CLOUDFLARE_PROTOCOL' -Default 'http2'
$CloudflareEdgeIpVersion = Get-EnvOrDefault -Name 'CLOUDFLARE_EDGE_IP_VERSION' -Default '4'
# Ignore legacy ~/.cloudflared/config.yml to avoid loading stale named-tunnel creds.
$CloudflareConfigFile = Get-EnvOrDefault -Name 'CLOUDFLARE_CONFIG_FILE' -Default 'NUL'
$CloudflareLocalUrl = Get-EnvOrDefault -Name 'CLOUDFLARE_LOCAL_URL' -Default 'http://127.0.0.1:3456'

if ([string]::IsNullOrWhiteSpace($CloudflareTunnelToken)) {
  Throw-Fail 'Cloudflare tunnel token is empty.'
}

$cloudflaredExe = Resolve-CloudflaredExe
if ([string]::IsNullOrWhiteSpace($cloudflaredExe)) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Log 'cloudflared not found, installing via winget...'
    & winget install -e --id Cloudflare.cloudflared --silent --accept-package-agreements --accept-source-agreements | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Throw-Fail 'failed to install cloudflared via winget'
    }
    Start-Sleep -Seconds 2
    $cloudflaredExe = Resolve-CloudflaredExe
  }
}

if ([string]::IsNullOrWhiteSpace($cloudflaredExe)) {
  Throw-Fail 'cloudflared not found. Install Cloudflare Tunnel CLI first.'
}

New-Item -ItemType Directory -Force -Path $CloudflareRuntimeDir | Out-Null

if (Test-Path $CloudflarePidFile) {
  $oldPidText = (Get-Content -Raw -Path $CloudflarePidFile -ErrorAction SilentlyContinue).Trim()
  $oldPid = 0
  if ([int]::TryParse($oldPidText, [ref]$oldPid)) {
    $proc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
    if ($proc -and -not $proc.HasExited) {
      Write-Log "cloudflared already running (pid=$oldPid)"
      exit 0
    }
  }
  Remove-Item -Force -Path $CloudflarePidFile -ErrorAction SilentlyContinue
}

$proc = Start-Process -FilePath $cloudflaredExe -ArgumentList @('--config', $CloudflareConfigFile, 'tunnel', '--edge-ip-version', $CloudflareEdgeIpVersion, '--protocol', $CloudflareProtocol, '--no-autoupdate', 'run', '--token', $CloudflareTunnelToken, '--url', $CloudflareLocalUrl) -RedirectStandardOutput $CloudflareLogFile -RedirectStandardError $CloudflareErrFile -PassThru
Set-Content -Path $CloudflarePidFile -Value $proc.Id -Encoding UTF8

Start-Sleep -Seconds 1
if ($proc.HasExited) {
  Throw-Fail "cloudflared failed to start, check logs: $CloudflareLogFile / $CloudflareErrFile"
}

Write-Log "cloudflared started (pid=$($proc.Id))"
