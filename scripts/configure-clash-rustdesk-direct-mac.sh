#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[clash-rustdesk-direct] %s\n' "$*"
}

warn() {
  printf '[clash-rustdesk-direct] WARN: %s\n' "$*" >&2
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  log "Skip: this script is only for macOS."
  exit 0
fi

is_clash_installed() {
  local app
  for app in "/Applications/ClashX.app" "/Applications/ClashX Pro.app" "/Applications/ClashX.Meta.app"; do
    if [[ -d "$app" ]]; then
      return 0
    fi
  done
  if pgrep -af "ClashX|ClashX Pro|ClashX.Meta" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

find_clash_config() {
  if [[ -n "${CLASH_CONFIG_PATH:-}" && -f "${CLASH_CONFIG_PATH:-}" ]]; then
    printf '%s\n' "$CLASH_CONFIG_PATH"
    return 0
  fi

  local candidates=(
    "$HOME/.config/clash/config.yaml"
    "$HOME/.config/clash/config.yml"
    "$HOME/.config/Clash/config.yaml"
    "$HOME/.config/Clash/config.yml"
    "$HOME/.config/clashx/config.yaml"
    "$HOME/.config/clashx/config.yml"
    "$HOME/Library/Application Support/io.github.clashX/config.yaml"
    "$HOME/Library/Application Support/io.github.clashX/config.yml"
  )
  local file
  for file in "${candidates[@]}"; do
    if [[ -f "$file" ]]; then
      printf '%s\n' "$file"
      return 0
    fi
  done
  return 1
}

if ! is_clash_installed; then
  log "ClashX/ClashX Pro not installed, skip RustDesk DIRECT rule patch."
  exit 0
fi

clash_config="$(find_clash_config || true)"
if [[ -z "$clash_config" ]]; then
  warn "ClashX detected but config.yaml not found. Set CLASH_CONFIG_PATH and rerun if needed."
  exit 0
fi

backup_file="${clash_config}.meco.bak.$(date +%Y%m%d%H%M%S)"
cp "$clash_config" "$backup_file"
log "Backed up Clash config: $backup_file"

node - "$clash_config" <<'NODE'
const fs = require('fs');

const configPath = process.argv[2];
const begin = '# MECO_RUSTDESK_DIRECT_BEGIN';
const end = '# MECO_RUSTDESK_DIRECT_END';
const rulesToEnsure = [
  'PROCESS-NAME,RustDesk,DIRECT',
  'PROCESS-NAME,RustDesk.exe,DIRECT',
  'DOMAIN-SUFFIX,rustdesk.com,DIRECT',
  'DOMAIN-SUFFIX,rustdesk.dev,DIRECT',
  'DOMAIN-SUFFIX,rustdesk.net,DIRECT',
  'DOMAIN-SUFFIX,rustdeskcloud.com,DIRECT',
  'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
  'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
  'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve'
];

const read = fs.readFileSync(configPath, 'utf8');
const eol = read.includes('\r\n') ? '\r\n' : '\n';
const lines = read.split(/\r?\n/);

function leadingSpaces(s) {
  const m = String(s || '').match(/^\s*/);
  return m ? m[0].length : 0;
}

const rulesIdx = lines.findIndex((line) => /^\s*rules\s*:\s*(#.*)?$/.test(line));
if (rulesIdx < 0) {
  if (lines.length > 0 && String(lines[lines.length - 1] || '').trim() !== '') {
    lines.push('');
  }
  lines.push('rules:');
  lines.push(`  ${begin}`);
  for (const rule of rulesToEnsure) lines.push(`  - ${rule}`);
  lines.push(`  ${end}`);
  fs.writeFileSync(configPath, lines.join(eol), 'utf8');
  process.stdout.write('patched:new_rules_block');
  process.exit(0);
}

const rulesIndent = leadingSpaces(lines[rulesIdx]);
let rulesEnd = lines.length;
for (let i = rulesIdx + 1; i < lines.length; i += 1) {
  const raw = lines[i];
  const trimmed = String(raw || '').trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const indent = leadingSpaces(raw);
  if (indent <= rulesIndent && /^[A-Za-z0-9_.-]+\s*:/.test(trimmed)) {
    rulesEnd = i;
    break;
  }
}

let markerStart = -1;
let markerEnd = -1;
for (let i = rulesIdx + 1; i < rulesEnd; i += 1) {
  const trimmed = String(lines[i] || '').trim();
  if (trimmed === begin) markerStart = i;
  if (markerStart >= 0 && trimmed === end) {
    markerEnd = i;
    break;
  }
}

if (markerStart >= 0 && markerEnd >= markerStart) {
  lines.splice(markerStart, markerEnd - markerStart + 1);
  rulesEnd -= (markerEnd - markerStart + 1);
}

let itemIndent = rulesIndent + 2;
for (let i = rulesIdx + 1; i < rulesEnd; i += 1) {
  if (/^\s*-\s+/.test(lines[i])) {
    itemIndent = leadingSpaces(lines[i]);
    break;
  }
}
const pad = ' '.repeat(itemIndent);
const block = [`${pad}${begin}`, ...rulesToEnsure.map((rule) => `${pad}- ${rule}`), `${pad}${end}`];

let insertAt = rulesEnd;
for (let i = rulesIdx + 1; i < rulesEnd; i += 1) {
  if (/^\s*-\s*MATCH\s*,/i.test(String(lines[i] || '').trim())) {
    insertAt = i;
    break;
  }
}

lines.splice(insertAt, 0, ...block);
fs.writeFileSync(configPath, lines.join(eol), 'utf8');
process.stdout.write('patched:updated_rules_block');
NODE

log "RustDesk DIRECT rules written to Clash config: $clash_config"
log "If ClashX is running, reload profile in ClashX/ClashX Pro to apply new rules."
