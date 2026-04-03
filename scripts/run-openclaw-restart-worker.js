#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const RESTART_STATE_PATH = path.resolve(
  process.env.MECO_OC_RESTART_STATE_PATH || path.join(os.homedir(), '.meco-studio', 'openclaw-restart-state.json')
);
const REPO_DIR = path.resolve(process.env.MECO_OC_RESTART_REPO_DIR || process.cwd());
const TASK_ID = String(process.env.MECO_OC_RESTART_TASK_ID || '').trim();
const KIMI_COMMAND = String(process.env.MECO_OC_RESTART_KIMI_CMD || 'kimi').trim() || 'kimi';
const MAX_LOG_LINES = 2000;

function nowIso() {
  return new Date().toISOString();
}

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function readState() {
  try {
    if (!fs.existsSync(RESTART_STATE_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(RESTART_STATE_PATH, 'utf-8'));
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
  fs.mkdirSync(path.dirname(RESTART_STATE_PATH), { recursive: true });
  fs.writeFileSync(RESTART_STATE_PATH, JSON.stringify(next, null, 2) + '\n', 'utf-8');
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
  const errText = String(message || 'unknown openclaw restart error');
  appendLog('error', errText);
  writeState({
    status: 'failed',
    phase: 'failed',
    finishedAt: nowIso(),
    error: errText
  });
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
    '你是 Meco Studio 的运维执行代理。',
    '请在当前项目目录执行一次 OpenClaw 与 Gateway 重启动作，并输出关键日志：',
    '1) 执行: openclaw --version',
    '2) 执行: openclaw gateway restart',
    '3) 执行: openclaw gateway probe',
    '4) 若 probe 失败，再执行: openclaw doctor --repair',
    '5) 成功后输出: MECO_OPENCLAW_RESTART_SUCCESS'
  ].join('\n');
}

async function main() {
  writeState({
    taskId: TASK_ID,
    status: 'running',
    phase: 'init',
    startedAt: nowIso(),
    finishedAt: '',
    workerPid: process.pid,
    error: '',
    logs: []
  });

  appendLog('info', `OpenClaw restart worker started (pid=${process.pid})`);
  appendLog('info', `Repo dir: ${REPO_DIR}`);

  const kimiPrompt = buildKimiPrompt();
  await runCommand({
    command: KIMI_COMMAND,
    args: ['--print', '--yolo', '--prompt', kimiPrompt],
    cwd: REPO_DIR,
    env: { ...process.env },
    phase: 'kimi_restart'
  });

  await runCommand({
    command: 'openclaw',
    args: ['gateway', 'restart'],
    cwd: REPO_DIR,
    env: { ...process.env },
    phase: 'gateway_restart'
  });

  await runCommand({
    command: 'openclaw',
    args: ['gateway', 'probe'],
    cwd: REPO_DIR,
    env: { ...process.env },
    phase: 'gateway_probe'
  });

  appendLog('info', 'OpenClaw / Gateway restart completed');
  writeState({
    status: 'succeeded',
    phase: 'done',
    finishedAt: nowIso(),
    error: ''
  });
}

main().catch((err) => {
  failTask(err && err.message ? err.message : 'openclaw restart worker failed');
  process.exitCode = 1;
});
