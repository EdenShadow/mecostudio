#!/usr/bin/env bash
set -euo pipefail

MECO_REPO_URL="${MECO_REPO_URL:-https://github.com/EdenShadow/mecostudio.git}"
MECO_BRANCH="${MECO_BRANCH:-main}"
MECO_INSTALL_DIR="${MECO_INSTALL_DIR:-$HOME/meco-studio}"
MECO_START_AFTER_INSTALL="${MECO_START_AFTER_INSTALL:-1}"
MECO_RESET_RUNTIME_STATE="${MECO_RESET_RUNTIME_STATE:-1}"
MECO_RESET_RUNTIME_STATE_ON_UPDATE="${MECO_RESET_RUNTIME_STATE_ON_UPDATE:-0}"
MECO_UPGRADE_OPENCLAW="${MECO_UPGRADE_OPENCLAW:-0}"
MECO_NPM_INSTALL_MODE="${MECO_NPM_INSTALL_MODE:-auto}" # auto|ci|install
MECO_SKIP_NPM_INSTALL_IF_UNCHANGED="${MECO_SKIP_NPM_INSTALL_IF_UNCHANGED:-1}"
MECO_HEALTHCHECK_RETRIES="${MECO_HEALTHCHECK_RETRIES:-20}"
MECO_HEALTHCHECK_INTERVAL_SEC="${MECO_HEALTHCHECK_INTERVAL_SEC:-1}"
MECO_RUN_PERMISSION_PREFLIGHT="${MECO_RUN_PERMISSION_PREFLIGHT:-1}"
MECO_KIMI_CODING_API_KEY="${MECO_KIMI_CODING_API_KEY:-}"
MECO_OPENCLAW_MODEL="${MECO_OPENCLAW_MODEL:-kimi-coding/k2p5}"
MECO_OPENCLAW_MODEL_API_KEY="${MECO_OPENCLAW_MODEL_API_KEY:-}"
MECO_MINIMAX_API_KEY="${MECO_MINIMAX_API_KEY:-}"
MECO_MINIMAX_WS_URL="${MECO_MINIMAX_WS_URL:-wss://api.minimaxi.com/ws/v1/t2a_v2}"
MECO_DOUBAO_O2O_APP_ID="${MECO_DOUBAO_O2O_APP_ID:-}"
MECO_DOUBAO_O2O_TOKEN="${MECO_DOUBAO_O2O_TOKEN:-}"
MECO_DOUBAO_O2O_APP_KEY="${MECO_DOUBAO_O2O_APP_KEY:-}"
MECO_DOUBAO_O2O_RESOURCE_ID="${MECO_DOUBAO_O2O_RESOURCE_ID:-seed-icl-2.0}"
MECO_DOUBAO_O2O_ACCESS_KEY_ID="${MECO_DOUBAO_O2O_ACCESS_KEY_ID:-}"
MECO_DOUBAO_O2O_SECRET_ACCESS_KEY="${MECO_DOUBAO_O2O_SECRET_ACCESS_KEY:-}"
MECO_TIKHUB_API_KEY="${MECO_TIKHUB_API_KEY:-}"
MECO_MEOWLOAD_API_KEY="${MECO_MEOWLOAD_API_KEY:-}"
MECO_OPENAI_API_KEY="${MECO_OPENAI_API_KEY:-}"
MECO_OSS_ENDPOINT="${MECO_OSS_ENDPOINT:-https://oss-cn-hongkong.aliyuncs.com/}"
MECO_OSS_BUCKET="${MECO_OSS_BUCKET:-cfplusvideo}"
MECO_OSS_ACCESS_KEY_ID="${MECO_OSS_ACCESS_KEY_ID:-}"
MECO_OSS_ACCESS_KEY_SECRET="${MECO_OSS_ACCESS_KEY_SECRET:-}"
OPENCLAW_ROOT="${OPENCLAW_ROOT:-$HOME/.openclaw}"
CONFIG_SKILLS_ROOT="${CONFIG_SKILLS_ROOT:-$HOME/.config/agents/skills}"
HOT_TOPICS_ROOT="${HOT_TOPICS_ROOT:-$HOME/Documents/知识库/热门话题}"

# Remote control defaults (hardcoded deployment preset; can be overridden by env)
MECO_CLOUDFLARE_PUBLIC_HOST="${MECO_CLOUDFLARE_PUBLIC_HOST:-https://mecoclaw.com}"
MECO_CLOUDFLARE_PATH_PREFIX="${MECO_CLOUDFLARE_PATH_PREFIX:-}"
MECO_CLOUDFLARE_TUNNEL_TOKEN="${MECO_CLOUDFLARE_TUNNEL_TOKEN:-eyJhIjoiNzMyNGQ3ZjU3MGY5MzBlMjRjODRlYTY2ZmNkM2IwYjUiLCJ0IjoiYTk1OTZiMDgtNDZjOC00NmRlLWIzZGYtN2NjYjQ4OTJhM2NkIiwicyI6Ik5EWmlaREV4TjJFdFpXRXdNeTAwWlRNNExXSTJZakF0TWpFek5HRmlNVEl4WXpCaiJ9}"
MECO_RUSTDESK_WEB_BASE_URL="${MECO_RUSTDESK_WEB_BASE_URL:-/rustdesk-web/}"
MECO_RUSTDESK_PREFERRED_RENDEZVOUS="${MECO_RUSTDESK_PREFERRED_RENDEZVOUS:-}"
MECO_RUSTDESK_SELFHOST_BACKEND="${MECO_RUSTDESK_SELFHOST_BACKEND:-}"
MECO_AUTO_INSTALL_CLOUDFLARED="${MECO_AUTO_INSTALL_CLOUDFLARED:-1}"
MECO_AUTO_INSTALL_DOCKER="${MECO_AUTO_INSTALL_DOCKER:-1}"
MECO_COLIMA_CPU="${MECO_COLIMA_CPU:-2}"
MECO_COLIMA_MEMORY="${MECO_COLIMA_MEMORY:-4}"
MECO_COLIMA_DISK="${MECO_COLIMA_DISK:-20}"
MECO_AUTO_INSTALL_RUSTDESK_CLIENT="${MECO_AUTO_INSTALL_RUSTDESK_CLIENT:-1}"
MECO_AUTO_SETUP_RUSTDESK_SELFHOST="${MECO_AUTO_SETUP_RUSTDESK_SELFHOST:-0}"
MECO_AUTO_GRANT_RUSTDESK_PERMISSIONS="${MECO_AUTO_GRANT_RUSTDESK_PERMISSIONS:-1}"
MECO_AUTO_CONFIGURE_CLASH_RUSTDESK_DIRECT="${MECO_AUTO_CONFIGURE_CLASH_RUSTDESK_DIRECT:-1}"
MECO_AUTO_NORMALIZE_RUSTDESK_NETWORK="${MECO_AUTO_NORMALIZE_RUSTDESK_NETWORK:-1}"
MECO_AUTO_START_CLOUDFLARE_TUNNEL="${MECO_AUTO_START_CLOUDFLARE_TUNNEL:-1}"
MECO_SERVICE_PORT="${MECO_SERVICE_PORT:-3456}"
MECO_SERVICE_PORT_SCAN_MAX="${MECO_SERVICE_PORT_SCAN_MAX:-20}"
MECO_AUTO_INSTALL_MESHCENTRAL="${MECO_AUTO_INSTALL_MESHCENTRAL:-0}"
MECO_MESH_NODE_BIN="${MECO_MESH_NODE_BIN:-}"
MECO_MESHCENTRAL_CERT="${MECO_MESHCENTRAL_CERT:-mecoclaw.com}"
MECO_MESHCENTRAL_PORT="${MECO_MESHCENTRAL_PORT:-4470}"
MECO_MESHCENTRAL_ALIAS_PORT="${MECO_MESHCENTRAL_ALIAS_PORT:-443}"
MECO_MESHCENTRAL_MPS_PORT="${MECO_MESHCENTRAL_MPS_PORT:-44430}"
MECO_MESHCENTRAL_MPS_ALIAS_PORT="${MECO_MESHCENTRAL_MPS_ALIAS_PORT:-4433}"
MECO_MESHCENTRAL_ADMIN_USER="${MECO_MESHCENTRAL_ADMIN_USER:-eden_admin}"
MECO_MESHCENTRAL_ADMIN_PASS="${MECO_MESHCENTRAL_ADMIN_PASS:-EdenMesh@2026!}"
MECO_MESHCENTRAL_ADMIN_EMAIL="${MECO_MESHCENTRAL_ADMIN_EMAIL:-admin@mecoclaw.local}"
MECO_MESHCENTRAL_ADMIN_NAME="${MECO_MESHCENTRAL_ADMIN_NAME:-Eden Admin}"
MECO_MESHCENTRAL_LOGIN_TOKEN="${MECO_MESHCENTRAL_LOGIN_TOKEN:-}"
MECO_MESHCENTRAL_DOMAIN_PATH="${MECO_MESHCENTRAL_DOMAIN_PATH:-}"

HOT_TOPICS_CATEGORIES=(
  "AI_Tech"
  "Entertainment"
  "Military"
  "Sports"
  "Design"
  "Health"
  "Politics"
  "Technology"
  "Economy"
  "Medical"
  "Society"
  "Trending"
)

MECO_IS_UPDATE=0
MECO_MESHCENTRAL_LOGIN_TOKEN_RUNTIME=""

log() {
  printf '[meco-install] %s\n' "$*"
}

warn() {
  printf '[meco-install] WARN: %s\n' "$*" >&2
}

die() {
  printf '[meco-install] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

ensure_git() {
  if command -v git >/dev/null 2>&1; then
    return 0
  fi
  if command -v brew >/dev/null 2>&1; then
    log "git missing, installing with Homebrew..."
    brew install git >/dev/null
    command -v git >/dev/null 2>&1 || die "git install failed"
    return 0
  fi
  die "git is required. install git first"
}

hash_file() {
  local file_path="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file_path" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file_path" | awk '{print $1}'
  else
    die "missing hash command (shasum/sha256sum)"
  fi
}

kill_and_wait() {
  local pid="$1"
  local wait_sec="${2:-5}"
  [[ -n "$pid" ]] || return 0
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  kill "$pid" >/dev/null 2>&1 || true
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    if (( i >= wait_sec )); then
      warn "PID $pid still alive after ${wait_sec}s, force killing"
      kill -9 "$pid" >/dev/null 2>&1 || true
      break
    fi
    sleep 1
    i=$((i + 1))
  done
}

list_listen_pids_on_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -u || true
    return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null \
      | grep -E "[[:space:]]:${port}[[:space:]]" \
      | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' \
      | sort -u || true
    return 0
  fi
  return 0
}

extract_first_json() {
  node -e '
    const fs = require("fs");
    const text = fs.readFileSync(0, "utf8");
    for (let start = 0; start < text.length; start++) {
      const ch = text[start];
      if (ch !== "{" && ch !== "[") continue;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (c === "\\\\") {
            escaped = true;
          } else if (c === "\"") {
            inString = false;
          }
          continue;
        }
        if (c === "\"") {
          inString = true;
          continue;
        }
        if (c === "{" || c === "[") depth++;
        if (c === "}" || c === "]") {
          depth--;
          if (depth === 0) {
            const candidate = text.slice(start, i + 1);
            try {
              JSON.parse(candidate);
              process.stdout.write(candidate);
              process.exit(0);
            } catch (_) {
              break;
            }
          }
        }
      }
    }
    process.exit(1);
  '
}

ensure_node_and_npm() {
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      log "Node/npm missing, installing with Homebrew..."
      brew install node
    else
      die "node/npm is required. install Node.js >= 22.12 first"
    fi
  fi

  node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    const ok = major > 22 || (major === 22 && minor >= 12);
    process.exit(ok ? 0 : 1);
  ' || die "Node.js >= 22.12 is required"
}

ensure_python_and_pip() {
  if ! command -v python3 >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      log "python3 missing, installing with Homebrew..."
      brew install python >/dev/null
    else
      die "python3 is required. install Python 3 first"
    fi
  fi

  if ! python3 -m pip --version >/dev/null 2>&1; then
    log "pip missing, bootstrapping via ensurepip..."
    python3 -m ensurepip --upgrade >/dev/null 2>&1 || die "failed to bootstrap pip"
  fi
}

ensure_openclaw() {
  if command -v openclaw >/dev/null 2>&1; then
    if [[ "$MECO_UPGRADE_OPENCLAW" == "1" ]]; then
      log "Updating OpenClaw to latest..."
      npm install -g openclaw@latest >/dev/null
    else
      log "OpenClaw already installed, skip upgrade (set MECO_UPGRADE_OPENCLAW=1 to upgrade)"
    fi
  else
    log "OpenClaw not found, installing..."
    npm install -g openclaw@latest >/dev/null
  fi
  command -v openclaw >/dev/null 2>&1 || die "openclaw install failed"
}

ensure_kimi_cli() {
  if command -v kimi >/dev/null 2>&1; then
    log "Kimi CLI already installed"
    return 0
  fi
  log "Installing Kimi CLI: curl -L code.kimi.com/install.sh | bash"
  /bin/bash -lc "curl -L code.kimi.com/install.sh | bash"
  command -v kimi >/dev/null 2>&1 || warn "kimi install completed but command not found in current shell PATH"
}

ensure_kimi_whisper() {
  if command -v whisper >/dev/null 2>&1; then
    log "Whisper already installed"
    return 0
  fi

  log "Installing Whisper for Kimi/hot-topics (python package: openai-whisper)..."
  if python3 -m pip install --user --upgrade openai-whisper >/dev/null 2>&1; then
    log "Whisper package installed"
  else
    warn "failed to install openai-whisper (you can retry manually: python3 -m pip install --user --upgrade openai-whisper)"
  fi

  if ! command -v ffmpeg >/dev/null 2>&1; then
    warn "ffmpeg not found; local Whisper transcription may be limited. Install ffmpeg if needed."
  fi
}

get_mesh_node_bin() {
  if [[ -n "${MECO_MESH_NODE_BIN:-}" && -x "${MECO_MESH_NODE_BIN}" ]]; then
    printf '%s\n' "$MECO_MESH_NODE_BIN"
    return 0
  fi
  if [[ -x "$HOME/.nvm/versions/node/v20.19.5/bin/node" ]]; then
    printf '%s\n' "$HOME/.nvm/versions/node/v20.19.5/bin/node"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  die "node binary not found for meshcentral"
}

ensure_cloudflared() {
  if [[ "$MECO_AUTO_INSTALL_CLOUDFLARED" != "1" ]]; then
    log "Skip cloudflared install (MECO_AUTO_INSTALL_CLOUDFLARED=$MECO_AUTO_INSTALL_CLOUDFLARED)"
    return 0
  fi
  if command -v cloudflared >/dev/null 2>&1; then
    log "cloudflared already installed"
    return 0
  fi
  if command -v brew >/dev/null 2>&1; then
    log "Installing cloudflared via Homebrew..."
    brew install cloudflared >/dev/null || warn "brew install cloudflared failed"
  else
    warn "cloudflared not found and brew unavailable, please install cloudflared manually"
  fi
  command -v cloudflared >/dev/null 2>&1 || warn "cloudflared command still not found in PATH"
}

ensure_docker_runtime() {
  if [[ "$MECO_AUTO_INSTALL_DOCKER" != "1" ]]; then
    log "Skip Docker install (MECO_AUTO_INSTALL_DOCKER=$MECO_AUTO_INSTALL_DOCKER)"
    return 0
  fi

  if [[ "$(uname -s)" != "Darwin" ]]; then
    return 0
  fi

  if ! command -v docker >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      log "Installing Docker CLI + Colima via Homebrew..."
      brew install docker docker-compose colima >/dev/null || warn "brew install docker/docker-compose/colima failed"
    else
      warn "docker not found and brew unavailable, please install Docker/Colima manually"
    fi
  fi

  if command -v colima >/dev/null 2>&1 && command -v docker >/dev/null 2>&1; then
    if ! docker info >/dev/null 2>&1; then
      log "Starting Colima runtime..."
      if ! colima status >/dev/null 2>&1; then
        colima start --cpu "$MECO_COLIMA_CPU" --memory "$MECO_COLIMA_MEMORY" --disk "$MECO_COLIMA_DISK" >/dev/null 2>&1 || warn "colima start failed"
      fi
    fi
  fi

  if ! command -v docker >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      log "Fallback: installing Docker Desktop via Homebrew cask..."
      brew install --cask docker >/dev/null || warn "brew install --cask docker failed"
    fi
  fi

  if [[ -d "/Applications/Docker.app" ]] && ! docker info >/dev/null 2>&1; then
    open -ga "/Applications/Docker.app" >/dev/null 2>&1 || true
  fi

  if ! command -v docker >/dev/null 2>&1; then
    warn "docker command still not found in PATH"
    return 0
  fi

  local i=0
  while (( i < 45 )); do
    if docker info >/dev/null 2>&1; then
      log "Docker daemon ready"
      return 0
    fi
    sleep 2
    i=$((i + 1))
  done
  warn "docker daemon not ready yet; RustDesk docker self-host may fail this run"
}

run_repo_bash_script() {
  local rel_path="$1"
  shift || true
  local script_path="$MECO_INSTALL_DIR/$rel_path"
  if [[ ! -f "$script_path" ]]; then
    warn "helper script missing: $script_path"
    return 1
  fi
  if [[ -x "$script_path" ]]; then
    "$script_path" "$@"
  else
    bash "$script_path" "$@"
  fi
}

ensure_rustdesk_client() {
  if [[ "$MECO_AUTO_INSTALL_RUSTDESK_CLIENT" != "1" ]]; then
    log "Skip RustDesk client install (MECO_AUTO_INSTALL_RUSTDESK_CLIENT=$MECO_AUTO_INSTALL_RUSTDESK_CLIENT)"
    return 0
  fi

  case "$(uname -s)" in
    Darwin)
      log "Ensuring RustDesk client (macOS)..."
      if run_repo_bash_script "scripts/install-rustdesk-client-mac.sh"; then
        log "RustDesk client ready"
      else
        warn "RustDesk client install script failed (continuing)"
      fi
      ;;
    *)
      warn "RustDesk client auto-install is currently implemented for macOS in this shell script. Use PowerShell installer on Windows."
      ;;
  esac
}

setup_rustdesk_selfhost() {
  if [[ "$MECO_AUTO_SETUP_RUSTDESK_SELFHOST" != "1" ]]; then
    log "Skip RustDesk self-host setup (MECO_AUTO_SETUP_RUSTDESK_SELFHOST=$MECO_AUTO_SETUP_RUSTDESK_SELFHOST)"
    return 0
  fi

  local host hbbs_port ws_port backend
  host="${MECO_RUSTDESK_SELFHOST_HOST:-127.0.0.1}"
  hbbs_port="${MECO_RUSTDESK_SELFHOST_HBBS_PORT:-21116}"
  ws_port="${MECO_RUSTDESK_SELFHOST_WS_PORT:-21118}"
  backend="${MECO_RUSTDESK_SELFHOST_BACKEND:-}"
  if [[ -z "$backend" ]]; then
    if [[ "$(uname -s)" == "Darwin" ]]; then
      backend="docker"
    else
      backend="auto"
    fi
  fi

  if [[ "$backend" == "docker" || "$backend" == "auto" ]]; then
    ensure_docker_runtime
  fi

  log "Configuring RustDesk self-host (backend=$backend)..."
  if RUSTDESK_RENDEZVOUS_HOST="$host" \
     RUSTDESK_HBBS_PORT="$hbbs_port" \
     RUSTDESK_HBBR_PORT="${MECO_RUSTDESK_SELFHOST_HBBR_PORT:-21117}" \
     RUSTDESK_WS_PORT="$ws_port" \
     RUSTDESK_SELFHOST_BACKEND="$backend" \
     RUSTDESK_SERVER_HOME="${MECO_RUSTDESK_SERVER_HOME:-$HOME/.meco-studio/rustdesk-server}" \
     run_repo_bash_script "scripts/setup-rustdesk-selfhost.sh"; then
    log "RustDesk self-host ready"
  else
    warn "RustDesk self-host setup failed (continuing)"
  fi
}

grant_rustdesk_permissions() {
  if [[ "$MECO_AUTO_GRANT_RUSTDESK_PERMISSIONS" != "1" ]]; then
    log "Skip RustDesk permission guidance (MECO_AUTO_GRANT_RUSTDESK_PERMISSIONS=$MECO_AUTO_GRANT_RUSTDESK_PERMISSIONS)"
    return 0
  fi

  case "$(uname -s)" in
    Darwin)
      log "Opening RustDesk permission guidance (macOS)..."
      if run_repo_bash_script "scripts/grant-rustdesk-permissions-mac.sh"; then
        log "RustDesk permission guidance executed"
      else
        warn "RustDesk permission guidance failed (continuing)"
      fi
      ;;
    *)
      warn "RustDesk permission helper is currently implemented for macOS in this shell script. Use PowerShell installer on Windows."
      ;;
  esac
}

configure_clash_rustdesk_direct() {
  if [[ "$MECO_AUTO_CONFIGURE_CLASH_RUSTDESK_DIRECT" != "1" ]]; then
    log "Skip ClashX RustDesk DIRECT rule setup (MECO_AUTO_CONFIGURE_CLASH_RUSTDESK_DIRECT=$MECO_AUTO_CONFIGURE_CLASH_RUSTDESK_DIRECT)"
    return 0
  fi

  case "$(uname -s)" in
    Darwin)
      log "Configuring ClashX/ClashX Pro RustDesk DIRECT rules (if Clash is installed)..."
      if run_repo_bash_script "scripts/configure-clash-rustdesk-direct-mac.sh"; then
        log "ClashX RustDesk DIRECT rule setup completed"
      else
        warn "ClashX RustDesk DIRECT rule setup failed (continuing)"
      fi
      ;;
    *)
      log "Skip ClashX RustDesk DIRECT rule setup on non-macOS"
      ;;
  esac
}

normalize_rustdesk_network() {
  if [[ "$MECO_AUTO_NORMALIZE_RUSTDESK_NETWORK" != "1" ]]; then
    log "Skip RustDesk network normalization (MECO_AUTO_NORMALIZE_RUSTDESK_NETWORK=$MECO_AUTO_NORMALIZE_RUSTDESK_NETWORK)"
    return 0
  fi

  case "$(uname -s)" in
    Darwin)
      log "Normalizing RustDesk network config (LAN IP + stale virtual IP cleanup)..."
      if run_repo_bash_script "scripts/normalize-rustdesk-network-mac.sh"; then
        log "RustDesk network normalization completed"
      else
        warn "RustDesk network normalization failed (continuing)"
      fi
      ;;
    *)
      log "Skip RustDesk network normalization on non-macOS in shell installer (Windows handled by PowerShell installer)"
      ;;
  esac
}

start_cloudflare_tunnel_runtime() {
  if [[ "$MECO_AUTO_START_CLOUDFLARE_TUNNEL" != "1" ]]; then
    log "Skip cloudflare tunnel autostart (MECO_AUTO_START_CLOUDFLARE_TUNNEL=$MECO_AUTO_START_CLOUDFLARE_TUNNEL)"
    return 0
  fi

  if [[ -z "$MECO_CLOUDFLARE_TUNNEL_TOKEN" ]]; then
    warn "Cloudflare tunnel token empty, skip cloudflare tunnel autostart"
    return 0
  fi

  ensure_cloudflared

  if ! command -v cloudflared >/dev/null 2>&1; then
    warn "cloudflared missing, skip cloudflare tunnel autostart"
    return 0
  fi

  log "Starting Cloudflare tunnel runtime..."
  if MECO_CLOUDFLARE_TUNNEL_TOKEN="$MECO_CLOUDFLARE_TUNNEL_TOKEN" \
     run_repo_bash_script "scripts/start-cloudflare-tunnel.sh"; then
    log "Cloudflare tunnel runtime started"
  else
    warn "Cloudflare tunnel runtime start failed (continuing)"
  fi
}

patch_meshcentral_installmodules_compat() {
  local file_path="$1"
  [[ -f "$file_path" ]] || return 0
  if grep -q "require.resolve(moduleName)" "$file_path"; then
    return 0
  fi

  local patch_status=0
  node - "$file_path" <<'NODE' || patch_status=$?
const fs = require("fs");
const p = process.argv[2];
let text = fs.readFileSync(p, "utf8");
if (text.includes("require.resolve(moduleName)")) process.exit(0);

const needle = "modulePath = ex.stack.split(' ').pop().slice(1,-3)";
if (!text.includes(needle)) process.exit(3);

const replacement = [
  "const msg = '' + ex;",
  "                            const m = msg.match(/in\\s+([^\\s]+package\\.json)/i);",
  "                            if (m && m[1]) {",
  "                                modulePath = m[1].replace(/^['\\\"]+|['\\\".,]+$/g, '');",
  "                            }",
  "                            if (modulePath == null) {",
  "                                try {",
  "                                    var resolvedModulePath = require.resolve(moduleName);",
  "                                    var probe = require('path').dirname(resolvedModulePath);",
  "                                    for (var pcount = 0; pcount < 6; pcount++) {",
  "                                        var pp = require('path').join(probe, 'package.json');",
  "                                        if (require('fs').existsSync(pp)) {",
  "                                            try {",
  "                                                var pj = JSON.parse(require('fs').readFileSync(pp, 'utf8'));",
  "                                                if (pj && (pj.name == moduleName)) { modulePath = pp; break; }",
  "                                            } catch (ex2) { }",
  "                                        }",
  "                                        var up = require('path').dirname(probe);",
  "                                        if (up == probe) break;",
  "                                        probe = up;",
  "                                    }",
  "                                } catch (ex3) { }",
  "                            }"
].join("\n");

text = text.replace(needle, replacement);
fs.writeFileSync(p, text, "utf8");
NODE

  if [[ "$patch_status" -eq 0 ]]; then
    log "Patched meshcentral module-compat guard: $file_path"
  elif [[ "$patch_status" -eq 3 ]]; then
    warn "meshcentral compat patch skipped (pattern not found): $file_path"
  else
    warn "meshcentral compat patch failed: $file_path (code=$patch_status)"
  fi
}

write_meshcentral_config() {
  local config_path="$1"
  node - "$config_path" \
    "$MECO_MESHCENTRAL_CERT" \
    "$MECO_MESHCENTRAL_PORT" \
    "$MECO_MESHCENTRAL_ALIAS_PORT" \
    "$MECO_MESHCENTRAL_MPS_PORT" \
    "$MECO_MESHCENTRAL_MPS_ALIAS_PORT" <<'NODE'
const fs = require("fs");
const crypto = require("crypto");

const configPath = process.argv[2];
const cert = String(process.argv[3] || "mecoclaw.com").trim();
const port = Number(process.argv[4] || 4470) || 4470;
const aliasPort = Number(process.argv[5] || 443) || 443;
const mpsPort = Number(process.argv[6] || 44430) || 44430;
const mpsAliasPort = Number(process.argv[7] || 4433) || 4433;

let current = {};
if (fs.existsSync(configPath)) {
  try {
    current = JSON.parse(fs.readFileSync(configPath, "utf8") || "{}");
  } catch (_) {
    current = {};
  }
}

if (!current.settings || typeof current.settings !== "object") current.settings = {};
if (!current.domains || typeof current.domains !== "object") current.domains = {};
if (!current.domains[""] || typeof current.domains[""] !== "object") current.domains[""] = {};

const randHex = (bytes) => crypto.randomBytes(bytes).toString("hex");
const settings = current.settings;
settings.cert = cert || "mecoclaw.com";
settings.WANonly = true;
settings.port = port;
settings.portBind = "127.0.0.1";
settings.aliasPort = aliasPort;
settings.redirPort = 0;
settings.redirAliasPort = 80;
settings.tlsOffload = "127.0.0.1,::1";
settings.trustedProxy = "127.0.0.1,::1";
settings.allowFraming = true;
settings.sessionKey = String(settings.sessionKey || randHex(24));
settings.dbEncryptKey = String(settings.dbEncryptKey || randHex(24));
settings.mpsPort = mpsPort;
settings.mpsPortBind = "127.0.0.1";
settings.mpsAliasPort = mpsAliasPort;

const d = current.domains[""];
d.title = d.title || "Meco Mesh";
d.title2 = d.title2 || "MeshCentral";
d.newAccounts = true;
d.minify = true;
const certHost = String(cert || "")
  .replace(/^https?:\/\//i, "")
  .split("/")[0]
  .split(":")[0]
  .trim()
  .toLowerCase();
const allowedOrigins = Array.from(
  new Set([certHost, "127.0.0.1", "localhost"].filter(Boolean))
);
d.allowedorigin = allowedOrigins.join(",");

fs.mkdirSync(require("path").dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(current, null, 2) + "\n", "utf8");
NODE
}

bootstrap_meshcentral_admin_and_token() {
  local mc_dir="$1"
  local node_bin="$2"
  local create_output admin_output token_output token
  local user_id="user//${MECO_MESHCENTRAL_ADMIN_USER}"

  create_output="$(
    cd "$mc_dir" && \
    "$node_bin" node_modules/meshcentral --configfile config.json \
      --createaccount "$MECO_MESHCENTRAL_ADMIN_USER" \
      --pass "$MECO_MESHCENTRAL_ADMIN_PASS" \
      --email "$MECO_MESHCENTRAL_ADMIN_EMAIL" \
      --name "$MECO_MESHCENTRAL_ADMIN_NAME" 2>&1 || true
  )"
  if printf '%s\n' "$create_output" | grep -Eqi "Done\\.|User already exists\\."; then
    log "MeshCentral admin account ready: ${MECO_MESHCENTRAL_ADMIN_USER}"
  else
    warn "MeshCentral createaccount output: $(printf '%s' "$create_output" | tail -n 1)"
  fi

  admin_output="$(
    cd "$mc_dir" && \
    "$node_bin" node_modules/meshcentral --configfile config.json \
      --adminaccount "$MECO_MESHCENTRAL_ADMIN_USER" 2>&1 || true
  )"
  if printf '%s\n' "$admin_output" | grep -Eqi "Done\\."; then
    log "MeshCentral admin privilege ensured: ${MECO_MESHCENTRAL_ADMIN_USER}"
  else
    warn "MeshCentral adminaccount output: $(printf '%s' "$admin_output" | tail -n 1)"
  fi

  token_output="$(
    cd "$mc_dir" && \
    "$node_bin" node_modules/meshcentral --configfile config.json \
      --logintoken "$user_id" 2>&1 || true
  )"
  token="$(printf '%s\n' "$token_output" | awk 'NF { line=$0 } END { print line }' | tr -d '\r\n')"
  if [[ "$token" =~ ^[A-Za-z0-9._~=-]{32,}$ ]]; then
    MECO_MESHCENTRAL_LOGIN_TOKEN_RUNTIME="$token"
    log "MeshCentral login token generated for ${MECO_MESHCENTRAL_ADMIN_USER}"
  else
    warn "MeshCentral logintoken generation did not return a valid token"
  fi

  if [[ -n "${MECO_MESHCENTRAL_LOGIN_TOKEN_RUNTIME:-}" ]]; then
    local secret_file="$HOME/.meco-studio/meshcentral-bootstrap.json"
    mkdir -p "$(dirname "$secret_file")"
    node -e '
      const fs = require("fs");
      const path = process.argv[1];
      const payload = {
        updatedAt: new Date().toISOString(),
        meshcentralAdminUser: String(process.argv[2] || ""),
        meshcentralAdminPass: String(process.argv[3] || ""),
        meshcentralLoginToken: String(process.argv[4] || "")
      };
      fs.writeFileSync(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
    ' "$secret_file" \
      "$MECO_MESHCENTRAL_ADMIN_USER" \
      "$MECO_MESHCENTRAL_ADMIN_PASS" \
      "$MECO_MESHCENTRAL_LOGIN_TOKEN_RUNTIME"
    log "Stored Mesh bootstrap secret locally: $secret_file"
  fi
}

ensure_meshcentral_runtime() {
  log "MeshCentral support removed; skip meshcentral runtime install."
  return 0
  if [[ "$MECO_AUTO_INSTALL_MESHCENTRAL" != "1" ]]; then
    log "Skip meshcentral install (MECO_AUTO_INSTALL_MESHCENTRAL=$MECO_AUTO_INSTALL_MESHCENTRAL)"
    return 0
  fi

  local mc_dir="$MECO_INSTALL_DIR/meshcentral"
  local node_bin
  node_bin="$(get_mesh_node_bin)"

  mkdir -p "$mc_dir"
  if [[ ! -f "$mc_dir/package.json" ]]; then
    (cd "$mc_dir" && npm init -y >/dev/null 2>&1)
  fi

  log "Installing meshcentral runtime dependencies..."
  (
    cd "$mc_dir" && \
    npm install --no-fund --no-audit --omit=optional meshcentral ua-client-hints-js@0.1.2 >/dev/null 2>&1
  ) || warn "meshcentral npm install reported errors"

  if [[ -d "$mc_dir/node_modules/meshcentral" ]]; then
    (
      cd "$mc_dir/node_modules/meshcentral" && \
      npm install --no-fund --no-audit --omit=optional ua-client-hints-js@0.1.2 >/dev/null 2>&1
    ) || true
    patch_meshcentral_installmodules_compat "$mc_dir/node_modules/meshcentral/meshcentral.js"
  fi

  write_meshcentral_config "$mc_dir/meshcentral-data/config.json"

  if [[ -x "$MECO_INSTALL_DIR/scripts/meshcentral-stop.sh" ]]; then
    "$MECO_INSTALL_DIR/scripts/meshcentral-stop.sh" >/dev/null 2>&1 || true
  fi

  bootstrap_meshcentral_admin_and_token "$mc_dir" "$node_bin"

  if [[ -x "$MECO_INSTALL_DIR/scripts/meshcentral-start.sh" ]]; then
    if "$MECO_INSTALL_DIR/scripts/meshcentral-start.sh" >/dev/null 2>&1; then
      log "MeshCentral started"
    else
      warn "MeshCentral start failed, check $mc_dir/meshcentral.log"
    fi
  else
    warn "meshcentral-start.sh missing, skip auto start"
  fi
}

pip_install_user_packages() {
  local label="$1"
  shift
  [[ $# -gt 0 ]] || return 0
  log "Installing Python deps ($label): $*"
  if python3 -m pip install --user --upgrade "$@" >/dev/null 2>&1; then
    log "Python deps installed ($label)"
  else
    warn "Python deps install failed ($label): $*"
  fi
}

install_python_requirements_in_tree() {
  local root="$1"
  local label="$2"
  [[ -d "$root" ]] || return 0

  local req
  while IFS= read -r req; do
    [[ -n "$req" ]] || continue
    log "Installing Python requirements ($label): $req"
    if python3 -m pip install --user --upgrade -r "$req" >/dev/null 2>&1; then
      log "Installed requirements: $req"
    else
      warn "Failed requirements install: $req"
    fi
  done < <(find "$root" -type f \( -name 'requirements.txt' -o -name 'requirements-*.txt' \) | sort)
}

install_node_skill_dependencies() {
  local root="$1"
  local label="$2"
  [[ -d "$root" ]] || return 0

  local pkg_file
  while IFS= read -r pkg_file; do
    [[ -n "$pkg_file" ]] || continue
    local skill_dir
    skill_dir="$(dirname "$pkg_file")"
    local skill_name
    skill_name="$(basename "$skill_dir")"

    if [[ -f "$skill_dir/package-lock.json" ]]; then
      log "Installing Node deps ($label/$skill_name): npm ci"
      (cd "$skill_dir" && npm ci --no-fund --no-audit >/dev/null 2>&1) || warn "npm ci failed for $skill_name"
    else
      log "Installing Node deps ($label/$skill_name): npm install"
      (cd "$skill_dir" && npm install --no-fund --no-audit >/dev/null 2>&1) || warn "npm install failed for $skill_name"
    fi
  done < <(find "$root" -mindepth 2 -maxdepth 2 -type f -name 'package.json' | sort)
}

install_skill_runtime_dependencies() {
  # Shared Python deps used by hot-topics + config skills.
  pip_install_user_packages "shared-skills" requests aiohttp aiofiles pillow openai

  # Ensure Whisper for hot-topics audio analysis.
  ensure_kimi_whisper

  # Auto-install Python requirements if any skill provides requirement files.
  install_python_requirements_in_tree "$OPENCLAW_ROOT/skills" "openclaw-skills"
  install_python_requirements_in_tree "$CONFIG_SKILLS_ROOT" "config-skills"

  # Install Node dependencies for OpenClaw/config skills that ship package.json.
  install_node_skill_dependencies "$OPENCLAW_ROOT/skills" "openclaw-skills"
  install_node_skill_dependencies "$CONFIG_SKILLS_ROOT" "config-skills"
}

configure_kimi_api_key() {
  local kimi_api_key="$1"
  [[ -n "$kimi_api_key" ]] || return 0

  local kimi_home="$HOME/.kimi"
  mkdir -p "$kimi_home"
  cat > "$kimi_home/config.json" <<JSON
{
  "api_key": "$kimi_api_key",
  "base_url": "https://api.moonshot.cn/v1"
}
JSON
  log "Updated $kimi_home/config.json"
}

configure_openclaw_kimi_auth() {
  local openclaw_model_api_key="$1"
  [[ -n "$openclaw_model_api_key" ]] || {
    warn "MECO_OPENCLAW_MODEL_API_KEY (or fallback MECO_KIMI_CODING_API_KEY) is empty, skip OpenClaw kimi-code auth bootstrap"
    return 0
  }

  local workspace_dir="$OPENCLAW_ROOT/workspace"
  mkdir -p "$workspace_dir"

  if openclaw onboard \
    --non-interactive \
    --accept-risk \
    --mode local \
    --auth-choice kimi-code-api-key \
    --kimi-code-api-key "$openclaw_model_api_key" \
    --skip-daemon \
    --skip-skills \
    --skip-search \
    --skip-ui \
    --skip-channels \
    --workspace "$workspace_dir" >/dev/null 2>&1; then
    log "Configured OpenClaw auth via kimi-code-api-key (avoid Moonshot auth mismatch)"
  else
    warn "openclaw onboard (kimi-code-api-key) failed, continue with direct config patch"
  fi
}

configure_openclaw_defaults() {
  local model="$1"
  local provider_key="$2"
  local openclaw_config="$OPENCLAW_ROOT/openclaw.json"
  mkdir -p "$OPENCLAW_ROOT"

  node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const model = String(process.argv[2] || "").trim() || "kimi-coding/k2p5";
    const providerKey = String(process.argv[3] || "").trim();

    let conf = {};
    if (fs.existsSync(path)) {
      try {
        conf = JSON.parse(fs.readFileSync(path, "utf8") || "{}");
      } catch (_) {
        conf = {};
      }
    }

    if (!conf.gateway || typeof conf.gateway !== "object") conf.gateway = {};
    if (!conf.gateway.port) conf.gateway.port = 18789;
    if (!conf.gateway.mode) conf.gateway.mode = "local";
    if (!conf.gateway.bind) conf.gateway.bind = "loopback";
    if (!conf.gateway.auth || typeof conf.gateway.auth !== "object") conf.gateway.auth = {};
    if (!conf.gateway.controlUi || typeof conf.gateway.controlUi !== "object") conf.gateway.controlUi = {};
    if (!Array.isArray(conf.gateway.controlUi.allowedOrigins) || conf.gateway.controlUi.allowedOrigins.length === 0) {
      conf.gateway.controlUi.allowedOrigins = ["*"];
    }
    if (!conf.gateway.http || typeof conf.gateway.http !== "object") conf.gateway.http = {};
    if (!conf.gateway.http.endpoints || typeof conf.gateway.http.endpoints !== "object") conf.gateway.http.endpoints = {};
    if (!conf.gateway.http.endpoints.chatCompletions || typeof conf.gateway.http.endpoints.chatCompletions !== "object" || Array.isArray(conf.gateway.http.endpoints.chatCompletions)) {
      conf.gateway.http.endpoints.chatCompletions = {};
    }
    conf.gateway.http.endpoints.chatCompletions.enabled = true;
    if (Object.prototype.hasOwnProperty.call(conf.gateway.http.endpoints.chatCompletions, "images")) {
      delete conf.gateway.http.endpoints.chatCompletions.images;
    }

    if (!conf.agents || typeof conf.agents !== "object") conf.agents = {};
    if (!conf.agents.defaults || typeof conf.agents.defaults !== "object") conf.agents.defaults = {};
    if (!conf.agents.defaults.model || typeof conf.agents.defaults.model !== "object") conf.agents.defaults.model = {};
    conf.agents.defaults.model.primary = model;

    const providerId = model.includes("/") ? model.split("/")[0] : "";
    if (!conf.models || typeof conf.models !== "object") conf.models = {};
    if (!conf.models.providers || typeof conf.models.providers !== "object") conf.models.providers = {};
    if (!conf.models.providers["kimi-coding"] || typeof conf.models.providers["kimi-coding"] !== "object") {
      conf.models.providers["kimi-coding"] = {};
    }
    conf.models.providers["kimi-coding"].baseUrl = "https://api.kimi.com/coding/";
    conf.models.providers["kimi-coding"].api = "anthropic-messages";
    conf.models.providers["kimi-coding"].models = [{ id: "k2p5", name: "Kimi K2.5" }];

    if (providerId && providerKey) {
      if (!conf.models.providers[providerId] || typeof conf.models.providers[providerId] !== "object") {
        conf.models.providers[providerId] = {};
      }
      conf.models.providers[providerId].apiKey = providerKey;
    }

    if (providerKey) conf.models.providers["kimi-coding"].apiKey = providerKey;

    if (conf.agents && Array.isArray(conf.agents.list)) {
      conf.agents.list = conf.agents.list.map((agent) => {
        if (!agent || typeof agent !== "object") return agent;
        return { ...agent, model };
      });
    }

    fs.writeFileSync(path, JSON.stringify(conf, null, 2) + "\n");
  ' "$openclaw_config" "$model" "$provider_key"

  log "Configured OpenClaw defaults: model=$model"
}

configure_meco_runtime_settings() {
  local kimi_api_key="$1"
  local openclaw_model_api_key="$2"
  local settings_path="${MECO_SETTINGS_PATH:-$HOME/.meco-studio/app-settings.json}"
  mkdir -p "$(dirname "$settings_path")"

  node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const patch = {
      openclawModel: String(process.argv[2] || "").trim(),
      openclawModelApiKey: String(process.argv[3] || "").trim(),
      minimaxApiKey: String(process.argv[4] || "").trim(),
      minimaxWsUrl: String(process.argv[5] || "").trim(),
      doubaoO2oAppId: String(process.argv[6] || "").trim(),
      doubaoO2oToken: String(process.argv[7] || "").trim(),
      doubaoO2oAppKey: String(process.argv[8] || "").trim(),
      doubaoO2oResourceId: String(process.argv[9] || "").trim(),
      doubaoO2oAccessKeyId: String(process.argv[10] || "").trim(),
      doubaoO2oSecretAccessKey: String(process.argv[11] || "").trim(),
      tikhubApiKey: String(process.argv[12] || "").trim(),
      meowloadApiKey: String(process.argv[13] || "").trim(),
      kimiApiKey: String(process.argv[14] || "").trim(),
      hotTopicsKbPath: String(process.argv[15] || "").trim(),
      openaiApiKey: String(process.argv[16] || "").trim(),
      ossEndpoint: String(process.argv[17] || "").trim(),
      ossBucket: String(process.argv[18] || "").trim(),
      ossAccessKeyId: String(process.argv[19] || "").trim(),
      ossAccessKeySecret: String(process.argv[20] || "").trim(),
      cloudflarePublicHost: String(process.argv[21] || "").trim(),
      cloudflarePathPrefix: String(process.argv[22] || "").trim(),
      cloudflareTunnelToken: String(process.argv[23] || "").trim(),
      rustdeskWebBaseUrl: String(process.argv[24] || "").trim(),
      rustdeskSchemeAuthority: String(process.argv[25] || "").trim() || "connect",
      rustdeskPreferredRendezvous: String(process.argv[26] || "").trim()
    };

    let current = {};
    if (fs.existsSync(path)) {
      try {
        current = JSON.parse(fs.readFileSync(path, "utf8") || "{}");
      } catch (_) {
        current = {};
      }
    }

    const next = { ...current };
    for (const [k, v] of Object.entries(patch)) {
      if (v) next[k] = v;
      else if (!Object.prototype.hasOwnProperty.call(next, k)) next[k] = "";
    }
    // Installer defaults should be authoritative for rendezvous preference.
    next.rustdeskPreferredRendezvous = patch.rustdeskPreferredRendezvous;
    fs.writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  ' "$settings_path" \
    "$MECO_OPENCLAW_MODEL" \
    "$openclaw_model_api_key" \
    "$MECO_MINIMAX_API_KEY" \
    "$MECO_MINIMAX_WS_URL" \
    "$MECO_DOUBAO_O2O_APP_ID" \
    "$MECO_DOUBAO_O2O_TOKEN" \
    "$MECO_DOUBAO_O2O_APP_KEY" \
    "$MECO_DOUBAO_O2O_RESOURCE_ID" \
    "$MECO_DOUBAO_O2O_ACCESS_KEY_ID" \
    "$MECO_DOUBAO_O2O_SECRET_ACCESS_KEY" \
    "$MECO_TIKHUB_API_KEY" \
    "$MECO_MEOWLOAD_API_KEY" \
    "$kimi_api_key" \
    "$HOT_TOPICS_ROOT" \
    "$MECO_OPENAI_API_KEY" \
    "$MECO_OSS_ENDPOINT" \
    "$MECO_OSS_BUCKET" \
    "$MECO_OSS_ACCESS_KEY_ID" \
    "$MECO_OSS_ACCESS_KEY_SECRET" \
    "$MECO_CLOUDFLARE_PUBLIC_HOST" \
    "$MECO_CLOUDFLARE_PATH_PREFIX" \
    "$MECO_CLOUDFLARE_TUNNEL_TOKEN" \
    "$MECO_RUSTDESK_WEB_BASE_URL" \
    "connect" \
    "$MECO_RUSTDESK_PREFERRED_RENDEZVOUS"

  log "Updated Meco runtime settings: $settings_path"
}

ensure_hot_topics_skill() {
  local hot_topics_target="$CONFIG_SKILLS_ROOT/hot-topics"
  local src1="$MECO_INSTALL_DIR/bootstrap/openclaw/skills/config/hot-topics"
  local src2="$MECO_INSTALL_DIR/bootstrap/openclaw/skills/openclaw/hot-topics"
  local src3="$OPENCLAW_ROOT/skills/hot-topics"
  local src=""

  if [[ -d "$src1" ]]; then
    src="$src1"
  elif [[ -d "$src2" ]]; then
    src="$src2"
  elif [[ -d "$src3" ]]; then
    src="$src3"
  fi

  if [[ -z "$src" ]]; then
    warn "hot-topics skill source not found, skipped"
    return 0
  fi

  mkdir -p "$CONFIG_SKILLS_ROOT"
  sync_skill_dir "$src" "$hot_topics_target"
  log "Installed hot-topics skill to $hot_topics_target"
}

ensure_tikhub_skills() {
  local config_target="$CONFIG_SKILLS_ROOT/tikhub-tiktok"
  local config_src1="$MECO_INSTALL_DIR/bootstrap/openclaw/skills/config/tikhub-tiktok"
  local config_src2="$MECO_INSTALL_DIR/bootstrap/openclaw/skills/openclaw/tikhub-api"
  local config_src3="$OPENCLAW_ROOT/skills/tikhub-api"
  local config_src=""

  if [[ -d "$config_src1" ]]; then
    config_src="$config_src1"
  elif [[ -d "$config_src2" ]]; then
    config_src="$config_src2"
  elif [[ -d "$config_src3" ]]; then
    config_src="$config_src3"
  fi

  if [[ -n "$config_src" ]]; then
    mkdir -p "$CONFIG_SKILLS_ROOT"
    sync_skill_dir "$config_src" "$config_target"
    log "Installed tikhub-tiktok skill to $config_target"
  else
    warn "tikhub-tiktok skill source not found, skipped"
  fi

  local openclaw_target="$OPENCLAW_ROOT/skills/tikhub-api"
  local openclaw_src1="$MECO_INSTALL_DIR/bootstrap/openclaw/skills/openclaw/tikhub-api"
  local openclaw_src2="$config_target"
  local openclaw_src=""

  if [[ -d "$openclaw_src1" ]]; then
    openclaw_src="$openclaw_src1"
  elif [[ -d "$openclaw_src2" ]]; then
    openclaw_src="$openclaw_src2"
  fi

  if [[ -n "$openclaw_src" ]]; then
    mkdir -p "$OPENCLAW_ROOT/skills"
    sync_skill_dir "$openclaw_src" "$openclaw_target"
    log "Installed tikhub-api skill to $openclaw_target"
  else
    warn "tikhub-api skill source not found, skipped"
  fi

  ensure_tikhub_alias_skill
}

ensure_tikhub_alias_skill() {
  local alias_dir="$CONFIG_SKILLS_ROOT/tikhubapi"
  mkdir -p "$alias_dir"
  cat > "$alias_dir/SKILL.md" <<'MD'
---
name: tikhubapi
description: Alias of tikhub-tiktok. Use this skill name when users ask for "tikhubapi" and route to the same TikHub social APIs.
---

# TikHub API Alias

`tikhubapi` is a compatibility alias for `tikhub-tiktok`.

Use:

```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py video_by_url "<share_url>"
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py tweet "<tweet_id_or_url>"
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py video_info "<video_id>"
```
MD
  log "Ensured alias config skill: $alias_dir"
}

configure_skill_runtime_env() {
  local runtime_env="$HOME/.meco-studio/skill-runtime.env"
  mkdir -p "$(dirname "$runtime_env")"
  {
    printf 'TIKHUB_API_KEY=%s\n' "$MECO_TIKHUB_API_KEY"
    printf 'HOT_TOPICS_KB_PATH=%s\n' "$HOT_TOPICS_ROOT"
    printf 'OPENAI_API_KEY=%s\n' "$MECO_OPENAI_API_KEY"
    printf 'KIMI_COMMAND=%s\n' "kimi"
  } > "$runtime_env"
  chmod 600 "$runtime_env" >/dev/null 2>&1 || true
  log "Updated skill runtime env: $runtime_env"
}

collect_hot_topics_categories() {
  printf '%s\n' "${HOT_TOPICS_CATEGORIES[@]}"
}

ensure_hot_topics_knowledge_base() {
  local hot_topics_root="$HOT_TOPICS_ROOT"
  local kb_root
  kb_root="$(dirname "$hot_topics_root")"

  mkdir -p "$kb_root"
  if [[ -d "$hot_topics_root" ]]; then
    log "Knowledge base root already exists, keep existing data: $hot_topics_root"
  else
    mkdir -p "$hot_topics_root"
    log "Created knowledge base root: $hot_topics_root"
  fi

  local category_dir category
  local total_count=0
  local created_count=0
  while IFS= read -r category; do
    [[ -n "$category" ]] || continue
    total_count=$((total_count + 1))
    category_dir="$hot_topics_root/$category"
    if [[ -d "$category_dir" ]]; then
      continue
    fi
    mkdir -p "$category_dir"
    created_count=$((created_count + 1))
    log "Created category folder: $category_dir"
  done < <(collect_hot_topics_categories)

  log "Ensured hot-topics categories under $hot_topics_root (total=$total_count, created=$created_count)"
}

prepare_repo() {
  if [[ -d "$MECO_INSTALL_DIR/.git" ]]; then
    MECO_IS_UPDATE=1
    log "Meco Studio exists, pulling latest..."
    git -C "$MECO_INSTALL_DIR" fetch origin "$MECO_BRANCH"
    git -C "$MECO_INSTALL_DIR" checkout "$MECO_BRANCH"
    git -C "$MECO_INSTALL_DIR" pull --ff-only origin "$MECO_BRANCH"
  else
    log "Cloning Meco Studio into $MECO_INSTALL_DIR ..."
    git clone --branch "$MECO_BRANCH" "$MECO_REPO_URL" "$MECO_INSTALL_DIR"
  fi
}

run_permissions_preflight() {
  if [[ "$MECO_RUN_PERMISSION_PREFLIGHT" != "1" ]]; then
    log "Skip permission preflight (MECO_RUN_PERMISSION_PREFLIGHT=$MECO_RUN_PERMISSION_PREFLIGHT)"
    return 0
  fi

  local checker="$MECO_INSTALL_DIR/scripts/openclaw-permission-preflight.sh"
  if [[ ! -x "$checker" ]]; then
    warn "permission preflight checker missing: $checker"
    return 0
  fi

  log "Running permission preflight..."
  if OPENCLAW_ROOT="$OPENCLAW_ROOT" \
     MECO_INSTALL_DIR="$MECO_INSTALL_DIR" \
     "$checker"; then
    log "Permission preflight completed"
  else
    warn "permission preflight reported issues (continue install)"
  fi
}

restart_openclaw_if_update() {
  if ! command -v openclaw >/dev/null 2>&1; then
    warn "OpenClaw command not found, skip gateway startup check"
    return 0
  fi

  local gateway_port
  gateway_port="$(node -e '
    const fs = require("fs");
    const p = process.argv[1];
    let port = 18789;
    try {
      if (fs.existsSync(p)) {
        const conf = JSON.parse(fs.readFileSync(p, "utf8") || "{}");
        const configured = Number((((conf || {}).gateway || {}).port) || 0);
        if (configured > 0) port = configured;
      }
    } catch (_) {}
    process.stdout.write(String(port));
  ' "$OPENCLAW_ROOT/openclaw.json" 2>/dev/null || printf '18789')"
  [[ -n "$gateway_port" ]] || gateway_port="18789"

  if [[ "$MECO_IS_UPDATE" == "1" ]]; then
    log "Update mode detected: restarting OpenClaw gateway..."
  else
    log "Ensuring OpenClaw gateway is running..."
  fi

  if openclaw gateway restart >/dev/null 2>&1; then
    log "OpenClaw gateway restarted"
  elif openclaw gateway start >/dev/null 2>&1; then
    log "OpenClaw gateway started"
  else
    warn "OpenClaw gateway restart/start failed, trying background run fallback..."
    local runtime_dir pid_file log_file old_pid
    runtime_dir="$HOME/.meco-studio/openclaw"
    pid_file="$runtime_dir/gateway.pid"
    log_file="$runtime_dir/gateway.log"
    mkdir -p "$runtime_dir"

    old_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
      log "OpenClaw gateway fallback already running (pid=$old_pid)"
    else
      nohup openclaw gateway run --allow-unconfigured --bind loopback --port "$gateway_port" >> "$log_file" 2>&1 &
      local fallback_pid=$!
      printf '%s\n' "$fallback_pid" > "$pid_file"
      sleep 1
      if kill -0 "$fallback_pid" 2>/dev/null; then
        log "OpenClaw gateway fallback started (pid=$fallback_pid)"
      else
        warn "OpenClaw gateway fallback run failed (continuing)"
        return 0
      fi
    fi
  fi

  if command -v curl >/dev/null 2>&1; then
    local probe_url
    probe_url="http://127.0.0.1:${gateway_port}/v1/chat/completions"
    local i=1
    local status_code=""
    while (( i <= MECO_HEALTHCHECK_RETRIES )); do
      status_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' --data '{}' "$probe_url" || true)"
      if [[ "$status_code" != "000" && "$status_code" != "404" ]]; then
        log "OpenClaw gateway endpoint ready: $probe_url (status=$status_code)"
        return 0
      fi
      sleep "$MECO_HEALTHCHECK_INTERVAL_SEC"
      i=$((i + 1))
    done
    warn "OpenClaw gateway endpoint /v1/chat/completions not ready (url=$probe_url, last_status=${status_code:-unknown})"
  fi
}

sync_local_version_marker() {
  local repo_version_file="$MECO_INSTALL_DIR/VERSION"
  local local_version_dir="$HOME/.meco-studio"
  local local_version_file="$local_version_dir/VERSION"
  local version="0.0.1"

  if [[ -f "$repo_version_file" ]]; then
    version="$(tr -d '[:space:]' < "$repo_version_file" 2>/dev/null || true)"
  fi
  [[ -n "$version" ]] || version="0.0.1"

  if ! mkdir -p "$local_version_dir" 2>/dev/null; then
    warn "cannot create $local_version_dir, skip local version marker sync"
    return 0
  fi
  if printf '%s\n' "$version" > "$local_version_file" 2>/dev/null; then
    log "Synced local version marker: $local_version_file (version=$version)"
  else
    warn "cannot write $local_version_file, skip local version marker sync"
  fi
}

install_dependencies() {
  local lockfile="$MECO_INSTALL_DIR/package-lock.json"
  local hash_file_path="$MECO_INSTALL_DIR/.meco-install.npm-lock.sha256"
  local lock_hash=""
  local old_hash=""

  if [[ -f "$lockfile" ]]; then
    lock_hash="$(hash_file "$lockfile")"
    if [[ -f "$hash_file_path" ]]; then
      old_hash="$(cat "$hash_file_path" 2>/dev/null || true)"
    fi
  fi

  if [[ "$MECO_SKIP_NPM_INSTALL_IF_UNCHANGED" == "1" && -d "$MECO_INSTALL_DIR/node_modules" && -n "$lock_hash" && "$lock_hash" == "$old_hash" ]]; then
    log "npm dependencies unchanged, skip install"
    return 0
  fi

  local npm_cmd="install"
  case "$MECO_NPM_INSTALL_MODE" in
    ci)
      npm_cmd="ci"
      ;;
    install)
      npm_cmd="install"
      ;;
    auto)
      if [[ -f "$lockfile" ]]; then
        npm_cmd="ci"
      else
        npm_cmd="install"
      fi
      ;;
    *)
      warn "Unknown MECO_NPM_INSTALL_MODE=$MECO_NPM_INSTALL_MODE, fallback to auto"
      if [[ -f "$lockfile" ]]; then
        npm_cmd="ci"
      else
        npm_cmd="install"
      fi
      ;;
  esac

  log "Installing npm dependencies via: npm $npm_cmd"
  (cd "$MECO_INSTALL_DIR" && npm "$npm_cmd" --no-fund --no-audit >/dev/null)

  if [[ -n "$lock_hash" ]]; then
    printf '%s\n' "$lock_hash" > "$hash_file_path"
  fi
}

get_openclaw_agents_json() {
  local raw parsed
  raw="$(openclaw agents list --json 2>&1 || true)"
  if parsed="$(printf '%s' "$raw" | extract_first_json 2>/dev/null)"; then
    printf '%s\n' "$parsed"
  else
    printf '[]\n'
  fi
}

sync_dir_overlay() {
  local src="$1"
  local dst="$2"
  mkdir -p "$dst"
  rsync -a --exclude '.DS_Store' "$src"/ "$dst"/
}

sync_skill_dir() {
  local src="$1"
  local dst="$2"
  mkdir -p "$dst"
  # 增量覆盖：只覆盖同名文件并补齐缺失文件，不删除用户在本机新增的自定义内容
  rsync -a --exclude '.DS_Store' --exclude 'node_modules' --exclude '.git' "$src"/ "$dst"/
}

merge_secret_json_preserve_existing() {
  local old_file="$1"
  local new_file="$2"
  [[ -f "$old_file" ]] || return 0
  [[ -f "$new_file" ]] || return 0

  node -e '
    const fs = require("fs");
    const oldPath = process.argv[1];
    const newPath = process.argv[2];
    let oldObj = null;
    let newObj = null;
    try { oldObj = JSON.parse(fs.readFileSync(oldPath, "utf8")); } catch (_) { process.exit(0); }
    try { newObj = JSON.parse(fs.readFileSync(newPath, "utf8")); } catch (_) { process.exit(0); }

    const isSecretKey = (k) => /(api[-_]?key|token|secret|password|^key$)/i.test(String(k || ""));
    const isEmpty = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
    const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";

    const merge = (next, prev) => {
      if (Array.isArray(next) && Array.isArray(prev)) {
        for (let i = 0; i < next.length; i++) {
          next[i] = merge(next[i], prev[i]);
        }
        return next;
      }
      if (!next || typeof next !== "object" || !prev || typeof prev !== "object") {
        return next;
      }
      for (const key of Object.keys(next)) {
        if (isSecretKey(key)) {
          if (isEmpty(next[key]) && isNonEmptyString(prev[key])) {
            next[key] = prev[key];
          }
          continue;
        }
        next[key] = merge(next[key], prev[key]);
      }
      return next;
    };

    const merged = merge(newObj, oldObj);
    fs.writeFileSync(newPath, JSON.stringify(merged, null, 2) + "\n");
  ' "$old_file" "$new_file"
}

sync_openclaw_skill_switches_from_manifest() {
  local manifest_path="$1"
  local openclaw_config="$OPENCLAW_ROOT/openclaw.json"
  [[ -f "$manifest_path" ]] || return 0

  mkdir -p "$OPENCLAW_ROOT"
  local summary
  summary="$(node -e '
    const fs = require("fs");
    const manifestPath = process.argv[1];
    const openclawConfigPath = process.argv[2];

    let manifest = {};
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8") || "{}");
    } catch (_) {
      process.exit(0);
    }

    const skills = (((manifest || {}).skills || {}).openclaw);
    if (!Array.isArray(skills) || skills.length === 0) {
      process.exit(0);
    }

    const stateMap = (((manifest || {}).skills || {}).state);
    const stateObj = stateMap && typeof stateMap === "object" ? stateMap : {};

    let conf = {};
    if (fs.existsSync(openclawConfigPath)) {
      try {
        conf = JSON.parse(fs.readFileSync(openclawConfigPath, "utf8") || "{}");
      } catch (_) {
        conf = {};
      }
    }

    if (!conf.skills || typeof conf.skills !== "object") conf.skills = {};
    if (!conf.skills.entries || typeof conf.skills.entries !== "object") conf.skills.entries = {};

    let changed = 0;
    let defaultOn = 0;
    for (const rawName of skills) {
      const skillName = String(rawName || "").trim();
      if (!skillName) continue;
      const knownState = Object.prototype.hasOwnProperty.call(stateObj, skillName) && typeof stateObj[skillName] === "boolean";
      const enabled = knownState ? !!stateObj[skillName] : true;
      if (!knownState) defaultOn++;

      if (!conf.skills.entries[skillName] || typeof conf.skills.entries[skillName] !== "object") {
        conf.skills.entries[skillName] = {};
      }
      if (conf.skills.entries[skillName].enabled !== enabled) {
        conf.skills.entries[skillName].enabled = enabled;
        changed++;
      } else {
        conf.skills.entries[skillName].enabled = enabled;
      }
    }

    fs.writeFileSync(openclawConfigPath, JSON.stringify(conf, null, 2) + "\n");
    process.stdout.write(`Synced OpenClaw skill switches: total=${skills.length}, changed=${changed}, defaultOn=${defaultOn}`);
  ' "$manifest_path" "$openclaw_config" 2>/dev/null || true)"

  if [[ -n "$summary" ]]; then
    log "$summary"
  fi
}

apply_bootstrap_assets() {
  local bootstrap_dir="$MECO_INSTALL_DIR/bootstrap/openclaw"
  local manifest="$bootstrap_dir/manifest.json"

  if [[ ! -f "$manifest" ]]; then
    warn "bootstrap manifest not found, skip OpenClaw bootstrap: $manifest"
    return 0
  fi

  require_cmd rsync
  mkdir -p "$OPENCLAW_ROOT" "$CONFIG_SKILLS_ROOT"

  local agents_json_file agent_map_file
  agents_json_file="$(mktemp)"
  agent_map_file="$(mktemp)"
  trap 'rm -f "'"$agents_json_file"'" "'"$agent_map_file"'"' RETURN

  get_openclaw_agents_json > "$agents_json_file"
  node -e '
    const fs = require("fs");
    const arr = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const item of arr) {
      if (!item || !item.id) continue;
      const ws = item.workspace || "";
      process.stdout.write(`${item.id}\t${ws}\n`);
    }
  ' "$agents_json_file" > "$agent_map_file"

  local agent_lines
  agent_lines="$(node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const a of (m.agents || [])) {
      const id = String(a.id || "").trim();
      if (!id) continue;
      const name = String(a.displayName || "").replace(/\t/g, " ").replace(/\n/g, " ").trim();
      const ws = String(a.workspaceDirName || "").trim();
      process.stdout.write(`${id}\t${name}\t${ws}\n`);
    }
  ' "$manifest")"

  while IFS=$'\t' read -r agent_id display_name workspace_dir_name; do
    [[ -n "$agent_id" ]] || continue

    local existing_workspace
    existing_workspace="$(awk -F'\t' -v id="$agent_id" '$1 == id { print $2; exit }' "$agent_map_file")"

    local desired_workspace_dir_name="$workspace_dir_name"
    if [[ -z "$desired_workspace_dir_name" ]]; then
      if [[ "$agent_id" == "main" ]]; then
        desired_workspace_dir_name="workspace"
      else
        desired_workspace_dir_name="workspace-$agent_id"
      fi
    fi

    local target_workspace="${existing_workspace:-$OPENCLAW_ROOT/$desired_workspace_dir_name}"

    if [[ -z "$existing_workspace" ]]; then
      log "Adding OpenClaw agent: $agent_id"
      if ! openclaw agents add "$agent_id" --workspace "$target_workspace" --non-interactive >/dev/null 2>&1; then
        warn "failed to add agent $agent_id, continue"
      fi
      printf '%s\t%s\n' "$agent_id" "$target_workspace" >> "$agent_map_file"
    fi

    if [[ -n "$display_name" ]]; then
      openclaw agents set-identity --agent "$agent_id" --name "$display_name" >/dev/null 2>&1 || true
    fi

    local ws_src="$bootstrap_dir/workspaces/$agent_id"
    if [[ -d "$ws_src" ]]; then
      sync_dir_overlay "$ws_src" "$target_workspace"
    fi

    local local_agent_src="$bootstrap_dir/data-agents/$agent_id"
    local local_agent_dst="$MECO_INSTALL_DIR/data/agents/$agent_id"
    if [[ -d "$local_agent_src" ]]; then
      sync_dir_overlay "$local_agent_src" "$local_agent_dst"
    fi

    local oc_agent_src="$bootstrap_dir/openclaw-agents/$agent_id/agent"
    local oc_agent_dst="$OPENCLAW_ROOT/agents/$agent_id/agent"
    if [[ -d "$oc_agent_src" ]]; then
      local backup_dir
      backup_dir="$(mktemp -d)"
      if [[ -f "$oc_agent_dst/auth-profiles.json" ]]; then
        cp "$oc_agent_dst/auth-profiles.json" "$backup_dir/auth-profiles.json"
      fi
      if [[ -f "$oc_agent_dst/models.json" ]]; then
        cp "$oc_agent_dst/models.json" "$backup_dir/models.json"
      fi

      sync_dir_overlay "$oc_agent_src" "$oc_agent_dst"

      if [[ -f "$backup_dir/auth-profiles.json" && -f "$oc_agent_dst/auth-profiles.json" ]]; then
        merge_secret_json_preserve_existing "$backup_dir/auth-profiles.json" "$oc_agent_dst/auth-profiles.json"
      fi
      if [[ -f "$backup_dir/models.json" && -f "$oc_agent_dst/models.json" ]]; then
        merge_secret_json_preserve_existing "$backup_dir/models.json" "$oc_agent_dst/models.json"
      fi
      rm -rf "$backup_dir"
    fi
  done <<< "$agent_lines"

  local skills_openclaw_dir="$bootstrap_dir/skills/openclaw"
  if [[ -d "$skills_openclaw_dir" ]]; then
    mkdir -p "$OPENCLAW_ROOT/skills"
    for skill_dir in "$skills_openclaw_dir"/*; do
      [[ -d "$skill_dir" ]] || continue
      local skill_name
      skill_name="$(basename "$skill_dir")"
      sync_skill_dir "$skill_dir" "$OPENCLAW_ROOT/skills/$skill_name"
      log "Synced OpenClaw skill: $skill_name"
    done
  fi

  sync_openclaw_skill_switches_from_manifest "$manifest"

  local skills_config_dir="$bootstrap_dir/skills/config"
  if [[ -d "$skills_config_dir" ]]; then
    mkdir -p "$CONFIG_SKILLS_ROOT"
    for skill_dir in "$skills_config_dir"/*; do
      [[ -d "$skill_dir" ]] || continue
      local skill_name
      skill_name="$(basename "$skill_dir")"
      sync_skill_dir "$skill_dir" "$CONFIG_SKILLS_ROOT/$skill_name"
      log "Synced config skill: $skill_name"
    done
  fi

  local knowledge_rule_src="$bootstrap_dir/knowledge-rule-folders"
  if [[ -d "$knowledge_rule_src" ]]; then
    local knowledge_rule_root="${MECO_KNOWLEDGE_RULE_UPLOAD_ROOT:-$HOME/Meco Studio/public/uploads/knowledge-rule-folders}"
    mkdir -p "$knowledge_rule_root"
    sync_dir_overlay "$knowledge_rule_src" "$knowledge_rule_root"
    log "Synced knowledge-rule folders -> $knowledge_rule_root"

    local knowledge_rule_fallback="$MECO_INSTALL_DIR/public/uploads/knowledge-rule-folders"
    if [[ "$knowledge_rule_fallback" != "$knowledge_rule_root" ]]; then
      mkdir -p "$knowledge_rule_fallback"
      sync_dir_overlay "$knowledge_rule_src" "$knowledge_rule_fallback"
      log "Synced knowledge-rule folders -> $knowledge_rule_fallback"
    fi
  fi

  openclaw skills list --json >/dev/null 2>&1 || true
}

reset_runtime_state() {
  if [[ "$MECO_RESET_RUNTIME_STATE" != "1" ]]; then
    return 0
  fi
  if [[ "$MECO_IS_UPDATE" == "1" && "$MECO_RESET_RUNTIME_STATE_ON_UPDATE" != "1" ]]; then
    log "Update mode detected: preserving existing runtime room state (set MECO_RESET_RUNTIME_STATE_ON_UPDATE=1 to force reset)"
    return 0
  fi

  log "Resetting runtime room state (no default test room)..."
  mkdir -p "$MECO_INSTALL_DIR/data"
  printf '[]\n' > "$MECO_INSTALL_DIR/data/rooms.json"
  mkdir -p "$MECO_INSTALL_DIR/data/room-covers"
  find "$MECO_INSTALL_DIR/data/room-covers" -type f -delete 2>/dev/null || true
}

resolve_runtime_service_port() {
  local port_file="$MECO_INSTALL_DIR/.meco-studio.port"
  local fallback_file="$HOME/.meco-studio/service-port"
  local candidate=""

  if [[ -f "$port_file" ]]; then
    candidate="$(tr -d '[:space:]' < "$port_file" 2>/dev/null || true)"
  fi
  if ! [[ "$candidate" =~ ^[0-9]+$ ]] || (( candidate <= 0 || candidate > 65535 )); then
    candidate=""
  fi

  if [[ -z "$candidate" && -f "$fallback_file" ]]; then
    candidate="$(tr -d '[:space:]' < "$fallback_file" 2>/dev/null || true)"
    if ! [[ "$candidate" =~ ^[0-9]+$ ]] || (( candidate <= 0 || candidate > 65535 )); then
      candidate=""
    fi
  fi

  if [[ -z "$candidate" ]]; then
    candidate="${MECO_SERVICE_PORT:-3456}"
    if ! [[ "$candidate" =~ ^[0-9]+$ ]] || (( candidate <= 0 || candidate > 65535 )); then
      candidate="3456"
    fi
  fi

  printf '%s\n' "$candidate"
}

stop_active_rooms_if_update() {
  if [[ "$MECO_IS_UPDATE" != "1" ]]; then
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    warn "curl not found, skip stopping active rooms before restart"
    return 0
  fi

  local service_port
  service_port="$(resolve_runtime_service_port)"
  local stop_url="http://127.0.0.1:${service_port}/api/roundtable/stop-active-rooms"

  log "Update mode detected: stopping active rooms before restart (port=$service_port)..."
  if curl -fsS \
    -X POST \
    -H 'Content-Type: application/json' \
    --data '{"source":"pre_restart"}' \
    "$stop_url" >/dev/null 2>&1; then
    log "Stopped active rooms before restart"
  else
    warn "Unable to stop active rooms via $stop_url (service may be offline), continue restart"
  fi
}

start_service() {
  if [[ "$MECO_START_AFTER_INSTALL" != "1" && "$MECO_IS_UPDATE" != "1" ]]; then
    log "Skip start service (MECO_START_AFTER_INSTALL=$MECO_START_AFTER_INSTALL)"
    return 0
  fi
  if [[ "$MECO_IS_UPDATE" == "1" && "$MECO_START_AFTER_INSTALL" != "1" ]]; then
    log "Update mode detected: forcing Meco Studio restart (MECO_START_AFTER_INSTALL ignored)"
  fi

  local pid_file="$MECO_INSTALL_DIR/.meco-studio.pid"
  local port_file="$MECO_INSTALL_DIR/.meco-studio.port"
  local node_bin
  node_bin="$(command -v node || true)"
  [[ -n "$node_bin" ]] || die "node command not found while starting service"

  if [[ -f "$pid_file" ]]; then
    local old_pid
    old_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$old_pid" ]]; then
      log "Stopping existing meco server process: $old_pid"
      kill_and_wait "$old_pid" 5
    fi
  fi

  local stale_pids
  stale_pids="$(ps -Ao pid=,command= | awk -v p="$MECO_INSTALL_DIR/server.js" '$0 ~ p && $0 ~ /node/ {print $1}')"
  if [[ -n "$stale_pids" ]]; then
    while read -r pid; do
      [[ -n "$pid" ]] || continue
      kill_and_wait "$pid" 3
    done <<< "$stale_pids"
  fi

  local service_port
  service_port="${MECO_SERVICE_PORT:-3456}"
  if ! [[ "$service_port" =~ ^[0-9]+$ ]]; then
    warn "Invalid MECO_SERVICE_PORT=$service_port, fallback to 3456"
    service_port="3456"
  fi

  local listeners
  listeners="$(list_listen_pids_on_port "$service_port")"
  if [[ -n "$listeners" ]]; then
    local conflict_exists=0
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      local cmdline
      cmdline="$(ps -p "$pid" -o command= 2>/dev/null || true)"
      if [[ "$cmdline" == *"node"* && "$cmdline" == *"server.js"* ]]; then
        log "Stopping process on port $service_port (pid=$pid): $cmdline"
        kill_and_wait "$pid" 5
      else
        conflict_exists=1
      fi
    done <<< "$listeners"

    listeners="$(list_listen_pids_on_port "$service_port")"
    if [[ -n "$listeners" ]]; then
      if (( conflict_exists == 1 )); then
        warn "Port $service_port is occupied by non-meco process, trying next available port..."
      fi
      local candidate="$service_port"
      local attempts=0
      while [[ -n "$(list_listen_pids_on_port "$candidate")" ]]; do
        attempts=$((attempts + 1))
        candidate=$((candidate + 1))
        if (( attempts > MECO_SERVICE_PORT_SCAN_MAX )); then
          while IFS= read -r pid; do
            [[ -n "$pid" ]] || continue
            warn "Port conflict pid=$pid: $(ps -p "$pid" -o command= 2>/dev/null || printf '<unknown>')"
          done <<< "$listeners"
          die "Unable to allocate service port near ${MECO_SERVICE_PORT:-3456}. Set MECO_SERVICE_PORT manually and retry."
        fi
      done
      warn "Service port switched from ${MECO_SERVICE_PORT:-3456} to $candidate"
      service_port="$candidate"
    fi
  fi

  log "Starting meco-studio service..."
  (
    cd "$MECO_INSTALL_DIR"
    PORT="$service_port" nohup "$node_bin" server.js > server.log 2>&1 &
    echo $! > "$pid_file"
  )

  local new_pid
  new_pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -z "$new_pid" ]] || ! kill -0 "$new_pid" 2>/dev/null; then
    die "service failed to start, check $MECO_INSTALL_DIR/server.log"
  fi

  if command -v curl >/dev/null 2>&1; then
    local i=1
    while (( i <= MECO_HEALTHCHECK_RETRIES )); do
      if curl -fsS "http://127.0.0.1:${service_port}/api/status" >/dev/null 2>&1; then
        printf '%s\n' "$service_port" > "$port_file"
        mkdir -p "$HOME/.meco-studio"
        printf '%s\n' "$service_port" > "$HOME/.meco-studio/service-port"
        log "Service started. pid=$new_pid, url=http://127.0.0.1:${service_port}"
        return 0
      fi
      sleep "$MECO_HEALTHCHECK_INTERVAL_SEC"
      i=$((i + 1))
    done
    die "service process is running but healthcheck failed, check $MECO_INSTALL_DIR/server.log"
  fi

  printf '%s\n' "$service_port" > "$port_file"
  mkdir -p "$HOME/.meco-studio"
  printf '%s\n' "$service_port" > "$HOME/.meco-studio/service-port"
  log "Service started (curl not found, skipped healthcheck). pid=$new_pid, url=http://127.0.0.1:${service_port}"
}

main() {
  ensure_git
  ensure_node_and_npm
  ensure_python_and_pip
  ensure_openclaw
  local effective_kimi_key="${MECO_KIMI_CODING_API_KEY:-}"
  local effective_model_key="${MECO_OPENCLAW_MODEL_API_KEY:-$MECO_KIMI_CODING_API_KEY}"
  configure_openclaw_kimi_auth "$effective_model_key"
  configure_openclaw_defaults "$MECO_OPENCLAW_MODEL" "$effective_model_key"
  ensure_kimi_cli
  prepare_repo
  run_permissions_preflight
  install_dependencies
  ensure_cloudflared
  ensure_rustdesk_client
  setup_rustdesk_selfhost
  configure_clash_rustdesk_direct
  normalize_rustdesk_network
  grant_rustdesk_permissions
  ensure_hot_topics_knowledge_base
  apply_bootstrap_assets
  ensure_hot_topics_skill
  ensure_tikhub_skills
  ensure_hot_topics_knowledge_base
  install_skill_runtime_dependencies
  configure_kimi_api_key "$effective_kimi_key"
  configure_meco_runtime_settings "$effective_kimi_key" "$effective_model_key"
  configure_skill_runtime_env
  sync_local_version_marker
  reset_runtime_state
  restart_openclaw_if_update
  stop_active_rooms_if_update
  start_service
  start_cloudflare_tunnel_runtime
  log "Install/upgrade done."
}

main "$@"
