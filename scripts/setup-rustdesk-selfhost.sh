#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[rustdesk-selfhost] %s\n' "$*"
}

warn() {
  printf '[rustdesk-selfhost] WARN: %s\n' "$*" >&2
}

die() {
  printf '[rustdesk-selfhost] ERROR: %s\n' "$*" >&2
  exit 1
}

RUSTDESK_SERVER_HOME="${RUSTDESK_SERVER_HOME:-$HOME/.meco-studio/rustdesk-server}"
RUSTDESK_SERVER_BIN_DIR="${RUSTDESK_SERVER_BIN_DIR:-$RUSTDESK_SERVER_HOME/bin}"
RUSTDESK_RENDEZVOUS_HOST="${RUSTDESK_RENDEZVOUS_HOST:-127.0.0.1}"
RUSTDESK_HBBS_PORT="${RUSTDESK_HBBS_PORT:-21116}"
RUSTDESK_HBBR_PORT="${RUSTDESK_HBBR_PORT:-21117}"
RUSTDESK_WS_PORT="${RUSTDESK_WS_PORT:-21118}"
RUSTDESK_SERVER_AUTOSTART="${RUSTDESK_SERVER_AUTOSTART:-1}"
RUSTDESK_SERVER_DOWNLOAD="${RUSTDESK_SERVER_DOWNLOAD:-1}"
RUSTDESK_SERVER_RELEASE_API="${RUSTDESK_SERVER_RELEASE_API:-https://api.github.com/repos/rustdesk/rustdesk-server/releases/latest}"
RUSTDESK_CONFIG_PATH_OVERRIDE="${RUSTDESK_CONFIG_PATH_OVERRIDE:-}"

HBBS_BIN=""
HBBR_BIN=""

find_server_bins() {
  local hbbs_candidates=()
  local hbbr_candidates=()

  if command -v hbbs >/dev/null 2>&1; then
    hbbs_candidates+=("$(command -v hbbs)")
  fi
  if command -v hbbr >/dev/null 2>&1; then
    hbbr_candidates+=("$(command -v hbbr)")
  fi

  hbbs_candidates+=(
    "$RUSTDESK_SERVER_BIN_DIR/hbbs"
    "/Applications/RustDesk.app/Contents/MacOS/hbbs"
  )
  hbbr_candidates+=(
    "$RUSTDESK_SERVER_BIN_DIR/hbbr"
    "/Applications/RustDesk.app/Contents/MacOS/hbbr"
  )

  local p
  for p in "${hbbs_candidates[@]}"; do
    if [[ -x "$p" ]]; then
      HBBS_BIN="$p"
      break
    fi
  done
  for p in "${hbbr_candidates[@]}"; do
    if [[ -x "$p" ]]; then
      HBBR_BIN="$p"
      break
    fi
  done
}

pick_release_asset_url() {
  local os_name arch_name
  os_name="$(uname -s)"
  arch_name="$(uname -m)"

  curl -fsSL "$RUSTDESK_SERVER_RELEASE_API" | node -e '
    const fs = require("fs");
    const osName = String(process.argv[1] || "").toLowerCase();
    const archName = String(process.argv[2] || "").toLowerCase();
    const payload = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
    const assets = Array.isArray(payload.assets) ? payload.assets : [];

    const osRe = (() => {
      if (osName.includes("darwin")) return /(darwin|mac|osx|apple)/i;
      if (osName.includes("linux")) return /linux/i;
      return /.*/i;
    })();

    const archRe = (() => {
      if (archName.includes("arm") || archName.includes("aarch")) return /(arm64|aarch64)/i;
      if (archName.includes("x86_64") || archName.includes("amd64")) return /(x86_64|amd64|x64)/i;
      return /.*/i;
    })();

    const extRe = /(\.zip|\.tar\.gz|\.tgz)$/i;
    const scored = assets
      .filter((a) => a && typeof a === "object" && typeof a.name === "string" && typeof a.browser_download_url === "string")
      .map((a) => {
        const name = a.name;
        let score = 0;
        if (/rustdesk-server/i.test(name)) score += 50;
        if (osRe.test(name)) score += 30;
        if (archRe.test(name)) score += 30;
        if (extRe.test(name)) score += 20;
        if (/symbols|debug|sha|checksums?/i.test(name)) score -= 40;
        if (/\.zip$/i.test(name)) score += 2;
        if (/\.tar\.gz$/i.test(name) || /\.tgz$/i.test(name)) score += 1;
        return { score, name, url: a.browser_download_url };
      })
      .filter((item) => item.score >= 60)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      process.exit(1);
    }

    process.stdout.write(scored[0].url);
  ' "$os_name" "$arch_name"
}

download_server_bins() {
  [[ "$RUSTDESK_SERVER_DOWNLOAD" == "1" ]] || return 1

  mkdir -p "$RUSTDESK_SERVER_BIN_DIR"

  local tmp_dir archive asset_url
  tmp_dir="$(mktemp -d)"
  archive="$tmp_dir/rustdesk-server.pkg"

  asset_url="$(pick_release_asset_url || true)"
  if [[ -z "$asset_url" ]]; then
    warn "cannot resolve rustdesk-server release asset URL"
    rm -rf "$tmp_dir"
    return 1
  fi

  log "Downloading RustDesk server bundle: $asset_url"
  if ! curl -fL "$asset_url" -o "$archive"; then
    warn "download rustdesk-server bundle failed"
    rm -rf "$tmp_dir"
    return 1
  fi

  local extract_dir
  extract_dir="$tmp_dir/extract"
  mkdir -p "$extract_dir"

  case "$asset_url" in
    *.zip)
      if ! command -v unzip >/dev/null 2>&1; then
        warn "unzip not found, cannot extract rustdesk-server zip"
        rm -rf "$tmp_dir"
        return 1
      fi
      unzip -q "$archive" -d "$extract_dir"
      ;;
    *.tar.gz|*.tgz)
      tar -xzf "$archive" -C "$extract_dir"
      ;;
    *)
      warn "unsupported rustdesk-server archive format: $asset_url"
      rm -rf "$tmp_dir"
      return 1
      ;;
  esac

  local found_hbbs found_hbbr
  found_hbbs="$(find "$extract_dir" -type f -name 'hbbs' | head -n 1 || true)"
  found_hbbr="$(find "$extract_dir" -type f -name 'hbbr' | head -n 1 || true)"

  if [[ -z "$found_hbbs" || -z "$found_hbbr" ]]; then
    warn "downloaded package does not contain hbbs/hbbr"
    rm -rf "$tmp_dir"
    return 1
  fi

  cp "$found_hbbs" "$RUSTDESK_SERVER_BIN_DIR/hbbs"
  cp "$found_hbbr" "$RUSTDESK_SERVER_BIN_DIR/hbbr"
  chmod +x "$RUSTDESK_SERVER_BIN_DIR/hbbs" "$RUSTDESK_SERVER_BIN_DIR/hbbr"

  rm -rf "$tmp_dir"
  return 0
}

stop_running_server() {
  local pid_file pid
  for pid_file in "$RUSTDESK_SERVER_HOME/hbbs.pid" "$RUSTDESK_SERVER_HOME/hbbr.pid"; do
    [[ -f "$pid_file" ]] || continue
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    [[ -n "$pid" ]] || continue
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" >/dev/null 2>&1 || true
      sleep 1
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" >/dev/null 2>&1 || true
      fi
    fi
    rm -f "$pid_file"
  done
}

start_server() {
  mkdir -p "$RUSTDESK_SERVER_HOME/logs"

  stop_running_server

  (
    cd "$RUSTDESK_SERVER_HOME"
    nohup "$HBBR_BIN" -p "$RUSTDESK_HBBR_PORT" > "$RUSTDESK_SERVER_HOME/logs/hbbr.log" 2>&1 &
    echo $! > "$RUSTDESK_SERVER_HOME/hbbr.pid"
  )

  (
    cd "$RUSTDESK_SERVER_HOME"
    nohup "$HBBS_BIN" -p "$RUSTDESK_HBBS_PORT" -r "$RUSTDESK_RENDEZVOUS_HOST:$RUSTDESK_HBBR_PORT" > "$RUSTDESK_SERVER_HOME/logs/hbbs.log" 2>&1 &
    echo $! > "$RUSTDESK_SERVER_HOME/hbbs.pid"
  )

  sleep 1

  local hbbr_pid hbbs_pid
  hbbr_pid="$(cat "$RUSTDESK_SERVER_HOME/hbbr.pid" 2>/dev/null || true)"
  hbbs_pid="$(cat "$RUSTDESK_SERVER_HOME/hbbs.pid" 2>/dev/null || true)"

  if [[ -z "$hbbr_pid" || -z "$hbbs_pid" ]]; then
    die "failed to start hbbs/hbbr"
  fi
  if ! kill -0 "$hbbr_pid" 2>/dev/null || ! kill -0 "$hbbs_pid" 2>/dev/null; then
    die "hbbs/hbbr exited unexpectedly, check $RUSTDESK_SERVER_HOME/logs"
  fi

  cat > "$RUSTDESK_SERVER_HOME/runtime.json" <<JSON
{
  "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "hbbs": "$RUSTDESK_RENDEZVOUS_HOST:$RUSTDESK_HBBS_PORT",
  "hbbr": "$RUSTDESK_RENDEZVOUS_HOST:$RUSTDESK_HBBR_PORT",
  "ws": "$RUSTDESK_RENDEZVOUS_HOST:$RUSTDESK_WS_PORT",
  "preferredRendezvous": "$RUSTDESK_RENDEZVOUS_HOST:$RUSTDESK_HBBS_PORT,$RUSTDESK_RENDEZVOUS_HOST:$RUSTDESK_WS_PORT"
}
JSON

  log "RustDesk self-host started"
  log "hbbs=$RUSTDESK_RENDEZVOUS_HOST:$RUSTDESK_HBBS_PORT, hbbr=$RUSTDESK_RENDEZVOUS_HOST:$RUSTDESK_HBBR_PORT"
}

find_rustdesk_config_path() {
  if [[ -n "$RUSTDESK_CONFIG_PATH_OVERRIDE" ]]; then
    printf '%s\n' "$RUSTDESK_CONFIG_PATH_OVERRIDE"
    return 0
  fi

  local candidates=()
  if [[ "$(uname -s)" == "Darwin" ]]; then
    candidates+=(
      "$HOME/Library/Preferences/com.carriez.rustdesk/RustDesk2.toml"
      "$HOME/Library/Preferences/com.carriez.rustdesk/RustDesk.toml"
    )
  fi
  candidates+=(
    "$HOME/.config/rustdesk/RustDesk2.toml"
    "$HOME/.config/RustDesk/RustDesk2.toml"
  )

  local p
  for p in "${candidates[@]}"; do
    if [[ -f "$p" ]]; then
      printf '%s\n' "$p"
      return 0
    fi
  done

  if [[ "$(uname -s)" == "Darwin" ]]; then
    printf '%s\n' "$HOME/Library/Preferences/com.carriez.rustdesk/RustDesk2.toml"
  else
    printf '%s\n' "$HOME/.config/rustdesk/RustDesk2.toml"
  fi
}

configure_local_rustdesk_client() {
  local cfg_path
  cfg_path="$(find_rustdesk_config_path)"
  mkdir -p "$(dirname "$cfg_path")"
  touch "$cfg_path"

  local rendezvous_value relay_value api_value pub_key
  rendezvous_value="${RUSTDESK_RENDEZVOUS_HOST}:${RUSTDESK_HBBS_PORT}"
  relay_value="${RUSTDESK_RENDEZVOUS_HOST}:${RUSTDESK_HBBR_PORT}"
  api_value="http://${RUSTDESK_RENDEZVOUS_HOST}:21114"
  pub_key="${RUSTDESK_SERVER_PUBLIC_KEY:-}"

  if grep -Eq '^rendezvous_server\s*=' "$cfg_path"; then
    perl -0777 -i -pe "s/^rendezvous_server\\s*=\\s*.*$/rendezvous_server = '${rendezvous_value}'/m" "$cfg_path"
  else
    {
      printf "rendezvous_server = '%s'\n" "$rendezvous_value"
      cat "$cfg_path"
    } > "${cfg_path}.tmp"
    mv "${cfg_path}.tmp" "$cfg_path"
  fi

  if ! grep -Eq '^\[options\]\s*$' "$cfg_path"; then
    printf '\n[options]\n' >> "$cfg_path"
  fi

  if grep -Eq '^custom-rendezvous-server\s*=' "$cfg_path"; then
    perl -0777 -i -pe "s/^custom-rendezvous-server\\s*=\\s*.*$/custom-rendezvous-server = '${rendezvous_value}'/m" "$cfg_path"
  else
    printf "custom-rendezvous-server = '%s'\n" "$rendezvous_value" >> "$cfg_path"
  fi

  if grep -Eq '^relay-server\s*=' "$cfg_path"; then
    perl -0777 -i -pe "s/^relay-server\\s*=\\s*.*$/relay-server = '${relay_value}'/m" "$cfg_path"
  else
    printf "relay-server = '%s'\n" "$relay_value" >> "$cfg_path"
  fi

  if grep -Eq '^api-server\s*=' "$cfg_path"; then
    perl -0777 -i -pe "s|^api-server\\s*=\\s*.*$|api-server = '${api_value}'|m" "$cfg_path"
  else
    printf "api-server = '%s'\n" "$api_value" >> "$cfg_path"
  fi

  if [[ -n "$pub_key" ]]; then
    if grep -Eq '^key\s*=' "$cfg_path"; then
      perl -0777 -i -pe "s/^key\\s*=\\s*.*$/key = '${pub_key}'/m" "$cfg_path"
    else
      printf "key = '%s'\n" "$pub_key" >> "$cfg_path"
    fi
  fi

  log "Configured RustDesk client rendezvous: $rendezvous_value ($cfg_path)"
}

main() {
  mkdir -p "$RUSTDESK_SERVER_HOME" "$RUSTDESK_SERVER_BIN_DIR"

  find_server_bins
  if [[ -z "$HBBS_BIN" || -z "$HBBR_BIN" ]]; then
    log "hbbs/hbbr not found locally, trying auto download..."
    if download_server_bins; then
      find_server_bins
    fi
  fi

  [[ -n "$HBBS_BIN" ]] || die "hbbs not found; install rustdesk-server or place binary in $RUSTDESK_SERVER_BIN_DIR"
  [[ -n "$HBBR_BIN" ]] || die "hbbr not found; install rustdesk-server or place binary in $RUSTDESK_SERVER_BIN_DIR"

  log "Using hbbs: $HBBS_BIN"
  log "Using hbbr: $HBBR_BIN"
  configure_local_rustdesk_client

  if [[ "$RUSTDESK_SERVER_AUTOSTART" == "1" ]]; then
    start_server
  else
    log "Skip auto start (RUSTDESK_SERVER_AUTOSTART=$RUSTDESK_SERVER_AUTOSTART)"
  fi
}

main "$@"
