$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Log {
  param([string]$Message)
  Write-Host "[rustdesk-client-win] $Message"
}

function Write-WarnLog {
  param([string]$Message)
  Write-Warning "[rustdesk-client-win] $Message"
}

function Test-Cmd {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Resolve-RustDeskExe {
  $candidates = @()
  $cmd = Get-Command rustdesk -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) {
    $candidates += $cmd.Source
  }
  $candidates += @(
    (Join-Path $env:ProgramFiles 'RustDesk\rustdesk.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'RustDesk\rustdesk.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\RustDesk\rustdesk.exe')
  )

  foreach ($path in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path $path)) {
      return $path
    }
  }
  return ''
}

$RustDeskAutoLaunch = [Environment]::GetEnvironmentVariable('RUSTDESK_AUTO_LAUNCH')
if ([string]::IsNullOrWhiteSpace($RustDeskAutoLaunch)) { $RustDeskAutoLaunch = '1' }

$RustDeskAutoUpgrade = [Environment]::GetEnvironmentVariable('RUSTDESK_AUTO_UPGRADE')
if ([string]::IsNullOrWhiteSpace($RustDeskAutoUpgrade)) { $RustDeskAutoUpgrade = '1' }

$RustDeskWingetId = [Environment]::GetEnvironmentVariable('RUSTDESK_WINGET_ID')
if ([string]::IsNullOrWhiteSpace($RustDeskWingetId)) { $RustDeskWingetId = 'RustDesk.RustDesk' }

$rustdeskExe = Resolve-RustDeskExe
if (Test-Cmd 'winget') {
  if (-not [string]::IsNullOrWhiteSpace($rustdeskExe)) {
    if ($RustDeskAutoUpgrade -eq '1') {
      Write-Log "RustDesk already installed, upgrading via winget ($RustDeskWingetId)..."
      & winget upgrade -e --id $RustDeskWingetId --silent --accept-package-agreements --accept-source-agreements | Out-Null
      if ($LASTEXITCODE -ne 0) {
        Write-WarnLog 'winget upgrade failed, keep current RustDesk installation'
      }
    }
    else {
      Write-Log "RustDesk already installed, skip upgrade (RUSTDESK_AUTO_UPGRADE=$RustDeskAutoUpgrade)"
    }
  }
  else {
    Write-Log "Installing RustDesk via winget ($RustDeskWingetId)..."
    & winget install -e --id $RustDeskWingetId --silent --accept-package-agreements --accept-source-agreements | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "winget install failed for $RustDeskWingetId"
    }
  }
}
else {
  throw 'winget not found. Please install RustDesk manually: https://rustdesk.com/'
}

$rustdeskExe = Resolve-RustDeskExe
if ([string]::IsNullOrWhiteSpace($rustdeskExe)) {
  throw 'RustDesk install finished but rustdesk.exe not found. Open a new PowerShell window and retry.'
}

if ($RustDeskAutoLaunch -eq '1') {
  Start-Process -FilePath $rustdeskExe -ErrorAction SilentlyContinue | Out-Null
}

Write-Log "RustDesk client is ready: $rustdeskExe"
