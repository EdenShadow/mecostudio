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
  const kimiPath = await ensureKimiCliInstalled(logs);
  configureKimiApiKey(String(settings.kimiApiKey || '').trim(), logs);
  ensureHotTopicsKnowledgeBase(settings, logs);
  ensureHotTopicsSkill(logs);
  await ensureHotTopicsDeps(logs);
  return {
    ok: true,
    logs,
    settingsPatch: {
      kimiCliCommand: kimiPath || String(settings.kimiCliCommand || '').trim() || 'kimi'
    }
  };
}

module.exports = {
  applyAll
};
