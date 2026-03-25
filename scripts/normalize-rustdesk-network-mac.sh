#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[rustdesk-network-mac] %s\n' "$*"
}

warn() {
  printf '[rustdesk-network-mac] WARN: %s\n' "$*" >&2
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  log "Skip: this script is only for macOS."
  exit 0
fi

resolve_private_ipv4() {
  local iface ip
  iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
  if [[ -n "$iface" ]]; then
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if [[ "$ip" =~ ^10\. || "$ip" =~ ^192\.168\. || "$ip" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]]; then
      printf '%s\n' "$ip"
      return 0
    fi
  fi

  if command -v ifconfig >/dev/null 2>&1; then
    ip="$(ifconfig 2>/dev/null \
      | awk '/inet / {print $2}' \
      | grep -E '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' \
      | grep -Ev '^(26\.|127\.|169\.254\.)' \
      | head -n 1 || true)"
    if [[ -n "$ip" ]]; then
      printf '%s\n' "$ip"
      return 0
    fi
  fi

  printf '%s\n' ""
}

list_candidate_configs() {
  local candidates=(
    "$HOME/Library/Preferences/com.carriez.RustDesk/RustDesk2.toml"
    "$HOME/Library/Preferences/com.carriez.rustdesk/RustDesk2.toml"
    "$HOME/Library/Preferences/com.carriez.RustDesk/RustDesk.toml"
    "$HOME/Library/Preferences/com.carriez.rustdesk/RustDesk.toml"
    "$HOME/Library/Application Support/com.carriez.RustDesk/config/RustDesk2.toml"
    "$HOME/.config/rustdesk/RustDesk2.toml"
    "$HOME/.config/RustDesk/RustDesk2.toml"
  )
  local found=0 p
  for p in "${candidates[@]}"; do
    if [[ -f "$p" ]]; then
      printf '%s\n' "$p"
      found=1
    fi
  done
  if [[ "$found" -eq 0 ]]; then
    printf '%s\n' "$HOME/Library/Preferences/com.carriez.RustDesk/RustDesk2.toml"
  fi
}

patch_local_ip_for_file() {
  local cfg_path="$1"
  local local_ip="$2"
  mkdir -p "$(dirname "$cfg_path")"
  touch "$cfg_path"

  node - "$cfg_path" "$local_ip" <<'NODE'
const fs = require('fs');

const file = process.argv[2];
const localIp = String(process.argv[3] || '').trim();

const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);

const sectionRe = /^\s*\[([^\]]+)\]\s*$/;
const localIpRe = /^\s*local-ip-addr\s*=/i;

let optionsStart = lines.findIndex((line) => /^\s*\[options\]\s*$/i.test(line));
if (optionsStart < 0) {
  if (lines.length > 0 && String(lines[lines.length - 1] || '').trim() !== '') {
    lines.push('');
  }
  lines.push('[options]');
  optionsStart = lines.length - 1;
}

let optionsEnd = lines.length;
for (let i = optionsStart + 1; i < lines.length; i += 1) {
  if (sectionRe.test(lines[i])) {
    optionsEnd = i;
    break;
  }
}

let localIpLine = -1;
for (let i = optionsStart + 1; i < optionsEnd; i += 1) {
  if (localIpRe.test(lines[i])) {
    localIpLine = i;
    break;
  }
}

if (localIp) {
  const nextLine = `local-ip-addr = '${localIp}'`;
  if (localIpLine >= 0) {
    lines[localIpLine] = nextLine;
  } else {
    lines.splice(optionsEnd, 0, nextLine);
  }
} else if (localIpLine >= 0) {
  lines.splice(localIpLine, 1);
}

const next = lines.join(eol);
if (next !== raw) {
  fs.writeFileSync(file, next, 'utf8');
}
NODE
}

restart_rustdesk_if_running() {
  local rustdesk_running service_running
  rustdesk_running=0
  service_running=0

  if pgrep -x "RustDesk" >/dev/null 2>&1; then
    rustdesk_running=1
  fi
  if pgrep -f "/Applications/RustDesk.app/Contents/MacOS/service" >/dev/null 2>&1; then
    service_running=1
  fi

  if [[ "$rustdesk_running" -eq 0 && "$service_running" -eq 0 ]]; then
    log "RustDesk is not running, skip restart."
    return 1
  fi

  pkill -x RustDesk >/dev/null 2>&1 || true
  pkill -f "/Applications/RustDesk.app/Contents/MacOS/service" >/dev/null 2>&1 || true
  sleep 1
  open -ga "/Applications/RustDesk.app" >/dev/null 2>&1 || true
  log "Restarted RustDesk app/service."
  return 0
}

main() {
  local local_ip
  local_ip="$(resolve_private_ipv4)"

  if [[ -z "$local_ip" ]]; then
    warn "No private LAN IPv4 detected. Will only clear stale local-ip-addr in config."
  else
    log "Resolved private LAN IPv4: $local_ip"
  fi

  local cfg
  while IFS= read -r cfg; do
    [[ -n "$cfg" ]] || continue
    patch_local_ip_for_file "$cfg" "$local_ip"
    log "Patched RustDesk config: $cfg"
  done < <(list_candidate_configs)

  if restart_rustdesk_if_running; then
    # RustDesk may rewrite local-ip-addr at startup; enforce final value once more.
    sleep 1
    while IFS= read -r cfg; do
      [[ -n "$cfg" ]] || continue
      patch_local_ip_for_file "$cfg" "$local_ip"
      log "Re-patched RustDesk config after restart: $cfg"
    done < <(list_candidate_configs)
  fi
  log "RustDesk network normalization done."
}

main "$@"
