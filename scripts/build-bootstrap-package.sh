#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

OPENCLAW_ROOT="${OPENCLAW_ROOT:-$HOME/.openclaw}"
CONFIG_SKILLS_ROOT="${CONFIG_SKILLS_ROOT:-$HOME/.config/agents/skills}"
BOOTSTRAP_DIR="${BOOTSTRAP_DIR:-$REPO_ROOT/bootstrap/openclaw}"

log() {
  printf '[meco-bootstrap] %s\n' "$*"
}

die() {
  printf '[meco-bootstrap] ERROR: %s\n' "$*" >&2
  exit 1
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

list_from_csv_or_dirs() {
  local csv="$1"
  local root="$2"
  if [[ -n "$csv" ]]; then
    printf '%s\n' "$csv" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed '/^$/d'
    return 0
  fi
  if [[ ! -d "$root" ]]; then
    return 0
  fi
  find "$root" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort
}

sync_dir_clean() {
  local src="$1"
  local dst="$2"
  mkdir -p "$dst"
  rsync -a --delete \
    --exclude '.DS_Store' \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.env' \
    --exclude '.env.*' \
    --exclude '*.log' \
    --exclude 'logs' \
    --exclude 'tmp' \
    --exclude '__pycache__' \
    "$src"/ "$dst"/
}

sanitize_json_secrets() {
  local json_file="$1"
  [[ -f "$json_file" ]] || return 0
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_) {
      process.exit(0);
    }
    const secretKeyRegex = /(api[-_]?key|token|secret|password)/i;
    const walk = (input) => {
      if (Array.isArray(input)) return input.map(walk);
      if (!input || typeof input !== "object") return input;
      const out = {};
      for (const [k, v] of Object.entries(input)) {
        if (secretKeyRegex.test(k)) {
          out[k] = "";
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    };
    const cleaned = walk(parsed);
    fs.writeFileSync(file, JSON.stringify(cleaned, null, 2) + "\n");
  ' "$json_file"
}

copy_workspace_profile() {
  local src_ws="$1"
  local dst_ws="$2"
  mkdir -p "$dst_ws"
  local profile_files=(SOUL.md IDENTITY.md USER.md TOOLS.md HEARTBEAT.md AGENTS.md avatar.png)
  for rel in "${profile_files[@]}"; do
    if [[ -f "$src_ws/$rel" ]]; then
      cp "$src_ws/$rel" "$dst_ws/$rel"
    fi
  done
}

main() {
  command -v rsync >/dev/null 2>&1 || die "missing command: rsync"
  command -v node >/dev/null 2>&1 || die "missing command: node"

  mkdir -p "$BOOTSTRAP_DIR"
  mkdir -p "$BOOTSTRAP_DIR/data-agents" "$BOOTSTRAP_DIR/workspaces" "$BOOTSTRAP_DIR/skills/openclaw" "$BOOTSTRAP_DIR/skills/config"

  local openclaw_agents_json='[]'
  if command -v openclaw >/dev/null 2>&1; then
    local raw
    raw="$(openclaw agents list --json 2>&1 || true)"
    if parsed="$(printf '%s' "$raw" | extract_first_json 2>/dev/null)"; then
      openclaw_agents_json="$parsed"
    fi
  fi

  local workspace_map_file
  workspace_map_file="$(mktemp)"
  trap 'rm -f "'"$workspace_map_file"'"' EXIT
  printf '%s' "$openclaw_agents_json" | node -e '
    const fs = require("fs");
    const arr = JSON.parse(fs.readFileSync(0, "utf8"));
    for (const item of arr) {
      if (!item || !item.id || !item.workspace) continue;
      const ws = String(item.workspace).trim();
      if (!ws) continue;
      const wsBase = ws.split("/").filter(Boolean).pop() || "";
      process.stdout.write(`${item.id}\t${wsBase}\n`);
    }
  ' > "$workspace_map_file"

  local agent_ids
  agent_ids="$(list_from_csv_or_dirs "${MECO_BOOTSTRAP_AGENTS:-}" "$REPO_ROOT/data/agents")"

  : > "$BOOTSTRAP_DIR/.agents.tsv"
  while read -r agent_id; do
    [[ -n "$agent_id" ]] || continue
    local data_src="$REPO_ROOT/data/agents/$agent_id"
    [[ -d "$data_src" ]] || continue

    sync_dir_clean "$data_src" "$BOOTSTRAP_DIR/data-agents/$agent_id"
    sanitize_json_secrets "$BOOTSTRAP_DIR/data-agents/$agent_id/meta.json"

    local display_name
    display_name="$(node -e '
      const fs = require("fs");
      const p = process.argv[1];
      try {
        const j = JSON.parse(fs.readFileSync(p, "utf8"));
        process.stdout.write(String(j.displayName || "").replace(/\t/g, " ").replace(/\n/g, " ").trim());
      } catch (_) {}
    ' "$data_src/meta.json")"

    local ws_dir_name
    ws_dir_name="$(awk -F'\t' -v id="$agent_id" '$1 == id { print $2; exit }' "$workspace_map_file")"
    if [[ -z "$ws_dir_name" ]]; then
      if [[ "$agent_id" == "main" ]]; then
        ws_dir_name="workspace"
      else
        ws_dir_name="workspace-$agent_id"
      fi
    fi

    local ws_src="$OPENCLAW_ROOT/$ws_dir_name"
    if [[ ! -d "$ws_src" ]]; then
      local fallback_ws="$OPENCLAW_ROOT/workspace-${agent_id^}"
      if [[ -d "$fallback_ws" ]]; then
        ws_src="$fallback_ws"
        ws_dir_name="$(basename "$fallback_ws")"
      fi
    fi
    if [[ -d "$ws_src" ]]; then
      copy_workspace_profile "$ws_src" "$BOOTSTRAP_DIR/workspaces/$agent_id"
    fi

    printf '%s\t%s\t%s\n' "$agent_id" "$display_name" "$ws_dir_name" >> "$BOOTSTRAP_DIR/.agents.tsv"
    log "Packed agent: $agent_id"
  done <<< "$agent_ids"

  rm -rf "$BOOTSTRAP_DIR/skills/openclaw" "$BOOTSTRAP_DIR/skills/config"
  mkdir -p "$BOOTSTRAP_DIR/skills/openclaw" "$BOOTSTRAP_DIR/skills/config"

  local oc_skill
  while read -r oc_skill; do
    [[ -n "$oc_skill" ]] || continue
    local src="$OPENCLAW_ROOT/skills/$oc_skill"
    [[ -d "$src" ]] || continue
    sync_dir_clean "$src" "$BOOTSTRAP_DIR/skills/openclaw/$oc_skill"
    log "Packed OpenClaw skill: $oc_skill"
  done < <(list_from_csv_or_dirs "${MECO_BOOTSTRAP_OPENCLAW_SKILLS:-}" "$OPENCLAW_ROOT/skills")

  local cfg_skill
  while read -r cfg_skill; do
    [[ -n "$cfg_skill" ]] || continue
    local src="$CONFIG_SKILLS_ROOT/$cfg_skill"
    [[ -d "$src" ]] || continue
    sync_dir_clean "$src" "$BOOTSTRAP_DIR/skills/config/$cfg_skill"
    log "Packed config skill: $cfg_skill"
  done < <(list_from_csv_or_dirs "${MECO_BOOTSTRAP_CONFIG_SKILLS:-}" "$CONFIG_SKILLS_ROOT")

  node -e '
    const fs = require("fs");
    const path = require("path");
    const bootstrapDir = process.argv[1];
    const tsvPath = path.join(bootstrapDir, ".agents.tsv");

    const agents = [];
    if (fs.existsSync(tsvPath)) {
      for (const line of fs.readFileSync(tsvPath, "utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        const [id, displayName = "", workspaceDirName = ""] = line.split("\t");
        if (!id) continue;
        agents.push({
          id,
          displayName,
          workspaceDirName
        });
      }
    }

    const openclawSkillsDir = path.join(bootstrapDir, "skills", "openclaw");
    const configSkillsDir = path.join(bootstrapDir, "skills", "config");
    const listDirs = (dir) => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name)
        .sort();
    };

    const manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      agents,
      skills: {
        openclaw: listDirs(openclawSkillsDir),
        config: listDirs(configSkillsDir)
      }
    };

    fs.writeFileSync(
      path.join(bootstrapDir, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n"
    );
  ' "$BOOTSTRAP_DIR"

  rm -f "$BOOTSTRAP_DIR/.agents.tsv"
  log "Bootstrap package updated: $BOOTSTRAP_DIR"
}

main "$@"
