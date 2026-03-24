#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[rustdesk-permission-mac] %s\n' "$*"
}

warn() {
  printf '[rustdesk-permission-mac] WARN: %s\n' "$*" >&2
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  log "Skip: this script is only for macOS."
  exit 0
fi

RUSTDESK_APP="${RUSTDESK_APP:-/Applications/RustDesk.app}"
RUSTDESK_OPEN_SYSTEM_SETTINGS="${RUSTDESK_OPEN_SYSTEM_SETTINGS:-1}"

if [[ -d "$RUSTDESK_APP" ]]; then
  open -ga "$RUSTDESK_APP" >/dev/null 2>&1 || true
else
  warn "RustDesk app not found: $RUSTDESK_APP"
fi

if [[ "$RUSTDESK_OPEN_SYSTEM_SETTINGS" == "1" ]]; then
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture" >/dev/null 2>&1 || true
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" >/dev/null 2>&1 || true
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent" >/dev/null 2>&1 || true
fi

cat <<'MSG'
请在系统设置里确认 RustDesk 已授权：
1) 隐私与安全性 -> 屏幕录制 -> 勾选 RustDesk
2) 隐私与安全性 -> 辅助功能 -> 勾选 RustDesk
3) 隐私与安全性 -> 输入监听(如果有) -> 勾选 RustDesk
4) 第一次远控时若弹窗请求权限，点击允许

授权变更后建议重启 RustDesk 客户端。
MSG

log "RustDesk 权限引导已执行。"
