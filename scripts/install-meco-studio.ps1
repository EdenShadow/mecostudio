$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

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

$MecoRepoUrl = Get-EnvOrDefault -Name 'MECO_REPO_URL' -Default 'https://github.com/EdenShadow/mecostudio.git'
$MecoBranch = Get-EnvOrDefault -Name 'MECO_BRANCH' -Default 'main'
$MecoInstallDir = Get-EnvOrDefault -Name 'MECO_INSTALL_DIR' -Default (Join-Path $env:USERPROFILE 'meco-studio')
$MecoStartAfterInstall = Get-EnvOrDefault -Name 'MECO_START_AFTER_INSTALL' -Default '1'
$MecoResetRuntimeState = Get-EnvOrDefault -Name 'MECO_RESET_RUNTIME_STATE' -Default '1'
$MecoUpgradeOpenclaw = Get-EnvOrDefault -Name 'MECO_UPGRADE_OPENCLAW' -Default '0'
$MecoNpmInstallMode = Get-EnvOrDefault -Name 'MECO_NPM_INSTALL_MODE' -Default 'auto' # auto|ci|install
$MecoHealthcheckRetries = [int](Get-EnvOrDefault -Name 'MECO_HEALTHCHECK_RETRIES' -Default '20')
$MecoHealthcheckIntervalSec = [int](Get-EnvOrDefault -Name 'MECO_HEALTHCHECK_INTERVAL_SEC' -Default '1')
$MecoOpenclawModel = Get-EnvOrDefault -Name 'MECO_OPENCLAW_MODEL' -Default 'kimi-coding/k2p5'
$MecoKimiCodingApiKey = Get-EnvOrDefault -Name 'MECO_KIMI_CODING_API_KEY' -Default ''
$MecoOpenclawModelApiKey = Get-EnvOrDefault -Name 'MECO_OPENCLAW_MODEL_API_KEY' -Default ''
$MecoMinimaxApiKey = Get-EnvOrDefault -Name 'MECO_MINIMAX_API_KEY' -Default ''
$MecoMinimaxWsUrl = Get-EnvOrDefault -Name 'MECO_MINIMAX_WS_URL' -Default 'wss://api.minimaxi.com/ws/v1/t2a_v2'
$MecoTikhubApiKey = Get-EnvOrDefault -Name 'MECO_TIKHUB_API_KEY' -Default ''
$MecoMeowloadApiKey = Get-EnvOrDefault -Name 'MECO_MEOWLOAD_API_KEY' -Default ''
$MecoOpenAIApiKey = Get-EnvOrDefault -Name 'MECO_OPENAI_API_KEY' -Default ''
$MecoOssEndpoint = Get-EnvOrDefault -Name 'MECO_OSS_ENDPOINT' -Default 'https://oss-cn-hongkong.aliyuncs.com/'
$MecoOssBucket = Get-EnvOrDefault -Name 'MECO_OSS_BUCKET' -Default 'cfplusvideo'
$MecoOssAccessKeyId = Get-EnvOrDefault -Name 'MECO_OSS_ACCESS_KEY_ID' -Default ''
$MecoOssAccessKeySecret = Get-EnvOrDefault -Name 'MECO_OSS_ACCESS_KEY_SECRET' -Default ''
$OpenclawRoot = Get-EnvOrDefault -Name 'OPENCLAW_ROOT' -Default (Join-Path $env:USERPROFILE '.openclaw')
$ConfigSkillsRoot = Get-EnvOrDefault -Name 'CONFIG_SKILLS_ROOT' -Default (Join-Path $env:USERPROFILE '.config\agents\skills')
$HotTopicsRoot = Get-EnvOrDefault -Name 'HOT_TOPICS_ROOT' -Default (Join-Path $env:USERPROFILE 'Documents\知识库\热门话题')

# Remote control defaults (hardcoded deployment preset; can be overridden by env)
$MecoCloudflarePublicHost = Get-EnvOrDefault -Name 'MECO_CLOUDFLARE_PUBLIC_HOST' -Default 'https://mecoclaw.com'
$MecoCloudflarePathPrefix = Get-EnvOrDefault -Name 'MECO_CLOUDFLARE_PATH_PREFIX' -Default ''
$MecoCloudflareTunnelToken = Get-EnvOrDefault -Name 'MECO_CLOUDFLARE_TUNNEL_TOKEN' -Default 'eyJhIjoiNzMyNGQ3ZjU3MGY5MzBlMjRjODRlYTY2ZmNkM2IwYjUiLCJ0IjoiYTk1OTZiMDgtNDZjOC00NmRlLWIzZGYtN2NjYjQ4OTJhM2NkIiwicyI6Ik5EWmlaREV4TjJFdFpXRXdNeTAwWlRNNExXSTJZakF0TWpFek5HRmlNVEl4WXpCaiJ9'
$MecoRustdeskWebBaseUrl = Get-EnvOrDefault -Name 'MECO_RUSTDESK_WEB_BASE_URL' -Default '/rustdesk-web/'
$MecoRustdeskPreferredRendezvous = Get-EnvOrDefault -Name 'MECO_RUSTDESK_PREFERRED_RENDEZVOUS' -Default ''
$MecoAutoInstallCloudflared = Get-EnvOrDefault -Name 'MECO_AUTO_INSTALL_CLOUDFLARED' -Default '1'
$MecoAutoInstallRustdeskClient = Get-EnvOrDefault -Name 'MECO_AUTO_INSTALL_RUSTDESK_CLIENT' -Default '1'
$MecoAutoSetupRustdeskSelfhost = Get-EnvOrDefault -Name 'MECO_AUTO_SETUP_RUSTDESK_SELFHOST' -Default '0'
$MecoAutoGrantRustdeskPermissions = Get-EnvOrDefault -Name 'MECO_AUTO_GRANT_RUSTDESK_PERMISSIONS' -Default '1'
$MecoAutoNormalizeRustdeskNetwork = Get-EnvOrDefault -Name 'MECO_AUTO_NORMALIZE_RUSTDESK_NETWORK' -Default '1'
$MecoAutoStartCloudflareTunnel = Get-EnvOrDefault -Name 'MECO_AUTO_START_CLOUDFLARE_TUNNEL' -Default '1'
$MecoServicePort = [int](Get-EnvOrDefault -Name 'MECO_SERVICE_PORT' -Default '3456')
$MecoServicePortScanMax = [int](Get-EnvOrDefault -Name 'MECO_SERVICE_PORT_SCAN_MAX' -Default '20')
$MecoAutoInstallMeshcentral = Get-EnvOrDefault -Name 'MECO_AUTO_INSTALL_MESHCENTRAL' -Default '0'
$MecoMeshNodeBin = Get-EnvOrDefault -Name 'MECO_MESH_NODE_BIN' -Default ''
$MecoMeshcentralCert = Get-EnvOrDefault -Name 'MECO_MESHCENTRAL_CERT' -Default 'mecoclaw.com'
$MecoMeshcentralPort = [int](Get-EnvOrDefault -Name 'MECO_MESHCENTRAL_PORT' -Default '4470')
$MecoMeshcentralAliasPort = [int](Get-EnvOrDefault -Name 'MECO_MESHCENTRAL_ALIAS_PORT' -Default '443')
$MecoMeshcentralMpsPort = [int](Get-EnvOrDefault -Name 'MECO_MESHCENTRAL_MPS_PORT' -Default '44430')
$MecoMeshcentralMpsAliasPort = [int](Get-EnvOrDefault -Name 'MECO_MESHCENTRAL_MPS_ALIAS_PORT' -Default '4433')
$MecoMeshcentralAdminUser = Get-EnvOrDefault -Name 'MECO_MESHCENTRAL_ADMIN_USER' -Default 'eden_admin'
$MecoMeshcentralAdminPass = Get-EnvOrDefault -Name 'MECO_MESHCENTRAL_ADMIN_PASS' -Default 'EdenMesh@2026!'
$MecoMeshcentralAdminEmail = Get-EnvOrDefault -Name 'MECO_MESHCENTRAL_ADMIN_EMAIL' -Default 'admin@mecoclaw.local'
$MecoMeshcentralAdminName = Get-EnvOrDefault -Name 'MECO_MESHCENTRAL_ADMIN_NAME' -Default 'Eden Admin'
$MecoMeshcentralLoginToken = Get-EnvOrDefault -Name 'MECO_MESHCENTRAL_LOGIN_TOKEN' -Default ''
$MecoMeshcentralDomainPath = Get-EnvOrDefault -Name 'MECO_MESHCENTRAL_DOMAIN_PATH' -Default ''
$script:MeshcentralLoginTokenRuntime = ''

$HotTopicsCategories = @(
  'AI_Tech',
  'Entertainment',
  'Military',
  'Sports',
  'Design',
  'Health',
  'Politics',
  'Technology',
  'Economy',
  'Medical',
  'Society',
  'Trending'
)

function Write-Log {
  param([string]$Message)
  Write-Host "[meco-install-win] $Message"
}

function Write-Warn {
  param([string]$Message)
  Write-Warning "[meco-install-win] $Message"
}

function Throw-Fail {
  param([string]$Message)
  throw "[meco-install-win] $Message"
}

function Test-Cmd {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter()][string[]]$Arguments = @(),
    [Parameter()][string]$WorkingDirectory = $null,
    [Parameter()][switch]$IgnoreExitCode
  )

  if ($WorkingDirectory) {
    Push-Location $WorkingDirectory
  }

  try {
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
    if (-not $IgnoreExitCode -and $exitCode -ne 0) {
      Throw-Fail "Command failed: $FilePath $($Arguments -join ' ') (exit=$exitCode)"
    }
  }
  finally {
    if ($WorkingDirectory) {
      Pop-Location
    }
  }
}

function Install-WithWinget {
  param(
    [Parameter(Mandatory = $true)][string]$PackageId,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if (-not (Test-Cmd 'winget')) {
    Write-Warn "winget not found, cannot auto install $Label"
    return $false
  }

  Write-Log "Installing $Label via winget ($PackageId)..."
  & winget install -e --id $PackageId --silent --accept-package-agreements --accept-source-agreements | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "winget install failed for $Label"
    return $false
  }

  Start-Sleep -Seconds 2
  return $true
}

function Ensure-Git {
  if (Test-Cmd 'git') {
    return
  }

  if (-not (Install-WithWinget -PackageId 'Git.Git' -Label 'Git')) {
    Throw-Fail 'git is required. Please install Git and re-run script.'
  }

  if (-not (Test-Cmd 'git')) {
    Throw-Fail 'git install did not expose command in current shell. Open a new PowerShell window and re-run.'
  }
}

function Ensure-NodeAndNpm {
  $missing = (-not (Test-Cmd 'node')) -or (-not (Test-Cmd 'npm'))
  if ($missing) {
    if (-not (Install-WithWinget -PackageId 'OpenJS.NodeJS.LTS' -Label 'Node.js LTS')) {
      Throw-Fail 'node/npm is required. Please install Node.js >= 22.12 and re-run script.'
    }
  }

  if (-not (Test-Cmd 'node') -or -not (Test-Cmd 'npm')) {
    Throw-Fail 'node/npm not found in current shell. Open a new PowerShell window and re-run.'
  }

  $nodeVersion = (& node -p "process.versions.node").Trim()
  $parts = $nodeVersion.Split('.')
  $major = [int]$parts[0]
  $minor = [int]$parts[1]
  $ok = ($major -gt 22) -or ($major -eq 22 -and $minor -ge 12)
  if (-not $ok) {
    Throw-Fail "Node.js >= 22.12 is required (current=$nodeVersion)"
  }
}

function Get-PythonLauncher {
  if (Test-Cmd 'python') {
    return @{ Exe = 'python'; Prefix = @() }
  }
  if (Test-Cmd 'py') {
    return @{ Exe = 'py'; Prefix = @('-3') }
  }
  return $null
}

function Ensure-PythonAndPip {
  $launcher = Get-PythonLauncher
  if (-not $launcher) {
    if (-not (Install-WithWinget -PackageId 'Python.Python.3.11' -Label 'Python 3')) {
      Throw-Fail 'python is required. Please install Python 3 and re-run script.'
    }
    $launcher = Get-PythonLauncher
  }

  if (-not $launcher) {
    Throw-Fail 'python command not found after install. Open a new PowerShell window and re-run.'
  }

  & $launcher.Exe @($launcher.Prefix + @('-m', 'pip', '--version')) | Out-Null
  if ($LASTEXITCODE -ne 0) {
    & $launcher.Exe @($launcher.Prefix + @('-m', 'ensurepip', '--upgrade')) | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Throw-Fail 'failed to bootstrap pip'
    }
  }

  $script:PythonLauncher = $launcher
}

function Ensure-Openclaw {
  if (Test-Cmd 'openclaw') {
    if ($MecoUpgradeOpenclaw -eq '1') {
      Write-Log 'Updating OpenClaw to latest...'
      Invoke-Checked -FilePath 'npm' -Arguments @('install', '-g', 'openclaw@latest')
    }
    else {
      Write-Log 'OpenClaw already installed, skip upgrade (set MECO_UPGRADE_OPENCLAW=1 to upgrade)'
    }
    return
  }

  Write-Log 'Installing OpenClaw...'
  Invoke-Checked -FilePath 'npm' -Arguments @('install', '-g', 'openclaw@latest')

  if (-not (Test-Cmd 'openclaw')) {
    Throw-Fail 'openclaw install failed or command not available in PATH.'
  }
}

function Ensure-KimiCli {
  if (Test-Cmd 'kimi') {
    Write-Log 'Kimi CLI already installed'
    return
  }

  Write-Warn 'Kimi CLI command not found on Windows. Please install Kimi CLI manually if you need local kimi command support.'
}

function Ensure-Cloudflared {
  if ($MecoAutoInstallCloudflared -ne '1') {
    Write-Log "Skip cloudflared install (MECO_AUTO_INSTALL_CLOUDFLARED=$MecoAutoInstallCloudflared)"
    return
  }
  if (Test-Cmd 'cloudflared') {
    Write-Log 'cloudflared already installed'
    return
  }
  if (-not (Install-WithWinget -PackageId 'Cloudflare.cloudflared' -Label 'cloudflared')) {
    Write-Warn 'cloudflared install failed, please install manually if needed'
  }
  if (-not (Test-Cmd 'cloudflared')) {
    Write-Warn 'cloudflared command still not found in PATH'
  }
}

function Invoke-RepoPowerShellScript {
  param(
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [Parameter()][hashtable]$Env = @{}
  )

  $scriptPath = Join-Path $MecoInstallDir $RelativePath
  if (-not (Test-Path $scriptPath)) {
    Write-Warn "helper script missing: $scriptPath"
    return $false
  }

  $oldValues = @{}
  foreach ($key in $Env.Keys) {
    $oldValues[$key] = [Environment]::GetEnvironmentVariable($key)
    [Environment]::SetEnvironmentVariable($key, [string]$Env[$key])
  }

  try {
    & $scriptPath
    return $true
  }
  catch {
    Write-Warn "helper script failed: $scriptPath ($($_.Exception.Message))"
    return $false
  }
  finally {
    foreach ($key in $Env.Keys) {
      [Environment]::SetEnvironmentVariable($key, $oldValues[$key])
    }
  }
}

function Ensure-RustDeskClient {
  if ($MecoAutoInstallRustdeskClient -ne '1') {
    Write-Log "Skip RustDesk client install (MECO_AUTO_INSTALL_RUSTDESK_CLIENT=$MecoAutoInstallRustdeskClient)"
    return
  }

  Write-Log 'Ensuring RustDesk client (Windows)...'
  $ok = Invoke-RepoPowerShellScript -RelativePath 'scripts\install-rustdesk-client-win.ps1'
  if ($ok) {
    Write-Log 'RustDesk client ready'
  }
  else {
    Write-Warn 'RustDesk client install script failed (continue install)'
  }
}

function Setup-RustDeskSelfhost {
  if ($MecoAutoSetupRustdeskSelfhost -ne '1') {
    Write-Log "Skip RustDesk self-host setup (MECO_AUTO_SETUP_RUSTDESK_SELFHOST=$MecoAutoSetupRustdeskSelfhost)"
    return
  }

  $host = Get-EnvOrDefault -Name 'MECO_RUSTDESK_SELFHOST_HOST' -Default '127.0.0.1'
  $hbbsPort = Get-EnvOrDefault -Name 'MECO_RUSTDESK_SELFHOST_HBBS_PORT' -Default '21116'
  $hbbrPort = Get-EnvOrDefault -Name 'MECO_RUSTDESK_SELFHOST_HBBR_PORT' -Default '21117'
  $wsPort = Get-EnvOrDefault -Name 'MECO_RUSTDESK_SELFHOST_WS_PORT' -Default '21118'
  $serverHome = Get-EnvOrDefault -Name 'MECO_RUSTDESK_SERVER_HOME' -Default (Join-Path $env:USERPROFILE '.meco-studio\rustdesk-server')

  Write-Log 'Configuring RustDesk self-host (hbbs/hbbr)...'
  $ok = Invoke-RepoPowerShellScript -RelativePath 'scripts\setup-rustdesk-selfhost.ps1' -Env @{
    RUSTDESK_RENDEZVOUS_HOST = $host
    RUSTDESK_HBBS_PORT = $hbbsPort
    RUSTDESK_HBBR_PORT = $hbbrPort
    RUSTDESK_WS_PORT = $wsPort
    RUSTDESK_SERVER_HOME = $serverHome
  }
  if ($ok) {
    Write-Log 'RustDesk self-host ready'
  }
  else {
    Write-Warn 'RustDesk self-host setup failed (continue install)'
  }
}

function Grant-RustDeskPermissions {
  if ($MecoAutoGrantRustdeskPermissions -ne '1') {
    Write-Log "Skip RustDesk permission guidance (MECO_AUTO_GRANT_RUSTDESK_PERMISSIONS=$MecoAutoGrantRustdeskPermissions)"
    return
  }

  Write-Log 'Running RustDesk permission guidance...'
  $ok = Invoke-RepoPowerShellScript -RelativePath 'scripts\grant-rustdesk-permissions-win.ps1'
  if ($ok) {
    Write-Log 'RustDesk permission guidance executed'
  }
  else {
    Write-Warn 'RustDesk permission guidance failed (continue install)'
  }
}

function Normalize-RustDeskNetwork {
  if ($MecoAutoNormalizeRustdeskNetwork -ne '1') {
    Write-Log "Skip RustDesk network normalization (MECO_AUTO_NORMALIZE_RUSTDESK_NETWORK=$MecoAutoNormalizeRustdeskNetwork)"
    return
  }

  Write-Log 'Normalizing RustDesk network config (LAN IP + stale virtual IP cleanup)...'
  $ok = Invoke-RepoPowerShellScript -RelativePath 'scripts\normalize-rustdesk-network-win.ps1'
  if ($ok) {
    Write-Log 'RustDesk network normalization completed'
  }
  else {
    Write-Warn 'RustDesk network normalization failed (continue install)'
  }
}

function Start-CloudflareTunnelRuntime {
  if ($MecoAutoStartCloudflareTunnel -ne '1') {
    Write-Log "Skip cloudflare tunnel autostart (MECO_AUTO_START_CLOUDFLARE_TUNNEL=$MecoAutoStartCloudflareTunnel)"
    return
  }

  if ([string]::IsNullOrWhiteSpace($MecoCloudflareTunnelToken)) {
    Write-Warn 'Cloudflare tunnel token is empty, skip cloudflare tunnel autostart'
    return
  }

  Ensure-Cloudflared
  if (-not (Test-Cmd 'cloudflared')) {
    Write-Warn 'cloudflared missing, skip cloudflare tunnel autostart'
    return
  }

  Write-Log 'Starting Cloudflare tunnel runtime...'
  $ok = Invoke-RepoPowerShellScript -RelativePath 'scripts\start-cloudflare-tunnel.ps1' -Env @{
    MECO_CLOUDFLARE_TUNNEL_TOKEN = $MecoCloudflareTunnelToken
  }
  if ($ok) {
    Write-Log 'Cloudflare tunnel runtime started'
  }
  else {
    Write-Warn 'Cloudflare tunnel runtime start failed (continue install)'
  }
}

function Resolve-MeshNodeBin {
  if (-not [string]::IsNullOrWhiteSpace($MecoMeshNodeBin) -and (Test-Path $MecoMeshNodeBin)) {
    return $MecoMeshNodeBin
  }
  if (Test-Cmd 'node') {
    return 'node'
  }
  Throw-Fail 'node binary not found for meshcentral runtime'
}

function Patch-MeshcentralInstallmodulesCompat {
  param([Parameter(Mandatory = $true)][string]$FilePath)
  if (-not (Test-Path $FilePath)) { return }
  $raw = Get-Content -Raw -Path $FilePath
  if ($raw -match 'require\.resolve\(moduleName\)') { return }
  if ($raw -notmatch "modulePath = ex\.stack\.split\(' '\)\.pop\(\)\.slice\(1,-3\)") {
    Write-Warn "meshcentral compat patch skipped (pattern not found): $FilePath"
    return
  }

  $replacement = @"
const msg = '' + ex;
                            const m = msg.match(/in\s+([^\s]+package\.json)/i);
                            if (m && m[1]) {
                                modulePath = m[1].replace(/^['"]+|['".,]+$/g, '');
                            }
                            if (modulePath == null) {
                                try {
                                    var resolvedModulePath = require.resolve(moduleName);
                                    var probe = require('path').dirname(resolvedModulePath);
                                    for (var pcount = 0; pcount < 6; pcount++) {
                                        var pp = require('path').join(probe, 'package.json');
                                        if (require('fs').existsSync(pp)) {
                                            try {
                                                var pj = JSON.parse(require('fs').readFileSync(pp, 'utf8'));
                                                if (pj && (pj.name == moduleName)) { modulePath = pp; break; }
                                            } catch (ex2) { }
                                        }
                                        var up = require('path').dirname(probe);
                                        if (up == probe) break;
                                        probe = up;
                                    }
                                } catch (ex3) { }
                            }
"@
  $next = $raw.Replace("modulePath = ex.stack.split(' ').pop().slice(1,-3)", $replacement)
  Set-Content -Path $FilePath -Value $next -Encoding UTF8
  Write-Log "Patched meshcentral module-compat guard: $FilePath"
}

function Get-RandomHex {
  param([int]$Bytes = 24)
  $arr = New-Object byte[] $Bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($arr)
  }
  finally {
    $rng.Dispose()
  }
  return (($arr | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Write-MeshcentralConfig {
  param([Parameter(Mandatory = $true)][string]$ConfigPath)

  $current = @{}
  if (Test-Path $ConfigPath) {
    try { $current = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json -AsHashtable } catch { $current = @{} }
  }
  if (-not $current.ContainsKey('settings') -or $null -eq $current.settings) { $current.settings = @{} }
  if (-not $current.ContainsKey('domains') -or $null -eq $current.domains) { $current.domains = @{} }
  if (-not $current.domains.ContainsKey('') -or $null -eq $current.domains['']) { $current.domains[''] = @{} }

  $settings = $current.settings
  $settings.cert = $MecoMeshcentralCert
  $settings.WANonly = $true
  $settings.port = $MecoMeshcentralPort
  $settings.portBind = '127.0.0.1'
  $settings.aliasPort = $MecoMeshcentralAliasPort
  $settings.redirPort = 0
  $settings.redirAliasPort = 80
  $settings.tlsOffload = '127.0.0.1,::1'
  $settings.trustedProxy = '127.0.0.1,::1'
  $settings.allowFraming = $true
  if (-not $settings.ContainsKey('sessionKey') -or [string]::IsNullOrWhiteSpace([string]$settings.sessionKey)) { $settings.sessionKey = Get-RandomHex -Bytes 24 }
  if (-not $settings.ContainsKey('dbEncryptKey') -or [string]::IsNullOrWhiteSpace([string]$settings.dbEncryptKey)) { $settings.dbEncryptKey = Get-RandomHex -Bytes 24 }
  $settings.mpsPort = $MecoMeshcentralMpsPort
  $settings.mpsPortBind = '127.0.0.1'
  $settings.mpsAliasPort = $MecoMeshcentralMpsAliasPort

  $domain = $current.domains['']
  if (-not $domain.ContainsKey('title')) { $domain.title = 'Meco Mesh' }
  if (-not $domain.ContainsKey('title2')) { $domain.title2 = 'MeshCentral' }
  $domain.newAccounts = $true
  $domain.minify = $true
  $certHost = [string]$MecoMeshcentralCert
  $certHost = $certHost -replace '^\s*https?://', ''
  $certHost = ($certHost -split '/')[0]
  $certHost = ($certHost -split ':')[0]
  $certHost = $certHost.Trim().ToLowerInvariant()
  $allowedOrigins = @()
  foreach ($h in @($certHost, '127.0.0.1', 'localhost')) {
    if (-not [string]::IsNullOrWhiteSpace($h) -and -not ($allowedOrigins -contains $h)) {
      $allowedOrigins += $h
    }
  }
  $domain.allowedorigin = ($allowedOrigins -join ',')

  $dir = Split-Path -Parent $ConfigPath
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $json = $current | ConvertTo-Json -Depth 20
  Set-Content -Path $ConfigPath -Value $json -Encoding UTF8
}

function Ensure-MeshcentralRuntime {
  Write-Log 'MeshCentral support removed; skip meshcentral runtime install.'
  return
  if ($MecoAutoInstallMeshcentral -ne '1') {
    Write-Log "Skip meshcentral install (MECO_AUTO_INSTALL_MESHCENTRAL=$MecoAutoInstallMeshcentral)"
    return
  }

  $nodeBin = Resolve-MeshNodeBin
  $mcDir = Join-Path $MecoInstallDir 'meshcentral'
  New-Item -ItemType Directory -Force -Path $mcDir | Out-Null

  $pkgJson = Join-Path $mcDir 'package.json'
  if (-not (Test-Path $pkgJson)) {
    Invoke-Checked -FilePath 'npm' -Arguments @('init', '-y') -WorkingDirectory $mcDir
  }

  Write-Log 'Installing meshcentral runtime dependencies...'
  Invoke-Checked -FilePath 'npm' -Arguments @('install', '--no-fund', '--no-audit', '--omit=optional', 'meshcentral', 'ua-client-hints-js@0.1.2') -WorkingDirectory $mcDir -IgnoreExitCode
  $mcModuleDir = Join-Path $mcDir 'node_modules\meshcentral'
  if (Test-Path $mcModuleDir) {
    Invoke-Checked -FilePath 'npm' -Arguments @('install', '--no-fund', '--no-audit', '--omit=optional', 'ua-client-hints-js@0.1.2') -WorkingDirectory $mcModuleDir -IgnoreExitCode
    Patch-MeshcentralInstallmodulesCompat -FilePath (Join-Path $mcModuleDir 'meshcentral.js')
  }

  $configPath = Join-Path $mcDir 'meshcentral-data\config.json'
  Write-MeshcentralConfig -ConfigPath $configPath

  $meshNodeProcs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
  foreach ($proc in $meshNodeProcs) {
    if ($null -eq $proc.CommandLine) { continue }
    if ($proc.CommandLine -like "*$mcDir*node_modules*meshcentral*--configfile*config.json*") {
      try { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  }

  Push-Location $mcDir
  try {
    $createOut = (& $nodeBin 'node_modules/meshcentral' '--configfile' 'config.json' '--createaccount' $MecoMeshcentralAdminUser '--pass' $MecoMeshcentralAdminPass '--email' $MecoMeshcentralAdminEmail '--name' $MecoMeshcentralAdminName 2>&1 | Out-String)
    if ($createOut -match 'Done\.' -or $createOut -match 'User already exists\.') {
      Write-Log "MeshCentral admin account ready: $MecoMeshcentralAdminUser"
    }
    else {
      Write-Warn "MeshCentral createaccount output: $($createOut.Trim())"
    }

    $adminOut = (& $nodeBin 'node_modules/meshcentral' '--configfile' 'config.json' '--adminaccount' $MecoMeshcentralAdminUser 2>&1 | Out-String)
    if ($adminOut -match 'Done\.') {
      Write-Log "MeshCentral admin privilege ensured: $MecoMeshcentralAdminUser"
    }
    else {
      Write-Warn "MeshCentral adminaccount output: $($adminOut.Trim())"
    }

    $tokenOut = (& $nodeBin 'node_modules/meshcentral' '--configfile' 'config.json' '--logintoken' "user//$MecoMeshcentralAdminUser" 2>&1 | Out-String)
    $lastLine = (($tokenOut -split "`r?`n") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Last 1)
    if ($lastLine -and $lastLine -match '^[A-Za-z0-9._~=-]{32,}$') {
      $script:MeshcentralLoginTokenRuntime = $lastLine.Trim()
      Write-Log "MeshCentral login token generated for $MecoMeshcentralAdminUser"
    }
    else {
      Write-Warn 'MeshCentral logintoken generation did not return a valid token'
    }
  }
  finally {
    Pop-Location
  }

  if (-not [string]::IsNullOrWhiteSpace($script:MeshcentralLoginTokenRuntime)) {
    $secretDir = Join-Path $env:USERPROFILE '.meco-studio'
    New-Item -ItemType Directory -Force -Path $secretDir | Out-Null
    $secretPath = Join-Path $secretDir 'meshcentral-bootstrap.json'
    $payload = @{
      updatedAt = (Get-Date).ToUniversalTime().ToString('o')
      meshcentralAdminUser = $MecoMeshcentralAdminUser
      meshcentralAdminPass = $MecoMeshcentralAdminPass
      meshcentralLoginToken = $script:MeshcentralLoginTokenRuntime
    } | ConvertTo-Json -Depth 8
    Set-Content -Path $secretPath -Value $payload -Encoding UTF8
    Write-Log "Stored Mesh bootstrap secret locally: $secretPath"
  }

  $stdout = Join-Path $mcDir 'meshcentral.log'
  $stderr = Join-Path $mcDir 'meshcentral.err.log'
  $proc = Start-Process -FilePath $nodeBin -ArgumentList @('node_modules/meshcentral', '--configfile', 'config.json') -WorkingDirectory $mcDir -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  $healthy = $false
  for ($i = 0; $i -lt 18; $i++) {
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$MecoMeshcentralPort/" -TimeoutSec 3
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        $healthy = $true
        break
      }
    }
    catch {
      Start-Sleep -Seconds 1
    }
  }
  if ($healthy) {
    Write-Log "MeshCentral started. pid=$($proc.Id), url=http://127.0.0.1:$MecoMeshcentralPort"
  }
  else {
    Write-Warn "MeshCentral process started but healthcheck failed, check $stdout / $stderr"
  }
}

function Configure-OpenclawKimiAuth {
  param([string]$OpenclawModelApiKey)

  if ([string]::IsNullOrWhiteSpace($OpenclawModelApiKey)) {
    Write-Warn 'MECO_OPENCLAW_MODEL_API_KEY (or fallback MECO_KIMI_CODING_API_KEY) is empty, skip OpenClaw kimi-code auth bootstrap'
    return
  }

  if (-not (Test-Cmd 'openclaw')) {
    Write-Warn 'openclaw command not found, skip OpenClaw kimi auth bootstrap'
    return
  }

  $workspaceDir = Join-Path $OpenclawRoot 'workspace'
  New-Item -ItemType Directory -Force -Path $workspaceDir | Out-Null

  Write-Log 'Configuring OpenClaw auth via kimi-code-api-key...'
  & openclaw onboard `
    --non-interactive `
    --accept-risk `
    --mode local `
    --auth-choice kimi-code-api-key `
    --kimi-code-api-key $OpenclawModelApiKey `
    --skip-daemon `
    --skip-skills `
    --skip-search `
    --skip-ui `
    --skip-channels `
    --workspace $workspaceDir | Out-Null

  if ($LASTEXITCODE -eq 0) {
    Write-Log 'Configured OpenClaw auth via kimi-code-api-key'
  }
  else {
    Write-Warn 'openclaw onboard (kimi-code-api-key) failed, continue with direct config patch'
  }
}

function Configure-KimiApiKey {
  param([string]$KimiApiKey)

  if ([string]::IsNullOrWhiteSpace($KimiApiKey)) {
    return
  }

  $kimiHome = Join-Path $env:USERPROFILE '.kimi'
  New-Item -ItemType Directory -Force -Path $kimiHome | Out-Null
  $kimiConfigPath = Join-Path $kimiHome 'config.json'

  $payload = @{
    api_key = $KimiApiKey
    base_url = 'https://api.moonshot.cn/v1'
  } | ConvertTo-Json -Depth 5

  Set-Content -Path $kimiConfigPath -Value $payload -Encoding UTF8
  Write-Log "Updated Kimi config: $kimiConfigPath"
}

function Configure-OpenclawDefaults {
  param(
    [Parameter(Mandatory = $true)][string]$Model,
    [Parameter(Mandatory = $false)][string]$ProviderKey
  )

  New-Item -ItemType Directory -Force -Path $OpenclawRoot | Out-Null
  $openclawConfigPath = Join-Path $OpenclawRoot 'openclaw.json'

  $conf = @{}
  if (Test-Path $openclawConfigPath) {
    try {
      $conf = Get-Content -Raw -Path $openclawConfigPath | ConvertFrom-Json -AsHashtable
    }
    catch {
      $conf = @{}
    }
  }

  if (-not $conf.ContainsKey('gateway') -or $null -eq $conf.gateway) { $conf.gateway = @{} }
  if (-not $conf.gateway.ContainsKey('port')) { $conf.gateway.port = 18789 }
  if (-not $conf.gateway.ContainsKey('mode') -or [string]::IsNullOrWhiteSpace([string]$conf.gateway.mode)) { $conf.gateway.mode = 'local' }
  if (-not $conf.gateway.ContainsKey('bind') -or [string]::IsNullOrWhiteSpace([string]$conf.gateway.bind)) { $conf.gateway.bind = 'loopback' }
  if (-not $conf.gateway.ContainsKey('auth') -or $null -eq $conf.gateway.auth) { $conf.gateway.auth = @{} }
  if (-not $conf.gateway.ContainsKey('controlUi') -or $null -eq $conf.gateway.controlUi) { $conf.gateway.controlUi = @{} }
  if (-not $conf.gateway.controlUi.ContainsKey('allowedOrigins') -or $null -eq $conf.gateway.controlUi.allowedOrigins) {
    $conf.gateway.controlUi.allowedOrigins = @('*')
  }
  if (-not $conf.gateway.ContainsKey('http') -or $null -eq $conf.gateway.http) { $conf.gateway.http = @{} }
  if (-not $conf.gateway.http.ContainsKey('endpoints') -or $null -eq $conf.gateway.http.endpoints) { $conf.gateway.http.endpoints = @{} }
  if (-not $conf.gateway.http.endpoints.ContainsKey('chatCompletions') -or $null -eq $conf.gateway.http.endpoints.chatCompletions) {
    $conf.gateway.http.endpoints.chatCompletions = @{}
  }
  $conf.gateway.http.endpoints.chatCompletions.enabled = $true
  if ($conf.gateway.http.endpoints.chatCompletions.ContainsKey('images')) {
    $null = $conf.gateway.http.endpoints.chatCompletions.Remove('images')
  }

  if (-not $conf.ContainsKey('agents') -or $null -eq $conf.agents) { $conf.agents = @{} }
  if (-not $conf.agents.ContainsKey('defaults') -or $null -eq $conf.agents.defaults) { $conf.agents.defaults = @{} }
  if (-not $conf.agents.defaults.ContainsKey('model') -or $null -eq $conf.agents.defaults.model) { $conf.agents.defaults.model = @{} }
  $conf.agents.defaults.model.primary = $Model

  if (-not $conf.ContainsKey('models') -or $null -eq $conf.models) { $conf.models = @{} }
  if (-not $conf.models.ContainsKey('providers') -or $null -eq $conf.models.providers) { $conf.models.providers = @{} }
  if (-not $conf.models.providers.ContainsKey('kimi-coding') -or $null -eq $conf.models.providers.'kimi-coding') {
    $conf.models.providers.'kimi-coding' = @{}
  }

  $conf.models.providers.'kimi-coding'.baseUrl = 'https://api.kimi.com/coding/'
  $conf.models.providers.'kimi-coding'.api = 'anthropic-messages'
  $conf.models.providers.'kimi-coding'.models = @(@{ id = 'k2p5'; name = 'Kimi K2.5' })

  if (-not [string]::IsNullOrWhiteSpace($ProviderKey)) {
    $providerId = ''
    if ($Model.Contains('/')) { $providerId = $Model.Split('/')[0] }
    if (-not [string]::IsNullOrWhiteSpace($providerId)) {
      if (-not $conf.models.providers.ContainsKey($providerId) -or $null -eq $conf.models.providers[$providerId]) {
        $conf.models.providers[$providerId] = @{}
      }
      $conf.models.providers[$providerId].apiKey = $ProviderKey
    }
    $conf.models.providers.'kimi-coding'.apiKey = $ProviderKey
  }

  if ($conf.agents.ContainsKey('list') -and $conf.agents.list -is [System.Collections.IEnumerable]) {
    foreach ($agent in $conf.agents.list) {
      if ($agent -is [hashtable] -or $agent.PSObject.Properties.Name -contains 'model') {
        $agent.model = $Model
      }
    }
  }

  $json = $conf | ConvertTo-Json -Depth 20
  Set-Content -Path $openclawConfigPath -Value $json -Encoding UTF8
  Write-Log "Configured OpenClaw defaults: model=$Model"
}

function Configure-MecoRuntimeSettings {
  param(
    [Parameter(Mandatory = $true)][string]$KimiApiKey,
    [Parameter(Mandatory = $true)][string]$OpenclawModelApiKey
  )

  $settingsPath = Get-EnvOrDefault -Name 'MECO_SETTINGS_PATH' -Default (Join-Path $env:USERPROFILE '.meco-studio\app-settings.json')
  $settingsDir = Split-Path -Parent $settingsPath
  New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null

  $current = @{}
  if (Test-Path $settingsPath) {
    try {
      $current = Get-Content -Raw -Path $settingsPath | ConvertFrom-Json -AsHashtable
    }
    catch {
      $current = @{}
    }
  }

  $patch = @{
    openclawModel = $MecoOpenclawModel
    openclawModelApiKey = $OpenclawModelApiKey
    minimaxApiKey = $MecoMinimaxApiKey
    minimaxWsUrl = $MecoMinimaxWsUrl
    tikhubApiKey = $MecoTikhubApiKey
    meowloadApiKey = $MecoMeowloadApiKey
    kimiApiKey = $KimiApiKey
    hotTopicsKbPath = $HotTopicsRoot
    openaiApiKey = $MecoOpenAIApiKey
    ossEndpoint = $MecoOssEndpoint
    ossBucket = $MecoOssBucket
    ossAccessKeyId = $MecoOssAccessKeyId
    ossAccessKeySecret = $MecoOssAccessKeySecret
    cloudflarePublicHost = $MecoCloudflarePublicHost
    cloudflarePathPrefix = $MecoCloudflarePathPrefix
    cloudflareTunnelToken = $MecoCloudflareTunnelToken
    rustdeskWebBaseUrl = $MecoRustdeskWebBaseUrl
    rustdeskSchemeAuthority = 'connect'
    rustdeskPreferredRendezvous = $MecoRustdeskPreferredRendezvous
  }

  foreach ($key in $patch.Keys) {
    $value = [string]$patch[$key]
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      $current[$key] = $value
    }
    elseif (-not $current.ContainsKey($key)) {
      $current[$key] = ''
    }
  }
  # Installer defaults should be authoritative for rendezvous preference.
  $current['rustdeskPreferredRendezvous'] = [string]$MecoRustdeskPreferredRendezvous

  $json = $current | ConvertTo-Json -Depth 10
  Set-Content -Path $settingsPath -Value $json -Encoding UTF8
  Write-Log "Updated Meco runtime settings: $settingsPath"
}

function Get-OpenclawGatewayPort {
  $openclawConfigPath = Join-Path $OpenclawRoot 'openclaw.json'
  if (-not (Test-Path $openclawConfigPath)) {
    return 18789
  }
  try {
    $conf = Get-Content -Raw -Path $openclawConfigPath | ConvertFrom-Json
    $port = [int]($conf.gateway.port)
    if ($port -gt 0) { return $port }
  }
  catch {}
  return 18789
}

function Ensure-OpenclawGateway {
  if (-not (Test-Cmd 'openclaw')) {
    Write-Warn 'OpenClaw command not found, skip gateway startup check'
    return
  }

  Write-Log 'Ensuring OpenClaw Gateway is running...'
  & openclaw gateway restart *> $null
  if ($LASTEXITCODE -ne 0) {
    & openclaw gateway start *> $null
    if ($LASTEXITCODE -ne 0) {
      Write-Warn 'OpenClaw gateway restart/start failed, trying background run fallback...'
      $runtimeDir = Join-Path $env:USERPROFILE '.meco-studio\openclaw'
      $pidFile = Join-Path $runtimeDir 'gateway.pid'
      $logFile = Join-Path $runtimeDir 'gateway.log'
      $errFile = Join-Path $runtimeDir 'gateway.err.log'
      New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

      $existingPid = ''
      if (Test-Path $pidFile) {
        try { $existingPid = (Get-Content -Raw -Path $pidFile).Trim() } catch {}
      }
      $existingProc = $null
      if (-not [string]::IsNullOrWhiteSpace($existingPid) -and $existingPid -match '^\d+$') {
        $existingProc = Get-Process -Id ([int]$existingPid) -ErrorAction SilentlyContinue
        if ($existingProc) {
          Write-Log "OpenClaw gateway fallback already running (pid=$existingPid)"
        }
      }

      if (-not $existingProc) {
        $gatewayPort = Get-OpenclawGatewayPort
        $fallback = Start-Process -FilePath 'openclaw' -ArgumentList @('gateway', 'run', '--allow-unconfigured', '--bind', 'loopback', '--port', [string]$gatewayPort) -RedirectStandardOutput $logFile -RedirectStandardError $errFile -PassThru
        Set-Content -Path $pidFile -Value $fallback.Id -Encoding UTF8
        Start-Sleep -Seconds 1
        if ($fallback.HasExited) {
          Write-Warn 'OpenClaw gateway fallback run failed (continue install)'
          return
        }
        Write-Log "OpenClaw gateway fallback started (pid=$($fallback.Id))"
      }
    }
    else {
      Write-Log 'OpenClaw gateway started'
    }
  }
  else {
    Write-Log 'OpenClaw gateway restarted'
  }

  $gatewayPort = Get-OpenclawGatewayPort
  $probeUrl = "http://127.0.0.1:$gatewayPort/v1/chat/completions"
  $ready = $false
  $lastStatus = ''
  for ($i = 0; $i -lt $MecoHealthcheckRetries; $i++) {
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Method POST -Uri $probeUrl -ContentType 'application/json' -Body '{}' -TimeoutSec 3
      $lastStatus = [string]$resp.StatusCode
      if ($resp.StatusCode -ne 404) {
        $ready = $true
        break
      }
    }
    catch {
      $status = $null
      if ($_.Exception -and $_.Exception.Response) {
        try { $status = [int]$_.Exception.Response.StatusCode } catch {}
      }
      if ($null -ne $status) {
        $lastStatus = [string]$status
        if ($status -ne 404) {
          $ready = $true
          break
        }
      }
    }
    Start-Sleep -Seconds $MecoHealthcheckIntervalSec
  }

  if ($ready) {
    Write-Log "OpenClaw gateway endpoint ready: $probeUrl (status=$lastStatus)"
  }
  else {
    Write-Warn "OpenClaw gateway endpoint /v1/chat/completions not ready (url=$probeUrl, last_status=$lastStatus)"
  }
}

function Prepare-Repo {
  $gitDir = Join-Path $MecoInstallDir '.git'
  if (Test-Path $gitDir) {
    Write-Log 'Meco Studio exists, pulling latest...'
    Invoke-Checked -FilePath 'git' -Arguments @('-C', $MecoInstallDir, 'fetch', 'origin', $MecoBranch)
    Invoke-Checked -FilePath 'git' -Arguments @('-C', $MecoInstallDir, 'checkout', $MecoBranch)
    Invoke-Checked -FilePath 'git' -Arguments @('-C', $MecoInstallDir, 'pull', '--ff-only', 'origin', $MecoBranch)
    return
  }

  Write-Log "Cloning Meco Studio into $MecoInstallDir ..."
  Invoke-Checked -FilePath 'git' -Arguments @('clone', '--branch', $MecoBranch, $MecoRepoUrl, $MecoInstallDir)
}

function Install-NpmDependencies {
  $lockFile = Join-Path $MecoInstallDir 'package-lock.json'
  $npmCmd = 'install'

  switch ($MecoNpmInstallMode) {
    'ci' { $npmCmd = 'ci' }
    'install' { $npmCmd = 'install' }
    default {
      if (Test-Path $lockFile) { $npmCmd = 'ci' } else { $npmCmd = 'install' }
    }
  }

  Write-Log "Installing npm dependencies via: npm $npmCmd"
  Invoke-Checked -FilePath 'npm' -Arguments @($npmCmd, '--no-fund', '--no-audit') -WorkingDirectory $MecoInstallDir
}

function Copy-Overlay {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Target
  )

  if (-not (Test-Path $Source)) {
    return
  }

  New-Item -ItemType Directory -Force -Path $Target | Out-Null

  $sourceRoot = (Resolve-Path $Source).Path
  $items = Get-ChildItem -Path $sourceRoot -Recurse -Force
  foreach ($item in $items) {
    $relative = $item.FullName.Substring($sourceRoot.Length).TrimStart('\\', '/')
    if ([string]::IsNullOrWhiteSpace($relative)) {
      continue
    }

    $destPath = Join-Path $Target $relative
    if ($item.PSIsContainer) {
      New-Item -ItemType Directory -Force -Path $destPath | Out-Null
    }
    else {
      $destDir = Split-Path -Parent $destPath
      New-Item -ItemType Directory -Force -Path $destDir | Out-Null
      Copy-Item -Path $item.FullName -Destination $destPath -Force
    }
  }
}

function Ensure-HotTopicsSkill {
  $hotTopicsTarget = Join-Path $ConfigSkillsRoot 'hot-topics'
  $src1 = Join-Path $MecoInstallDir 'bootstrap\openclaw\skills\config\hot-topics'
  $src2 = Join-Path $MecoInstallDir 'bootstrap\openclaw\skills\openclaw\hot-topics'
  $src3 = Join-Path $OpenclawRoot 'skills\hot-topics'

  $src = $null
  if (Test-Path $src1) { $src = $src1 }
  elseif (Test-Path $src2) { $src = $src2 }
  elseif (Test-Path $src3) { $src = $src3 }

  if ($null -eq $src) {
    Write-Warn 'hot-topics skill source not found, skipped'
    return
  }

  New-Item -ItemType Directory -Force -Path $ConfigSkillsRoot | Out-Null
  Copy-Overlay -Source $src -Target $hotTopicsTarget
  Write-Log "Installed hot-topics skill to $hotTopicsTarget"
}

function Sync-OpenclawSkillSwitchesFromManifest {
  $manifestPath = Join-Path $MecoInstallDir 'bootstrap\openclaw\manifest.json'
  if (-not (Test-Path $manifestPath)) {
    return
  }

  $manifest = $null
  try {
    $manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json -AsHashtable
  }
  catch {
    return
  }

  if ($null -eq $manifest -or -not $manifest.ContainsKey('skills')) {
    return
  }

  $openclawSkills = @()
  if ($manifest.skills -is [hashtable] -and $manifest.skills.ContainsKey('openclaw') -and $manifest.skills.openclaw -is [System.Collections.IEnumerable]) {
    $openclawSkills = @($manifest.skills.openclaw)
  }
  if ($openclawSkills.Count -eq 0) {
    return
  }

  $stateMap = @{}
  if ($manifest.skills -is [hashtable] -and $manifest.skills.ContainsKey('state') -and $manifest.skills.state -is [hashtable]) {
    $stateMap = $manifest.skills.state
  }

  New-Item -ItemType Directory -Force -Path $OpenclawRoot | Out-Null
  $openclawConfigPath = Join-Path $OpenclawRoot 'openclaw.json'
  $conf = @{}
  if (Test-Path $openclawConfigPath) {
    try {
      $conf = Get-Content -Raw -Path $openclawConfigPath | ConvertFrom-Json -AsHashtable
    }
    catch {
      $conf = @{}
    }
  }

  if (-not $conf.ContainsKey('skills') -or $null -eq $conf.skills) { $conf.skills = @{} }
  if (-not $conf.skills.ContainsKey('entries') -or $null -eq $conf.skills.entries) { $conf.skills.entries = @{} }

  $changed = 0
  $defaultOn = 0
  foreach ($rawSkill in $openclawSkills) {
    $skill = [string]$rawSkill
    if ([string]::IsNullOrWhiteSpace($skill)) {
      continue
    }

    $enabled = $true
    if ($stateMap.ContainsKey($skill) -and $stateMap[$skill] -is [bool]) {
      $enabled = [bool]$stateMap[$skill]
    }
    else {
      $defaultOn++
    }

    if (-not $conf.skills.entries.ContainsKey($skill) -or $null -eq $conf.skills.entries[$skill]) {
      $conf.skills.entries[$skill] = @{}
    }

    if (-not $conf.skills.entries[$skill].ContainsKey('enabled') -or [bool]$conf.skills.entries[$skill].enabled -ne $enabled) {
      $changed++
    }
    $conf.skills.entries[$skill].enabled = $enabled
  }

  $json = $conf | ConvertTo-Json -Depth 20
  Set-Content -Path $openclawConfigPath -Value $json -Encoding UTF8
  Write-Log "Synced OpenClaw skill switches: total=$($openclawSkills.Count), changed=$changed, defaultOn=$defaultOn"
}

function Ensure-HotTopicsKnowledgeBase {
  $kbRoot = Split-Path -Parent $HotTopicsRoot
  New-Item -ItemType Directory -Force -Path $kbRoot | Out-Null

  if (-not (Test-Path $HotTopicsRoot)) {
    New-Item -ItemType Directory -Force -Path $HotTopicsRoot | Out-Null
    Write-Log "Created knowledge base root: $HotTopicsRoot"
  }
  else {
    Write-Log "Knowledge base root already exists, keep existing data: $HotTopicsRoot"
  }

  $createdCount = 0
  foreach ($category in $HotTopicsCategories) {
    $categoryDir = Join-Path $HotTopicsRoot $category
    if (Test-Path $categoryDir) {
      continue
    }

    New-Item -ItemType Directory -Force -Path $categoryDir | Out-Null
    $createdCount++
    Write-Log "Created category folder: $categoryDir"
  }

  Write-Log "Ensured hot-topics categories under $HotTopicsRoot (total=$($HotTopicsCategories.Count), created=$createdCount)"
}

function Install-SkillRuntimeDependencies {
  if (-not $script:PythonLauncher) {
    return
  }

  Write-Log 'Installing Python skill dependencies...'
  & $script:PythonLauncher.Exe @($script:PythonLauncher.Prefix + @('-m', 'pip', 'install', '--user', '--upgrade', 'requests', 'aiohttp', 'aiofiles', 'pillow', 'openai', 'openai-whisper')) | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Warn 'Python skill dependency install failed. You can retry manually with pip.'
  }
}

function Reset-RuntimeState {
  if ($MecoResetRuntimeState -ne '1') {
    return
  }

  Write-Log 'Resetting runtime room state (no default test room)...'
  $dataDir = Join-Path $MecoInstallDir 'data'
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

  $roomsFile = Join-Path $dataDir 'rooms.json'
  Set-Content -Path $roomsFile -Value '[]' -Encoding UTF8

  $coversDir = Join-Path $dataDir 'room-covers'
  New-Item -ItemType Directory -Force -Path $coversDir | Out-Null
  Get-ChildItem -Path $coversDir -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
}

function Stop-OldServerProcess {
  $pidFile = Join-Path $MecoInstallDir '.meco-studio.pid'

  if (Test-Path $pidFile) {
    try {
      $oldPidText = (Get-Content -Raw -Path $pidFile).Trim()
      if (-not [string]::IsNullOrWhiteSpace($oldPidText)) {
        $oldPid = [int]$oldPidText
        $proc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
        if ($proc) {
          Write-Log "Stopping existing meco server process: $oldPid"
          Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
        }
      }
    }
    catch {
      Write-Warn 'Failed to parse existing pid file, continue...'
    }
  }

  $nodeProcs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
  foreach ($proc in $nodeProcs) {
    if ($null -eq $proc.CommandLine) {
      continue
    }
    if ($proc.CommandLine -like "*$MecoInstallDir*server.js*") {
      try {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
      }
      catch {
        Write-Warn "Failed stopping stale node process: $($proc.ProcessId)"
      }
    }
  }
}

function Get-ListeningPidsByPort {
  param([Parameter(Mandatory = $true)][int]$Port)

  $pids = @()
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    try {
      $rows = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
      if ($rows) {
        $pids += @($rows | Select-Object -ExpandProperty OwningProcess -ErrorAction SilentlyContinue)
      }
    }
    catch {}
  }

  if ($pids.Count -eq 0) {
    try {
      $netstat = netstat -ano -p tcp 2>$null
      foreach ($line in $netstat) {
        if ($line -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$") {
          $pids += [int]$matches[1]
        }
      }
    }
    catch {}
  }

  return @($pids | Where-Object { $_ -and $_ -gt 0 } | Select-Object -Unique)
}

function Resolve-ServicePort {
  param([Parameter(Mandatory = $true)][int]$PreferredPort)

  $target = $PreferredPort
  if ($target -le 0) { $target = 3456 }
  $listeners = @(Get-ListeningPidsByPort -Port $target)

  if ($listeners.Count -gt 0) {
    foreach ($pid in $listeners) {
      $cmdLine = ''
      try {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue
        if ($proc -and $proc.CommandLine) { $cmdLine = [string]$proc.CommandLine }
      }
      catch {}
      if ($cmdLine -match 'node' -and $cmdLine -match 'server\.js') {
        Write-Log "Stopping process on port $target (pid=$pid): $cmdLine"
        try { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
  }

  $listeners = @(Get-ListeningPidsByPort -Port $target)
  if ($listeners.Count -eq 0) {
    return $target
  }

  Write-Warn "Port $target occupied by non-meco process, trying next available port..."
  $attempt = 0
  while ($attempt -lt $MecoServicePortScanMax) {
    $attempt++
    $candidate = $target + $attempt
    $candidateListeners = @(Get-ListeningPidsByPort -Port $candidate)
    if ($candidateListeners.Count -eq 0) {
      Write-Warn "Service port switched from $target to $candidate"
      return $candidate
    }
  }

  Throw-Fail "Unable to allocate service port near $target. Set MECO_SERVICE_PORT manually and retry."
}

function Start-Service {
  if ($MecoStartAfterInstall -ne '1') {
    Write-Log "Skip start service (MECO_START_AFTER_INSTALL=$MecoStartAfterInstall)"
    return
  }

  Stop-OldServerProcess
  $servicePort = Resolve-ServicePort -PreferredPort $MecoServicePort

  Write-Log 'Starting meco-studio service...'
  $pidFile = Join-Path $MecoInstallDir '.meco-studio.pid'
  $portFile = Join-Path $MecoInstallDir '.meco-studio.port'
  $stdout = Join-Path $MecoInstallDir 'server.log'
  $stderr = Join-Path $MecoInstallDir 'server.err.log'

  $oldPortEnv = [Environment]::GetEnvironmentVariable('PORT', 'Process')
  [Environment]::SetEnvironmentVariable('PORT', [string]$servicePort, 'Process')
  try {
    $process = Start-Process -FilePath 'node' -ArgumentList @('server.js') -WorkingDirectory $MecoInstallDir -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  }
  finally {
    [Environment]::SetEnvironmentVariable('PORT', $oldPortEnv, 'Process')
  }
  Set-Content -Path $pidFile -Value $process.Id -Encoding UTF8

  $healthy = $false
  for ($i = 0; $i -lt $MecoHealthcheckRetries; $i++) {
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$servicePort/api/status" -TimeoutSec 3
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        $healthy = $true
        break
      }
    }
    catch {
      Start-Sleep -Seconds $MecoHealthcheckIntervalSec
    }
  }

  if (-not $healthy) {
    Throw-Fail "service process started but healthcheck failed, check $stdout / $stderr"
  }

  Set-Content -Path $portFile -Value $servicePort -Encoding UTF8
  $runtimeDir = Join-Path $env:USERPROFILE '.meco-studio'
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  Set-Content -Path (Join-Path $runtimeDir 'service-port') -Value $servicePort -Encoding UTF8

  Write-Log "Service started. pid=$($process.Id), url=http://127.0.0.1:$servicePort"
}

function Main {
  Ensure-Git
  Ensure-NodeAndNpm
  Ensure-PythonAndPip
  Ensure-Openclaw

  $effectiveModelKey = $MecoOpenclawModelApiKey
  if ([string]::IsNullOrWhiteSpace($effectiveModelKey)) {
    $effectiveModelKey = $MecoKimiCodingApiKey
  }

  Configure-OpenclawKimiAuth -OpenclawModelApiKey $effectiveModelKey
  Configure-OpenclawDefaults -Model $MecoOpenclawModel -ProviderKey $effectiveModelKey
  Prepare-Repo
  Ensure-KimiCli
  Install-NpmDependencies
  Ensure-Cloudflared
  Ensure-RustDeskClient
  Setup-RustDeskSelfhost
  Normalize-RustDeskNetwork
  Grant-RustDeskPermissions
  Ensure-HotTopicsKnowledgeBase
  Ensure-HotTopicsSkill
  Sync-OpenclawSkillSwitchesFromManifest
  Ensure-HotTopicsKnowledgeBase
  Install-SkillRuntimeDependencies
  Configure-KimiApiKey -KimiApiKey $MecoKimiCodingApiKey
  Configure-MecoRuntimeSettings -KimiApiKey $MecoKimiCodingApiKey -OpenclawModelApiKey $effectiveModelKey
  Reset-RuntimeState
  Ensure-OpenclawGateway
  Start-Service
  Start-CloudflareTunnelRuntime

  Write-Log 'Install/upgrade done.'
}

Main
