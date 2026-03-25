$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Log {
  param([string]$Message)
  Write-Host "[rustdesk-network-win] $Message"
}

function Write-WarnLog {
  param([string]$Message)
  Write-Warning "[rustdesk-network-win] $Message"
}

function Resolve-PrivateIPv4 {
  try {
    if (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue) {
      $rows = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
          $_.IPAddress -and
          $_.IPAddress -notmatch '^(127\.|169\.254\.|26\.)' -and
          ($_.IPAddress -match '^10\.' -or $_.IPAddress -match '^192\.168\.' -or $_.IPAddress -match '^172\.(1[6-9]|2[0-9]|3[0-1])\.')
        } |
        Sort-Object -Property SkipAsSource, PrefixLength
      if ($rows -and $rows[0].IPAddress) {
        return [string]$rows[0].IPAddress
      }
    }
  }
  catch {}

  try {
    $text = ipconfig 2>$null | Out-String
    $m = [regex]::Matches($text, '(?m)\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3})\b')
    if ($m.Count -gt 0) {
      return [string]$m[0].Groups[1].Value
    }
  }
  catch {}

  return ''
}

function Get-RustDeskConfigPaths {
  $candidates = @(
    (Join-Path $env:APPDATA 'RustDesk\config\RustDesk2.toml'),
    (Join-Path $env:APPDATA 'RustDesk\config\RustDesk.toml'),
    (Join-Path $env:LOCALAPPDATA 'RustDesk\config\RustDesk2.toml'),
    (Join-Path $env:LOCALAPPDATA 'RustDesk\config\RustDesk.toml'),
    (Join-Path $env:USERPROFILE '.config\rustdesk\RustDesk2.toml')
  )

  $out = New-Object System.Collections.Generic.List[string]
  foreach ($path in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path $path)) {
      $out.Add($path)
    }
  }

  if ($out.Count -eq 0) {
    $fallback = Join-Path $env:APPDATA 'RustDesk\config\RustDesk2.toml'
    $out.Add($fallback)
  }
  return @($out.ToArray() | Select-Object -Unique)
}

function Update-LocalIpInConfig {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$LocalIp
  )

  $dir = Split-Path -Parent $Path
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  if (-not (Test-Path $Path)) {
    New-Item -ItemType File -Force -Path $Path | Out-Null
  }

  $raw = Get-Content -Raw -Path $Path -ErrorAction SilentlyContinue
  if ($null -eq $raw) { $raw = '' }
  $hasCrLf = $raw.Contains("`r`n")
  $eol = if ($hasCrLf) { "`r`n" } else { "`n" }
  $lines = @($raw -split "`r?`n")

  $optionsStart = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*\[options\]\s*$') {
      $optionsStart = $i
      break
    }
  }
  if ($optionsStart -lt 0) {
    if ($lines.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($lines[$lines.Count - 1])) {
      $lines += ''
    }
    $lines += '[options]'
    $optionsStart = $lines.Count - 1
  }

  $optionsEnd = $lines.Count
  for ($i = $optionsStart + 1; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*\[[^\]]+\]\s*$') {
      $optionsEnd = $i
      break
    }
  }

  $localIpIndex = -1
  for ($i = $optionsStart + 1; $i -lt $optionsEnd; $i++) {
    if ($lines[$i] -match '^\s*local-ip-addr\s*=') {
      $localIpIndex = $i
      break
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($LocalIp)) {
    $line = "local-ip-addr = '$LocalIp'"
    if ($localIpIndex -ge 0) {
      $lines[$localIpIndex] = $line
    }
    else {
      $head = @()
      $tail = @()
      if ($optionsEnd -gt 0) {
        $head = @($lines[0..($optionsEnd - 1)])
      }
      if ($optionsEnd -lt $lines.Count) {
        $tail = @($lines[$optionsEnd..($lines.Count - 1)])
      }
      $lines = @($head + @($line) + $tail)
    }
  }
  elseif ($localIpIndex -ge 0) {
    $head = @()
    $tail = @()
    if ($localIpIndex -gt 0) {
      $head = @($lines[0..($localIpIndex - 1)])
    }
    if ($localIpIndex -lt ($lines.Count - 1)) {
      $tail = @($lines[($localIpIndex + 1)..($lines.Count - 1)])
    }
    $lines = @($head + $tail)
  }

  $next = [string]::Join($eol, $lines)
  Set-Content -Path $Path -Value $next -Encoding UTF8
}

function Restart-RustDeskIfRunning {
  $processes = @(Get-Process -Name 'rustdesk' -ErrorAction SilentlyContinue)
  if ($processes.Count -eq 0) {
    Write-Log 'RustDesk is not running, skip restart.'
    return
  }

  foreach ($p in $processes) {
    try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Seconds 1

  $exeCandidates = @(
    (Join-Path $env:ProgramFiles 'RustDesk\rustdesk.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'RustDesk\rustdesk.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\RustDesk\rustdesk.exe')
  )
  foreach ($exe in $exeCandidates) {
    if (-not [string]::IsNullOrWhiteSpace($exe) -and (Test-Path $exe)) {
      try {
        Start-Process -FilePath $exe -ErrorAction SilentlyContinue | Out-Null
        Write-Log "Restarted RustDesk: $exe"
        return
      }
      catch {}
    }
  }

  Write-WarnLog 'RustDesk process was stopped but executable not found for relaunch.'
}

$ip = Resolve-PrivateIPv4
if ([string]::IsNullOrWhiteSpace($ip)) {
  Write-WarnLog 'No private LAN IPv4 detected. Will only clear stale local-ip-addr in config.'
}
else {
  Write-Log "Resolved private LAN IPv4: $ip"
}

$paths = Get-RustDeskConfigPaths
foreach ($path in $paths) {
  Update-LocalIpInConfig -Path $path -LocalIp $ip
  Write-Log "Patched RustDesk config: $path"
}

Restart-RustDeskIfRunning
Write-Log 'RustDesk network normalization done.'
