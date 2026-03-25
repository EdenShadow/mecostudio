#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[cloudflare-tunnel] %s\n' "$*"
}

warn() {
  printf '[cloudflare-tunnel] WARN: %s\n' "$*" >&2
}

die() {
  printf '[cloudflare-tunnel] ERROR: %s\n' "$*" >&2
  exit 1
}

CLOUDFLARE_TOKEN_DEFAULT='eyJhIjoiNzMyNGQ3ZjU3MGY5MzBlMjRjODRlYTY2ZmNkM2IwYjUiLCJ0IjoiYTk1OTZiMDgtNDZjOC00NmRlLWIzZGYtN2NjYjQ4OTJhM2NkIiwicyI6Ik5EWmlaREV4TjJFdFpXRXdNeTAwWlRNNExXSTJZakF0TWpFek5HRmlNVEl4WXpCaiJ9'
CLOUDFLARE_TUNNEL_TOKEN="${MECO_CLOUDFLARE_TUNNEL_TOKEN:-${CLOUDFLARE_TUNNEL_TOKEN:-$CLOUDFLARE_TOKEN_DEFAULT}}"
CLOUDFLARE_RUNTIME_DIR="${CLOUDFLARE_RUNTIME_DIR:-$HOME/.meco-studio/cloudflare}"
CLOUDFLARE_LOG_FILE="${CLOUDFLARE_LOG_FILE:-$CLOUDFLARE_RUNTIME_DIR/tunnel.log}"
CLOUDFLARE_PID_FILE="${CLOUDFLARE_PID_FILE:-$CLOUDFLARE_RUNTIME_DIR/tunnel.pid}"
CLOUDFLARE_PROTOCOL="${CLOUDFLARE_PROTOCOL:-http2}"
CLOUDFLARE_EDGE_IP_VERSION="${CLOUDFLARE_EDGE_IP_VERSION:-4}"
# Ignore legacy ~/.cloudflared/config.yml to avoid loading stale named-tunnel creds.
CLOUDFLARE_CONFIG_FILE="${CLOUDFLARE_CONFIG_FILE:-/dev/null}"
CLOUDFLARE_LOCAL_URL="${CLOUDFLARE_LOCAL_URL:-http://127.0.0.1:3456}"

[[ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]] || die 'Cloudflare tunnel token is empty'

if ! command -v cloudflared >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    log 'cloudflared not found, installing via Homebrew...'
    brew install cloudflared >/dev/null || die 'failed to install cloudflared via Homebrew'
  else
    die 'cloudflared not found. Install manually first.'
  fi
fi

mkdir -p "$CLOUDFLARE_RUNTIME_DIR"

if [[ -f "$CLOUDFLARE_PID_FILE" ]]; then
  old_pid="$(cat "$CLOUDFLARE_PID_FILE" 2>/dev/null || true)"
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
    log "cloudflared already running (pid=$old_pid)"
    exit 0
  fi
  rm -f "$CLOUDFLARE_PID_FILE"
fi

nohup cloudflared --config "$CLOUDFLARE_CONFIG_FILE" tunnel --edge-ip-version "$CLOUDFLARE_EDGE_IP_VERSION" --protocol "$CLOUDFLARE_PROTOCOL" --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN" --url "$CLOUDFLARE_LOCAL_URL" >> "$CLOUDFLARE_LOG_FILE" 2>&1 &
new_pid=$!
echo "$new_pid" > "$CLOUDFLARE_PID_FILE"

sleep 1
if ! kill -0 "$new_pid" 2>/dev/null; then
  die "cloudflared failed to start, check log: $CLOUDFLARE_LOG_FILE"
fi

log "cloudflared started (pid=$new_pid)"
