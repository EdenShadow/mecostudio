const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');

const HOT_TOPICS_CATEGORIES = [
  'AI_Tech',
  'Entertainment',
  'Military',
  'Sports',
  'Design',
  'Health',
  'Politics',
  'Technology',
  'Economy',
  'Medical',
  'Society',
  'Trending'
];

function runCommand(cmd, options = {}) {
  return new Promise((resolve, reject) => {
    exec(
      cmd,
      {
        shell: '/bin/bash',
        timeout: options.timeoutMs || 10 * 60 * 1000,
        env: options.env || process.env,
        cwd: options.cwd || process.cwd(),
        maxBuffer: 1024 * 1024 * 16
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout || '';
          error.stderr = stderr || '';
          reject(error);
          return;
        }
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      }
    );
  });
}

async function commandExists(command) {
  try {
    await runCommand(`command -v ${command}`);
    return true;
  } catch (_) {
    return false;
  }
}

function expandUserPath(inputPath) {
  const raw = String(inputPath || '').trim();
  if (!raw) return '';
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

async function resolveKimiCommandPath() {
  try {
    const { stdout } = await runCommand('command -v kimi');
    const found = String(stdout || '').trim().split('\n')[0] || '';
    if (found) return found;
  } catch (_) {}

  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'kimi'),
    path.join(os.homedir(), '.kimi', 'bin', 'kimi'),
    '/usr/local/bin/kimi',
    '/opt/homebrew/bin/kimi'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return '';
}

function syncDir(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true, force: true });
}

async function configureOpenClawKimiAuth(settings, logs) {
  const openclawModelApiKey = String(settings.openclawModelApiKey || settings.kimiApiKey || '').trim();
  if (!openclawModelApiKey) {
    logs.push('OpenClaw Model API Key is empty, skip OpenClaw kimi-code auth bootstrap');
    return;
  }
  const workspaceDir = path.join(os.homedir(), '.openclaw', 'workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const cmd = [
    'openclaw onboard',
    '--non-interactive',
    '--accept-risk',
    '--mode local',
    '--auth-choice kimi-code-api-key',
    `--kimi-code-api-key "${openclawModelApiKey.replace(/"/g, '\\"')}"`,
    '--skip-daemon',
    '--skip-skills',
    '--skip-search',
    '--skip-ui',
    '--skip-channels',
    `--workspace "${workspaceDir.replace(/"/g, '\\"')}"`
  ].join(' ');
  try {
    await runCommand(cmd, { timeoutMs: 3 * 60 * 1000 });
    logs.push('Configured OpenClaw auth via kimi-code-api-key');
  } catch (e) {
    logs.push(`OpenClaw kimi-code auth bootstrap failed, fallback to direct config: ${e.message}`);
  }
}

function configureOpenClawDefaults(settings, logs) {
  const openclawRoot = path.join(os.homedir(), '.openclaw');
  const openclawConfigPath = path.join(openclawRoot, 'openclaw.json');
  const model = String(settings.openclawModel || '').trim() || 'kimi-coding/k2p5';
  const providerKey = String(settings.openclawModelApiKey || settings.kimiApiKey || '').trim();

  fs.mkdirSync(openclawRoot, { recursive: true });

  let conf = {};
  if (fs.existsSync(openclawConfigPath)) {
    try {
      conf = JSON.parse(fs.readFileSync(openclawConfigPath, 'utf8') || '{}');
    } catch (_) {
      conf = {};
    }
  }

  if (!conf.gateway || typeof conf.gateway !== 'object') conf.gateway = {};
  if (!conf.gateway.port) conf.gateway.port = 18789;
  if (!conf.gateway.mode) conf.gateway.mode = 'local';
  if (!conf.gateway.bind) conf.gateway.bind = 'loopback';
  if (!conf.gateway.auth || typeof conf.gateway.auth !== 'object') conf.gateway.auth = {};
  if (!conf.gateway.controlUi || typeof conf.gateway.controlUi !== 'object') conf.gateway.controlUi = {};
  if (!Array.isArray(conf.gateway.controlUi.allowedOrigins) || conf.gateway.controlUi.allowedOrigins.length === 0) {
    conf.gateway.controlUi.allowedOrigins = ['*'];
  }
  if (!conf.gateway.http || typeof conf.gateway.http !== 'object') conf.gateway.http = {};
  if (!conf.gateway.http.endpoints || typeof conf.gateway.http.endpoints !== 'object') conf.gateway.http.endpoints = {};
  if (
    !conf.gateway.http.endpoints.chatCompletions ||
    typeof conf.gateway.http.endpoints.chatCompletions !== 'object' ||
    Array.isArray(conf.gateway.http.endpoints.chatCompletions)
  ) {
    conf.gateway.http.endpoints.chatCompletions = {};
  }
  conf.gateway.http.endpoints.chatCompletions.enabled = true;
  if (Object.prototype.hasOwnProperty.call(conf.gateway.http.endpoints.chatCompletions, 'images')) {
    delete conf.gateway.http.endpoints.chatCompletions.images;
  }
  if (!conf.agents || typeof conf.agents !== 'object') conf.agents = {};
  if (!conf.agents.defaults || typeof conf.agents.defaults !== 'object') conf.agents.defaults = {};
  if (!conf.agents.defaults.model || typeof conf.agents.defaults.model !== 'object') conf.agents.defaults.model = {};
  conf.agents.defaults.model.primary = model;

  if (!conf.models || typeof conf.models !== 'object') conf.models = {};
  if (!conf.models.providers || typeof conf.models.providers !== 'object') conf.models.providers = {};
  const providerId = model.includes('/') ? model.split('/')[0] : '';
  if (!conf.models.providers['kimi-coding'] || typeof conf.models.providers['kimi-coding'] !== 'object') {
    conf.models.providers['kimi-coding'] = {};
  }
  conf.models.providers['kimi-coding'].baseUrl = 'https://api.kimi.com/coding/';
  conf.models.providers['kimi-coding'].api = 'anthropic-messages';
  conf.models.providers['kimi-coding'].models = [{ id: 'k2p5', name: 'Kimi K2.5' }];
  if (providerId && providerKey) {
    if (!conf.models.providers[providerId] || typeof conf.models.providers[providerId] !== 'object') {
      conf.models.providers[providerId] = {};
    }
    conf.models.providers[providerId].apiKey = providerKey;
  }

  if (providerKey) conf.models.providers['kimi-coding'].apiKey = providerKey;

  if (conf.agents && Array.isArray(conf.agents.list)) {
    conf.agents.list = conf.agents.list.map((agent) => {
      if (!agent || typeof agent !== 'object') return agent;
      return { ...agent, model };
    });
  }

  fs.writeFileSync(openclawConfigPath, JSON.stringify(conf, null, 2) + '\n', 'utf8');
  logs.push(`Updated OpenClaw defaults (~/.openclaw/openclaw.json): model=${model}`);
}

async function ensureOpenClawGateway(logs) {
  const openclawConfigPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  let gatewayPort = 18789;
  try {
    if (fs.existsSync(openclawConfigPath)) {
      const conf = JSON.parse(fs.readFileSync(openclawConfigPath, 'utf8') || '{}');
      const configured = Number((((conf || {}).gateway || {}).port) || 0);
      if (configured > 0) gatewayPort = configured;
    }
  } catch (_) {}

  if (!(await commandExists('openclaw'))) {
    logs.push('openclaw command not found, skip gateway startup check');
    return;
  }
  try {
    await runCommand('openclaw gateway restart', { timeoutMs: 2 * 60 * 1000 });
    logs.push('OpenClaw gateway restarted');
    return;
  } catch (_) {}

  try {
    await runCommand('openclaw gateway start', { timeoutMs: 2 * 60 * 1000 });
    logs.push('OpenClaw gateway started');
  } catch (e) {
    logs.push(`OpenClaw gateway restart/start failed: ${e.message}`);
    const runtimeDir = path.join(os.homedir(), '.meco-studio', 'openclaw');
    const pidFile = path.join(runtimeDir, 'gateway.pid');
    const logFile = path.join(runtimeDir, 'gateway.log');
    fs.mkdirSync(runtimeDir, { recursive: true });
    try {
      await runCommand(
        `nohup openclaw gateway run --allow-unconfigured --bind loopback --port ${gatewayPort} >> "${logFile}" 2>&1 & echo $! > "${pidFile}"`,
        { timeoutMs: 10 * 1000 }
      );
      logs.push('OpenClaw gateway fallback started (openclaw gateway run)');
    } catch (fallbackError) {
      logs.push(`OpenClaw gateway fallback failed: ${fallbackError.message}`);
    }
  }
}

function patchKimiToml(content, apiKey) {
  const targetSections = new Set([
    'providers."managed:kimi-code"',
    'services.moonshot_search',
    'services.moonshot_fetch'
  ]);
  const lines = content.split(/\r?\n/);
  let currentSection = '';
  let sectionApiKeySet = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const secMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (secMatch) {
      currentSection = secMatch[1].trim();
      continue;
    }
    if (!targetSections.has(currentSection)) continue;
    if (/^\s*api_key\s*=/.test(line)) {
      lines[i] = `api_key = "${apiKey.replace(/"/g, '\\"')}"`;
      sectionApiKeySet[currentSection] = true;
    }
  }

  for (const section of targetSections) {
    if (sectionApiKeySet[section]) continue;
    lines.push('');
    lines.push(`[${section}]`);
    lines.push(`api_key = "${apiKey.replace(/"/g, '\\"')}"`);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

async function ensureKimiCliInstalled(logs) {
  const existing = await resolveKimiCommandPath();
  if (existing) {
    logs.push(`Kimi CLI already installed (${existing})`);
    return existing;
  }
  logs.push('Installing Kimi CLI via: curl -L code.kimi.com/install.sh | bash');
  await runCommand('curl -L code.kimi.com/install.sh | bash');
  const installed = await resolveKimiCommandPath();
  if (!installed) {
    throw new Error('Kimi CLI install finished but `kimi` command not found');
  }
  logs.push(`Kimi CLI installed (${installed})`);
  return installed;
}

function configureKimiApiKey(apiKey, logs) {
  if (!apiKey) {
    logs.push('Kimi API Key is empty, skip activation');
    return;
  }

  const kimiHome = path.join(os.homedir(), '.kimi');
  fs.mkdirSync(kimiHome, { recursive: true });

  const configJsonPath = path.join(kimiHome, 'config.json');
  const configJson = {
    api_key: apiKey,
    base_url: 'https://api.moonshot.cn/v1'
  };
  fs.writeFileSync(configJsonPath, JSON.stringify(configJson, null, 2) + '\n', 'utf8');
  logs.push('Updated ~/.kimi/config.json');

  const configTomlPath = path.join(kimiHome, 'config.toml');
  const existingToml = fs.existsSync(configTomlPath)
    ? fs.readFileSync(configTomlPath, 'utf8')
    : '';
  const patchedToml = patchKimiToml(existingToml, apiKey);
  fs.writeFileSync(configTomlPath, patchedToml + '\n', 'utf8');
  logs.push('Updated ~/.kimi/config.toml API keys');
}

function ensureHotTopicsSkill(logs) {
  const home = os.homedir();
  const configSkillsRoot = path.join(home, '.config/agents/skills');
  const target = path.join(configSkillsRoot, 'hot-topics');
  const repoRoot = path.join(__dirname, '..');
  const sources = [
    path.join(repoRoot, 'bootstrap/openclaw/skills/config/hot-topics'),
    path.join(repoRoot, 'bootstrap/openclaw/skills/openclaw/hot-topics'),
    path.join(home, '.openclaw/skills/hot-topics')
  ];

  const src = sources.find((p) => fs.existsSync(p));
  if (!src) {
    logs.push('hot-topics source not found (skip install)');
    return;
  }

  fs.mkdirSync(configSkillsRoot, { recursive: true });
  syncDir(src, target);
  logs.push(`Installed hot-topics skill to ${target}`);

  const openclawSkillTarget = path.join(home, '.openclaw/skills/hot-topics');
  fs.mkdirSync(path.dirname(openclawSkillTarget), { recursive: true });
  syncDir(target, openclawSkillTarget);
  logs.push(`Synced hot-topics skill to ${openclawSkillTarget}`);
}

function ensureOpenClawSkillByName(name, logs) {
  const repoRoot = path.join(__dirname, '..');
  const src = path.join(repoRoot, `bootstrap/openclaw/skills/openclaw/${name}`);
  if (!fs.existsSync(src)) {
    logs.push(`${name} source not found (skip sync)`);
    return;
  }
  const target = path.join(os.homedir(), `.openclaw/skills/${name}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  syncDir(src, target);
  logs.push(`Synced ${name} skill to ${target}`);
}

function ensureHotTopicsKnowledgeBase(settings, logs) {
  const configured = String(settings.hotTopicsKbPath || '').trim();
  const fallback = '~/Documents/知识库/热门话题';
  const expanded = path.resolve(expandUserPath(configured || fallback));
  const hotTopicsRoot = path.basename(expanded) === '热门话题'
    ? expanded
    : path.join(expanded, '热门话题');

  fs.mkdirSync(path.dirname(hotTopicsRoot), { recursive: true });
  if (!fs.existsSync(hotTopicsRoot)) {
    fs.mkdirSync(hotTopicsRoot, { recursive: true });
    logs.push(`Created knowledge base root: ${hotTopicsRoot}`);
  } else {
    logs.push(`Knowledge base root exists, keep existing data: ${hotTopicsRoot}`);
  }

  for (const category of HOT_TOPICS_CATEGORIES) {
    const categoryPath = path.join(hotTopicsRoot, category);
    if (fs.existsSync(categoryPath)) continue;
    fs.mkdirSync(categoryPath, { recursive: true });
    logs.push(`Created category folder: ${categoryPath}`);
  }

  return hotTopicsRoot;
}

async function ensureHotTopicsDeps(logs) {
  if (!(await commandExists('python3'))) {
    logs.push('python3 missing, skip hot-topics dependency install');
    return;
  }
  try {
    await runCommand('python3 -m pip install --user aiohttp aiofiles requests openai-whisper');
    logs.push('Installed hot-topics python dependencies');
  } catch (e) {
    logs.push(`Failed to install python deps: ${e.message}`);
  }

  if (await commandExists('whisper')) {
    logs.push('Whisper is available');
  } else {
    logs.push('Whisper command not found in PATH (package may be installed in user bin path)');
  }

  if (!(await commandExists('ffmpeg'))) {
    logs.push('ffmpeg not found; local Whisper transcription may be limited');
  }
}

async function applyAll(settings = {}) {
  const logs = [];
  await configureOpenClawKimiAuth(settings, logs);
  configureOpenClawDefaults(settings, logs);
  await ensureOpenClawGateway(logs);
  const kimiPath = await ensureKimiCliInstalled(logs);
  configureKimiApiKey(String(settings.kimiApiKey || '').trim(), logs);
  const hotTopicsRoot = ensureHotTopicsKnowledgeBase(settings, logs);
  ensureHotTopicsSkill(logs);
  ensureOpenClawSkillByName('media-downloader', logs);
  await ensureHotTopicsDeps(logs);
  return {
    ok: true,
    logs,
    settingsPatch: {
      kimiCliCommand: kimiPath || String(settings.kimiCliCommand || '').trim() || 'kimi',
      hotTopicsKbPath: hotTopicsRoot
    }
  };
}

module.exports = {
  applyAll
};
