const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS_PATH = path.join(__dirname, '../data/app-settings.json');

const DEFAULT_SETTINGS = Object.freeze({
  openclawHttpUrl: 'http://127.0.0.1:18789/v1/chat/completions',
  openclawWsUrl: 'ws://127.0.0.1:18789',
  openclawGatewayToken: '',
  openclawModel: 'kimi-coding/k2p5',
  minimaxApiKey: '',
  minimaxWsUrl: 'wss://api.minimaxi.com/ws/v1/t2a_v2',
  tikhubApiKey: '',
  meowloadApiKey: '',
  kimiApiKey: '',
  ossEndpoint: 'https://oss-cn-hongkong.aliyuncs.com/',
  ossBucket: 'cfplusvideo',
  ossAccessKeyId: '',
  ossAccessKeySecret: '',
  kimiCliCommand: 'kimi',
  hotTopicsKbPath: path.join(os.homedir(), 'Documents/知识库/热门话题'),
  openaiApiKey: ''
});

const SETTINGS_FIELDS = Object.freeze(Object.keys(DEFAULT_SETTINGS));
const NON_PERSISTED_FIELDS = Object.freeze([
  'openclawHttpUrl',
  'openclawWsUrl',
  'openclawGatewayToken'
]);
const PERSISTED_FIELDS = Object.freeze(
  SETTINGS_FIELDS.filter((field) => !NON_PERSISTED_FIELDS.includes(field))
);

const ENV_MAP = Object.freeze({
  openclawHttpUrl: 'MECO_OPENCLAW_HTTP_URL',
  openclawWsUrl: 'MECO_OPENCLAW_WS_URL',
  openclawGatewayToken: 'MECO_OPENCLAW_GATEWAY_TOKEN',
  openclawModel: 'MECO_OPENCLAW_MODEL',
  minimaxApiKey: 'MECO_MINIMAX_API_KEY',
  minimaxWsUrl: 'MECO_MINIMAX_WS_URL',
  tikhubApiKey: 'TIKHUB_API_KEY',
  meowloadApiKey: 'MECO_MEOWLOAD_API_KEY',
  kimiApiKey: 'KIMI_API_KEY',
  ossEndpoint: 'MECO_OSS_ENDPOINT',
  ossBucket: 'MECO_OSS_BUCKET',
  ossAccessKeyId: 'MECO_OSS_ACCESS_KEY_ID',
  ossAccessKeySecret: 'MECO_OSS_ACCESS_KEY_SECRET',
  kimiCliCommand: 'MECO_KIMI_CLI_COMMAND',
  hotTopicsKbPath: 'HOT_TOPICS_KB_PATH',
  openaiApiKey: 'OPENAI_API_KEY'
});

function toSafeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function loadSettingsFile() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return {};
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch (e) {
    console.warn(`[Settings] Failed to read ${SETTINGS_PATH}: ${e.message}`);
    return {};
  }
}

function get(obj, keys = []) {
  let cur = obj;
  for (const key of keys) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

function discoverFromLocalFiles() {
  const discovered = {};

  try {
    const openclawConfigPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (fs.existsSync(openclawConfigPath)) {
      const conf = JSON.parse(fs.readFileSync(openclawConfigPath, 'utf8') || '{}');
      const gatewayPort = get(conf, ['gateway', 'port']);
      if (gatewayPort) {
        discovered.openclawHttpUrl = `http://127.0.0.1:${gatewayPort}/v1/chat/completions`;
        discovered.openclawWsUrl = `ws://127.0.0.1:${gatewayPort}`;
      }
      const gatewayToken = get(conf, ['gateway', 'auth', 'token']);
      if (gatewayToken) discovered.openclawGatewayToken = gatewayToken;
      const primaryModel = get(conf, ['agents', 'defaults', 'model', 'primary']);
      if (primaryModel) discovered.openclawModel = String(primaryModel);

      const providers = get(conf, ['models', 'providers']) || {};
      const kimiProvider = providers['kimi-coding'] || providers['kimi-openai'] || null;
      if (kimiProvider && kimiProvider.apiKey) {
        discovered.kimiApiKey = String(kimiProvider.apiKey);
      }
      const minimaxProvider = providers.minimax || null;
      if (minimaxProvider && minimaxProvider.apiKey) {
        discovered.minimaxApiKey = String(minimaxProvider.apiKey);
      }
    }
  } catch (e) {
    console.warn(`[Settings] local openclaw config parse failed: ${e.message}`);
  }

  try {
    const kimiConfigPath = path.join(os.homedir(), '.kimi', 'config.json');
    if (fs.existsSync(kimiConfigPath)) {
      const conf = JSON.parse(fs.readFileSync(kimiConfigPath, 'utf8') || '{}');
      if (conf.api_key) discovered.kimiApiKey = String(conf.api_key);
    }
  } catch (e) {
    console.warn(`[Settings] local kimi config parse failed: ${e.message}`);
  }

  try {
    const hotTopicsPy = path.join(os.homedir(), '.config/agents/skills/hot-topics/scripts/fetch_tweets.py');
    if (fs.existsSync(hotTopicsPy)) {
      const content = fs.readFileSync(hotTopicsPy, 'utf8');
      const m = content.match(/TIKHUB_API_KEY\s*=\s*os\.environ\.get\("TIKHUB_API_KEY",\s*"([^"]+)"\)/);
      if (m && m[1]) discovered.tikhubApiKey = m[1];
    }
  } catch (e) {
    console.warn(`[Settings] hot-topics script parse failed: ${e.message}`);
  }

  const kimiCommandCandidates = [
    path.join(os.homedir(), '.local', 'bin', 'kimi'),
    path.join(os.homedir(), '.kimi', 'bin', 'kimi'),
    '/opt/homebrew/bin/kimi',
    '/usr/local/bin/kimi'
  ];
  for (const p of kimiCommandCandidates) {
    if (fs.existsSync(p)) {
      discovered.kimiCliCommand = p;
      break;
    }
  }

  return discovered;
}

function applyEnvOverrides(base) {
  const next = { ...base };
  for (const [field, envName] of Object.entries(ENV_MAP)) {
    const envValue = process.env[envName];
    if (typeof envValue === 'string' && envValue.trim()) {
      next[field] = envValue.trim();
    }
  }
  return next;
}

function loadSettings() {
  const fromFile = loadSettingsFile();
  const discovered = discoverFromLocalFiles();

  const merged = {
    ...DEFAULT_SETTINGS,
    ...discovered,
    ...fromFile
  };

  // Always trust local OpenClaw discovery for connection fields,
  // so users never need to manually maintain URL/WS/token.
  if (discovered.openclawHttpUrl) merged.openclawHttpUrl = discovered.openclawHttpUrl;
  if (discovered.openclawWsUrl) merged.openclawWsUrl = discovered.openclawWsUrl;
  if (discovered.openclawGatewayToken) merged.openclawGatewayToken = discovered.openclawGatewayToken;

  return applyEnvOverrides(merged);
}

function getSettings() {
  return { ...loadSettings() };
}

function sanitizeIncoming(update = {}) {
  const next = {};
  if (!update || typeof update !== 'object') return next;
  for (const field of PERSISTED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(update, field)) continue;
    next[field] = toSafeString(update[field]);
  }
  return next;
}

function saveSettings(update = {}) {
  const current = loadSettings();
  const incoming = sanitizeIncoming(update);
  const merged = {
    ...current,
    ...incoming
  };

  const toWrite = {};
  for (const field of PERSISTED_FIELDS) {
    toWrite[field] = toSafeString(merged[field]);
  }

  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(toWrite, null, 2) + '\n', 'utf8');
  return getSettings();
}

function maskSecret(secret) {
  const s = toSafeString(secret);
  if (!s) return '';
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}${'*'.repeat(Math.max(4, s.length - 8))}${s.slice(-4)}`;
}

function getMaskedSettings() {
  const current = getSettings();
  return {
    ...current,
    openclawGatewayToken: maskSecret(current.openclawGatewayToken),
    minimaxApiKey: maskSecret(current.minimaxApiKey),
    tikhubApiKey: maskSecret(current.tikhubApiKey),
    meowloadApiKey: maskSecret(current.meowloadApiKey),
    kimiApiKey: maskSecret(current.kimiApiKey),
    ossAccessKeyId: maskSecret(current.ossAccessKeyId),
    ossAccessKeySecret: maskSecret(current.ossAccessKeySecret),
    openaiApiKey: maskSecret(current.openaiApiKey)
  };
}

module.exports = {
  SETTINGS_PATH,
  SETTINGS_FIELDS,
  DEFAULT_SETTINGS,
  getSettings,
  getMaskedSettings,
  saveSettings
};
