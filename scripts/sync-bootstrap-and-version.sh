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

enforce_no_room_runtime_tracking() {
  if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 0
  fi
  git -C "$REPO_ROOT" rm --cached -r --ignore-unmatch data/rooms.json data/room-covers >/dev/null 2>&1 || true
}

main() {
  ensure_version_file
  set_version_if_provided
  (cd "$REPO_ROOT" && bash scripts/build-bootstrap-package.sh)
  enforce_no_room_runtime_tracking
  sync_local_version_file
  log "Done. Review changes with: git status"
}

main "$@"
