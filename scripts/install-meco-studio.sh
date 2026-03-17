#!/usr/bin/env bash
set -euo pipefail

MECO_REPO_URL="${MECO_REPO_URL:-https://github.com/EdenShadow/mecostudio.git}"
MECO_BRANCH="${MECO_BRANCH:-main}"
MECO_INSTALL_DIR="${MECO_INSTALL_DIR:-$HOME/meco-studio}"
MECO_START_AFTER_INSTALL="${MECO_START_AFTER_INSTALL:-1}"
MECO_RESET_RUNTIME_STATE="${MECO_RESET_RUNTIME_STATE:-1}"
MECO_UPGRADE_OPENCLAW="${MECO_UPGRADE_OPENCLAW:-0}"
MECO_KIMI_CODING_API_KEY="${MECO_KIMI_CODING_API_KEY:-}"
MECO_OPENCLAW_MODEL="${MECO_OPENCLAW_MODEL:-kimi-openai/kimi-k2.5}"
MECO_OPENCLAW_MODEL_API_KEY="${MECO_OPENCLAW_MODEL_API_KEY:-}"
MECO_MINIMAX_API_KEY="${MECO_MINIMAX_API_KEY:-}"
MECO_MINIMAX_WS_URL="${MECO_MINIMAX_WS_URL:-wss://api.minimaxi.com/ws/v1/t2a_v2}"
MECO_TIKHUB_API_KEY="${MECO_TIKHUB_API_KEY:-}"
MECO_OPENAI_API_KEY="${MECO_OPENAI_API_KEY:-}"
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
  if ! command -v python3 >/dev/null 2>&1; then
    warn "python3 not found, skip Whisper install for Kimi CLI"
    return 0
  fi

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

configure_openclaw_defaults() {
  local model="$1"
  local provider_key="$2"
  local openclaw_config="$OPENCLAW_ROOT/openclaw.json"
  mkdir -p "$OPENCLAW_ROOT"

  node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const model = String(process.argv[2] || "").trim() || "kimi-openai/kimi-k2.5";
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

    if (providerId && providerKey) {
      if (!conf.models.providers[providerId] || typeof conf.models.providers[providerId] !== "object") {
        conf.models.providers[providerId] = {};
      }
      conf.models.providers[providerId].apiKey = providerKey;
    }

    // Keep kimi providers aligned when key is supplied
    if (providerKey) {
      for (const kimiProvider of ["kimi-coding", "kimi-openai"]) {
        if (!conf.models.providers[kimiProvider] || typeof conf.models.providers[kimiProvider] !== "object") {
          conf.models.providers[kimiProvider] = {};
        }
        if (!conf.models.providers[kimiProvider].apiKey) {
          conf.models.providers[kimiProvider].apiKey = providerKey;
        }
      }
    }

    fs.writeFileSync(path, JSON.stringify(conf, null, 2) + "\n");
  ' "$openclaw_config" "$model" "$provider_key"

  log "Configured OpenClaw defaults: model=$model"
}

configure_meco_runtime_settings() {
  local kimi_api_key="$1"
  mkdir -p "$MECO_INSTALL_DIR/data"
  local settings_path="$MECO_INSTALL_DIR/data/app-settings.json"

  node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const patch = {
      openclawModel: String(process.argv[2] || "").trim(),
      minimaxApiKey: String(process.argv[3] || "").trim(),
      minimaxWsUrl: String(process.argv[4] || "").trim(),
      tikhubApiKey: String(process.argv[5] || "").trim(),
      kimiApiKey: String(process.argv[6] || "").trim(),
      hotTopicsKbPath: String(process.argv[7] || "").trim(),
      openaiApiKey: String(process.argv[8] || "").trim()
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
    "$MECO_MINIMAX_API_KEY" \
    "$MECO_MINIMAX_WS_URL" \
    "$MECO_TIKHUB_API_KEY" \
    "$kimi_api_key" \
    "$HOT_TOPICS_ROOT" \
    "$MECO_OPENAI_API_KEY"

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

  if command -v python3 >/dev/null 2>&1; then
    python3 -m pip install --user aiohttp aiofiles requests >/dev/null 2>&1 || warn "hot-topics python deps install failed"
  fi
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
    log "Meco Studio exists, pulling latest..."
    git -C "$MECO_INSTALL_DIR" fetch origin "$MECO_BRANCH"
    git -C "$MECO_INSTALL_DIR" checkout "$MECO_BRANCH"
    git -C "$MECO_INSTALL_DIR" pull --ff-only origin "$MECO_BRANCH"
  else
    log "Cloning Meco Studio into $MECO_INSTALL_DIR ..."
    git clone --branch "$MECO_BRANCH" "$MECO_REPO_URL" "$MECO_INSTALL_DIR"
  fi
}

install_dependencies() {
  log "Installing npm dependencies..."
  (cd "$MECO_INSTALL_DIR" && npm install --no-fund --no-audit >/dev/null)
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
  if [[ "$MECO_START_AFTER_INSTALL" != "1" ]]; then
    log "Skip start service (MECO_START_AFTER_INSTALL=$MECO_START_AFTER_INSTALL)"
    return 0
  fi

  local pid_file="$MECO_INSTALL_DIR/.meco-studio.pid"
  if [[ -f "$pid_file" ]]; then
    local old_pid
    old_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
      log "Stopping existing meco server process: $old_pid"
      kill "$old_pid" >/dev/null 2>&1 || true
      sleep 1
    fi
  fi

  local stale_pids
  stale_pids="$(ps -Ao pid=,command= | awk -v p="$MECO_INSTALL_DIR/server.js" '$0 ~ p && $0 ~ /node/ {print $1}')"
  if [[ -n "$stale_pids" ]]; then
    while read -r pid; do
      [[ -n "$pid" ]] || continue
      kill "$pid" >/dev/null 2>&1 || true
    done <<< "$stale_pids"
  fi

  log "Starting meco-studio service..."
  (
    cd "$MECO_INSTALL_DIR"
    nohup node server.js > server.log 2>&1 &
    echo $! > "$pid_file"
  )

  local new_pid
  new_pid="$(cat "$pid_file" 2>/dev/null || true)"
  sleep 1
  if [[ -n "$new_pid" ]] && kill -0 "$new_pid" 2>/dev/null; then
    log "Service started. pid=$new_pid, url=http://127.0.0.1:3456"
  else
    die "service failed to start, check $MECO_INSTALL_DIR/server.log"
  fi
}

main() {
  require_cmd git
  ensure_node_and_npm
  ensure_openclaw
  local effective_kimi_key="${MECO_KIMI_CODING_API_KEY:-}"
  local effective_model_key="${MECO_OPENCLAW_MODEL_API_KEY:-$MECO_KIMI_CODING_API_KEY}"
  configure_openclaw_defaults "$MECO_OPENCLAW_MODEL" "$effective_model_key"
  ensure_kimi_cli
  ensure_kimi_whisper
  prepare_repo
  install_dependencies
  ensure_hot_topics_knowledge_base
  apply_bootstrap_assets
  ensure_hot_topics_skill
  configure_kimi_api_key "$effective_kimi_key"
  configure_meco_runtime_settings "$effective_kimi_key"
  reset_runtime_state
  start_service
  log "Install/upgrade done."
}

main "$@"
