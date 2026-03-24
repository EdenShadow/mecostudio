$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Log {
  param([string]$Message)
  Write-Host "[rustdesk-permission-win] $Message"
}

function Write-WarnLog {
  param([string]$Message)
  Write-Warning "[rustdesk-permission-win] $Message"
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

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($id)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$rustdeskExe = Resolve-RustDeskExe
if ([string]::IsNullOrWhiteSpace($rustdeskExe)) {
  throw 'RustDesk not found. Please run install-rustdesk-client-win.ps1 first.'
}

$autoLaunch = [Environment]::GetEnvironmentVariable('RUSTDESK_AUTO_LAUNCH')
if ([string]::IsNullOrWhiteSpace($autoLaunch)) { $autoLaunch = '1' }

if (Test-IsAdmin) {
  Write-Log 'Adding firewall allow rules for RustDesk (TCP/UDP 21115-21119)...'
  & netsh advfirewall firewall add rule name='RustDesk TCP Inbound' dir=in action=allow protocol=TCP localport=21115-21119 | Out-Null
  & netsh advfirewall firewall add rule name='RustDesk UDP Inbound' dir=in action=allow protocol=UDP localport=21115-21119 | Out-Null
  & netsh advfirewall firewall add rule name='RustDesk App Inbound' dir=in action=allow program="$rustdeskExe" enable=yes | Out-Null
}
else {
  Write-WarnLog 'Current PowerShell is not Administrator. Firewall rules were not changed.'
}

if ($autoLaunch -eq '1') {
  Start-Process -FilePath $rustdeskExe -ErrorAction SilentlyContinue | Out-Null
}

Write-Host ''
Write-Host '请确认 RustDesk 本机权限：'
Write-Host '1) 打开 RustDesk -> Settings -> Security'
Write-Host '2) Enable keyboard/mouse, clipboard, file transfer（按需）'
Write-Host '3) Windows 弹出防火墙/UAC 提示时选择允许'
Write-Host '4) 需要无人值守时启用 Permanent password 并设置强密码'
Write-Host ''
Write-Log "RustDesk 权限引导已执行: $rustdeskExe"
