$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Log {
  param([string]$Message)
  Write-Host "[rustdesk-selfhost-win] $Message"
}

function Write-WarnLog {
  param([string]$Message)
  Write-Warning "[rustdesk-selfhost-win] $Message"
}

function Throw-Fail {
  param([string]$Message)
  throw "[rustdesk-selfhost-win] $Message"
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

$RustDeskServerHome = Get-EnvOrDefault -Name 'RUSTDESK_SERVER_HOME' -Default (Join-Path $env:USERPROFILE '.meco-studio\rustdesk-server')
$RustDeskServerBinDir = Get-EnvOrDefault -Name 'RUSTDESK_SERVER_BIN_DIR' -Default (Join-Path $RustDeskServerHome 'bin')
$RustDeskRendezvousHost = Get-EnvOrDefault -Name 'RUSTDESK_RENDEZVOUS_HOST' -Default '127.0.0.1'
$RustDeskHbbsPort = Get-EnvOrDefault -Name 'RUSTDESK_HBBS_PORT' -Default '21116'
$RustDeskHbbrPort = Get-EnvOrDefault -Name 'RUSTDESK_HBBR_PORT' -Default '21117'
$RustDeskWsPort = Get-EnvOrDefault -Name 'RUSTDESK_WS_PORT' -Default '21118'
$RustDeskServerAutostart = Get-EnvOrDefault -Name 'RUSTDESK_SERVER_AUTOSTART' -Default '1'
$RustDeskServerDownload = Get-EnvOrDefault -Name 'RUSTDESK_SERVER_DOWNLOAD' -Default '1'
$RustDeskServerReleaseApi = Get-EnvOrDefault -Name 'RUSTDESK_SERVER_RELEASE_API' -Default 'https://api.github.com/repos/rustdesk/rustdesk-server/releases/latest'
$RustDeskConfigPathOverride = Get-EnvOrDefault -Name 'RUSTDESK_CONFIG_PATH_OVERRIDE' -Default ''

function Resolve-ServerBin {
  param(
    [Parameter(Mandatory = $true)][string]$Name
  )

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd -and (Test-Path $cmd.Source)) {
    return $cmd.Source
  }

  $fileName = if ($Name.ToLowerInvariant().EndsWith('.exe')) { $Name } else { "$Name.exe" }
  $candidates = @(
    (Join-Path $RustDeskServerBinDir $fileName),
    (Join-Path $env:ProgramFiles "RustDesk\$fileName"),
    (Join-Path ${env:ProgramFiles(x86)} "RustDesk\$fileName")
  )

  foreach ($path in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path $path)) {
      return $path
    }
  }

  return ''
}

function Resolve-ReleaseAssetUrl {
  try {
    $release = Invoke-RestMethod -Uri $RustDeskServerReleaseApi -Method Get
  }
  catch {
    return ''
  }

  if ($null -eq $release -or $null -eq $release.assets) {
    return ''
  }

  $osPattern = 'windows'
  $archName = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString().ToLowerInvariant()
  $archPattern = if ($archName -match 'arm') { '(arm64|aarch64)' } else { '(x86_64|amd64|x64)' }

  $best = $null
  foreach ($asset in $release.assets) {
    if ($null -eq $asset -or [string]::IsNullOrWhiteSpace([string]$asset.name)) { continue }
    if ([string]::IsNullOrWhiteSpace([string]$asset.browser_download_url)) { continue }

    $name = [string]$asset.name
    $score = 0
    if ($name -match 'rustdesk-server') { $score += 50 }
    if ($name -match $osPattern) { $score += 30 }
    if ($name -match $archPattern) { $score += 30 }
    if ($name -match '\.zip$') { $score += 20 }
    if ($name -match 'symbols|debug|sha|checksum') { $score -= 40 }

    if ($score -lt 60) { continue }

    if ($null -eq $best -or $score -gt $best.Score) {
      $best = [pscustomobject]@{
        Score = $score
        Url = [string]$asset.browser_download_url
      }
    }
  }

  if ($null -eq $best) { return '' }
  return $best.Url
}

function Download-ServerBins {
  if ($RustDeskServerDownload -ne '1') {
    return $false
  }

  New-Item -ItemType Directory -Force -Path $RustDeskServerBinDir | Out-Null

  $assetUrl = Resolve-ReleaseAssetUrl
  if ([string]::IsNullOrWhiteSpace($assetUrl)) {
    Write-WarnLog 'cannot resolve rustdesk-server release asset URL'
    return $false
  }

  $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("meco-rustdesk-server-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
  $archivePath = Join-Path $tmpDir 'rustdesk-server.zip'

  Write-Log "Downloading RustDesk server bundle: $assetUrl"
  try {
    Invoke-WebRequest -Uri $assetUrl -OutFile $archivePath -UseBasicParsing
  }
  catch {
    Remove-Item -Recurse -Force -Path $tmpDir -ErrorAction SilentlyContinue
    Write-WarnLog 'download rustdesk-server bundle failed'
    return $false
  }

  $extractDir = Join-Path $tmpDir 'extract'
  New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

  try {
    Expand-Archive -Path $archivePath -DestinationPath $extractDir -Force
  }
  catch {
    Remove-Item -Recurse -Force -Path $tmpDir -ErrorAction SilentlyContinue
    Write-WarnLog 'failed to extract rustdesk-server archive'
    return $false
  }

  $hbbs = Get-ChildItem -Path $extractDir -Recurse -File -Filter 'hbbs.exe' | Select-Object -First 1
  $hbbr = Get-ChildItem -Path $extractDir -Recurse -File -Filter 'hbbr.exe' | Select-Object -First 1

  if ($null -eq $hbbs -or $null -eq $hbbr) {
    Remove-Item -Recurse -Force -Path $tmpDir -ErrorAction SilentlyContinue
    Write-WarnLog 'downloaded package does not contain hbbs.exe/hbbr.exe'
    return $false
  }

  Copy-Item -Path $hbbs.FullName -Destination (Join-Path $RustDeskServerBinDir 'hbbs.exe') -Force
  Copy-Item -Path $hbbr.FullName -Destination (Join-Path $RustDeskServerBinDir 'hbbr.exe') -Force

  Remove-Item -Recurse -Force -Path $tmpDir -ErrorAction SilentlyContinue
  return $true
}

function Stop-RunningServer {
  $pidFiles = @(
    (Join-Path $RustDeskServerHome 'hbbs.pid'),
    (Join-Path $RustDeskServerHome 'hbbr.pid')
  )

  foreach ($pidFile in $pidFiles) {
    if (-not (Test-Path $pidFile)) { continue }
    $pidText = (Get-Content -Raw -Path $pidFile -ErrorAction SilentlyContinue).Trim()
    if ([string]::IsNullOrWhiteSpace($pidText)) {
      Remove-Item -Force -Path $pidFile -ErrorAction SilentlyContinue
      continue
    }
    $pidValue = 0
    if (-not [int]::TryParse($pidText, [ref]$pidValue)) {
      Remove-Item -Force -Path $pidFile -ErrorAction SilentlyContinue
      continue
    }

    try {
      $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
      if ($proc) {
        Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
      }
    }
    catch {}

    Remove-Item -Force -Path $pidFile -ErrorAction SilentlyContinue
  }
}

function Start-Server {
  param(
    [Parameter(Mandatory = $true)][string]$HbbsBin,
    [Parameter(Mandatory = $true)][string]$HbbrBin
  )

  $logDir = Join-Path $RustDeskServerHome 'logs'
  New-Item -ItemType Directory -Force -Path $RustDeskServerHome | Out-Null
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null

  Stop-RunningServer

  $hbbrLog = Join-Path $logDir 'hbbr.log'
  $hbbrErr = Join-Path $logDir 'hbbr.err.log'
  $hbbsLog = Join-Path $logDir 'hbbs.log'
  $hbbsErr = Join-Path $logDir 'hbbs.err.log'

  $hbbrProc = Start-Process -FilePath $HbbrBin -ArgumentList @('-p', $RustDeskHbbrPort) -WorkingDirectory $RustDeskServerHome -RedirectStandardOutput $hbbrLog -RedirectStandardError $hbbrErr -PassThru
  $hbbsProc = Start-Process -FilePath $HbbsBin -ArgumentList @('-p', $RustDeskHbbsPort, '-r', "$RustDeskRendezvousHost`:$RustDeskHbbrPort") -WorkingDirectory $RustDeskServerHome -RedirectStandardOutput $hbbsLog -RedirectStandardError $hbbsErr -PassThru

  Set-Content -Path (Join-Path $RustDeskServerHome 'hbbr.pid') -Value $hbbrProc.Id -Encoding UTF8
  Set-Content -Path (Join-Path $RustDeskServerHome 'hbbs.pid') -Value $hbbsProc.Id -Encoding UTF8

  Start-Sleep -Seconds 1

  if ($hbbrProc.HasExited -or $hbbsProc.HasExited) {
    Throw-Fail "hbbs/hbbr exited unexpectedly, check $logDir"
  }

  $runtime = @{
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    hbbs = "$RustDeskRendezvousHost:$RustDeskHbbsPort"
    hbbr = "$RustDeskRendezvousHost:$RustDeskHbbrPort"
    ws = "$RustDeskRendezvousHost:$RustDeskWsPort"
    preferredRendezvous = "$RustDeskRendezvousHost:$RustDeskHbbsPort,$RustDeskRendezvousHost:$RustDeskWsPort"
  } | ConvertTo-Json -Depth 5
  Set-Content -Path (Join-Path $RustDeskServerHome 'runtime.json') -Value $runtime -Encoding UTF8

  Write-Log 'RustDesk self-host started'
  Write-Log "hbbs=$RustDeskRendezvousHost:$RustDeskHbbsPort, hbbr=$RustDeskRendezvousHost:$RustDeskHbbrPort"
}

function Resolve-RustDeskConfigPath {
  if (-not [string]::IsNullOrWhiteSpace($RustDeskConfigPathOverride)) {
    return $RustDeskConfigPathOverride
  }

  $candidates = @(
    (Join-Path $env:APPDATA 'RustDesk\config\RustDesk2.toml'),
    (Join-Path $env:APPDATA 'RustDesk\RustDesk2.toml')
  )

  foreach ($path in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path $path)) {
      return $path
    }
  }

  return $candidates[0]
}

function Configure-LocalRustDeskClient {
  $configPath = Resolve-RustDeskConfigPath
  $configDir = Split-Path -Parent $configPath
  New-Item -ItemType Directory -Force -Path $configDir | Out-Null

  $rendezvousValue = "$RustDeskRendezvousHost:$RustDeskHbbsPort"
  $relayValue = "$RustDeskRendezvousHost:$RustDeskHbbrPort"
  $apiValue = "http://$RustDeskRendezvousHost`:21114"
  $publicKey = [Environment]::GetEnvironmentVariable('RUSTDESK_SERVER_PUBLIC_KEY')

  $line = "rendezvous_server = '$rendezvousValue'"
  $content = ''
  if (Test-Path $configPath) {
    $content = Get-Content -Raw -Path $configPath
  }

  if ($content -match '(?m)^rendezvous_server\s*=') {
    $updated = [regex]::Replace($content, '(?m)^rendezvous_server\s*=.*$', $line)
  }
  elseif ([string]::IsNullOrWhiteSpace($content)) {
    $updated = "$line`r`n"
  }
  else {
    $updated = "$line`r`n$content"
  }

  if ($updated -notmatch '(?m)^\[options\]\s*$') {
    $updated = "$updated`r`n[options]`r`n"
  }

  if ($updated -match '(?m)^custom-rendezvous-server\s*=') {
    $updated = [regex]::Replace($updated, '(?m)^custom-rendezvous-server\s*=.*$', "custom-rendezvous-server = '$rendezvousValue'")
  }
  else {
    $updated = "$updated`r`ncustom-rendezvous-server = '$rendezvousValue'"
  }

  if ($updated -match '(?m)^relay-server\s*=') {
    $updated = [regex]::Replace($updated, '(?m)^relay-server\s*=.*$', "relay-server = '$relayValue'")
  }
  else {
    $updated = "$updated`r`nrelay-server = '$relayValue'"
  }

  if ($updated -match '(?m)^api-server\s*=') {
    $updated = [regex]::Replace($updated, '(?m)^api-server\s*=.*$', "api-server = '$apiValue'")
  }
  else {
    $updated = "$updated`r`napi-server = '$apiValue'"
  }

  if (-not [string]::IsNullOrWhiteSpace($publicKey)) {
    if ($updated -match '(?m)^key\s*=') {
      $updated = [regex]::Replace($updated, '(?m)^key\s*=.*$', "key = '$publicKey'")
    }
    else {
      $updated = "$updated`r`nkey = '$publicKey'"
    }
  }

  Set-Content -Path $configPath -Value $updated -Encoding UTF8
  Write-Log "Configured RustDesk client rendezvous: $rendezvousValue ($configPath)"
}

New-Item -ItemType Directory -Force -Path $RustDeskServerHome | Out-Null
New-Item -ItemType Directory -Force -Path $RustDeskServerBinDir | Out-Null

$hbbsBin = Resolve-ServerBin -Name 'hbbs'
$hbbrBin = Resolve-ServerBin -Name 'hbbr'

if ([string]::IsNullOrWhiteSpace($hbbsBin) -or [string]::IsNullOrWhiteSpace($hbbrBin)) {
  Write-Log 'hbbs/hbbr not found locally, trying auto download...'
  if (Download-ServerBins) {
    $hbbsBin = Resolve-ServerBin -Name 'hbbs'
    $hbbrBin = Resolve-ServerBin -Name 'hbbr'
  }
}

if ([string]::IsNullOrWhiteSpace($hbbsBin)) {
  Throw-Fail "hbbs not found. Install rustdesk-server manually or place hbbs.exe in $RustDeskServerBinDir"
}
if ([string]::IsNullOrWhiteSpace($hbbrBin)) {
  Throw-Fail "hbbr not found. Install rustdesk-server manually or place hbbr.exe in $RustDeskServerBinDir"
}

Write-Log "Using hbbs: $hbbsBin"
Write-Log "Using hbbr: $hbbrBin"
Configure-LocalRustDeskClient

if ($RustDeskServerAutostart -eq '1') {
  Start-Server -HbbsBin $hbbsBin -HbbrBin $hbbrBin
}
else {
  Write-Log "Skip auto start (RUSTDESK_SERVER_AUTOSTART=$RustDeskServerAutostart)"
}
