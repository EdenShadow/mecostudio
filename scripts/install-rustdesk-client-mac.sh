#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[rustdesk-client-mac] %s\n' "$*"
}

warn() {
  printf '[rustdesk-client-mac] WARN: %s\n' "$*" >&2
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  log "Skip: this script is only for macOS."
  exit 0
fi

RUSTDESK_APP="/Applications/RustDesk.app"
RUSTDESK_AUTO_UPGRADE="${RUSTDESK_AUTO_UPGRADE:-1}"
RUSTDESK_AUTO_LAUNCH="${RUSTDESK_AUTO_LAUNCH:-1}"
RUSTDESK_DMG_URL="${RUSTDESK_DMG_URL:-https://rustdesk.com/downloads/RustDesk.dmg}"

install_with_brew() {
  if ! command -v brew >/dev/null 2>&1; then
    return 1
  fi
  if [[ -d "$RUSTDESK_APP" ]]; then
    if [[ "$RUSTDESK_AUTO_UPGRADE" == "1" ]]; then
      log "RustDesk already installed, upgrading via Homebrew cask..."
      brew upgrade --cask rustdesk >/dev/null 2>&1 || true
    else
      log "RustDesk already installed, skip upgrade (RUSTDESK_AUTO_UPGRADE=$RUSTDESK_AUTO_UPGRADE)"
    fi
  else
    log "Installing RustDesk via Homebrew cask..."
    brew install --cask rustdesk >/dev/null
  fi
  return 0
}

install_with_dmg() {
  local tmp_dir dmg_file mount_point app_path
  tmp_dir="$(mktemp -d)"
  dmg_file="$tmp_dir/rustdesk.dmg"
  log "Installing RustDesk from DMG: $RUSTDESK_DMG_URL"
  curl -fL "$RUSTDESK_DMG_URL" -o "$dmg_file"
  mount_point="$(hdiutil attach "$dmg_file" -nobrowse -readonly | awk '/\/Volumes\// { print $3; exit }')"
  if [[ -z "$mount_point" || ! -d "$mount_point" ]]; then
    warn "Failed to mount DMG."
    rm -rf "$tmp_dir"
    return 1
  fi
  app_path="$(find "$mount_point" -maxdepth 2 -type d -name 'RustDesk.app' | head -n 1)"
  if [[ -z "$app_path" || ! -d "$app_path" ]]; then
    warn "RustDesk.app not found in mounted DMG."
    hdiutil detach "$mount_point" >/dev/null 2>&1 || true
    rm -rf "$tmp_dir"
    return 1
  fi
  rm -rf "$RUSTDESK_APP"
  cp -R "$app_path" "/Applications/"
  hdiutil detach "$mount_point" >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
  return 0
}

if [[ -d "$RUSTDESK_APP" ]]; then
  if [[ "$RUSTDESK_AUTO_UPGRADE" == "1" ]]; then
    install_with_brew || true
  fi
else
  install_with_brew || install_with_dmg || {
    warn "Failed to install RustDesk automatically."
    warn "Please install manually: brew install --cask rustdesk"
    exit 1
  }
fi

if [[ ! -d "$RUSTDESK_APP" ]]; then
  warn "RustDesk install check failed: $RUSTDESK_APP not found."
  exit 1
fi

if [[ "$RUSTDESK_AUTO_LAUNCH" == "1" ]]; then
  open -ga "$RUSTDESK_APP" >/dev/null 2>&1 || true
fi

log "RustDesk client is ready on macOS."
