#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_VERSION="${1:-}"
VERSION_FILE="$REPO_ROOT/VERSION"
LOCAL_VERSION_FILE="${HOME}/.meco-studio/VERSION"

log() {
  printf '[meco-sync] %s\n' "$*"
}

die() {
  printf '[meco-sync] ERROR: %s\n' "$*" >&2
  exit 1
}

ensure_version_file() {
  if [[ ! -f "$VERSION_FILE" ]]; then
    printf '0.0.1\n' > "$VERSION_FILE"
    log "Initialized VERSION => 0.0.1"
  fi
}

set_version_if_provided() {
  if [[ -z "$TARGET_VERSION" ]]; then
    return 0
  fi
  if ! [[ "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+)?$ ]]; then
    die "invalid version: $TARGET_VERSION (expected semver like 0.0.1)"
  fi
  printf '%s\n' "$TARGET_VERSION" > "$VERSION_FILE"
  log "Updated VERSION => $TARGET_VERSION"
}

sync_local_version_file() {
  local version
  version="$(tr -d '[:space:]' < "$VERSION_FILE" 2>/dev/null || true)"
  [[ -n "$version" ]] || version="0.0.1"
  if ! mkdir -p "$(dirname "$LOCAL_VERSION_FILE")" 2>/dev/null; then
    log "WARN: cannot create local version dir, skip local marker sync"
    return 0
  fi
  if printf '%s\n' "$version" > "$LOCAL_VERSION_FILE" 2>/dev/null; then
    log "Synced local version => $LOCAL_VERSION_FILE ($version)"
  else
    log "WARN: cannot write local version marker, skip local marker sync"
  fi
}

sync_docs_version_stamp() {
  local version
  version="$(tr -d '[:space:]' < "$VERSION_FILE" 2>/dev/null || true)"
  [[ -n "$version" ]] || version="0.0.1"

  node - "$version" "$REPO_ROOT/README.md" "$REPO_ROOT/MECO-STUDIO-INSTALL.md" <<'NODE'
const fs = require('fs');

const version = String(process.argv[2] || '').trim() || '0.0.1';
const files = process.argv.slice(3);
const stampLine = `> 文档版本：\`${version}\``;
const stampRe = /^>\s*文档版本：`[^`]+`$/m;

for (const file of files) {
  if (!file || !fs.existsSync(file)) continue;
  const raw = fs.readFileSync(file, 'utf8');
  let next = raw;
  if (stampRe.test(next)) {
    next = next.replace(stampRe, stampLine);
  } else {
    const lines = next.split(/\r?\n/);
    if (lines.length === 0) lines.push('');
    const titleIndex = lines.findIndex((line) => /^#\s+/.test(line));
    if (titleIndex >= 0) {
      lines.splice(titleIndex + 1, 0, '', stampLine);
      next = lines.join('\n');
    } else {
      next = `${stampLine}\n\n${next}`;
    }
  }
  if (next !== raw) {
    fs.writeFileSync(file, next, 'utf8');
  }
}
NODE

  log "Synced docs version stamp: $version"
}

print_packaging_iron_law_scope() {
  log "Packaging iron-law scope (must verify on each package/release):"
  log "  1) OpenClaw: bootstrap/openclaw/workspaces/* + bootstrap/openclaw/openclaw-agents/*/agent/*"
  log "  2) Agents:   bootstrap/openclaw/data-agents/*"
  log "  3) Knowledge:bootstrap/openclaw/knowledge-rule-folders/*"
  log "  4) Skills:   bootstrap/openclaw/skills/openclaw/*"
  log "  5) Kimi CLI: bootstrap/openclaw/skills/config/*"
  log "  6) Kimi CLI skills: bootstrap/openclaw/skills/config/* (sub-skills/scripts)"
}

enforce_no_room_runtime_tracking() {
  if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 0
  fi
  git -C "$REPO_ROOT" rm --cached -r --ignore-unmatch data/rooms.json data/room-covers >/dev/null 2>&1 || true
}

main() {
  ensure_version_file
  set_version_if_provided
  sync_docs_version_stamp
  (cd "$REPO_ROOT" && bash scripts/build-bootstrap-package.sh)
  enforce_no_room_runtime_tracking
  sync_local_version_file
  print_packaging_iron_law_scope
  log "Done. Review changes with: git status"
}

main "$@"
