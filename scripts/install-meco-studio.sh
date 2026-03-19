#!/usr/bin/env bash
set -euo pipefail

MECO_REPO_URL="${MECO_REPO_URL:-https://github.com/EdenShadow/mecostudio.git}"
MECO_BRANCH="${MECO_BRANCH:-main}"
MECO_INSTALL_DIR="${MECO_INSTALL_DIR:-$HOME/meco-studio}"
MECO_START_AFTER_INSTALL="${MECO_START_AFTER_INSTALL:-1}"
MECO_RESET_RUNTIME_STATE="${MECO_RESET_RUNTIME_STATE:-1}"
MECO_UPGRADE_OPENCLAW="${MECO_UPGRADE_OPENCLAW:-0}"
MECO_NPM_INSTALL_MODE="${MECO_NPM_INSTALL_MODE:-auto}" # auto|ci|install
MECO_SKIP_NPM_INSTALL_IF_UNCHANGED="${MECO_SKIP_NPM_INSTALL_IF_UNCHANGED:-1}"
MECO_HEALTHCHECK_RETRIES="${MECO_HEALTHCHECK_RETRIES:-20}"
MECO_HEALTHCHECK_INTERVAL_SEC="${MECO_HEALTHCHECK_INTERVAL_SEC:-1}"
MECO_KIMI_CODING_API_KEY="${MECO_KIMI_CODING_API_KEY:-}"
MECO_OPENCLAW_MODEL="${MECO_OPENCLAW_MODEL:-kimi-coding/k2p5}"
MECO_OPENCLAW_MODEL_API_KEY="${MECO_OPENCLAW_MODEL_API_KEY:-}"
MECO_MINIMAX_API_KEY="${MECO_MINIMAX_API_KEY:-}"
MECO_MINIMAX_WS_URL="${MECO_MINIMAX_WS_URL:-wss://api.minimaxi.com/ws/v1/t2a_v2}"
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
    if (!conf.gateway.auth || typeof conf.gateway.auth !== "object") conf.gateway.auth = {};

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
      tikhubApiKey: String(process.argv[6] || "").trim(),
      meowloadApiKey: String(process.argv[7] || "").trim(),
      kimiApiKey: String(process.argv[8] || "").trim(),
      hotTopicsKbPath: String(process.argv[9] || "").trim(),
      openaiApiKey: String(process.argv[10] || "").trim(),
      ossEndpoint: String(process.argv[11] || "").trim(),
      ossBucket: String(process.argv[12] || "").trim(),
      ossAccessKeyId: String(process.argv[13] || "").trim(),
      ossAccessKeySecret: String(process.argv[14] || "").trim()
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
    fs.writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  ' "$settings_path" \
    "$MECO_OPENCLAW_MODEL" \
    "$openclaw_model_api_key" \
    "$MECO_MINIMAX_API_KEY" \
    "$MECO_MINIMAX_WS_URL" \
    "$MECO_TIKHUB_API_KEY" \
    "$MECO_MEOWLOAD_API_KEY" \
    "$kimi_api_key" \
    "$HOT_TOPICS_ROOT" \
    "$MECO_OPENAI_API_KEY" \
    "$MECO_OSS_ENDPOINT" \
    "$MECO_OSS_BUCKET" \
    "$MECO_OSS_ACCESS_KEY_ID" \
    "$MECO_OSS_ACCESS_KEY_SECRET"

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

  local category_dir
  for category in "${HOT_TOPICS_CATEGORIES[@]}"; do
    category_dir="$hot_topics_root/$category"
    if [[ -d "$category_dir" ]]; then
      continue
    fi
    mkdir -p "$category_dir"
    log "Created category folder: $category_dir"
  done
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

restart_openclaw_if_update() {
  if [[ "$MECO_IS_UPDATE" != "1" ]]; then
    return 0
  fi
  if ! command -v openclaw >/dev/null 2>&1; then
    warn "OpenClaw command not found, skip gateway restart"
    return 0
  fi

  log "Update mode detected: restarting OpenClaw gateway..."
  if openclaw gateway restart >/dev/null 2>&1; then
    log "OpenClaw gateway restarted"
  else
    warn "OpenClaw gateway restart failed (continuing)"
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
  rsync -a --delete --exclude '.DS_Store' --exclude 'node_modules' --exclude '.git' "$src"/ "$dst"/
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

  log "Resetting runtime room state (no default test room)..."
  mkdir -p "$MECO_INSTALL_DIR/data"
  printf '[]\n' > "$MECO_INSTALL_DIR/data/rooms.json"
  mkdir -p "$MECO_INSTALL_DIR/data/room-covers"
  find "$MECO_INSTALL_DIR/data/room-covers" -type f -delete 2>/dev/null || true
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

  log "Starting meco-studio service..."
  (
    cd "$MECO_INSTALL_DIR"
    nohup "$node_bin" server.js > server.log 2>&1 &
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
      if curl -fsS "http://127.0.0.1:3456/api/status" >/dev/null 2>&1; then
        log "Service started. pid=$new_pid, url=http://127.0.0.1:3456"
        return 0
      fi
      sleep "$MECO_HEALTHCHECK_INTERVAL_SEC"
      i=$((i + 1))
    done
    die "service process is running but healthcheck failed, check $MECO_INSTALL_DIR/server.log"
  fi

  log "Service started (curl not found, skipped healthcheck). pid=$new_pid, url=http://127.0.0.1:3456"
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
  install_dependencies
  ensure_hot_topics_knowledge_base
  apply_bootstrap_assets
  ensure_hot_topics_skill
  install_skill_runtime_dependencies
  configure_kimi_api_key "$effective_kimi_key"
  configure_meco_runtime_settings "$effective_kimi_key" "$effective_model_key"
  sync_local_version_marker
  reset_runtime_state
  restart_openclaw_if_update
  start_service
  log "Install/upgrade done."
}

main "$@"
