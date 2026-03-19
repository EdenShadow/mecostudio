#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const UPDATE_STATE_PATH = path.resolve(
  process.env.MECO_UPDATE_STATE_PATH || path.join(os.homedir(), '.meco-studio', 'update-state.json')
);
const REPO_DIR = path.resolve(process.env.MECO_UPDATE_REPO_DIR || process.cwd());
const TASK_ID = String(process.env.MECO_UPDATE_TASK_ID || '').trim();
const LOCAL_VERSION_BEFORE = String(process.env.MECO_UPDATE_LOCAL_VERSION || '').trim();
const TARGET_VERSION = String(process.env.MECO_UPDATE_TARGET_VERSION || '').trim();
const REMOTE_VERSION_URL = String(process.env.MECO_UPDATE_REMOTE_VERSION_URL || '').trim();
const KIMI_COMMAND = String(process.env.MECO_UPDATE_KIMI_CMD || 'kimi').trim() || 'kimi';
const MAX_LOG_LINES = 2000;

function nowIso() {
  return new Date().toISOString();
}

function normalizeVersionString(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  return text.split(/\r?\n/)[0].trim();
}

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function readState() {
  try {
    if (!fs.existsSync(UPDATE_STATE_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(UPDATE_STATE_PATH, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeState(patch = {}) {
  const prev = readState();
  const next = { ...prev, ...patch };
  if (!Array.isArray(next.logs)) next.logs = [];
  next.logs = next.logs.slice(-MAX_LOG_LINES);
  fs.mkdirSync(path.dirname(UPDATE_STATE_PATH), { recursive: true });
  fs.writeFileSync(UPDATE_STATE_PATH, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  return next;
}

function appendLog(level, text) {
  const clean = stripAnsi(text);
  const lines = clean.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.length > 0);
  if (lines.length === 0) return;
  const current = readState();
  const logs = Array.isArray(current.logs) ? current.logs : [];
  for (const line of lines) {
    logs.push({
      ts: nowIso(),
      level: String(level || 'info'),
      text: line
    });
  }
  writeState({ logs: logs.slice(-MAX_LOG_LINES) });
}

function failTask(message) {
  const errText = String(message || 'unknown update error');
  appendLog('error', errText);
  writeState({
    status: 'failed',
    phase: 'failed',
    finishedAt: nowIso(),
    error: errText
  });
}

function readRepoVersion() {
  const filePath = path.join(REPO_DIR, 'VERSION');
  try {
    if (!fs.existsSync(filePath)) return '';
    return normalizeVersionString(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return '';
  }
}

function runCommand({ command, args, cwd, env, phase }) {
  return new Promise((resolve, reject) => {
    writeState({ status: 'running', phase: String(phase || '') });
    appendLog('info', `$ ${command} ${Array.isArray(args) ? args.join(' ') : ''}`.trim());

    const child = spawn(command, Array.isArray(args) ? args : [], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk) => {
      appendLog('info', String(chunk || ''));
    });

    child.stderr.on('data', (chunk) => {
      appendLog('warn', String(chunk || ''));
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

function buildKimiPrompt() {
  return [
    '你是 Meco Studio 的更新执行代理。',
    '请执行一次升级流程，并在输出中明确说明每一步结果：',
    `1) 阅读更新协议文件: ${path.join(REPO_DIR, 'AI-UPDATE-PROTOCOL.md')}`,
    `2) 阅读安装升级文档: ${path.join(REPO_DIR, 'MECO-STUDIO-INSTALL.md')}`,
    `3) 在项目目录执行: MECO_INSTALL_DIR="${REPO_DIR}" /bin/bash scripts/install-meco-studio.sh`,
    '4) 成功后请输出: MECO_UPDATE_SUCCESS',
    `目标版本: ${TARGET_VERSION || 'unknown'}`,
    `远端版本文件: ${REMOTE_VERSION_URL || 'unknown'}`
  ].join('\n');
}

async function main() {
  writeState({
    taskId: TASK_ID,
    status: 'running',
    phase: 'init',
    startedAt: nowIso(),
    finishedAt: '',
    localVersionBefore: LOCAL_VERSION_BEFORE,
    localVersionAfter: '',
    targetVersion: TARGET_VERSION,
    remoteVersion: TARGET_VERSION,
    workerPid: process.pid,
    error: '',
    logs: []
  });

  appendLog('info', `Update worker started (pid=${process.pid})`);
  appendLog('info', `Repo dir: ${REPO_DIR}`);
  appendLog('info', `Target version: ${TARGET_VERSION || 'unknown'}`);

  const kimiPrompt = buildKimiPrompt();
  await runCommand({
    command: KIMI_COMMAND,
    args: ['--print', '--yolo', '--prompt', kimiPrompt],
    cwd: REPO_DIR,
    env: { ...process.env },
    phase: 'kimi_update'
  });

  await runCommand({
    command: '/bin/bash',
    args: ['scripts/install-meco-studio.sh'],
    cwd: REPO_DIR,
    env: {
      ...process.env,
      MECO_INSTALL_DIR: REPO_DIR
    },
    phase: 'installer_update'
  });

  const localVersionAfter = readRepoVersion() || TARGET_VERSION || '';
  appendLog('info', `Update completed: version=${localVersionAfter || 'unknown'}`);
  writeState({
    status: 'succeeded',
    phase: 'done',
    finishedAt: nowIso(),
    error: '',
    localVersionAfter
  });
}

main().catch((err) => {
  failTask(err && err.message ? err.message : 'update worker failed');
  process.exitCode = 1;
});
