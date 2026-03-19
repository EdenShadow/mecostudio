#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_ROOT="${OPENCLAW_ROOT:-$HOME/.openclaw}"
MECO_INSTALL_DIR="${MECO_INSTALL_DIR:-$HOME/meco-studio}"
MECO_PERMISSION_STRICT="${MECO_PERMISSION_STRICT:-0}"
MECO_PERMISSION_NETWORK_CHECK="${MECO_PERMISSION_NETWORK_CHECK:-1}"

FAIL_COUNT=0
WARN_COUNT=0

log() {
  printf '[meco-permission] %s\n' "$*"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  printf '[meco-permission] WARN: %s\n' "$*" >&2
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf '[meco-permission] FAIL: %s\n' "$*" >&2
}

check_rw_dir() {
  local dir="$1"
  local label="$2"
  local probe_file="$dir/.meco_perm_probe_$$"

  if ! mkdir -p "$dir" >/dev/null 2>&1; then
    fail "$label: cannot create/access dir => $dir"
    return 0
  fi

  if ! touch "$probe_file" >/dev/null 2>&1; then
    fail "$label: write denied => $dir"
    return 0
  fi
  if ! printf 'ok\n' > "$probe_file" 2>/dev/null; then
    fail "$label: write denied => $dir"
    rm -f "$probe_file" >/dev/null 2>&1 || true
    return 0
  fi
  if ! cat "$probe_file" >/dev/null 2>&1; then
    fail "$label: read denied => $dir"
    rm -f "$probe_file" >/dev/null 2>&1 || true
    return 0
  fi
  rm -f "$probe_file" >/dev/null 2>&1 || true
  log "OK: $label read/write => $dir"
}

check_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    log "OK: command found => $cmd"
  else
    fail "missing command => $cmd"
  fi
}

check_network() {
  local url="$1"
  local label="$2"
  if [[ "$MECO_PERMISSION_NETWORK_CHECK" != "1" ]]; then
    warn "network check skipped by MECO_PERMISSION_NETWORK_CHECK=0"
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    warn "curl missing, network check skipped"
    return 0
  fi
  if curl -fsSIL --max-time 6 "$url" >/dev/null 2>&1; then
    log "OK: network reachable => $label ($url)"
  else
    fail "network unreachable => $label ($url)"
  fi
}

print_macos_guidance() {
  cat <<'EOF'
[meco-permission] macOS guidance:
  1) System Settings -> Privacy & Security -> Files and Folders:
     allow Terminal/iTerm access to Desktop/Documents/Downloads.
  2) If still blocked, enable Full Disk Access for Terminal/iTerm.
  3) Re-run this check:
     bash scripts/openclaw-permission-preflight.sh
EOF
}

main() {
  log "Starting OpenClaw/Meco permission preflight..."
  check_cmd "openclaw"
  check_cmd "node"
  check_cmd "python3"

  check_rw_dir "$HOME" "HOME"
  check_rw_dir "$HOME/Documents" "Documents"
  check_rw_dir "$HOME/Desktop" "Desktop"
  check_rw_dir "$HOME/Downloads" "Downloads"
  check_rw_dir "$OPENCLAW_ROOT" "OpenClaw root"
  check_rw_dir "$MECO_INSTALL_DIR" "Meco install dir"
  check_rw_dir "$HOME/Meco Studio/public/uploads" "Meco uploads root"

  check_network "https://github.com" "GitHub"
  check_network "https://api.kimi.com" "Kimi API"
  check_network "https://api.minimaxi.com" "MiniMax API"

  if command -v openclaw >/dev/null 2>&1; then
    if openclaw gateway status >/dev/null 2>&1; then
      log "OK: openclaw gateway status is reachable"
    else
      warn "openclaw gateway status check failed (may not be running yet)"
    fi
  fi

  if [[ "$OSTYPE" == "darwin"* ]]; then
    print_macos_guidance
  fi

  if (( FAIL_COUNT > 0 )); then
    if [[ "$MECO_PERMISSION_STRICT" == "1" ]]; then
      printf '[meco-permission] RESULT: FAIL (%s fail, %s warn)\n' "$FAIL_COUNT" "$WARN_COUNT" >&2
      exit 2
    fi
    warn "permission preflight has $FAIL_COUNT fail(s), continue because MECO_PERMISSION_STRICT=0"
  else
    log "RESULT: PASS ($WARN_COUNT warn)"
  fi
}

main "$@"
