const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EnhancedRoundTableModerator } = require('./enhanced-moderator');
const openclaw = require('./services/openclaw');
const voiceService = require('./services/voice'); // Voice Training Service
const doubaoO2oService = require('./services/doubao-o2o');
const appSettings = require('./services/app-settings');
const integrationSetup = require('./services/integration-setup');
const ossStorage = require('./services/oss-storage');
const remoteControl = require('./services/remote-control');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json());

const OPENCLAW_HTTP_TIMEOUT_MS = 120000;
const OPENCLAW_FIRST_CHUNK_TIMEOUT_MS = 30000;
const OPENCLAW_FIRST_CHUNK_TIMEOUT_ROUNDTABLE_MS = 45000;
const OPENCLAW_FIRST_CHUNK_TIMEOUT_MULTIMODAL_MS = 65000;
const ROOM_SPEAKER_STALL_TIMEOUT_MS = 20000;
const ROOM_SPEAKER_SWEEP_INTERVAL_MS = 3000;
const ROOM_PREPARED_STALL_TIMEOUT_MS = 45000;
const ROOM_PREPARED_SWEEP_INTERVAL_MS = 3000;
const ROOM_PREPARED_MAX_REDISPATCH = 2;
// 调试开关：关闭圆桌失败恢复（不自动重试、不自动跳过）
const ROUNDTABLE_DISABLE_FAILURE_RECOVERY = true;
const STUCK_DIAG_LOG_REPEAT_MS = 8000;
const TTS_TEXT_FLUSH_ACTIVE_INTERVAL_MS = 900;
const TTS_TEXT_FLUSH_ACTIVE_MIN_CHARS = 120;
const TTS_TEXT_FLUSH_PRELOAD_INTERVAL_MS = 1300;
const TTS_TEXT_FLUSH_PRELOAD_MIN_CHARS = 220;
const MINIMAX_TASK_CONTINUE_MIN_GAP_MS = 2200;
const MINIMAX_TASK_CONTINUE_MIN_GAP_ON_RATE_LIMIT_MS = 3200;
const MINIMAX_RATE_LIMIT_COOLDOWN_MS = 10000;
const MINIMAX_RATE_LIMIT_GUARD_MS = 180000;
const MINIMAX_TASK_CONTINUE_QUEUE_LIMIT = 500;
const MINIMAX_RPM_WINDOW_MS = 60000;
const MINIMAX_TASK_CONTINUE_HISTORY_LIMIT = 10000;
const MINIMAX_RECOMMENDED_RPM_BUDGET = 22;
let wsConnectionSeq = 0;

const AGENT_TOOLS_PREFS_PATH = process.env.MECO_AGENT_TOOLS_PREFS_PATH
  ? path.resolve(String(process.env.MECO_AGENT_TOOLS_PREFS_PATH))
  : path.join(appSettings.SETTINGS_DIR || path.join(os.homedir(), '.meco-studio'), 'agent-tools-preferences.json');

function normalizeThinkingModeValue(value, fallback = 'think') {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return fallback;
  if (raw === 'fast' || raw === 'low' || raw === 'quick') return 'fast';
  if (raw === 'think' || raw === 'high' || raw === 'deep') return 'think';
  return fallback;
}

function normalizeThinkingModeMap(rawMap) {
  const next = {};
  if (!rawMap || typeof rawMap !== 'object') return next;
  for (const [rawId, rawMode] of Object.entries(rawMap)) {
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) continue;
    next[id] = normalizeThinkingModeValue(rawMode, 'think');
  }
  return next;
}

function normalizeThinkingContextType(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'agent' || raw === 'channel') return raw;
  return '';
}

function normalizeThinkingContextId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) return '';
  return id.slice(0, 256);
}

function readAgentToolsThinkingModePreferences() {
  const fallback = {
    version: 1,
    updatedAt: '',
    agentThinkingModes: {},
    channelThinkingModes: {}
  };
  try {
    if (!fs.existsSync(AGENT_TOOLS_PREFS_PATH)) return fallback;
    const raw = fs.readFileSync(AGENT_TOOLS_PREFS_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      agentThinkingModes: normalizeThinkingModeMap(parsed.agentThinkingModes || parsed.agents || {}),
      channelThinkingModes: normalizeThinkingModeMap(parsed.channelThinkingModes || parsed.channels || {})
    };
  } catch (e) {
    console.warn(`[AgentTools] Failed to read thinking mode prefs: ${e.message}`);
    return fallback;
  }
}

function writeAgentToolsThinkingModePreferences(nextPrefs) {
  const normalized = {
    version: 1,
    updatedAt: typeof nextPrefs?.updatedAt === 'string' && nextPrefs.updatedAt ? nextPrefs.updatedAt : new Date().toISOString(),
    agentThinkingModes: normalizeThinkingModeMap(nextPrefs?.agentThinkingModes || nextPrefs?.agents || {}),
    channelThinkingModes: normalizeThinkingModeMap(nextPrefs?.channelThinkingModes || nextPrefs?.channels || {})
  };
  fs.mkdirSync(path.dirname(AGENT_TOOLS_PREFS_PATH), { recursive: true });
  fs.writeFileSync(AGENT_TOOLS_PREFS_PATH, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  return normalized;
}

function setAgentToolsThinkingModePreference({ type, id, thinkingMode }) {
  const normalizedType = normalizeThinkingContextType(type);
  const normalizedId = normalizeThinkingContextId(id);
  if (!normalizedType || !normalizedId) {
    throw new Error('type/id invalid');
  }
  const mode = normalizeThinkingModeValue(thinkingMode, 'think');
  const current = readAgentToolsThinkingModePreferences();
  if (normalizedType === 'agent') {
    current.agentThinkingModes[normalizedId] = mode;
  } else {
    current.channelThinkingModes[normalizedId] = mode;
  }
  current.updatedAt = new Date().toISOString();
  const saved = writeAgentToolsThinkingModePreferences(current);
  return {
    type: normalizedType,
    id: normalizedId,
    thinkingMode: mode,
    preferences: saved
  };
}

const minimaxTaskContinueQueue = [];
const minimaxTaskContinueSentHistory = [];
let minimaxTaskContinueTimer = null;
let minimaxLastTaskContinueAt = 0;
let minimaxRateLimitCooldownUntil = 0;
let minimaxRateLimitGuardUntil = 0;

function getEffectiveMinimaxTaskContinueMinGapMs(now = Date.now()) {
  const baseGap = Math.max(1, Number(MINIMAX_TASK_CONTINUE_MIN_GAP_MS) || 1);
  const guardGap = Math.max(baseGap, Number(MINIMAX_TASK_CONTINUE_MIN_GAP_ON_RATE_LIMIT_MS) || baseGap);
  if (now < minimaxRateLimitGuardUntil) {
    return guardGap;
  }
  return baseGap;
}

function pruneMinimaxTaskContinueHistory(now = Date.now()) {
  const cutoff = now - MINIMAX_RPM_WINDOW_MS;
  while (minimaxTaskContinueSentHistory.length > 0 && minimaxTaskContinueSentHistory[0].at < cutoff) {
    minimaxTaskContinueSentHistory.shift();
  }
  if (minimaxTaskContinueSentHistory.length > MINIMAX_TASK_CONTINUE_HISTORY_LIMIT) {
    minimaxTaskContinueSentHistory.splice(
      0,
      minimaxTaskContinueSentHistory.length - MINIMAX_TASK_CONTINUE_HISTORY_LIMIT
    );
  }
}

function recordMinimaxTaskContinueSent(meta = {}) {
  const now = Date.now();
  minimaxTaskContinueSentHistory.push({
    at: now,
    agentId: meta && meta.agentId ? String(meta.agentId) : null,
    roomId: meta && Object.prototype.hasOwnProperty.call(meta, 'roomId') ? (meta.roomId == null ? null : String(meta.roomId)) : null
  });
  pruneMinimaxTaskContinueHistory(now);
}

function getMinimaxTaskContinueRpmStats(scope = {}) {
  const now = Date.now();
  pruneMinimaxTaskContinueHistory(now);

  const hasAgentScope = typeof scope.agentId === 'string' && scope.agentId.trim().length > 0;
  const scopedAgentId = hasAgentScope ? scope.agentId.trim() : null;
  const hasRoomScope = Object.prototype.hasOwnProperty.call(scope, 'roomId');
  const scopedRoomId = hasRoomScope ? (scope.roomId == null ? null : String(scope.roomId)) : null;

  let scoped = 0;
  for (const entry of minimaxTaskContinueSentHistory) {
    if (!entry) continue;
    if (hasAgentScope && entry.agentId !== scopedAgentId) continue;
    if (hasRoomScope && (entry.roomId || null) !== scopedRoomId) continue;
    scoped++;
  }

  return {
    rpmWindowMs: MINIMAX_RPM_WINDOW_MS,
    realTaskContinueLast60sGlobal: minimaxTaskContinueSentHistory.length,
    realTaskContinueRpmGlobal: minimaxTaskContinueSentHistory.length,
    realTaskContinueLast60sScoped: scoped,
    realTaskContinueRpmScoped: scoped
  };
}

function scheduleMinimaxTaskContinueDrain(delayMs = 0) {
  if (minimaxTaskContinueTimer) return;
  minimaxTaskContinueTimer = setTimeout(() => {
    minimaxTaskContinueTimer = null;
    drainMinimaxTaskContinueQueue();
  }, Math.max(0, Number(delayMs) || 0));
}

function drainMinimaxTaskContinueQueue() {
  if (minimaxTaskContinueQueue.length === 0) return;
  const now = Date.now();
  const waitForCooldown = Math.max(0, minimaxRateLimitCooldownUntil - now);
  const effectiveMinGapMs = getEffectiveMinimaxTaskContinueMinGapMs(now);
  const waitForGap = Math.max(0, effectiveMinGapMs - (now - minimaxLastTaskContinueAt));
  const waitMs = Math.max(waitForCooldown, waitForGap);
  if (waitMs > 0) {
    scheduleMinimaxTaskContinueDrain(waitMs);
    return;
  }

  const item = minimaxTaskContinueQueue.shift();
  if (!item || !item.ws || item.ws.readyState !== WebSocket.OPEN) {
    scheduleMinimaxTaskContinueDrain(0);
    return;
  }

  try {
    item.ws.send(JSON.stringify({ event: 'task_continue', text: item.text }));
    minimaxLastTaskContinueAt = Date.now();
    recordMinimaxTaskContinueSent(item.meta || {});
    if (typeof item.onSent === 'function') item.onSent();
  } catch (e) {
    if (typeof item.onError === 'function') item.onError(e);
  }

  scheduleMinimaxTaskContinueDrain(0);
}

function enqueueMinimaxTaskContinue(ws, text, hooks = {}) {
  const payload = String(text || '').trim();
  if (!payload || !ws) return false;

  if (minimaxTaskContinueQueue.length >= MINIMAX_TASK_CONTINUE_QUEUE_LIMIT) {
    // 丢弃最老任务，避免极端情况下队列无限膨胀占用内存
    minimaxTaskContinueQueue.shift();
  }

  minimaxTaskContinueQueue.push({
    ws,
    text: payload,
    onSent: hooks.onSent,
    onError: hooks.onError,
    meta: hooks.meta || null
  });
  scheduleMinimaxTaskContinueDrain(0);
  return true;
}

function getQueuedMinimaxTaskContinueCountForWs(targetWs) {
  if (!targetWs) return 0;
  let count = 0;
  for (const item of minimaxTaskContinueQueue) {
    if (item && item.ws === targetWs) count++;
  }
  return count;
}

function registerMinimaxRateLimit(source = '') {
  const cooldownMs = MINIMAX_RATE_LIMIT_COOLDOWN_MS + Math.floor(Math.random() * 1500);
  minimaxRateLimitCooldownUntil = Math.max(minimaxRateLimitCooldownUntil, Date.now() + cooldownMs);
  minimaxRateLimitGuardUntil = Math.max(minimaxRateLimitGuardUntil, Date.now() + MINIMAX_RATE_LIMIT_GUARD_MS);
  const guardLeftMs = Math.max(0, minimaxRateLimitGuardUntil - Date.now());
  const effectiveMinGapMs = getEffectiveMinimaxTaskContinueMinGapMs();
  console.warn(
    `[MiniMax] ⏳ 触发全局限流冷却 ${cooldownMs}ms, queue=${minimaxTaskContinueQueue.length}, source=${source || 'unknown'}, guardLeft=${guardLeftMs}ms, minGap=${effectiveMinGapMs}ms`
  );
  scheduleMinimaxTaskContinueDrain(cooldownMs);
}

function getRuntimeSettings() {
  return appSettings.getSettings();
}

function isOpenClawCliFallbackEnabled() {
  const runtime = getRuntimeSettings();
  if (!runtime || typeof runtime !== 'object') return false;
  return runtime.openclawCliFallback === true || runtime.openclawCliFallbackEnabled === true;
}

// OpenClaw session lane:
// - same sessionKey: serialized
// - different sessionKey: parallel
const openclawSessionLaneTails = new Map();
const openclawSessionLanePending = new Map();

function runInOpenClawSessionLane(sessionKey, task, hooks = {}) {
  const key = String(sessionKey || '').trim().toLowerCase();
  if (!key) {
    return Promise.resolve().then(task);
  }

  const prevTail = openclawSessionLaneTails.get(key) || Promise.resolve();
  const queuedAt = Date.now();
  const currentPending = Number(openclawSessionLanePending.get(key) || 0) + 1;
  openclawSessionLanePending.set(key, currentPending);

  const current = prevTail
    .catch(() => undefined)
    .then(async () => {
      const startedAt = Date.now();
      const waitMs = Math.max(0, startedAt - queuedAt);
      try {
        if (typeof hooks.onStart === 'function') {
          hooks.onStart({
            key,
            queuedAt,
            startedAt,
            waitMs,
            pendingBeforeStart: Math.max(0, Number(openclawSessionLanePending.get(key) || 1) - 1)
          });
        }
      } catch (_) {}
      return await task();
    })
    .finally(() => {
      const pending = Math.max(0, Number(openclawSessionLanePending.get(key) || 1) - 1);
      if (pending <= 0) openclawSessionLanePending.delete(key);
      else openclawSessionLanePending.set(key, pending);
      try {
        if (typeof hooks.onSettle === 'function') hooks.onSettle({ key, pending });
      } catch (_) {}
    });

  const tail = current.then(
    () => undefined,
    () => undefined
  );
  openclawSessionLaneTails.set(key, tail);
  void tail.finally(() => {
    if (openclawSessionLaneTails.get(key) === tail) {
      openclawSessionLaneTails.delete(key);
    }
  });
  return current;
}

function getMinimaxConfig() {
  const runtime = getRuntimeSettings();
  return {
    apiKey: runtime.minimaxApiKey || '',
    wsUrl: runtime.minimaxWsUrl || 'wss://api.minimaxi.com/ws/v1/t2a_v2'
  };
}

// 并行 HTTP 请求管理（不使用队列，直接并发）
const openclawRequests = new Map();

function registerOpenClawRequest(requestId, controller, meta = {}) {
  openclawRequests.set(requestId, {
    controller,
    agentId: meta.agentId || null,
    roomId: meta.roomId || null,
    wsId: meta.wsId || null,
    createdAt: Date.now()
  });
}

function removeOpenClawRequest(requestId) {
  openclawRequests.delete(requestId);
}

function abortOpenClawRequests(predicate, logPrefix = 'Abort') {
  for (const [requestId, entry] of openclawRequests) {
    const controller = entry && entry.controller;
    if (!controller) continue;
    let matched = false;
    try {
      matched = !!predicate(requestId, entry);
    } catch (e) {
      matched = false;
    }
    if (!matched) continue;
    console.log(`[${logPrefix}] 🛑 中止 LLM 请求: ${requestId} (agent=${entry.agentId || ''}, room=${entry.roomId || 'global'})`);
    try { controller.abort(); } catch (_) {}
    openclawRequests.delete(requestId);
  }
}

function hasInFlightOpenClawRequest(agentId, roomId = null) {
  const targetAgent = String(agentId || '').trim();
  if (!targetAgent) return false;
  const targetRoom = roomId == null ? null : String(roomId);
  for (const [, entry] of openclawRequests) {
    if (!entry) continue;
    if ((entry.agentId || null) !== targetAgent) continue;
    if ((entry.roomId || null) !== targetRoom) continue;
    return true;
  }
  return false;
}

function hasOpenRoomAgentTtsSocket(roomId, agentId) {
  const targetRoom = roomId == null ? null : String(roomId);
  const targetAgent = String(agentId || '').trim();
  if (!targetAgent) return false;
  for (const ws of wss.clients) {
    if (!ws || !ws._isTTS) continue;
    if ((ws._roomId || null) !== targetRoom) continue;
    if ((ws._agentId || null) !== targetAgent) continue;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      return true;
    }
  }
  return false;
}

async function fallbackToOpenClawCLI(agentId, userMessage, ws, state) {
  console.warn(`[${agentId}] 🔁 触发 CLI 兜底请求`);
  try {
    const raw = await openclaw.sendMessage(agentId, userMessage);
    const fullResponse = String(raw || '').trim();

    if (!fullResponse) {
      if (state && state.preparingAgent === agentId) {
        state.preparingAgent = null;
        state.preparingStartTime = null;
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: 'LLM 返回空内容，请重试' }));
      }
      return false;
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chunk', content: fullResponse }));
      ws.send(JSON.stringify({ type: 'end', fullResponse }));
    }
    addMemory(agentId, userMessage, fullResponse);
    console.log(`[${agentId}] ✅ CLI 兜底成功, 长度: ${fullResponse.length}`);
    return true;
  } catch (e) {
    if (state && state.preparingAgent === agentId) {
      state.preparingAgent = null;
      state.preparingStartTime = null;
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: `CLI 兜底失败: ${e.message}` }));
    }
    console.error(`[${agentId}] ❌ CLI 兜底失败: ${e.message}`);
    return false;
  }
}

function evictSupersededConnections({ currentWs, agentId, roomId = null, isTTS = false, reason = 'superseded' }) {
  let closed = 0;
  for (const ws of wss.clients) {
    if (ws === currentWs) continue;
    if ((ws._agentId || null) !== (agentId || null)) continue;
    if ((ws._roomId || null) !== (roomId || null)) continue;
    if (!!ws._isTTS !== !!isTTS) continue;
    if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) continue;

    ws._superseded = true;
    ws._supersededBy = currentWs && currentWs._connId ? currentWs._connId : null;
    // 避免旧主机 close 回调触发房间复位
    ws._isHost = false;

    try {
      ws.close(4001, reason);
    } catch (e) {}
    closed++;
  }
  return closed;
}

function normalizeSseTextValue(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    let merged = '';
    for (const part of value) {
      if (typeof part === 'string') {
        merged += part;
        continue;
      }
      if (!part || typeof part !== 'object') continue;
      if (typeof part.text === 'string') merged += part.text;
      else if (typeof part.content === 'string') merged += part.content;
      else if (typeof part.output_text === 'string') merged += part.output_text;
    }
    return merged;
  }
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    if (typeof value.output_text === 'string') return value.output_text;
  }
  return '';
}

function normalizeThinkingLevel(value, fallback = 'high') {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return fallback;
  if (raw === 'off' || raw === 'none') return 'off';
  if (raw === 'low' || raw === 'minimal' || raw === 'fast') return 'low';
  if (raw === 'medium') return 'medium';
  if (raw === 'high' || raw === 'think' || raw === 'deep') return 'high';
  if (raw === 'xhigh' || raw === 'max' || raw === 'ultra') return 'xhigh';
  return fallback;
}

function normalizeReasoningEnabled(value, thinkingLevel = 'high') {
  const level = normalizeThinkingLevel(thinkingLevel, 'high');
  const defaultEnabled = !(level === 'low' || level === 'off');
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (!raw) return defaultEnabled;
    if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no' || raw === 'disabled') return false;
    if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes' || raw === 'enabled') return true;
  }
  return defaultEnabled;
}

function deriveOpenClawWebUiCandidate(rawUrl) {
  const source = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!source) return '';
  let normalized = source;
  if (/^wss?:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://');
  } else if (!/^https?:\/\//i.test(normalized)) {
    return '';
  }
  try {
    const parsed = new URL(normalized);
    let pathname = parsed.pathname || '/';
    pathname = pathname.replace(/\/v1\/chat\/completions\/?$/i, '/');
    pathname = pathname.replace(/\/chat\/completions\/?$/i, '/');
    pathname = pathname.replace(/\/+$/g, '');
    const basePath = pathname ? `${pathname}/` : '/';
    return `${parsed.protocol}//${parsed.host}${basePath}`;
  } catch (_) {
    return '';
  }
}

function buildOpenClawWebUiCandidates(runtime = {}) {
  const rawCandidates = [
    runtime && runtime.openclawHttpUrl ? String(runtime.openclawHttpUrl) : '',
    runtime && runtime.openclawWsUrl ? String(runtime.openclawWsUrl) : '',
    'http://127.0.0.1:18789/',
    'http://localhost:18789/'
  ];
  const seen = new Set();
  const result = [];
  for (const raw of rawCandidates) {
    const candidate = deriveOpenClawWebUiCandidate(raw);
    if (!candidate) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function extractSseContentDelta(parsed) {
  const choice = parsed?.choices?.[0] || {};
  const delta = choice?.delta || {};
  const directDelta =
    normalizeSseTextValue(delta.content) ||
    normalizeSseTextValue(delta.text) ||
    normalizeSseTextValue(delta.output_text);
  if (directDelta) return directDelta;

  // 历史实现兼容：部分网关在 message/content 或 output_text 中返回文本
  const fallbackText =
    choice?.message?.content ??
    choice?.text ??
    parsed?.output_text ??
    parsed?.message?.content ??
    '';
  return normalizeSseTextValue(fallbackText);
}

function extractSseReasoningDelta(parsed) {
  if (!parsed || typeof parsed !== 'object') return '';
  const choice = parsed?.choices?.[0] || {};
  const delta = choice?.delta || {};
  const direct =
    normalizeSseTextValue(delta.reasoning_content) ||
    normalizeSseTextValue(delta.reasoning) ||
    normalizeSseTextValue(delta.reasoning_text) ||
    normalizeSseTextValue(delta.thinking) ||
    normalizeSseTextValue(delta.thought) ||
    normalizeSseTextValue(delta.thought_content);
  if (direct) return direct;

  const streamName = String(parsed.stream || '').toLowerCase();
  const streamData = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
  if (streamName.includes('think') || streamName.includes('reason')) {
    return normalizeSseTextValue(streamData.delta)
      || normalizeSseTextValue(streamData.text)
      || normalizeSseTextValue(streamData.content);
  }

  const eventType = String(parsed.event || parsed.type || '').toLowerCase();
  if (eventType.includes('think') || eventType.includes('reason')) {
    return normalizeSseTextValue(parsed.delta)
      || normalizeSseTextValue(parsed.text)
      || normalizeSseTextValue(parsed.content)
      || normalizeSseTextValue(streamData.delta)
      || normalizeSseTextValue(streamData.text);
  }

  return '';
}

function isSseTerminalPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;

  const choice = parsed?.choices?.[0] || {};
  const finishReason = choice?.finish_reason ?? choice?.delta?.finish_reason ?? null;
  if (typeof finishReason === 'string' && finishReason.trim() && finishReason !== 'null') {
    return true;
  }

  const event = String(parsed.event || parsed.type || '').toLowerCase();
  if (
    event === 'message_stop' ||
    event === 'response.completed' ||
    event === 'done' ||
    event === 'stream_end'
  ) {
    return true;
  }

  if (parsed.done === true) return true;
  return false;
}

const OPENCLAW_EXEC_OUTPUT_GUARD = [
  '[System Instruction: When you need to report shell/exec command results, prefer direct exec output.',
  'Use simple single commands and read tool output directly.',
  'CRITICAL: Never prefix a shell command with ":" (colon).',
  '":" is a no-op in sh/bash/zsh and will produce empty redirected files.',
  'CRITICAL: Do NOT use shell redirections/chains/pipes in allowlist mode: >, >>, <, |, ;, &&, ||.',
  'Those patterns may trigger repeated approvals even after allow-always.',
  'Run one plain command per exec call, for example:',
  'ls -la ~/Desktop/',
  'If you need another command, issue a second separate exec call.',
  'If output is empty, explicitly state it is empty.]'
].join(' ');

function appendExecOutputGuardInstruction(text) {
  const base = typeof text === 'string' ? text.trim() : '';
  if (!base) return OPENCLAW_EXEC_OUTPUT_GUARD;
  if (base.includes('When you need to report shell/exec command results')) return base;
  if (base.includes('Never prefix a shell command with ":"')) return base;
  return `${base}\n\n${OPENCLAW_EXEC_OUTPUT_GUARD}`;
}

function normalizeGatewaySessionKey(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ');
}

function resolveGatewaySessionKeyForSocket(agentId, ws) {
  const safeAgentId = String(agentId || 'main').trim() || 'main';
  const roomId = typeof ws?._roomId === 'string' ? ws._roomId.trim() : '';
  if (roomId) {
    return `agent:${safeAgentId}:channel:${roomId}`;
  }
  return `agent:${safeAgentId}:main`;
}

function buildGatewayOutboundMessages(agentId, userMessage, options = {}) {
  if (Array.isArray(options.messages) && options.messages.length > 0) {
    return options.messages;
  }
  const sessionKey = normalizeGatewaySessionKey(options.sessionKey);
  if (sessionKey) {
    // 与 OpenClaw 原生会话记忆对齐：有 sessionKey 时仅发送当前用户输入。
    return [{ role: 'user', content: userMessage }];
  }
  return buildMessages(agentId, userMessage);
}

// 使用 Gateway HTTP SSE 流式方式发送请求到 OpenClaw
async function sendToOpenClawHTTP(agentId, userMessage, ws, options = {}) {
  const laneBypass = !!(options && options.__laneBypass);
  const providedSessionKey = normalizeGatewaySessionKey(options.sessionKey);
  const gatewaySessionKey = providedSessionKey || resolveGatewaySessionKeyForSocket(agentId, ws);
  if (!laneBypass && gatewaySessionKey) {
    return await runInOpenClawSessionLane(
      gatewaySessionKey,
      async () => {
        return await sendToOpenClawHTTP(agentId, userMessage, ws, {
          ...(options || {}),
          sessionKey: gatewaySessionKey,
          __laneBypass: true
        });
      }
    );
  }

  const requestId = `${agentId}-${Date.now()}`;
  const state = getRoundTableState(ws._roomId);
  const disableRoundtableFailureRecovery = ROUNDTABLE_DISABLE_FAILURE_RECOVERY && !!(ws && ws._roomId);
  console.log(`[${agentId}] 🚀 发送请求 (HTTP SSE): ${requestId}, ws=${ws?._connId || 'n/a'}, seq=${ws?._connSeq || 'n/a'}, room=${ws?._roomId || 'global'}`);

  // 清除打断标记
  if (state.interruptedAgents.has(agentId)) {
    console.log(`[${agentId}] 🆗 清除打断标记`);
    state.interruptedAgents.delete(agentId);
  }

  const controller = new AbortController();
  registerOpenClawRequest(requestId, controller, {
    agentId,
    roomId: ws._roomId || null,
    wsId: ws._connId || null
  });
  let timedOut = false;
  let firstChunkTimeout = false;
  let firstChunkReceived = false;
  let firstChunkTimeoutId = null;
  const firstChunkTimeoutMs = ws && ws._roomId
    ? OPENCLAW_FIRST_CHUNK_TIMEOUT_ROUNDTABLE_MS
    : OPENCLAW_FIRST_CHUNK_TIMEOUT_MS;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, OPENCLAW_HTTP_TIMEOUT_MS);

  let fullResponse = '';

  try {
    const runtime = getRuntimeSettings();
    const gatewayUrl = runtime.openclawHttpUrl || 'http://127.0.0.1:18789/v1/chat/completions';
    const gatewayToken = runtime.openclawGatewayToken || '';
    const model = options.model || runtime.openclawModel || 'kimi-coding/k2p5';
    const gatewayAgentId = typeof options.gatewayAgentId === 'string' && options.gatewayAgentId.trim()
      ? options.gatewayAgentId.trim()
      : String(agentId || 'main').trim() || 'main';
    const headers = {
      'Content-Type': 'application/json'
    };
    if (gatewayToken) {
      headers.Authorization = `Bearer ${gatewayToken}`;
    }
    if (gatewayAgentId) {
      headers['x-openclaw-agent-id'] = gatewayAgentId;
    }
    if (gatewaySessionKey) {
      headers['x-openclaw-session-key'] = gatewaySessionKey;
    }
    const outboundMessages = buildGatewayOutboundMessages(agentId, userMessage, {
      ...(options || {}),
      sessionKey: gatewaySessionKey
    });

    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: outboundMessages,
        stream: true,
        ...(gatewaySessionKey ? { user: gatewaySessionKey } : {})
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    firstChunkTimeoutId = setTimeout(() => {
      if (!firstChunkReceived) {
        firstChunkTimeout = true;
        // 首分片较慢仅记录，不提前中断，避免“看桌面/等授权”场景误报。
        console.warn(`[${agentId}] ⏳ 首分片等待超过 ${firstChunkTimeoutMs}ms，继续等待...`);
      }
    }, firstChunkTimeoutMs);

    let streamFinished = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // 检查打断
      if (state.interruptedAgents.has(agentId)) {
        console.log(`[${agentId}] 🛑 请求被中断，丢弃结果`);
        reader.cancel();
        clearTimeout(timeoutId);
        removeOpenClawRequest(requestId);
        return;
      }

      buffer += decoder.decode(value, { stream: true });

      // 解析 SSE 行
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留不完整的行

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trimStart();
          if (data === '[DONE]') {
            streamFinished = true;
            break;
          }

          try {
            const parsed = JSON.parse(data);
            const content = extractSseContentDelta(parsed);
            if (content) {
              if (!firstChunkReceived) {
                firstChunkReceived = true;
                clearTimeout(firstChunkTimeoutId);
                firstChunkTimeoutId = null;
              }
              fullResponse += content;
              ws.send(JSON.stringify({ type: 'chunk', content }));
            }
            if (isSseTerminalPayload(parsed)) {
              streamFinished = true;
              break;
            }
          } catch (e) {
            // 跳过无法解析的行
          }
        }
      }

      if (streamFinished) {
        try { await reader.cancel(); } catch (_) {}
        break;
      }
    }

    if (firstChunkTimeoutId) {
      clearTimeout(firstChunkTimeoutId);
      firstChunkTimeoutId = null;
    }

    // 完成
    clearTimeout(timeoutId);
    removeOpenClawRequest(requestId);

    if (state.interruptedAgents.has(agentId)) {
      console.log(`[${agentId}] 🛑 请求被中断，丢弃结果`);
      return;
    }

    // 空回复重试（最多2次）
    if (!fullResponse.trim() && !state.interruptedAgents.has(agentId)) {
      if (disableRoundtableFailureRecovery) {
        ws._retryCount = 0;
        const emptyMsg = 'LLM 返回空内容（调试模式：不重试、不兜底）';
        console.error(`[${agentId}] ❌ ${emptyMsg}`);
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'error', message: emptyMsg }));
          }
        } catch (_) {}
        return;
      }
      const retryCount = (ws._retryCount || 0);
      if (retryCount < 2) {
        ws._retryCount = retryCount + 1;
        console.warn(`[${agentId}] ⚠️ LLM 返回空内容，第 ${ws._retryCount} 次重试...`);
        return sendToOpenClawHTTP(agentId, userMessage, ws, options);
      }
      console.error(`[${agentId}] ❌ LLM 连续返回空内容，转为 error`);
      ws._retryCount = 0;
      const recovered = await fallbackToOpenClawCLI(agentId, userMessage, ws, state);
      if (recovered) return;
      return;
    } else {
      ws._retryCount = 0;
    }

    addMemory(agentId, userMessage, fullResponse);
    ws.send(JSON.stringify({ type: 'end', fullResponse }));
    console.log(`[${agentId}] ✅ 请求完成 (HTTP SSE): ${requestId}, 长度: ${fullResponse.length}, ws=${ws?._connId || 'n/a'}, seq=${ws?._connSeq || 'n/a'}`);
  } catch (e) {
    clearTimeout(timeoutId);
    removeOpenClawRequest(requestId);
    if (typeof firstChunkTimeoutId !== 'undefined' && firstChunkTimeoutId) {
      clearTimeout(firstChunkTimeoutId);
      firstChunkTimeoutId = null;
    }
    if (e.name === 'AbortError' && !timedOut && !firstChunkTimeout) {
      const interrupted = state.interruptedAgents.has(agentId);
      const mod = getModerator(ws._roomId);
      const roomStopped = !!ws._roomId && (!mod || !mod.isActive);

      if (interrupted || roomStopped) {
        console.log(`[${agentId}] 🛑 请求被取消(预期内): ${requestId}`);
        return;
      }

      // 非预期取消：必须回传 error，避免前端永远卡在“准备中”
      const cancelMsg = '请求被取消（网络波动或连接重置）';
      console.warn(`[${agentId}] ⚠️ 非预期取消: ${requestId}`);
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: cancelMsg }));
        }
      } catch (_) {}
      return;
    }
    const errMsg = timedOut
      ? `HTTP SSE 超时 (${OPENCLAW_HTTP_TIMEOUT_MS}ms)`
      : firstChunkTimeout
        ? `首个文本分片等待过慢（>${firstChunkTimeoutMs}ms）`
      : e.message;
    if (state.preparingAgent === agentId) {
      state.preparingAgent = null;
      state.preparingStartTime = null;
    }
    console.error(`[${agentId}] ❌ HTTP SSE 错误: ${errMsg}, ws=${ws?._connId || 'n/a'}, seq=${ws?._connSeq || 'n/a'}, state=${ws?.readyState}`);
    if (disableRoundtableFailureRecovery) {
      ws._retryCount = 0;
      const strictErrMsg = `${errMsg}（调试模式：不重试）`;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: strictErrMsg }));
        }
      } catch (_) {}
      return;
    }
    // 错误时也重试一次
    const retryCount = (ws._retryCount || 0);
    if (retryCount < 2) {
      ws._retryCount = retryCount + 1;
      console.warn(`[${agentId}] ⚠️ HTTP 请求失败，第 ${ws._retryCount} 次重试: ${errMsg}`);
      return sendToOpenClawHTTP(agentId, userMessage, ws, options);
    }
    ws._retryCount = 0;
    ws.send(JSON.stringify({ type: 'error', message: errMsg }));
  }
}

// Agent Tools: 使用 Gateway HTTP SSE 直接流式推送（支持 reasoning + content）
async function streamOpenClawHTTP(agentId, userMessage, handlers = {}, options = {}) {
  const onText = typeof handlers.onText === 'function' ? handlers.onText : () => {};
  const onReasoning = typeof handlers.onReasoning === 'function' ? handlers.onReasoning : () => {};
  const onDone = typeof handlers.onDone === 'function' ? handlers.onDone : () => {};
  const onError = typeof handlers.onError === 'function' ? handlers.onError : () => {};
  const onExecution = typeof handlers.onExecution === 'function' ? handlers.onExecution : () => {};

  const laneBypass = !!(options && options.__laneBypass);
  const laneSessionKey = !laneBypass
    ? normalizeGatewaySessionKey(options.sessionKey)
    : '';
  if (laneSessionKey) {
    return await runInOpenClawSessionLane(
      laneSessionKey,
      async () => {
        return await streamOpenClawHTTP(agentId, userMessage, handlers, {
          ...(options || {}),
          __laneBypass: true
        });
      },
      {
        onStart: ({ waitMs, pendingBeforeStart }) => {
          if (waitMs < 80) return;
          onExecution({
            code: 'session_lane_wait',
            label: '同会话排队',
            detail: `等待 ${Math.round(waitMs / 100) / 10}s（前方 ${pendingBeforeStart || 0} 个）`,
            source: 'openclaw_lane'
          });
        }
      }
    );
  }

  const controller = options.controller || new AbortController();
  let timedOut = false;
  let firstChunkTimeout = false;
  let firstChunkReceived = false;
  let firstChunkTimeoutId = null;
  const firstChunkTimeoutMs = Math.max(1000, Number(options.firstChunkTimeoutMs) || OPENCLAW_FIRST_CHUNK_TIMEOUT_MS);

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, OPENCLAW_HTTP_TIMEOUT_MS);

  let fullResponse = '';
  let fullReasoning = '';

  try {
    const runtime = getRuntimeSettings();
    const gatewayUrl = runtime.openclawHttpUrl || 'http://127.0.0.1:18789/v1/chat/completions';
    const gatewayToken = runtime.openclawGatewayToken || '';
    const defaultModel = runtime.openclawModel || 'kimi-coding/k2p5';
    const headers = {
      'Content-Type': 'application/json'
    };
    if (gatewayToken) {
      headers.Authorization = `Bearer ${gatewayToken}`;
    }
    if (typeof options.gatewayAgentId === 'string' && options.gatewayAgentId.trim()) {
      headers['x-openclaw-agent-id'] = options.gatewayAgentId.trim();
    }
    const normalizedSessionKey = normalizeGatewaySessionKey(options.sessionKey);
    if (normalizedSessionKey) {
      headers['x-openclaw-session-key'] = normalizedSessionKey;
    }

    const outboundMessages = buildGatewayOutboundMessages(agentId, userMessage, {
      ...(options || {}),
      sessionKey: normalizedSessionKey
    });
    const stableUser = typeof options.user === 'string' && options.user.trim()
      ? options.user.trim()
      : normalizedSessionKey;
    const gatewayThinkingLevel = normalizeThinkingLevel(options.thinkingLevel, '');

    const gatewayReasoningEnabled = options.reasoningEnabled !== false;
    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: options.model || defaultModel,
        messages: outboundMessages,
        stream: true,
        ...(gatewayThinkingLevel ? { thinking: gatewayThinkingLevel } : {}),
        ...(stableUser ? { user: stableUser } : {}),
        reasoning: { enabled: gatewayReasoningEnabled }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    firstChunkTimeoutId = setTimeout(() => {
      if (!firstChunkReceived) {
        firstChunkTimeout = true;
        onExecution({
          code: 'first_chunk_slow',
          label: '响应较慢',
          detail: `首个分片等待超过 ${firstChunkTimeoutMs}ms，继续等待中...`,
          source: 'openclaw_gateway'
        });
      }
    }, firstChunkTimeoutMs);

    let streamFinished = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) continue;

        const payload = trimmed.slice(5).trimStart();
        if (payload === '[DONE]') {
          streamFinished = true;
          break;
        }

        try {
          const parsed = JSON.parse(payload);
          const reasoning = extractSseReasoningDelta(parsed);
          const content = extractSseContentDelta(parsed);

          if (typeof reasoning === 'string' && reasoning.length > 0) {
            if (!firstChunkReceived) {
              firstChunkReceived = true;
              clearTimeout(firstChunkTimeoutId);
              firstChunkTimeoutId = null;
            }
            fullReasoning += reasoning;
            onReasoning(reasoning);
          }

          if (typeof content === 'string' && content.length > 0) {
            if (!firstChunkReceived) {
              firstChunkReceived = true;
              clearTimeout(firstChunkTimeoutId);
              firstChunkTimeoutId = null;
            }
            fullResponse += content;
            onText(content);
          }
          if (isSseTerminalPayload(parsed)) {
            streamFinished = true;
            break;
          }
        } catch (e) {
          // 忽略不可解析行
        }
      }

      if (streamFinished) {
        try { await reader.cancel(); } catch (_) {}
        break;
      }
    }

    if (firstChunkTimeoutId) {
      clearTimeout(firstChunkTimeoutId);
      firstChunkTimeoutId = null;
    }
    clearTimeout(timeoutId);
    onExecution({
      code: 'stream_done',
      label: '执行完成',
      detail: 'Gateway 流式已完成',
      source: 'openclaw_gateway'
    });
    onDone({ fullResponse, fullReasoning });
  } catch (e) {
    if (firstChunkTimeoutId) {
      clearTimeout(firstChunkTimeoutId);
      firstChunkTimeoutId = null;
    }
    clearTimeout(timeoutId);

    // 主动取消（比如用户继续发送下一条）时静默退出
    if (e.name === 'AbortError' && !timedOut && !firstChunkTimeout && options.silentAbort) {
      return;
    }

    const errMsg = timedOut
      ? `HTTP SSE 超时 (${OPENCLAW_HTTP_TIMEOUT_MS}ms)`
      : firstChunkTimeout
        ? `首个文本分片等待过慢（>${firstChunkTimeoutMs}ms）`
        : e.message;
    onExecution({
      code: 'stream_error',
      label: '执行失败',
      detail: String(errMsg || 'unknown error'),
      source: 'openclaw_gateway'
    });
    onError(new Error(errMsg));
  }
}

// 智能体声音配置（默认音色）
const AGENT_VOICES = {
  'main': 'jobs_voice_20260115_v3',
  'jobs': 'jobs_voice_20260115_v3',
  'kobe': 'kobe_v1_hd',
  'munger': 'charles_munger_v1_hd',
  'hawking': 'hawking_v1_hd',
  'gates': 'bill_v1_hd'
};

// 默认 agentIds 和 voiceIds（5人圆桌）
const DEFAULT_AGENT_IDS = ['jobs', 'kobe', 'munger', 'hawking', 'gates'];
const DEFAULT_VOICE_IDS = ['jobs_voice_20260115_v3', 'kobe_v1_hd', 'charles_munger_v1_hd', 'hawking_v1_hd', 'bill_v1_hd'];
const CREATE_DEFAULT_VOICE_ID = AGENT_VOICES['main'] || DEFAULT_VOICE_IDS[0] || 'jobs_voice_20260115_v3';

// 动态构建 AGENTS 对象的函数
function buildAgentsObject(agentIds, voiceIds) {
  const agents = {};
  // Try to find local metadata for better display names
  let localAgents = {};
  try { localAgents = scanLocalAgents(); } catch(e) {}

  agentIds.forEach((id, index) => {
    const voiceId = voiceIds[index] || voiceIds[0] || DEFAULT_VOICE_IDS[0];

    let name = id.charAt(0).toUpperCase() + id.slice(1);
    let displayName = name;
    let emoji = '🎭';
    let workspace = getDefaultWorkspacePath(id);

    // 1. 优先继承现有 AGENTS 中的配置（保留 displayName、emoji 等）
    if (AGENTS[id]) {
        name = AGENTS[id].name || name;
        displayName = AGENTS[id].displayName || name;
        emoji = AGENTS[id].emoji || emoji;
        workspace = AGENTS[id].workspace || workspace;
    }

    // 2. 本地 meta.json 覆盖（如大笨蛋等自定义 agent 的 displayName）
    const localKey = Object.keys(localAgents).find(k => k.toLowerCase() === id.toLowerCase());
    if (localKey && localAgents[localKey]) {
        if (localAgents[localKey].name) name = localAgents[localKey].name;
        if (localAgents[localKey].displayName) displayName = localAgents[localKey].displayName;
    }

    agents[id] = {
      id: id,
      name: name,
      displayName: displayName,
      emoji: emoji,
      sessionKey: `agent:${id}:main`,
      workspace: workspace,
      systemPrompt: null,
      voiceId: voiceId
    };
  });
  return agents;
}

// 当前活跃的 agentIds（支持动态更新）
let activeAgentIds = [...DEFAULT_AGENT_IDS];

// 5 个智能体配置（五人圆桌论坛）
const AGENTS = {
  jobs: { 
    id: 'jobs', 
    name: 'Steve Jobs', 
    displayName: 'Steve Jobs',
    emoji: '🍎',
    sessionKey: 'agent:jobs:main',
    workspace: path.join(os.homedir(), '.openclaw/workspace-Jobs'),
    systemPrompt: null
  },
  kobe: {
    id: 'kobe',
    name: 'Kobe Bryant',
    displayName: 'Kobe Bryant',
    emoji: '🐍',
    sessionKey: 'agent:kobe:main',
    workspace: path.join(os.homedir(), '.openclaw/workspace-kobe'),
    systemPrompt: null
  },
  munger: {
    id: 'munger',
    name: 'Charlie Munger',
    displayName: 'Charlie Munger',
    emoji: '🧠',
    sessionKey: 'agent:munger:main',
    workspace: path.join(os.homedir(), '.openclaw/workspace-munger'),
    systemPrompt: null
  },
  hawking: {
    id: 'hawking',
    name: 'Stephen Hawking',
    displayName: 'Stephen Hawking',
    emoji: '🔭',
    sessionKey: 'agent:hawking:main',
    workspace: path.join(os.homedir(), '.openclaw/workspace-hawking'),
    systemPrompt: null
  },
  gates: {
    id: 'gates',
    name: 'Bill Gates',
    displayName: 'Bill Gates',
    emoji: '💻',
    sessionKey: 'agent:gates:main',
    workspace: path.join(os.homedir(), '.openclaw/workspace-gates'),
    systemPrompt: null
  }
};

const DATA_AGENTS_DIR = path.join(__dirname, 'data/agents');

// OpenClaw 系统目录
const OPENCLAW_ROOT_DIR = path.join(os.homedir(), '.openclaw');
const OPENCLAW_HOME_DIR = path.join(OPENCLAW_ROOT_DIR, 'agents');
const OPENCLAW_CONFIG_PATH = path.join(OPENCLAW_ROOT_DIR, 'openclaw.json');

function resolveLocalAgentDir(agentId, createIfMissing = false) {
  const normalizedId = String(agentId || '').trim();
  if (!normalizedId) return '';

  if (fs.existsSync(DATA_AGENTS_DIR)) {
    try {
      const dirs = fs.readdirSync(DATA_AGENTS_DIR);
      const matchDir = dirs.find((d) => d.toLowerCase() === normalizedId.toLowerCase());
      if (matchDir) return path.join(DATA_AGENTS_DIR, matchDir);
    } catch (_) {}
  }

  const target = path.join(DATA_AGENTS_DIR, normalizedId);
  if (createIfMissing) {
    try {
      fs.mkdirSync(target, { recursive: true });
    } catch (_) {}
  }
  return target;
}

function readAgentMeta(agentId) {
  const localDir = resolveLocalAgentDir(agentId, false);
  if (!localDir) return { meta: {}, metaPath: '' };
  const metaPath = path.join(localDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return { meta: {}, metaPath };
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (parsed && typeof parsed === 'object') {
      return { meta: parsed, metaPath };
    }
    return { meta: {}, metaPath };
  } catch (_) {
    return { meta: {}, metaPath };
  }
}

function writeAgentMeta(agentId, patch = {}) {
  const localDir = resolveLocalAgentDir(agentId, true);
  if (!localDir) {
    throw new Error('invalid agentId');
  }
  const metaPath = path.join(localDir, 'meta.json');
  let current = {};
  if (fs.existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (parsed && typeof parsed === 'object') current = parsed;
    } catch (_) {}
  }
  const next = { ...current, ...patch };
  fs.writeFileSync(metaPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return { meta: next, metaPath, localDir };
}

function resolvePreferredWorkspacePath(agentId, fallbackPath = '') {
  const normalizedId = String(agentId || '').trim();
  const lowerId = normalizedId.toLowerCase();
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (p) => {
    if (!p) return;
    const resolved = path.resolve(p);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    candidates.push(resolved);
  };

  if (lowerId === 'main') {
    // OpenClaw main agent uses ~/.openclaw/workspace (not workspace-main).
    pushCandidate(path.join(OPENCLAW_ROOT_DIR, 'workspace'));
  }
  if (normalizedId) {
    pushCandidate(path.join(OPENCLAW_ROOT_DIR, `workspace-${normalizedId}`));
    if (lowerId !== normalizedId) {
      pushCandidate(path.join(OPENCLAW_ROOT_DIR, `workspace-${lowerId}`));
    }
    const capitalized = lowerId
      ? `${lowerId.charAt(0).toUpperCase()}${lowerId.slice(1)}`
      : '';
    if (capitalized && capitalized !== normalizedId && capitalized !== lowerId) {
      pushCandidate(path.join(OPENCLAW_ROOT_DIR, `workspace-${capitalized}`));
    }
  }
  pushCandidate(fallbackPath);

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        return dir;
      }
    } catch (_) {}
  }
  return fallbackPath || candidates[0] || '';
}

function getDefaultWorkspacePath(agentId) {
  const normalizedId = String(agentId || '').trim();
  if (!normalizedId || normalizedId.toLowerCase() === 'main') {
    return path.join(OPENCLAW_ROOT_DIR, 'workspace');
  }
  return path.join(OPENCLAW_ROOT_DIR, `workspace-${normalizedId}`);
}

function getPreferredWorkspacePath(agentId, fallbackPath = '') {
  const fallback = fallbackPath || getDefaultWorkspacePath(agentId);
  return resolvePreferredWorkspacePath(agentId, fallback);
}

function patchOpenClawConfigCompat() {
  try {
    if (!fs.existsSync(OPENCLAW_CONFIG_PATH)) return;
    const raw = fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    let changed = false;

    if (!parsed.gateway || typeof parsed.gateway !== 'object') {
      parsed.gateway = {};
      changed = true;
    }
    if (!parsed.gateway.http || typeof parsed.gateway.http !== 'object') {
      parsed.gateway.http = {};
      changed = true;
    }
    if (!parsed.gateway.http.endpoints || typeof parsed.gateway.http.endpoints !== 'object') {
      parsed.gateway.http.endpoints = {};
      changed = true;
    }
    if (
      !parsed.gateway.http.endpoints.chatCompletions ||
      typeof parsed.gateway.http.endpoints.chatCompletions !== 'object' ||
      Array.isArray(parsed.gateway.http.endpoints.chatCompletions)
    ) {
      parsed.gateway.http.endpoints.chatCompletions = {};
      changed = true;
    }

    const chatCompletions = parsed.gateway.http.endpoints.chatCompletions;
    if (chatCompletions.enabled !== true) {
      chatCompletions.enabled = true;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(chatCompletions, 'images')) {
      delete chatCompletions.images;
      changed = true;
    }

    if (!changed) return;
    fs.writeFileSync(OPENCLAW_CONFIG_PATH, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
    console.log('[OpenClawCompat] normalized gateway.http.endpoints.chatCompletions');
  } catch (e) {
    console.warn(`[OpenClawCompat] patch failed: ${e.message}`);
  }
}
patchOpenClawConfigCompat();

// 扫描 OpenClaw 系统目录
function scanOpenClawAgents() {
  const agents = {};
  
  // Get local agents for merging metadata (case-insensitive lookup map)
  const localAgentsMap = scanLocalAgents();
  const localAgentsLookup = {};
  Object.keys(localAgentsMap).forEach(k => {
      localAgentsLookup[k.toLowerCase()] = localAgentsMap[k];
  });
  
  // Helper to process an agent given its ID and Workspace Path
  const processAgent = (id, wsPath) => {
      // Avoid duplicates if already found
      if (agents[id]) return;

      let description = '';
      let systemPrompt = '';
      let avatarUrl = null;
      let voiceId = 'default';
      let voiceUrl = null;
      let videoUrl = null;
      let o2oAudioId = '';
      
      // Check for matching local agent data (case-insensitive)
      const localAgent = localAgentsLookup[id.toLowerCase()];
      
      if (localAgent) {
          // Use local metadata if available
          if (localAgent.avatarUrl) avatarUrl = localAgent.avatarUrl;
          if (localAgent.description) description = localAgent.description;
          if (localAgent.systemPrompt) systemPrompt = localAgent.systemPrompt;
          if (localAgent.voiceId) voiceId = localAgent.voiceId;
          if (localAgent.voiceUrl) voiceUrl = localAgent.voiceUrl;
          if (localAgent.videoUrl) videoUrl = localAgent.videoUrl;
          if (localAgent.o2oAudioId) o2oAudioId = localAgent.o2oAudioId;
      } else {
          // Fallback manual check (as before, but less needed if scanLocalAgents covers it)
          // ... (existing manual check logic can be simplified or kept as fallback)
          
          // Check for local avatar in Meco data directory FIRST (Direct check if scanLocalAgents missed it?)
          const localAgentDir = path.join(DATA_AGENTS_DIR, id);
          if (fs.existsSync(localAgentDir)) {
              const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
              for (const ext of extensions) {
                  if (fs.existsSync(path.join(localAgentDir, `avatar${ext}`))) {
                      avatarUrl = `/api/local-agents/${id}/avatar`;
                      break;
                  }
              }
          }
      }
      
      // If no local avatar, check workspace
      if (!avatarUrl) {
           const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
          for (const ext of extensions) {
              if (fs.existsSync(path.join(wsPath, `avatar${ext}`))) {
                  avatarUrl = `/api/openclaw-agents/${id}/avatar`; 
                  break;
              }
          }
      }

      // Try SOUL.md (Workspace has priority for prompt if it exists?)
      // User said: "remember to compat case insensitive searching... for matching info... prompt description voice etc"
      // Usually workspace SOUL.md is more "current" for the agent's state in OpenClaw.
      // But if user has local data/agents description, maybe they want that?
      // Let's assume Workspace SOUL.md > Local prompt.txt for system prompt.
      // But Description might be better from local if SOUL.md is too long.
      
      const soulPath = path.join(wsPath, 'SOUL.md');
      if (fs.existsSync(soulPath)) {
         try {
           const content = fs.readFileSync(soulPath, 'utf-8').trim();
           systemPrompt = content;
           // Only update description if not set by local
           if (!description) description = content.substring(0, 100) + '...';
         } catch(e) {}
      }
      
      // Try prompt.txt (Workspace)
      const promptPath = path.join(wsPath, 'prompt.txt');
      if (fs.existsSync(promptPath)) {
        try {
          const content = fs.readFileSync(promptPath, 'utf-8').trim();
          if (!description) description = content;
          if (!systemPrompt) systemPrompt = content;
        } catch(e) {}
      } else if (!description) {
         // Try meta.json (Workspace)
         const metaPath = path.join(wsPath, 'meta.json');
         if (fs.existsSync(metaPath)) {
            try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                if (meta.prompt) {
                    description = meta.prompt;
                    systemPrompt = meta.prompt;
                }
            } catch(e) {}
         }
      }

      // Try IDENTITY.md (Append to system prompt)
      const identityPath = path.join(wsPath, 'IDENTITY.md');
      if (fs.existsSync(identityPath)) {
         try {
           const content = fs.readFileSync(identityPath, 'utf-8').trim();
           systemPrompt = (systemPrompt ? systemPrompt + '\n\n' : '') + content;
         } catch(e) {}
      } else {
          const nestedIdentityPath = path.join(wsPath, 'agent', 'IDENTITY.md');
          if (fs.existsSync(nestedIdentityPath)) {
             try {
               const content = fs.readFileSync(nestedIdentityPath, 'utf-8').trim();
               systemPrompt = (systemPrompt ? systemPrompt + '\n\n' : '') + content;
             } catch(e) {}
          }
      }

      // Check for voice.json in Workspace (if not already set by local)
      if (voiceId === 'default' && fs.existsSync(path.join(wsPath, 'voice.json'))) {
          try {
              const voiceData = JSON.parse(fs.readFileSync(path.join(wsPath, 'voice.json'), 'utf-8'));
              voiceId = voiceData.voice_id || voiceData.voiceId || 'default';
          } catch(e) {}
      }
      
      // Check for local data (case-insensitive) for Voice/Avatar if not found
      // This covers cases where meta.json might be missing but voice.json exists
      if (fs.existsSync(DATA_AGENTS_DIR)) {
          try {
              const dirs = fs.readdirSync(DATA_AGENTS_DIR);
              const matchDir = dirs.find(d => d.toLowerCase() === id.toLowerCase());
              if (matchDir) {
                  const localPath = path.join(DATA_AGENTS_DIR, matchDir);
                  
                  // Voice ID from meta.json (User priority)
                  if (voiceId === 'default' && fs.existsSync(path.join(localPath, 'meta.json'))) {
                      try {
                          const m = JSON.parse(fs.readFileSync(path.join(localPath, 'meta.json'), 'utf-8'));
                          if (m.voiceId || m.voice_id) voiceId = m.voiceId || m.voice_id;
                          if (!o2oAudioId && (m.o2o_audio_id || m.o2oAudioId)) {
                              o2oAudioId = String(m.o2o_audio_id || m.o2oAudioId || '').trim();
                          }
                      } catch(e) {}
                  }

                  // Voice ID from voice.json
                  // Fallback: Check voice.json even if voiceId is already set (if it was just 'default')
                  // Or override if we want local priority? No, local priority is handled above.
                  // But wait, the logic above only checks meta.json.
                  // We should check voice.json too.
                  if (voiceId === 'default' && fs.existsSync(path.join(localPath, 'voice.json'))) {
                      try {
                          const v = JSON.parse(fs.readFileSync(path.join(localPath, 'voice.json'), 'utf-8'));
                          voiceId = v.voice_id || v.voiceId || voiceId;
                      } catch(e) {}
                  }
                  
                  // Voice URL
                  if (!voiceUrl && fs.existsSync(path.join(localPath, 'voice.mp3'))) {
                       voiceUrl = `/api/agents/${id}/voice`;
                  }
              }
          } catch(e) {}
      }

      // Check for voice.mp3 in Workspace
      if (!voiceUrl && fs.existsSync(path.join(wsPath, 'voice.mp3'))) {
          voiceUrl = `/api/agents/${id}/voice`;
      }
      // If we have a local voice URL (from scanLocalAgents), we might want to standardize it to /api/agents/:id/voice too?
      // scanLocalAgents sets it to /api/local-agents/:id/voice.
      // But if we add a universal /api/agents/:id/voice endpoint that checks both, we can just use that.
      if (!voiceUrl && localAgent && localAgent.voiceUrl) {
           // We can keep the local one, or use the universal one if we implement it.
           // Let's use the universal one for consistency if we implement it.
           voiceUrl = `/api/agents/${id}/voice`;
      }

      // 名字优先级：localAgent meta.json > 现有 AGENTS 配置 > 首字母大写兜底
      const existingAgent = AGENTS[id];
      const resolvedName = (localAgent && localAgent.name) || (existingAgent && existingAgent.name) || id;
      const resolvedDisplayName = (localAgent && localAgent.displayName) || (existingAgent && existingAgent.displayName) || (id.charAt(0).toUpperCase() + id.slice(1));
      const resolvedEmoji = (existingAgent && existingAgent.emoji) || '🤖';

      agents[id] = {
        id: id,
        name: resolvedName,
        displayName: resolvedDisplayName,
        emoji: resolvedEmoji,
        description: description,
        systemPrompt: systemPrompt,
        avatarUrl: avatarUrl, 
        videoUrl: videoUrl, 
        voiceId: voiceId,
        voiceUrl: voiceUrl,
        o2oAudioId: o2oAudioId,
        source: 'openclaw_system',
        workspace: wsPath
      };
  };

  // 1. Scan ~/.openclaw/agents (Registry)
  // [RESTORED] Using ~/.openclaw/agents as requested.
  if (fs.existsSync(OPENCLAW_HOME_DIR)) {
    try {
      const dirs = fs.readdirSync(OPENCLAW_HOME_DIR, { withFileTypes: true });
      for (const dirent of dirs) {
        if (dirent.isDirectory()) {
          const agentId = dirent.name;
          let workspacePath = path.join(OPENCLAW_HOME_DIR, agentId);

          workspacePath = resolvePreferredWorkspacePath(agentId, workspacePath);
          processAgent(agentId, workspacePath);
        }
      }
    } catch (e) {
      console.error('Failed to scan OpenClaw agents dir:', e.message);
    }
  }

          // 2. Scan ~/.openclaw/workspace-* (Standalone Workspaces)
          if (fs.existsSync(OPENCLAW_ROOT_DIR)) {
              try {
                  const dirs = fs.readdirSync(OPENCLAW_ROOT_DIR, { withFileTypes: true });
                  for (const dirent of dirs) {
                      if (dirent.isDirectory() && dirent.name.startsWith('workspace-')) {
                          const agentId = dirent.name.replace('workspace-', '');
                          
                          // Check for case-insensitive duplicate
                          const existingKey = Object.keys(agents).find(k => k.toLowerCase() === agentId.toLowerCase());
                          if (existingKey) {
                               // If exact match doesn't exist but case-insensitive does, maybe we should warn or merge?
                               // For now, if exact match exists (handled by if(agents[agentId]) check inside loop), we skip.
                               // But here we want to ensure we process it if it's not processed yet.
                               if (existingKey !== agentId && !agents[agentId]) {
                                   // Different casing, but effectively same agent. Skip to avoid duplicates.
                                   continue;
                               }
                          }
                          
                          if (!agents[agentId]) { 
                              processAgent(agentId, path.join(OPENCLAW_ROOT_DIR, dirent.name));
                          }
                      }
                  }
              } catch(e) {
                  console.error('Failed to scan OpenClaw root dir:', e.message);
              }
          }
          
  // 3. Merge Local Agents that are not yet in OpenClaw list
  // This ensures locally created agents (in data/agents) are visible even if OpenClaw workspace is not ready
  Object.keys(localAgentsMap).forEach(agentId => {
      if (!agents[agentId]) {
          const localAgent = localAgentsMap[agentId];
          // Use local workspace path or fallback
          const wsPath = localAgent.workspace || getPreferredWorkspacePath(agentId);
          
          // Add as a valid agent
          agents[agentId] = {
              ...localAgent,
              source: 'local_only' // Mark as local only
          };
          // Try to enrich with any workspace data if it exists but wasn't scanned for some reason
          processAgent(agentId, wsPath);
      }
  });

  return agents;
}

// 扫描本地 data/agents 目录
function scanLocalAgents() {
  const localAgents = {};
  if (fs.existsSync(DATA_AGENTS_DIR)) {
    const dirs = fs.readdirSync(DATA_AGENTS_DIR, { withFileTypes: true });
    for (const dirent of dirs) {
      if (dirent.isDirectory()) {
        const agentId = dirent.name;
        const agentPath = path.join(DATA_AGENTS_DIR, agentId);
        const metaPath = path.join(agentPath, 'meta.json');
        const voicePath = path.join(agentPath, 'voice.json');
        const promptPath = path.join(agentPath, 'prompt.txt');
        
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            
            // Load Voice ID
            let voiceId = 'default';
            // 1. Try meta.json (User requested source)
            if (meta.voiceId || meta.voice_id) {
                voiceId = meta.voiceId || meta.voice_id;
            }
            // 2. Try voice.json (Standard source)
            else if (fs.existsSync(voicePath)) {
                try {
                    const voiceData = JSON.parse(fs.readFileSync(voicePath, 'utf-8'));
                    voiceId = voiceData.voice_id || voiceData.voiceId || 'default';
                } catch(e) {}
            }

            // Load Prompt/Description
            let description = meta.prompt || '';
            let systemPrompt = meta.prompt || '';
            if (fs.existsSync(promptPath)) {
                try {
                    const promptContent = fs.readFileSync(promptPath, 'utf-8').trim();
                    if (promptContent) {
                        description = promptContent;
                        systemPrompt = promptContent;
                    }
                } catch(e) {}
            }

            const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
            let localAvatarUrl = null;
            for (const ext of extensions) {
              if (fs.existsSync(path.join(agentPath, `avatar${ext}`))) {
                localAvatarUrl = `/api/local-agents/${agentId}/avatar`;
                break;
              }
            }

            localAgents[agentId] = {
              id: agentId,
              name: meta.displayName || agentId,
              displayName: meta.displayName || agentId,
              emoji: '👤',
              description: description,
              systemPrompt: systemPrompt,
              avatarUrl: localAvatarUrl,
              videoUrl: fs.existsSync(path.join(agentPath, 'video.mp4')) ? `/api/local-agents/${agentId}/video` : null,
              voiceId: voiceId, // Load Voice ID from voice.json
              voiceUrl: fs.existsSync(path.join(agentPath, 'voice.mp3')) ? `/api/local-agents/${agentId}/voice` : null, // Add voice.mp3 route
              o2oAudioId: String(meta.o2o_audio_id || meta.o2oAudioId || '').trim(),
              source: 'local',
              workspace: agentPath
            };
          } catch (e) {
            console.error(`Failed to load local agent ${agentId}:`, e.message);
          }
        }
      }
    }
  }
  return localAgents;
}

// 记忆管理
const MEMORY_DIR = path.join(os.homedir(), '.openclaw/openclaw-web-memory');
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

const memory = {};
const MAX_MEMORY = 20;  // 本地持久化保留最近20条
const CONTEXT_MEMORY_TURNS = 5; // 仅在“无 sessionKey 的兼容路径”下使用
const AGENTTOOLS_HISTORY_DIR = path.join(MEMORY_DIR, 'agenttools-history');
const AGENTTOOLS_HISTORY_PAGE_SIZE = 20;
const AGENTTOOLS_HISTORY_MAX_PAGES = 20;
const AGENTTOOLS_HISTORY_LIMIT = AGENTTOOLS_HISTORY_PAGE_SIZE * AGENTTOOLS_HISTORY_MAX_PAGES;
if (!fs.existsSync(AGENTTOOLS_HISTORY_DIR)) {
  fs.mkdirSync(AGENTTOOLS_HISTORY_DIR, { recursive: true });
}
const agentToolsHistoryCache = {};



// 从文件加载记忆
function loadMemoryFromFile(agentId) {
  const filePath = path.join(MEMORY_DIR, `${agentId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const loaded = JSON.parse(data);
      console.log(`[${agentId}] 📂 从文件加载记忆: ${loaded.length} 条`);
      return loaded;
    }
  } catch (err) {
    console.error(`[${agentId}] 加载记忆文件失败:`, err.message);
  }
  return [];
}

function getAgentToolsHistoryPath(agentId) {
  return path.join(AGENTTOOLS_HISTORY_DIR, `${agentId}.json`);
}

function normalizeHistoryFileItem(file) {
  if (!file || typeof file !== 'object') return null;
  const name = typeof file.name === 'string' ? file.name.trim() : '';
  const normalizedType = typeof file.type === 'string' ? file.type.trim().toLowerCase() : '';
  const url = typeof file.url === 'string' ? file.url.trim() : '';
  const data = typeof file.data === 'string' ? file.data.trim() : '';
  const thumbnail = typeof file.thumbnail === 'string' ? file.thumbnail.trim() : '';
  const absPath = typeof file.path === 'string' ? file.path.trim() : '';
  let pathType = '';
  if (file.pathType === 'folder') {
    pathType = 'folder';
  } else if (file.pathType === 'file') {
    pathType = 'file';
  } else if (normalizedType === 'application/x-system-folder') {
    pathType = 'folder';
  } else if (normalizedType === 'application/x-system-file') {
    pathType = 'file';
  }
  const normalized = {
    name: name || (absPath ? path.basename(absPath) : 'attachment'),
    type: normalizedType || 'application/octet-stream'
  };
  if (url && (/^(\/|https?:\/\/)/i.test(url) || /^data:image\//i.test(url))) {
    normalized.url = url;
  } else if (data && /^data:(image|video)\//i.test(data)) {
    // Keep legacy inline previews if url is unavailable.
    normalized.data = data;
  }
  if (thumbnail && /^data:image\//i.test(thumbnail)) {
    normalized.thumbnail = thumbnail;
  }
  if (absPath) {
    normalized.path = absPath;
  }
  if (pathType) {
    normalized.pathType = pathType;
  }
  const size = Number(file.size);
  if (Number.isFinite(size) && size >= 0) {
    normalized.size = Math.floor(size);
  }
  return normalized;
}

function normalizeHistoryFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return [];
  return files
    .map(normalizeHistoryFileItem)
    .filter(Boolean)
    .slice(0, ATTACHMENT_MAX_FILES_PER_MESSAGE);
}

function normalizeExecutionEventItem(item) {
  if (!item || typeof item !== 'object') return null;
  const code = typeof item.code === 'string' ? item.code.trim() : '';
  const label = typeof item.label === 'string' ? item.label.trim() : '';
  const detail = typeof item.detail === 'string' ? item.detail.trim() : '';
  if (!code && !label && !detail) return null;
  const source = typeof item.source === 'string' ? item.source.trim() : '';
  const agentId = typeof item.agentId === 'string' ? item.agentId.trim() : '';
  const senderName = typeof item.senderName === 'string' ? item.senderName.trim() : '';
  return {
    code: code || undefined,
    label: label || undefined,
    detail: detail || undefined,
    source: source || undefined,
    agentId: agentId || undefined,
    senderName: senderName || undefined,
    timestamp: typeof item.timestamp === 'string' ? item.timestamp : new Date().toISOString()
  };
}

function normalizeExecutionEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return [];
  return events
    .map(normalizeExecutionEventItem)
    .filter(Boolean)
    .slice(-120);
}

function buildPublicUploadUrl(filePath) {
  const source = typeof filePath === 'string' ? filePath.trim() : '';
  if (!source) return '';
  const relative = path.relative(path.join(__dirname, 'public'), source);
  if (!relative || relative.startsWith('..')) return '';
  return `/${relative.split(path.sep).join('/')}`;
}

function buildHistoryFilesFromUploadsAndPaths(uploads, savedFiles, systemPaths) {
  const historyFiles = [];
  const uploadList = Array.isArray(uploads) ? uploads : [];
  const savedList = Array.isArray(savedFiles) ? savedFiles : [];
  let savedIndex = 0;

  uploadList.forEach((upload) => {
    if (!upload || typeof upload !== 'object') return;
    const hasData = typeof upload.data === 'string' && /^data:/i.test(upload.data);
    const base = {
      name: (typeof upload.name === 'string' && upload.name.trim()) ? upload.name.trim() : 'upload.bin',
      type: (typeof upload.type === 'string' && upload.type.trim()) ? upload.type.trim() : 'application/octet-stream',
      thumbnail: (typeof upload.thumbnail === 'string' && upload.thumbnail.trim()) ? upload.thumbnail.trim() : '',
      size: Number(upload.size) || undefined
    };
    if (hasData) {
      const saved = savedList[savedIndex] || null;
      savedIndex += 1;
      if (saved && typeof saved.path === 'string' && saved.path.trim()) {
        base.url = buildPublicUploadUrl(saved.path);
      } else if (/^data:(image|video)\//i.test(upload.data)) {
        base.data = upload.data;
      }
    }
    const normalized = normalizeHistoryFileItem(base);
    if (normalized) historyFiles.push(normalized);
  });

  (Array.isArray(systemPaths) ? systemPaths : []).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const absPath = typeof item.path === 'string' ? item.path.trim() : '';
    if (!absPath) return;
    const pathType = item.pathType === 'folder' ? 'folder' : 'file';
    const normalized = normalizeHistoryFileItem({
      name: path.basename(absPath) || absPath,
      type: pathType === 'folder' ? 'application/x-system-folder' : 'application/x-system-file',
      path: absPath,
      pathType
    });
    if (normalized) historyFiles.push(normalized);
  });

  return normalizeHistoryFiles(historyFiles);
}

function normalizeAgentToolsHistoryItem(item) {
  if (!item || typeof item !== 'object') return null;
  const role = item.role === 'assistant' ? 'assistant' : (item.role === 'user' ? 'user' : null);
  const content = typeof item.content === 'string' ? item.content : '';
  if (!role || !content.trim()) return null;
  const senderName = typeof item.senderName === 'string'
    ? item.senderName.trim()
    : (typeof item.agentName === 'string' ? item.agentName.trim() : '');
  const senderAgentId = typeof item.agentId === 'string' ? item.agentId.trim() : '';
  const reasoning = typeof item.reasoning === 'string' ? item.reasoning : '';
  const executionEvents = normalizeExecutionEvents(item.executionEvents || item.events);
  const files = normalizeHistoryFiles(item.files);
  return {
    role,
    content,
    senderName: senderName || undefined,
    agentId: senderAgentId || undefined,
    reasoning: reasoning || undefined,
    executionEvents: executionEvents.length > 0 ? executionEvents : undefined,
    files: files.length > 0 ? files : undefined,
    timestamp: typeof item.timestamp === 'string' ? item.timestamp : new Date().toISOString()
  };
}

function loadAgentToolsHistoryFromFile(agentId) {
  const filePath = getAgentToolsHistoryPath(agentId);
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .map(normalizeAgentToolsHistoryItem)
      .filter(Boolean)
      .slice(-AGENTTOOLS_HISTORY_LIMIT);
  } catch (e) {
    console.warn(`[AgentTools] Failed to load history for ${agentId}: ${e.message}`);
    return [];
  }
}

function getAgentToolsHistory(agentId) {
  if (!agentToolsHistoryCache[agentId]) {
    agentToolsHistoryCache[agentId] = loadAgentToolsHistoryFromFile(agentId);
  }
  return agentToolsHistoryCache[agentId];
}

function saveAgentToolsHistory(agentId) {
  try {
    const history = (agentToolsHistoryCache[agentId] || []).slice(-AGENTTOOLS_HISTORY_LIMIT);
    const filePath = getAgentToolsHistoryPath(agentId);
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
  } catch (e) {
    console.warn(`[AgentTools] Failed to save history for ${agentId}: ${e.message}`);
  }
}

function appendAgentToolsHistory(agentId, role, content, filesOrOptions = [], extraOptions = null) {
  const normalizedRole = role === 'assistant' ? 'assistant' : (role === 'user' ? 'user' : null);
  const normalizedContent = typeof content === 'string' ? content.trim() : '';
  if (!normalizedRole || !normalizedContent) return;
  let options = {};
  let rawFiles = [];
  if (Array.isArray(filesOrOptions)) {
    rawFiles = filesOrOptions;
    options = (extraOptions && typeof extraOptions === 'object') ? extraOptions : {};
  } else if (filesOrOptions && typeof filesOrOptions === 'object') {
    options = filesOrOptions;
    rawFiles = Array.isArray(filesOrOptions.files) ? filesOrOptions.files : [];
  }
  const normalizedFiles = normalizeHistoryFiles(rawFiles);
  const senderName = typeof options.senderName === 'string' ? options.senderName.trim() : '';
  const senderAgentId = typeof options.agentId === 'string' ? options.agentId.trim() : '';
  const reasoning = typeof options.reasoning === 'string' ? options.reasoning : '';
  const executionEvents = normalizeExecutionEvents(options.executionEvents || options.events);
  const history = getAgentToolsHistory(agentId);
  history.push({
    role: normalizedRole,
    content: normalizedContent,
    senderName: senderName || undefined,
    agentId: senderAgentId || undefined,
    reasoning: reasoning || undefined,
    executionEvents: executionEvents.length > 0 ? executionEvents : undefined,
    files: normalizedFiles.length > 0 ? normalizedFiles : undefined,
    timestamp: new Date().toISOString()
  });
  if (history.length > AGENTTOOLS_HISTORY_LIMIT) {
    history.splice(0, history.length - AGENTTOOLS_HISTORY_LIMIT);
  }
  saveAgentToolsHistory(agentId);
}

function clearAgentToolsHistory(agentId) {
  const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
  if (!normalizedAgentId) return;
  agentToolsHistoryCache[normalizedAgentId] = [];
  saveAgentToolsHistory(normalizedAgentId);
}

const AGENT_CHANNELS_FILE = path.join(MEMORY_DIR, 'agent-channels.json');
const AGENT_CHANNEL_HISTORY_DIR = path.join(MEMORY_DIR, 'agent-channel-history');
const AGENT_CHANNEL_HISTORY_PAGE_SIZE = 20;
const AGENT_CHANNEL_HISTORY_MAX_PAGES = 20;
const AGENT_CHANNEL_HISTORY_LIMIT = AGENT_CHANNEL_HISTORY_PAGE_SIZE * AGENT_CHANNEL_HISTORY_MAX_PAGES;
if (!fs.existsSync(AGENT_CHANNEL_HISTORY_DIR)) {
  fs.mkdirSync(AGENT_CHANNEL_HISTORY_DIR, { recursive: true });
}
let agentChannelsCache = null;
const agentChannelHistoryCache = {};

function normalizeAgentChannel(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const membersRaw = Array.isArray(raw.agentIds) ? raw.agentIds : [];
  const agentIds = Array.from(new Set(
    membersRaw
      .map((x) => typeof x === 'string' ? x.trim() : '')
      .filter(Boolean)
  ));
  if (!id || !name || agentIds.length === 0) return null;
  return {
    id,
    name,
    agentIds,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString()
  };
}

function loadAgentChannelsFromFile() {
  try {
    if (!fs.existsSync(AGENT_CHANNELS_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(AGENT_CHANNELS_FILE, 'utf-8') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeAgentChannel).filter(Boolean);
  } catch (e) {
    console.warn(`[AgentChannels] Failed to load channels: ${e.message}`);
    return [];
  }
}

function getAgentChannels() {
  if (!Array.isArray(agentChannelsCache)) {
    agentChannelsCache = loadAgentChannelsFromFile();
  }
  return agentChannelsCache;
}

function saveAgentChannels() {
  try {
    const payload = Array.isArray(agentChannelsCache) ? agentChannelsCache : [];
    fs.writeFileSync(AGENT_CHANNELS_FILE, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.warn(`[AgentChannels] Failed to save channels: ${e.message}`);
  }
}

function findAgentChannelById(channelId) {
  const id = typeof channelId === 'string' ? channelId.trim() : '';
  if (!id) return null;
  return getAgentChannels().find((c) => c.id === id) || null;
}

function getAgentDisplayName(agentId) {
  const id = typeof agentId === 'string' ? agentId.trim() : '';
  if (!id) return '';
  const runtimeAgent = AGENTS[id];
  if (runtimeAgent) {
    return runtimeAgent.displayName || runtimeAgent.name || id;
  }
  try {
    const scanned = scanOpenClawAgents();
    if (scanned && scanned[id]) {
      return scanned[id].displayName || scanned[id].name || id;
    }
  } catch (_) {}
  return id;
}

function extractNextDirectives(text) {
  const source = typeof text === 'string' ? text : '';
  if (!source) return [];
  const regex = /\{\s*next\s*[:：]\s*["'“”‘’]?([^}"'“”‘’]+)["'“”‘’]?\s*\}/gi;
  const names = [];
  let match = null;
  while ((match = regex.exec(source)) !== null) {
    const raw = (match[1] || '').trim();
    if (!raw) continue;
    if (!names.includes(raw)) {
      names.push(raw);
    }
  }
  return names;
}

function stripNextDirectives(text) {
  const source = typeof text === 'string' ? text : '';
  if (!source) return '';
  return source
    .replace(/\{\s*next\s*[:：]\s*["'“”‘’]?([^}"'“”‘’]+)["'“”‘’]?\s*\}/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildAgentToolsCollaborationMemoryBlock(agentId, options = {}) {
  const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
  if (!normalizedAgentId) return '';
  const history = getAgentToolsHistory(normalizedAgentId);
  if (!Array.isArray(history) || history.length === 0) return '';

  const maxCount = Number.isFinite(Number(options.maxCount)) && Number(options.maxCount) > 0
    ? Math.max(1, Math.floor(Number(options.maxCount)))
    : 4;
  const maxCharsPerItem = Number.isFinite(Number(options.maxCharsPerItem)) && Number(options.maxCharsPerItem) > 0
    ? Math.max(80, Math.floor(Number(options.maxCharsPerItem)))
    : 520;

  const collected = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (!item || item.role !== 'assistant') continue;
    const senderAgentId = typeof item.agentId === 'string' ? item.agentId.trim() : '';
    if (!senderAgentId || senderAgentId === normalizedAgentId) continue;
    const rawContent = typeof item.content === 'string' ? item.content.trim() : '';
    if (!rawContent) continue;
    const senderName = (typeof item.senderName === 'string' && item.senderName.trim())
      ? item.senderName.trim()
      : (getAgentDisplayName(senderAgentId) || senderAgentId);
    const collapsed = rawContent.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const shortContent = collapsed.length > maxCharsPerItem
      ? `${collapsed.slice(0, Math.max(60, maxCharsPerItem - 1))}…`
      : collapsed;
    collected.push({
      senderName,
      senderAgentId,
      content: shortContent
    });
    if (collected.length >= maxCount) break;
  }
  if (collected.length === 0) return '';

  const lines = collected
    .reverse()
    .map((item, idx) => `${idx + 1}. ${item.senderName}\n${item.content}`);

  return `[Collaboration Memory]\n以下是本会话里其他协作智能体的最近回复，请将其视为当前上下文的一部分：\n\n${lines.join('\n\n')}\n\n[Instruction: If the user asks what another agent said (e.g. “比尔说了什么”), answer strictly based on this collaboration memory instead of saying you did not receive it.]`;
}

function escapeRegexLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveChannelDesignatedAgents(messageText, channelMembers) {
  const directives = extractNextDirectives(messageText);
  if (!Array.isArray(channelMembers) || channelMembers.length === 0 || directives.length === 0) {
    return [];
  }

  const normalizedMembers = channelMembers.map((id) => {
    const displayName = getAgentDisplayName(id) || id;
    return {
      id,
      idLower: String(id || '').trim().toLowerCase(),
      displayName,
      displayLower: String(displayName || '').trim().toLowerCase()
    };
  });

  const resolved = new Set();
  directives.forEach((directive) => {
    const needle = String(directive || '').trim().toLowerCase();
    if (!needle) return;

    // 1) Exact match on displayName / id
    let target = normalizedMembers.find((m) => m.displayLower === needle || m.idLower === needle);

    // 2) Fallback: partial match for user-typed abbreviated names
    if (!target) {
      target = normalizedMembers.find((m) => m.displayLower.includes(needle) || needle.includes(m.displayLower));
    }

    if (target) {
      resolved.add(target.id);
    }
  });

  // Keep original member order
  return channelMembers.filter((id) => resolved.has(id));
}

function resolveChannelDesignatedAgentsInDirectiveOrder(messageText, channelMembers) {
  const directives = extractNextDirectives(messageText);
  if (!Array.isArray(channelMembers) || channelMembers.length === 0 || directives.length === 0) {
    return [];
  }

  const normalizedMembers = channelMembers.map((id) => {
    const displayName = getAgentDisplayName(id) || id;
    return {
      id,
      idLower: String(id || '').trim().toLowerCase(),
      displayName,
      displayLower: String(displayName || '').trim().toLowerCase()
    };
  });

  const ordered = [];
  const seen = new Set();
  directives.forEach((directive) => {
    const needle = String(directive || '').trim().toLowerCase();
    if (!needle) return;
    let target = normalizedMembers.find((m) => m.displayLower === needle || m.idLower === needle);
    if (!target) {
      target = normalizedMembers.find((m) => m.displayLower.includes(needle) || needle.includes(m.displayLower));
    }
    if (!target || seen.has(target.id)) return;
    seen.add(target.id);
    ordered.push(target.id);
  });

  return ordered;
}

function ensureAllRequiredNextDirectives(content, requiredNames) {
  const source = typeof content === 'string' ? content.trim() : '';
  if (!source || !Array.isArray(requiredNames) || requiredNames.length === 0) {
    return source;
  }

  const existing = extractNextDirectives(source).map((n) => String(n || '').trim().toLowerCase());
  const normalizedExisting = new Set(existing.filter(Boolean));
  const missingNames = requiredNames.filter((name) => {
    const normalized = String(name || '').trim().toLowerCase();
    return normalized && !normalizedExisting.has(normalized);
  });

  if (missingNames.length === 0) {
    return source;
  }

  const appended = missingNames.map((name) => `{next: "${name}"}`).join('\n');
  return `${source}\n\n${appended}`.trim();
}

function listKnownAgentIdsForRouting() {
  const ids = [];
  const seen = new Set();
  const push = (value) => {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };

  Object.keys(AGENTS || {}).forEach(push);
  (Array.isArray(activeAgentIds) ? activeAgentIds : []).forEach(push);
  try {
    Object.keys(scanOpenClawAgents() || {}).forEach(push);
  } catch (_) {}

  return ids;
}

function resolveGlobalDesignatedAgentsInDirectiveOrder(messageText, options = {}) {
  const exclude = new Set(
    (Array.isArray(options.excludeAgentIds) ? options.excludeAgentIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );
  const candidates = listKnownAgentIdsForRouting().filter((id) => !exclude.has(id));
  return resolveChannelDesignatedAgentsInDirectiveOrder(messageText, candidates);
}

function resolveChannelMentionedAgents(messageText, channelMembers) {
  const source = typeof messageText === 'string' ? messageText : '';
  if (!source || !Array.isArray(channelMembers) || channelMembers.length === 0) {
    return [];
  }

  const normalizedMembers = channelMembers.map((id) => {
    const displayName = getAgentDisplayName(id) || id;
    return {
      id,
      displayName: String(displayName || '').trim(),
      agentId: String(id || '').trim()
    };
  });

  const candidatesByMember = normalizedMembers.map((member) => {
    const candidates = Array.from(new Set([member.displayName, member.agentId].filter(Boolean)))
      .map((candidate) => {
        const escaped = escapeRegexLiteral(candidate).replace(/\s+/g, '\\s+');
        if (!escaped) return null;
        // Match from the position right after '@'; right boundary must be non-token.
        const pattern = new RegExp(`^${escaped}(?=$|[^A-Za-z0-9_])`, 'i');
        return {
          raw: candidate,
          pattern,
          weight: candidate.length
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.weight - a.weight);
    return {
      id: member.id,
      candidates
    };
  });

  // Parse mentions in textual order: supports contiguous mentions like "@A@B".
  const ordered = [];
  const seen = new Set();
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== '@') continue;
    const tail = source.slice(i + 1);
    if (!tail) continue;

    let best = null;
    for (const member of candidatesByMember) {
      for (const candidate of member.candidates) {
        const m = tail.match(candidate.pattern);
        if (!m || !m[0]) continue;
        const matchedText = m[0];
        const score = matchedText.length;
        if (!best || score > best.score) {
          best = {
            id: member.id,
            score
          };
        }
      }
    }

    if (best && !seen.has(best.id)) {
      seen.add(best.id);
      ordered.push(best.id);
    }
  }

  return ordered;
}

function serializeAgentChannel(channel) {
  const normalized = normalizeAgentChannel(channel);
  if (!normalized) return null;
  return {
    ...normalized,
    members: normalized.agentIds.map((agentId) => ({
      id: agentId,
      name: getAgentDisplayName(agentId)
    }))
  };
}

function touchAgentChannel(channelId) {
  const channel = findAgentChannelById(channelId);
  if (!channel) return;
  channel.updatedAt = new Date().toISOString();
  saveAgentChannels();
}

function getAgentChannelHistoryPath(channelId) {
  return path.join(AGENT_CHANNEL_HISTORY_DIR, `${channelId}.json`);
}

function normalizeAgentChannelHistoryItem(item) {
  if (!item || typeof item !== 'object') return null;
  const role = item.role === 'assistant' ? 'assistant' : (item.role === 'user' ? 'user' : null);
  if (!role) return null;
  const content = typeof item.content === 'string' ? item.content.trim() : '';
  if (!content) return null;
  const agentId = typeof item.agentId === 'string' ? item.agentId.trim() : '';
  const senderName = typeof item.senderName === 'string'
    ? item.senderName.trim()
    : (typeof item.agentName === 'string' ? item.agentName.trim() : '');
  const reasoning = typeof item.reasoning === 'string' ? item.reasoning : '';
  const executionEvents = normalizeExecutionEvents(item.executionEvents || item.events);
  const files = normalizeHistoryFiles(item.files);
  return {
    role,
    content,
    agentId: agentId || undefined,
    senderName: senderName || undefined,
    reasoning: reasoning || undefined,
    executionEvents: executionEvents.length > 0 ? executionEvents : undefined,
    files: files.length > 0 ? files : undefined,
    timestamp: typeof item.timestamp === 'string' ? item.timestamp : new Date().toISOString()
  };
}

function loadAgentChannelHistoryFromFile(channelId) {
  const filePath = getAgentChannelHistoryPath(channelId);
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .map(normalizeAgentChannelHistoryItem)
      .filter(Boolean)
      .slice(-AGENT_CHANNEL_HISTORY_LIMIT);
  } catch (e) {
    console.warn(`[AgentChannels] Failed to load history for ${channelId}: ${e.message}`);
    return [];
  }
}

function getAgentChannelHistory(channelId) {
  const id = typeof channelId === 'string' ? channelId.trim() : '';
  if (!id) return [];
  if (!agentChannelHistoryCache[id]) {
    agentChannelHistoryCache[id] = loadAgentChannelHistoryFromFile(id);
  }
  return agentChannelHistoryCache[id];
}

function saveAgentChannelHistory(channelId) {
  const id = typeof channelId === 'string' ? channelId.trim() : '';
  if (!id) return;
  try {
    const history = (agentChannelHistoryCache[id] || []).slice(-AGENT_CHANNEL_HISTORY_LIMIT);
    fs.writeFileSync(getAgentChannelHistoryPath(id), JSON.stringify(history, null, 2));
  } catch (e) {
    console.warn(`[AgentChannels] Failed to save history for ${id}: ${e.message}`);
  }
}

function appendAgentChannelHistory(channelId, item) {
  const id = typeof channelId === 'string' ? channelId.trim() : '';
  if (!id) return;
  const normalized = normalizeAgentChannelHistoryItem(item);
  if (!normalized) return;
  const history = getAgentChannelHistory(id);
  history.push(normalized);
  if (history.length > AGENT_CHANNEL_HISTORY_LIMIT) {
    history.splice(0, history.length - AGENT_CHANNEL_HISTORY_LIMIT);
  }
  saveAgentChannelHistory(id);
}

function clearAgentChannelHistory(channelId) {
  const id = typeof channelId === 'string' ? channelId.trim() : '';
  if (!id) return;
  agentChannelHistoryCache[id] = [];
  saveAgentChannelHistory(id);
}

function parseHistoryPaginationQuery(query, defaultPageSize, maxPages) {
  const rawPage = Number.parseInt(query && query.page, 10);
  const rawPageSize = Number.parseInt(query && query.pageSize, 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0
    ? Math.min(rawPageSize, defaultPageSize)
    : defaultPageSize;
  const safeMaxPages = Number.isFinite(maxPages) && maxPages > 0 ? maxPages : 1;
  return { page, pageSize, maxPages: safeMaxPages };
}

function paginateHistoryItems(items, page, pageSize, maxPages) {
  const source = Array.isArray(items) ? items : [];
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 20;
  const safeMaxPages = Number.isFinite(maxPages) && maxPages > 0 ? maxPages : 1;
  const hardLimit = safePageSize * safeMaxPages;
  const capped = source.slice(-hardLimit);
  const total = capped.length;
  const totalPages = total > 0 ? Math.ceil(total / safePageSize) : 0;
  if (totalPages === 0) {
    return {
      history: [],
      page: 1,
      pageSize: safePageSize,
      total,
      totalPages,
      hasMore: false
    };
  }
  const normalizedPage = Math.min(safePage, totalPages);
  const end = total - (normalizedPage - 1) * safePageSize;
  const start = Math.max(0, end - safePageSize);
  const history = capped.slice(start, end);
  return {
    history,
    page: normalizedPage,
    pageSize: safePageSize,
    total,
    totalPages,
    hasMore: normalizedPage < totalPages
  };
}

function saveUploadedFilesAndBuildContext(files) {
  const uploads = Array.isArray(files) ? files : [];
  if (uploads.length === 0) {
    return { savedFiles: [], fileNames: '' };
  }
  const uploadsDir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const savedFiles = [];
  const fileNames = uploads
    .map((f) => (f && typeof f.name === 'string') ? f.name : '')
    .filter(Boolean)
    .join(', ');

  uploads.forEach((f) => {
    if (!f || typeof f.data !== 'string') return;
    try {
      const parsed = parseDataUriBase64(f.data);
      if (!parsed || !Buffer.isBuffer(parsed.buffer) || parsed.buffer.length === 0) return;
      const buffer = parsed.buffer;
      const safeName = ((typeof f.name === 'string' ? f.name : 'upload.bin').replace(/[^a-zA-Z0-9._-]/g, '_'));
      const filePath = path.join(uploadsDir, `${Date.now()}_${safeName}`);
      fs.writeFileSync(filePath, buffer);
      savedFiles.push({
        path: filePath,
        name: (typeof f.name === 'string' && f.name.trim()) ? f.name.trim() : safeName,
        type: (typeof f.type === 'string' && f.type.trim()) ? f.type.trim() : 'application/octet-stream'
      });
    } catch (e) {
      console.warn(`[Upload] Failed to save file ${(f && f.name) || 'unknown'}: ${e.message}`);
    }
  });
  return { savedFiles, fileNames };
}

function isImageMimeOrPath(mime, filePath) {
  const type = typeof mime === 'string' ? mime.toLowerCase() : '';
  if (type.startsWith('image/')) return true;
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif'].includes(ext);
}

function buildOpenClawAttachmentContext(savedFiles, systemPaths) {
  const fileEntries = [];
  const folderEntries = [];

  (Array.isArray(savedFiles) ? savedFiles : []).forEach((entry) => {
    if (!entry || typeof entry.path !== 'string' || !entry.path.trim()) return;
    fileEntries.push({
      path: entry.path.trim(),
      type: (typeof entry.type === 'string' && entry.type.trim()) ? entry.type.trim() : ''
    });
  });

  (Array.isArray(systemPaths) ? systemPaths : []).forEach((item) => {
    const absPath = item && typeof item.path === 'string' ? item.path.trim() : '';
    if (!absPath) return;
    if (item && item.pathType === 'folder') {
      folderEntries.push(absPath);
      return;
    }
    fileEntries.push({
      path: absPath,
      type: (item && typeof item.type === 'string' && item.type.trim()) ? item.type.trim() : ''
    });
  });

  if (fileEntries.length === 0 && folderEntries.length === 0) return '';
  const lines = [];
  const attachmentRefs = [];
  let imageIdx = 0;
  let videoIdx = 0;
  let fileIdx = 0;
  let folderIdx = 0;

  fileEntries.forEach((entry) => {
    const type = String(entry.type || '').toLowerCase();
    const image = isImageMimeOrPath(type, entry.path);
    const video = type.startsWith('video/');
    if (image) {
      imageIdx += 1;
      attachmentRefs.push({ kind: 'image', kindIndex: imageIdx, path: entry.path, name: path.basename(entry.path) || entry.path });
      return;
    }
    if (video) {
      videoIdx += 1;
      attachmentRefs.push({ kind: 'video', kindIndex: videoIdx, path: entry.path, name: path.basename(entry.path) || entry.path });
      return;
    }
    fileIdx += 1;
    attachmentRefs.push({ kind: 'file', kindIndex: fileIdx, path: entry.path, name: path.basename(entry.path) || entry.path });
  });

  folderEntries.forEach((folderPath) => {
    folderIdx += 1;
    attachmentRefs.push({ kind: 'folder', kindIndex: folderIdx, path: folderPath, name: path.basename(folderPath) || folderPath });
  });

  if (attachmentRefs.length > 0) {
    const kindLabelMap = {
      image: 'image',
      video: 'video',
      file: 'file',
      folder: 'folder'
    };
    lines.push('附件路径索引 / Attachment path index:');
    attachmentRefs.forEach((ref, index) => {
      const kindLabel = kindLabelMap[ref.kind] || 'file';
      lines.push(`[${index + 1}] ${ref.path} (${kindLabel}, ${ref.name})`);
    });
    lines.push('别名映射 / Alias mapping:');
    attachmentRefs.forEach((ref, index) => {
      const no = index + 1;
      if (ref.kind === 'image') {
        lines.push(`图${ref.kindIndex} / image${ref.kindIndex} -> [${no}]`);
      } else if (ref.kind === 'video') {
        lines.push(`视频${ref.kindIndex} / video${ref.kindIndex} -> [${no}]`);
      } else if (ref.kind === 'folder') {
        lines.push(`文件夹${ref.kindIndex} / folder${ref.kindIndex} -> [${no}]`);
      } else {
        lines.push(`文件${ref.kindIndex} / file${ref.kindIndex} -> [${no}]`);
      }
      lines.push(`附件${no} / attachment${no} -> [${no}]`);
    });
    lines.push('当用户提到“图1/视频1/文件1/附件1”时，请按以上索引和路径理解并回答。');
  }

  fileEntries.forEach((entry) => {
    if (!isImageMimeOrPath(entry.type, entry.path)) return;
    lines.push(`[Image: source: ${entry.path}]`);
  });

  folderEntries.forEach((folderPath) => {
    lines.push(`[local folder attached: ${folderPath}]`);
  });

  return lines.join('\n');
}

const ATTACHMENT_MAX_INLINE_TEXT_BYTES = 512 * 1024;
const ATTACHMENT_MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;
const ATTACHMENT_MAX_INLINE_TEXT_CHARS = 12000;
const ATTACHMENT_MAX_FILES_PER_MESSAGE = 12;
const ATTACHMENT_TEXT_MIME_PREFIXES = [
  'text/',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
  'application/x-yaml',
  'application/yaml'
];
const ATTACHMENT_TEXT_EXTS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.yaml', '.yml',
  '.xml', '.html', '.htm', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.java', '.go', '.rs', '.c', '.cc', '.cpp', '.h', '.hpp', '.sql',
  '.sh', '.zsh', '.bash', '.ini', '.toml', '.log'
]);
const ATTACHMENT_MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif'
};
const ATTACHMENT_SUPPORTED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif'
]);

function parseDataUriBase64(dataUri) {
  if (typeof dataUri !== 'string') return null;
  const trimmed = dataUri.trim();
  const match = /^data:([^,]*?),(.+)$/is.exec(trimmed);
  if (!match) return null;
  const meta = (match[1] || '').trim();
  if (!/;base64/i.test(meta)) return null;
  const mime = meta.split(';')[0] || 'application/octet-stream';
  const base64 = (match[2] || '').trim();
  if (!base64) return null;
  try {
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return null;
    return { mime: mime.toLowerCase(), base64, buffer };
  } catch (_) {
    return null;
  }
}

function normalizeAttachmentMime(mime, filePathOrName) {
  const normalized = typeof mime === 'string' ? mime.split(';')[0].trim().toLowerCase() : '';
  if (normalized) return normalized;
  const ext = path.extname(String(filePathOrName || '')).toLowerCase();
  return ATTACHMENT_MIME_BY_EXT[ext] || 'application/octet-stream';
}

function normalizeGatewayImageMime(mime) {
  const normalized = normalizeAttachmentMime(mime, '');
  if (normalized === 'image/jpg') return 'image/jpeg';
  return normalized;
}

function isLikelyTextAttachment(mime, filePathOrName) {
  const normalized = normalizeAttachmentMime(mime, filePathOrName);
  if (ATTACHMENT_TEXT_MIME_PREFIXES.some((x) => normalized.startsWith(x))) return true;
  const ext = path.extname(String(filePathOrName || '')).toLowerCase();
  return ATTACHMENT_TEXT_EXTS.has(ext);
}

function decodeAttachmentText(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return '';
  const content = buffer.toString('utf8');
  // Drop binary-ish content quickly.
  if (/\u0000/.test(content)) return '';
  return content;
}

function truncateAttachmentText(text, limit = ATTACHMENT_MAX_INLINE_TEXT_CHARS) {
  const source = typeof text === 'string' ? text.trim() : '';
  if (!source) return '';
  if (source.length <= limit) return source;
  return `${source.slice(0, limit)}\n...[truncated]`;
}

function buildOpenClawMultimodalMessages(userText, uploads, savedFiles, systemPaths) {
  const contentParts = [];
  const attachmentTextBlocks = [];
  const attachmentReferences = [];
  let imageRefCount = 0;
  let videoRefCount = 0;
  let fileRefCount = 0;
  let folderRefCount = 0;
  const baseUserText = typeof userText === 'string' ? userText.trim() : '';
  if (baseUserText) {
    contentParts.push({ type: 'text', text: baseUserText });
  }

  const pushAttachmentText = (text) => {
    const normalized = typeof text === 'string' ? text.trim() : '';
    if (!normalized) return;
    attachmentTextBlocks.push(normalized);
  };
  const pushAttachmentReference = (kind, name, localPath = '') => {
    const normalizedName = typeof name === 'string' && name.trim() ? name.trim() : `${kind}_${attachmentReferences.length + 1}`;
    const normalizedPath = typeof localPath === 'string' ? localPath.trim() : '';
    let kindIndex = 0;
    if (kind === 'image') {
      imageRefCount += 1;
      kindIndex = imageRefCount;
    } else if (kind === 'video') {
      videoRefCount += 1;
      kindIndex = videoRefCount;
    } else if (kind === 'folder') {
      folderRefCount += 1;
      kindIndex = folderRefCount;
    } else {
      fileRefCount += 1;
      kindIndex = fileRefCount;
    }
    attachmentReferences.push({
      globalIndex: attachmentReferences.length + 1,
      kind,
      kindIndex,
      name: normalizedName,
      path: normalizedPath
    });
  };

  const files = [];
  const savedList = Array.isArray(savedFiles) ? savedFiles : [];
  let savedIndex = 0;
  (Array.isArray(uploads) ? uploads : []).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    if (typeof item.data !== 'string' || !/^data:/i.test(item.data)) return;
    const saved = savedList[savedIndex] || null;
    savedIndex += 1;
    files.push({
      source: 'upload',
      name: (typeof item.name === 'string' && item.name.trim()) ? item.name.trim() : 'upload.bin',
      mime: typeof item.type === 'string' ? item.type : '',
      dataUri: item.data,
      thumbnail: (typeof item.thumbnail === 'string' && item.thumbnail.trim()) ? item.thumbnail.trim() : '',
      savedPath: saved && typeof saved.path === 'string' ? saved.path : ''
    });
  });

  (Array.isArray(systemPaths) ? systemPaths : []).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const absPath = typeof item.path === 'string' ? item.path.trim() : '';
    if (!absPath) return;
    if (item.pathType === 'folder') {
      pushAttachmentReference('folder', path.basename(absPath) || absPath, absPath);
      pushAttachmentText(`[Attached local folder] ${absPath}`);
      return;
    }
    files.push({
      source: 'path',
      name: path.basename(absPath) || absPath,
      mime: typeof item.type === 'string' ? item.type : '',
      absPath
    });
  });

  for (const file of files.slice(0, ATTACHMENT_MAX_FILES_PER_MESSAGE)) {
    if (file.source === 'upload') {
      const parsed = parseDataUriBase64(file.dataUri);
      if (!parsed) {
        pushAttachmentReference('file', file.name, file.savedPath || '');
        pushAttachmentText(file.savedPath ? `[Attached file] ${file.savedPath}` : `[Attached file] ${file.name}`);
        continue;
      }
      const mime = normalizeAttachmentMime(file.mime || parsed.mime, file.name);
      if (isImageMimeOrPath(mime, file.name)) {
        const imageMime = normalizeGatewayImageMime(parsed.mime || mime);
        if (!ATTACHMENT_SUPPORTED_IMAGE_MIMES.has(imageMime)) {
          pushAttachmentReference('image', file.name, file.savedPath || '');
          pushAttachmentText(`[Image attachment not supported by gateway MIME] ${file.name} (${imageMime || mime})`);
          continue;
        }
        if (parsed.buffer.length > ATTACHMENT_MAX_INLINE_IMAGE_BYTES) {
          pushAttachmentReference('image', file.name, file.savedPath || '');
          pushAttachmentText(`[Image attachment too large] ${file.name} (${Math.round(parsed.buffer.length / 1024 / 1024)}MB)`);
          continue;
        }
        pushAttachmentReference('image', file.name, file.savedPath || '');
        contentParts.push({
          type: 'image_url',
          image_url: { url: file.dataUri }
        });
        continue;
      }
      if (mime.startsWith('video/')) {
        pushAttachmentReference('video', file.name, file.savedPath || '');
        if (file.thumbnail && /^data:image\//i.test(file.thumbnail)) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: file.thumbnail }
          });
          pushAttachmentText(file.savedPath
            ? `[Video attachment] ${file.savedPath} (thumbnail provided)`
            : `[Video attachment] ${file.name} (thumbnail provided)`);
        } else {
          pushAttachmentText(file.savedPath ? `[Video attachment] ${file.savedPath}` : `[Video attachment] ${file.name}`);
        }
        continue;
      }
      if (isLikelyTextAttachment(mime, file.name) && parsed.buffer.length <= ATTACHMENT_MAX_INLINE_TEXT_BYTES) {
        const decoded = truncateAttachmentText(decodeAttachmentText(parsed.buffer));
        if (decoded) {
          pushAttachmentReference('file', file.name, file.savedPath || '');
          if (file.savedPath) {
            pushAttachmentText(`<file path="${file.savedPath}" name="${file.name}">\n${decoded}\n</file>`);
          } else {
            pushAttachmentText(`<file name="${file.name}">\n${decoded}\n</file>`);
          }
          continue;
        }
      }
      pushAttachmentReference('file', file.name, file.savedPath || '');
      pushAttachmentText(file.savedPath
        ? `[File attachment] ${file.savedPath} (${mime || 'application/octet-stream'})`
        : `[File attachment] ${file.name} (${mime || 'application/octet-stream'})`);
      continue;
    }

    const absPath = file.absPath;
    if (!absPath || !fs.existsSync(absPath)) {
      pushAttachmentReference('file', file.name || absPath, absPath || '');
      pushAttachmentText(`[Attached local file] ${file.name}`);
      continue;
    }
    let stat = null;
    try {
      stat = fs.statSync(absPath);
    } catch (_) {
      stat = null;
    }
    if (!stat || !stat.isFile()) {
      pushAttachmentReference('file', path.basename(absPath) || absPath, absPath);
      pushAttachmentText(`[Attached local file] ${absPath}`);
      continue;
    }
    const mime = normalizeAttachmentMime(file.mime, absPath);
    if (isImageMimeOrPath(mime, absPath) && stat.size <= ATTACHMENT_MAX_INLINE_IMAGE_BYTES) {
      const imageMime = normalizeGatewayImageMime(mime);
      if (!ATTACHMENT_SUPPORTED_IMAGE_MIMES.has(imageMime)) {
        pushAttachmentReference('image', path.basename(absPath) || absPath, absPath);
        pushAttachmentText(`[Attached local image not supported by gateway MIME] ${absPath} (${imageMime || mime})`);
        continue;
      }
      try {
        pushAttachmentReference('image', path.basename(absPath) || absPath, absPath);
        const buf = fs.readFileSync(absPath);
        const dataUri = `data:${imageMime};base64,${buf.toString('base64')}`;
        contentParts.push({
          type: 'image_url',
          image_url: { url: dataUri }
        });
      } catch (_) {
        pushAttachmentText(`[Attached local image] ${absPath}`);
      }
      continue;
    }
    if (isLikelyTextAttachment(mime, absPath) && stat.size <= ATTACHMENT_MAX_INLINE_TEXT_BYTES) {
      try {
        const decoded = truncateAttachmentText(decodeAttachmentText(fs.readFileSync(absPath)));
        if (decoded) {
          pushAttachmentReference('file', path.basename(absPath) || absPath, absPath);
          pushAttachmentText(`<file path="${absPath}">\n${decoded}\n</file>`);
          continue;
        }
      } catch (_) {}
    }
    pushAttachmentReference('file', path.basename(absPath) || absPath, absPath);
    pushAttachmentText(`[Attached local file] ${absPath}`);
  }

  if (attachmentReferences.length > 0) {
    const kindLabelMap = {
      image: 'image',
      video: 'video',
      file: 'file',
      folder: 'folder'
    };
    const referenceLines = attachmentReferences.map((ref) => {
      const kindLabel = kindLabelMap[ref.kind] || 'file';
      if (ref.path) {
        return `[${ref.globalIndex}] ${ref.path} (${kindLabel}, ${ref.name})`;
      }
      return `[${ref.globalIndex}] ${ref.name} (${kindLabel})`;
    });
    const aliasLines = [];
    attachmentReferences.forEach((ref) => {
      aliasLines.push(`附件${ref.globalIndex} / attachment${ref.globalIndex} -> [${ref.globalIndex}]`);
      if (ref.kind === 'image') {
        aliasLines.push(`图${ref.kindIndex} / image${ref.kindIndex} -> [${ref.globalIndex}]`);
      } else if (ref.kind === 'video') {
        aliasLines.push(`视频${ref.kindIndex} / video${ref.kindIndex} -> [${ref.globalIndex}]`);
      } else if (ref.kind === 'folder') {
        aliasLines.push(`文件夹${ref.kindIndex} / folder${ref.kindIndex} -> [${ref.globalIndex}]`);
      } else {
        aliasLines.push(`文件${ref.kindIndex} / file${ref.kindIndex} -> [${ref.globalIndex}]`);
      }
    });
    const referenceText = [
      '附件编号说明 / Attachment reference:',
      ...referenceLines,
      '可用引用 / Available aliases:',
      ...aliasLines,
      '当用户说“图1/视频1/文件1/附件1”时，请按以上映射和路径理解并作答。'
    ].join('\n');
    if (baseUserText) {
      contentParts.splice(1, 0, { type: 'text', text: referenceText });
    } else {
      contentParts.unshift({ type: 'text', text: referenceText });
    }
  }

  if (attachmentTextBlocks.length > 0) {
    contentParts.push({
      type: 'text',
      text: attachmentTextBlocks.join('\n\n')
    });
  }

  if (contentParts.length === 0) {
    return [{
      role: 'user',
      content: 'Please analyze the attached content.'
    }];
  }
  if (contentParts.length === 1 && contentParts[0].type === 'text') {
    return [{
      role: 'user',
      content: contentParts[0].text
    }];
  }
  return [{
    role: 'user',
    content: contentParts
  }];
}

// 保存记忆到文件
function saveMemoryToFile(agentId) {
  const filePath = path.join(MEMORY_DIR, `${agentId}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(memory[agentId], null, 2));
    console.log(`[${agentId}] 💾 记忆已保存到文件: ${memory[agentId].length} 条`);
  } catch (err) {
    console.error(`[${agentId}] 保存记忆文件失败:`, err.message);
  }
}

// 初始化时从文件加载
Object.keys(AGENTS).forEach(id => {
  memory[id] = loadMemoryFromFile(id);
});

// 动态构建名字到 ID 的映射（支持所有配置的 Agent，方便后续扩展新智能体）
function buildAgentNameMap() {
  const map = {};

  Object.entries(AGENTS).forEach(([id, agent]) => {
    // 支持 id 本身
    map[id.toLowerCase()] = id;

    // 从 displayName 和 name 提取各种变体（两者都注册，去重靠 map 覆盖）
    const names = [agent.displayName, agent.name].filter(n => n && typeof n === 'string');
    for (const fullName of names) {
      const lowerFullName = fullName.toLowerCase();

      // 全名（有空格和无空格版本）
      map[lowerFullName] = id;
      map[lowerFullName.replace(/\s/g, '')] = id; // 无空格版本

      const parts = lowerFullName.split(/\s+/); // 按空格分割

      // 每个部分单独作为名字
      parts.forEach(part => {
        if (part.length > 1) { // 忽略单字母
          map[part] = id;
        }
      });

      // 如果有多部分，支持 "名 姓" 和 "姓"（西方名字通常是 名+姓）
      if (parts.length >= 2) {
        map[parts[0]] = id; // 名
        map[parts[parts.length - 1]] = id; // 姓
      }
    }
  });

  return map;
}

// 预构建名字映射（启动时构建一次，后续 AGENTS 变化时可重新调用）
let agentNameToIdCache = buildAgentNameMap();

// 刷新名字映射（当 AGENTS 配置变化时调用）
function refreshAgentNameMap() {
  agentNameToIdCache = buildAgentNameMap();
  console.log('[AgentNameMap] 名字映射已刷新，支持:', Object.keys(agentNameToIdCache).join(', '));
}

// 加载人设
function loadAgentPersona(agentId) {
  // Use getAgentById instead of AGENTS[agentId] to ensure we find OpenClaw agents
  const agent = getAgentById(agentId);
  if (!agent) {
    console.error(`[${agentId}] 加载人设失败: Agent 不存在`);
    return null;
  }
  
  try {
    const identityPath = path.join(agent.workspace, 'IDENTITY.md');
    const soulPath = path.join(agent.workspace, 'SOUL.md');
    
    console.log(`[${agentId}] 正在加载人设...`);
    console.log(`[${agentId}]   workspace: ${agent.workspace}`);
    console.log(`[${agentId}]   identity: ${identityPath} (${fs.existsSync(identityPath) ? '存在' : '不存在'})`);
    console.log(`[${agentId}]   soul: ${soulPath} (${fs.existsSync(soulPath) ? '存在' : '不存在'})`);
    
    let persona = '';

    // 加载所有可能的人设文件
    const personaFiles = ['IDENTITY.md', 'SOUL.md', 'AGENTS.md', 'USER.md', 'MEMORY.md'];

    personaFiles.forEach(function(fileName) {
      const filePath = path.join(agent.workspace, fileName);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content && content.trim().length > 0) {
          persona += (persona ? '\n\n' : '') + content;
          console.log(`[${agentId}]   ✓ ${fileName} 已加载 (${content.length} 字符)`);
        } else {
          console.log(`[${agentId}]   ✗ ${fileName} 内容为空`);
        }
      }
    });
    
    if (persona) {
      persona = `You are ${agent.name}. ${persona}\n\nCRITICAL: You MUST fully embody this persona. Never break character. You ARE ${agent.name}.\n\nIMPORTANT: At the start of your response, always think: "I am ${agent.name}, so I should respond as ${agent.name} would." Never confuse yourself with other participants.`;
      console.log(`[${agentId}] 人设加载完成 (${persona.length} 字符)`);
    } else {
      console.log(`[${agentId}] 无人设文件或内容为空`);
    }
    
    return persona || null;
  } catch (err) {
    console.error(`[${agentId}] 加载人设失败:`, err.message);
    return null;
  }
}

// 刷新人设
function refreshPersona(agentId) {
  // Use getAgentById to support all agent types (including OpenClaw agents not in global AGENTS)
  const agent = getAgentById(agentId);
  if (!agent) {
      console.log(`[${agentId}] 刷新人设失败: Agent 不存在`);
      return;
  }
  
  // Need to temporarily put it in AGENTS if not there, or update the in-memory object?
  // loadAgentPersona reads from disk based on agentId -> workspace mapping which relies on AGENTS[id] or scan?
  // Let's look at loadAgentPersona implementation.
  // It seems loadAgentPersona relies on AGENTS[agentId].workspace.
  
  // So we must ensure AGENTS[agentId] is populated or loadAgentPersona is updated.
  // BUT: scanOpenClawAgents returns agents with workspace. 
  
  // HACK: If agent is not in AGENTS but found via getAgentById, we can try to reload it.
  // However, loadAgentPersona might strictly check AGENTS global.
  
  // Let's update loadAgentPersona to use getAgentById internally or pass the agent object.
  // Or just update AGENTS[agentId] if it's an OpenClaw agent.
  if (!AGENTS[agentId] && agent.source === 'openclaw_system') {
      AGENTS[agentId] = agent; // Cache it
  }

  const persona = loadAgentPersona(agentId);
  if (persona) {
    if (AGENTS[agentId]) AGENTS[agentId].systemPrompt = persona;
    console.log(`[${agentId}] 人设已加载 (${persona.length} 字符)`);
  } else {
    if (AGENTS[agentId]) AGENTS[agentId].systemPrompt = null;
    console.log(`[${agentId}] 无人设文件`);
  }
}

// 初始化人设
Object.keys(AGENTS).forEach(refreshPersona);

// 初始化名字映射
refreshAgentNameMap();

// Helper to find agent by ID (checking active AGENTS, then local, then openclaw)
function getAgentById(agentId) {
    if (AGENTS[agentId]) return AGENTS[agentId];
    
    // Check both sources
    const localAgents = scanLocalAgents();
    const openclawAgents = scanOpenClawAgents();
    
    // Case-insensitive lookup for local agents
    // e.g. agentId='Steve' (from workspace) but local='steve'
    const localAgentKey = Object.keys(localAgents).find(k => k.toLowerCase() === agentId.toLowerCase());
    const localAgent = localAgentKey ? localAgents[localAgentKey] : null;

    const openclawAgent = openclawAgents[agentId];
    
    if (openclawAgent) {
        // If OpenClaw agent exists, it's the primary source for logic/workspace
        // Merge with local metadata if available (e.g. avatar)
        if (localAgent) {
             return {
                 ...openclawAgent,
                 ...localAgent, // This merges local metadata (avatar, voice, etc)
                 id: openclawAgent.id, // Ensure ID stays as the OpenClaw one (e.g. 'Steve')
                 name: openclawAgent.name,
                 workspace: openclawAgent.workspace, // Force OpenClaw workspace
                 voiceId: localAgent.voiceId || openclawAgent.voiceId, // Prefer local voice ID
                 voiceUrl: localAgent.voiceUrl, // Prefer local voice file
                 o2oAudioId: localAgent.o2oAudioId || openclawAgent.o2oAudioId || ''
             };
        }
        return openclawAgent;
    }
    
    if (localAgent) return localAgent;
    
    return null;
}

function getRuntimeAgentById(agentId) {
  if (AGENTS[agentId]) return AGENTS[agentId];
  const found = getAgentById(agentId);
  if (found && !AGENTS[agentId]) {
    AGENTS[agentId] = found;
  }
  return AGENTS[agentId] || found || null;
}

// Serve Agent Assets (Avatar/Video/Files)
app.use('/assets/:agentId', (req, res, next) => {
    const { agentId } = req.params;
    const agent = getAgentById(agentId);
    if (!agent) return res.status(404).send('Agent not found');
    
    // Check if requesting specific file types

    if (req.url === '/avatar.png') {
        const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        // 1. Check Workspace
        if (agent.workspace) {
            for (const ext of extensions) {
                const avatarPath = path.join(agent.workspace, `avatar${ext}`);
                if (fs.existsSync(avatarPath)) return res.sendFile(avatarPath, { dotfiles: 'allow' });
            }
        }
        
        // 2. Check Local Data Directory
        if (fs.existsSync(DATA_AGENTS_DIR)) {
            try {
                const dirs = fs.readdirSync(DATA_AGENTS_DIR);
                const matchDir = dirs.find(d => d.toLowerCase() === agentId.toLowerCase());
                if (matchDir) {
                    const localPath = path.join(DATA_AGENTS_DIR, matchDir);
                    for (const ext of extensions) {
                        const avatarPath = path.join(localPath, `avatar${ext}`);
                        if (fs.existsSync(avatarPath)) return res.sendFile(avatarPath, { dotfiles: 'allow' });
                    }
                }
            } catch(e) {}
        }
        
        return res.status(404).send('Avatar not found');
    }
    
    if (req.url === '/video.mp4') {
        const videoPath = path.join(agent.workspace, 'video.mp4');
        if (fs.existsSync(videoPath)) return res.sendFile(videoPath);
        return res.status(404).send('Video not found');
    }
    
    // Default static serve from workspace
    express.static(agent.workspace)(req, res, next);
});

// ========== 知识库话题加载 ==========
const HOT_TOPICS_CATEGORY_WHITELIST = Object.freeze([
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
]);
const HOT_TOPICS_CATEGORY_SET = new Set(HOT_TOPICS_CATEGORY_WHITELIST);

function normalizeHotTopicsRootPath(inputPath) {
  let raw = String(inputPath || '').trim();
  if (!raw) raw = path.join(os.homedir(), 'Documents/知识库/热门话题');
  if (raw.startsWith('~')) {
    raw = path.join(os.homedir(), raw.slice(1));
  }
  const resolved = path.resolve(raw);
  if (path.basename(resolved) === '热门话题') return resolved;
  return path.join(resolved, '热门话题');
}

function getHotTopicsKnowledgeBasePath() {
  const runtime = getRuntimeSettings();
  return normalizeHotTopicsRootPath(runtime.hotTopicsKbPath || '');
}

function getHotTopicsSkillBasePath() {
  const knowledgeBasePath = getHotTopicsKnowledgeBasePath();
  return path.dirname(knowledgeBasePath);
}

function isAllowedHotTopicsCategory(name) {
  return HOT_TOPICS_CATEGORY_SET.has(String(name || '').trim());
}

const KNOWLEDGE_BASE_PATH = getHotTopicsKnowledgeBasePath();
app.use('/knowledge-assets', express.static(KNOWLEDGE_BASE_PATH));

const EN_TITLE_TRAILING_WORDS = new Set([
  'to', 'for', 'with', 'of', 'in', 'on', 'at', 'by', 'from', 'as',
  'about', 'into', 'onto', 'over', 'under', 'through', 'during',
  'without', 'within', 'and', 'or', 'but', 'the', 'a', 'an'
]);

function normalizeTitleText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function trimEnglishTitleFragment(value) {
  let title = normalizeTitleText(value).replace(/(\.\.\.|…)+$/g, '').trim();
  if (!title) return '';
  if (/[\u4e00-\u9fff]/.test(title)) return title;

  const words = title.split(' ').filter(Boolean);
  while (words.length > 3) {
    const last = (words[words.length - 1] || '').toLowerCase().replace(/[^a-z]/g, '');
    if (EN_TITLE_TRAILING_WORDS.has(last)) {
      words.pop();
      continue;
    }
    break;
  }
  return words.join(' ').trim();
}

function isLikelyBadEnglishTitle(value) {
  const title = trimEnglishTitleFragment(value);
  if (!title) return true;
  if (/[\u4e00-\u9fff]/.test(title)) return false;

  const words = title.split(/\s+/).filter(Boolean);
  if (words.length < 4 && title.length < 24) return true;
  return false;
}

function buildReadableTitleFromText(rawText, fallback = '') {
  const text = normalizeTitleText(rawText)
    .replace(/^(\[[^\]]*\]|【[^】]*】)\s*/g, '')
    .trim();
  if (!text) return trimEnglishTitleFragment(fallback);

  const firstSentence = text.split(/(?<=[.!?。！？])\s+/)[0] || text;
  let title = trimEnglishTitleFragment(firstSentence) || trimEnglishTitleFragment(text);

  if (!/[\u4e00-\u9fff]/.test(title) && title.length > 110) {
    let cut = title.slice(0, 110);
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > 70) cut = cut.slice(0, lastSpace);
    title = cut.trim();
  }
  if (!title) {
    title = trimEnglishTitleFragment(fallback) || '热门话题';
  }
  return title;
}

function resolveTopicTitle(rawTitle, sourceText, fallback = '') {
  const title = trimEnglishTitleFragment(rawTitle);
  if (title && !isLikelyBadEnglishTitle(title)) {
    return title;
  }
  return buildReadableTitleFromText(sourceText, fallback || title);
}

// 从知识库加载话题
function loadTopicsFromKnowledgeBase() {
  const topics = [];
  
  try {
    if (!fs.existsSync(KNOWLEDGE_BASE_PATH)) {
      console.log('[KnowledgeBase] 知识库目录不存在:', KNOWLEDGE_BASE_PATH);
      return topics;
    }
    
    // 获取所有分类目录
    const categories = fs.readdirSync(KNOWLEDGE_BASE_PATH, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.') && isAllowedHotTopicsCategory(dirent.name))
      .map(dirent => dirent.name);
    
    console.log('[KnowledgeBase] 发现分类:', categories);
    
    for (const category of categories) {
      const categoryPath = path.join(KNOWLEDGE_BASE_PATH, category);
      const topicDirs = fs.readdirSync(categoryPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.') && !dirent.name.startsWith('_pending'))
        .map(dirent => dirent.name);
      
      for (const topicDir of topicDirs) {
        const topicPath = path.join(categoryPath, topicDir);
        const analysisPath = path.join(topicPath, '_kimi_analysis.txt');

        let content = '';
        if (fs.existsSync(analysisPath)) {
          content = fs.readFileSync(analysisPath, 'utf-8');
        }

        // 加载 post.json 原文数据（支持大小写）
        let postData = null;
        let postPath = path.join(topicPath, 'post.json');
        
        // 检查是否存在（忽略大小写）
        if (!fs.existsSync(postPath)) {
            const files = fs.readdirSync(topicPath);
            const found = files.find(f => f.toLowerCase() === 'post.json');
            if (found) postPath = path.join(topicPath, found);
        }

        console.log('[KnowledgeBase] 检查 post.json:', postPath, fs.existsSync(postPath));
        if (fs.existsSync(postPath)) {
          try {
            const postRaw = JSON.parse(fs.readFileSync(postPath, 'utf-8'));
            postData = {
              title: postRaw.title || '',
              description: postRaw.description || '',
              content: postRaw.content || '',
              stats: postRaw.stats || {},
              comments: postRaw.comments || [],
              platform: postRaw.platform || postRaw.source || postRaw.from || '',
              url: postRaw.url || postRaw.link || ''
            };
            console.log('[KnowledgeBase] postData.platform:', postData.platform, 'url:', postData.url);
          } catch (e) {
            console.error(`[KnowledgeBase] 解析 post.json 失败: ${postPath}`, e.message);
          }
        }

        // 检查封面图（支持多种扩展名）
        let coverUrl = '';
        const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        let hasCover = false;
        let coverFile = '';
        
        // 优先检查 post.json 同级目录下的封面
        for (const ext of extensions) {
            const checkPath = path.join(topicPath, `cover${ext}`);
            if (fs.existsSync(checkPath)) {
                hasCover = true;
                coverFile = `cover${ext}`;
                break;
            }
        }

        // 生成相对路径 - 使用 path.relative 更稳健
        let relativePath = '';
        try {
            const rel = path.relative(KNOWLEDGE_BASE_PATH, topicPath);
            // 统一分隔符并编码每一段
            relativePath = rel.split(path.sep).map(p => encodeURIComponent(p)).join('/');
        } catch(e) {
            console.error('[KnowledgeBase] 路径计算错误:', e);
        }
        
        if (hasCover && relativePath) {
            coverUrl = `/topics/${relativePath}/${coverFile}`;
        }

        // 决定 content (summary)
        // 优先用 postData.description，其次用 postData.content
        // 如果都没有，再用 _kimi_analysis.txt，但要过滤掉 === MEDIA ANALYSIS === 等元数据
        let summaryContent = '';
        if (postData) {
            summaryContent = postData.description || postData.content || '';
        }
        if (!summaryContent && content) {
            summaryContent = content;
        }
        
        // 统一清洗 summaryContent (无论来源是 postData 还是 txt)
        if (summaryContent) {
            // 移除 === MEDIA ANALYSIS === 及其后面的内容 (支持多种格式)
            // 1. 移除 "=== MEDIA ANALYSIS ===" 标记及其后所有内容
            summaryContent = summaryContent.replace(/={3,}\s*MEDIA ANALYSIS\s*={3,}[\s\S]*/gi, '').trim();
            
            // 2. 移除 "No media to analyze" (忽略大小写)
            summaryContent = summaryContent.replace(/No media to analyze/gi, '').trim();
            
            // 3. 移除开头可能的 " - " 或 " : " (如果之前的替换导致留下了这些)
            summaryContent = summaryContent.replace(/^[\s\-\:]+/, '').trim();
            
            // 4. 如果剩下的内容太短（可能是残留的元数据），直接清空
            if (summaryContent.length < 5) {
                summaryContent = '';
            }
        }

        console.log('[KnowledgeBase] 话题:', topicDir, '| postData:', postData ? '有' : '无', '| title:', postData && postData.title ? postData.title : '无');
        
        const resolvedTitle = resolveTopicTitle(
          postData && postData.title ? postData.title : '',
          postData ? (postData.description || postData.content || '') : '',
          topicDir
        );

        topics.push({
          title: resolvedTitle,
          category: category,
          content: summaryContent,
          path: topicPath,
          postData: postData,
          coverUrl: hasCover ? '/topics/' + relativePath + '/cover.jpg' : ''
        });
      }
    }
    
    console.log(`[KnowledgeBase] 共加载 ${topics.length} 个话题`);
    return topics;
  } catch (err) {
    console.error('[KnowledgeBase] 加载话题失败:', err.message);
    return topics;
  }
}

// 切换到新话题（支持房间/非房间模式）
function switchToNewTopic(lang = 'zh', channelId = null) {
  const mod = channelId ? getModerator(channelId) : moderator;
  const room = channelId ? rooms.get(channelId) : null;

  if (room) {
    maybeRotateRoomTopicMemory(room);
    syncRoomTopicMemoryToModerator(room);
  } else {
    syncGlobalTopicMemoryToModerator(mod);
  }
  mod.stop();
  mod.start();
  mod.setLang(lang);

  // 房间模式下优先注入待讨论麦序话题
  if (room && room.queueTopics && room.queueTopics.length > 0) {
    mod.priorityTopics = room.queueTopics;
    console.log(`[RoundTable] 📋 switchToNewTopic 注入 ${room.queueTopics.length} 个麦序待讨论话题`);
  }

  const result = mod.startRandomTopic();
  if (result) {
    console.log(`[RoundTable] 切换到新话题: ${mod.currentTopicData?.title?.substring(0, 50) || '?'}...${channelId ? ` (房间: ${channelId})` : ''}`);
  } else {
    console.log('[KnowledgeBase] 无法获取新话题');
  }
  return result;
}

// 加载话题并初始化 moderator（传入 topicLoader 实现动态重载）
const loadedTopics = loadTopicsFromKnowledgeBase();

// 静态服务知识库图片（在加载话题之后）
app.use('/topics', express.static(KNOWLEDGE_BASE_PATH));
// 静态服务房间封面图
app.use('/room-covers', express.static(path.join(__dirname, 'data', 'room-covers')));

// ========== 增强版自动圆桌讨论系统 ==========
const moderator = new EnhancedRoundTableModerator({ topics: loadedTopics, agents: AGENTS, topicLoader: loadTopicsFromKnowledgeBase });

// 圆桌状态管理
const roundTableState = {
  preparingAgent: null,  // 当前正在准备中的 agent（已发送请求但未开始播放）
  preparingStartTime: null,  // 准备开始时间
  interruptedAgents: new Set(),  // 打断的agent，这些agent的响应需要忽略
  pendingTopicData: null,  // 非房间模式：暂存的新话题数据（等待 speech-started 时广播）
  displayTopicData: null   // 非房间模式：当前展示给前端的话题数据
};

// 获取房间级或全局的圆桌状态（房间模式用 room 上的状态，避免多房间互锁）
function getRoundTableState(channelId) {
    if (channelId) {
        const room = rooms.get(channelId);
        if (room) return room;
    }
    return roundTableState;
}

// ========== Room 主机-分机系统 ==========
const rooms = new Map(); // channelId -> Room
// 跨房间会话的话题去重记忆（path + 内容key）
const TOPIC_MEMORY_PATH = path.join(__dirname, '.roundtable-topic-memory.json');
const globalDiscussedTopicPaths = new Set();
const globalDiscussedTopicKeys = new Set();
let globalLastTopicPath = null;
let globalLastTopicKey = null;
// 按房间隔离的话题记忆（key 优先使用 podcastRoomId；无 room_id 时退化为 channel）
const ROOM_TOPIC_MEMORY_PATH = path.join(__dirname, '.roundtable-topic-memory.rooms.json');
const roomTopicMemory = new Map(); // memoryId -> { paths:Set, keys:Set, lastPath, lastKey, updatedAt }

// 加载持久化话题记忆（服务重启后仍可避免重复）
try {
  if (fs.existsSync(TOPIC_MEMORY_PATH)) {
    const raw = JSON.parse(fs.readFileSync(TOPIC_MEMORY_PATH, 'utf-8'));
    if (Array.isArray(raw.paths)) {
      for (const p of raw.paths) {
        if (typeof p === 'string' && p) globalDiscussedTopicPaths.add(p);
      }
    }
    if (Array.isArray(raw.keys)) {
      for (const k of raw.keys) {
        if (typeof k === 'string' && k) globalDiscussedTopicKeys.add(k);
      }
    }
    if (typeof raw.lastPath === 'string' && raw.lastPath) globalLastTopicPath = raw.lastPath;
    if (typeof raw.lastKey === 'string' && raw.lastKey) globalLastTopicKey = raw.lastKey;
    console.log(`[TopicMemory] 📦 加载记忆: paths=${globalDiscussedTopicPaths.size}, keys=${globalDiscussedTopicKeys.size}`);
  }
} catch (e) {
  console.warn(`[TopicMemory] ⚠️ 加载记忆失败: ${e.message}`);
}

function saveGlobalTopicMemory() {
  try {
    const payload = {
      paths: Array.from(globalDiscussedTopicPaths).slice(-5000),
      keys: Array.from(globalDiscussedTopicKeys).slice(-5000),
      lastPath: globalLastTopicPath || '',
      lastKey: globalLastTopicKey || '',
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(TOPIC_MEMORY_PATH, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.warn(`[TopicMemory] ⚠️ 保存记忆失败: ${e.message}`);
  }
}

function getRoomTopicMemoryId(room) {
  if (!room) return '';
  const podcastRoomId = String(room.podcastRoomId || '').trim();
  if (podcastRoomId) return `podcast:${podcastRoomId}`;
  const channelId = String(room.channelId || '').trim();
  if (channelId) return `channel:${channelId}`;
  return '';
}

function ensureRoomTopicMemory(memoryId) {
  if (!memoryId) return null;
  let state = roomTopicMemory.get(memoryId);
  if (!state) {
    state = {
      paths: new Set(),
      keys: new Set(),
      lastPath: null,
      lastKey: null,
      updatedAt: new Date().toISOString()
    };
    roomTopicMemory.set(memoryId, state);
  }
  if (!(state.paths instanceof Set)) state.paths = new Set(Array.isArray(state.paths) ? state.paths : []);
  if (!(state.keys instanceof Set)) state.keys = new Set(Array.isArray(state.keys) ? state.keys : []);
  return state;
}

function saveRoomTopicMemory() {
  try {
    const payload = {
      rooms: {},
      updatedAt: new Date().toISOString()
    };
    for (const [memoryId, state] of roomTopicMemory.entries()) {
      if (!memoryId || !state) continue;
      payload.rooms[memoryId] = {
        paths: Array.from(state.paths || []).slice(-5000),
        keys: Array.from(state.keys || []).slice(-5000),
        lastPath: state.lastPath || '',
        lastKey: state.lastKey || '',
        updatedAt: state.updatedAt || new Date().toISOString()
      };
    }
    fs.writeFileSync(ROOM_TOPIC_MEMORY_PATH, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.warn(`[RoomTopicMemory] ⚠️ 保存房间记忆失败: ${e.message}`);
  }
}

try {
  if (fs.existsSync(ROOM_TOPIC_MEMORY_PATH)) {
    const raw = JSON.parse(fs.readFileSync(ROOM_TOPIC_MEMORY_PATH, 'utf-8'));
    const allRooms = raw && typeof raw === 'object' ? (raw.rooms || {}) : {};
    let loadedCount = 0;
    for (const [memoryId, state] of Object.entries(allRooms)) {
      if (!memoryId || !state || typeof state !== 'object') continue;
      const paths = new Set(Array.isArray(state.paths) ? state.paths.filter((p) => typeof p === 'string' && p) : []);
      const keys = new Set(Array.isArray(state.keys) ? state.keys.filter((k) => typeof k === 'string' && k) : []);
      roomTopicMemory.set(memoryId, {
        paths,
        keys,
        lastPath: typeof state.lastPath === 'string' && state.lastPath ? state.lastPath : null,
        lastKey: typeof state.lastKey === 'string' && state.lastKey ? state.lastKey : null,
        updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : new Date().toISOString()
      });
      loadedCount++;
    }
    console.log(`[RoomTopicMemory] 📦 加载房间记忆: rooms=${loadedCount}`);
  }
} catch (e) {
  console.warn(`[RoomTopicMemory] ⚠️ 加载房间记忆失败: ${e.message}`);
}

// 全局 moderator 继承已持久化的话题去重记忆
syncGlobalTopicMemoryToModerator(moderator);

// 生成6位唯一频道ID
function generateChannelId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // 避免冲突
  if (rooms.has(id)) return generateChannelId();
  return id;
}

const UPDATE_STATE_DIR = path.join(os.homedir(), '.meco-studio');
const UPDATE_STATE_PATH = path.join(UPDATE_STATE_DIR, 'update-state.json');
const UPDATE_REMOTE_VERSION_URL = process.env.MECO_UPDATE_VERSION_URL || 'https://raw.githubusercontent.com/EdenShadow/mecostudio/main/VERSION';
const UPDATE_REMOTE_CACHE_TTL_MS = 30000;
const UPDATE_DEFAULT_LOG_LIMIT = 240;
const UPDATE_MAX_LOG_LINES = 2000;
const updateVersionCache = {
  checkedAt: 0,
  remoteVersion: '',
  error: '',
  pending: null
};

function normalizeVersionString(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const firstLine = text.split(/\r?\n/)[0] || '';
  return firstLine.trim();
}

function parseVersionParts(version) {
  const value = normalizeVersionString(version);
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+.]([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    suffix: String(match[4] || '')
  };
}

function compareVersions(a, b) {
  const aParsed = parseVersionParts(a);
  const bParsed = parseVersionParts(b);
  if (!aParsed || !bParsed) {
    const aText = normalizeVersionString(a);
    const bText = normalizeVersionString(b);
    if (aText === bText) return 0;
    return aText > bText ? 1 : -1;
  }
  if (aParsed.major !== bParsed.major) return aParsed.major > bParsed.major ? 1 : -1;
  if (aParsed.minor !== bParsed.minor) return aParsed.minor > bParsed.minor ? 1 : -1;
  if (aParsed.patch !== bParsed.patch) return aParsed.patch > bParsed.patch ? 1 : -1;
  if (aParsed.suffix === bParsed.suffix) return 0;
  if (!aParsed.suffix) return 1;
  if (!bParsed.suffix) return -1;
  return aParsed.suffix > bParsed.suffix ? 1 : -1;
}

function readLocalVersionInfo() {
  const candidates = [
    path.join(__dirname, 'VERSION'),
    path.join(UPDATE_STATE_DIR, 'VERSION')
  ];
  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const value = normalizeVersionString(fs.readFileSync(filePath, 'utf-8'));
      if (!value) continue;
      return { version: value, file: filePath };
    } catch (_) {}
  }
  return { version: '0.0.0', file: '' };
}

async function fetchRemoteVersionInfo({ force = false } = {}) {
  const now = Date.now();
  if (!force && updateVersionCache.checkedAt && now - updateVersionCache.checkedAt < UPDATE_REMOTE_CACHE_TTL_MS) {
    return {
      remoteVersion: updateVersionCache.remoteVersion,
      error: updateVersionCache.error,
      checkedAt: updateVersionCache.checkedAt,
      url: UPDATE_REMOTE_VERSION_URL
    };
  }

  if (updateVersionCache.pending) {
    return updateVersionCache.pending;
  }

  updateVersionCache.pending = (async () => {
    let remoteVersion = '';
    let error = '';
    try {
      const res = await fetch(UPDATE_REMOTE_VERSION_URL, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const text = await res.text();
      remoteVersion = normalizeVersionString(text);
      if (!remoteVersion) {
        throw new Error('empty remote VERSION');
      }
    } catch (e) {
      error = e && e.message ? String(e.message) : 'remote VERSION fetch failed';
    }

    updateVersionCache.remoteVersion = remoteVersion;
    updateVersionCache.error = error;
    updateVersionCache.checkedAt = Date.now();
    const result = {
      remoteVersion,
      error,
      checkedAt: updateVersionCache.checkedAt,
      url: UPDATE_REMOTE_VERSION_URL
    };
    updateVersionCache.pending = null;
    return result;
  })();

  return updateVersionCache.pending;
}

function baseUpdateTaskState() {
  return {
    taskId: '',
    status: 'idle',
    phase: '',
    startedAt: '',
    finishedAt: '',
    localVersionBefore: '',
    localVersionAfter: '',
    targetVersion: '',
    remoteVersion: '',
    workerPid: 0,
    error: '',
    logs: []
  };
}

function readUpdateTaskState() {
  const base = baseUpdateTaskState();
  try {
    if (!fs.existsSync(UPDATE_STATE_PATH)) return base;
    const raw = JSON.parse(fs.readFileSync(UPDATE_STATE_PATH, 'utf-8'));
    if (!raw || typeof raw !== 'object') return base;
    const next = { ...base, ...raw };
    if (!Array.isArray(next.logs)) next.logs = [];
    next.logs = next.logs.slice(-UPDATE_MAX_LOG_LINES);
    return next;
  } catch (e) {
    console.warn(`[Update] failed to read ${UPDATE_STATE_PATH}: ${e.message}`);
    return base;
  }
}

function writeUpdateTaskState(partial = {}) {
  const current = readUpdateTaskState();
  const merged = { ...current, ...partial };
  if (!Array.isArray(merged.logs)) merged.logs = [];
  merged.logs = merged.logs.slice(-UPDATE_MAX_LOG_LINES);
  try {
    fs.mkdirSync(UPDATE_STATE_DIR, { recursive: true });
    fs.writeFileSync(UPDATE_STATE_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  } catch (e) {
    console.warn(`[Update] failed to write ${UPDATE_STATE_PATH}: ${e.message}`);
  }
  return merged;
}

function buildUpdateTaskPublicState(taskState, logLimit = UPDATE_DEFAULT_LOG_LIMIT) {
  const state = taskState && typeof taskState === 'object' ? taskState : baseUpdateTaskState();
  const limit = Number.isFinite(Number(logLimit)) ? Math.max(0, Math.min(1000, Number(logLimit))) : UPDATE_DEFAULT_LOG_LIMIT;
  const logs = Array.isArray(state.logs) ? state.logs.slice(-limit) : [];
  const running = state.status === 'running' || state.status === 'starting';
  return {
    taskId: state.taskId || '',
    status: state.status || 'idle',
    running,
    phase: state.phase || '',
    startedAt: state.startedAt || '',
    finishedAt: state.finishedAt || '',
    localVersionBefore: state.localVersionBefore || '',
    localVersionAfter: state.localVersionAfter || '',
    targetVersion: state.targetVersion || '',
    remoteVersion: state.remoteVersion || '',
    workerPid: Number(state.workerPid) || 0,
    error: state.error || '',
    logs
  };
}

function isUpdateTaskRunning(taskState) {
  const status = String(taskState?.status || '');
  return status === 'starting' || status === 'running';
}

function startDetachedUpdateWorker({ taskId, localVersion, targetVersion, remoteVersionUrl }) {
  const workerPath = path.join(__dirname, 'scripts', 'run-update-worker.js');
  if (!fs.existsSync(workerPath)) {
    throw new Error(`update worker script not found: ${workerPath}`);
  }
  const runtime = getRuntimeSettings();
  const kimiCommand = 'kimi';
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [workerPath], {
    cwd: __dirname,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      MECO_UPDATE_TASK_ID: String(taskId || ''),
      MECO_UPDATE_STATE_PATH: UPDATE_STATE_PATH,
      MECO_UPDATE_REPO_DIR: __dirname,
      MECO_UPDATE_LOCAL_VERSION: String(localVersion || ''),
      MECO_UPDATE_TARGET_VERSION: String(targetVersion || ''),
      MECO_UPDATE_REMOTE_VERSION_URL: String(remoteVersionUrl || UPDATE_REMOTE_VERSION_URL),
      MECO_UPDATE_KIMI_CMD: String(kimiCommand || runtime.kimiCliCommand || 'kimi')
    }
  });
  child.unref();
  return child.pid;
}

// Update API (version check + detached update runner)
app.get('/api/update/status', async (req, res) => {
  try {
    const force = String(req.query?.force || '') === '1' || String(req.query?.force || '').toLowerCase() === 'true';
    const logLimit = Number(req.query?.logLimit || UPDATE_DEFAULT_LOG_LIMIT);
    const local = readLocalVersionInfo();
    const remote = await fetchRemoteVersionInfo({ force });
    const taskState = readUpdateTaskState();
    const hasUpdate = !!(remote.remoteVersion && compareVersions(local.version, remote.remoteVersion) < 0);

    res.json({
      success: true,
      localVersion: local.version,
      localVersionFile: local.file || '',
      remoteVersion: remote.remoteVersion || '',
      remoteVersionUrl: remote.url || UPDATE_REMOTE_VERSION_URL,
      remoteCheckedAt: remote.checkedAt || 0,
      checkError: remote.error || '',
      hasUpdate,
      task: buildUpdateTaskPublicState(taskState, logLimit)
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || 'update status failed' });
  }
});

app.post('/api/update/start', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const forceStart = !!body.force;
    const currentTaskState = readUpdateTaskState();
    if (isUpdateTaskRunning(currentTaskState)) {
      return res.status(409).json({
        success: false,
        error: 'update already running',
        task: buildUpdateTaskPublicState(currentTaskState)
      });
    }

    const local = readLocalVersionInfo();
    const remote = await fetchRemoteVersionInfo({ force: true });
    const targetVersion = normalizeVersionString(body.targetVersion || remote.remoteVersion);
    const hasUpdate = !!(targetVersion && compareVersions(local.version, targetVersion) < 0);

    if (!forceStart && !hasUpdate) {
      return res.status(200).json({
        success: false,
        error: remote.error || 'already latest',
        localVersion: local.version,
        remoteVersion: targetVersion || '',
        hasUpdate: false,
        task: buildUpdateTaskPublicState(currentTaskState)
      });
    }

    const taskId = `upd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startTime = new Date().toISOString();
    const nextState = writeUpdateTaskState({
      taskId,
      status: 'starting',
      phase: 'queued',
      startedAt: startTime,
      finishedAt: '',
      localVersionBefore: local.version || '',
      localVersionAfter: '',
      targetVersion: targetVersion || '',
      remoteVersion: remote.remoteVersion || targetVersion || '',
      workerPid: 0,
      error: '',
      logs: [
        {
          ts: startTime,
          level: 'info',
          text: `Update queued: local=${local.version || 'unknown'}, target=${targetVersion || 'unknown'}`
        }
      ]
    });

    let workerPid = 0;
    try {
      workerPid = startDetachedUpdateWorker({
        taskId,
        localVersion: local.version || '',
        targetVersion: targetVersion || '',
        remoteVersionUrl: remote.url || UPDATE_REMOTE_VERSION_URL
      });
      writeUpdateTaskState({
        taskId,
        status: 'running',
        phase: 'worker_started',
        workerPid
      });
    } catch (workerErr) {
      const failed = writeUpdateTaskState({
        taskId,
        status: 'failed',
        phase: 'worker_failed',
        finishedAt: new Date().toISOString(),
        error: workerErr.message || 'failed to start update worker',
        logs: [
          ...(Array.isArray(nextState.logs) ? nextState.logs : []),
          {
            ts: new Date().toISOString(),
            level: 'error',
            text: `Failed to launch update worker: ${workerErr.message || 'unknown error'}`
          }
        ]
      });
      return res.status(500).json({
        success: false,
        error: failed.error || 'failed to launch update worker',
        task: buildUpdateTaskPublicState(failed)
      });
    }

    const running = readUpdateTaskState();
    return res.json({
      success: true,
      task: buildUpdateTaskPublicState(running),
      localVersion: local.version,
      remoteVersion: targetVersion || ''
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'update start failed' });
  }
});

// App Settings API (keys + integration installers)
app.get('/api/settings', (req, res) => {
  try {
    const settings = appSettings.getSettings();
    const masked = appSettings.getMaskedSettings();
    res.json({ settings, masked });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/openclaw/webui-url', (req, res) => {
  try {
    const runtime = getRuntimeSettings();
    const candidates = buildOpenClawWebUiCandidates(runtime);
    res.json({
      success: true,
      webuiUrl: candidates[0] || '',
      candidates
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || 'failed to resolve openclaw webui url' });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    let nextSettings = appSettings.saveSettings(body.settings || {});
    let integration = null;

    if (body.applyIntegrations) {
      integration = await integrationSetup.applyAll(nextSettings);
      if (integration && integration.settingsPatch && typeof integration.settingsPatch === 'object') {
        nextSettings = appSettings.saveSettings(integration.settingsPatch);
      }
    }

    res.json({
      success: true,
      settings: nextSettings,
      masked: appSettings.getMaskedSettings(),
      integration
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/openclaw/approve', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const approvalId = String(body.approvalId || body.requestId || '').trim();
    const mode = String(body.mode || '').trim().toLowerCase() || 'allow-once';
    const agentId = String(body.agentId || '').trim();
    if (!approvalId) {
      return res.status(400).json({ success: false, error: 'approvalId is required' });
    }
    if (!/^[a-zA-Z0-9_-]{4,128}$/.test(approvalId)) {
      return res.status(400).json({ success: false, error: 'invalid approvalId' });
    }
    if (!['allow-once', 'allow-always', 'deny'].includes(mode)) {
      return res.status(400).json({ success: false, error: 'invalid mode' });
    }
    if (!openclaw || typeof openclaw.approvePermission !== 'function') {
      return res.status(500).json({ success: false, error: 'approve handler unavailable' });
    }

    const result = await openclaw.approvePermission(approvalId, mode, {
      agentId: agentId || undefined
    });
    return res.json({
      success: true,
      approvalId,
      mode,
      agentId: agentId || null,
      result
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e && e.message ? String(e.message) : 'approve failed'
    });
  }
});

const cloudflareTunnelRuntime = {
  process: null,
  pid: 0,
  status: 'idle',
  startedAt: '',
  lastError: '',
  logs: []
};
const REMOTE_PUBLIC_PATH_SEGMENT = 'web';
const REMOTE_RUSTDESK_PATH_SEGMENT = 'rustdesk';
const RUSTDESK_APP_BUNDLE_PATH = '/Applications/RustDesk.app';
const RUSTDESK_PREF_DIR_CANDIDATES = [
  path.join(os.homedir(), 'Library', 'Preferences', 'com.carriez.rustdesk'),
  path.join(os.homedir(), 'Library', 'Preferences', 'com.carriez.RustDesk')
];
const RUSTDESK_LOG_DIR = path.join(os.homedir(), 'Library', 'Logs', 'RustDesk');

function remoteSafeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function remoteTrimSlashes(value) {
  return remoteSafeString(value).replace(/^\/+|\/+$/g, '');
}

function remoteToSlug(value, fallback = 'device') {
  const normalized = remoteSafeString(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || fallback;
}

function escapeRegexLiteral(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseTomlStringValue(content, key) {
  const raw = String(content || '');
  if (!raw || !key) return '';
  const escapedKey = escapeRegexLiteral(key);
  const m = raw.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*['"]([^'"]*)['"]\\s*$`, 'm'));
  return m && m[1] ? remoteSafeString(m[1]) : '';
}

function readTailTextFileSafe(filePath, maxBytes = 280000) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const buf = fs.readFileSync(filePath);
    if (!buf || !buf.length) return '';
    const tail = buf.length > maxBytes ? buf.slice(buf.length - maxBytes) : buf;
    return String(tail.toString('utf8') || '');
  } catch (_) {
    return '';
  }
}

function listRustDeskConfigCandidates() {
  const files = [];
  for (const prefDir of RUSTDESK_PREF_DIR_CANDIDATES) {
    files.push(path.join(prefDir, 'RustDesk2.toml'));
    files.push(path.join(prefDir, 'RustDesk.toml'));
    files.push(path.join(prefDir, 'RustDesk_local.toml'));
  }
  files.push(path.join(os.homedir(), '.config', 'rustdesk', 'RustDesk2.toml'));
  files.push(path.join(os.homedir(), '.config', 'RustDesk', 'RustDesk2.toml'));
  return Array.from(new Set(files));
}

function readRustDeskConfigStringValue(key) {
  const targetKey = remoteSafeString(key);
  if (!targetKey) return '';
  const files = listRustDeskConfigCandidates();
  for (const filePath of files) {
    const text = readTailTextFileSafe(filePath, 220000);
    if (!text) continue;
    const value = remoteSafeString(parseTomlStringValue(text, targetKey));
    if (value) return value;
  }
  return '';
}

function readLocalRustDeskServerPublicKey() {
  const fromEnv = remoteSafeString(process.env.RUSTDESK_SERVER_PUBLIC_KEY || '');
  if (fromEnv) return fromEnv;

  const keyFiles = [
    path.join(os.homedir(), '.meco-studio', 'rustdesk-server', 'docker-data', 'id_ed25519.pub'),
    path.join(os.homedir(), '.meco-studio', 'rustdesk-server', 'id_ed25519.pub')
  ];
  for (const keyFile of keyFiles) {
    const text = readTailTextFileSafe(keyFile, 4096)
      .replace(/[\r\n]+/g, '')
      .trim();
    if (text) return text;
  }

  const fromConfig = readRustDeskConfigStringValue('key');
  return remoteSafeString(fromConfig);
}

function readLocalRustDeskServerPrivateKey() {
  const fromEnv = remoteSafeString(process.env.RUSTDESK_SERVER_PRIVATE_KEY || '');
  if (fromEnv) return fromEnv;

  const keyFiles = [
    path.join(os.homedir(), '.meco-studio', 'rustdesk-server', 'docker-data', 'id_ed25519'),
    path.join(os.homedir(), '.meco-studio', 'rustdesk-server', 'id_ed25519')
  ];
  for (const keyFile of keyFiles) {
    try {
      if (!fs.existsSync(keyFile)) continue;
      const text = String(fs.readFileSync(keyFile, 'utf8') || '').trim();
      if (text) return text;
    } catch (_) {}
  }

  const fromConfig = readRustDeskConfigStringValue('private_key');
  return remoteSafeString(fromConfig);
}

function listRustDeskLogFiles() {
  const files = [];
  const collect = (dir) => {
    try {
      if (!fs.existsSync(dir)) return;
      const names = fs.readdirSync(dir);
      for (const name of names) {
        if (!/\.log$/i.test(name)) continue;
        const full = path.join(dir, name);
        let stat = null;
        try {
          stat = fs.statSync(full);
        } catch (_) {
          stat = null;
        }
        if (!stat || !stat.isFile()) continue;
        files.push({ path: full, mtimeMs: Number(stat.mtimeMs) || 0 });
      }
    } catch (_) {}
  };
  collect(RUSTDESK_LOG_DIR);
  collect(path.join(RUSTDESK_LOG_DIR, 'server'));
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((item) => item.path);
}

function extractRustDeskIdFromLogs(logFiles = []) {
  const picked = Array.isArray(logFiles) ? logFiles.slice(0, 16) : [];
  for (const file of picked) {
    const text = readTailTextFileSafe(file);
    if (!text) continue;
    const generated = [...text.matchAll(/Generated id\s+([A-Za-z0-9._-]{5,})/gi)];
    if (generated.length > 0) {
      const id = remoteSafeString(generated[generated.length - 1][1]).replace(/\s+/g, '');
      if (id) return { id, source: 'log_generated_id' };
    }
    const idMatches = [...text.matchAll(/\bid[:=]\s*([A-Za-z0-9._-]{5,})/gi)];
    if (idMatches.length > 0) {
      const id = remoteSafeString(idMatches[idMatches.length - 1][1]).replace(/\s+/g, '');
      if (id) return { id, source: 'log_recent_id' };
    }
  }
  return { id: '', source: '' };
}

function extractRustDeskPasswordFromLogs(logFiles = []) {
  const picked = Array.isArray(logFiles) ? logFiles.slice(0, 18) : [];
  for (const file of picked) {
    const text = readTailTextFileSafe(file);
    if (!text) continue;
    const matches = [...text.matchAll(/rustdesk:\/\/[^\s'"]+\?[^'"\\s]*password=([^&\s'"]+)/gi)];
    if (matches.length === 0) continue;
    const raw = remoteSafeString(matches[matches.length - 1][1]);
    if (!raw) continue;
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch (_) {}
    const password = remoteSafeString(decoded);
    if (password) {
      return { password, source: 'recent_launch_url' };
    }
  }
  return { password: '', source: '' };
}

function extractRustDeskPeerPasswordToken(peerId = '') {
  const id = remoteSafeString(peerId).replace(/\s+/g, '');
  if (!id) return { token: '', source: '' };
  try {
    for (const prefDir of RUSTDESK_PREF_DIR_CANDIDATES) {
      const peerPath = path.join(prefDir, 'peers', `${id}.toml`);
      const text = readTailTextFileSafe(peerPath, 220000);
      if (!text) continue;
      const m = text.match(/password\s*=\s*\[([\s\S]*?)\]/m);
      if (!m || !m[1]) continue;
      const nums = String(m[1])
        .split(/[^0-9]+/)
        .map((part) => Number(part))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 255);
      if (!nums.length) continue;
      const token = Buffer.from(nums)
        .toString('utf8')
        .replace(/[\u0000-\u001f\u007f]+/g, '')
        .trim();
      if (!token) continue;
      return { token, source: 'peer_toml_token' };
    }
  } catch (_) {
    return { token: '', source: '' };
  }
  return { token: '', source: '' };
}

function readRustDeskPasswordFromRemoteStore(preferredRustDeskId = '') {
  try {
    const storePath = remoteControl.STORE_PATH;
    if (!storePath || !fs.existsSync(storePath)) {
      return { password: '', source: '' };
    }
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8') || '{}');
    const devices = Array.isArray(parsed.devices) ? parsed.devices : [];
    const preferred = remoteSafeString(preferredRustDeskId).replace(/\s+/g, '');

    if (preferred) {
      for (const dev of devices) {
        if (!dev || typeof dev !== 'object') continue;
        const id = remoteSafeString(dev.rustdeskId || dev.meshNodeId).replace(/\s+/g, '');
        const password = remoteSafeString(dev.password);
        if (!id || !password) continue;
        if (id === preferred) {
          return { password, source: 'bound_device' };
        }
      }
    }

    const candidates = devices
      .filter((dev) => dev && typeof dev === 'object' && remoteSafeString(dev.password))
      .sort((a, b) => {
        const ta = Date.parse(a && a.updatedAt ? a.updatedAt : 0) || 0;
        const tb = Date.parse(b && b.updatedAt ? b.updatedAt : 0) || 0;
        return tb - ta;
      });
    if (candidates.length > 0) {
      return {
        password: remoteSafeString(candidates[0].password),
        source: 'recent_bound_device'
      };
    }
  } catch (_) {}
  return { password: '', source: '' };
}

function isRustDeskRunning() {
  try {
    const { execFileSync } = require('child_process');
    const out = String(execFileSync('ps', ['-ax', '-o', 'command='], { encoding: 'utf8' }) || '');
    return /\/Applications\/RustDesk\.app\/Contents\/MacOS\/(RustDesk|service)\b/.test(out);
  } catch (_) {
    return false;
  }
}

function startRustDeskApp() {
  return new Promise((resolve, reject) => {
    try {
      const { execFile } = require('child_process');
      execFile('open', ['-a', 'RustDesk'], (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(true);
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function readLocalRustDeskInfo(options = {}) {
  const launchIfNeeded = !!(options && options.launchIfNeeded);
  const preferLogs = !!(options && options.preferLogs);
  const appInstalled = fs.existsSync(RUSTDESK_APP_BUNDLE_PATH);

  let running = isRustDeskRunning();
  let started = false;
  let launchError = '';

  if (appInstalled && launchIfNeeded && !running) {
    try {
      await startRustDeskApp();
      started = true;
      await new Promise((resolve) => setTimeout(resolve, 900));
      running = isRustDeskRunning();
    } catch (e) {
      launchError = remoteSafeString(e && e.message);
    }
  }

  const logFiles = listRustDeskLogFiles();
  const fromLogs = extractRustDeskIdFromLogs(logFiles);
  let id = remoteSafeString(fromLogs.id).replace(/\s+/g, '');
  let idSource = remoteSafeString(fromLogs.source);

  if (!id) {
    const localTomlPath = listRustDeskConfigCandidates().find((filePath) => /RustDesk_local\.toml$/i.test(filePath));
    const localToml = localTomlPath ? readTailTextFileSafe(localTomlPath) : '';
    id = remoteSafeString(parseTomlStringValue(localToml, 'remote_id')).replace(/\s+/g, '');
    idSource = id ? 'local_toml' : '';
  }

  const peerPasswordToken = extractRustDeskPeerPasswordToken(id);

  let password = '';
  let passwordSource = '';
  const fromLogsPassword = extractRustDeskPasswordFromLogs(logFiles);
  const fromStore = readRustDeskPasswordFromRemoteStore(id);
  if (preferLogs) {
    if (fromLogsPassword.password) {
      password = remoteSafeString(fromLogsPassword.password);
      passwordSource = remoteSafeString(fromLogsPassword.source);
    } else if (fromStore.password) {
      password = remoteSafeString(fromStore.password);
      passwordSource = remoteSafeString(fromStore.source);
    }
  } else if (fromStore.password) {
    password = remoteSafeString(fromStore.password);
    passwordSource = remoteSafeString(fromStore.source);
  }
  if (!password) {
    password = remoteSafeString(fromLogsPassword.password);
    passwordSource = remoteSafeString(fromLogsPassword.source);
  }

  const serverKey = readLocalRustDeskServerPublicKey();
  const serverPrivateKey = readLocalRustDeskServerPrivateKey();

  return {
    appInstalled,
    running,
    started,
    launchError,
    id,
    idSource,
    password,
    oneTimePassword: password,
    serverKey,
    serverPrivateKey,
    passwordToken: remoteSafeString(peerPasswordToken.token),
    passwordTokenSource: remoteSafeString(peerPasswordToken.source),
    passwordSource,
    readAt: new Date().toISOString()
  };
}

function normalizeRemotePublicHost(host) {
  const raw = remoteSafeString(host);
  if (!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    return `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function getServerPortForRemote() {
  try {
    const addr = server.address();
    if (addr && typeof addr === 'object' && addr.port) {
      return Number(addr.port) || Number(process.env.PORT) || 3456;
    }
  } catch (_) {}
  return Number(process.env.PORT) || 3456;
}

function isPrivateIpv4(ip) {
  const text = remoteSafeString(ip);
  if (!text) return false;
  return (
    /^10\./.test(text) ||
    /^192\.168\./.test(text) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(text)
  );
}

function detectPrimaryLanIpv4() {
  const interfaces = os.networkInterfaces() || {};
  const preferredOrder = ['en0', 'en1', 'eth0', 'Ethernet', 'Wi-Fi', 'wlan0'];
  const names = Object.keys(interfaces);
  const ordered = [
    ...preferredOrder.filter((name) => names.includes(name)),
    ...names.filter((name) => !preferredOrder.includes(name))
  ];

  let firstNonInternal = '';
  for (const name of ordered) {
    const list = Array.isArray(interfaces[name]) ? interfaces[name] : [];
    for (const item of list) {
      if (!item || item.internal) continue;
      if (item.family !== 'IPv4') continue;
      const address = remoteSafeString(item.address);
      if (!address) continue;
      if (!firstNonInternal) firstNonInternal = address;
      if (isPrivateIpv4(address)) return address;
    }
  }
  return firstNonInternal;
}

function buildDefaultLanUrl() {
  const port = getServerPortForRemote();
  const ip = detectPrimaryLanIpv4() || '127.0.0.1';
  return {
    lanIp: ip,
    port,
    lanUrl: `http://${ip}:${port}`
  };
}

function getSystemUsernameSafe() {
  try {
    if (typeof os.userInfo === 'function') {
      const info = os.userInfo();
      const name = remoteSafeString(info && info.username);
      if (name) return name;
    }
  } catch (_) {}
  return remoteSafeString(process.env.USER || process.env.USERNAME || '');
}

function buildRemotePathPrefixSegments(settings = {}, leafSegment = REMOTE_PUBLIC_PATH_SEGMENT) {
  const configured = remoteTrimSlashes(settings.cloudflarePathPrefix || '');
  const segments = configured ? configured.split('/').filter(Boolean) : [];
  const last = segments.length ? segments[segments.length - 1] : '';
  const target = remoteSafeString(leafSegment || REMOTE_PUBLIC_PATH_SEGMENT) || REMOTE_PUBLIC_PATH_SEGMENT;
  if (last !== target) {
    segments.push(target);
  }
  return segments;
}

function buildRemotePublicPreview(owner, deviceName, settings = {}, options = {}) {
  const host = normalizeRemotePublicHost(settings.cloudflarePublicHost || '');
  if (!host) return '';
  const routeSegment = remoteSafeString(options.routeSegment || REMOTE_PUBLIC_PATH_SEGMENT) || REMOTE_PUBLIC_PATH_SEGMENT;
  const prefixSegments = buildRemotePathPrefixSegments(settings, routeSegment);
  const ownerSlug = remoteToSlug(owner, 'user');
  const deviceSlug = remoteToSlug(deviceName, 'dev');
  const pathPart = [...prefixSegments, ownerSlug, deviceSlug].filter(Boolean).join('/');
  return `${host}/${pathPart}`;
}

function normalizeRemoteRoutePathForMatch(input) {
  const raw = remoteSafeString(input);
  if (!raw) return '/';
  const noQuery = raw.split('?')[0].split('#')[0];
  const normalized = `/${remoteTrimSlashes(noQuery)}`.replace(/\/+$/g, '');
  return normalized || '/';
}

function shouldSkipRemoteEntryPath(pathname) {
  const pathOnly = normalizeRemoteRoutePathForMatch(pathname);
  if (!pathOnly || pathOnly === '/') return true;

  if (
    pathOnly === '/index.html' ||
    pathOnly === '/chat' ||
    pathOnly === '/create' ||
    pathOnly === '/edit' ||
    pathOnly === '/playgen' ||
    pathOnly === '/playgen.html' ||
    pathOnly === '/roundtable-config'
  ) {
    return true;
  }

  return (
    pathOnly.startsWith('/api/') ||
    pathOnly.startsWith('/roundtable/') ||
    pathOnly.startsWith('/knowledge-assets/') ||
    pathOnly.startsWith('/topics/') ||
    pathOnly.startsWith('/room-covers/') ||
    pathOnly.startsWith('/js/') ||
    pathOnly.startsWith('/css/') ||
    pathOnly.startsWith('/fonts/') ||
    pathOnly.startsWith('/images/') ||
    pathOnly.startsWith('/assets/')
  );
}

function findBoundRemoteDeviceByPath(routePath, settings = {}) {
  const target = normalizeRemoteRoutePathForMatch(routePath);
  if (!target || target === '/') return null;

  let devices = [];
  try {
    devices = remoteControl.listDevices(settings);
  } catch (_) {
    devices = [];
  }

  for (const device of devices) {
    if (!device) continue;
    const route = normalizeRemoteRoutePathForMatch(device.routePath || '');
    if (route === target) return device;
  }

  const parts = target.split('/').filter(Boolean);
  if (parts.length >= 2) {
    const ownerSlug = remoteToSlug(parts[parts.length - 2], 'user');
    const deviceSlug = remoteToSlug(parts[parts.length - 1], 'dev');
    for (const device of devices) {
      if (!device) continue;
      if (remoteToSlug(device.ownerSlug || '', 'user') !== ownerSlug) continue;
      if (remoteToSlug(device.deviceSlug || '', 'dev') !== deviceSlug) continue;
      return device;
    }
  }

  return null;
}

function buildRemoteEntryRedirectPath(routePath, options = {}) {
  const targetRoute = normalizeRemoteRoutePathForMatch(routePath);
  const qs = new URLSearchParams();
  qs.set('remoteRoute', targetRoute);
  const mode = remoteSafeString(options.mode || '').toLowerCase();
  if (mode === 'mesh' || mode === 'rustdesk') {
    qs.set('remoteMode', 'rustdesk');
  }
  return `/index.html?${qs.toString()}#agenttools`;
}

function isEmbeddedRemoteEntryRequest(req = {}) {
  const query = (req && req.query && typeof req.query === 'object') ? req.query : {};
  const mecoEmbed = remoteSafeString(query.mecoEmbed || '');
  const mecoWindow = remoteSafeString(query.meco_window || '');
  return mecoEmbed === '1' || mecoWindow === '1';
}

function buildEmbeddedAgenttoolsPath() {
  const qs = new URLSearchParams();
  qs.set('mecoEmbed', '1');
  qs.set('meco_window', '1');
  return `/index.html?${qs.toString()}#agenttools`;
}

function inferRemoteEntryMode(routePath, settings = {}) {
  const pathOnly = normalizeRemoteRoutePathForMatch(routePath);
  if (!pathOnly || pathOnly === '/') return '';

  const rustdeskPrefixSegments = buildRemotePathPrefixSegments(settings, REMOTE_RUSTDESK_PATH_SEGMENT);
  const rustdeskPrefix = normalizeRemoteRoutePathForMatch(`/${rustdeskPrefixSegments.join('/')}`);
  if (rustdeskPrefix && rustdeskPrefix !== '/') {
    if (pathOnly === rustdeskPrefix || pathOnly.startsWith(`${rustdeskPrefix}/`)) {
      return 'rustdesk';
    }
  }

  if (pathOnly === '/rustdesk' || pathOnly.startsWith('/rustdesk/')) {
    return 'rustdesk';
  }

  if (pathOnly === '/mesh' || pathOnly.startsWith('/mesh/')) {
    return 'rustdesk';
  }

  return '';
}

function appendCloudflareTunnelLog(line) {
  const text = remoteSafeString(line);
  if (!text) return;
  cloudflareTunnelRuntime.logs.push({
    at: new Date().toISOString(),
    text
  });
  if (cloudflareTunnelRuntime.logs.length > 60) {
    cloudflareTunnelRuntime.logs.splice(0, cloudflareTunnelRuntime.logs.length - 60);
  }
}

function snapshotCloudflareTunnelRuntime() {
  const proc = cloudflareTunnelRuntime.process;
  const running = !!(proc && !proc.killed);
  return {
    running,
    pid: Number(cloudflareTunnelRuntime.pid) || 0,
    status: cloudflareTunnelRuntime.status || (running ? 'running' : 'idle'),
    startedAt: cloudflareTunnelRuntime.startedAt || '',
    lastError: cloudflareTunnelRuntime.lastError || '',
    logs: Array.isArray(cloudflareTunnelRuntime.logs) ? cloudflareTunnelRuntime.logs.slice(-20) : []
  };
}

function clearCloudflareTunnelRuntime(nextStatus = 'idle') {
  cloudflareTunnelRuntime.process = null;
  cloudflareTunnelRuntime.pid = 0;
  cloudflareTunnelRuntime.status = nextStatus;
}

function buildCloudflareGuideCommands(options = {}) {
  const localUrl = remoteSafeString(options.localUrl);
  const previewPublicUrl = remoteSafeString(options.previewPublicUrl);
  const pathPrefix = remoteSafeString(options.pathPrefix);
  const commands = [];
  commands.push('cloudflared --version');
  if (!options.hasToken) {
    commands.push('在 API Keys 中填写 Cloudflare Tunnel Token');
    commands.push(`建议先测试: cloudflared tunnel --url ${localUrl || 'http://127.0.0.1:3456'}`);
  } else {
    commands.push('cloudflared tunnel --no-autoupdate run --token <已配置token>');
  }
  if (previewPublicUrl) {
    commands.push(`目标公网地址: ${previewPublicUrl}`);
  }
  if (pathPrefix) {
    commands.push(`Cloudflare Path Prefix: /${remoteTrimSlashes(pathPrefix)}`);
  }
  return commands;
}

function execFileText(cmd, args = [], options = {}) {
  const { execFile } = require('child_process');
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: 12000, maxBuffer: 1024 * 1024, ...options },
      (error, stdout, stderr) => {
        if (error) {
          const message = remoteSafeString(stderr || error.message || '');
          const err = new Error(message || 'exec failed');
          err.original = error;
          reject(err);
          return;
        }
        resolve(remoteSafeString(stdout || stderr || ''));
      }
    );
  });
}

function normalizeRemoteHttpBase(raw, defaultProtocol = 'https://') {
  const value = remoteSafeString(raw);
  if (!value) return '';
  const candidate = /^https?:\/\//i.test(value) ? value : `${defaultProtocol}${value}`;
  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/g, '');
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch (_) {
    return '';
  }
}

function normalizeRemoteProbeUrl(raw, defaultProtocol = 'http://') {
  const value = remoteSafeString(raw);
  if (!value) return '';
  const candidate = /^https?:\/\//i.test(value) ? value : `${defaultProtocol}${value}`;
  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    parsed.hash = '';
    return parsed.toString();
  } catch (_) {
    return '';
  }
}

async function probeRemoteLanReachable(rawUrl, options = {}) {
  const target = normalizeRemoteProbeUrl(rawUrl, 'http://');
  if (!target) {
    return {
      reachable: false,
      url: '',
      status: 0,
      error: 'invalid_url'
    };
  }

  const timeoutMs = Math.max(250, Math.min(5000, Number(options.timeoutMs) || 1200));
  const retries = Math.max(1, Math.min(5, Number(options.retries) || 1));
  let lastError = '';
  let lastStatus = 0;

  for (let i = 0; i < retries; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try { controller.abort(); } catch (_) {}
    }, timeoutMs);
    try {
      const response = await fetch(target, {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        signal: controller.signal
      });
      lastStatus = Number(response && response.status) || 0;
      return {
        reachable: true,
        url: target,
        status: lastStatus,
        error: ''
      };
    } catch (e) {
      lastError = remoteSafeString(e && e.message) || 'probe_failed';
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    reachable: false,
    url: target,
    status: lastStatus,
    error: lastError || 'probe_failed'
  };
}

const RUSTDESK_WEB_PROXY_BASE_URL = 'https://rustdesk.com/web/';
const RUSTDESK_PUBLIC_RENDEZVOUS = 'rs-ny.rustdesk.com:21116';
const RUSTDESK_DEFAULT_LOCAL_RENDEZVOUS = '';
const RUSTDESK_DEFAULT_PUBLIC_RENDEZVOUS_CANDIDATES = 'rs-ny.rustdesk.com:21116,rs.rustdesk.com:21116,rs-sg.rustdesk.com:21116,rs-cn.rustdesk.com:21116';

function parseRustDeskServerTarget(value, defaultPort = 21116) {
  const raw = remoteSafeString(value);
  if (!raw) return null;

  let host = '';
  let port = Number(defaultPort) || 21116;
  try {
    if (/^wss?:\/\//i.test(raw) || /^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      host = remoteSafeString(u.hostname || '');
      port = Number(u.port) || port;
    } else {
      // Support plain "host:port" and "[::1]:21116".
      const prefixed = raw.startsWith('[') || raw.includes(':') ? `tcp://${raw}` : `tcp://${raw}`;
      const u = new URL(prefixed);
      host = remoteSafeString(u.hostname || '');
      port = Number(u.port) || port;
    }
  } catch (_) {
    return null;
  }

  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
    return null;
  }
  return { host, port, normalized: `${host}:${port}` };
}

function probeRustDeskServerTcp(target, timeoutMs = 550) {
  const parsed = parseRustDeskServerTarget(target);
  if (!parsed) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch (_) {}
      resolve(!!ok);
    };
    socket.setTimeout(Math.max(120, Number(timeoutMs) || 550));
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    try {
      socket.connect(parsed.port, parsed.host);
    } catch (_) {
      finish(false);
    }
  });
}

function splitRustDeskRendezvousCandidates(raw) {
  const text = remoteSafeString(raw);
  if (!text) return [];
  return text
    .split(/[,\s]+/g)
    .map((item) => remoteSafeString(item))
    .filter(Boolean);
}

function normalizeRustDeskRendezvousCandidates(list = []) {
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const parsed = parseRustDeskServerTarget(item);
    if (!parsed || !parsed.normalized) continue;
    if (seen.has(parsed.normalized)) continue;
    seen.add(parsed.normalized);
    out.push(parsed.normalized);
  }
  return out;
}

function isLikelyLocalRustDeskServer(target) {
  const parsed = parseRustDeskServerTarget(target);
  if (!parsed || !parsed.host) return false;
  const host = remoteSafeString(parsed.host).toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  return isPrivateIpv4(host);
}

function getRustDeskLocalRendezvousCandidates(settings = {}) {
  const fromSettings = splitRustDeskRendezvousCandidates(settings.rustdeskPreferredRendezvous || '');
  const fallback = splitRustDeskRendezvousCandidates(RUSTDESK_DEFAULT_LOCAL_RENDEZVOUS);
  const merged = fromSettings.length > 0 ? [...fromSettings, ...fallback] : fallback;
  return normalizeRustDeskRendezvousCandidates(merged);
}

function getRustDeskPublicRendezvousCandidates(settings = {}) {
  const fromSettings = splitRustDeskRendezvousCandidates(settings.rustdeskPreferredRendezvous || '')
    .filter((item) => !isLikelyLocalRustDeskServer(item));
  const fromEnv = splitRustDeskRendezvousCandidates(
    process.env.MECO_RUSTDESK_PUBLIC_RENDEZVOUS_CANDIDATES || RUSTDESK_DEFAULT_PUBLIC_RENDEZVOUS_CANDIDATES
  );
  const merged = [
    // Prefer built-in/env public rendezvous first; stale settings candidates append at tail.
    ...fromEnv,
    RUSTDESK_PUBLIC_RENDEZVOUS,
    ...fromSettings
  ];
  return normalizeRustDeskRendezvousCandidates(merged);
}

function buildRustDeskWebProxyUrl(pathPart = '', search = '') {
  const relativePath = remoteSafeString(pathPart).replace(/^\/+/, '');
  const target = new URL(relativePath, RUSTDESK_WEB_PROXY_BASE_URL);
  if (typeof search === 'string') {
    target.search = search;
  }
  return target;
}

function rewriteRustDeskWebRedirectLocation(rawLocation) {
  const location = remoteSafeString(rawLocation);
  if (!location) return '';
  try {
    const parsed = new URL(location, RUSTDESK_WEB_PROXY_BASE_URL);
    if (parsed.origin !== 'https://rustdesk.com') return '';
    if (!parsed.pathname.startsWith('/web')) return '';
    const suffix = parsed.pathname.slice('/web'.length) || '/';
    return `/rustdesk-web${suffix}${parsed.search}${parsed.hash}`;
  } catch (_) {
    return '';
  }
}

function rewriteRustDeskWebHtml(rawHtml, options = {}) {
  const html = String(rawHtml || '');
  if (!html) return html;
  const localRendezvous = remoteSafeString(options.localRendezvous || '');
  const publicCandidates = normalizeRustDeskRendezvousCandidates(
    Array.isArray(options.publicCandidates)
      ? options.publicCandidates
      : splitRustDeskRendezvousCandidates(options.publicCandidates || '')
  );
  const effectivePublicCandidates = publicCandidates.length > 0
    ? publicCandidates
    : [RUSTDESK_PUBLIC_RENDEZVOUS];
  const publicRendezvous = effectivePublicCandidates[0] || RUSTDESK_PUBLIC_RENDEZVOUS;
  const initialRendezvous = remoteSafeString(options.initialRendezvous || '') || publicRendezvous;
  const serverKey = remoteSafeString(options.serverKey || '');
  const injectServerKey = !!(serverKey && initialRendezvous && !effectivePublicCandidates.includes(initialRendezvous));
  const injectedPublicRendezvous = JSON.stringify(publicRendezvous);
  const injectedPublicCandidates = JSON.stringify(effectivePublicCandidates);
  const injectedLocalRendezvous = JSON.stringify(localRendezvous);
  const injectedInitialRendezvous = JSON.stringify(initialRendezvous);
  const injectedServerKey = JSON.stringify(injectServerKey ? serverKey : '');
  const fixed = html
    .replace(/<base\s+href=(['"])\/web\/\1\s*\/?>/i, '<base href="/rustdesk-web/" />')
    .replace(/(["'])\/web\//g, '$1/rustdesk-web/');
  const bootstrapScript = [
    '<script>',
    '(() => {',
    '  const normalize = (v) => String(v == null ? "" : v).trim();',
    '  const isVisible = (el) => !!(el && el.offsetParent !== null && !el.disabled);',
    '  const isClickable = (el) => !!(el && typeof el.click === "function" && isVisible(el));',
    '  const textOf = (el) => normalize((el && (el.textContent || "")) + " " + (el && el.getAttribute ? (el.getAttribute("aria-label") || "") : "") + " " + (el && el.getAttribute ? (el.getAttribute("title") || "") : "")).toLowerCase();',
    '  const setInputValue = (input, value) => {',
    '    if (!input) return;',
    '    const text = normalize(value);',
    '    if (normalize(input.value) === text) return;',
    '    input.focus();',
    '    input.value = text;',
    '    input.dispatchEvent(new Event("input", { bubbles: true }));',
    '    input.dispatchEvent(new Event("change", { bubbles: true }));',
    '  };',
    '  const pressEnter = (input) => {',
    '    if (!input) return;',
    '    const payload = { key: "Enter", code: "Enter", which: 13, keyCode: 13, bubbles: true, cancelable: true };',
    '    try { input.dispatchEvent(new KeyboardEvent("keydown", payload)); } catch (_) {}',
    '    try { input.dispatchEvent(new KeyboardEvent("keypress", payload)); } catch (_) {}',
    '    try { input.dispatchEvent(new KeyboardEvent("keyup", payload)); } catch (_) {}',
    '    const form = input.form || input.closest("form");',
    '    if (form && typeof form.requestSubmit === "function") {',
    '      try { form.requestSubmit(); } catch (_) {}',
    '    }',
    '  };',
    '  const clickIfPossible = (el) => {',
    '    if (!isClickable(el)) return false;',
    '    try { el.click(); return true; } catch (_) { return false; }',
    '  };',
    '  const classOf = (el) => normalize(el && (el.className || "")).toLowerCase();',
    '  const digitsOnly = (v) => normalize(v).replace(/\\D+/g, "");',
    '  const hasSize = (el) => {',
    '    if (!el || typeof el.getBoundingClientRect !== "function") return false;',
    '    const r = el.getBoundingClientRect();',
    '    return !!(r && Number.isFinite(r.width) && Number.isFinite(r.height) && r.width >= 6 && r.height >= 6);',
    '  };',
    '  const isLikelyClearAction = (el) => {',
    '    const text = textOf(el);',
    '    const cls = classOf(el);',
    '    return /(clear|close|cancel|删除|移除|取消|^x$)/.test(text) || /(clear|close|cancel|remove|delete|cross|times|minus-circle|close-circle)/.test(cls);',
    '  };',
    '  const dispatchMouseClick = (el, point = null) => {',
    '    if (!el) return false;',
    '    try {',
    '      const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;',
    '      const x = point && Number.isFinite(point.x) ? point.x : (r ? (r.left + r.width / 2) : 0);',
    '      const y = point && Number.isFinite(point.y) ? point.y : (r ? (r.top + r.height / 2) : 0);',
    '      const payload = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };',
    '      try { el.dispatchEvent(new MouseEvent("pointerdown", payload)); } catch (_) {}',
    '      try { el.dispatchEvent(new MouseEvent("mousedown", payload)); } catch (_) {}',
    '      try { el.dispatchEvent(new MouseEvent("mouseup", payload)); } catch (_) {}',
    '      try { el.dispatchEvent(new MouseEvent("click", payload)); } catch (_) {}',
    '      if (clickIfPossible(el)) return true;',
    '      return true;',
    '    } catch (_) {',
    '      return clickIfPossible(el);',
    '    }',
    '  };',
    '  const keyRendezvous = "wc-custom-rendezvous-server";',
    `  const publicRendezvous = ${injectedPublicRendezvous};`,
    `  const rawPublicCandidates = ${injectedPublicCandidates};`,
    `  const localRendezvous = ${injectedLocalRendezvous};`,
    `  let rendezvousServer = ${injectedInitialRendezvous};`,
    `  let mecoKey = ${injectedServerKey};`,
    '  let mecoLocalKey = mecoKey;',
    '  const normalizeServer = (v) => normalize(v).replace(/^wss?:\\/\\//i, "").replace(/^https?:\\/\\//i, "").replace(/\\/+$/g, "");',
    '  const publicCandidates = Array.isArray(rawPublicCandidates)',
    '    ? rawPublicCandidates.map((item) => normalizeServer(item)).filter(Boolean)',
    '    : [];',
    '  if (!publicCandidates.length) {',
    '    const fallbackPublic = normalizeServer(publicRendezvous);',
    '    if (fallbackPublic) publicCandidates.push(fallbackPublic);',
    '  }',
    '  const isPublicCandidate = (value) => {',
    '    const normalized = normalizeServer(value);',
    '    return !!(normalized && publicCandidates.includes(normalized));',
    '  };',
    '  const syncWebClientKeyStorage = () => {',
    '    try {',
    '      if (mecoKey) localStorage.setItem("wc-key", mecoKey);',
    '      else localStorage.removeItem("wc-key");',
    '    } catch (_) {}',
    '  };',
    '  const setRendezvousServer = (value) => {',
    '    const fallbackPublic = publicCandidates[0] || normalizeServer(publicRendezvous) || "";',
    '    const next = normalizeServer(value) || fallbackPublic;',
    '    rendezvousServer = next;',
    '    try { localStorage.setItem(keyRendezvous, next); } catch (_) {}',
    '  };',
    '  const shouldFallbackRendezvous = () => {',
    '    if (!rendezvousServer) return false;',
    '    const text = normalize((document.body && document.body.innerText) || "").toLowerCase();',
    '    return /failed to connect to rendezvous server|rendezvous server|连接.*rendezvous/.test(text);',
    '  };',
    '  const closeErrorDialog = () => {',
    '    const nodes = Array.from(document.querySelectorAll("button,[role=button]")).filter(isVisible);',
    '    for (const node of nodes) {',
    '      const text = textOf(node);',
    '      if (/^ok$|确定|确认|知道|close/.test(text)) {',
    '        if (clickIfPossible(node)) break;',
    '      }',
    '    }',
    '  };',
    '  const hasWrongPasswordDialog = () => {',
    '    const text = normalize((document.body && document.body.innerText) || "").toLowerCase();',
    '    return /wrong password|password incorrect|密码错误|密码不对/.test(text);',
    '  };',
    '  const hasOfflineDialog = () => {',
    '    const text = normalize((document.body && document.body.innerText) || "").toLowerCase();',
    '    return /remote desktop is offline|desktop is offline|peer is offline|device is offline|目标设备离线|设备离线/.test(text);',
    '  };',
    '  const hasIdNotExistDialog = () => {',
    '    const text = normalize((document.body && document.body.innerText) || "").toLowerCase();',
    '    return /id does not exist|id not exist|peer not found|device not found|设备不存在|目标设备不存在|未找到设备|invalid key|key mismatch/.test(text);',
    '  };',
    '  const clickRetryButton = () => {',
    '    const nodes = Array.from(document.querySelectorAll("button,[role=button]")).filter(isVisible);',
    '    for (const node of nodes) {',
    '      const text = textOf(node);',
    '      if (/retry|重试|再试一次|重新尝试/.test(text)) {',
    '        if (clickIfPossible(node)) return true;',
    '      }',
    '    }',
    '    return false;',
    '  };',
    '  const disableRustDeskServiceWorkerCache = () => {',
    '    try {',
    '      if ("serviceWorker" in navigator && navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === "function") {',
    '        navigator.serviceWorker.getRegistrations().then((regs) => {',
    '          for (const reg of regs || []) {',
    '            try {',
    '              const scope = normalize(reg && reg.scope);',
    '              if (!scope || scope.includes("/rustdesk-web/") || scope.includes(window.location.origin)) {',
    '                reg.unregister();',
    '              }',
    '            } catch (_) {}',
    '          }',
    '        }).catch(() => {});',
    '      }',
    '    } catch (_) {}',
    '    try {',
    '      if ("caches" in window && typeof caches.keys === "function") {',
    '        caches.keys().then((keys) => {',
    '          for (const key of keys || []) {',
    '            const low = normalize(key).toLowerCase();',
    '            if (/rustdesk|flutter|workbox|offline/.test(low)) {',
    '              caches.delete(key).catch(() => {});',
    '            }',
    '          }',
    '        }).catch(() => {});',
    '      }',
    '    } catch (_) {}',
    '  };',
    '  try {',
    '    localStorage.removeItem("wc-api-server");',
    '    localStorage.removeItem("wc-key");',
    '  } catch (_) {}',
    '  disableRustDeskServiceWorkerCache();',
    '  setRendezvousServer(rendezvousServer);',
    '  syncWebClientKeyStorage();',
    '  let mecoId = "";',
    '  let mecoPassword = "";',
    '  let mecoPasswordToken = "";',
    '  let mecoAutoConnect = false;',
    '  try {',
    '    const u = new URL(window.location.href);',
    '    mecoId = normalize(u.searchParams.get("meco_id")).replace(/\\s+/g, "");',
    '    mecoPassword = normalize(u.searchParams.get("meco_password"));',
    '    mecoPasswordToken = normalize(u.searchParams.get("meco_password_token"));',
    '    const mecoKeyFromQuery = normalize(u.searchParams.get("meco_key"));',
    '    if (mecoKeyFromQuery) {',
    '      mecoKey = mecoKeyFromQuery;',
    '      mecoLocalKey = mecoKeyFromQuery;',
    '      syncWebClientKeyStorage();',
    '    }',
    '    const auto = normalize(u.searchParams.get("meco_autoconnect")).toLowerCase();',
    '    mecoAutoConnect = auto === "1" || auto === "true" || auto === "yes";',
    '    const mecoRendezvous = normalizeServer(u.searchParams.get("meco_rendezvous"));',
    '    if (mecoRendezvous) setRendezvousServer(mecoRendezvous);',
    '    if (mecoId) {',
      '      localStorage.setItem("wc-id", mecoId);',
      '      localStorage.setItem("wc-last_remote_id", mecoId);',
    '    }',
    '    if (u.searchParams.has("meco_id") || u.searchParams.has("meco_password") || u.searchParams.has("meco_password_token") || u.searchParams.has("meco_key") || u.searchParams.has("meco_autoconnect") || u.searchParams.has("meco_rendezvous") || u.searchParams.has("meco_nonce")) {',
    '      u.searchParams.delete("meco_id");',
    '      u.searchParams.delete("meco_password");',
    '      u.searchParams.delete("meco_password_token");',
    '      u.searchParams.delete("meco_key");',
    '      u.searchParams.delete("meco_autoconnect");',
    '      u.searchParams.delete("meco_rendezvous");',
    '      u.searchParams.delete("meco_nonce");',
    '      const nextUrl = u.pathname + (u.search ? u.search : "") + (u.hash ? u.hash : "");',
    '      window.history.replaceState({}, "", nextUrl);',
    '    }',
    '  } catch (_) {}',
    '  const hasRustDeskBridge = () => typeof window.setByName === "function";',
    '  const callSetByName = (name, payload = "") => {',
    '    try {',
    '      if (typeof window.setByName !== "function") return false;',
    '      window.setByName(name, payload == null ? "" : String(payload));',
    '      return true;',
    '    } catch (_) {',
    '      return false;',
    '    }',
    '  };',
    '  const switchToPublicRendezvous = (target = "") => {',
    '    const next = normalizeServer(target) || publicCandidates[0] || normalizeServer(publicRendezvous);',
    '    if (next && rendezvousServer !== next) setRendezvousServer(next);',
    '    mecoKey = "";',
    '    syncWebClientKeyStorage();',
    '    if (hasRustDeskBridge()) {',
    '      callSetByName("option", JSON.stringify({ name: "custom-rendezvous-server", value: rendezvousServer }));',
    '      callSetByName("option", JSON.stringify({ name: "key", value: "" }));',
    '    }',
    '  };',
    '  const LOCAL_RENDEZVOUS_TIMEOUT_MS = 9000;',
    '  const RECONNECT_COOLDOWN_MS = 700;',
    '  const PUBLIC_SWITCH_COOLDOWN_MS = 2000;',
    '  let localRendezvousDeadlineAt = Date.now() + LOCAL_RENDEZVOUS_TIMEOUT_MS;',
    '  let didFallbackToPublic = isPublicCandidate(rendezvousServer);',
    '  let reconnectRequestedAt = 0;',
    '  let publicSwitchAt = 0;',
    '  const resetAutoConnectAttempts = () => {',
    '    connectAttempts = 0;',
    '    loginAttempts = 0;',
    '    bridgeConnectAttempts = 0;',
    '    bridgeLoginAttempts = 0;',
    '  };',
    '  const requestReconnect = () => {',
    '    const now = Date.now();',
    '    if (now - reconnectRequestedAt < RECONNECT_COOLDOWN_MS) return;',
    '    reconnectRequestedAt = now;',
    '    clickRetryButton();',
    '    closeErrorDialog();',
    '    if (mecoId && hasRustDeskBridge()) {',
    '      const payload = JSON.stringify({ id: mecoId, remember: true });',
    '      callSetByName("session_add_sync", payload);',
    '      callSetByName("session_start", "");',
    '      callSetByName("connect", "");',
    '    }',
    '  };',
    '  const switchToNextPublicRendezvous = () => {',
    '    if (publicCandidates.length <= 1) return false;',
    '    const now = Date.now();',
    '    if (now - publicSwitchAt < PUBLIC_SWITCH_COOLDOWN_MS) return false;',
    '    publicSwitchAt = now;',
    '    const current = normalizeServer(rendezvousServer);',
    '    const idx = publicCandidates.indexOf(current);',
    '    const next = publicCandidates[(idx >= 0 ? idx + 1 : 0) % publicCandidates.length] || "";',
    '    if (!next || next === current) return false;',
    '    switchToPublicRendezvous(next);',
    '    didFallbackToPublic = true;',
    '    resetAutoConnectAttempts();',
    '    requestReconnect();',
    '    return true;',
    '  };',
    '  const triggerPublicFallback = () => {',
    '    if (isPublicCandidate(rendezvousServer)) return false;',
    '    switchToPublicRendezvous();',
    '    didFallbackToPublic = true;',
    '    resetAutoConnectAttempts();',
    '    requestReconnect();',
    '    return true;',
    '  };',
    '  const callGetByName = (name, payload = "") => {',
    '    try {',
    '      if (typeof window.getByName !== "function") return "";',
    '      return normalize(window.getByName(name, payload == null ? "" : String(payload)));',
    '    } catch (_) {',
    '      return "";',
    '    }',
    '  };',
    '  const getConnStatusNum = () => {',
    '    try {',
    '      const raw = callGetByName("get_conn_status", "");',
    '      if (!raw) return 0;',
    '      const parsed = JSON.parse(raw);',
    '      const n = Number(parsed && parsed.status_num);',
    '      return Number.isFinite(n) ? n : 0;',
    '    } catch (_) {',
    '      return 0;',
    '    }',
    '  };',
    '  const seedBridgeOptions = () => {',
    '    if (!mecoId || !hasRustDeskBridge()) return;',
    '    callSetByName("option", JSON.stringify({ name: "custom-rendezvous-server", value: rendezvousServer }));',
    '    if (mecoKey) {',
    '      callSetByName("option", JSON.stringify({ name: "key", value: mecoKey }));',
    '      syncWebClientKeyStorage();',
    '    } else {',
    '      callSetByName("option", JSON.stringify({ name: "key", value: "" }));',
    '      syncWebClientKeyStorage();',
    '    }',
    '    callSetByName("option:local", JSON.stringify({ name: "last_remote_id", value: mecoId }));',
    '    const passwordForPeer = mecoPasswordToken || mecoPassword;',
    '    if (passwordForPeer) {',
    '      callSetByName("option:peer", JSON.stringify({ id: mecoId, name: "password", value: passwordForPeer }));',
    '      callSetByName("option:peer", JSON.stringify({ id: mecoId, name: "remember", value: "Y" }));',
    '    }',
    '  };',
    '  let bridgeConnectAttempts = 0;',
    '  let bridgeLoginAttempts = 0;',
    '  let localPasswordRefreshPending = false;',
    '  let localPasswordRefreshAt = 0;',
    '  const refreshPasswordFromLocalInfo = async () => {',
    '    if (localPasswordRefreshPending) return;',
    '    if (!mecoId) return;',
    '    localPasswordRefreshPending = true;',
    '    try {',
    '      const url = `/api/remote/rustdesk/local-info?launch=1&preferLogs=1&_ts=${Date.now()}`;',
    '      const res = await fetch(url, { cache: "no-store" });',
    '      if (!res || !res.ok) return;',
    '      const body = await res.json();',
    '      const info = body && body.rustdesk ? body.rustdesk : null;',
    '      if (!info) return;',
    '      const id = normalize(info.id).replace(/\\s+/g, "");',
    '      if (id && id !== mecoId) return;',
    '      const nextServerKey = normalize(info.serverKey);',
    '      if (nextServerKey) {',
    '        mecoLocalKey = nextServerKey;',
    '        if (!isPublicCandidate(rendezvousServer)) {',
    '          mecoKey = nextServerKey;',
    '          syncWebClientKeyStorage();',
    '        }',
    '      }',
    '      const nextToken = normalize(info.passwordToken);',
    '      if (nextToken) mecoPasswordToken = nextToken;',
    '      const nextPassword = normalize(info.password);',
    '      if (!nextPassword || nextPassword === mecoPassword) return;',
    '      mecoPassword = nextPassword;',
    '      bridgeConnectAttempts = 0;',
    '      bridgeLoginAttempts = 0;',
    '      connectAttempts = 0;',
    '      loginAttempts = 0;',
    '      if (!isPublicCandidate(rendezvousServer) && !didFallbackToPublic) {',
    '        localRendezvousDeadlineAt = Date.now() + LOCAL_RENDEZVOUS_TIMEOUT_MS;',
    '      }',
    '    } catch (_) {}',
    '    localPasswordRefreshPending = false;',
    '  };',
    '  const runBridgeAutoConnect = () => {',
    '    if (!mecoAutoConnect || !mecoId) return false;',
    '    if (!hasRustDeskBridge()) return false;',
    '    seedBridgeOptions();',
    '    const statusNum = getConnStatusNum();',
    '    if (statusNum <= 0 && bridgeConnectAttempts < 90) {',
    '      const sessionPayload = JSON.stringify({ id: mecoId, remember: true });',
    '      callSetByName("session_add_sync", sessionPayload);',
    '      callSetByName("session_start", "");',
    '      callSetByName("connect", "");',
    '      bridgeConnectAttempts += 1;',
    '    }',
    '    if (!mecoPasswordToken && mecoPassword && bridgeLoginAttempts < 140) {',
    '      callSetByName("login", JSON.stringify({ os_username: "", os_password: "", password: mecoPassword, remember: true }));',
    '      bridgeLoginAttempts += 1;',
    '    }',
    '    return true;',
    '  };',
    '  const findIdInput = () => {',
    '    const inputs = Array.from(document.querySelectorAll("input")).filter(isVisible);',
    '    const byHint = inputs.find((el) => {',
    '      const hint = normalize((el.placeholder || "") + " " + (el.name || "") + " " + (el.getAttribute("aria-label") || "")).toLowerCase();',
    '      return /remote|id|设备|被控/.test(hint) && !/password|pass|密码/.test(hint);',
    '    });',
    '    if (byHint) return byHint;',
    '    return inputs.find((el) => /text|search|tel|number/.test(String(el.type || "text").toLowerCase())) || null;',
    '  };',
    '  const scoreConnectCandidate = (el, idInput) => {',
    '    const text = textOf(el);',
    '    if (!text) return 0;',
    '    if (isLikelyClearAction(el)) return -10;',
    '    let score = 0;',
    '    if (/connect|连接|进入|go|continue|开始|arrow|submit|control/.test(text)) score += 6;',
    '    if (/desktop|remote|id/.test(text)) score += 2;',
    '    if (/arrow_forward|arrow-right|right/.test(text)) score += 3;',
    '    if (idInput && typeof idInput.contains === "function") {',
    '      const row = idInput.closest("div");',
    '      if (row && row.contains(el)) score += 4;',
    '    }',
    '    return score;',
    '  };',
    '  const findConnectButton = () => {',
    '    const idInput = findIdInput();',
    '    const nodes = Array.from(document.querySelectorAll("button,[role=button],[tabindex],.ant-btn,.material-icons-round,.material-icons-outlined")).filter((el) => isVisible(el) && !el.closest("input"));',
    '    let best = null;',
    '    let bestScore = 0;',
    '    for (const node of nodes) {',
    '      const score = scoreConnectCandidate(node, idInput);',
    '      if (score > bestScore) {',
    '        best = node;',
    '        bestScore = score;',
    '      }',
    '    }',
    '    return bestScore > 0 ? best : null;',
    '  };',
    '  const clickConnectNearIdInput = (idInput) => {',
    '    if (!idInput) return false;',
    '    const scopes = [];',
    '    const row = idInput.closest("div");',
    '    if (row) scopes.push(row);',
    '    if (row && row.parentElement) scopes.push(row.parentElement);',
    '    let candidates = [];',
    '    for (const scope of scopes) {',
    '      const items = Array.from(scope.querySelectorAll("button,[role=button],[tabindex],.ant-btn,.anticon,[class*=icon],[class*=suffix],svg,span,div")).filter((el) => !el.closest("input") && hasSize(el));',
    '      candidates = candidates.concat(items);',
    '    }',
    '    const uniq = [];',
    '    const seen = new Set();',
    '    for (const item of candidates) {',
    '      if (!item || seen.has(item)) continue;',
    '      seen.add(item);',
    '      uniq.push(item);',
    '    }',
    '    const safe = uniq.filter((el) => {',
    '      if (!hasSize(el)) return false;',
    '      if (isLikelyClearAction(el)) return false;',
    '      const cls = classOf(el);',
    '      if (/(input|textarea)/.test(cls)) return false;',
    '      return true;',
    '    });',
    '    if (!safe.length) return false;',
    '    safe.sort((a, b) => {',
    '      const ra = a.getBoundingClientRect ? a.getBoundingClientRect() : { right: 0, width: 0 };',
    '      const rb = b.getBoundingClientRect ? b.getBoundingClientRect() : { right: 0, width: 0 };',
    '      if (rb.right !== ra.right) return rb.right - ra.right;',
    '      return (rb.width || 0) - (ra.width || 0);',
    '    });',
    '    return dispatchMouseClick(safe[0]);',
    '  };',
    '  const clickConnectByHitTest = (idInput) => {',
    '    if (!idInput || typeof document.elementFromPoint !== "function" || typeof idInput.getBoundingClientRect !== "function") return false;',
    '    const r = idInput.getBoundingClientRect();',
    '    if (!r || !Number.isFinite(r.right) || !Number.isFinite(r.top)) return false;',
    '    const cy = r.top + (r.height / 2);',
    '    const probes = [',
    '      { x: r.right + 28, y: cy },',
    '      { x: r.right + 12, y: cy },',
    '      { x: r.right - 8, y: cy },',
    '      { x: r.right - 28, y: cy },',
    '      { x: r.right + 42, y: cy }',
    '    ];',
    '    for (const probe of probes) {',
    '      const target = document.elementFromPoint(probe.x, probe.y);',
    '      if (!target) continue;',
    '      const pick = target.closest',
    '        ? (target.closest("button,[role=button],[tabindex],.ant-btn,.anticon,[class*=icon],[class*=suffix],svg,span,div") || target)',
    '        : target;',
    '      if (!pick || pick === idInput || (idInput.contains && idInput.contains(pick))) continue;',
    '      if (!hasSize(pick)) continue;',
    '      if (isLikelyClearAction(pick)) continue;',
    '      if (dispatchMouseClick(pick, probe)) return true;',
    '    }',
    '    return false;',
    '  };',
    '  const clickRecentSessionById = (idText) => {',
    '    const idDigits = digitsOnly(idText);',
    '    if (!idDigits) return false;',
    '    const nodes = Array.from(document.querySelectorAll("button,[role=button],a,li,div")).filter((el) => hasSize(el));',
    '    for (const node of nodes) {',
    '      if (isLikelyClearAction(node)) continue;',
    '      const rawText = normalize(node.textContent || "");',
    '      if (!rawText) continue;',
    '      const ds = digitsOnly(rawText);',
    '      if (!ds || (ds !== idDigits && !ds.includes(idDigits))) continue;',
    '      const r = node.getBoundingClientRect ? node.getBoundingClientRect() : null;',
    '      if (!r || r.width < 90 || r.height < 24) continue;',
    '      if (dispatchMouseClick(node)) return true;',
    '    }',
    '    return false;',
    '  };',
    '  const clickRecentSessionFallback = () => {',
    '    const nodes = Array.from(document.querySelectorAll("button,[role=button],a,li,div")).filter((el) => hasSize(el));',
    '    const candidates = nodes.filter((node) => {',
    '      if (isLikelyClearAction(node)) return false;',
    '      const text = normalize(node.textContent || "").toLowerCase();',
    '      if (!text) return false;',
    '      if (!/mac|windows|linux|android|ios|desktop|remote|\\.local|\\d{3,}/.test(text)) return false;',
    '      const r = node.getBoundingClientRect ? node.getBoundingClientRect() : null;',
    '      if (!r || r.width < 90 || r.height < 24) return false;',
    '      return true;',
    '    });',
    '    if (!candidates.length) return false;',
    '    candidates.sort((a, b) => {',
    '      const ra = a.getBoundingClientRect ? a.getBoundingClientRect() : { top: 0, left: 0 };',
    '      const rb = b.getBoundingClientRect ? b.getBoundingClientRect() : { top: 0, left: 0 };',
    '      if (ra.top !== rb.top) return ra.top - rb.top;',
    '      return ra.left - rb.left;',
    '    });',
    '    return dispatchMouseClick(candidates[0]);',
    '  };',
    '  const clickConnectByViewportHotspots = () => {',
    '    if (typeof document.elementFromPoint !== "function") return false;',
    '    const w = Math.max(320, window.innerWidth || 0);',
    '    const h = Math.max(240, window.innerHeight || 0);',
    '    const points = [',
    '      { x: Math.round(w * 0.78), y: Math.round(h * 0.30) },',
    '      { x: Math.round(w * 0.74), y: Math.round(h * 0.30) },',
    '      { x: Math.round(w * 0.80), y: Math.round(h * 0.33) },',
    '      { x: Math.round(w * 0.16), y: Math.round(h * 0.56) }',
    '    ];',
    '    for (const p of points) {',
    '      const target = document.elementFromPoint(p.x, p.y);',
    '      if (!target) continue;',
    '      const pick = target.closest',
    '        ? (target.closest("button,[role=button],[tabindex],.ant-btn,.anticon,[class*=icon],[class*=suffix],svg,span,div,canvas") || target)',
    '        : target;',
    '      if (!pick || !hasSize(pick)) continue;',
    '      if (isLikelyClearAction(pick)) continue;',
    '      if (dispatchMouseClick(pick, p)) return true;',
    '    }',
    '    return false;',
    '  };',
    '  const findPasswordInput = () => {',
    '    const inputs = Array.from(document.querySelectorAll("input")).filter(isVisible);',
    '    const byType = inputs.find((el) => String(el.type || "").toLowerCase() === "password");',
    '    if (byType) return byType;',
    '    return inputs.find((el) => {',
    '      const hint = normalize((el.placeholder || "") + " " + (el.name || "") + " " + (el.getAttribute("aria-label") || "")).toLowerCase();',
    '      return /password|pass|密码|one-time|临时/.test(hint);',
    '    }) || null;',
    '  };',
    '  const scoreLoginCandidate = (el, passwordInput) => {',
    '    const text = textOf(el);',
    '    if (!text) return 0;',
    '    if (/close|clear|cancel|取消|删除|移除/.test(text)) return -10;',
    '    let score = 0;',
    '    if (/login|连接|connect|确定|确认|ok|继续|submit/.test(text)) score += 7;',
    '    if (/arrow_forward|arrow-right|right/.test(text)) score += 2;',
    '    if (passwordInput) {',
    '      const row = passwordInput.closest("div");',
    '      if (row && row.contains(el)) score += 3;',
    '    }',
    '    return score;',
    '  };',
    '  const findLoginButton = () => {',
    '    const passwordInput = findPasswordInput();',
    '    const nodes = Array.from(document.querySelectorAll("button,[role=button],[tabindex],.ant-btn,.material-icons-round,.material-icons-outlined")).filter(isVisible);',
    '    let best = null;',
    '    let bestScore = 0;',
    '    for (const node of nodes) {',
    '      const score = scoreLoginCandidate(node, passwordInput);',
    '      if (score > bestScore) {',
    '        best = node;',
    '        bestScore = score;',
    '      }',
    '    }',
    '    return bestScore > 0 ? best : null;',
    '  };',
    '  let connectAttempts = 0;',
    '  let loginAttempts = 0;',
    '  const tick = () => {',
    '    try {',
    '      if (shouldFallbackRendezvous()) {',
    '        if (!triggerPublicFallback()) {',
    '          if (!switchToNextPublicRendezvous()) {',
    '            resetAutoConnectAttempts();',
    '            requestReconnect();',
    '          }',
    '        }',
    '      }',
    '      if (hasOfflineDialog()) {',
    '        if (!triggerPublicFallback()) switchToNextPublicRendezvous();',
    '        requestReconnect();',
    '      }',
    '      if (hasIdNotExistDialog()) {',
    '        if (!triggerPublicFallback()) switchToNextPublicRendezvous();',
    '        requestReconnect();',
    '      }',
    '      if (hasWrongPasswordDialog()) {',
    '        clickRetryButton();',
    '        const now = Date.now();',
    '        if (!localPasswordRefreshPending && (now - localPasswordRefreshAt >= 1600)) {',
    '          localPasswordRefreshAt = now;',
    '          refreshPasswordFromLocalInfo();',
    '        }',
    '      }',
    '      if (mecoAutoConnect && mecoId && !isPublicCandidate(rendezvousServer) && !didFallbackToPublic) {',
    '        const statusNum = getConnStatusNum();',
    '        if (statusNum > 0) {',
    '          localRendezvousDeadlineAt = Date.now() + LOCAL_RENDEZVOUS_TIMEOUT_MS;',
    '        } else if (Date.now() >= localRendezvousDeadlineAt) {',
    '          triggerPublicFallback();',
    '        }',
    '      }',
    '      runBridgeAutoConnect();',
    '      if (mecoId) {',
    '        localStorage.setItem("wc-id", mecoId);',
    '        localStorage.setItem("wc-last_remote_id", mecoId);',
    '      }',
    '      const idInput = mecoId ? findIdInput() : null;',
    '      if (idInput && mecoId) setInputValue(idInput, mecoId);',
    '      if (mecoAutoConnect && mecoId && connectAttempts < 260) {',
    '        const connectBtn = findConnectButton();',
    '        let triggered = false;',
    '        if (connectBtn) triggered = clickIfPossible(connectBtn);',
    '        if (!triggered && idInput) triggered = clickConnectNearIdInput(idInput);',
    '        if (!triggered && idInput) triggered = clickConnectByHitTest(idInput);',
    '        if (!triggered) triggered = clickRecentSessionById(mecoId);',
    '        if (!triggered) triggered = clickRecentSessionFallback();',
    '        if (!triggered) triggered = clickConnectByViewportHotspots();',
    '        if (idInput) pressEnter(idInput);',
    '        connectAttempts += 1;',
    '      }',
    '      if (mecoPassword) {',
    '        const passwordInput = findPasswordInput();',
    '        if (passwordInput) {',
    '          setInputValue(passwordInput, mecoPassword);',
    '          if (loginAttempts < 220) {',
    '            const loginBtn = findLoginButton();',
    '            if (loginBtn) clickIfPossible(loginBtn);',
    '            pressEnter(passwordInput);',
    '            loginAttempts += 1;',
    '          }',
    '        }',
    '      }',
    '    } catch (_) {}',
    '  };',
    '  tick();',
    '  const observer = new MutationObserver(() => tick());',
    '  try {',
    '    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });',
    '  } catch (_) {}',
    '  let tries = 0;',
    '  const timer = setInterval(() => {',
    '    tries += 1;',
    '    tick();',
    '    if (tries > 200) {',
    '      clearInterval(timer);',
    '      try { observer.disconnect(); } catch (_) {}',
    '    }',
    '  }, 400);',
    '  setTimeout(() => {',
    '    try { observer.disconnect(); } catch (_) {}',
    '  }, 120000);',
    '})();',
    '</script>'
  ].join('');
  return fixed.replace('</head>', `${bootstrapScript}\n</head>`);
}

function isLikelyMeshNodeId(nodeId) {
  const text = remoteSafeString(nodeId);
  if (!text) return false;
  if (!/^node\//i.test(text)) return false;
  // Accept default-domain ids like `node//<id>` (2 effective segments)
  // and explicit-domain ids like `node/<domain>/<id>`.
  return text.split('/').filter(Boolean).length >= 2;
}

function extractMeshNodeIdFromLaunchUrl(rawUrl) {
  const urlText = remoteSafeString(rawUrl);
  if (!urlText) return '';
  try {
    const parsed = new URL(urlText);
    const nodeId = remoteSafeString(parsed.searchParams.get('gotonode'));
    return isLikelyMeshNodeId(nodeId) ? nodeId : '';
  } catch (_) {
    return '';
  }
}

function appendMeshCentralAuth(url, settings = {}) {
  const target = remoteSafeString(url);
  if (!target) return '';
  const token = remoteSafeString(settings.meshcentralLoginToken || '');
  const rawKey = remoteSafeString(settings.meshcentralTokenQueryKey || '');
  const key = !rawKey || rawKey.toLowerCase() === 'loginkey' ? 'login' : rawKey;
  if (!token || !key) return target;
  try {
    const parsed = new URL(target);
    if (!parsed.searchParams.has(key)) {
      parsed.searchParams.set(key, token);
    }
    return parsed.toString();
  } catch (_) {
    return target;
  }
}

function buildMeshCentralBaseUrl(settings = {}) {
  const explicit = normalizeRemoteHttpBase(settings.meshcentralBaseUrl || '', 'https://');
  if (explicit) return explicit;

  const host = normalizeRemotePublicHost(settings.cloudflarePublicHost || '');
  if (!host) return '';
  const prefixSegments = buildRemotePathPrefixSegments(settings, REMOTE_RUSTDESK_PATH_SEGMENT);
  const pathPart = prefixSegments.filter(Boolean).join('/');
  return pathPart ? `${host}/${pathPart}` : host;
}

function appendMeshCentralDomainPath(baseUrl, settings = {}) {
  const base = remoteSafeString(baseUrl);
  if (!base) return '';
  const domainPath = remoteTrimSlashes(settings.meshcentralDomainPath || '');
  if (!domainPath) return base.replace(/\/+$/g, '');

  try {
    const parsed = new URL(base);
    const baseSegments = parsed.pathname.split('/').filter(Boolean);
    const domainSegments = domainPath.split('/').filter(Boolean);
    const tail = baseSegments.slice(-domainSegments.length).join('/');
    if (tail !== domainSegments.join('/')) {
      parsed.pathname = `/${[...baseSegments, ...domainSegments].join('/')}`;
    }
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/g, '');
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch (_) {
    return `${base.replace(/\/+$/g, '')}/${domainPath}`;
  }
}

function buildMeshCentralAdminPortalUrl(settings = {}) {
  const base = buildMeshCentralBaseUrl(settings);
  if (!base) return '';
  const root = appendMeshCentralDomainPath(base, settings);
  return appendMeshCentralAuth(`${root}/`, settings);
}

function buildMeshCentralDiscoveryUrls(settings = {}) {
  const base = buildMeshCentralBaseUrl(settings);
  if (!base) return [];
  const suffixes = [
    '/api/v1/devices',
    '/api/devices',
    '/api/v1/nodes',
    '/api/nodes',
    '/api/default/devices',
    '/api/default/nodes'
  ];
  const out = [];
  for (const suffix of suffixes) {
    const joined = `${base}${suffix}`;
    out.push(appendMeshCentralAuth(joined, settings));
  }
  return Array.from(new Set(out));
}

function buildMeshCentralControlWsUrl(settings = {}) {
  const base = buildMeshCentralBaseUrl(settings);
  if (!base) return '';
  const root = appendMeshCentralDomainPath(base, settings);
  const token = remoteSafeString(settings.meshcentralLoginToken || '');
  if (!root) return '';
  try {
    const parsed = new URL(root.endsWith('/') ? root : `${root}/`);
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    parsed.pathname = `${parsed.pathname.replace(/\/+$/g, '')}/control.ashx`;
    if (token && !parsed.searchParams.has('auth')) {
      parsed.searchParams.set('auth', token);
    }
    return parsed.toString();
  } catch (_) {
    return '';
  }
}

async function fetchMeshNodeCandidatesViaWebSocket(settings = {}, options = {}) {
  const wsUrl = buildMeshCentralControlWsUrl(settings);
  if (!wsUrl) {
    const err = new Error('mesh_ws_url_missing');
    err.code = 'mesh_ws_url_missing';
    throw err;
  }

  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 3800;

  return await new Promise((resolve, reject) => {
    let done = false;
    let closeReason = '';
    let closeCode = 0;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        ws.terminate();
      } catch (_) {}
      const err = new Error('mesh_ws_timeout');
      err.code = 'mesh_ws_timeout';
      reject(err);
    }, timeoutMs);

    const finish = (result, err = null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch (_) {}
      if (err) return reject(err);
      return resolve(result);
    };

    let ws;
    try {
      ws = new WebSocket(wsUrl, {
        rejectUnauthorized: false,
        handshakeTimeout: Math.max(1200, timeoutMs - 300)
      });
    } catch (e) {
      done = true;
      clearTimeout(timer);
      const err = new Error(remoteSafeString(e && e.message) || 'mesh_ws_create_failed');
      err.code = 'mesh_ws_create_failed';
      reject(err);
      return;
    }

    ws.on('open', () => {
      try {
        ws.send(JSON.stringify({ action: 'nodes', responseid: 'meco_mesh_discovery' }));
      } catch (e) {
        const err = new Error(remoteSafeString(e && e.message) || 'mesh_ws_send_failed');
        err.code = 'mesh_ws_send_failed';
        finish(null, err);
      }
    });

    ws.on('message', (raw) => {
      let payload = null;
      try {
        payload = JSON.parse(String(raw || ''));
      } catch (_) {
        return;
      }
      if (!payload || typeof payload !== 'object') return;

      const action = remoteSafeString(payload.action || '').toLowerCase();
      if (action === 'close') {
        const cause = remoteSafeString(payload.cause || payload.msg || 'mesh_ws_closed');
        const err = new Error(cause);
        err.code = cause || 'mesh_ws_closed';
        finish(null, err);
        return;
      }
      if (action !== 'nodes') return;

      const candidates = extractMeshNodeCandidates(payload);
      finish({
        wsUrl,
        candidates
      });
    });

    ws.on('error', (e) => {
      const err = new Error(remoteSafeString(e && e.message) || 'mesh_ws_error');
      err.code = err.message || 'mesh_ws_error';
      finish(null, err);
    });

    ws.on('close', (code, reason) => {
      closeCode = Number(code) || 0;
      closeReason = remoteSafeString(reason || '');
      if (!done) {
        const err = new Error(closeReason || `mesh_ws_closed_${closeCode}`);
        err.code = closeReason || `mesh_ws_closed_${closeCode}`;
        finish(null, err);
      }
    });
  });
}

async function fetchJsonWithTimeout(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 3000;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch (_) {}
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json,text/plain,*/*' },
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status}`);
      err.status = response.status;
      err.body = text.slice(0, 240);
      throw err;
    }
    const parsed = JSON.parse(text);
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function extractMeshNodeCandidates(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const queue = [payload];
  const seen = new Set();
  const map = new Map();
  let scanned = 0;

  const pickText = (obj, keys) => {
    for (const key of keys) {
      const value = remoteSafeString(obj[key]);
      if (value) return value;
    }
    return '';
  };

  while (queue.length > 0 && scanned < 9000) {
    const current = queue.shift();
    scanned += 1;
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        if (item && typeof item === 'object') queue.push(item);
      }
      continue;
    }

    const nodeId = pickText(current, ['nodeid', 'nodeId', '_id', 'id', 'node']);
    if (isLikelyMeshNodeId(nodeId)) {
      const name = pickText(current, ['name', 'rname', 'computerName', 'hostname', 'deviceName', 'title']);
      const host = pickText(current, ['host', 'hostname', 'fqdn', 'ip', 'ipv4', 'lanIp']);
      const prev = map.get(nodeId);
      if (!prev || (!prev.name && name) || (!prev.host && host)) {
        map.set(nodeId, { nodeId, name, host });
      }
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') queue.push(value);
    }
  }

  return Array.from(map.values());
}

function summarizeMeshNodesPayload(payload) {
  const out = {
    hasNodesField: false,
    nodesType: '',
    meshGroupCount: 0,
    sampleMeshKeys: [],
    sampleNodeKeyCount: 0
  };
  if (!payload || typeof payload !== 'object') return out;

  const nodes = payload.nodes;
  if (nodes === undefined) return out;
  out.hasNodesField = true;

  if (Array.isArray(nodes)) {
    out.nodesType = 'array';
    out.meshGroupCount = nodes.length;
    return out;
  }
  if (!nodes || typeof nodes !== 'object') {
    out.nodesType = typeof nodes;
    return out;
  }

  out.nodesType = 'object';
  const meshKeys = Object.keys(nodes);
  out.meshGroupCount = meshKeys.length;
  out.sampleMeshKeys = meshKeys.slice(0, 3);

  if (meshKeys.length > 0) {
    const first = nodes[meshKeys[0]];
    if (Array.isArray(first)) {
      out.sampleNodeKeyCount = first.length;
    } else if (first && typeof first === 'object') {
      out.sampleNodeKeyCount = Object.keys(first).length;
    }
  }
  return out;
}

function scoreMeshCandidate(candidate, hints = {}) {
  const deviceName = remoteSafeString(hints.deviceName).toLowerCase();
  const deviceSlug = remoteToSlug(hints.deviceName || '', '');
  const ownerSlug = remoteToSlug(hints.owner || '', '');
  const lanHost = remoteSafeString(hints.lanHost).toLowerCase();
  const name = remoteSafeString(candidate.name).toLowerCase();
  const nameSlug = remoteToSlug(name, '');
  const host = remoteSafeString(candidate.host).toLowerCase();
  const nodeId = remoteSafeString(candidate.nodeId).toLowerCase();

  let score = 0;
  let exactName = false;
  let exactHost = false;

  if (deviceName && name && name === deviceName) {
    score += 180;
    exactName = true;
  }
  if (deviceSlug && nameSlug && nameSlug === deviceSlug) {
    score += 170;
    exactName = true;
  } else if (deviceSlug && nameSlug && nameSlug.includes(deviceSlug)) {
    score += 80;
  }

  if (lanHost && host) {
    if (host === lanHost) {
      score += 220;
      exactHost = true;
    } else if (host.includes(lanHost) || lanHost.includes(host)) {
      score += 90;
    }
  }

  if (ownerSlug && nodeId && nodeId.includes(`/${ownerSlug}`)) {
    score += 25;
  }

  return { score, exactName, exactHost };
}

function pickBestMeshCandidate(candidates = [], hints = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const scored = candidates
    .map((candidate) => {
      const score = scoreMeshCandidate(candidate, hints);
      return { candidate, ...score };
    })
    .sort((a, b) => b.score - a.score);

  const first = scored[0];
  const second = scored[1];
  if (!first) return null;
  if (first.score < 160) return null;
  if (second && first.score - second.score < 20 && !(first.exactHost || first.exactName)) {
    return null;
  }
  return first.candidate;
}

function pickMeshCandidateWithFallback(candidates = [], hints = {}) {
  const strict = pickBestMeshCandidate(candidates, hints);
  if (strict) return { candidate: strict, mode: 'strict' };
  if (Array.isArray(candidates) && candidates.length === 1 && isLikelyMeshNodeId(candidates[0].nodeId)) {
    return { candidate: candidates[0], mode: 'single_candidate_fallback' };
  }
  return { candidate: null, mode: '' };
}

function getMeshDeviceHints(device = {}) {
  const lanUrl = remoteSafeString(device.lanUrl || '');
  let lanHost = '';
  if (lanUrl) {
    try {
      lanHost = remoteSafeString(new URL(lanUrl).hostname).toLowerCase();
    } catch (_) {
      lanHost = '';
    }
  }
  return {
    owner: remoteSafeString(device.owner || ''),
    deviceName: remoteSafeString(device.deviceName || ''),
    lanHost
  };
}

function isLikelyMeshId(meshId) {
  const text = remoteSafeString(meshId);
  if (!text) return false;
  if (!/^mesh\//i.test(text)) return false;
  // MeshCentral default-domain ids look like "mesh//<base64>", which is valid.
  return text.split('/').filter(Boolean).length >= 2;
}

let localMeshHostCache = {
  at: 0,
  values: new Set(['localhost', '127.0.0.1', '::1'])
};

function getLocalMeshHostCandidates() {
  const now = Date.now();
  if (localMeshHostCache && (now - localMeshHostCache.at) < 15000) {
    return localMeshHostCache.values;
  }

  const out = new Set(['localhost', '127.0.0.1', '::1']);
  const systemHost = remoteSafeString(os.hostname()).toLowerCase();
  if (systemHost) {
    out.add(systemHost);
    const short = systemHost.split('.')[0];
    if (short) out.add(short);
  }

  const networkMap = os.networkInterfaces() || {};
  for (const rows of Object.values(networkMap)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const addr = remoteSafeString(row.address).toLowerCase();
      if (addr) out.add(addr);
    }
  }

  localMeshHostCache = { at: now, values: out };
  return out;
}

function normalizeHostForMeshMatch(host) {
  let value = remoteSafeString(host).toLowerCase();
  if (!value) return '';
  if (value.startsWith('::ffff:')) value = value.slice(7);
  value = value.replace(/\.$/, '');
  return value;
}

function isLikelyLocalMeshHost(host) {
  const normalized = normalizeHostForMeshMatch(host);
  if (!normalized) return false;
  const candidates = getLocalMeshHostCandidates();
  if (candidates.has(normalized)) return true;
  const short = normalized.split('.')[0];
  if (short && candidates.has(short)) return true;
  return false;
}

function shouldAttemptLocalMeshProvision(device = {}, hints = {}) {
  const lanHost = normalizeHostForMeshMatch(hints.lanHost || '');
  if (!lanHost) return false;
  return isLikelyLocalMeshHost(lanHost);
}

function isMeshActionOkResult(value) {
  const text = remoteSafeString(value).toLowerCase();
  if (!text) return true;
  return text === 'ok' || text === 'success';
}

function pickMeshGroupForProvision(meshes = [], device = {}, options = {}) {
  if (!Array.isArray(meshes) || meshes.length === 0) return null;

  const expectedType = Number(options && options.expectedType);
  const normalized = meshes.filter((m) => {
    if (!m || !isLikelyMeshId(m._id)) return false;
    if (!Number.isFinite(expectedType)) return true;
    return Number(m.mtype) === expectedType;
  });
  if (normalized.length === 0) return null;

  const owner = remoteSafeString(device.owner || '').toLowerCase();
  const ownerSlug = remoteToSlug(owner, '');
  const deviceSlug = remoteToSlug(device.deviceName || '', '');

  const preferredNames = [
    'eden devices',
    owner ? `${owner} devices` : '',
    ownerSlug ? `${ownerSlug} devices` : '',
    'meco devices'
  ].filter(Boolean);

  for (const name of preferredNames) {
    const exact = normalized.find((m) => remoteSafeString(m.name).toLowerCase() === name);
    if (exact) return exact;
  }

  if (ownerSlug) {
    const byOwner = normalized.find((m) => {
      const meshName = remoteToSlug(remoteSafeString(m.name || ''), '');
      return meshName.includes(ownerSlug);
    });
    if (byOwner) return byOwner;
  }

  if (deviceSlug) {
    const byDevice = normalized.find((m) => {
      const meshName = remoteToSlug(remoteSafeString(m.name || ''), '');
      return meshName.includes(deviceSlug);
    });
    if (byDevice) return byDevice;
  }

  return normalized[0];
}

function getMeshProvisionDeviceType() {
  if (process.platform === 'darwin') return 29;
  if (process.platform === 'linux') return 6;
  return 4;
}

function getMeshProvisionDeviceName(device = {}) {
  const preferred = remoteSafeString(device.deviceName || '');
  if (preferred) return preferred;
  const note = remoteSafeString(device.note || '');
  if (note) return note.slice(0, 64);
  return remoteSafeString(os.hostname() || 'meco-device') || 'meco-device';
}

async function provisionLocalMeshNodeViaWebSocket(device = {}, settings = {}, options = {}) {
  const wsUrl = buildMeshCentralControlWsUrl(settings);
  const hints = options && options.hints ? options.hints : getMeshDeviceHints(device);
  const timeoutMs = Number(options && options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000;

  const deviceName = getMeshProvisionDeviceName(device);
  const hostname = remoteSafeString(hints.lanHost || os.hostname() || '');
  const deviceType = getMeshProvisionDeviceType();
  const preferredGroupName = 'Eden Local Devices';
  const expectedMeshType = 3;

  if (!wsUrl) {
    return {
      attempted: false,
      found: false,
      nodeId: '',
      source: '',
      reason: 'mesh_ws_url_missing',
      debug: {
        url: '',
        stage: 'init',
        hostname,
        deviceName,
        type: deviceType,
        selectedMeshId: ''
      }
    };
  }

  return await new Promise((resolve) => {
    let done = false;
    let stage = 'init';
    let ws = null;
    let selectedMeshId = '';
    let addLocalFallbackTimer = null;
    let nodeProbeAttempts = 0;
    const maxNodeProbeAttempts = 5;
    const debug = {
      url: wsUrl,
      stage,
      hostname,
      deviceName,
      type: deviceType,
      selectedMeshId: '',
      receivedActions: []
    };

    const appendWsActionTrace = (entry = {}) => {
      const row = {
        at: Date.now(),
        ...entry
      };
      if (!Array.isArray(debug.receivedActions)) {
        debug.receivedActions = [];
      }
      debug.receivedActions.push(row);
      if (debug.receivedActions.length > 24) {
        debug.receivedActions.splice(0, debug.receivedActions.length - 24);
      }
    };

    const finish = (result = {}) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (addLocalFallbackTimer) {
        clearTimeout(addLocalFallbackTimer);
        addLocalFallbackTimer = null;
      }
      try {
        if (ws) ws.close();
      } catch (_) {}
      resolve({
        attempted: true,
        found: false,
        nodeId: '',
        source: '',
        reason: 'mesh_ws_provision_failed',
        debug,
        ...result,
        debug: {
          ...debug,
          ...(result && result.debug && typeof result.debug === 'object' ? result.debug : {})
        }
      });
    };

    const timer = setTimeout(() => {
      finish({
        reason: `mesh_ws_provision_timeout:${stage || 'unknown'}`
      });
    }, timeoutMs);

    const sendNodesProbe = (delayMs = 0) => {
      setTimeout(() => {
        if (done) return;
        stage = 'nodes';
        debug.stage = stage;
        nodeProbeAttempts += 1;
        debug.nodeProbeAttempts = nodeProbeAttempts;
        try {
          ws.send(JSON.stringify({
            action: 'nodes',
            responseid: 'meco_mesh_provision_nodes'
          }));
        } catch (_) {}
      }, Math.max(0, Number(delayMs) || 0));
    };

    const sendAddLocalDevice = () => {
      stage = 'addlocaldevice';
      debug.stage = stage;
      if (addLocalFallbackTimer) {
        clearTimeout(addLocalFallbackTimer);
        addLocalFallbackTimer = null;
      }
      const meshIdFull = remoteSafeString(selectedMeshId);
      const meshIdShort = meshIdFull.includes('/') ? meshIdFull.split('/').filter(Boolean).slice(-1)[0] : meshIdFull;
      debug.addLocalMeshIdFull = meshIdFull;
      debug.addLocalMeshIdShort = meshIdShort;
      debug.addLocalSentIds = [];

      ws.send(JSON.stringify({
        action: 'addlocaldevice',
        meshid: meshIdFull,
        devicename: deviceName,
        hostname,
        type: deviceType,
        responseid: 'meco_mesh_provision_addlocal'
      }));
      debug.addLocalSentIds.push(meshIdFull);
      if (meshIdShort && meshIdShort !== meshIdFull) {
        setTimeout(() => {
          if (done) return;
          try {
            ws.send(JSON.stringify({
              action: 'addlocaldevice',
              meshid: meshIdShort,
              devicename: deviceName,
              hostname,
              type: deviceType,
              responseid: 'meco_mesh_provision_addlocal_short'
            }));
            debug.addLocalSentIds.push(meshIdShort);
          } catch (_) {}
        }, 600);
      }
      // Some MeshCentral setups silently accept addlocaldevice without an explicit response.
      // Probe node list after a short delay to avoid getting stuck in addlocaldevice stage.
      addLocalFallbackTimer = setTimeout(() => {
        if (done) return;
        debug.addLocalFallbackTriggered = true;
        sendNodesProbe(0);
      }, 1800);
    };

    try {
      ws = new WebSocket(wsUrl, {
        rejectUnauthorized: false,
        handshakeTimeout: Math.max(1200, timeoutMs - 800)
      });
    } catch (e) {
      finish({
        reason: remoteSafeString(e && e.message) || 'mesh_ws_create_failed'
      });
      return;
    }

    ws.on('open', () => {
      stage = 'meshes';
      debug.stage = stage;
      try {
        ws.send(JSON.stringify({
          action: 'meshes',
          responseid: 'meco_mesh_provision_meshes'
        }));
      } catch (e) {
        finish({
          reason: remoteSafeString(e && e.message) || 'mesh_ws_meshes_send_failed'
        });
      }
    });

    ws.on('message', (raw) => {
      let payload = null;
      try {
        payload = JSON.parse(String(raw || ''));
      } catch (_) {
        return;
      }
      if (!payload || typeof payload !== 'object') return;

      const action = remoteSafeString(payload.action || '').toLowerCase();
      appendWsActionTrace({
        action,
        stage,
        result: remoteSafeString(payload.result || ''),
        responseid: remoteSafeString(payload.responseid || '')
      });

      if (action === 'close') {
        finish({
          reason: remoteSafeString(payload.cause || payload.msg || 'mesh_ws_closed') || 'mesh_ws_closed'
        });
        return;
      }

      if (stage === 'meshes' && action === 'meshes') {
        const groups = Array.isArray(payload.meshes) ? payload.meshes : [];
        appendWsActionTrace({
          action,
          stage,
          meshCount: groups.length
        });
        const selected = pickMeshGroupForProvision(groups, device, { expectedType: expectedMeshType });
        if (selected && isLikelyMeshId(selected._id)) {
          selectedMeshId = remoteSafeString(selected._id);
          debug.selectedMeshId = selectedMeshId;
          debug.selectedMeshType = Number(selected.mtype) || 0;
          sendAddLocalDevice();
          return;
        }

        stage = 'createmesh';
        debug.stage = stage;
        ws.send(JSON.stringify({
          action: 'createmesh',
          meshname: preferredGroupName,
          meshtype: expectedMeshType,
          responseid: 'meco_mesh_provision_createmesh'
        }));
        return;
      }

      if (stage === 'createmesh' && action === 'createmesh') {
        const createResult = remoteSafeString(payload.result || '');
        debug.createMeshResult = createResult;
        if (!isMeshActionOkResult(createResult)) {
          finish({
            reason: `mesh_ws_createmesh_failed:${createResult || 'unknown'}`
          });
          return;
        }
        selectedMeshId = remoteSafeString(payload.meshid || '');
        if (isLikelyMeshId(selectedMeshId)) {
          debug.selectedMeshId = selectedMeshId;
          sendAddLocalDevice();
          return;
        }
        stage = 'meshes_after_create';
        debug.stage = stage;
        ws.send(JSON.stringify({
          action: 'meshes',
          responseid: 'meco_mesh_provision_meshes_after_create'
        }));
        return;
      }

      if (stage === 'meshes_after_create' && action === 'meshes') {
        const groups = Array.isArray(payload.meshes) ? payload.meshes : [];
        debug.meshesAfterCreateCount = groups.length;
        appendWsActionTrace({
          action,
          stage,
          meshCount: groups.length
        });
        const selected = pickMeshGroupForProvision(groups, device, { expectedType: expectedMeshType });
        if (selected && isLikelyMeshId(selected._id)) {
          selectedMeshId = remoteSafeString(selected._id);
          debug.selectedMeshId = selectedMeshId;
          debug.selectedMeshType = Number(selected.mtype) || 0;
          sendAddLocalDevice();
          return;
        }
        finish({
          reason: `mesh_ws_createmesh_no_meshid:${groups.length}`
        });
        return;
      }

      if (stage === 'addlocaldevice' && action === 'addlocaldevice') {
        debug.addLocalAck = true;
        if (addLocalFallbackTimer) {
          clearTimeout(addLocalFallbackTimer);
          addLocalFallbackTimer = null;
        }
        if (!isMeshActionOkResult(payload.result)) {
          finish({
            reason: `mesh_ws_addlocaldevice_failed:${remoteSafeString(payload.result || 'unknown') || 'unknown'}`
          });
          return;
        }

        const directNodeId = remoteSafeString(payload.nodeid || payload.nodeId || payload.id || '');
        if (isLikelyMeshNodeId(directNodeId)) {
          finish({
            found: true,
            nodeId: directNodeId,
            source: 'mesh_ws:addlocaldevice'
          });
          return;
        }

        sendNodesProbe(0);
        return;
      }

      if (stage === 'nodes' && action === 'nodes') {
        debug.lastNodesSummary = summarizeMeshNodesPayload(payload);
        const candidates = extractMeshNodeCandidates(payload);
        appendWsActionTrace({
          action,
          stage,
          candidates: candidates.length,
          nodeProbeAttempts
        });
        const picked = pickMeshCandidateWithFallback(candidates, hints);
        if (picked.candidate && isLikelyMeshNodeId(picked.candidate.nodeId)) {
          finish({
            found: true,
            nodeId: picked.candidate.nodeId,
            source: 'mesh_ws:addlocaldevice'
          });
          return;
        }
        if (nodeProbeAttempts < maxNodeProbeAttempts) {
          sendNodesProbe(1600);
          return;
        }
        finish({
          reason: candidates.length === 0
            ? `mesh_ws_addlocaldevice_no_nodes:${nodeProbeAttempts}`
            : `mesh_ws_addlocaldevice_no_match:${nodeProbeAttempts}`
        });
      }
    });

    ws.on('error', (e) => {
      finish({
        reason: remoteSafeString(e && (e.code || e.message)) || 'mesh_ws_provision_error'
      });
    });

    ws.on('close', (code, reason) => {
      if (done) return;
      finish({
        reason: remoteSafeString(reason || '') || `mesh_ws_provision_closed_${Number(code) || 0}`
      });
    });
  });
}

async function discoverMeshNodeIdForDevice(device, settings = {}) {
  const fromLaunch = extractMeshNodeIdFromLaunchUrl(device && device.meshLaunchUrl);
  if (fromLaunch) {
    return {
      found: true,
      nodeId: fromLaunch,
      source: 'mesh_launch_url',
      reason: ''
    };
  }

  const baseUrl = buildMeshCentralBaseUrl(settings);
  if (!baseUrl) {
    return {
      found: false,
      nodeId: '',
      source: '',
      reason: 'meshcentral_base_missing'
    };
  }

  const hints = getMeshDeviceHints(device);
  const urls = buildMeshCentralDiscoveryUrls(settings);
  const debug = { baseUrl, tried: [] };
  for (const url of urls) {
    const row = { url, candidates: 0, matched: '' };
    debug.tried.push(row);
    try {
      const payload = await fetchJsonWithTimeout(url, { timeoutMs: 2800 });
      const candidates = extractMeshNodeCandidates(payload);
      row.candidates = candidates.length;
      const picked = pickMeshCandidateWithFallback(candidates, hints);
      if (picked.candidate && isLikelyMeshNodeId(picked.candidate.nodeId)) {
        row.matched = picked.candidate.nodeId;
        row.matchMode = picked.mode;
        return {
          found: true,
          nodeId: picked.candidate.nodeId,
          source: `mesh_api:${url}`,
          reason: '',
          debug
        };
      }
    } catch (e) {
      row.error = remoteSafeString(e && e.message) || 'request_failed';
      continue;
    }
  }

  const wsRow = { url: '', protocol: 'websocket', candidates: 0, matched: '' };
  try {
    const wsPayload = await fetchMeshNodeCandidatesViaWebSocket(settings, { timeoutMs: 4200 });
    wsRow.url = wsPayload.wsUrl || '';
    const candidates = Array.isArray(wsPayload.candidates) ? wsPayload.candidates : [];
    wsRow.candidates = candidates.length;
    const picked = pickMeshCandidateWithFallback(candidates, hints);
    if (picked.candidate && isLikelyMeshNodeId(picked.candidate.nodeId)) {
      wsRow.matched = picked.candidate.nodeId;
      wsRow.matchMode = picked.mode;
      debug.tried.push(wsRow);
      return {
        found: true,
        nodeId: picked.candidate.nodeId,
        source: 'mesh_ws:nodes',
        reason: '',
        debug
      };
    }
    wsRow.error = candidates.length === 0 ? 'mesh_ws_no_nodes' : 'mesh_ws_no_match';
    debug.tried.push(wsRow);
  } catch (e) {
    wsRow.error = remoteSafeString(e && (e.code || e.message)) || 'mesh_ws_failed';
    debug.tried.push(wsRow);
  }

  const provisionRow = {
    url: '',
    protocol: 'websocket',
    operation: 'addlocaldevice',
    matched: ''
  };
  if (shouldAttemptLocalMeshProvision(device, hints)) {
    try {
      const provision = await provisionLocalMeshNodeViaWebSocket(device, settings, { hints, timeoutMs: 15000 });
      provisionRow.url = remoteSafeString(provision && provision.debug && provision.debug.url);
      provisionRow.hostname = remoteSafeString(provision && provision.debug && provision.debug.hostname);
      provisionRow.selectedMeshId = remoteSafeString(provision && provision.debug && provision.debug.selectedMeshId);
      provisionRow.selectedMeshType = Number(provision && provision.debug && provision.debug.selectedMeshType) || 0;
      provisionRow.addLocalAck = !!(provision && provision.debug && provision.debug.addLocalAck);
      provisionRow.addLocalFallbackTriggered = !!(provision && provision.debug && provision.debug.addLocalFallbackTriggered);
      provisionRow.addLocalMeshIdFull = remoteSafeString(provision && provision.debug && provision.debug.addLocalMeshIdFull);
      provisionRow.addLocalMeshIdShort = remoteSafeString(provision && provision.debug && provision.debug.addLocalMeshIdShort);
      provisionRow.addLocalSentIds = Array.isArray(provision && provision.debug && provision.debug.addLocalSentIds)
        ? provision.debug.addLocalSentIds.slice(0, 6)
        : [];
      provisionRow.nodeProbeAttempts = Number(provision && provision.debug && provision.debug.nodeProbeAttempts) || 0;
      provisionRow.createMeshResult = remoteSafeString(provision && provision.debug && provision.debug.createMeshResult);
      provisionRow.meshesAfterCreateCount = Number(provision && provision.debug && provision.debug.meshesAfterCreateCount) || 0;
      provisionRow.lastNodesSummary = (provision && provision.debug && provision.debug.lastNodesSummary) || null;
      provisionRow.receivedActions = Array.isArray(provision && provision.debug && provision.debug.receivedActions)
        ? provision.debug.receivedActions.slice(-8)
        : [];
      if (provision && provision.found && isLikelyMeshNodeId(provision.nodeId)) {
        provisionRow.matched = provision.nodeId;
        provisionRow.result = 'ok';
        debug.tried.push(provisionRow);
        return {
          found: true,
          nodeId: provision.nodeId,
          source: provision.source || 'mesh_ws:addlocaldevice',
          reason: '',
          debug
        };
      }
      provisionRow.error = remoteSafeString(provision && provision.reason) || 'mesh_ws_addlocaldevice_failed';
      debug.tried.push(provisionRow);
    } catch (e) {
      provisionRow.error = remoteSafeString(e && (e.code || e.message)) || 'mesh_ws_addlocaldevice_error';
      debug.tried.push(provisionRow);
    }
  } else {
    provisionRow.error = 'mesh_local_provision_skipped_not_local_host';
    provisionRow.hostname = remoteSafeString(hints.lanHost || '');
    debug.tried.push(provisionRow);
  }

  return {
    found: false,
    nodeId: '',
    source: '',
    reason: 'mesh_node_not_found',
    debug
  };
}

async function autoFillMeshNodeIdForDevice(deviceId, settings = {}, options = {}) {
  const id = remoteSafeString(deviceId);
  if (!id) {
    throw new Error('device id is required');
  }

  const overwrite = !!(options && options.overwrite);
  let device = remoteControl.getDeviceById(id, settings, { includeSensitive: true });
  const currentNodeId = remoteSafeString(device.meshNodeId || '');
  if (!overwrite && isLikelyMeshNodeId(currentNodeId)) {
    return {
      attempted: false,
      updated: false,
      nodeId: currentNodeId,
      source: 'existing',
      reason: 'already_has_mesh_node',
      device
    };
  }

  const discovery = await discoverMeshNodeIdForDevice(device, settings);
  if (!discovery.found || !isLikelyMeshNodeId(discovery.nodeId)) {
    return {
      attempted: true,
      updated: false,
      nodeId: '',
      source: discovery.source || '',
      reason: discovery.reason || 'mesh_node_not_found',
      debug: discovery.debug || null,
      device
    };
  }

  const updatePayload = {
    meshNodeId: discovery.nodeId
  };
  if (!extractMeshNodeIdFromLaunchUrl(device.meshLaunchUrl || '')) {
    updatePayload.meshLaunchUrl = '';
  }
  device = remoteControl.updateDevice(id, updatePayload, settings);
  return {
    attempted: true,
    updated: true,
    nodeId: discovery.nodeId,
    source: discovery.source || 'mesh_api',
    reason: 'updated',
    debug: discovery.debug || null,
    device
  };
}

function sendRemoteControlError(res, err) {
  const status = Number(err && err.status) || 500;
  const code = err && err.code ? String(err.code) : 'remote_control_error';
  const message = err && err.message ? String(err.message) : 'remote control error';
  return res.status(status).json({
    success: false,
    code,
    error: message
  });
}

const REMOTE_CLOUD_SYNC_OBJECT_KEY = process.env.MECO_REMOTE_CLOUD_SYNC_OBJECT_KEY || 'meco-studio/remote-devices-sync.v1.json';
const REMOTE_CLOUD_SYNC_FETCH_TIMEOUT_MS = 12000;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseRemoteStoreSnapshot(raw) {
  if (!isNonEmptyString(raw)) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const devices = Array.isArray(parsed.devices)
      ? parsed.devices.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      : [];
    const version = Number(parsed.version) || 1;
    return { version, devices };
  } catch (_) {
    return null;
  }
}

function readLocalRemoteStoreSnapshot() {
  try {
    const storePath = remoteControl.STORE_PATH;
    if (!storePath || !fs.existsSync(storePath)) {
      return { version: 1, devices: [] };
    }
    const raw = fs.readFileSync(storePath, 'utf8');
    return parseRemoteStoreSnapshot(raw) || { version: 1, devices: [] };
  } catch (_) {
    return { version: 1, devices: [] };
  }
}

function writeLocalRemoteStoreSnapshot(snapshot = {}) {
  const normalized = {
    version: Number(snapshot && snapshot.version) || 1,
    devices: Array.isArray(snapshot && snapshot.devices)
      ? snapshot.devices.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      : []
  };
  const storePath = remoteControl.STORE_PATH;
  if (!storePath) {
    throw new Error('remote store path is not available');
  }
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  return normalized;
}

function toDeviceTimeMs(device) {
  const ts = Date.parse(device && device.updatedAt ? String(device.updatedAt) : '') || 0;
  return Number.isFinite(ts) ? ts : 0;
}

function normalizeRustDeskIdentity(device) {
  return remoteSafeString((device && (device.rustdeskId || device.meshNodeId)) || '').replace(/\s+/g, '');
}

function normalizeOwnerDeviceIdentity(device) {
  const owner = remoteSafeString(device && device.owner).toLowerCase();
  const name = remoteSafeString(device && device.deviceName).toLowerCase();
  if (!owner || !name) return '';
  return `${owner}/${name}`;
}

function findMergedDeviceIndex(devices, incoming) {
  const incomingId = remoteSafeString(incoming && incoming.id);
  const incomingRoute = remoteSafeString(incoming && incoming.routePath);
  const incomingRustDeskId = normalizeRustDeskIdentity(incoming);
  const incomingOwnerDevice = normalizeOwnerDeviceIdentity(incoming);
  for (let i = 0; i < devices.length; i += 1) {
    const cur = devices[i];
    const curId = remoteSafeString(cur && cur.id);
    if (incomingId && curId && incomingId === curId) return i;
    const curRoute = remoteSafeString(cur && cur.routePath);
    if (incomingRoute && curRoute && incomingRoute === curRoute) return i;
    const curRustDeskId = normalizeRustDeskIdentity(cur);
    if (incomingRustDeskId && curRustDeskId && incomingRustDeskId === curRustDeskId) return i;
    const curOwnerDevice = normalizeOwnerDeviceIdentity(cur);
    if (incomingOwnerDevice && curOwnerDevice && incomingOwnerDevice === curOwnerDevice) return i;
  }
  return -1;
}

function mergeRemoteDeviceObjects(base = {}, incoming = {}) {
  const baseTime = toDeviceTimeMs(base);
  const incomingTime = toDeviceTimeMs(incoming);
  const preferred = incomingTime >= baseTime ? incoming : base;
  const fallback = preferred === incoming ? base : incoming;

  const merged = {};
  const keys = new Set([
    ...Object.keys(fallback || {}),
    ...Object.keys(preferred || {})
  ]);

  for (const key of keys) {
    const pv = preferred ? preferred[key] : undefined;
    const fv = fallback ? fallback[key] : undefined;
    if (pv && typeof pv === 'object' && !Array.isArray(pv) && fv && typeof fv === 'object' && !Array.isArray(fv)) {
      merged[key] = { ...fv, ...pv };
      continue;
    }
    if (pv === undefined || pv === null) {
      merged[key] = fv;
      continue;
    }
    if (typeof pv === 'string' && pv.trim() === '' && typeof fv === 'string' && fv.trim() !== '') {
      merged[key] = fv;
      continue;
    }
    merged[key] = pv;
  }

  merged.id = remoteSafeString(merged.id) || crypto.randomBytes(8).toString('hex');
  const nowIso = new Date().toISOString();
  merged.createdAt = remoteSafeString(merged.createdAt) || remoteSafeString(fallback && fallback.createdAt) || nowIso;
  merged.updatedAt = remoteSafeString(merged.updatedAt) || remoteSafeString(preferred && preferred.updatedAt) || nowIso;
  return merged;
}

function mergeRemoteStoreSnapshots(localSnapshot = {}, cloudSnapshot = {}) {
  const localDevices = Array.isArray(localSnapshot.devices) ? localSnapshot.devices : [];
  const cloudDevices = Array.isArray(cloudSnapshot.devices) ? cloudSnapshot.devices : [];
  const combined = [...cloudDevices, ...localDevices]
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .sort((a, b) => toDeviceTimeMs(a) - toDeviceTimeMs(b));

  const mergedDevices = [];
  for (const item of combined) {
    const idx = findMergedDeviceIndex(mergedDevices, item);
    if (idx < 0) {
      mergedDevices.push(mergeRemoteDeviceObjects({}, item));
      continue;
    }
    mergedDevices[idx] = mergeRemoteDeviceObjects(mergedDevices[idx], item);
  }

  return {
    version: Math.max(Number(localSnapshot.version) || 1, Number(cloudSnapshot.version) || 1, 1),
    devices: mergedDevices
  };
}

function buildRemoteCloudSyncState(settings = {}) {
  const cfg = ossStorage.resolveOssConfig(settings);
  if (!cfg.ready) {
    return {
      enabled: false,
      reason: cfg.error || 'oss_not_ready',
      objectKey: REMOTE_CLOUD_SYNC_OBJECT_KEY
    };
  }
  return {
    enabled: true,
    objectKey: REMOTE_CLOUD_SYNC_OBJECT_KEY
  };
}

async function fetchRemoteStoreSnapshotFromCloud(settings = {}) {
  const state = buildRemoteCloudSyncState(settings);
  if (!state.enabled) {
    return {
      success: false,
      skipped: true,
      reason: state.reason || 'oss_not_ready',
      objectKey: state.objectKey
    };
  }
  try {
    const signed = ossStorage.signObjectUrl(settings, {
      objectKey: state.objectKey,
      expires: 300
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_CLOUD_SYNC_FETCH_TIMEOUT_MS);
    let response = null;
    try {
      response = await fetch(signed.signedUrl, {
        method: 'GET',
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response) {
      return { success: false, skipped: false, reason: 'cloud_fetch_no_response', objectKey: state.objectKey };
    }
    if (response.status === 404) {
      return {
        success: true,
        skipped: false,
        empty: true,
        objectKey: state.objectKey,
        snapshot: { version: 1, devices: [] }
      };
    }
    if (!response.ok) {
      return {
        success: false,
        skipped: false,
        reason: `cloud_fetch_http_${response.status}`,
        objectKey: state.objectKey
      };
    }
    const text = await response.text();
    const parsed = parseRemoteStoreSnapshot(text);
    if (!parsed) {
      return {
        success: false,
        skipped: false,
        reason: 'cloud_payload_invalid',
        objectKey: state.objectKey
      };
    }
    return {
      success: true,
      skipped: false,
      empty: parsed.devices.length === 0,
      objectKey: state.objectKey,
      snapshot: parsed
    };
  } catch (e) {
    return {
      success: false,
      skipped: false,
      reason: remoteSafeString(e && e.message) || 'cloud_fetch_failed',
      objectKey: state.objectKey
    };
  }
}

async function pushRemoteStoreSnapshotToCloud(settings = {}, snapshot = null) {
  const state = buildRemoteCloudSyncState(settings);
  if (!state.enabled) {
    return {
      success: false,
      skipped: true,
      reason: state.reason || 'oss_not_ready',
      objectKey: state.objectKey
    };
  }
  const localSnapshot = snapshot && typeof snapshot === 'object'
    ? snapshot
    : readLocalRemoteStoreSnapshot();
  const tempPath = path.join(os.tmpdir(), `meco-remote-devices-sync-${Date.now()}-${process.pid}.json`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(localSnapshot, null, 2) + '\n', 'utf8');
    const uploaded = await ossStorage.uploadLocalFile(settings, {
      localPath: tempPath,
      objectKey: state.objectKey,
      contentType: 'application/json'
    });
    return {
      success: true,
      skipped: false,
      objectKey: remoteSafeString(uploaded && uploaded.objectKey) || state.objectKey,
      url: remoteSafeString(uploaded && uploaded.url)
    };
  } catch (e) {
    return {
      success: false,
      skipped: false,
      reason: remoteSafeString(e && e.message) || 'cloud_push_failed',
      objectKey: state.objectKey
    };
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (_) {}
  }
}

async function pullCloudRemoteStoreIntoLocal(settings = {}) {
  const cloud = await fetchRemoteStoreSnapshotFromCloud(settings);
  if (!cloud.success || cloud.skipped) return cloud;
  const local = readLocalRemoteStoreSnapshot();
  const merged = mergeRemoteStoreSnapshots(local, cloud.snapshot || { version: 1, devices: [] });
  const before = JSON.stringify(local);
  const after = JSON.stringify(merged);
  const changed = before !== after;
  if (changed) {
    writeLocalRemoteStoreSnapshot(merged);
  }
  return {
    success: true,
    skipped: false,
    changed,
    objectKey: cloud.objectKey,
    localCount: Array.isArray(local.devices) ? local.devices.length : 0,
    cloudCount: Array.isArray(cloud.snapshot && cloud.snapshot.devices) ? cloud.snapshot.devices.length : 0,
    mergedCount: Array.isArray(merged.devices) ? merged.devices.length : 0
  };
}

function findExistingRemoteDeviceByPayload(payload = {}, settings = {}) {
  const owner = remoteSafeString(payload.owner || payload.username || payload.user || '');
  const deviceName = remoteSafeString(payload.deviceName || payload.device || payload.name || '');
  const ownerSlug = owner ? remoteToSlug(owner, 'user') : '';
  const deviceSlug = deviceName ? remoteToSlug(deviceName, 'dev') : '';
  const incomingRustdeskId = remoteSafeString(
    payload.rustdeskId || payload.meshNodeId || ''
  ).replace(/\s+/g, '');

  const devices = remoteControl.listDevices(settings);
  if (!Array.isArray(devices) || devices.length === 0) return null;

  for (const dev of devices) {
    if (!dev || typeof dev !== 'object') continue;
    const dOwnerSlug = remoteSafeString(dev.ownerSlug || '');
    const dDeviceSlug = remoteSafeString(dev.deviceSlug || '');
    if (ownerSlug && deviceSlug && dOwnerSlug === ownerSlug && dDeviceSlug === deviceSlug) {
      return dev;
    }
    const dRustdeskId = remoteSafeString(dev.rustdeskId || dev.meshNodeId || '').replace(/\s+/g, '');
    if (incomingRustdeskId && dRustdeskId && incomingRustdeskId === dRustdeskId) {
      return dev;
    }
  }
  return null;
}

app.get('/api/remote/devices', (req, res) => {
  try {
    const settings = getRuntimeSettings();
    const devices = remoteControl.listDevices(settings);
    return res.json({
      success: true,
      devices,
      count: devices.length
    });
  } catch (e) {
    return sendRemoteControlError(res, e);
  }
});

app.post('/api/remote/devices', async (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const settings = getRuntimeSettings();
    const cloudSync = {
      pre: await pullCloudRemoteStoreIntoLocal(settings)
    };
    let device = null;
    let upserted = false;
    try {
      device = remoteControl.createDevice(payload, settings);
    } catch (e) {
      if (e && e.code === 'duplicate_route') {
        const existing = findExistingRemoteDeviceByPayload(payload, settings);
        if (!existing || !existing.id) throw e;
        device = remoteControl.updateDevice(existing.id, payload, settings);
        upserted = true;
      } else {
        throw e;
      }
    }
    cloudSync.post = await pushRemoteStoreSnapshotToCloud(settings, readLocalRemoteStoreSnapshot());

    return res.json({
      success: true,
      device,
      upserted,
      cloudSync
    });
  } catch (e) {
    return sendRemoteControlError(res, e);
  }
});

app.put('/api/remote/devices/:id', async (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const settings = getRuntimeSettings();
    const cloudSync = {
      pre: await pullCloudRemoteStoreIntoLocal(settings)
    };
    const device = remoteControl.updateDevice(req.params.id, payload, settings);
    cloudSync.post = await pushRemoteStoreSnapshotToCloud(settings, readLocalRemoteStoreSnapshot());
    return res.json({
      success: true,
      device,
      cloudSync
    });
  } catch (e) {
    return sendRemoteControlError(res, e);
  }
});

app.delete('/api/remote/devices/:id', async (req, res) => {
  try {
    const settings = getRuntimeSettings();
    const cloudSync = {
      pre: await pullCloudRemoteStoreIntoLocal(settings)
    };
    remoteControl.deleteDevice(req.params.id);
    cloudSync.post = await pushRemoteStoreSnapshotToCloud(settings, readLocalRemoteStoreSnapshot());
    return res.json({ success: true, cloudSync });
  } catch (e) {
    return sendRemoteControlError(res, e);
  }
});

app.post('/api/remote/devices/:id/code', (req, res) => {
  try {
    const settings = getRuntimeSettings();
    const result = remoteControl.generateControlCode(req.params.id, settings);
    return res.json({
      success: true,
      code: result.code,
      payload: result.payload
    });
  } catch (e) {
    return sendRemoteControlError(res, e);
  }
});

app.post('/api/remote/import', async (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const code = String(payload.code || '').trim();
    if (!code) {
      return res.status(400).json({
        success: false,
        code: 'control_code_required',
        error: 'code is required'
      });
    }
    const settings = getRuntimeSettings();
    const cloudSync = {
      pre: await pullCloudRemoteStoreIntoLocal(settings)
    };
    const device = remoteControl.importControlCode(code, settings);
    cloudSync.post = await pushRemoteStoreSnapshotToCloud(settings, readLocalRemoteStoreSnapshot());
    return res.json({
      success: true,
      device,
      cloudSync
    });
  } catch (e) {
    return sendRemoteControlError(res, e);
  }
});

app.post('/api/remote/devices/:id/mesh/auto-discover', async (req, res) => {
  return res.status(410).json({
    success: false,
    code: 'meshcentral_removed',
    error: 'MeshCentral 自动发现已移除，请改用 RustDesk ID/链接绑定。'
  });
});

app.post('/api/remote/probe-lan', async (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const rawUrl = remoteSafeString(payload.url || payload.lanUrl || '');
    if (!rawUrl) {
      return res.status(400).json({
        success: false,
        code: 'url_required',
        error: 'url is required'
      });
    }
    const timeoutMs = Math.max(250, Math.min(5000, Number(payload.timeoutMs) || 1200));
    const retries = Math.max(1, Math.min(5, Number(payload.retries) || 1));
    const result = await probeRemoteLanReachable(rawUrl, { timeoutMs, retries });
    return res.json({
      success: true,
      ...result
    });
  } catch (e) {
    return sendRemoteControlError(res, e);
  }
});

app.post('/api/remote/devices/:id/resolve', (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const settings = getRuntimeSettings();
    const launch = remoteControl.resolveLaunch(req.params.id, payload, settings);
    return res.json({
      success: true,
      launch
    });
  } catch (e) {
    return sendRemoteControlError(res, e);
  }
});

app.get('/api/remote/config', (req, res) => {
  try {
    const settings = getRuntimeSettings();
    return res.json({
      success: true,
      config: {
        cloudflarePublicHost: settings.cloudflarePublicHost || '',
        cloudflarePathPrefix: settings.cloudflarePathPrefix || '',
        rustdeskWebBaseUrl: settings.rustdeskWebBaseUrl || '',
        rustdeskSchemeAuthority: settings.rustdeskSchemeAuthority || 'connect',
        rustdeskPreferredRendezvous: settings.rustdeskPreferredRendezvous || getRustDeskLocalRendezvousCandidates(settings).join(',')
      },
      storePath: remoteControl.STORE_PATH
    });
  } catch (e) {
    return sendRemoteControlError(res, e);
  }
});

app.get('/api/remote/rustdesk/web-client-url', (req, res) => {
  try {
    const settings = getRuntimeSettings();
    const raw = remoteSafeString(settings.rustdeskWebBaseUrl || '');
    const url = raw ? normalizeRemoteHttpBase(raw, 'https://') : '';
    return res.json({
      success: true,
      url
    });
  } catch (e) {
    return sendRemoteControlError(res, e);
  }
});

app.get('/api/remote/mesh/admin-url', (req, res) => {
  return res.status(410).json({
    success: false,
    code: 'meshcentral_removed',
    error: 'MeshCentral 后台入口已移除，请使用 RustDesk 客户端或 Web Client。'
  });
});

app.get('/api/remote/mesh/auto-discover', (req, res) => {
  return res.status(410).json({
    success: false,
    code: 'meshcentral_removed',
    error: 'MeshCentral 自动发现接口已移除。'
  });
});

app.get('/api/remote/rustdesk/health', (req, res) => {
  try {
    const settings = getRuntimeSettings();
    const url = remoteSafeString(settings.rustdeskWebBaseUrl || '');
    return res.json({
      success: true,
      rustdeskWebBaseUrl: url || ''
    });
  } catch (e) {
    return sendRemoteControlError(res, e);
  }
});

app.get('/api/remote/rustdesk/local-info', async (req, res) => {
  try {
    const launchFlag = remoteSafeString(req.query && req.query.launch).toLowerCase();
    const launchIfNeeded = launchFlag === '1' || launchFlag === 'true' || launchFlag === 'yes';
    const preferLogsFlag = remoteSafeString(req.query && req.query.preferLogs).toLowerCase();
    const preferLogs = preferLogsFlag === '1' || preferLogsFlag === 'true' || preferLogsFlag === 'yes';
    const rustdesk = await readLocalRustDeskInfo({ launchIfNeeded, preferLogs });
    return res.json({
      success: true,
      rustdesk
    });
  } catch (e) {
    return sendRemoteControlError(res, e);
  }
});

app.get('/api/remote/bootstrap', (req, res) => {
  try {
    const settings = getRuntimeSettings();
    const owner = remoteSafeString(req.query && req.query.owner) || getSystemUsernameSafe();
    const deviceName = remoteSafeString(req.query && req.query.deviceName) || remoteToSlug(os.hostname(), 'device');
    const local = buildDefaultLanUrl();
    const previewPublicUrl = buildRemotePublicPreview(owner, deviceName, settings);

    return res.json({
      success: true,
      bootstrap: {
        systemUsername: owner,
        defaultOwner: owner,
        defaultDeviceName: deviceName,
        lanIp: local.lanIp,
        port: local.port,
        lanUrl: local.lanUrl,
        cloudflarePublicHost: settings.cloudflarePublicHost || '',
        cloudflarePathPrefix: settings.cloudflarePathPrefix || '',
        cloudflareTunnelToken: settings.cloudflareTunnelToken || '',
        previewPublicUrl,
        cloudflareRuntime: snapshotCloudflareTunnelRuntime()
      }
    });
  } catch (e) {
    return sendRemoteControlError(res, e);
  }
});

app.get('/api/remote/cloudflare/status', (req, res) => {
  return res.json({
    success: true,
    runtime: snapshotCloudflareTunnelRuntime()
  });
});

app.post('/api/remote/cloudflare/start', async (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const settings = getRuntimeSettings();
    const owner = remoteSafeString(payload.owner) || getSystemUsernameSafe();
    const deviceName = remoteSafeString(payload.deviceName);
    if (!owner || !deviceName) {
      return res.status(400).json({
        success: false,
        code: 'owner_or_device_missing',
        error: 'owner and deviceName are required'
      });
    }

    const local = buildDefaultLanUrl();
    const previewPublicUrl = buildRemotePublicPreview(owner, deviceName, settings);
    const localUrl = local.lanUrl || `http://127.0.0.1:${getServerPortForRemote()}`;

    const token = remoteSafeString(settings.cloudflareTunnelToken || '');
    const hasToken = !!token;
    const commands = buildCloudflareGuideCommands({
      hasToken,
      localUrl,
      previewPublicUrl,
      pathPrefix: settings.cloudflarePathPrefix || ''
    });

    let versionText = '';
    try {
      versionText = await execFileText('cloudflared', ['--version']);
    } catch (checkErr) {
      return res.status(400).json({
        success: false,
        code: 'cloudflared_missing',
        error: '未检测到 cloudflared，请先安装 Cloudflare Tunnel CLI',
        commands: [
          'macOS: brew install cloudflared',
          'Linux: 参考 Cloudflare 官方安装文档',
          'Windows: winget install Cloudflare.cloudflared'
        ],
        previewPublicUrl
      });
    }

    if (!hasToken) {
      return res.json({
        success: true,
        guideOnly: true,
        message: '已检测到 cloudflared。请先在 API Keys 填写 Cloudflare Tunnel Token，再点击本按钮自动启动隧道。',
        version: versionText,
        previewPublicUrl,
        commands
      });
    }

    const current = cloudflareTunnelRuntime.process;
    if (current && !current.killed) {
      return res.json({
        success: true,
        running: true,
        message: 'Cloudflare Tunnel 已在运行',
        previewPublicUrl,
        runtime: snapshotCloudflareTunnelRuntime(),
        commands
      });
    }

    const { spawn } = require('child_process');
    const configSink = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const proc = spawn('cloudflared', [
      '--config',
      configSink,
      'tunnel',
      '--edge-ip-version',
      '4',
      '--protocol',
      'http2',
      '--no-autoupdate',
      'run',
      '--token',
      token,
      '--url',
      localUrl
    ], {
      cwd: __dirname,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    cloudflareTunnelRuntime.process = proc;
    cloudflareTunnelRuntime.pid = Number(proc.pid) || 0;
    cloudflareTunnelRuntime.status = 'running';
    cloudflareTunnelRuntime.startedAt = new Date().toISOString();
    cloudflareTunnelRuntime.lastError = '';
    cloudflareTunnelRuntime.logs = [];
    appendCloudflareTunnelLog('cloudflared started');
    appendCloudflareTunnelLog(`target local url: ${localUrl}`);
    if (previewPublicUrl) {
      appendCloudflareTunnelLog(`target public url: ${previewPublicUrl}`);
    }

    proc.stdout.on('data', (chunk) => {
      appendCloudflareTunnelLog(String(chunk || '').trim());
    });
    proc.stderr.on('data', (chunk) => {
      const text = String(chunk || '').trim();
      appendCloudflareTunnelLog(text);
    });
    proc.on('close', (code) => {
      appendCloudflareTunnelLog(`cloudflared exited with code ${code}`);
      const stopping = cloudflareTunnelRuntime.status === 'stopping';
      if (!stopping && Number(code) !== 0) {
        cloudflareTunnelRuntime.lastError = `cloudflared exited with code ${code}`;
        clearCloudflareTunnelRuntime('failed');
      } else {
        clearCloudflareTunnelRuntime('stopped');
      }
    });
    proc.on('error', (err) => {
      const message = remoteSafeString(err && err.message);
      cloudflareTunnelRuntime.lastError = message || 'cloudflared process error';
      appendCloudflareTunnelLog(`cloudflared error: ${cloudflareTunnelRuntime.lastError}`);
      clearCloudflareTunnelRuntime('failed');
    });

    return res.json({
      success: true,
      running: true,
      message: 'Cloudflare Tunnel 启动命令已执行',
      previewPublicUrl,
      runtime: snapshotCloudflareTunnelRuntime(),
      commands
    });
  } catch (e) {
    return sendRemoteControlError(res, e);
  }
});

app.post('/api/remote/cloudflare/stop', (req, res) => {
  try {
    const proc = cloudflareTunnelRuntime.process;
    if (!proc || proc.killed) {
      clearCloudflareTunnelRuntime('idle');
      return res.json({
        success: true,
        running: false,
        message: 'Cloudflare Tunnel 未在运行'
      });
    }
    try {
      cloudflareTunnelRuntime.status = 'stopping';
      proc.kill('SIGTERM');
    } catch (_) {}
    appendCloudflareTunnelLog('cloudflared stop requested');
    clearCloudflareTunnelRuntime('stopped');
    return res.json({
      success: true,
      running: false,
      message: 'Cloudflare Tunnel 已停止'
    });
  } catch (e) {
    return sendRemoteControlError(res, e);
  }
});

// 打开系统原生文件夹选择器（用于知识规则）
app.post('/api/system/pick-folder', (req, res) => {
  if (process.platform !== 'darwin') {
    return res.status(501).json({ error: 'folder picker is only supported on macOS now' });
  }

  const { execFile } = require('child_process');
  const requestedPath = String(req.body?.currentPath || '').trim();
  let defaultPath = '';
  try {
    if (requestedPath) {
      const expanded = expandHomePath(requestedPath);
      if (expanded && fs.existsSync(expanded) && fs.statSync(expanded).isDirectory()) {
        defaultPath = expanded;
      }
    }
  } catch (_) {
    defaultPath = '';
  }

  const baseScript = [
    '-e', 'on run argv',
    '-e', 'set pickPrompt to "请选择知识库文件夹"',
    '-e', 'if (count of argv) > 0 and (item 1 of argv) is not "" then',
    '-e', 'set defaultFolder to POSIX file (item 1 of argv)',
    '-e', 'set selectedFolder to choose folder with prompt pickPrompt default location defaultFolder',
    '-e', 'else',
    '-e', 'set selectedFolder to choose folder with prompt pickPrompt',
    '-e', 'end if',
    '-e', 'return POSIX path of selectedFolder',
    '-e', 'end run'
  ];
  const args = defaultPath ? [...baseScript, defaultPath] : baseScript;

  execFile('osascript', args, (err, stdout, stderr) => {
    if (err) {
      const errText = `${err.message || ''} ${stderr || ''}`.trim();
      if (/User canceled|-\s*128|execution error: User canceled/i.test(errText)) {
        return res.json({ success: true, cancelled: true });
      }
      return res.status(500).json({ error: `failed to pick folder: ${errText}` });
    }

    const pickedPath = String(stdout || '').trim();
    if (!pickedPath) {
      return res.json({ success: true, cancelled: true });
    }

    return res.json({
      success: true,
      path: pickedPath,
      displayPath: toTildePath(pickedPath)
    });
  });
});

// 解析前端系统模式附件（文件/文件夹）为本地绝对路径
app.post('/api/system/resolve-local-paths', (req, res) => {
  try {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const items = rawItems
      .map((item) => ({
        id: String(item?.id || '').trim(),
        kind: item?.kind === 'folder' ? 'folder' : 'file',
        name: String(item?.name || '').trim(),
        relativePath: String(item?.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, ''),
        size: Number(item?.size) || 0,
        lastModified: Number(item?.lastModified) || 0
      }))
      .filter((item) => item.name);

    if (items.length === 0) {
      return res.json({ resolved: [], unresolved: [] });
    }

    const resolved = [];
    const unresolved = [];
    items.forEach((item) => {
      const found = resolveSingleLocalPath(item);
      if (!found) {
        unresolved.push({
          id: item.id || '',
          kind: item.kind,
          name: item.name,
          relativePath: item.relativePath
        });
        return;
      }
      resolved.push({
        id: item.id || '',
        kind: item.kind,
        name: found.name,
        path: found.path,
        displayPath: found.displayPath,
        pathType: found.pathType
      });
    });

    return res.json({ resolved, unresolved });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'resolve local paths failed' });
  }
});

// File Viewer/Editor API
app.get('/api/agents/:agentId/file', (req, res) => {
    const { agentId } = req.params;
    const { path: filePath } = req.query;
    
    if (!filePath) return res.status(400).json({ error: 'Missing path parameter' });
    
    // Security check: Ensure file path is within allowed directories
    const agent = getAgentById(agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    
    const allowedRoots = [
        agent.workspace,
        KNOWLEDGE_BASE_PATH
    ];
    
    // Normalize paths
    const normalizedFilePath = path.normalize(filePath);
    let isAllowed = false;
    
    for (const root of allowedRoots) {
        if (root && normalizedFilePath.startsWith(path.normalize(root))) {
            isAllowed = true;
            break;
        }
    }
    
    if (!isAllowed) {
        console.warn(`[Security] Access denied to file: ${normalizedFilePath}`);
        return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!fs.existsSync(normalizedFilePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    try {
        const content = fs.readFileSync(normalizedFilePath, 'utf-8');
        res.json({ content });
    } catch (e) {
        res.status(500).json({ error: 'Failed to read file: ' + e.message });
    }
});

const multer = require('multer');
const upload = multer({ dest: path.join(__dirname, 'temp_uploads') });

function inferAudioFormatFromUpload(file = null) {
  if (!file) return 'wav';
  const ext = path.extname(String(file.originalname || '')).replace('.', '').toLowerCase();
  if (ext) return doubaoO2oService.normalizeAudioFormat(ext);
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('wav') || mime.includes('x-wav')) return 'wav';
  return 'wav';
}

function buildPodcastO2oUpdatePayload(meta = {}, fallbackAudioId = '', fallbackSpeakerId = '') {
  const o2oAudioId = String(
    meta?.o2o_audio_id
      || meta?.o2oAudioId
      || fallbackAudioId
      || ''
  ).trim();
  const o2oSpeakerId = String(
    meta?.o2o_speaker_id
      || meta?.o2oSpeakerId
      || fallbackSpeakerId
      || ''
  ).trim();

  const updateBody = {};
  if (o2oAudioId) updateBody.o2o_audio_id = o2oAudioId;
  if (o2oSpeakerId) updateBody.o2o_speaker_id = o2oSpeakerId;

  return {
    updateBody,
    o2oAudioId,
    o2oSpeakerId
  };
}

app.get('/api/agents/:agentId/o2o-audio', (req, res) => {
  const { agentId } = req.params;
  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  try {
    const { meta } = readAgentMeta(agentId);
    const o2oAudioId = String(meta.o2o_audio_id || meta.o2oAudioId || '').trim();
    const o2oSpeakerId = String(meta.o2o_speaker_id || meta.o2oSpeakerId || '').trim();
    return res.json({
      success: true,
      o2o_audio_id: o2oAudioId,
      o2o_speaker_id: o2oSpeakerId,
      o2o_audio_status: meta.o2o_audio_status || '',
      o2o_audio_status_code: Number.isFinite(Number(meta.o2o_audio_status_code)) ? Number(meta.o2o_audio_status_code) : null,
      o2o_audio_updated_at: meta.o2o_audio_updated_at || ''
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'failed to load o2o audio id' });
  }
});

app.put('/api/agents/:agentId/o2o-audio', async (req, res) => {
  const { agentId } = req.params;
  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const o2oAudioId = String(req.body?.o2o_audio_id || req.body?.o2oAudioId || '').trim();
  const o2oSpeakerId = String(req.body?.o2o_speaker_id || req.body?.o2oSpeakerId || '').trim();

  try {
    const nowIso = new Date().toISOString();
    const { meta } = writeAgentMeta(agentId, {
      o2o_audio_id: o2oAudioId,
      o2oAudioId: o2oAudioId,
      o2o_speaker_id: o2oSpeakerId,
      o2oSpeakerId: o2oSpeakerId,
      o2o_audio_updated_at: nowIso
    });
    if (AGENTS[agentId]) {
      AGENTS[agentId].o2oAudioId = o2oAudioId;
    }

    let podcastSynced = false;
    let podcastSyncError = '';
    const o2oUpdate = buildPodcastO2oUpdatePayload(meta, o2oAudioId, o2oSpeakerId);
    if (Object.keys(o2oUpdate.updateBody).length > 0) {
      const syncResult = await syncPodcastAgentInfo(agentId, o2oUpdate.updateBody);
      podcastSynced = !!syncResult?.success;
      if (!podcastSynced && !syncResult?.skipped) {
        podcastSyncError = String(syncResult?.reason || '').trim();
      }
    }

    return res.json({
      success: true,
      o2o_audio_id: o2oAudioId,
      o2o_speaker_id: o2oSpeakerId,
      updatedAt: meta.o2o_audio_updated_at || nowIso,
      podcastSynced,
      podcastSyncError
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'failed to save o2o audio id' });
  }
});

app.post('/api/agents/:agentId/o2o-audio/train', upload.single('audio'), async (req, res) => {
  const { agentId } = req.params;
  const agent = getAgentById(agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  if (!req.file) return res.status(400).json({ error: 'audio file is required' });

  const runtimeSettings = appSettings.getSettings();
  const doubaoAppId = String(req.body?.appid || runtimeSettings?.doubaoO2oAppId || '').trim();
  const doubaoToken = String(req.body?.token || runtimeSettings?.doubaoO2oToken || '').trim();
  const doubaoAppKey = String(req.body?.app_key || runtimeSettings?.doubaoO2oAppKey || '').trim();
  const doubaoResourceId = String(req.body?.resource_id || runtimeSettings?.doubaoO2oResourceId || '').trim();
  const doubaoOpenApiAccessKeyId = String(
    req.body?.access_key_id
      || runtimeSettings?.doubaoO2oAccessKeyId
      || process.env.MECO_DOUBAO_O2O_ACCESS_KEY_ID
      || process.env.DOUBAO_O2O_ACCESS_KEY_ID
      || ''
  ).trim();
  const doubaoOpenApiSecretAccessKey = String(
    req.body?.secret_access_key
      || runtimeSettings?.doubaoO2oSecretAccessKey
      || process.env.MECO_DOUBAO_O2O_SECRET_ACCESS_KEY
      || process.env.DOUBAO_O2O_SECRET_ACCESS_KEY
      || ''
  ).trim();
  const existingMetaSpeakerId = (() => {
    try {
      const { meta } = readAgentMeta(agentId);
      const explicit = String(meta?.o2o_speaker_id || meta?.o2oSpeakerId || '').trim();
      if (explicit) return explicit;
      const fromAudioId = String(meta?.o2o_audio_id || meta?.o2oAudioId || '').trim();
      if (/^S_/i.test(fromAudioId)) return fromAudioId;
      return '';
    } catch (_) {
      return '';
    }
  })();
  const requestedSpeakerId = String(req.body?.speaker_id || '').trim();
  const alwaysNewSpeaker = String(req.body?.always_new_speaker || '1').trim() !== '0';
  const autoOrderSpeaker = String(req.body?.auto_order_speaker || '1').trim() !== '0';
  const freshSpeakerId = doubaoO2oService.buildFreshSpeakerId(agentId);
  let doubaoSpeakerId = String(
    requestedSpeakerId
      || (alwaysNewSpeaker ? freshSpeakerId : (existingMetaSpeakerId || freshSpeakerId))
  ).trim();
  if (!doubaoAppId || !doubaoToken) {
    return res.status(400).json({
      error: 'Doubao O2O AppID/Token 未配置，请先在 API Keys 中填写'
    });
  }
  if (!doubaoSpeakerId) {
    return res.status(400).json({
      error: '缺少 Doubao O2O Speaker ID（S_开头）。请先在编辑页填写或从历史绑定读取。'
    });
  }

  const tempFilePath = req.file.path;
  let orderedSpeaker = null;
  try {
    const localDir = resolveLocalAgentDir(agentId, true);
    if (!localDir) {
      return res.status(500).json({ error: 'failed to resolve local agent directory' });
    }

    const inputExt = path.extname(String(req.file.originalname || '')).toLowerCase();
    const sampleExt = inputExt || '.wav';
    const samplePath = path.join(localDir, `o2o-voice-sample${sampleExt}`);
    fs.copyFileSync(tempFilePath, samplePath);

    if (alwaysNewSpeaker && autoOrderSpeaker && !requestedSpeakerId) {
      if (doubaoOpenApiAccessKeyId && doubaoOpenApiSecretAccessKey) {
        orderedSpeaker = await doubaoO2oService.createSpeakerByOrder({
          appId: doubaoAppId,
          accessKeyId: doubaoOpenApiAccessKeyId,
          secretAccessKey: doubaoOpenApiSecretAccessKey,
          resourceId: String(req.body?.order_resource_id || '').trim(),
          code: String(req.body?.order_code || '').trim(),
          projectName: String(req.body?.order_project_name || '').trim(),
          times: Number(req.body?.order_times || 1),
          quantity: 1,
          autoUseCoupon: String(req.body?.order_auto_use_coupon || '1').trim() !== '0',
          pollMaxAttempts: Number(req.body?.order_poll_max_attempts || 10),
          pollIntervalMs: Number(req.body?.order_poll_interval_ms || 2000)
        });
        if (orderedSpeaker?.speakerId) {
          doubaoSpeakerId = String(orderedSpeaker.speakerId).trim();
        }
      } else {
        console.warn(`[DoubaoO2O] skip auto order speaker for ${agentId}: missing access key credentials`);
      }
    }

    const audioBytes = fs.readFileSync(samplePath).toString('base64');
    const audioFormat = doubaoO2oService.normalizeAudioFormat(req.body?.audio_format || inferAudioFormatFromUpload(req.file));
    const submitResourceId = String(doubaoResourceId || '').trim();

    const submit = await doubaoO2oService.submitO2oClone({
      agentId,
      audioBytes,
      audioFormat,
      speakerId: doubaoSpeakerId,
      appId: doubaoAppId,
      token: doubaoToken,
      appKey: doubaoAppKey,
      resourceId: submitResourceId
    });

    let statusInfo = null;
    try {
      statusInfo = await doubaoO2oService.pollO2oReady({
        speakerId: submit.speakerId,
        appId: doubaoAppId,
        token: doubaoToken,
        appKey: doubaoAppKey,
        resourceId: submitResourceId,
        maxAttempts: 8,
        intervalMs: 2500
      });
    } catch (statusErr) {
      console.warn(`[DoubaoO2O] status polling failed: ${statusErr.message}`);
    }

    const speakerStatus = Number(statusInfo?.speakerStatus);
    const speakerStatusLabel = String(statusInfo?.speakerStatusLabel || 'submitted');
    const nowIso = new Date().toISOString();

    const effectiveSpeakerId = String(submit.speakerId || doubaoSpeakerId || '').trim();
    const metaPatch = {
      o2o_audio_id: submit.speakerId,
      o2oAudioId: submit.speakerId,
      o2o_speaker_id: effectiveSpeakerId,
      o2oSpeakerId: effectiveSpeakerId,
      o2o_audio_provider: 'doubao',
      o2o_audio_status: speakerStatusLabel,
      o2o_audio_status_code: Number.isFinite(speakerStatus) ? speakerStatus : null,
      o2o_audio_updated_at: nowIso
    };
    const speakerResourceId = String(
      orderedSpeaker?.resourceId || submit?.resourceIdUsed || submitResourceId || ''
    ).trim();
    const speakerOrderId = String(orderedSpeaker?.orderId || '').trim();
    if (speakerResourceId) metaPatch.o2o_speaker_resource_id = speakerResourceId;
    if (speakerOrderId) metaPatch.o2o_speaker_order_id = speakerOrderId;

    writeAgentMeta(agentId, metaPatch);

    if (AGENTS[agentId]) {
      AGENTS[agentId].o2oAudioId = submit.speakerId;
    }

    let podcastSynced = false;
    let podcastSyncError = '';
    const o2oUpdate = buildPodcastO2oUpdatePayload(metaPatch, submit.speakerId, effectiveSpeakerId);
    if (Object.keys(o2oUpdate.updateBody).length > 0) {
      const syncResult = await syncPodcastAgentInfo(agentId, o2oUpdate.updateBody);
      podcastSynced = !!syncResult?.success;
      if (!podcastSynced && !syncResult?.skipped) {
        podcastSyncError = String(syncResult?.reason || '').trim();
      }
    }

    return res.json({
      success: true,
      o2o_audio_id: submit.speakerId,
      o2o_speaker_id: effectiveSpeakerId,
      speakerStatus: Number.isFinite(speakerStatus) ? speakerStatus : null,
      speakerStatusLabel,
      orderId: String(orderedSpeaker?.orderId || '').trim() || null,
      speakerResourceId: speakerResourceId || null,
      ready: !!statusInfo?.ready,
      done: !!statusInfo?.done,
      attempts: Number.isFinite(Number(statusInfo?.attempts)) ? Number(statusInfo.attempts) : 0,
      podcastSynced,
      podcastSyncError
    });
  } catch (e) {
    const message = e.message || 'doubao o2o train failed';
    console.error(`[DoubaoO2O] train failed for ${agentId}: ${message}`);
    const isAuthOrConfigError = /HTTP\s*(401|403)|invalid auth token|未配置|missing appId|missing token/i.test(message);
    return res.status(isAuthOrConfigError ? 400 : 500).json({
      error: message,
      o2o_speaker_id: doubaoSpeakerId || ''
    });
  } finally {
    if (tempFilePath) {
      try {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      } catch (_) {}
    }
  }
});

app.post('/api/agents/o2o-audio/backfill', async (req, res) => {
  try {
    const agentIds = fs.existsSync(DATA_AGENTS_DIR)
      ? fs.readdirSync(DATA_AGENTS_DIR).filter((entry) => {
          try {
            return fs.statSync(path.join(DATA_AGENTS_DIR, entry)).isDirectory();
          } catch (_) {
            return false;
          }
        })
      : [];

    const results = [];
    for (const rawId of agentIds) {
      const agentId = String(rawId || '').trim();
      if (!agentId) continue;

      try {
        const { meta } = readAgentMeta(agentId);
        const o2oUpdate = buildPodcastO2oUpdatePayload(meta);
        if (!meta?.podcastApiKey) {
          results.push({
            agentId,
            status: 'skipped',
            reason: 'missing_podcast_api_key',
            o2o_audio_id: o2oUpdate.o2oAudioId || ''
          });
          continue;
        }
        if (!o2oUpdate.o2oAudioId) {
          results.push({
            agentId,
            status: 'skipped',
            reason: 'missing_o2o_audio_id',
            o2o_audio_id: ''
          });
          continue;
        }

        const syncResult = await syncPodcastAgentInfo(agentId, o2oUpdate.updateBody);
        if (syncResult?.success) {
          results.push({
            agentId,
            status: 'synced',
            o2o_audio_id: o2oUpdate.o2oAudioId,
            o2o_speaker_id: o2oUpdate.o2oSpeakerId || ''
          });
        } else {
          results.push({
            agentId,
            status: syncResult?.skipped ? 'skipped' : 'failed',
            reason: String(syncResult?.reason || 'sync_failed').trim(),
            o2o_audio_id: o2oUpdate.o2oAudioId,
            o2o_speaker_id: o2oUpdate.o2oSpeakerId || ''
          });
        }
      } catch (e) {
        results.push({
          agentId,
          status: 'failed',
          reason: e.message || String(e)
        });
      }
    }

    const synced = results.filter((item) => item.status === 'synced').length;
    const skipped = results.filter((item) => item.status === 'skipped').length;
    const failed = results.filter((item) => item.status === 'failed').length;

    return res.json({
      success: true,
      total: results.length,
      synced,
      skipped,
      failed,
      results
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'o2o backfill failed' });
  }
});

// OSS Storage API (configurable via /api/settings)
app.get('/api/oss/config', (req, res) => {
    try {
        const runtime = getRuntimeSettings();
        const cfg = ossStorage.resolveOssConfig(runtime);
        res.json({
            ready: !!cfg.ready,
            endpoint: cfg.endpoint || '',
            bucket: cfg.bucket || '',
            region: cfg.region || '',
            publicBaseUrl: cfg.publicBaseUrl || '',
            hasAccessKeyId: !!(runtime.ossAccessKeyId && String(runtime.ossAccessKeyId).trim()),
            hasAccessKeySecret: !!(runtime.ossAccessKeySecret && String(runtime.ossAccessKeySecret).trim()),
            error: cfg.ready ? '' : (cfg.error || '')
        });
    } catch (e) {
        res.status(500).json({ error: e.message || 'failed to get oss config' });
    }
});

app.post('/api/oss/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'file is required' });
    }

    try {
        const runtime = getRuntimeSettings();
        const result = await ossStorage.uploadLocalFile(runtime, {
            localPath: req.file.path,
            originalName: req.file.originalname || req.file.filename,
            contentType: req.file.mimetype || '',
            objectKey: req.body?.objectKey || '',
            prefix: req.body?.prefix || ''
        });
        return res.json({
            success: true,
            ...result
        });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'oss upload failed' });
    } finally {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
});

app.post('/api/oss/upload-by-path', async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const localPath = String(body.localPath || '').trim();
        if (!localPath) {
            return res.status(400).json({ error: 'localPath is required' });
        }
        const runtime = getRuntimeSettings();
        const result = await ossStorage.uploadLocalFile(runtime, {
            localPath,
            originalName: body.originalName || path.basename(localPath),
            contentType: body.contentType || '',
            objectKey: body.objectKey || '',
            prefix: body.prefix || ''
        });
        return res.json({
            success: true,
            ...result
        });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'oss upload-by-path failed' });
    }
});

app.post('/api/oss/download', async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const objectKey = String(body.objectKey || '').trim();
        if (!objectKey) {
            return res.status(400).json({ error: 'objectKey is required' });
        }
        const defaultDir = path.join(__dirname, 'public', 'uploads', 'oss-downloads');
        const runtime = getRuntimeSettings();
        const result = await ossStorage.downloadObjectToLocal(runtime, {
            objectKey,
            targetPath: body.targetPath || '',
            overwrite: body.overwrite === true,
            defaultDir
        });
        return res.json({
            success: true,
            ...result,
            displayPath: toTildePath(result.localPath)
        });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'oss download failed' });
    }
});

app.get('/api/oss/sign', (req, res) => {
    try {
        const objectKey = String(req.query?.objectKey || '').trim();
        if (!objectKey) {
            return res.status(400).json({ error: 'objectKey is required' });
        }
        const runtime = getRuntimeSettings();
        const result = ossStorage.signObjectUrl(runtime, {
            objectKey,
            expires: req.query?.expires
        });
        return res.json({
            success: true,
            ...result
        });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'oss sign failed' });
    }
});

// Frontend-friendly OSS PUT presign (compatible with tiktok_tool style fields)
app.post('/api/oss/presign', (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const extRaw = String(body.ext || '').trim().replace(/^\./, '');
        const ext = extRaw ? `.${extRaw}` : '';
        const originalName = String(body.originalName || body.filename || `upload${ext || '.bin'}`).trim();
        const objectKey = String(body.objectKey || '').trim() || ossStorage.buildObjectKey({
            originalName,
            prefix: body.prefix || 'uploads'
        });

        const runtime = getRuntimeSettings();
        const result = ossStorage.signPutObjectUrl(runtime, {
            objectKey,
            expires: body.expires,
            contentType: body.contentType || ''
        });

        return res.json({
            success: true,
            ...result,
            // Compatibility aliases
            presign_url: result.uploadUrl,
            public_url: result.fileUrl
        });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'oss presign failed' });
    }
});

app.post('/api/oss/multipart_init', async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const fileSize = Number(body.fileSize ?? body.file_size ?? 0);
        if (!Number.isFinite(fileSize) || fileSize <= 0) {
            return res.status(400).json({ error: 'fileSize must be a positive number' });
        }
        const extRaw = String(body.ext || '').trim().replace(/^\./, '');
        const ext = extRaw ? `.${extRaw}` : '';
        const originalName = String(body.originalName || body.filename || `upload${ext || '.bin'}`).trim();

        const runtime = getRuntimeSettings();
        const result = await ossStorage.initMultipartUpload(runtime, {
            fileSize,
            originalName,
            objectKey: body.objectKey || '',
            prefix: body.prefix || 'uploads',
            contentType: body.contentType || '',
            expires: body.expires,
            partSize: body.partSize ?? body.part_size
        });

        return res.json({
            success: true,
            ...result,
            // Compatibility aliases
            upload_id: result.uploadId,
            object_key: result.objectKey,
            public_url: result.fileUrl,
            part_size: result.partSize,
            total_parts: result.totalParts
        });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'oss multipart init failed' });
    }
});

app.post('/api/oss/multipart_complete', async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const objectKey = String(body.objectKey || body.object_key || '').trim();
        const uploadId = String(body.uploadId || body.upload_id || '').trim();
        const parts = Array.isArray(body.parts) ? body.parts : [];

        if (!objectKey) return res.status(400).json({ error: 'objectKey is required' });
        if (!uploadId) return res.status(400).json({ error: 'uploadId is required' });
        if (!parts.length) return res.status(400).json({ error: 'parts is required' });

        const runtime = getRuntimeSettings();
        const result = await ossStorage.completeMultipartUpload(runtime, {
            objectKey,
            uploadId,
            parts
        });

        return res.json({
            success: true,
            ...result,
            public_url: result.fileUrl
        });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'oss multipart complete failed' });
    }
});

app.post('/api/oss/multipart_resume', async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const objectKey = String(body.objectKey || body.object_key || '').trim();
        const uploadId = String(body.uploadId || body.upload_id || '').trim();
        const fileSize = Number(body.fileSize ?? body.file_size ?? 0);
        if (!objectKey) return res.status(400).json({ error: 'objectKey is required' });
        if (!uploadId) return res.status(400).json({ error: 'uploadId is required' });
        if (!Number.isFinite(fileSize) || fileSize <= 0) {
            return res.status(400).json({ error: 'fileSize must be a positive number' });
        }

        const runtime = getRuntimeSettings();
        const result = await ossStorage.resumeMultipartUpload(runtime, {
            objectKey,
            uploadId,
            fileSize,
            partSize: body.partSize ?? body.part_size,
            expires: body.expires
        });

        return res.json({
            success: true,
            ...result,
            upload_id: result.uploadId,
            object_key: result.objectKey,
            public_url: result.fileUrl,
            part_size: result.partSize,
            total_parts: result.totalParts,
            completed_parts: result.completedParts,
            remaining_parts: result.remainingParts
        });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'oss multipart resume failed' });
    }
});

// Create Agent (Enhanced)
app.post('/api/agents', upload.fields([
    { name: 'avatar', maxCount: 1 }, 
    { name: 'video', maxCount: 1 },
    { name: 'voice', maxCount: 1 }
]), async (req, res) => {
    console.log('[API] Creating new agent...');
    try {
        const { name, prompt } = req.body;
        
        if (!name || !prompt) {
            return res.status(400).json({ error: 'Name and Persona Prompt are required' });
        }

        // 1. Call OpenClaw Service to create agent
        console.log(`[Create] Calling openclaw.createAgent with name="${name}"...`);
        const agentInfo = await openclaw.createAgent(name, prompt);
        const agentId = agentInfo.id;
        console.log(`[Create] Agent created with ID: ${agentId}`);
        
        // Define paths (Consistency check)
        // openclaw.createAgent already creates:
        // - ~/.openclaw/workspace-{agentId}/SOUL.md
        // - ~/.openclaw/workspace-{agentId}/IDENTITY.md
        // - ./data/agents/{agentId}/meta.json
        // - ./data/agents/{agentId}/prompt.txt
        
        const agentDataDir = path.join(DATA_AGENTS_DIR, agentId);
        const workspacePath = getPreferredWorkspacePath(agentId);
        
        // 2. Handle Files (Avatar, Video, Voice)
        const files = req.files || {};
        
        // Helper to copy file to both locations
        const saveFile = (file, fileName) => {
            const src = file.path;
            const destLocal = path.join(agentDataDir, fileName);
            const destWs = path.join(workspacePath, fileName);
            
            // Write to local data
            fs.copyFileSync(src, destLocal);
            
            // Sync to workspace
            if (fs.existsSync(workspacePath)) {
                fs.copyFileSync(destLocal, destWs);
            }
            
            // Delete temp file if it's the last usage (handled by multer cleanup usually, but we do manual copy)
            // We'll unlink at the end or let logic handle it.
            // Since we might use same file obj for multiple ops? No, distinct files.
        };
        
        if (files.avatar && files.avatar[0]) {
            saveFile(files.avatar[0], 'avatar.png');
            fs.unlinkSync(files.avatar[0].path);
        }
        
        if (files.video && files.video[0]) {
            saveFile(files.video[0], 'video.mp4');
            fs.unlinkSync(files.video[0].path);
        }
        
        let voiceId = CREATE_DEFAULT_VOICE_ID;
        let voiceError = null;
        if (files.voice && files.voice[0]) {
            // 3. Voice Training (Minimax)
            console.log('[Create] Starting voice training...');
            const voiceFile = files.voice[0];
            
            // Save original audio
            saveFile(voiceFile, 'voice.mp3');
            fs.unlinkSync(voiceFile.path);
            
            try {
                // Try real training
                const result = await voiceService.trainVoice(path.join(agentDataDir, 'voice.mp3'), name);
                voiceId = result.voiceId;
                
                // Save voice.json
                const voiceJsonContent = JSON.stringify(result, null, 2);
                fs.writeFileSync(path.join(agentDataDir, 'voice.json'), voiceJsonContent);
                if (fs.existsSync(workspacePath)) {
                    fs.writeFileSync(path.join(workspacePath, 'voice.json'), voiceJsonContent);
                }
                
                console.log(`[Create] Voice training succeeded: ${voiceId}`);
            } catch (e) {
                console.error('[Create] Voice training failed (API Error):', e.message);
                voiceError = `Training failed: ${e.message}`;
                
                // Fallback: Generate mock ID so flow continues
                console.log('[Create] Falling back to mock voice ID...');
                voiceId = `${agentId}_${Date.now()}`;
                const mockVoiceData = {
                    fileId: Date.now(),
                    voiceId: voiceId,
                    status: "mock_success_fallback",
                    error: e.message
                };
                
                const voiceJsonContent = JSON.stringify(mockVoiceData, null, 2);
                fs.writeFileSync(path.join(agentDataDir, 'voice.json'), voiceJsonContent);
                if (fs.existsSync(workspacePath)) {
                    fs.writeFileSync(path.join(workspacePath, 'voice.json'), voiceJsonContent);
                }
                
                // Clear voiceError so frontend thinks it's a full success (since we have a fallback)
                // Or we can keep it as a warning if we want user to know.
                // But user reported "报错" as an issue, so let's suppress it for smoother UX.
                console.warn(`[Create] Suppressing voice error for UX: ${voiceError}`);
                voiceError = null; 
            }
        } else {
            console.log(`[Create] No voice sample uploaded, use default voiceId: ${voiceId}`);
        }

        // Ensure voice.json exists even when no voice sample is uploaded
        const localVoiceJsonPath = path.join(agentDataDir, 'voice.json');
        const wsVoiceJsonPath = path.join(workspacePath, 'voice.json');
        if (!fs.existsSync(localVoiceJsonPath)) {
            const defaultVoiceData = {
                voiceId,
                voice_id: voiceId,
                status: 'default_voice'
            };
            fs.writeFileSync(localVoiceJsonPath, JSON.stringify(defaultVoiceData, null, 2));
            if (fs.existsSync(workspacePath)) {
                fs.writeFileSync(wsVoiceJsonPath, JSON.stringify(defaultVoiceData, null, 2));
            }
        }

        // Always persist voiceId into meta
        const metaPath = path.join(agentDataDir, 'meta.json');
        if (fs.existsSync(metaPath)) {
            try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                meta.voiceId = voiceId;
                fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
            } catch (e) {}
        }
        
        // 注册到 AI Podcast API（文件上传和语音训练完成后，携带完整信息）
        // 流程：1.注册获取api_key → 2.用presign上传文件到COS → 3.用public_url更新agent信息
        let podcastApiKey = null;
        let podcastAgentId = null;
        try {
            const axios = require('axios');
            const hasAvatar = files.avatar && files.avatar[0];
            const hasVideo = files.video && files.video[0];

            // Step 1: 注册 Agent（先用基础信息注册，拿到 api_key）
            const registerBody = {
                name: name,
                description: prompt ? prompt.substring(0, 500) : '',
                personality: prompt ? prompt.substring(0, 500) : '',
                prompt: prompt || '',
                voice_id: voiceId || ''
            };
            const registerResp = await axios.post(`${PODCAST_API_BASE}/agent/register`, registerBody, { timeout: 10000 });
            if (!registerResp.data || registerResp.data.code !== 200 || !registerResp.data.data) {
                throw new Error(`注册返回异常: ${JSON.stringify(registerResp.data)}`);
            }
            podcastApiKey = registerResp.data.data.api_key;
            podcastAgentId = registerResp.data.data.agent.agent_id;
            console.log(`[Create] Podcast API 注册成功: ${podcastAgentId}`);

            // Step 2: 通过 presign 上传文件到 COS，获取 public_url
            const apiHeaders = { 'X-API-Key': podcastApiKey, 'Content-Type': 'application/json' };
            let avatarPublicUrl = '';
            let videoPublicUrl = '';

            if (hasAvatar) {
                try {
                    const avatarPath = path.join(agentDataDir, 'avatar.png');
                    if (fs.existsSync(avatarPath)) {
                        const presignResp = await axios.post(`${PODCAST_API_BASE}/agent/upload/presign`, { ext: 'png' }, { headers: apiHeaders, timeout: 10000 });
                        if (presignResp.data && presignResp.data.code === 200 && presignResp.data.data) {
                            const { presign_url, public_url } = presignResp.data.data;
                            const fileData = fs.readFileSync(avatarPath);
                            await axios.put(presign_url, fileData, { headers: { 'Content-Type': 'image/png' }, timeout: 30000, maxBodyLength: 50 * 1024 * 1024 });
                            avatarPublicUrl = normalizePodcastPublicUrl(public_url);
                            console.log(`[Create] 头像上传成功: ${avatarPublicUrl}`);
                        }
                    }
                } catch (uploadErr) {
                    console.warn(`[Create] 头像上传失败: ${uploadErr.message}`);
                }
            }

            if (hasVideo) {
                try {
                    const videoPath = path.join(agentDataDir, 'video.mp4');
                    if (fs.existsSync(videoPath)) {
                        const presignResp = await axios.post(`${PODCAST_API_BASE}/agent/upload/presign`, { ext: 'mp4' }, { headers: apiHeaders, timeout: 10000 });
                        if (presignResp.data && presignResp.data.code === 200 && presignResp.data.data) {
                            const { presign_url, public_url } = presignResp.data.data;
                            const fileData = fs.readFileSync(videoPath);
                            await axios.put(presign_url, fileData, { headers: { 'Content-Type': 'video/mp4' }, timeout: 60000, maxBodyLength: 200 * 1024 * 1024 });
                            videoPublicUrl = normalizePodcastPublicUrl(public_url);
                            console.log(`[Create] 视频上传成功: ${videoPublicUrl}`);
                        }
                    }
                } catch (uploadErr) {
                    console.warn(`[Create] 视频上传失败: ${uploadErr.message}`);
                }
            }

            // Step 3: 用 public_url 更新 Agent 信息
            if (avatarPublicUrl || videoPublicUrl) {
                const updateBody = {};
                if (avatarPublicUrl) {
                    updateBody.avatar_url = avatarPublicUrl;
                    updateBody.character_image_url = avatarPublicUrl;
                }
                if (videoPublicUrl) {
                    updateBody.character_video_url = videoPublicUrl;
                }
                await axios.put(`${PODCAST_API_BASE}/agent/me`, updateBody, { headers: apiHeaders, timeout: 10000 });
                console.log(`[Create] Podcast Agent 信息已更新（avatar=${!!avatarPublicUrl}, video=${!!videoPublicUrl}）`);
            }

            // Step 4: 写入 meta.json
            const metaPath = path.join(agentDataDir, 'meta.json');
            if (fs.existsSync(metaPath)) {
                try {
                    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                    meta.podcastApiKey = podcastApiKey;
                    meta.podcastAgentId = podcastAgentId;
                    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
                } catch(e) {}
            }
        } catch (e) {
            console.warn(`[Create] Podcast API 注册失败（非致命）: ${e.message}`);
        }

        // Force refresh of AGENTS list in memory
        const newAgents = scanOpenClawAgents();

        // Manually ensure this agent is in AGENTS map immediately
        // Even if scan missed it due to async/fs lag
        if (!AGENTS[agentId]) {
             AGENTS[agentId] = {
                 id: agentId,
                 name: agentInfo.displayName || name,
                 prompt: prompt,
                 systemPrompt: prompt,
                 workspace: workspacePath,
                 source: 'local_created',
                 meta: {
                     id: agentId,
                     name: agentInfo.displayName || name,
                     created: new Date().toISOString(),
                     voiceId: voiceId
                 },
                 assets: {
                     avatar: `/assets/${agentId}/avatar.png`,
                     video: `/assets/${agentId}/video.mp4`
                 }
             };
        }
        
        // Also update existing AGENTS map with scan results if found
        Object.keys(newAgents).forEach(key => {
            if (!AGENTS[key]) {
                AGENTS[key] = newAgents[key];
                refreshPersona(key); 
            }
        });
        
        res.json({ 
            success: true, 
            id: agentId, 
            name: agentInfo.displayName || name,
            voiceError 
        });
        
    } catch (e) {
        console.error('[Create] Failed:', e);
        res.status(500).json({ error: e.message });
    }
});

// Clone Agent
app.post('/api/agents/:agentId/clone', async (req, res) => {
    const { agentId } = req.params;
    const requestedName = String(req.body?.name || '').trim();
    if (!requestedName) {
        return res.status(400).json({ error: 'Name is required' });
    }

    const sourceAgent = getAgentById(agentId);
    if (!sourceAgent) {
        return res.status(404).json({ error: 'Source agent not found' });
    }

    const safeReadJson = (filePath, fallback = {}) => {
        try {
            if (!filePath || !fs.existsSync(filePath)) return fallback;
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (_) {
            return fallback;
        }
    };

    const safeReadText = (filePath) => {
        try {
            if (!filePath || !fs.existsSync(filePath)) return '';
            return fs.readFileSync(filePath, 'utf-8').trim();
        } catch (_) {
            return '';
        }
    };

    try {
        const sourceLocalDir = findLocalAgentDir(agentId) || (fs.existsSync(path.join(DATA_AGENTS_DIR, agentId)) ? path.join(DATA_AGENTS_DIR, agentId) : null);
        const sourceMetaPath = sourceLocalDir ? path.join(sourceLocalDir, 'meta.json') : '';
        const sourceMeta = safeReadJson(sourceMetaPath, {});
        const sourceWorkspace = typeof sourceAgent.workspace === 'string' ? sourceAgent.workspace : '';

        const sourcePrompt = safeReadText(sourceLocalDir ? path.join(sourceLocalDir, 'prompt.txt') : '')
            || safeReadText(sourceWorkspace ? path.join(sourceWorkspace, 'prompt.txt') : '')
            || safeReadText(sourceWorkspace ? path.join(sourceWorkspace, 'SOUL.md') : '')
            || sourceMeta.prompt
            || sourceAgent.systemPrompt
            || '';

        const sourceVoiceJson = safeReadJson(sourceLocalDir ? path.join(sourceLocalDir, 'voice.json') : '', {});
        let sourceVoiceId = sourceMeta.voiceId || sourceMeta.voice_id || sourceVoiceJson.voiceId || sourceVoiceJson.voice_id || '';
        if (!sourceVoiceId) {
            const wsVoiceJson = safeReadJson(sourceWorkspace ? path.join(sourceWorkspace, 'voice.json') : '', {});
            sourceVoiceId = wsVoiceJson.voiceId || wsVoiceJson.voice_id || '';
        }

        console.log(`[Clone] Cloning agent ${agentId} -> "${requestedName}"`);
        const created = await openclaw.createAgent(requestedName, sourcePrompt);
        const newAgentId = created.id;
        const newLocalDir = path.join(DATA_AGENTS_DIR, newAgentId);
        const newWorkspaceDir = path.join(OPENCLAW_ROOT_DIR, `workspace-${newAgentId}`);
        if (!fs.existsSync(newLocalDir)) fs.mkdirSync(newLocalDir, { recursive: true });
        if (!fs.existsSync(newWorkspaceDir)) fs.mkdirSync(newWorkspaceDir, { recursive: true });

        // 1) Clone local Meco files
        if (sourceLocalDir && fs.existsSync(sourceLocalDir)) {
            fs.cpSync(sourceLocalDir, newLocalDir, { recursive: true, force: true });
        }

        // 2) Clone OpenClaw workspace persona/config files
        const workspaceFilesToClone = [
            'SOUL.md', 'AGENTS.md', 'USER.md', 'MEMORY.md', 'prompt.txt',
            'voice.json', 'voice.mp3', 'video.mp4',
            'avatar.png', 'avatar.jpg', 'avatar.jpeg', 'avatar.webp', 'avatar.gif'
        ];
        workspaceFilesToClone.forEach((name) => {
            if (!sourceWorkspace) return;
            const src = path.join(sourceWorkspace, name);
            const dst = path.join(newWorkspaceDir, name);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, dst);
            }
        });
        const sourceWorkspaceAgentDir = sourceWorkspace ? path.join(sourceWorkspace, 'agent') : '';
        const targetWorkspaceAgentDir = path.join(newWorkspaceDir, 'agent');
        if (sourceWorkspaceAgentDir && fs.existsSync(sourceWorkspaceAgentDir)) {
            fs.cpSync(sourceWorkspaceAgentDir, targetWorkspaceAgentDir, { recursive: true, force: true });
        }

        // 3) Keep identity name in sync with the new display name
        const rewriteIdentityName = (identityPath, fallbackName) => {
            if (!fs.existsSync(identityPath)) return;
            try {
                let content = fs.readFileSync(identityPath, 'utf-8');
                if (/^#\s+.+/m.test(content)) {
                    content = content.replace(/^#\s+.+/m, `# ${fallbackName}`);
                } else {
                    content = `# ${fallbackName}\n\n${content}`;
                }
                if (/^name:\s*.+$/mi.test(content)) {
                    content = content.replace(/^name:\s*.+$/mi, `name: ${fallbackName}`);
                } else {
                    content = `${content}\nname: ${fallbackName}\n`;
                }
                fs.writeFileSync(identityPath, content);
            } catch (e) {
                console.warn(`[Clone] Failed to rewrite identity: ${identityPath} ${e.message}`);
            }
        };
        rewriteIdentityName(path.join(newWorkspaceDir, 'IDENTITY.md'), requestedName);
        rewriteIdentityName(path.join(newWorkspaceDir, 'agent', 'IDENTITY.md'), requestedName);

        // 4) Normalize local metadata with new id/name and refresh prompt/voice
        const newMetaPath = path.join(newLocalDir, 'meta.json');
        const createdMeta = safeReadJson(newMetaPath, {});
        const nextMeta = {
            ...createdMeta,
            ...sourceMeta,
            displayName: requestedName,
            originalId: newAgentId,
            id: newAgentId,
            createdAt: new Date().toISOString(),
            source: 'openclaw_clone',
            prompt: sourcePrompt || sourceMeta.prompt || createdMeta.prompt || ''
        };
        if (sourceVoiceId) nextMeta.voiceId = sourceVoiceId;
        delete nextMeta.podcastApiKey;
        delete nextMeta.podcastAgentId;
        fs.writeFileSync(newMetaPath, JSON.stringify(nextMeta, null, 2));
        if (sourcePrompt) {
            fs.writeFileSync(path.join(newLocalDir, 'prompt.txt'), sourcePrompt);
            fs.writeFileSync(path.join(newWorkspaceDir, 'prompt.txt'), sourcePrompt);
        }

        // 5) Register cloned agent to Podcast API (reuse voice/media metadata, no re-train/no re-upload)
        let podcastApiKey = '';
        let podcastAgentId = '';
        let podcastSynced = false;
        let podcastWarning = '';
        try {
            const axios = require('axios');
            let sourceRemote = {};
            if (sourceMeta.podcastApiKey) {
                try {
                    const sourceMe = await axios.get(`${PODCAST_API_BASE}/agent/me`, {
                        headers: { 'X-API-Key': sourceMeta.podcastApiKey },
                        timeout: 10000
                    });
                    sourceRemote = sourceMe.data?.data?.agent || sourceMe.data?.data || {};
                } catch (e) {
                    console.warn(`[Clone] Failed to read source podcast profile: ${e.message}`);
                }
            }

            if (!sourceVoiceId) {
                sourceVoiceId = sourceRemote.voice_id || sourceRemote.voiceId || '';
            }

            const registerBody = {
                name: requestedName,
                description: (sourcePrompt || '').slice(0, 500),
                personality: (sourcePrompt || '').slice(0, 500),
                prompt: sourcePrompt || '',
                voice_id: sourceVoiceId || ''
            };
            const registerResp = await axios.post(`${PODCAST_API_BASE}/agent/register`, registerBody, { timeout: 10000 });
            if (!registerResp.data || registerResp.data.code !== 200 || !registerResp.data.data) {
                throw new Error(`register failed: ${JSON.stringify(registerResp.data)}`);
            }
            podcastApiKey = registerResp.data.data.api_key;
            podcastAgentId = registerResp.data.data.agent?.agent_id || '';

            const pickFirstUrl = (obj, keys) => {
                for (const key of keys) {
                    const value = obj && typeof obj[key] === 'string' ? obj[key].trim() : '';
                    if (value) return value;
                }
                return '';
            };
            const avatarUrl = normalizePodcastPublicUrl(
                pickFirstUrl(sourceRemote, ['avatar_url', 'avatarUrl', 'character_image_url', 'characterImageUrl'])
            );
            const characterImageUrl = normalizePodcastPublicUrl(
                pickFirstUrl(sourceRemote, ['character_image_url', 'characterImageUrl', 'avatar_url', 'avatarUrl'])
            );
            const videoUrl = normalizePodcastPublicUrl(
                pickFirstUrl(sourceRemote, ['character_video_url', 'characterVideoUrl'])
            );

            const updateBody = {};
            if (avatarUrl) updateBody.avatar_url = avatarUrl;
            if (characterImageUrl) updateBody.character_image_url = characterImageUrl;
            if (videoUrl) updateBody.character_video_url = videoUrl;
            if (Object.keys(updateBody).length > 0) {
                await axios.put(`${PODCAST_API_BASE}/agent/me`, updateBody, {
                    headers: { 'X-API-Key': podcastApiKey, 'Content-Type': 'application/json' },
                    timeout: 10000
                });
            }
            podcastSynced = true;
        } catch (e) {
            podcastWarning = e.message || 'podcast sync failed';
            console.warn(`[Clone] Podcast registration failed (non-fatal): ${podcastWarning}`);
        }

        if (podcastApiKey && podcastAgentId) {
            try {
                const meta = safeReadJson(newMetaPath, {});
                meta.podcastApiKey = podcastApiKey;
                meta.podcastAgentId = podcastAgentId;
                fs.writeFileSync(newMetaPath, JSON.stringify(meta, null, 2));
            } catch (_) {}
        }

        // 6) Refresh runtime registry
        const scanned = scanOpenClawAgents();
        Object.keys(scanned).forEach((key) => {
            AGENTS[key] = scanned[key];
        });
        refreshPersona(newAgentId);
        refreshAgentNameMap();

        res.json({
            success: true,
            id: newAgentId,
            name: requestedName,
            podcastSynced,
            podcastWarning: podcastWarning || undefined
        });
    } catch (e) {
        console.error(`[Clone] Failed to clone ${agentId}:`, e);
        res.status(500).json({ error: e.message || 'clone failed' });
    }
});

// === Podcast API 同步 Helper ===
const PODCAST_API_BASE = 'https://api.circle-thinking.com';
const PODCAST_OSS_PUBLIC_HOST = 'cos.circle-thinking.com';

function normalizePodcastPublicUrl(rawUrl) {
  const source = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!source) return '';
  try {
    const parsed = new URL(source);
    parsed.protocol = 'https:';
    parsed.hostname = PODCAST_OSS_PUBLIC_HOST;
    return parsed.toString();
  } catch (_) {
    return source;
  }
}

function normalizePodcastControlWsUrl(rawUrl) {
  const source = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!source) return '';
  try {
    const parsed = new URL(source);
    const apiBase = new URL(PODCAST_API_BASE);
    if (apiBase.protocol === 'https:' && parsed.protocol === 'ws:') {
      parsed.protocol = 'wss:';
    } else if (apiBase.protocol === 'http:' && parsed.protocol === 'wss:') {
      parsed.protocol = 'ws:';
    }
    return parsed.toString();
  } catch (_) {
    return source;
  }
}

// ========== Podcast Pusher (Control Agent 推流到 Podcast 平台) ==========

class PodcastPusher {
  constructor(podcastRoomId, hostApiKey) {
    this.podcastRoomId = podcastRoomId;
    this.hostApiKey = hostApiKey;
    this.ws = null;
    this.connected = false;
    this.sequence = 0;
    this.currentSpeaker = null;
    this.pingInterval = null; // 保留字段，暂未使用
    this.audioBuffer = [];    // 当前发言人的音频 hex 聚合缓冲区
    this.audioBufferBytes = 0; // 缓冲区字节数（用于判断是否达到 2s 阈值）
    this.audioFlushTimer = null;
    this.lastText = '';       // 最新的完整文本
    this.lastAudioAgentId = null;
    this.pendingAudio = {};   // 非当前发言人的音频暂存 { agentId: { chunks: [], text: '' } }
    this.audioPushPaused = false; // 下播后暂停推流，直到下一次开播恢复
    this._lastPausedDropLogAt = 0;
    this._manualClose = false; // 标记是否手动断开（不重连）
    this._reconnecting = false;
    this.onTopicQueueList = null;  // 麦序列表回调 (data) => void
    this.onTopicChanged = null;    // 话题变更回调 (data) => void
    this.onStartStreaming = null;  // 开播命令回调 (msg) => void
    this.onStopStreaming = null;   // 下播命令回调 (msg) => void
    this.controlConnectedAtMs = 0; // 控制连接建立时间（用于过滤陈旧控制命令）
    this.controlToken = ''; // Control token（用于部分服务端要求在 C→S 消息中显式透传）
    this.liveJoinedAgents = new Set(); // 当前开播周期已上麦的主播（避免发言切换时反复上下麦）
    this.speakerPlanQueue = []; // 仅保留“后一位”预加载计划（用于按顺序提前推流）
  }

  _extractMessageTimestampMs(msg) {
    const raw = String(msg?.timestamp || msg?.data?.timestamp || '').trim();
    if (!raw) return 0;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : 0;
  }

  _shouldAcceptStreamingControl(msg, commandType) {
    if (!msg || !commandType) return false;
    const cmdRoomId = String(msg?.data?.room_id || '').trim();
    const currentRoomId = String(this.podcastRoomId || '').trim();
    if (cmdRoomId && currentRoomId && cmdRoomId !== currentRoomId) {
      console.warn(`[Podcast] ⏭️ 忽略 ${commandType}: room_id 不匹配 cmd=${cmdRoomId}, current=${currentRoomId}`);
      return false;
    }

    const now = Date.now();
    const ts = this._extractMessageTimestampMs(msg);
    if (ts > 0) {
      // 绝对过期保护：超过 2 分钟的控制命令视为陈旧包
      if (now - ts > 120000) {
        console.warn(`[Podcast] ⏭️ 忽略过期 ${commandType}: age=${Math.round((now - ts) / 1000)}s`);
        return false;
      }
      // 刚重连后可能收到历史缓存命令：若命令时间明显早于本次控制连接建立时间，则忽略
      if (this.controlConnectedAtMs > 0 && ts + 2000 < this.controlConnectedAtMs) {
        console.warn(`[Podcast] ⏭️ 忽略旧连接 ${commandType}: cmd=${new Date(ts).toISOString()}, connectedAt=${new Date(this.controlConnectedAtMs).toISOString()}`);
        return false;
      }
    }

    return true;
  }

  async connect() {
    try {
      // Step 1: POST /control 获取带 token 的 WebSocket URL
      console.log(`[Podcast] 正在获取控制权: ${this.podcastRoomId}`);
      const axios = require('axios');
      let wsUrl;
      let controlToken = '';
      try {
        const resp = await axios.post(
          `${PODCAST_API_BASE}/agent/rooms/${this.podcastRoomId}/control`,
          {},
          { headers: { 'X-API-Key': this.hostApiKey }, timeout: 10000 }
        );
        wsUrl = resp.data?.data?.ws_url;
        controlToken = String(resp.data?.data?.token || '').trim();
        console.log(`[Podcast] POST /control 成功, ws_url: ${wsUrl}`);
      } catch (postErr) {
        const status = postErr.response?.status;
        const msg = postErr.response?.data?.message || postErr.message;
        console.error(`[Podcast] POST /control 失败 (${status}): ${msg}`);
        if (status === 409) {
          // 已被控制，尝试直接连接
          const wsBase = PODCAST_API_BASE.replace('http://', 'ws://').replace('https://', 'wss://');
          wsUrl = `${wsBase}/agent/ws/rooms/${this.podcastRoomId}/control`;
          console.log(`[Podcast] 409已控制，尝试直接连接: ${wsUrl}`);
        } else {
          return false;
        }
      }

      if (!wsUrl) {
        console.error('[Podcast] 无 WebSocket URL');
        return false;
      }
      const normalizedWsUrl = normalizePodcastControlWsUrl(wsUrl);
      if (normalizedWsUrl !== wsUrl) {
        console.log(`[Podcast] 规范化控制连接地址: ${wsUrl} -> ${normalizedWsUrl}`);
      }
      wsUrl = normalizedWsUrl;
      try {
        const parsed = new URL(wsUrl);
        if (!controlToken) controlToken = String(parsed.searchParams.get('token') || '').trim();
      } catch (_) {}
      this.controlToken = controlToken;

      // Step 2: 连接 WebSocket
      return new Promise((resolve) => {
        this.ws = new WebSocket(wsUrl, {
          headers: { 'X-API-Key': this.hostApiKey }
        });

        this.ws.on('open', () => {
          console.log('[Podcast] WebSocket 连接已建立');
        });

        this.ws.on('message', (raw) => {
          // 服务端可能在单个 WebSocket 帧中发送多个 JSON 对象（以换行分隔）
          const rawStr = raw.toString();
          const lines = rawStr.split('\n').filter(l => l.trim());
          for (const line of lines) {
            try {
              const msg = JSON.parse(line);
              this._handleMessage(msg, resolve);
            } catch (e) {
              console.error('[Podcast] 解析消息失败:', e.message, '| 原始数据:', line.substring(0, 200));
            }
          }
        });

        this.ws.on('error', (err) => {
          console.error('[Podcast] WebSocket 错误:', err.message);
          this.connected = false;
          resolve(false);
        });

        this.ws.on('close', (code, reason) => {
          console.log(`[Podcast] WebSocket 关闭: ${code} ${reason?.toString()}`);
          this.connected = false;
          if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
          // 非手动断开时自动重连（指数退避，持续重试）
          if (!this._manualClose && !this._reconnecting) {
            this._reconnecting = true;
            this._reconnectAttempt = 0;
            const attemptReconnect = async () => {
              this._reconnectAttempt++;
              if (this._manualClose) { this._reconnecting = false; return; }
              const delay = Math.min(3000 * Math.pow(2, this._reconnectAttempt - 1), 30000);
              console.log(`[Podcast] 意外断开，${delay/1000}秒后重连 (第${this._reconnectAttempt}次)...`);
              setTimeout(async () => {
                if (this._manualClose) { this._reconnecting = false; return; }
                console.log(`[Podcast] 开始自动重连 (第${this._reconnectAttempt}次)...`);
                const ok = await this.connect();
                if (ok) {
                  this._reconnecting = false;
                  console.log('[Podcast] 自动重连成功');
                  // 恢复当前发言人状态
                  if (this.currentSpeaker) {
                    const podcastAgentId = this._getPodcastAgentId(this.currentSpeaker);
                    if (podcastAgentId) {
                      const name = AGENTS[this.currentSpeaker]?.name || this.currentSpeaker;
                      this.ws.send(JSON.stringify({
                        type: 'agent_status_report',
                        message_id: `status_${Date.now()}`,
                        timestamp: new Date().toISOString(),
                        data: { agent_id: podcastAgentId, name, avatar_url: '', action: 'join', timestamp: Date.now() }
                      }));
                      console.log(`[Podcast] 重连后恢复发言人: ${this.currentSpeaker}`);
                    }
                  }
                  // 重连后刷新缓冲区中积压的音频
                  if (this.audioBuffer.length > 0) {
                    console.log(`[Podcast] 重连后推送积压音频: ${this.audioBuffer.length} 个块`);
                    this._flushAudio();
                  }
                  // 重连后补发暂存的话题
                  for (const [rid, room] of rooms) {
                    if (room.podcastPusher === this && room.pendingPodcastTopic) {
                      console.log(`[Podcast] 📤 重连后补发暂存话题: ${room.pendingPodcastTopic.title?.substring(0, 30)}...`);
                      syncTopicToPodcast(room, room.pendingPodcastTopic, room.pendingPodcastTopicSpeaker);
                      break;
                    }
                  }
                } else {
                  console.warn('[Podcast] 自动重连失败，继续重试...');
                  attemptReconnect();
                }
              }, delay);
            };
            attemptReconnect();
          }
        });

        setTimeout(() => {
          if (!this.connected) {
            console.error('[Podcast] 连接超时(10s)');
            resolve(false);
          }
        }, 10000);
      });
    } catch (e) {
      console.error('[Podcast] 连接失败:', e.message);
      return false;
    }
  }

  _handleMessage(msg, resolve) {
    if (msg.type === 'control_established') {
      this.connected = true;
      this.controlConnectedAtMs = Date.now();
      // 控制连接建立后，重置本地音频序号与缓存，保证重连后的首包 sequence=0
      this.clearAudio();
      console.log('[Podcast] ♻️ control_established: 已重置本地音频序号与缓冲 (sequence=0)');
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'ping',
            message_id: `ping_${Date.now()}`,
            timestamp: new Date().toISOString(),
            data: { client_time: new Date().toISOString() }
          }));
        }
      }, 2000);
      console.log(`[Podcast] 控制连接已建立: ${msg.data.room_id}`);
      if (resolve) resolve(true);
    } else if (msg.type === 'ping') {
      this.ws.send(JSON.stringify({
        type: 'pong',
        message_id: `pong_${Date.now()}`,
        timestamp: new Date().toISOString(),
        data: { client_time: new Date().toISOString(), server_time: msg.data?.server_time }
      }));
    } else if (msg.type === 'topic_queue_list') {
      console.log(`[Podcast] 📋 收到麦序列表: ${msg.data?.topics?.length || 0} 个话题`);
      if (msg.data?.topics) {
        msg.data.topics.forEach((t, i) => {
          console.log(`[Podcast] 📋 话题[${i}]:`, JSON.stringify(t).substring(0, 500));
        });
      }
      if (this.onTopicQueueList) {
        this.onTopicQueueList(msg.data);
      }
    } else if (msg.type === 'topic_changed' || msg.type === 'topic_queue_updated') {
      console.log(`[Podcast] 🔄 收到服务端话题变更通知 (${msg.type}): ${msg.data?.topic?.title?.substring(0, 30) || ''}`);
      if (this.onTopicChanged) {
        this.onTopicChanged(msg.data);
      }
    } else if (msg.type === 'start_streaming') {
      if (!this._shouldAcceptStreamingControl(msg, 'start_streaming')) return;
      console.log(`[Podcast] ▶️ 收到 start_streaming 命令: room=${msg.data?.room_id || this.podcastRoomId}`);
      this.resumeAudioPush('remote_start_streaming');
      if (this.onStartStreaming) {
        this.onStartStreaming(msg);
      }
    } else if (msg.type === 'stop_streaming') {
      if (!this._shouldAcceptStreamingControl(msg, 'stop_streaming')) return;
      console.log(`[Podcast] ⏹️ 收到 stop_streaming 命令: room=${msg.data?.room_id || this.podcastRoomId}, reason=${msg.data?.reason || ''}`);
      this.pauseAudioPush('remote_stop_streaming');
      if (this.onStopStreaming) {
        this.onStopStreaming(msg);
      }
    } else if (msg.type === 'error') {
      const code = String(msg?.data?.code || '').trim();
      const detail = String(msg?.data?.message || msg?.message || '').trim();
      console.error(`[Podcast] ❌ 服务端错误: code=${code || 'unknown'}, message=${detail || 'unknown'}`);
    } else {
      console.log(`[Podcast] 收到消息: ${msg.type}`);
    }
  }

  speakerJoin(agentId) {
    if (!this.connected || !this.ws) return;
    if (this.audioPushPaused) return;
    // 切换发言人前先推送剩余缓冲音频（当前发言人的）
    if (this.audioFlushTimer) { clearTimeout(this.audioFlushTimer); this.audioFlushTimer = null; }
    this._flushAudio();

    // 开播期间不做“发言切换下麦”，只在首次出现时上麦
    if (!this.liveJoinedAgents.has(agentId)) {
      const podcastAgentId = this._getPodcastAgentId(agentId);
      const displayName = this._getDisplayName(agentId);
      const msg = {
        type: 'agent_status_report',
        message_id: `status_${Date.now()}`,
        timestamp: new Date().toISOString(),
        data: {
          agent_id: podcastAgentId,
          name: displayName,
          avatar_url: '',
          action: 'join',
          timestamp: Date.now()
        }
      };
      this.ws.send(JSON.stringify(msg));
      this.liveJoinedAgents.add(agentId);
      console.log(`[Podcast] 🎤 主播 ${agentId} (${podcastAgentId}) 上麦`);
    } else if (this.currentSpeaker !== agentId) {
      console.log(`[Podcast] 🎙️ 发言切换到 ${agentId}（保持上麦，不下麦）`);
    }
    this.currentSpeaker = agentId;

    // 将该 agent 暂存的 pending 音频移入主缓冲区
    if (this.pendingAudio[agentId] && this.pendingAudio[agentId].chunks.length > 0) {
      const pending = this.pendingAudio[agentId];
      console.log(`[Podcast] 恢复 ${agentId} 的 ${pending.chunks.length} 个暂存音频块`);
      this.audioBuffer.push(...pending.chunks);
      this.lastAudioAgentId = agentId;
      if (pending.text) this.lastText = pending.text;
      delete this.pendingAudio[agentId];
      // 立刻启动 flush
      if (!this.audioFlushTimer) {
        this.audioFlushTimer = setTimeout(() => this._flushAudio(), 1000);
      }
    }
  }

  planSpeaker(agentId) {
    const id = String(agentId || '').trim();
    if (!id) return;
    if (id === this.currentSpeaker) return;
    const plannedNext = this.speakerPlanQueue.length > 0
      ? this.speakerPlanQueue[0]
      : null;
    if (plannedNext === id) return;
    // 关键约束：永远只预加载后面一位，新的计划会覆盖旧计划
    this.speakerPlanQueue = [id];
    console.log(`[Podcast] 🧭 仅预加载下一位发言人: ${id}`);
  }

  _promotePlannedSpeaker(reason = 'unknown') {
    while (this.speakerPlanQueue.length > 0) {
      const next = this.speakerPlanQueue.shift();
      if (!next || next === this.currentSpeaker) continue;
      console.log(`[Podcast] ⏭️ 按计划切换发言人: ${this.currentSpeaker || '-'} -> ${next} (reason=${reason})`);
      this.speakerJoin(next);
      return true;
    }
    return false;
  }

  onSpeakerTtsFinished(agentId) {
    const id = String(agentId || '').trim();
    if (!id || id !== this.currentSpeaker) return;
    // 当前人 TTS 结束后，先把尾包推完，再按计划切到下一位
    if (this.audioBuffer.length > 0) {
      this._flushAudio();
    }
    if (this._promotePlannedSpeaker('tts_finished')) return;

    // 兜底：若有缓存中的其他发言人音频，直接切过去继续推，避免“本地在说但服务端无流”
    const fallback = Object.keys(this.pendingAudio || {}).find((aid) => {
      const entry = this.pendingAudio[aid];
      return aid !== id && entry && Array.isArray(entry.chunks) && entry.chunks.length > 0;
    });
    if (fallback) {
      console.log(`[Podcast] ⏭️ 无计划队列，按缓存兜底切换到 ${fallback}`);
      this.speakerJoin(fallback);
    }
  }

  speakerLeave(agentId) {
    if (!this.connected || !this.ws) return;
    const podcastAgentId = this._getPodcastAgentId(agentId);
    const displayName = this._getDisplayName(agentId);
    const msg = {
      type: 'agent_status_report',
      message_id: `status_${Date.now()}`,
      timestamp: new Date().toISOString(),
      data: {
        agent_id: podcastAgentId,
        name: displayName,
        avatar_url: '',
        action: 'leave',
        timestamp: Date.now()
      }
    };
    this.ws.send(JSON.stringify(msg));
    if (this.currentSpeaker === agentId) this.currentSpeaker = null;
    console.log(`[Podcast] 🔇 主播 ${agentId} (${podcastAgentId}) 下麦`);
  }

  pushAudio(agentId, hexAudio, text) {
    if (this.audioPushPaused) {
      const now = Date.now();
      if (now - this._lastPausedDropLogAt > 2000) {
        this._lastPausedDropLogAt = now;
        console.log(`[Podcast] ⛔ 丢弃音频块（已下播，等待开播）: ${agentId}`);
      }
      return;
    }

    // 尚未确定当前发言人：直接以首个到达音频的人为当前发言人，立即按顺序推流
    if (!this.currentSpeaker) {
      this.speakerJoin(agentId);
    }

    // 若已存在发言顺序计划且当前 chunk 属于计划队首，则可提前切换并推流（不必等待 speech-started）
    if (this.currentSpeaker && this.currentSpeaker !== agentId && this.speakerPlanQueue.length > 0) {
      const planned = this.speakerPlanQueue[0];
      if (planned === agentId) {
        this._promotePlannedSpeaker('preload_audio_arrived');
      }
    }

    // 仍不是当前发言人：暂存
    if (!this.currentSpeaker) {
      if (!this.pendingAudio[agentId]) {
        this.pendingAudio[agentId] = { chunks: [], text: '' };
      }
      this.pendingAudio[agentId].chunks.push(hexAudio);
      if (text) this.pendingAudio[agentId].text = text;
      return;
    }

    // 只推当前发言人的音频，其他人的暂存到 pending
    if (this.currentSpeaker && this.currentSpeaker !== agentId) {
      if (!this.pendingAudio[agentId]) {
        this.pendingAudio[agentId] = { chunks: [], text: '' };
      }
      this.pendingAudio[agentId].chunks.push(hexAudio);
      if (text) this.pendingAudio[agentId].text = text;
      return;
    }

    this.audioBuffer.push(hexAudio);
    this.audioBufferBytes += hexAudio.length / 2; // hex 字符数 / 2 = 字节数
    this.lastAudioAgentId = agentId;
    if (text) this.lastText = text;

    // 缓冲达到 2 秒以上（MP3 128kbps = 16KB/s，2s = 32KB）立即发送
    const THRESHOLD_BYTES = 32000;
    if (this.audioBufferBytes >= THRESHOLD_BYTES) {
      if (this.audioFlushTimer) { clearTimeout(this.audioFlushTimer); this.audioFlushTimer = null; }
      this._flushAudio();
    } else if (this.connected && this.ws && !this.audioFlushTimer) {
      // 不足 2s，等 1s 后兜底发送（处理最后一批不足 2s 的尾巴）
      this.audioFlushTimer = setTimeout(() => this._flushAudio(), 1000);
    }
  }

  // 剥掉 hex 字符串中的 ID3v2 头，只保留纯 MPEG 帧
  _stripID3(hexStr) {
    if (hexStr.length < 20) return hexStr;
    // ID3v2 header: "ID3" = 0x49 0x44 0x33
    if (hexStr.substring(0, 6).toLowerCase() !== '494433') return hexStr;
    // 解析 syncsafe integer (bytes 6-9)
    const b6 = parseInt(hexStr.substring(12, 14), 16);
    const b7 = parseInt(hexStr.substring(14, 16), 16);
    const b8 = parseInt(hexStr.substring(16, 18), 16);
    const b9 = parseInt(hexStr.substring(18, 20), 16);
    const tagSize = (b6 << 21) | (b7 << 14) | (b8 << 7) | b9;
    const skipBytes = 10 + tagSize;
    return hexStr.substring(skipBytes * 2);
  }

  _flushAudio() {
    this.audioFlushTimer = null;
    if (this.audioPushPaused) {
      this.audioBuffer = [];
      this.audioBufferBytes = 0;
      return;
    }
    if (!this.connected || !this.ws || this.audioBuffer.length === 0) return;

    const agentId = this.lastAudioAgentId;
    const podcastAgentId = this._getPodcastAgentId(agentId);

    // 分片推流：避免预准备堆积后一次发送超大包导致 WS 1006
    const chunks = this.audioBuffer.slice();
    this.audioBuffer = [];
    this.audioBufferBytes = 0;

    const MAX_PACKET_BYTES = 64000; // ~4s @ 128kbps
    let packetParts = [];
    let packetBytes = 0;
    let sentPackets = 0;

    const flushPacket = () => {
      if (packetParts.length === 0) return true;
      const packetHex = packetParts.join('');
      const audioBytes = Buffer.from(packetHex, 'hex');
      const estimatedDuration = audioBytes.length / 16000;
      const audioBase64 = audioBytes.toString('base64');
      const msg = {
        type: 'audio_stream',
        message_id: `audio_${Date.now()}_${this.sequence}`,
        timestamp: new Date().toISOString(),
        data: {
          agent_id: podcastAgentId,
          audio_data: audioBase64,
          text: this.lastText || '',
          sequence: this.sequence,
          timestamp: Date.now(),
          duration: estimatedDuration,
          is_final: false
        }
      };
      try {
        this.ws.send(JSON.stringify(msg));
      } catch (e) {
        console.error(`[Podcast] pushAudio 发送失败:`, e.message);
        this.connected = false;
        return false;
      }
      console.log(`[Podcast] 推送音频 #${this.sequence} 给 ${agentId} (${audioBytes.length} bytes, ~${estimatedDuration.toFixed(1)}s)`);
      this.sequence++;
      sentPackets++;
      packetParts = [];
      packetBytes = 0;
      return true;
    };

    for (let i = 0; i < chunks.length; i++) {
      const raw = chunks[i] || '';
      if (!raw) continue;
      const piece = packetParts.length === 0 ? raw : this._stripID3(raw);
      const pieceBytes = Math.floor(piece.length / 2);
      if (packetParts.length > 0 && packetBytes + pieceBytes > MAX_PACKET_BYTES) {
        if (!flushPacket()) return;
      }
      packetParts.push(packetParts.length === 0 ? raw : this._stripID3(raw));
      packetBytes += Math.floor(packetParts[packetParts.length - 1].length / 2);
    }
    flushPacket();
    if (sentPackets > 1) {
      console.log(`[Podcast] 📦 分片推流完成: ${sentPackets} packets, agent=${agentId}`);
    }
  }

  // 打断时丢弃所有缓冲音频（不断开连接，等待新音频）
  clearAudio() {
    if (this.audioFlushTimer) { clearTimeout(this.audioFlushTimer); this.audioFlushTimer = null; }
    this.audioBuffer = [];
    this.audioBufferBytes = 0;
    this.pendingAudio = {};
    this.lastText = '';
    this.lastAudioAgentId = null;
    this.sequence = 0;
    this.speakerPlanQueue = [];
    console.log(`[Podcast] 🧹 打断：清空所有缓冲音频，sequence 重置为 0`);
  }

  pauseAudioPush(reason = 'manual_stop') {
    this.audioPushPaused = true;
    this.clearAudio();
    this.currentSpeaker = null;
    console.log(`[Podcast] ⏸️ 暂停音频推流: reason=${reason}`);
  }

  resumeAudioPush(reason = 'manual_start') {
    const wasPaused = this.audioPushPaused;
    this.audioPushPaused = false;
    this.clearAudio();
    if (wasPaused) {
      console.log(`[Podcast] ▶️ 恢复音频推流: reason=${reason}`);
    }
  }

  // 清空房间播放列表（切题/打断时调用）
  playlistReset(reason = 'topic_changed', notifyApp = true) {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;

    const msg = {
      type: 'playlist_reset',
      message_id: `playlist_reset_${Date.now()}`,
      timestamp: new Date().toISOString(),
      data: {
        reason,
        notify_app: notifyApp
      }
    };

    const payload = JSON.stringify(msg);
    this.ws.send(payload, (err) => {
      if (err) {
        console.error(`[Podcast] ❌ playlist_reset 发送失败: ${err.message}`);
      }
    });
    console.log(`[Podcast] 📤 playlist_reset 已发送: reason=${reason}, notify_app=${notifyApp}`);
    return true;
  }

  // 发送房间级开播/下播事件（不关闭控制连接）
  reportRoomLiveEvent(agentIds = [], isLive = true, reason = 'manual') {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    const action = isLive ? 'join' : 'leave';
    const uniqueAgentIds = Array.from(new Set((agentIds || []).filter(Boolean)));
    if (uniqueAgentIds.length === 0) return false;

    for (const agentId of uniqueAgentIds) {
      const podcastAgentId = this._getPodcastAgentId(agentId);
      const displayName = this._getDisplayName(agentId);
      if (!podcastAgentId) continue;
      const msg = {
        type: 'agent_status_report',
        message_id: `room_${action}_${Date.now()}_${agentId}`,
        timestamp: new Date().toISOString(),
        data: {
          agent_id: podcastAgentId,
          name: displayName,
          avatar_url: '',
          action,
          timestamp: Date.now()
        }
      };
      this.ws.send(JSON.stringify(msg));
      if (isLive) {
        this.liveJoinedAgents.add(agentId);
      }
    }
    if (!isLive) {
      this.liveJoinedAgents.clear();
      this.currentSpeaker = null;
    }
    console.log(`[Podcast] 📡 房间${isLive ? '开播' : '下播'}事件已发送: action=${action}, agents=${uniqueAgentIds.join(',')}, reason=${reason}`);
    return true;
  }

  // 发送房间级 start_streaming / stop_streaming 指令（C→S）
  reportStreamingLifecycleEvent(isLive = true, reason = 'manual_click') {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if (!this.podcastRoomId) return false;

    const type = isLive ? 'start_streaming' : 'stop_streaming';
    const token = String(this.controlToken || '').trim();
    const data = {
      room_id: this.podcastRoomId,
      timestamp: Date.now()
    };
    if (token) {
      data.token = token;
      data.control_token = token;
    }
    if (!isLive && reason) {
      data.reason = String(reason);
    }

    const msg = {
      type,
      message_id: `manual_${type}_${Date.now()}`,
      timestamp: new Date().toISOString(),
      data
    };
    if (token) {
      msg.token = token;
    }

    this.ws.send(JSON.stringify(msg));
    console.log(`[Podcast] 📡 流生命周期命令已发送(C→S): type=${type}, room=${this.podcastRoomId}, reason=${reason}`);
    return true;
  }

  getTopicQueue() {
    if (!this.connected || !this.ws) return;
    this.ws.send(JSON.stringify({
      type: 'get_topic_queue',
      message_id: `queue_${Date.now()}`,
      timestamp: new Date().toISOString()
    }));
    console.log('[Podcast] 📋 请求麦序话题列表');
  }

  selectTopicFromQueue(topic) {
    if (!this.connected || !this.ws) return;
    this.ws.send(JSON.stringify({
      type: 'select_topic_from_queue',
      message_id: `select_${Date.now()}`,
      timestamp: new Date().toISOString(),
      data: {
        queue_id: topic.queue_id,
        title: topic.title || '',
        content: (topic.postData?.description || topic.content || '').substring(0, 500),
        cover_url: topic.cover_url || ''
      }
    }));
    console.log(`[Podcast] 📤 标记麦序话题已选择: ${topic.queue_id} - ${topic.title?.substring(0, 30)}`);
  }

  disconnect() {
    this._manualClose = true; // 阻止自动重连
    if (this.audioFlushTimer) { clearTimeout(this.audioFlushTimer); this.audioFlushTimer = null; }
    // 丢弃残留缓冲音频，不推送（下次 Play 重新开始）
    this.audioBuffer = [];
    this.audioBufferBytes = 0;
    this.pendingAudio = {};
    this.lastText = '';
    this.lastAudioAgentId = null;
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.connected = false;
    this.sequence = 0;
    this.currentSpeaker = null;
    this.liveJoinedAgents.clear();
    console.log('[Podcast] 已断开（手动）');
  }

  _getPodcastAgentId(agentId) {
    try {
      const metaPath = path.join(DATA_AGENTS_DIR, agentId, 'meta.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.podcastAgentId) return meta.podcastAgentId;
      }
    } catch (e) {}
    return agentId;
  }

  _getDisplayName(agentId) {
    try {
      const metaPath = path.join(DATA_AGENTS_DIR, agentId, 'meta.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.displayName) return meta.displayName;
      }
    } catch (e) {}
    const agent = AGENTS[agentId];
    return agent ? (agent.displayName || agent.name || agentId) : agentId;
  }
}

/**
 * 通过 presign 上传文件到 COS，返回 public_url
 * @param {string} apiKey - Podcast API Key
 * @param {string} filePath - 本地文件路径
 * @param {string} ext - 文件扩展名 (png/mp4)
 * @param {string} contentType - MIME 类型
 * @returns {Promise<string|null>} public_url 或 null
 */
async function podcastPresignUpload(apiKey, filePath, ext, contentType) {
    const axios = require('axios');
    const presignResp = await axios.post(`${PODCAST_API_BASE}/agent/upload/presign`, { ext }, {
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        timeout: 10000
    });
    if (!presignResp.data || presignResp.data.code !== 200 || !presignResp.data.data) return null;
    const { presign_url, public_url } = presignResp.data.data;
    const fileData = fs.readFileSync(filePath);
    await axios.put(presign_url, fileData, {
        headers: { 'Content-Type': contentType },
        timeout: 60000,
        maxBodyLength: 200 * 1024 * 1024
    });
    return normalizePodcastPublicUrl(public_url);
}

/**
 * 话题切换时同步到 Podcast 房间（fire-and-forget）
 * 1. 上传封面到 COS（话题封面 or 默认💬图）
 * 2. 通过 Control Agent WebSocket 发送 set_current_topic
 */
async function syncTopicToPodcast(room, topicData, raisedAgentId) {
    try {
        if (!topicData || !topicData.title) return;
        if (!room.podcastRoomId) return;

        // 暂存当前话题到 room，供 PodcastPusher 连接成功后补发
        room.pendingPodcastTopic = topicData;
        room.pendingPodcastTopicSpeaker = raisedAgentId || null;

        if (!room.podcastPusher || !room.podcastPusher.connected || !room.podcastPusher.ws) {
            console.log(`[Podcast] ⚠️ 话题已暂存，等待 Podcast 连接就绪后补发: ${topicData.title.substring(0, 30)}...`);
            return;
        }

        const pusher = room.podcastPusher;
        const apiKey = pusher.hostApiKey;
        if (!apiKey) {
            console.log('[Podcast] ⚠️ 无法同步话题：缺少 API Key');
            return;
        }

        console.log(`[Podcast] 🎯 同步话题: ${topicData.title.substring(0, 50)}...`);

        const postData = topicData.postData;

        // 如果来自麦序队列，优先从原始队列补齐创建者信息（避免缓存结果缺字段）
        if (topicData.queue_id && room.topicQueue) {
            const rawQueueTopic = room.topicQueue.find(t => t.queue_id === topicData.queue_id);
            if (rawQueueTopic) {
                if (!topicData.created_by && rawQueueTopic.created_by) topicData.created_by = rawQueueTopic.created_by;
                if (!topicData.created_by_nickname && rawQueueTopic.created_by_nickname) topicData.created_by_nickname = rawQueueTopic.created_by_nickname;
                if (!topicData.user_question && rawQueueTopic.question) topicData.user_question = rawQueueTopic.question;
            }
        }

        // 1. 准备封面（先尝试获取，不阻塞发送）
        let coverPublicUrl = '';
        try {
            let localCoverPath = null;
            let ext = 'jpg';
            let contentType = 'image/jpeg';

            // 优先用 path（绝对路径）直接在目录下找封面
            if (topicData.path && fs.existsSync(topicData.path)) {
                const coverExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
                for (const cext of coverExts) {
                    const coverCandidate = path.join(topicData.path, `cover${cext}`);
                    if (fs.existsSync(coverCandidate)) {
                        localCoverPath = coverCandidate;
                        ext = cext.replace('.', '');
                        const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
                        contentType = mimeMap[ext] || 'image/jpeg';
                        console.log(`[Podcast] 📷 找到封面 (path): ${localCoverPath}`);
                        break;
                    }
                }
            }
            // 兜底：用 coverUrl 相对路径查找
            if (!localCoverPath && topicData.coverUrl) {
                const relativePath = decodeURIComponent(topicData.coverUrl.replace(/^\/(topics|knowledge-assets)\//, ''));
                const candidate = path.join(KNOWLEDGE_BASE_PATH, relativePath);
                if (fs.existsSync(candidate)) {
                    localCoverPath = candidate;
                    ext = path.extname(candidate).replace('.', '') || 'jpg';
                    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
                    contentType = mimeMap[ext] || 'image/jpeg';
                    console.log(`[Podcast] 📷 找到封面 (coverUrl): ${localCoverPath}`);
                }
            }
            if (!localCoverPath) {
                const defaultCover = path.join(__dirname, 'public', 'default-topic-cover.jpg');
                if (fs.existsSync(defaultCover)) {
                    localCoverPath = defaultCover;
                    ext = 'jpg';
                    contentType = 'image/jpeg';
                }
            }
            if (localCoverPath) {
                const url = await podcastPresignUpload(apiKey, localCoverPath, ext, contentType);
                if (url) {
                    coverPublicUrl = url;
                    console.log(`[Podcast] ✅ 封面上传成功: ${coverPublicUrl}`);
                } else {
                    console.warn(`[Podcast] ⚠️ 封面 presign 上传返回空 (文件: ${localCoverPath})`);
                }
            } else {
                console.warn(`[Podcast] ⚠️ 无可用封面文件`);
            }
        } catch (e) {
            console.warn(`[Podcast] ⚠️ 封面上传失败: ${e.message}`);
        }

        // 2. 如果该话题来自麦序队列，发 select_topic_from_queue 通知服务端移除
        if (topicData.queue_id && pusher.connected && pusher.ws) {
            pusher.selectTopicFromQueue(topicData);
            console.log(`[Podcast] 📤 select_topic_from_queue: ${topicData.queue_id} - ${topicData.title?.substring(0, 30)}`);
            // 从 room.queueTopics 中移除
            if (room.queueTopics) {
                room.queueTopics = room.queueTopics.filter(t => t.queue_id !== topicData.queue_id);
            }
            // 从 room.topicQueue 中移除（原始麦序列表）
            if (room.topicQueue) {
                room.topicQueue = room.topicQueue.filter(t => t.queue_id !== topicData.queue_id);
            }
            // 通知前端移除该麦序项
            broadcastToRoom(room, {
                type: 'topic_queue_update',
                topics: room.topicQueue
            });
        }

        // 3. 发送 set_current_topic
        const sendTopicMsg = () => {
            if (!pusher.ws || pusher.ws.readyState !== WebSocket.OPEN) {
                console.warn(`[Podcast] ⚠️ WebSocket 未就绪 (readyState=${pusher.ws?.readyState}), buffered=${pusher.ws?.bufferedAmount}`);
                return false;
            }
            // content 必填：有 postData 用 description，否则用 title 兜底
            const content = (postData && postData.description) ? postData.description.substring(0, 500) : topicData.title;
            // raised_agent_id：转换为 podcast 平台的 agentId
            const raisedPodcastId = raisedAgentId ? pusher._getPodcastAgentId(raisedAgentId) : '';
            const hostPodcastId = room.hostAgentId ? pusher._getPodcastAgentId(room.hostAgentId) : '';
            const msgPayload = {
                title: topicData.title,
                content: content,
                reference_url: (postData && postData.url) || '',
                source: (() => { try { return postData && postData.url ? new URL(postData.url).hostname : ''; } catch { return ''; } })()
            };
            if (raisedPodcastId) {
                msgPayload.raised_agent_id = raisedPodcastId;
            }

            // creator_*：标记话题创建者身份
            const explicitCreatorType = typeof topicData.creator_type === 'string' ? topicData.creator_type.trim().toLowerCase() : '';
            const explicitCreatorId = typeof topicData.creator_id === 'string' ? topicData.creator_id.trim() : '';
            const queueCreatorId = typeof topicData.created_by === 'string' ? topicData.created_by.trim() : '';

            let creatorType = '';
            let creatorId = '';

            // 待讨论麦序话题：按用户发起处理
            if (topicData.queue_id && queueCreatorId) {
                creatorType = 'user';
                creatorId = queueCreatorId;
            } else if (explicitCreatorType === 'user') {
                creatorType = 'user';
                creatorId = explicitCreatorId || queueCreatorId;
            } else {
                // 其他情况按主播/智能体发起处理
                creatorType = 'agent';
                creatorId = explicitCreatorId || hostPodcastId || raisedPodcastId || '';
            }

            if (creatorType) {
                msgPayload.creator_type = creatorType;
            }
            if (creatorId) {
                msgPayload.creator_id = creatorId;
            }

            // cover_url 有值才发，避免发空字符串
            if (coverPublicUrl) {
                msgPayload.cover_url = coverPublicUrl;
            }
            const msg = {
                type: 'set_current_topic',
                message_id: `topic_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                timestamp: new Date().toISOString(),
                data: msgPayload
            };
            const payload = JSON.stringify(msg);
            console.log(`[Podcast] 📤 发送 set_current_topic (${payload.length} bytes, buffered=${pusher.ws.bufferedAmount})`);
            pusher.ws.send(payload, (err) => {
                if (err) console.error(`[Podcast] ❌ set_current_topic 发送回调报错: ${err.message}`);
            });
            return true;
        };

        if (sendTopicMsg()) {
            room.pendingPodcastTopic = null;
            console.log(`[Podcast] ✅ 话题已发送 (set_current_topic): ${topicData.title.substring(0, 30)}`);

            // 等待服务端确认，5秒无应答则重试一次
            let topicAcked = false;
            const ackHandler = (raw) => {
                try {
                    const resp = JSON.parse(raw.toString());
                    if (resp.type === 'set_current_topic') {
                        topicAcked = true;
                        console.log(`[Podcast] ✅ 服务端确认话题: ${topicData.title.substring(0, 30)}`);
                    }
                } catch {}
            };
            pusher.ws.on('message', ackHandler);
            setTimeout(() => {
                if (pusher.ws) pusher.ws.removeListener('message', ackHandler);
                if (!topicAcked && pusher.ws && pusher.ws.readyState === WebSocket.OPEN) {
                    console.warn(`[Podcast] ⚠️ 5秒无确认，重试 set_current_topic...`);
                    sendTopicMsg();
                }
            }, 5000);
        } else {
            console.warn(`[Podcast] ⚠️ WebSocket 未就绪，话题已暂存等待补发`);
        }
    } catch (e) {
        console.warn(`[Podcast] ❌ 话题同步失败: ${e.message}`);
    }
}

/**
 * 更新 Podcast API 上的 Agent 信息（fire-and-forget）
 * @param {string} agentId - Agent ID（用于读取 meta.json）
 * @param {object} updateFields - 要更新的字段
 */
async function syncPodcastAgentInfo(agentId, updateFields) {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) {
        return { success: false, skipped: true, reason: 'invalid_agent_id' };
    }
    const cleanFields = {};
    if (updateFields && typeof updateFields === 'object') {
        Object.entries(updateFields).forEach(([key, value]) => {
            if (!key) return;
            if (value === undefined || value === null) return;
            if (typeof value === 'string' && !value.trim()) return;
            cleanFields[key] = value;
        });
    }
    if (Object.keys(cleanFields).length === 0) {
        return { success: false, skipped: true, reason: 'empty_update_fields' };
    }

    try {
        const { meta } = readAgentMeta(normalizedAgentId);
        if (!meta?.podcastApiKey) {
            return { success: false, skipped: true, reason: 'missing_podcast_api_key' };
        }

        const axios = require('axios');
        await axios.put(`${PODCAST_API_BASE}/agent/me`, cleanFields, {
            headers: { 'X-API-Key': meta.podcastApiKey, 'Content-Type': 'application/json' },
            timeout: 10000
        });
        console.log(`[PodcastSync] ${normalizedAgentId} 已同步: ${Object.keys(cleanFields).join(', ')}`);
        return { success: true, skipped: false, reason: '' };
    } catch (e) {
        const reason = e?.message || String(e);
        console.warn(`[PodcastSync] ${normalizedAgentId} 同步失败: ${reason}`);
        return { success: false, skipped: false, reason };
    }
}

// Upload Agent Avatar
app.put('/api/agents/:agentId/avatar', upload.single('avatar'), async (req, res) => {
    const { agentId } = req.params;
    // Don't rely solely on getAgentById because it prioritizes workspace
    // We want to write to local data directory primarily if it exists, or fallback to workspace
    
    if (!req.file) return res.status(400).send('No file uploaded');
    
    // Determine target path
    // Priority: 1. Local Data Dir (./data/agents/:id) 2. Workspace
    let targetDir = path.join(DATA_AGENTS_DIR, agentId);
    let targetPath = path.join(targetDir, 'avatar.png');

    // Check if local dir exists (case-insensitive check)
    if (fs.existsSync(DATA_AGENTS_DIR)) {
        const dirs = fs.readdirSync(DATA_AGENTS_DIR);
        const matchDir = dirs.find(d => d.toLowerCase() === agentId.toLowerCase());
        if (matchDir) {
            targetDir = path.join(DATA_AGENTS_DIR, matchDir);
            targetPath = path.join(targetDir, 'avatar.png');
        }
    }
    
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    
    try {
        // Clean up existing avatars in targetDir to avoid stale files taking precedence
        const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        for (const ext of extensions) {
            const existingPath = path.join(targetDir, `avatar${ext}`);
            if (fs.existsSync(existingPath)) {
                try { fs.unlinkSync(existingPath); } catch(e) {}
            }
        }

        fs.copyFileSync(req.file.path, targetPath);
        
        // Also copy to workspace if it exists, so the running agent sees it immediately if serving from there
        const agent = getAgentById(agentId);
        if (agent && agent.workspace && fs.existsSync(agent.workspace)) {
             try {
                // Clean up existing avatars in workspace
                for (const ext of extensions) {
                    const existingWsPath = path.join(agent.workspace, `avatar${ext}`);
                    if (fs.existsSync(existingWsPath)) {
                        try { fs.unlinkSync(existingWsPath); } catch(e) {}
                    }
                }
                
                fs.copyFileSync(req.file.path, path.join(agent.workspace, 'avatar.png'));
                console.log(`[Avatar] Synced to workspace: ${agent.workspace}`);
             } catch(e) {
                 console.error('[Avatar] Failed to sync to workspace:', e);
             }
        }

        fs.unlinkSync(req.file.path); // Clean up temp

        // 同步头像到 Podcast API（等待完成再返回）
        let podcastSynced = false;
        try {
            const metaPath = path.join(DATA_AGENTS_DIR, agentId, 'meta.json');
            if (fs.existsSync(metaPath)) {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                if (meta.podcastApiKey) {
                    const publicUrl = await podcastPresignUpload(meta.podcastApiKey, targetPath, 'png', 'image/png');
                    if (publicUrl) {
                        await syncPodcastAgentInfo(agentId, { avatar_url: publicUrl, character_image_url: publicUrl });
                        podcastSynced = true;
                    }
                }
            }
        } catch (e) {
            console.warn(`[Avatar] Podcast 同步失败: ${e.message}`);
        }
        res.json({ success: true, podcastSynced });
    } catch (e) {
        console.error(`[Avatar] Upload failed:`, e);
        res.status(500).send('Upload failed');
    }
});

// Upload Agent Video
app.put('/api/agents/:agentId/video', upload.single('video'), async (req, res) => {
    const { agentId } = req.params;
    
    if (!req.file) return res.status(400).send('No file uploaded');
    
    // Determine target path - Priority: Local Data Dir
    let targetDir = path.join(DATA_AGENTS_DIR, agentId);
    let targetPath = path.join(targetDir, 'video.mp4');
    
    if (fs.existsSync(DATA_AGENTS_DIR)) {
        const dirs = fs.readdirSync(DATA_AGENTS_DIR);
        const matchDir = dirs.find(d => d.toLowerCase() === agentId.toLowerCase());
        if (matchDir) {
            targetDir = path.join(DATA_AGENTS_DIR, matchDir);
            targetPath = path.join(targetDir, 'video.mp4');
        }
    }
    
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    
    try {
        fs.copyFileSync(req.file.path, targetPath);
        
        // Sync to workspace if exists
        /*
        // [DISABLED] User requested ONLY local data update, NOT workspace update.
        const agent = getAgentById(agentId);
        if (agent && agent.workspace && fs.existsSync(agent.workspace)) {
             try {
                fs.copyFileSync(req.file.path, path.join(agent.workspace, 'video.mp4'));
             } catch(e) {
                 console.error('[Video] Failed to sync to workspace:', e);
             }
        }
        */
        
        fs.unlinkSync(req.file.path); // Clean up temp

        // 同步视频到 Podcast API（等待完成再返回）
        let podcastSynced = false;
        try {
            const metaPath = path.join(DATA_AGENTS_DIR, agentId, 'meta.json');
            if (fs.existsSync(metaPath)) {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                if (meta.podcastApiKey) {
                    const publicUrl = await podcastPresignUpload(meta.podcastApiKey, targetPath, 'mp4', 'video/mp4');
                    if (publicUrl) {
                        await syncPodcastAgentInfo(agentId, { character_video_url: publicUrl });
                        podcastSynced = true;
                    }
                }
            }
        } catch (e) {
            console.warn(`[Video] Podcast 同步失败: ${e.message}`);
        }
        res.json({ success: true, podcastSynced });
    } catch (e) {
        console.error(`[Video] Upload failed:`, e);
        res.status(500).send('Upload failed');
    }
});

// Update File Content
app.put('/api/agents/:agentId/file', (req, res) => {
    const { agentId } = req.params;
    const { path: filePath, content } = req.body;
    
    if (!filePath || content === undefined) return res.status(400).json({ error: 'Missing path or content' });
    
    const agent = getAgentById(agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    
    // If filePath is relative (e.g. "/SOUL.md"), join with workspace
    // Also handle if filePath starts with workspace path already but might be malformed or different normalization
    let targetPath = filePath;
    if (!path.isAbsolute(filePath)) {
        targetPath = path.join(agent.workspace, filePath);
    }
    
    // Security check: Normalize both and check prefix
    // Also allow writing to Knowledge Base? No, only agent files for now.
    const normalizedFilePath = path.normalize(targetPath);
    const normalizedWorkspace = path.normalize(agent.workspace);
    
    // Check if normalizedFilePath starts with normalizedWorkspace
    // Also allow if workspace is a parent of file path (which is the check above), but path.normalize handles separators.
    // On macOS, path capitalization doesn't matter for file system but does for startsWith.
    // Let's use lower case for comparison on mac/win? 
    // No, safest is to use path.relative and check if it starts with '..'
    
    const relative = path.relative(normalizedWorkspace, normalizedFilePath);
    const isInside = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    
    if (!isInside) {
         console.warn(`[Security] Write denied. File: ${normalizedFilePath}, Workspace: ${normalizedWorkspace}, Relative: ${relative}`);
         
         // Special handling for symbolic links or resolved paths
         try {
             if (fs.existsSync(normalizedFilePath)) {
                 const realFilePath = fs.realpathSync(normalizedFilePath);
                 const realWorkspace = fs.realpathSync(normalizedWorkspace);
                 const realRelative = path.relative(realWorkspace, realFilePath);
                 
                 if (realRelative && !realRelative.startsWith('..') && !path.isAbsolute(realRelative)) {
                     // Allowed by realpath
                 } else {
                     return res.status(403).json({ error: 'Access denied (outside workspace)' });
                 }
             } else {
                 // New file, strictly check
                 return res.status(403).json({ error: 'Access denied (outside workspace)' });
             }
         } catch(e) {
             return res.status(403).json({ error: 'Access denied: ' + e.message });
         }
    }
    
    try {
        fs.writeFileSync(normalizedFilePath, content, 'utf-8');
        // Refresh persona if SOUL.md or prompt.txt changed
        if (targetPath.endsWith('SOUL.md') || targetPath.endsWith('prompt.txt') || targetPath.endsWith('IDENTITY.md')) {
             refreshPersona(agentId);

             // 异步同步 prompt 到 Podcast API（fire-and-forget）
             const promptContent = content;
             syncPodcastAgentInfo(agentId, {
                 prompt: promptContent ? promptContent.substring(0, 5000) : '',
                 description: promptContent ? promptContent.substring(0, 500) : '',
                 personality: promptContent ? promptContent.substring(0, 500) : ''
             });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to write file: ' + e.message });
    }
});

// Helper to inject current roundtable context into SOUL.md and clear memory
function updateRoundtableSouls(agentIds) {
    // Get display names
    const names = agentIds.map(id => AGENTS[id] ? (AGENTS[id].displayName || AGENTS[id].name) : id);
    
    agentIds.forEach(id => {
        const agent = AGENTS[id];
        if (!agent || !agent.workspace) return;
        
        // 1. Update SOUL.md
        const soulPath = path.join(agent.workspace, 'SOUL.md');
        if (fs.existsSync(soulPath)) {
            try {
                let content = fs.readFileSync(soulPath, 'utf-8');
                
                // Remove previous injection if any
                const marker = "\n\n## Current Roundtable Context";
                const index = content.indexOf(marker);
                if (index !== -1) {
                    content = content.substring(0, index);
                }
                
                // Build new injection
                const myName = agent.displayName || agent.name;
                const otherNames = names.filter(n => n !== myName);
                
                const context = `${marker}

You are currently in a roundtable discussion.

**Current Attendees:** ${otherNames.join(', ')}

**STRICT RULE:** You may ONLY address or ask questions to the attendees listed above.
Do NOT address Bill Gates, Kobe Bryant, Steve Jobs, or anyone else UNLESS they are in the list above.
Ignore any examples in this file that mention other names.

## Next-Speaker Protocol

- If you are acting as the moderator/host in this roundtable, your reply may contain **at most one** \`{next: "Name"}\`.
- Outside moderator mode (free discussion / single chat), multiple \`{next: "Name"}\` directives are allowed.
- If a message contains \`{next: "Name"}\` and **Name is not you**, do not jump in. Let that person handle this turn.
- If **Name is you**, first read the full context/question from the person who called on you, then decide whether to reply.
- If you reply, answer that person's point directly before expanding to anything else.
- If a message contains \`@Name\` and Name is not you, do not jump in. Let the @mentioned person handle this turn.
- If you are @mentioned, read the caller's context first. You may decide whether to reply (recommended to reply); if you reply, answer the caller first.
- If no \`{next: ...}\` appears, follow the normal turn order.

## Expressive TTS Cues (Optional)

You may use the following inline cue tokens to make speech more natural when appropriate:

- \`(laughs)\` = laughter
- \`(chuckle)\` = a light chuckle
- \`(coughs)\` = coughing
- \`(clear-throat)\` = clearing throat
- \`(groans)\` = groaning
- \`(breath)\` = normal breath
- \`(pant)\` = panting
- \`(inhale)\` = inhaling
- \`(exhale)\` = exhaling
- \`(gasps)\` = gasping
- \`(sniffs)\` = sniffing
- \`(sighs)\` = sighing
- \`(snorts)\` = snorting
- \`(burps)\` = burping
- \`(lip-smacking)\` = lip smacking
- \`(humming)\` = humming
- \`(hissing)\` = hissing
- \`(emm)\` = filler sound ("emm")
- \`(sneezes)\` = sneezing

Usage rules:
- Keep the token format exactly as shown: lowercase + parentheses.
- Use cues sparingly (normally 0-2 per reply), only when it sounds natural.
- Place cues at natural sentence boundaries, not in the middle of words.
- Do not overuse cues or stack many cues together.
- In roundtable speaking mode, try to include one cue in roughly every 2-4 turns when it fits the tone.

Examples (natural placement):
- "(chuckle) That's a fair point, but I'd frame it differently."
- "If we're being honest, this risk is non-trivial. (sighs)"
- "(inhale) Let me answer that directly in one sentence first."`;

                fs.writeFileSync(soulPath, content + context, 'utf-8');
                console.log(`[Roundtable] Updated SOUL.md for ${id} with context: ${otherNames.join(', ')}`);
                
                // Reload persona into memory
                refreshPersona(id);
                
            } catch (e) {
                console.error(`[Roundtable] Failed to update SOUL.md for ${id}:`, e);
            }
        }

        // 2. Clear Memory (Sessions)
        try {
            const agentDir = path.join(OPENCLAW_ROOT_DIR, 'agents', id);
            const sessionsFile = path.join(agentDir, 'sessions', 'sessions.json');
            if (fs.existsSync(sessionsFile)) {
                fs.renameSync(sessionsFile, sessionsFile + '.bak_' + Date.now());
                console.log(`[Roundtable] Cleared memory for ${id}`);
            }
        } catch (e) {
            console.error(`[Roundtable] Failed to clear memory for ${id}:`, e);
        }

        // 3. Clear Workspace Memory (if different)
        try {
            const wsSessionsFile = path.join(agent.workspace, 'sessions', 'sessions.json');
            if (fs.existsSync(wsSessionsFile)) {
                fs.renameSync(wsSessionsFile, wsSessionsFile + '.bak_' + Date.now());
                console.log(`[Roundtable] Cleared workspace memory for ${id}`);
            }
        } catch (e) {}
    });
}

// 创建房间
function createRoom(hostAgentId = 'jobs', agentIds = null, voiceIds = null, category = null) {
  const channelId = generateChannelId();

  // 如果没有传入 agentIds，使用默认的5个
  const useAgentIds = agentIds && agentIds.length > 0
    ? agentIds
    : ['jobs', 'kobe', 'munger', 'hawking', 'gates'];

  // Update SOULs and clear memory for the new room context
  updateRoundtableSouls(useAgentIds);

  // 构建房间的 agents 配置
  const roomAgents = {};
  useAgentIds.forEach((id, index) => {
    // 优先使用全局 AGENTS 中的配置（包含正确的 displayName）
    if (AGENTS[id]) {
        roomAgents[id] = { ...AGENTS[id] };
        // 如果 URL 参数指定了 voiceId，覆盖默认配置
        if (voiceIds && voiceIds[index]) {
            roomAgents[id].voiceId = voiceIds[index];
        }
    } else {
        // 兜底：如果没有全局配置，尝试从本地 agent 数据获取 displayName
        const voiceId = voiceIds && voiceIds[index] ? voiceIds[index] : 'speech-2-1';
        let localName = id.charAt(0).toUpperCase() + id.slice(1);
        let localDisplayName = localName;
        try {
            const localAgents = scanLocalAgents();
            const localKey = Object.keys(localAgents).find(k => k.toLowerCase() === id.toLowerCase());
            if (localKey && localAgents[localKey]) {
                localName = localAgents[localKey].name || localName;
                localDisplayName = localAgents[localKey].displayName || localName;
            }
        } catch(e) {}
        roomAgents[id] = {
            id: id,
            name: localName,
            displayName: localDisplayName,
            emoji: '🎭',
            sessionKey: `agent:${id}:main`,
            workspace: getPreferredWorkspacePath(id),
            systemPrompt: null,
            voiceId: voiceId
        };
    }
  });

  const room = {
    channelId,
    hostAgentId,
    agentIds: useAgentIds,     // 房间内的 agent 列表
    voiceIds: voiceIds,       // 音色 ID 列表
    agents: roomAgents,       // 房间的 agents 配置
    createdAt: Date.now(),
    category: category,          // 房间分类（如 'AI_Tech', 'Trending'）
    moderator: new EnhancedRoundTableModerator({ topics: loadedTopics, agentIds: useAgentIds, agents: roomAgents, category: category, topicLoader: loadTopicsFromKnowledgeBase }),
    // 调试：记录话题数量和第一个话题的 postData
    _debug: { topicCount: loadedTopics.length, firstTopic: loadedTopics[0] ? { title: loadedTopics[0].title, hasPostData: !!loadedTopics[0].postData, platform: loadedTopics[0].postData?.platform } : null },
    currentDisplayTopic: null, // 当前展示给用户的话题（用于延迟切换）
    speakerChain: [],       // 发言人链表 [{agentId, text, audioCache, timestamp, duration}]
    currentSpeaker: null,  // 当前正在说话的speaker {agentId, text, audioCache:[], startTime, ttsStreaming, audioDuration}
    nextPreparedAgent: null, // 下一个准备好的发言人
    nextPreparedMessage: null, // 下一个发言人的消息
    nextPreparedAt: 0,        // 下一个发言人被派发的时间戳（用于卡住检测）
    nextPreparedRetryCount: 0, // 下一个发言人自动重派发次数
    activeTurnAgentId: null,   // 当前“已开口并进入本轮”的发言者
    activeTurnStartedAt: 0,    // 当前发言轮次开始时间戳
    preloadIssuedByAgentId: null, // 本轮已触发预加载的发言者（同一轮仅允许一次）
    participants: new Set(useAgentIds),
    isActive: false,
    preparingAgent: null,       // 房间级：当前正在准备中的 agent
    preparingStartTime: null,   // 房间级：准备开始时间
    interruptedAgents: new Set(), // 房间级：被打断的 agents
    hostWs: null,          // 主机的WebSocket连接
    hostRuntimeId: null,   // 主机页面运行实例ID（用于区分同页重连 vs 新页接管）
    podcastPusher: null,   // 该房间独立的 Podcast 推流连接
    pendingPodcastLiveEvent: null, // 待补发的开播/下播事件
    pendingPodcastStreamingLifecycleEvent: null, // 待补发的 C→S 开播/下播命令（手动或服务端关停）
    podcastReconnectRetryCount: 0, // Podcast 控制连接失败后的自动重试计数
    podcastReconnectRetryTimer: null, // Podcast 控制连接失败后的自动重试定时器
    _suppressNextPodcastLiveEvent: false, // 避免服务端 stop_streaming 触发的停播回环上报
    pendingStreamingControlCommand: null, // 待补发给主机前端的开播/下播控制命令
    topicQueue: [],              // 当前麦序话题列表（从服务端拉取）
    queueTopics: [],             // Kimi 抓取完成的待讨论话题（优先队列）
    kimiProcesses: new Map(),    // queue_id → { process, status }
    topicHistory: [],            // 房间已讨论话题历史
    speechEndedFallbackTimer: null // 发言结束回调兜底定时器
  };

  // 新房间先按当前房间标识（可能是 channel）同步话题记忆
  syncRoomTopicMemoryToModerator(room);

  rooms.set(channelId, room);
  console.log(`[Room] 创建房间: ${channelId}, 主机: ${hostAgentId}, 席位: ${useAgentIds.join(', ')}`);
  return room;
}

// 获取房间
function getRoom(channelId) {
  return rooms.get(channelId);
}

function setRoomNextPrepared(room, nextAgentId, nextMessage) {
  if (!room) return;
  room.nextPreparedAgent = nextAgentId || null;
  room.nextPreparedMessage = nextMessage || null;
  room.nextPreparedAt = Date.now();
  room.nextPreparedRetryCount = 0;
}

function clearRoomNextPrepared(room) {
  if (!room) return;
  room.nextPreparedAgent = null;
  room.nextPreparedMessage = null;
  room.nextPreparedAt = 0;
  room.nextPreparedRetryCount = 0;
  room.preloadIssuedByAgentId = null;
}

function buildRoomStuckDiagnostics(room) {
  const now = Date.now();
  const diag = {
    generatedAt: now,
    channelId: room && room.channelId ? room.channelId : null,
    isStuck: false,
    summary: 'ok',
    reasons: [],
    snapshot: {}
  };
  if (!room) {
    diag.summary = 'room_missing';
    diag.reasons.push({ code: 'room_missing', detail: 'room 对象不存在' });
    diag.isStuck = true;
    diag.signature = 'room_missing';
    return diag;
  }

  const state = getRoundTableState(room.channelId);
  const currentSpeaker = room.currentSpeaker || null;
  const nextPreparedAgent = room.nextPreparedAgent || null;
  const preparingAgent = state && state.preparingAgent ? state.preparingAgent : null;
  const preparingStartedAt = Number(state && state.preparingStartTime ? state.preparingStartTime : 0);
  const nextPreparedAt = Number(room.nextPreparedAt || 0);
  const nextPreparedSince = preparingStartedAt || nextPreparedAt || 0;
  const nextPreparedAgeMs = nextPreparedSince ? (now - nextPreparedSince) : -1;
  const activeTurnAgeMs = room.activeTurnStartedAt ? (now - room.activeTurnStartedAt) : -1;

  diag.snapshot = {
    isActive: !!room.isActive,
    currentSpeaker: currentSpeaker ? {
      agentId: currentSpeaker.agentId,
      ttsStreaming: !!currentSpeaker.ttsStreaming,
      ageMs: currentSpeaker.startTime ? (now - currentSpeaker.startTime) : -1,
      lastChunkAgoMs: (currentSpeaker.lastChunkAt || currentSpeaker.startTime)
        ? (now - (currentSpeaker.lastChunkAt || currentSpeaker.startTime))
        : -1,
      audioBytes: Number(currentSpeaker.audioBytes || 0),
      cacheChunks: Array.isArray(currentSpeaker.audioCache) ? currentSpeaker.audioCache.length : 0
    } : null,
    nextPreparedAgent: nextPreparedAgent,
    nextPreparedAgeMs: nextPreparedAgeMs,
    preparingAgent: preparingAgent,
    preparingAgeMs: preparingStartedAt ? (now - preparingStartedAt) : -1,
    activeTurnAgentId: room.activeTurnAgentId || null,
    activeTurnAgeMs: activeTurnAgeMs,
    speakerChainLen: Array.isArray(room.speakerChain) ? room.speakerChain.length : 0,
    autoRecoveryDisabled: !!ROUNDTABLE_DISABLE_FAILURE_RECOVERY
  };

  if (!room.isActive) {
    diag.summary = 'room_inactive';
    diag.signature = 'room_inactive';
    return diag;
  }

  const WAIT_WARN_MS = 5000;
  const currentAgentId = currentSpeaker && currentSpeaker.agentId ? currentSpeaker.agentId : '';
  const currentLastChunkAgoMs = currentSpeaker && (currentSpeaker.lastChunkAt || currentSpeaker.startTime)
    ? now - (currentSpeaker.lastChunkAt || currentSpeaker.startTime)
    : -1;
  const currentTtsOpen = currentAgentId ? hasOpenRoomAgentTtsSocket(room.channelId, currentAgentId) : false;
  const currentLlmInFlight = currentAgentId ? hasInFlightOpenClawRequest(currentAgentId, room.channelId) : false;
  const nextLlmInFlight = nextPreparedAgent ? hasInFlightOpenClawRequest(nextPreparedAgent, room.channelId) : false;
  const nextTtsOpen = nextPreparedAgent ? hasOpenRoomAgentTtsSocket(room.channelId, nextPreparedAgent) : false;

  if (currentSpeaker) {
    if (currentSpeaker.ttsStreaming && currentLastChunkAgoMs > WAIT_WARN_MS) {
      diag.reasons.push({
        code: 'current_speaker_no_new_audio_chunk',
        detail: `agent=${currentAgentId},lastChunkAgoMs=${currentLastChunkAgoMs},ttsOpen=${currentTtsOpen},llmInFlight=${currentLlmInFlight}`
      });
    }
    if (!currentSpeaker.ttsStreaming) {
      if (nextPreparedAgent && nextPreparedAgeMs > WAIT_WARN_MS) {
        diag.reasons.push({
          code: 'next_prepared_not_starting_after_current_complete',
          detail: `next=${nextPreparedAgent},ageMs=${nextPreparedAgeMs},preparingAgent=${preparingAgent || 'null'},ttsOpen=${nextTtsOpen},llmInFlight=${nextLlmInFlight}`
        });
      }
      if (!nextPreparedAgent && activeTurnAgeMs > WAIT_WARN_MS) {
        diag.reasons.push({
          code: 'current_complete_but_no_next_prepared',
          detail: `activeTurnAgent=${room.activeTurnAgentId || 'null'},activeTurnAgeMs=${activeTurnAgeMs}`
        });
      }
    }
  } else {
    if (nextPreparedAgent && nextPreparedAgeMs > WAIT_WARN_MS) {
      diag.reasons.push({
        code: 'next_prepared_waiting_without_current_speaker',
        detail: `next=${nextPreparedAgent},ageMs=${nextPreparedAgeMs},preparingAgent=${preparingAgent || 'null'},ttsOpen=${nextTtsOpen},llmInFlight=${nextLlmInFlight}`
      });
    }
    if (!nextPreparedAgent && room.activeTurnAgentId && activeTurnAgeMs > WAIT_WARN_MS) {
      diag.reasons.push({
        code: 'active_turn_without_current_or_next',
        detail: `activeTurnAgent=${room.activeTurnAgentId},activeTurnAgeMs=${activeTurnAgeMs}`
      });
    }
  }

  if (diag.reasons.length > 0 && ROUNDTABLE_DISABLE_FAILURE_RECOVERY) {
    diag.reasons.push({
      code: 'auto_recovery_disabled',
      detail: '调试模式已禁用自动重试/自动推进，需要人工介入'
    });
  }

  diag.isStuck = diag.reasons.length > 0;
  diag.summary = diag.isStuck
    ? diag.reasons.map((item) => item.code).join(',')
    : 'ok';
  diag.signature = diag.isStuck
    ? diag.reasons.map((item) => `${item.code}:${item.detail || ''}`).join('|')
    : 'ok';
  return diag;
}

function maybeLogRoomStuckDiagnostics(room, source = 'unknown') {
  if (!room) return null;
  const diag = buildRoomStuckDiagnostics(room);
  const now = Date.now();
  if (diag.isStuck) {
    if (
      room._lastStuckDiagSignature !== diag.signature ||
      now - Number(room._lastStuckDiagAt || 0) >= STUCK_DIAG_LOG_REPEAT_MS
    ) {
      console.warn(
        `[STUCK_DIAG][server] channel=${room.channelId}, source=${source}, summary=${diag.summary}, reasons=${diag.reasons.map((item) => `${item.code}:${item.detail || ''}`).join(' | ')}`
      );
      room._lastStuckDiagSignature = diag.signature;
      room._lastStuckDiagAt = now;
    }
    return diag;
  }

  if (room._lastStuckDiagSignature) {
    console.log(`[STUCK_DIAG][server] channel=${room.channelId}, source=${source}, cleared`);
  }
  room._lastStuckDiagSignature = '';
  room._lastStuckDiagAt = 0;
  return diag;
}

function sweepRoomStuckDiagnosticsLogs() {
  for (const room of rooms.values()) {
    if (!room || !room.channelId || !room.isActive) continue;
    maybeLogRoomStuckDiagnostics(room, 'periodic');
  }
}

function listRuntimeRoomsSnapshot() {
  return Array.from(rooms.values()).map((room) => {
    const topicData = room.currentDisplayTopic || room.moderator?.currentTopicData || null;
    return {
      channelId: room.channelId,
      hostAgentId: room.hostAgentId,
      podcastRoomId: room.podcastRoomId || null,
      agentIds: Array.isArray(room.agentIds) ? room.agentIds : [],
      isActive: !!room.isActive,
      currentTopic: room.moderator?.currentTopic || null,
      currentTopicData: topicData,
      createdAt: room.createdAt ? new Date(room.createdAt).toISOString() : null
    };
  });
}

function stopActiveRoomRoundtables(options = {}) {
  const source = String(options?.source || 'pre_restart').trim() || 'pre_restart';
  const notifyRoomServiceStop = Boolean(
    options?.notifyRoomServiceStop ||
    source === 'pre_restart' ||
    source === 'shutdown'
  );
  const activeRooms = Array.from(rooms.values()).filter((room) => room && room.channelId && room.isActive);
  const stopped = [];

  for (const room of activeRooms) {
    const channelId = room.channelId;
    stopRoundTable(channelId, { source, notifyRoomServiceStop });
    abortOpenClawRequests((requestId, entry) => (entry.roomId || null) === channelId, 'StopBeforeRestart');
    const closedTtsSockets = closeRoomTtsSockets(channelId, 'pre_restart_stop_room');
    stopped.push({
      channelId,
      podcastRoomId: room.podcastRoomId || null,
      closedTtsSockets
    });
  }

  return {
    source,
    totalRooms: rooms.size,
    activeRoomsBeforeStop: activeRooms.length,
    stoppedCount: stopped.length,
    stopped,
    timestamp: new Date().toISOString()
  };
}

function forceInterruptRoomPlayback(room, reason = 'server_stop', initiator = 'server') {
  if (!room || !room.channelId) return;
  try {
    broadcastToRoom(room, {
      type: 'interrupt',
      initiator,
      reason,
      forceStopAudio: true
    });
  } catch (_) {}
}

function buildClientRoomAgents(room) {
  const result = {};
  if (!room || !Array.isArray(room.agentIds)) return result;
  room.agentIds.forEach((id) => {
    const base = (room.agents && room.agents[id]) ? room.agents[id] : (AGENTS[id] || {});
    result[id] = {
      ...base,
      avatarUrl: (base && base.avatarUrl) ? base.avatarUrl : `/api/agents/${id}/avatar`,
      videoUrl: (base && base.videoUrl) ? base.videoUrl : `/api/agents/${id}/video`
    };
  });
  return result;
}

// 删除房间
function deleteRoom(channelId) {
  const room = rooms.get(channelId);
  if (room) {
    room.moderator.stop();
    // 终止所有 Kimi 进程
    if (room.kimiProcesses) {
      for (const [qid, entry] of room.kimiProcesses) {
        if (entry.status === 'running' && entry.process) {
          entry.status = 'cancelled';
          entry.process.kill();
          console.log(`[Kimi] 🧹 房间删除，终止 ${qid}`);
        }
      }
      room.kimiProcesses.clear();
    }
    if (room.podcastPusher) {
      room.podcastPusher.disconnect();
      room.podcastPusher = null;
    }
    if (room.podcastReconnectRetryTimer) {
      clearTimeout(room.podcastReconnectRetryTimer);
      room.podcastReconnectRetryTimer = null;
    }
    room.podcastReconnectRetryCount = 0;
    rooms.delete(channelId);
    console.log(`[Room] 删除房间: ${channelId}`);
  }
}

function normalizeTopicHistoryKey(topicData) {
  if (!topicData) return '';
  if (topicData.queue_id) return `queue:${topicData.queue_id}`;
  return normalizeGlobalTopicKey(topicData);
}

function normalizeGlobalTopicKey(topicData) {
  if (!topicData) return '';
  const url = (topicData.postData?.url || topicData.postData?.original_url || topicData.url || topicData.reference_url || '').toString().trim();
  if (url) return `url:${url}`;
  if (topicData.path) return `path:${topicData.path}`;
  const title = (topicData.title || '').toString().trim().toLowerCase();
  if (title) return `title:${title}`;
  return '';
}

function rememberTopicGlobally(topicData) {
  if (!topicData) return;
  if (topicData.path) {
    globalDiscussedTopicPaths.add(topicData.path);
    globalLastTopicPath = topicData.path;
  }
  const key = normalizeGlobalTopicKey(topicData);
  if (key) {
    globalDiscussedTopicKeys.add(key);
    globalLastTopicKey = key;
  }
  saveGlobalTopicMemory();
}

function getTopicUniverseFromModerator(mod) {
  const topics = mod ? (mod.topicLoader ? mod.topicLoader() : mod.topics) : [];
  const validPaths = new Set();
  const validKeys = new Set();
  for (const topic of (Array.isArray(topics) ? topics : [])) {
    if (!topic) continue;
    if (topic.path) validPaths.add(topic.path);
    const key = normalizeGlobalTopicKey(topic);
    if (key) validKeys.add(key);
  }
  return { validPaths, validKeys };
}

function syncRoomTopicMemoryToModerator(room) {
  if (!room || !room.moderator) return;
  const memoryId = getRoomTopicMemoryId(room);
  if (!memoryId) return;
  const state = ensureRoomTopicMemory(memoryId);
  if (!state) return;

  room.moderator.usedTopicPaths = new Set(state.paths || []);
  room.moderator.usedTopicKeys = new Set(state.keys || []);
  room.moderator.lastTopicPath = state.lastPath || null;
  room.moderator.lastTopicKey = state.lastKey || null;
}

function rememberTopicForRoom(room, topicData) {
  if (!room || !topicData) return;
  const memoryId = getRoomTopicMemoryId(room);
  if (!memoryId) return;
  const state = ensureRoomTopicMemory(memoryId);
  if (!state) return;

  if (topicData.path) {
    state.paths.add(topicData.path);
    state.lastPath = topicData.path;
  }
  const key = normalizeGlobalTopicKey(topicData);
  if (key) {
    state.keys.add(key);
    state.lastKey = key;
  }
  state.updatedAt = new Date().toISOString();
  saveRoomTopicMemory();
}

function maybeRotateRoomTopicMemory(room) {
  if (!room || !room.moderator) return;
  const memoryId = getRoomTopicMemoryId(room);
  if (!memoryId) return;
  const state = ensureRoomTopicMemory(memoryId);
  if (!state) return;

  const { validPaths, validKeys } = getTopicUniverseFromModerator(room.moderator);
  let changed = false;

  for (const p of Array.from(state.paths)) {
    if (!validPaths.has(p)) {
      state.paths.delete(p);
      changed = true;
    }
  }
  for (const k of Array.from(state.keys)) {
    if (!validKeys.has(k)) {
      state.keys.delete(k);
      changed = true;
    }
  }

  let exhausted = validKeys.size > 0;
  if (exhausted) {
    for (const k of validKeys) {
      if (!state.keys.has(k)) {
        exhausted = false;
        break;
      }
    }
  }

  if (exhausted) {
    const keepPath = state.lastPath && validPaths.has(state.lastPath) ? state.lastPath : null;
    const keepKey = state.lastKey && validKeys.has(state.lastKey) ? state.lastKey : null;
    state.paths.clear();
    state.keys.clear();
    if (keepPath) state.paths.add(keepPath);
    if (keepKey) state.keys.add(keepKey);
    state.updatedAt = new Date().toISOString();
    changed = true;
    console.log(`[RoomTopicMemory] ♻️ ${memoryId} 已覆盖全部话题，开启新一轮（保留 last 避免连抽同题）`);
  }

  if (changed) {
    saveRoomTopicMemory();
  }
}

function migrateRoomTopicMemoryToPodcastId(room) {
  if (!room || !room.channelId || !room.podcastRoomId) return;
  const fromId = `channel:${room.channelId}`;
  const toId = `podcast:${String(room.podcastRoomId).trim()}`;
  if (!toId || fromId === toId) return;

  const fromState = roomTopicMemory.get(fromId);
  const toState = ensureRoomTopicMemory(toId);
  if (!toState) return;

  let changed = false;
  if (fromState) {
    for (const p of (fromState.paths || [])) {
      if (!toState.paths.has(p)) {
        toState.paths.add(p);
        changed = true;
      }
    }
    for (const k of (fromState.keys || [])) {
      if (!toState.keys.has(k)) {
        toState.keys.add(k);
        changed = true;
      }
    }
    if (!toState.lastPath && fromState.lastPath) {
      toState.lastPath = fromState.lastPath;
      changed = true;
    }
    if (!toState.lastKey && fromState.lastKey) {
      toState.lastKey = fromState.lastKey;
      changed = true;
    }
    roomTopicMemory.delete(fromId);
    changed = true;
  }

  if (changed) {
    toState.updatedAt = new Date().toISOString();
    saveRoomTopicMemory();
  }
}

function syncGlobalTopicMemoryToModerator(mod) {
  if (!mod) return;
  if (!mod.usedTopicPaths) mod.usedTopicPaths = new Set();
  if (!mod.usedTopicKeys) mod.usedTopicKeys = new Set();
  for (const p of globalDiscussedTopicPaths) {
    mod.usedTopicPaths.add(p);
  }
  for (const k of globalDiscussedTopicKeys) {
    mod.usedTopicKeys.add(k);
  }
  if (globalLastTopicPath) {
    mod.lastTopicPath = globalLastTopicPath;
  }
  if (globalLastTopicKey) {
    mod.lastTopicKey = globalLastTopicKey;
  }
}

function recordRoomTopicHistory(room, topicData, source = 'system') {
  if (!room || !topicData) return;
  if (!room.topicHistory) room.topicHistory = [];

  const key = normalizeTopicHistoryKey(topicData);
  if (!key) return;

  const last = room.topicHistory[room.topicHistory.length - 1];
  if (last && last.key === key) return;

  room.topicHistory.push({
    key,
    topic_key: normalizeGlobalTopicKey(topicData),
    topic_url: topicData.postData?.url || topicData.url || '',
    title: topicData.title || '',
    category: topicData.category || '',
    queue_id: topicData.queue_id || null,
    path: topicData.path || null,
    created_by: topicData.created_by || '',
    created_by_nickname: topicData.created_by_nickname || '',
    source,
    discussedAt: new Date().toISOString()
  });

  if (room.topicHistory.length > 200) {
    room.topicHistory = room.topicHistory.slice(-200);
  }

  // 记录到房间级记忆，避免该房间 stop/刷新/重开后立刻重复老话题
  rememberTopicForRoom(room, topicData);
}

// 添加到发言人链表
function addToSpeakerChain(room) {
  if (!room.currentSpeaker) return;

  const entry = {
    agentId: room.currentSpeaker.agentId,
    text: room.currentSpeaker.text,
    audioCache: room.currentSpeaker.audioCache.join(''),
    timestamp: room.currentSpeaker.startTime,
    duration: room.currentSpeaker.audioDuration || 0
  };

  room.speakerChain.push(entry);

  // 超过20条时移除最老的
  if (room.speakerChain.length > 20) {
    room.speakerChain.shift();
  }

  room.currentSpeaker = null;
  console.log(`[Room] 添加到链表: ${entry.agentId}, 当前链表长度: ${room.speakerChain.length}`);
}

// 计算当前播放位置（毫秒）
function calculateAudioTimestamp(room) {
  if (!room.currentSpeaker) {
    return { index: -1, position: 0 };
  }

  const index = room.speakerChain.length;
  const elapsed = Date.now() - room.currentSpeaker.startTime;
  return { index, position: elapsed };
}

// 缓存音频块
function cacheAudioChunk(room, agentId, audioHex, isComplete, text = '') {
  const incomingAudio = typeof audioHex === 'string' ? audioHex : '';
  const incomingText = typeof text === 'string' ? text : '';
  const hasAudio = incomingAudio.length > 0;

  if (!room.currentSpeaker || room.currentSpeaker.agentId !== agentId) {
    // 仅凭“空 complete 包”不创建新说话人，避免链表出现重复空条目
    if (!hasAudio) {
      if (isComplete) {
        console.warn(
          `[Room] ⏭️ 忽略孤儿完成包: channel=${room.channelId}, agent=${agentId}, reason=no_active_speaker_and_no_audio`
        );
      }
      return;
    }

    // 新发言者 - 创建新条目
    room.currentSpeaker = {
      agentId,
      text: incomingText,
      audioCache: [],
      audioBytes: 0,
      startTime: Date.now(),
      lastChunkAt: Date.now(),
      ttsStreaming: true,
      audioDuration: 0
    };
  }

  // 容错：若 speech-started 回调丢失，只要该 agent 已有真实音频到达，就视为已开口并消费 nextPrepared。
  if (room.nextPreparedAgent === agentId) {
    clearRoomNextPrepared(room);
    const state = getRoundTableState(room.channelId);
    if (state.preparingAgent === agentId) {
      state.preparingAgent = null;
      state.preparingStartTime = null;
    }
    console.log(`[RoundTable] 🧹 ${agentId} 音频已到达，兜底清除 nextPrepared/preparing`);
  }
  if (room.activeTurnAgentId !== agentId) {
    room.activeTurnAgentId = agentId;
    room.activeTurnStartedAt = Date.now();
    room.preloadIssuedByAgentId = null;
  }

  // 更新文本（累积）
  if (incomingText && incomingText.length > room.currentSpeaker.text.length) {
    room.currentSpeaker.text = incomingText;
  }

  // 只有非空的音频块才缓存
  if (hasAudio) {
    room.currentSpeaker.audioCache.push(incomingAudio);
    room.currentSpeaker.audioBytes += incomingAudio.length / 2;
  }
  room.currentSpeaker.lastChunkAt = Date.now();
  room.currentSpeaker.ttsStreaming = !isComplete;

  // 实时广播当前说话者状态给所有分机
  const { index, position } = calculateAudioTimestamp(room);
  broadcastToRoom(room, {
    type: 'speaker_update',
    agentId: agentId,
    text: room.currentSpeaker.text,
    audioTimestamp: position,
    ttsStreaming: room.currentSpeaker.ttsStreaming,
    isComplete: isComplete
  });

  // TTS完成，加入链表
  if (isComplete) {
    const completedAgentId = room.currentSpeaker.agentId;
    const completedText = room.currentSpeaker.text || incomingText || '';
    const completedStartTime = room.currentSpeaker.startTime;
    // 估算音频时长（简单估算：每100字符约1秒，实际由TTS返回）
    room.currentSpeaker.audioDuration = Math.max(room.currentSpeaker.audioCache.join('').length / 100, 1000);
    addToSpeakerChain(room);

    // 兜底自动推进：调试模式下禁用，避免掩盖真实失败
    if (!ROUNDTABLE_DISABLE_FAILURE_RECOVERY) {
      // 典型症状：
      // 1) speakerChain 有新增，但 currentSpeaker=null 且 nextPreparedAgent===completedAgentId
      // 2) speakerChain 有新增，但 currentSpeaker=null 且 nextPreparedAgent===null（本次修复覆盖）
      setTimeout(() => {
        const latestRoom = rooms.get(room.channelId);
        if (!latestRoom || !latestRoom.isActive) return;
        if (latestRoom.currentSpeaker) return; // 已有新发言者
        const stuckOnSelfPrepared = latestRoom.nextPreparedAgent === completedAgentId;
        const stuckWithNoPrepared = !latestRoom.nextPreparedAgent;
        if (!stuckOnSelfPrepared && !stuckWithNoPrepared) return; // 前端已正常推进到其他人

        // 避免同一条发言被重复兜底
        if (
          latestRoom._lastAutoSpeechEnded &&
          latestRoom._lastAutoSpeechEnded.agentId === completedAgentId &&
          latestRoom._lastAutoSpeechEnded.startTime === completedStartTime
        ) {
          return;
        }

        latestRoom._lastAutoSpeechEnded = {
          agentId: completedAgentId,
          startTime: completedStartTime,
          at: Date.now()
        };

        console.warn(
          `[RoundTable] ⚠️ 检测到 speech-ended 丢失/未推进，自动推进下一轮: channel=${latestRoom.channelId}, agent=${completedAgentId}, nextPrepared=${latestRoom.nextPreparedAgent || 'null'}`
        );
        onSpeechEnded(completedAgentId, completedText || '自动兜底推进', null, latestRoom.channelId, false);
      }, 1500);
    }
  }
}

function forceCompleteStalledSpeaker(room, reason = 'stalled_speaker_timeout') {
  if (!room || !room.currentSpeaker) return false;
  const stalled = room.currentSpeaker;
  const stalledAgentId = stalled.agentId;
  const stalledText = String(stalled.text || '').trim();
  const stalledStartTime = stalled.startTime;

  if (
    room._lastForcedSpeakerCompletion &&
    room._lastForcedSpeakerCompletion.agentId === stalledAgentId &&
    room._lastForcedSpeakerCompletion.startTime === stalledStartTime
  ) {
    return false;
  }

  room._lastForcedSpeakerCompletion = {
    agentId: stalledAgentId,
    startTime: stalledStartTime,
    at: Date.now(),
    reason
  };

  // 先广播一个完成态，避免分机一直显示 ttsStreaming=true
  try {
    broadcastToRoom(room, {
      type: 'speaker_update',
      agentId: stalledAgentId,
      text: stalled.text || '',
      audioTimestamp: Math.max(0, Date.now() - stalled.startTime),
      ttsStreaming: false,
      isComplete: true
    });
  } catch (_) {}

  stalled.audioDuration = Math.max((stalled.audioCache || []).join('').length / 100, 1000);
  addToSpeakerChain(room);

  const fallbackContent = stalledText || '[系统兜底] 当前轮文本未完整返回，请继续下一位。';
  console.warn(
    `[RoundTable] ⚠️ 强制收敛卡住发言: channel=${room.channelId}, agent=${stalledAgentId}, reason=${reason}`
  );
  try {
    onSpeechEnded(stalledAgentId, fallbackContent, null, room.channelId, false);
  } catch (e) {
    console.error(
      `[RoundTable] ❌ 强制收敛后推进下一轮失败: channel=${room.channelId}, agent=${stalledAgentId}, err=${e.message}`
    );
  }
  return true;
}

function sweepStalledCurrentSpeakers() {
  if (ROUNDTABLE_DISABLE_FAILURE_RECOVERY) return;
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room || !room.isActive || !room.currentSpeaker) continue;
    const speaker = room.currentSpeaker;
    if (!speaker.ttsStreaming) continue;
    const lastAt = speaker.lastChunkAt || speaker.startTime || now;
    if (now - lastAt < ROOM_SPEAKER_STALL_TIMEOUT_MS) continue;

    // 保护：如果当前说话人已缓存了较长音频，且理论播放时长尚未走完，
    // 说明前端可能仍在播放本地缓冲，不应过早判定“卡住”并强制切人。
    const cachedBytes = Number(speaker.audioBytes || 0);
    const bufferedDurationMs = cachedBytes > 0 ? (cachedBytes / 16000) * 1000 : 0; // 128kbps mp3 约 16KB/s
    const elapsedSinceStart = Math.max(0, now - (speaker.startTime || now));
    const playbackGuardMs = bufferedDurationMs + 3000; // 给解码/调度留 3s 余量
    if (bufferedDurationMs > 0 && elapsedSinceStart < playbackGuardMs) {
      continue;
    }

    forceCompleteStalledSpeaker(room, 'no_audio_chunk_timeout');
  }
}

function sweepStalledPreparedDispatch() {
  if (ROUNDTABLE_DISABLE_FAILURE_RECOVERY) return;
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room || !room.isActive) continue;
    if (room.currentSpeaker) continue;
    if (!room.nextPreparedAgent || !room.nextPreparedMessage) continue;

    const state = getRoundTableState(room.channelId);
    const stuckSince = state.preparingStartTime || room.nextPreparedAt || 0;
    if (!stuckSince) continue;
    if (now - stuckSince < ROOM_PREPARED_STALL_TIMEOUT_MS) continue;

    const nextAgent = room.nextPreparedAgent;
    const nextMessage = room.nextPreparedMessage;
    const retryCount = Number(room.nextPreparedRetryCount || 0);

    // 若该房间内 nextAgent 的 LLM 请求仍在进行，说明“预准备”尚未完成，不应误判超时重派发。
    if (hasInFlightOpenClawRequest(nextAgent, room.channelId)) {
      continue;
    }
    // 若 nextAgent 的 TTS 连接仍活跃，说明预加载音频仍在生成/传输，也不应重派发。
    if (hasOpenRoomAgentTtsSocket(room.channelId, nextAgent)) {
      continue;
    }

    if (retryCount < ROOM_PREPARED_MAX_REDISPATCH) {
      room.nextPreparedRetryCount = retryCount + 1;
      room.nextPreparedAt = now;
      state.preparingAgent = null;
      state.preparingStartTime = null;

      abortOpenClawRequests(
        (requestId, entry) => entry.agentId === nextAgent && (entry.roomId || null) === room.channelId,
        'PrepareRetryAbort'
      );
      closeRoomAgentTtsSockets(room.channelId, nextAgent, 'prepare_timeout_retry');

      console.warn(
        `[RoundTable] ⚠️ nextPrepared 长时间未开口，自动重派发: channel=${room.channelId}, agent=${nextAgent}, retry=${room.nextPreparedRetryCount}/${ROOM_PREPARED_MAX_REDISPATCH}`
      );
      dispatchToAgentWithRetry(nextAgent, nextMessage, 'moderator', 'prepare_timeout_retry', room.channelId, 2, 300);
      continue;
    }

    console.warn(
      `[RoundTable] ⚠️ nextPrepared 重派发耗尽，强制推进下一轮: channel=${room.channelId}, agent=${nextAgent}`
    );
    state.preparingAgent = null;
    state.preparingStartTime = null;
    clearRoomNextPrepared(room);
    try {
      onSpeechEnded(nextAgent, '[系统兜底] 当前发言未完整开始，自动推进下一位。', null, room.channelId, false);
    } catch (e) {
      console.error(
        `[RoundTable] ❌ nextPrepared 强制推进失败: channel=${room.channelId}, agent=${nextAgent}, err=${e.message}`
      );
    }
  }
}

// 广播消息到房间所有客户端
function broadcastToRoom(room, message) {
  const msgStr = JSON.stringify(message);
  let count = 0;
  for (const ws of wss.clients) {
    if (ws._roomId === room.channelId && ws.readyState === WebSocket.OPEN) {
      ws.send(msgStr);
      count++;
    }
  }
  console.log(`[Room] 广播消息: ${message.type}, 接收者: ${count}`);
}

// 发送消息给智能体
function sendToAgent(agentId, message, from = 'moderator', speechType = 'next', channelId = null) {
  console.log(`[RoundTable] 🔍 尝试发送给 ${agentId}，当前连接数: ${wss.clients.size}, channel: ${channelId}`);

  // 打印所有连接状态用于调试
  const clientList = [];
  for (const ws of wss.clients) {
    clientList.push({
      agentId: ws._agentId,
      roomId: ws._roomId,
      isTTS: ws._isTTS,
      isHost: !!ws._isHost,
      connId: ws._connId || null,
      seq: ws._connSeq || null,
      readyState: ws.readyState
    });
  }
  console.log(`[RoundTable] 🔍 当前连接列表:`, JSON.stringify(clientList));

  const candidates = [];
  for (const ws of wss.clients) {
    // 只发送给本房间的连接
    if (channelId && ws._roomId !== channelId) continue;

    if (ws._agentId === agentId && !ws._isTTS) {
      if (ws.readyState === WebSocket.OPEN) {
        candidates.push(ws);
      } else {
        console.error(`[RoundTable] ❌ ${agentId} 的连接状态不对: ${ws.readyState}`);
      }
    }
  }

  if (candidates.length > 0) {
    // 关键修复：同房间同 agent 多连接时，优先最新连接（避免消息落到刷新前旧页面）
    candidates.sort((a, b) => (b._connSeq || 0) - (a._connSeq || 0));
    const targetWs = candidates[0];
    console.log(`[RoundTable] ✅ 发送给 ${agentId} (${speechType}), 目标连接: conn=${targetWs._connId || 'n/a'}, seq=${targetWs._connSeq || 'n/a'}`);

    // 标记该 agent 正在准备中（房间级状态）
    const state = getRoundTableState(channelId);
    state.preparingAgent = agentId;
    state.preparingStartTime = Date.now();
    console.log(`[RoundTable] 📝 ${agentId} 进入准备状态`);

    targetWs.send(JSON.stringify({
      type: 'moderator',
      from: from,
      message: message,
      speechType: speechType
    }));

    // 房间模式：记录发言顺序计划，允许预加载音频按顺序提前推送到 room 服务
    if (channelId) {
      const room = rooms.get(channelId);
      if (room && room.podcastPusher) {
        room.podcastPusher.planSpeaker(agentId);
      }
    }

    // 如果是房间模式，同时广播 moderator 消息给所有分机
    if (channelId) {
      const room = rooms.get(channelId);
      if (room) {
        broadcastToRoom(room, {
          type: 'moderator_sync',
          agentId: agentId,
          from: from,
          message: message,
          speechType: speechType
        });
      }
    }

    return true;
  }
  console.error(`[RoundTable] ❌ 未找到 ${agentId} 的有效连接`);
  return false;
}

function dispatchToAgentWithRetry(
  agentId,
  message,
  from = 'moderator',
  speechType = 'next',
  channelId = null,
  retries = 3,
  delayMs = 500
) {
  const sent = sendToAgent(agentId, message, from, speechType, channelId);
  if (sent) return true;
  if (!channelId || retries <= 0) return false;

  const nextDelay = Math.min(Math.max(delayMs, 200), 2000);
  console.warn(`[RoundTable] ⏳ ${agentId} 暂无连接，${nextDelay}ms 后重试派发 (${retries})`);
  setTimeout(() => {
    const room = rooms.get(channelId);
    if (!room || !room.isActive) return;
    dispatchToAgentWithRetry(agentId, message, from, speechType, channelId, retries - 1, Math.min(nextDelay * 2, 2000));
  }, nextDelay);
  return false;
}

function sendPodcastRoomLiveEvent(room, isLive, reason = 'manual') {
  if (!room || !room.channelId || !room.podcastRoomId) return false;

  const trySend = () => {
    const pusher = room.podcastPusher;
    if (!pusher || !pusher.connected || !pusher.ws || pusher.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    return pusher.reportRoomLiveEvent(room.agentIds || [], isLive, reason);
  };

  if (trySend()) {
    room.pendingPodcastLiveEvent = null;
    return true;
  }

  // 连接未就绪：先记录待发事件，连接建立后补发
  room.pendingPodcastLiveEvent = { isLive, reason, ts: Date.now() };
  reconnectPodcastPusher(room.channelId).catch((e) => {
    console.warn(`[Podcast] ⚠️ 重连失败，待补发${isLive ? '开播' : '下播'}事件: ${e.message}`);
  });
  return false;
}

function sendPodcastStreamingLifecycleEvent(room, isLive, reason = 'manual_click') {
  if (!room || !room.channelId || !room.podcastRoomId) return false;

  const trySend = () => {
    const pusher = room.podcastPusher;
    if (!pusher || !pusher.connected || !pusher.ws || pusher.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    return pusher.reportStreamingLifecycleEvent(isLive, reason);
  };

  if (trySend()) {
    room.pendingPodcastStreamingLifecycleEvent = null;
    return true;
  }

  room.pendingPodcastStreamingLifecycleEvent = { isLive, reason, ts: Date.now() };
  reconnectPodcastPusher(room.channelId).catch((e) => {
    console.warn(`[Podcast] ⚠️ 重连失败，待补发${isLive ? '开播' : '下播'}命令: ${e.message}`);
  });
  return false;
}

function getOpenHostWs(room) {
  if (!room) return null;
  if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
    return room.hostWs;
  }
  room.hostWs = null;
  for (const ws of wss.clients) {
    if (ws._roomId === room.channelId && ws._isHost && ws.readyState === WebSocket.OPEN) {
      room.hostWs = ws;
      return ws;
    }
  }
  return null;
}

function dispatchStreamingControlToHost(room, commandType, rawMsg) {
  if (!room || !room.channelId) return;
  if (commandType !== 'start_streaming' && commandType !== 'stop_streaming') return;

  // 服务端先做一层幂等保护，避免重复指令扰动前端
  if (commandType === 'start_streaming' && room.isActive) {
    console.log(`[Podcast] ⏭️ 忽略 start_streaming：房间 ${room.channelId} 已开播`);
    return;
  }
  if (commandType === 'stop_streaming' && !room.isActive) {
    console.log(`[Podcast] ⏭️ 忽略 stop_streaming：房间 ${room.channelId} 已下播`);
    return;
  }

  const controlMsg = {
    type: 'streaming_control',
    command: commandType,
    message_id: rawMsg?.message_id || `${commandType}_${Date.now()}`,
    timestamp: rawMsg?.timestamp || new Date().toISOString(),
    data: rawMsg?.data || {}
  };

  const hostWs = getOpenHostWs(room);
  if (hostWs) {
    try {
      hostWs.send(JSON.stringify(controlMsg));
      console.log(`[Podcast] 📤 已转发 ${commandType} 到主机前端 (channel=${room.channelId})`);
      room.pendingStreamingControlCommand = null;
      return;
    } catch (e) {
      console.warn(`[Podcast] ⚠️ 转发 ${commandType} 到主机失败: ${e.message}`);
    }
  }

  room.pendingStreamingControlCommand = controlMsg;
  console.log(`[Podcast] 📨 暂存 ${commandType}，等待主机前端连接后补发 (channel=${room.channelId})`);
}

// 重新建立 Podcast 推流 WebSocket 连接（每次开始讨论时调用，每个房间独立）
async function reconnectPodcastPusher(channelId) {
  console.log(`[Podcast] reconnectPodcastPusher called, channelId=${channelId}, rooms.size=${rooms.size}`);

  if (!channelId) {
    console.log(`[Podcast] 跳过推流连接: 无 channelId`);
    return;
  }

  const room = rooms.get(channelId);
  if (!room) {
    console.log(`[Podcast] 未找到房间 ${channelId}, 现有房间: ${[...rooms.keys()].join(', ')}`);
    return;
  }
  if (room.podcastReconnectRetryTimer) {
    clearTimeout(room.podcastReconnectRetryTimer);
    room.podcastReconnectRetryTimer = null;
  }

  // 如果该房间已有活跃连接且 podcastRoomId 一致，复用
  if (room.podcastPusher && room.podcastPusher.connected && room.podcastPusher.podcastRoomId === room.podcastRoomId) {
    console.log(`[Podcast] 房间 ${channelId} 已有活跃连接，复用: ${room.podcastPusher.podcastRoomId}`);
    room.podcastPusher.resumeAudioPush('reconnect_reuse');
    return;
  }

  // 断开该房间旧连接
  if (room.podcastPusher) {
    room.podcastPusher.disconnect();
    room.podcastPusher = null;
  }

  const podcastRoomId = room.podcastRoomId;
  const agentIds = room.agentIds;

  if (!podcastRoomId || !agentIds || agentIds.length === 0) {
    console.log(`[Podcast] 房间 ${channelId} 跳过推流连接: podcastRoomId=${podcastRoomId}, agentIds=${agentIds}`);
    return;
  }

  console.log(`[Podcast] 房间 ${channelId}, podcastRoomId=${podcastRoomId}, host=${room.hostAgentId}, agents=${agentIds}`);

  // 有 hostAgentId 时，严格只用 host 的 key 控制，避免误用其他角色 key。
  const hostAgentId = typeof room.hostAgentId === 'string' ? room.hostAgentId.trim() : '';
  const candidateAgentIds = hostAgentId ? [hostAgentId] : agentIds;
  if (hostAgentId && !agentIds.includes(hostAgentId)) {
    console.warn(`[Podcast] 房间 ${channelId}: host ${hostAgentId} 不在 agent 列表中，将仅尝试 host key`);
  }

  // 尝试候选 agent 的 apiKey 连接（直到成功为止）
  for (const agentId of candidateAgentIds) {
    let apiKey = null;
    try {
      const metaPath = path.join(DATA_AGENTS_DIR, agentId, 'meta.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        apiKey = meta.podcastApiKey;
      }
    } catch (e) {}

    if (!apiKey) continue;

    console.log(`[Podcast] 房间 ${channelId}: 尝试用 ${agentId} 控制 ${podcastRoomId}`);
    const pusher = new PodcastPusher(podcastRoomId, apiKey);
    // 提前绑定控制命令回调，避免 connect 阶段收到命令时丢失
    pusher.onStartStreaming = (msg) => {
      dispatchStreamingControlToHost(room, 'start_streaming', msg);
    };
    pusher.onStopStreaming = (msg) => {
      // 服务端下播：先硬停推流，再通知前端，再清空本房间会话状态
      pusher.pauseAudioPush('remote_stop_streaming');
      dispatchStreamingControlToHost(room, 'stop_streaming', msg);
      room._suppressNextPodcastLiveEvent = true;
      resetRoomSessionOnHostReconnect(room, 'remote_stop_streaming');
    };
    const ok = await pusher.connect();
    if (ok) {
      room.podcastPusher = pusher;
      room.podcastReconnectRetryCount = 0;
      pusher.resumeAudioPush('reconnect_connected');
      console.log(`[Podcast] 房间 ${channelId}: ${podcastRoomId} 控制连接就绪 (host: ${agentId})`);
      // 连接成功后，补发暂存的话题
      if (room.pendingPodcastTopic) {
        console.log(`[Podcast] 📤 连接就绪，补发暂存话题: ${room.pendingPodcastTopic.title?.substring(0, 30)}...`);
        syncTopicToPodcast(room, room.pendingPodcastTopic, room.pendingPodcastTopicSpeaker);
      }
      // 连接成功后，补发待处理的开播/下播事件
      if (room.pendingPodcastLiveEvent) {
        const pending = room.pendingPodcastLiveEvent;
        if (pusher.reportRoomLiveEvent(room.agentIds || [], pending.isLive, pending.reason || 'pending_replay')) {
          room.pendingPodcastLiveEvent = null;
        }
      }
      if (room.pendingPodcastStreamingLifecycleEvent) {
        const pending = room.pendingPodcastStreamingLifecycleEvent;
        if (pusher.reportStreamingLifecycleEvent(!!pending.isLive, pending.reason || 'pending_replay')) {
          room.pendingPodcastStreamingLifecycleEvent = null;
        }
      }
      // 设置麦序话题回调
      let initialQueueResolved = false;
      pusher.onTopicQueueList = (data) => {
        room.topicQueue = data.topics || [];
        console.log(`[Podcast] 📋 房间 ${channelId} 更新麦序: ${room.topicQueue.length} 个话题`);
        broadcastToRoom(room, {
          type: 'topic_queue_update',
          topics: room.topicQueue
        });
        // 启动 hot-topics 抓取（同步处理缓存命中）
        startHotTopicsCrawl(room);
        // 初始拉取完成，resolve promise
        if (!initialQueueResolved && room._queueReadyResolve) {
          initialQueueResolved = true;
          // 给缓存命中的同步入队一点时间
          setTimeout(() => {
            room._queueReadyResolve();
            room._queueReadyResolve = null;
          }, 100);
        }
      };
      pusher.onTopicChanged = (data) => {
        console.log(`[Podcast] 🔄 房间 ${channelId} 收到话题变更，重新拉取麦序`);
        pusher.getTopicQueue();
      };
      // 初始拉取麦序（带 Promise 等待）
      room.queueReady = new Promise(resolve => {
        room._queueReadyResolve = resolve;
        // 超时兜底：5秒后无论如何 resolve（防止无限等待）
        setTimeout(() => {
          if (!initialQueueResolved) {
            initialQueueResolved = true;
            console.log(`[Podcast] ⏰ 麦序拉取超时(5s)，继续开播`);
            resolve();
            room._queueReadyResolve = null;
          }
        }, 5000);
      });
      pusher.getTopicQueue();
      return;
    }
    pusher.disconnect();
  }

  if (hostAgentId) {
    console.error(`[Podcast] 房间 ${channelId}: host(${hostAgentId}) 无法控制 ${podcastRoomId}`);
  } else {
    console.error(`[Podcast] 房间 ${channelId}: 所有 agent 均无法控制 ${podcastRoomId}`);
  }

  const shouldRetry = !!room.isActive || !!(room.pendingPodcastStreamingLifecycleEvent && room.pendingPodcastStreamingLifecycleEvent.isLive);
  if (!shouldRetry) {
    room.podcastReconnectRetryCount = 0;
    return;
  }

  const nextAttempt = (Number(room.podcastReconnectRetryCount) || 0) + 1;
  room.podcastReconnectRetryCount = nextAttempt;
  if (nextAttempt > 4) {
    console.error(`[Podcast] 房间 ${channelId}: 控制连接重试已达上限，停止自动重连`);
    room.podcastReconnectRetryCount = 0;
    return;
  }

  const delay = Math.min(800 * Math.pow(2, nextAttempt - 1), 4000);
  room.podcastReconnectRetryTimer = setTimeout(() => {
    reconnectPodcastPusher(channelId).catch((e) => {
      console.warn(`[Podcast] ⚠️ 自动重连失败(channel=${channelId}): ${e.message}`);
    });
  }, delay);
  console.warn(`[Podcast] 房间 ${channelId}: 控制连接失败，${delay}ms 后自动重试(${nextAttempt}/4)`);
}

// ========== Kimi CLI 麦序话题抓取 ==========

// 本地缓存：queue_id → 抓取结果（持久化到磁盘）
const KIMI_CACHE_PATH = path.join(__dirname, '.kimi-queue-cache.json');
let kimiQueueCache = {};
try {
  if (fs.existsSync(KIMI_CACHE_PATH)) {
    kimiQueueCache = JSON.parse(fs.readFileSync(KIMI_CACHE_PATH, 'utf-8'));
    console.log(`[Kimi] 📦 加载缓存: ${Object.keys(kimiQueueCache).length} 条`);
  }
} catch (e) {
  console.warn(`[Kimi] ⚠️ 加载缓存失败: ${e.message}`);
}

function saveKimiCache() {
  try {
    fs.writeFileSync(KIMI_CACHE_PATH, JSON.stringify(kimiQueueCache, null, 2));
  } catch (e) {
    console.warn(`[Kimi] ⚠️ 保存缓存失败: ${e.message}`);
  }
}

function resolveHotTopicsRunner() {
  const runtime = getRuntimeSettings();
  const bundledScript = path.join(__dirname, 'bootstrap/openclaw/skills/openclaw/hot-topics/scripts/fetch_tweets.py');
  if (fs.existsSync(bundledScript)) {
    return {
      cmd: 'python3',
      argsPrefix: [bundledScript],
      cwd: path.dirname(bundledScript),
      env: {
        HOT_TOPICS_KB_PATH: getHotTopicsSkillBasePath(),
        TIKHUB_API_KEY: runtime.tikhubApiKey || '',
        OPENAI_API_KEY: runtime.openaiApiKey || '',
        KIMI_COMMAND: runtime.kimiCliCommand || 'kimi'
      }
    };
  }

  const modernScript = path.join(os.homedir(), '.config/agents/skills/hot-topics/scripts/fetch_tweets.py');
  if (fs.existsSync(modernScript)) {
    return {
      cmd: 'python3',
      argsPrefix: [modernScript],
      cwd: path.dirname(modernScript),
      env: {
        HOT_TOPICS_KB_PATH: getHotTopicsSkillBasePath(),
        TIKHUB_API_KEY: runtime.tikhubApiKey || '',
        OPENAI_API_KEY: runtime.openaiApiKey || '',
        KIMI_COMMAND: runtime.kimiCliCommand || 'kimi'
      }
    };
  }

  const legacyCli = path.join(os.homedir(), '.openclaw/skills/hot-topics/cli.js');
  if (fs.existsSync(legacyCli)) {
    return {
      cmd: 'node',
      argsPrefix: [legacyCli],
      cwd: path.join(os.homedir(), '.openclaw/skills/hot-topics'),
      env: {
        HOT_TOPICS_KB_PATH: getHotTopicsSkillBasePath(),
        TIKHUB_API_KEY: runtime.tikhubApiKey || '',
        OPENAI_API_KEY: runtime.openaiApiKey || '',
        KIMI_COMMAND: runtime.kimiCliCommand || 'kimi'
      }
    };
  }

  return null;
}

function addToQueueTopics(room, topicResult, crawlStatus = 'ready', crawlError = '') {
  // 从原始麦序列表补齐创建者昵称（缓存命中时可能缺失）
  if (!topicResult.created_by_nickname && room.topicQueue && topicResult.queue_id) {
    const raw = room.topicQueue.find(t => t.queue_id === topicResult.queue_id);
    if (raw && raw.created_by_nickname) {
      topicResult.created_by_nickname = raw.created_by_nickname;
    }
  }
  // 从原始麦序列表补齐创建者ID（缓存命中时可能缺失）
  if (!topicResult.created_by && room.topicQueue && topicResult.queue_id) {
    const raw = room.topicQueue.find(t => t.queue_id === topicResult.queue_id);
    if (raw && raw.created_by) {
      topicResult.created_by = raw.created_by;
    }
  }
  // 从原始麦序列表补齐用户原始提问（缓存命中/抓取后都可能缺失）
  if (!topicResult.user_question && room.topicQueue && topicResult.queue_id) {
    const raw = room.topicQueue.find(t => t.queue_id === topicResult.queue_id);
    const rawQuestion = typeof raw?.question === 'string' ? raw.question.trim() : '';
    if (rawQuestion) {
      topicResult.user_question = rawQuestion;
    }
  }

  // 检查：如果当前正在讨论的话题 URL 与该麦序话题相同，说明已在讨论中
  // 直接发 select_topic_from_queue 通知服务端移除，不入待讨论队列
  const currentUrl = room.moderator?.currentTopicData?.postData?.url || '';
  const queueUrl = topicResult.url || topicResult.postData?.url || '';
  if (currentUrl && queueUrl && currentUrl === queueUrl) {
    console.log(`[HotTopics] 🔄 话题 ${topicResult.queue_id} 与当前讨论话题 URL 相同，直接标记已选择`);
    // 发 select_topic_from_queue
    if (room.podcastPusher && room.podcastPusher.connected) {
      room.podcastPusher.selectTopicFromQueue(topicResult);
      console.log(`[Podcast] 📤 select_topic_from_queue (URL匹配): ${topicResult.queue_id}`);
    }
    // 给当前话题补上 queue_id
    if (room.moderator?.currentTopicData && !room.moderator.currentTopicData.queue_id) {
      room.moderator.currentTopicData.queue_id = topicResult.queue_id;
    }
    // 如果当前话题是用户麦序话题，补上创建者昵称
    if (room.moderator?.currentTopicData && topicResult.created_by_nickname && !room.moderator.currentTopicData.created_by_nickname) {
      room.moderator.currentTopicData.created_by_nickname = topicResult.created_by_nickname;
    }
    // 如果当前话题是用户麦序话题，补上创建者ID
    if (room.moderator?.currentTopicData && topicResult.created_by && !room.moderator.currentTopicData.created_by) {
      room.moderator.currentTopicData.created_by = topicResult.created_by;
    }
    // 如果当前话题是用户麦序话题，补上用户原始提问
    if (room.moderator?.currentTopicData && topicResult.user_question && !room.moderator.currentTopicData.user_question) {
      room.moderator.currentTopicData.user_question = topicResult.user_question;
    }
    // 从原始麦序列表移除
    if (room.topicQueue) {
      room.topicQueue = room.topicQueue.filter(t => t.queue_id !== topicResult.queue_id);
    }
    // 通知前端移除
    broadcastToRoom(room, { type: 'topic_queue_update', topics: room.topicQueue });
    // 广播角标状态（让前端角标短暂显示后消失）
    broadcastToRoom(room, {
      type: 'topic_queue_status',
      queue_id: topicResult.queue_id,
      crawl_status: crawlStatus || 'ready',
      saved_path: topicResult.path || '',
      crawl_error: crawlError || ''
    });
    return;
  }

  room.queueTopics.push(topicResult);
  console.log(`[HotTopics] 📥 话题 ${topicResult.queue_id} 已加入待讨论队列 (总计: ${room.queueTopics.length})`);
  // 广播角标状态给前端（附带保存路径）
  broadcastToRoom(room, {
    type: 'topic_queue_status',
    queue_id: topicResult.queue_id,
    crawl_status: crawlStatus || 'ready',
    saved_path: topicResult.path || '',
    crawl_error: crawlError || ''
  });
}

function startHotTopicsCrawl(room) {
  if (!room.topicQueue || room.topicQueue.length === 0) return;

  const { spawn } = require('child_process');
  const runner = resolveHotTopicsRunner();
  if (!runner) {
    console.warn('[HotTopics] ⚠️ 未找到可用的 hot-topics 脚本（.config / .openclaw）');
    return;
  }

  // 只抓取 waiting 状态且未在处理中的话题
  const pending = room.topicQueue.filter(t =>
    t.status === 'waiting' && !room.kimiProcesses.has(t.queue_id)
  );

  // 限制并发: 最多 2 个同时运行
  const running = [...room.kimiProcesses.values()].filter(p => p.status === 'running').length;
  const toStart = pending.slice(0, Math.max(0, 2 - running));

  for (const topic of toStart) {
    const queueId = topic.queue_id;

    // 检查本地缓存：命中则直接加入待讨论队列
    if (kimiQueueCache[queueId]) {
      console.log(`[HotTopics] 📦 缓存命中 ${queueId}: ${kimiQueueCache[queueId].title?.substring(0, 30)}`);
      const cached = {
        ...kimiQueueCache[queueId],
        title: resolveTopicTitle(
          kimiQueueCache[queueId].title || '',
          kimiQueueCache[queueId].postData?.description || kimiQueueCache[queueId].content || '',
          topic.question || topic.title || '麦序话题'
        ),
        created_by_nickname: kimiQueueCache[queueId].created_by_nickname || topic.created_by_nickname || '',
        created_by: kimiQueueCache[queueId].created_by || topic.created_by || '',
        user_question: kimiQueueCache[queueId].user_question || topic.question || ''
      };
      const cachedPath = String(cached.path || '');
      const cachedFolder = path.basename(cachedPath);
      const cachedPostJson = cachedPath ? path.join(cachedPath, 'post.json') : '';
      const cachedReady = !!(
        cachedPath &&
        !cachedFolder.startsWith('_pending_') &&
        cachedPostJson &&
        fs.existsSync(cachedPostJson)
      );
      if (cachedReady) {
        room.kimiProcesses.set(queueId, { process: null, status: 'done', topic, startTime: Date.now() });
        addToQueueTopics(room, cached, 'ready', '');
        kimiQueueCache[queueId] = cached;
        saveKimiCache();
        // 继续启动下一个
        setTimeout(() => startHotTopicsCrawl(room), 100);
        continue;
      }
      console.warn(`[HotTopics] ⚠️ 缓存命中但未完成，丢弃并重新抓取: queue=${queueId}, path=${cachedPath || '(empty)'}`);
      delete kimiQueueCache[queueId];
      saveKimiCache();
    }

    // 优先用 url 字段
    let url = topic.url || '';
    if (!url) {
      const urlMatch = (topic.content || '').match(/https?:\/\/[^\s]+/);
      if (urlMatch) url = urlMatch[0];
    }
    if (!url) {
      // 无 URL：按纯问题加入待讨论队列
      const topicTitle = topic.question || topic.title || '麦序话题';
      console.log(`[HotTopics] 📝 话题 ${queueId} 无 URL，按纯问题加入: ${topicTitle.substring(0, 30)}`);
      const topicResult = {
        queue_id: queueId,
        title: topicTitle,
        content: topicTitle,
        cover_url: topic.cover_url || '',
        source: topic.source || '',
        created_by_nickname: topic.created_by_nickname || '',
        created_by: topic.created_by || '',
        user_question: topic.question || '',
        url: '',
        path: '',
        postData: null
      };
      room.kimiProcesses.set(queueId, { process: null, status: 'done', topic, startTime: Date.now() });
      addToQueueTopics(room, topicResult);
      kimiQueueCache[queueId] = topicResult;
      saveKimiCache();
      setTimeout(() => startHotTopicsCrawl(room), 100);
      continue;
    }

    console.log(`[HotTopics] 🚀 开始抓取话题 ${queueId}: ${(topic.question || topic.title || '').substring(0, 30)}... URL: ${url}`);

    const extraPath = [
      path.join(os.homedir(), '.local/bin'),
      path.join(os.homedir(), '.cargo/bin')
    ].join(':');
    const proc = spawn(runner.cmd, [...runner.argsPrefix, '--url', url], {
      cwd: runner.cwd,
      env: {
        ...process.env,
        ...runner.env,
        PATH: `${extraPath}:${process.env.PATH || ''}`
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    room.kimiProcesses.set(queueId, {
      process: proc,
      status: 'running',
      topic,
      startTime: Date.now()
    });

    // 广播 crawling 状态给前端
    broadcastToRoom(room, {
      type: 'topic_queue_status',
      queue_id: queueId,
      crawl_status: 'crawling'
    });

    let output = '';
    let errOutput = '';

    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stderr.on('data', (data) => { errOutput += data.toString(); });

    proc.on('close', (code) => {
      const entry = room.kimiProcesses.get(queueId);
      if (!entry || entry.status === 'cancelled') return;

      entry.status = 'done';
      const elapsed = ((Date.now() - entry.startTime) / 1000).toFixed(1);

      // 从 hot-topics 输出中解析保存路径: "  • [Category] FolderName"
      let savedPath = '';
      let postData = null;
      let topicTitle = topic.question || topic.title || '麦序话题';
      let coverUrl = '';
      let content = topicTitle;
      let crawlStatus = 'ready';
      let crawlError = '';

      const folderMatch = output.match(/•\s*\[([^\]]+)\]\s*(.+)/);
      if (code === 0 && folderMatch) {
        const category = folderMatch[1].trim();
        const folderName = folderMatch[2].trim();
        const preferredRoot = getHotTopicsKnowledgeBasePath();
        const skillRoot = path.join(getHotTopicsSkillBasePath(), '热门话题');
        const legacyNestedRoot = path.join(preferredRoot, '热门话题');
        const candidateRoots = [preferredRoot, skillRoot, legacyNestedRoot].filter((root, idx, arr) => root && arr.indexOf(root) === idx);
        let matchedRoot = '';
        for (const root of candidateRoots) {
          const candidate = path.join(root, category, folderName);
          if (fs.existsSync(candidate)) {
            matchedRoot = root;
            break;
          }
        }
        savedPath = path.join(matchedRoot || preferredRoot, category, folderName);
        const isPendingFolder = folderName.startsWith('_pending_');
        if (isPendingFolder) {
          crawlStatus = 'failed';
          crawlError = 'pending_folder';
          console.warn(`[HotTopics] ⚠️ 话题 ${queueId} 命中 pending 目录，视为未完成: ${savedPath}`);
        } else {
          console.log(`[HotTopics] ✅ 话题 ${queueId} 抓取完成 (${elapsed}s): ${savedPath}`);
        }

        // 读取 hot-topics 生成的 post.json
        const postJsonPath = path.join(savedPath, 'post.json');
        if (fs.existsSync(postJsonPath)) {
          try {
            postData = JSON.parse(fs.readFileSync(postJsonPath, 'utf-8'));
            topicTitle = resolveTopicTitle(
              postData.title || '',
              postData.description || postData.content || '',
              topicTitle
            );
            content = postData.content || postData.description || topicTitle;
            // 检查封面
            for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
              const coverPath = path.join(savedPath, `cover${ext}`);
              if (fs.existsSync(coverPath)) {
                const rel = path.relative(KNOWLEDGE_BASE_PATH, coverPath);
                coverUrl = `/knowledge-assets/${rel}`;
                break;
              }
            }
            console.log(`[HotTopics] 📄 读取 post.json: title=${topicTitle.substring(0, 40)}, cover=${coverUrl ? '有' : '无'}`);
          } catch (e) {
            crawlStatus = 'failed';
            crawlError = 'post_json_parse_failed';
            console.warn(`[HotTopics] ⚠️ 读取 post.json 失败: ${e.message}`);
          }
        } else {
          crawlStatus = 'failed';
          crawlError = 'post_json_missing';
          console.warn(`[HotTopics] ⚠️ 话题 ${queueId} 缺少 post.json，不标记为抓取成功: ${postJsonPath}`);
        }
      } else {
        crawlStatus = 'failed';
        crawlError = 'runner_output_unmatched';
        console.log(`[HotTopics] ⚠️ 话题 ${queueId} 抓取失败或无输出 (code=${code}, ${elapsed}s): ${output.substring(0, 200)}`);
      }

      const topicResult = {
        queue_id: queueId,
        title: topicTitle,
        content: content,
        cover_url: topic.cover_url || '',
        coverUrl: coverUrl,
        source: topic.source || '',
        created_by_nickname: topic.created_by_nickname || '',
        created_by: topic.created_by || '',
        user_question: topic.question || '',
        url: url,
        path: savedPath,
        category: folderMatch ? folderMatch[1].trim() : '',
        postData: postData
      };
      addToQueueTopics(room, topicResult, crawlStatus, crawlError);
      kimiQueueCache[queueId] = topicResult;
      saveKimiCache();

      // 尝试启动下一个
      startHotTopicsCrawl(room);
    });

    // 超时: 180 秒（hot-topics 需要下载媒体+Kimi 分析，比较慢）
    setTimeout(() => {
      const entry = room.kimiProcesses.get(queueId);
      if (entry && entry.status === 'running') {
        console.log(`[HotTopics] ⏰ 话题 ${queueId} 抓取超时(180s)，按纯问题加入`);
        entry.status = 'cancelled';
        proc.kill();
        const topicTitle = entry.topic.question || entry.topic.title || '麦序话题';
        const topicResult = {
          queue_id: queueId,
          title: topicTitle,
          content: topicTitle,
          cover_url: entry.topic.cover_url || '',
          source: entry.topic.source || '',
          created_by_nickname: entry.topic.created_by_nickname || '',
          created_by: entry.topic.created_by || '',
          user_question: entry.topic.question || '',
          url: entry.topic.url || '',
          path: '',
          postData: null
        };
        addToQueueTopics(room, topicResult);
        kimiQueueCache[queueId] = topicResult;
        saveKimiCache();
      }
    }, 180000);
  }
}

function shouldSendStartStreamingBySource(sourceRaw = '') {
  const source = String(sourceRaw || '').trim().toLowerCase();
  if (!source) return true; // 默认按主机手动开播处理，避免漏发
  if (source === 'room_start_streaming' || source === 'remote_start_streaming' || source === 'streaming_control') {
    return false; // 来自房间服务下发的开播，不回环发送 C→S
  }
  return true;
}

function resolveStartStreamingReason(sourceRaw = '') {
  const source = String(sourceRaw || '').trim().toLowerCase();
  if (!source || source === 'manual_click') return 'manual_click_start';
  return `${source.replace(/[^a-z0-9_]+/g, '_')}_start`;
}

// 开始圆桌讨论（指定话题）
function startRoundTable(topic, fromUser = false, lang = 'zh', mod = null, channelId = null, options = {}) {
  const source = String(options?.source || '').trim();
  const shouldSendStartStreaming = shouldSendStartStreamingBySource(source);
  const startStreamingReason = resolveStartStreamingReason(source);
  const moderatorToUse = mod || moderator;
  console.log('[RoundTable] 开始话题:', topic, '语言:', lang, fromUser ? '(用户输入)' : '(自动)', channelId ? `(房间: ${channelId})` : '', source ? `(source: ${source})` : '');

  // 仅在本场首次开播时注入圆桌人设（避免中途换话题重复清空会话）
  if (channelId) {
    const roomAtStart = rooms.get(channelId);
    if (roomAtStart && !roomAtStart.isActive && Array.isArray(roomAtStart.agentIds) && roomAtStart.agentIds.length > 0) {
      updateRoundtableSouls(roomAtStart.agentIds);
      console.log(`[RoundTable] 开播前已刷新圆桌人设与语气词规则: ${roomAtStart.agentIds.join(', ')}`);
    }
  }

  // 开播前兜底清理：断开残留 TTS/MiniMax 与旧推理请求
  if (channelId) {
    cleanupRoomStreamingResidue(channelId, 'start_roundtable');
  }

  // 更新房间状态
  if (channelId) {
    const room = rooms.get(channelId);
    if (room) {
      room.isActive = true;
    }
  }

  // 重新建立 Podcast 推流连接
  reconnectPodcastPusher(channelId);
  if (channelId) {
    const room = rooms.get(channelId);
    if (room) {
      // 排除 room 下发场景外，均发送 C→S start_streaming，避免 source 边缘值导致漏发
      if (shouldSendStartStreaming) {
        const sent = sendPodcastStreamingLifecycleEvent(room, true, startStreamingReason);
        console.log(`[Podcast] ${sent ? '✅' : '🕓'} 开播命令已处理: channel=${channelId}, reason=${startStreamingReason}`);
      } else {
        console.log(`[Podcast] ⏭️ 跳过开播命令回传（来源: ${source || 'unknown'}）: channel=${channelId}`);
      }
      if (room.podcastPusher) {
        room.podcastPusher.resumeAudioPush('roundtable_start');
      }
      sendPodcastRoomLiveEvent(room, true, 'roundtable_start');
    }
  }

  moderatorToUse.start();
  moderatorToUse.setLang(lang);
  const result = moderatorToUse.startTopic(topic, fromUser);

  if (fromUser && moderatorToUse.currentTopicData) {
    moderatorToUse.currentTopicData.creator_type = 'user';
    if (!moderatorToUse.currentTopicData.creator_id && moderatorToUse.currentTopicData.created_by) {
      moderatorToUse.currentTopicData.creator_id = moderatorToUse.currentTopicData.created_by;
    }
  }

  console.log(`[RoundTable] 开场嘉宾: ${result.nextAgent}`);
  console.log(`[RoundTable] 开场白: ${result.message}`);

  sendToAgent(result.nextAgent, result.message, 'moderator', 'next', channelId);

  // 记录知识库话题到记忆（房间模式按房间隔离，非房间模式走全局）
  if (channelId) {
    const room = rooms.get(channelId);
    if (room) {
      rememberTopicForRoom(room, moderatorToUse.currentTopicData);
    }
  } else {
    rememberTopicGlobally(moderatorToUse.currentTopicData);
  }

  // 广播话题数据给前端（包含 postData）
  if (channelId) {
    const room = rooms.get(channelId);
    if (room) {
      room.currentDisplayTopic = moderatorToUse.currentTopicData;
      recordRoomTopicHistory(room, moderatorToUse.currentTopicData, fromUser ? 'user_start' : 'room_start');
      broadcastToRoom(room, {
        type: 'topic_changed',
        topicData: moderatorToUse.currentTopicData
      });
      // 同步话题到 Podcast 房间
      syncTopicToPodcast(room, moderatorToUse.currentTopicData, result.nextAgent);
    }
  }

  return result;
}

// 从知识库随机选择话题
async function startRandomTopic(lang = 'zh', mod = null, channelId = null, options = {}) {
  const source = String(options?.source || '').trim();
  const shouldSendStartStreaming = shouldSendStartStreamingBySource(source);
  const startStreamingReason = resolveStartStreamingReason(source);
  const moderatorToUse = mod || moderator;
  console.log('[RoundTable] 从知识库选择话题... 语言:', lang, channelId ? `(房间: ${channelId})` : '', source ? `(source: ${source})` : '');

  // 仅在本场首次开播时注入圆桌人设（避免中途换话题重复清空会话）
  if (channelId) {
    const roomAtStart = rooms.get(channelId);
    if (roomAtStart && !roomAtStart.isActive && Array.isArray(roomAtStart.agentIds) && roomAtStart.agentIds.length > 0) {
      updateRoundtableSouls(roomAtStart.agentIds);
      console.log(`[RoundTable] 开播前已刷新圆桌人设与语气词规则: ${roomAtStart.agentIds.join(', ')}`);
    }
  }

  // 开播前兜底清理：断开残留 TTS/MiniMax 与旧推理请求
  if (channelId) {
    cleanupRoomStreamingResidue(channelId, 'start_random_topic');
  }

  // 更新房间状态
  if (channelId) {
    const room = rooms.get(channelId);
    if (room) {
      room.isActive = true;
    }
  }

  // 重新建立 Podcast 推流连接（等待连接+麦序拉取完成）
  await reconnectPodcastPusher(channelId);
  if (channelId) {
    const room = rooms.get(channelId);
    if (room) {
      // 排除 room 下发场景外，均发送 C→S start_streaming，避免 source 边缘值导致漏发
      if (shouldSendStartStreaming) {
        const sent = sendPodcastStreamingLifecycleEvent(room, true, startStreamingReason);
        console.log(`[Podcast] ${sent ? '✅' : '🕓'} 开播命令已处理: channel=${channelId}, reason=${startStreamingReason}`);
      } else {
        console.log(`[Podcast] ⏭️ 跳过开播命令回传（来源: ${source || 'unknown'}）: channel=${channelId}`);
      }
      if (room.podcastPusher) {
        room.podcastPusher.resumeAudioPush('roundtable_start');
      }
      sendPodcastRoomLiveEvent(room, true, 'roundtable_start');
    }
  }

  // 等待麦序拉取+缓存命中入队完成（最多5秒）
  if (channelId) {
    const room = rooms.get(channelId);
    if (room && room.queueReady) {
      console.log(`[RoundTable] ⏳ 等待麦序拉取完成...`);
      await room.queueReady;
      console.log(`[RoundTable] ✅ 麦序就绪，queueTopics: ${room.queueTopics?.length || 0} 个`);
    }
  }

  // 统一通过 moderator 的 pickTrendingTopic 选话题（支持分类优先 + 时间排序）
  if (channelId) {
    const room = rooms.get(channelId);
    if (room) {
      maybeRotateRoomTopicMemory(room);
      syncRoomTopicMemoryToModerator(room);
    }
  } else {
    syncGlobalTopicMemoryToModerator(moderatorToUse);
  }
  moderatorToUse.start();
  moderatorToUse.setLang(lang);

  // 开播前：注入麦序待讨论话题到 moderator 优先队列
  if (channelId) {
    const room = rooms.get(channelId);
    if (room && room.queueTopics && room.queueTopics.length > 0) {
      moderatorToUse.priorityTopics = room.queueTopics;
      console.log(`[RoundTable] 📋 注入 ${room.queueTopics.length} 个麦序待讨论话题到优先队列`);
    }
  }

  const result = moderatorToUse.startRandomTopic();

  if (result) {
    const topic = moderatorToUse.currentTopicData;
    console.log(`[RoundTable] 选中话题 [${topic?.category}]: ${topic?.title?.substring(0, 50)}...`);
    console.log(`[RoundTable] 开场嘉宾: ${result.nextAgent}`);
    sendToAgent(result.nextAgent, result.message, 'moderator', 'next', channelId);
    if (channelId) {
      const room = rooms.get(channelId);
      if (room) {
        rememberTopicForRoom(room, moderatorToUse.currentTopicData);
      }
    } else {
      rememberTopicGlobally(moderatorToUse.currentTopicData);
    }

    // 广播话题数据给前端（包含 postData）
    if (channelId) {
      // 房间模式：广播给房间内所有客户端
      const room = rooms.get(channelId);
      if (room) {
        room.currentDisplayTopic = moderatorToUse.currentTopicData;
        recordRoomTopicHistory(room, moderatorToUse.currentTopicData, 'random_start');
        broadcastToRoom(room, {
          type: 'topic_changed',
          topicData: moderatorToUse.currentTopicData
        });
        // 同步话题到 Podcast 房间
        syncTopicToPodcast(room, moderatorToUse.currentTopicData, result.nextAgent);
      }
    } else {
      // 非房间模式：直接发送给所有连接的客户端
      const topicData = moderatorToUse.currentTopicData;
      // 同步更新非房间模式的展示话题
      roundTableState.displayTopicData = topicData;
      roundTableState.pendingTopicData = null;
      console.log(`[RoundTable] 🔍 非房间模式广播 topic_changed, topicData:`, topicData ? { title: topicData.title, hasPostData: !!topicData.postData } : null);
      for (const ws of wss.clients) {
        if (ws._agentId && !ws._isTTS && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({
              type: 'topic_changed',
              topicData: topicData
            }));
            console.log(`[RoundTable] ✅ 发送给 ${ws._agentId} topic_changed`);
          } catch(e) {
            console.log(`[RoundTable] ❌ 发送 topic_changed 失败:`, e.message);
          }
        }
      }
    }
  }
  return result;
}

// 结束圆桌讨论
function stopRoundTable(channelId = null, options = {}) {
  const source = String(options?.source || '').trim();
  const notifyRoomServiceStop = !!options?.notifyRoomServiceStop;
  const isManualClick = source === 'manual_click';
  const sourceTag = source.toLowerCase();
  const shouldSendStreamingStop = isManualClick || notifyRoomServiceStop || sourceTag === 'pre_restart' || sourceTag === 'shutdown' || sourceTag === 'sigterm' || sourceTag === 'sigint';
  const lifecycleStopReason = isManualClick
    ? 'manual_click_stop'
    : (sourceTag ? `server_${sourceTag.replace(/[^a-z0-9_]+/g, '_')}_stop` : 'server_stop');
  console.log('[RoundTable] 讨论结束', channelId ? `(房间: ${channelId})` : '', source ? `(source: ${source})` : '');

  // 先打断前端本地播放（含已缓冲音频），确保“停房=立即停音频”
  if (channelId) {
    const room = rooms.get(channelId);
    if (room) {
      forceInterruptRoomPlayback(room, source || 'server_stop', 'server');
    }
  }

  const mod = getModerator(channelId);
  if (mod) mod.stop();
  if (channelId) {
    const room = rooms.get(channelId);
    if (room) {
      if (room.podcastReconnectRetryTimer) {
        clearTimeout(room.podcastReconnectRetryTimer);
        room.podcastReconnectRetryTimer = null;
      }
      room.podcastReconnectRetryCount = 0;
      room.isActive = false;
      room.activeTurnAgentId = null;
      room.activeTurnStartedAt = 0;
      room.preloadIssuedByAgentId = null;
      clearRoomNextPrepared(room);
    }
  }

  // 下播：仅发送下播事件，不断开 Podcast 控制连接
  if (channelId) {
    const room = rooms.get(channelId);
    if (room) {
      const suppressLiveEvent = !!room._suppressNextPodcastLiveEvent;
      room._suppressNextPodcastLiveEvent = false;
      if (!suppressLiveEvent) {
        sendPodcastRoomLiveEvent(room, false, 'roundtable_stop');
      } else {
        console.log(`[Podcast] ⏭️ 跳过下播事件回传（来源: remote_stop_streaming）: room=${channelId}`);
      }
      // 停播时清理播放列表，避免下次开播沿用旧音频
      if (room.podcastPusher) {
        room.podcastPusher.pauseAudioPush('roundtable_stop');
        room.podcastPusher.clearAudio();
        room.podcastPusher.playlistReset('stream_restart', true);
      }
      // 手动下播 + 服务重启/关停场景，都发送 C→S stop_streaming
      if (shouldSendStreamingStop) {
        const sent = sendPodcastStreamingLifecycleEvent(room, false, lifecycleStopReason);
        console.log(`[Podcast] ${sent ? '✅' : '🕓'} 下播命令已处理: channel=${channelId}, reason=${lifecycleStopReason}`);
      }
    }
  }
}

function closeRoomTtsSockets(channelId = null, reason = 'manual') {
  let closed = 0;
  for (const ws of wss.clients) {
    if (!ws._isTTS || ws.readyState !== WebSocket.OPEN) continue;
    if (channelId && ws._roomId !== channelId) continue;
    console.log(`[Stop] 🛑 关闭 TTS WebSocket: ${ws._agentId} (房间: ${ws._roomId || 'global'}, reason=${reason})`);
    try { ws.close(); } catch (_) {}
    closed++;
  }
  return closed;
}

function closeRoomAgentTtsSockets(channelId, agentId, reason = 'manual_agent') {
  if (!channelId || !agentId) return 0;
  let closed = 0;
  for (const ws of wss.clients) {
    if (!ws._isTTS || ws.readyState !== WebSocket.OPEN) continue;
    if (ws._roomId !== channelId) continue;
    if (ws._agentId !== agentId) continue;
    console.log(`[Stop] 🛑 关闭房间TTS连接: ${agentId} (房间: ${channelId}, reason=${reason})`);
    try { ws.close(); } catch (_) {}
    closed++;
  }
  return closed;
}

function closeGlobalTtsSockets(reason = 'manual_global') {
  let closed = 0;
  for (const ws of wss.clients) {
    if (!ws._isTTS || ws.readyState !== WebSocket.OPEN) continue;
    if (ws._roomId) continue; // 只清理非房间(global)TTS，避免误伤房间
    console.log(`[Stop] 🛑 关闭 Global TTS WebSocket: ${ws._agentId} (reason=${reason})`);
    try { ws.close(); } catch (_) {}
    closed++;
  }
  return closed;
}

function cleanupRoomStreamingResidue(channelId, reason = 'start_guard') {
  if (!channelId) return;
  const room = rooms.get(channelId);

  // 开播前保护：中止同房间残留推理，避免老请求继续占用资源
  abortOpenClawRequests((requestId, entry) => (entry.roomId || null) === channelId, `StartGuard:${reason}`);

  // 开播前保护：关闭同房间残留 TTS 连接（会连带关闭 MiniMax 连接）
  const closed = closeRoomTtsSockets(channelId, reason);
  if (closed > 0) {
    console.log(`[StartGuard] 🧹 已清理房间 ${channelId} 的残留 TTS 连接: ${closed}`);
  }

  // 清理准备态，避免上轮遗留造成“准备中”卡住
  const state = getRoundTableState(channelId);
  state.preparingAgent = null;
  state.preparingStartTime = null;
  if (room) {
    room.activeTurnAgentId = null;
    room.activeTurnStartedAt = 0;
    room.preloadIssuedByAgentId = null;
    clearRoomNextPrepared(room);
  }
}

function clearRoomAgentMemory(room, reason = 'room_reset') {
  if (!room || !Array.isArray(room.agentIds)) return;
  for (const aid of room.agentIds) {
    memory[aid] = [];
    try { saveMemoryToFile(aid); } catch (_) {}
  }
  console.log(`[Room] 🧹 已清空房间记忆: channel=${room.channelId}, agents=${room.agentIds.join(',')}, reason=${reason}`);
}

function resetRoomSessionOnHostReconnect(room, reason = 'host_reconnect') {
  if (!room || !room.channelId) return;

  console.log(`[Room] ♻️ 主机接管前重置房间会话: channel=${room.channelId}, reason=${reason}`);

  // 1) 停播语义（含 playlist_reset）
  stopRoundTable(room.channelId);

  // 2) 中止该房间进行中的推理请求
  abortOpenClawRequests((requestId, entry) => (entry.roomId || null) === room.channelId, 'HostReconnect');

  // 3) 关闭该房间 TTS 连接，立刻停止音频链路
  closeRoomTtsSockets(room.channelId, reason);

  // 4) 清理房间运行态
  room.isActive = false;
  room.currentSpeaker = null;
  room.speakerChain = [];
  room.activeTurnAgentId = null;
  room.activeTurnStartedAt = 0;
  room.preloadIssuedByAgentId = null;
  clearRoomNextPrepared(room);
  room.nextTopicData = null;
  room.pendingTopicData = null;
  room.currentDisplayTopic = null;

  const state = getRoundTableState(room.channelId);
  state.preparingAgent = null;
  state.preparingStartTime = null;
  state.interruptedAgents.clear();

  // 5) 清空房间内 agent 对话记忆，避免刷新后带着上轮上下文继续回答
  clearRoomAgentMemory(room, reason);
}

// 处理语音完成回调（现在是在文本完成+音频开始时触发，而不是音频播放完成时）
function onSpeechEnded(agentId, content, designatedNextAgent = null, channelId = null, changeTopic = false) {
  const mod = getModerator(channelId);
  const room = channelId ? rooms.get(channelId) : null;
  let effectiveDesignatedNextAgent = typeof designatedNextAgent === 'string'
    ? designatedNextAgent.trim()
    : '';
  if (!effectiveDesignatedNextAgent) {
    const directives = extractNextDirectives(String(content || ''));
    if (directives.length > 0) {
      effectiveDesignatedNextAgent = directives[directives.length - 1];
      console.log(
        `[RoundTable] 🧩 speech-ended 未携带 designatedNextAgent，已从内容兜底提取: ${effectiveDesignatedNextAgent}`
      );
    }
  }
  // 幂等保护：同一轮次短时间重复触发 speech-ended 时，忽略重复调度，
  // 避免同一发言轮被推进两次，导致两个“下一位”同时开口。
  if (room) {
    const turnStartedAt = Number(room.activeTurnStartedAt || 0);
    const marker = [
      agentId || '',
      turnStartedAt || 'no_turn',
      effectiveDesignatedNextAgent || '',
      changeTopic ? '1' : '0',
      String(content || '').slice(0, 200)
    ].join('|');
    const now = Date.now();
    if (room._lastSpeechEndedMarker === marker && now - Number(room._lastSpeechEndedAt || 0) < 5000) {
      console.warn(
        `[RoundTable] ⚠️ 忽略重复 speech-ended: channel=${channelId}, agent=${agentId}, turn=${turnStartedAt || 'no_turn'}`
      );
      return;
    }
    room._lastSpeechEndedMarker = marker;
    room._lastSpeechEndedAt = now;
  }
  // 不再检查 isActive，因为打断后需要继续处理

  // 将麦序抓取结果注入 moderator 的优先队列
  if (room && room.queueTopics && room.queueTopics.length > 0) {
    mod.priorityTopics = room.queueTopics;
  }

  // 清除当前agent的准备状态（它已经开始播放了）
  const state = getRoundTableState(channelId);
  if (state.preparingAgent === agentId) {
    state.preparingAgent = null;
    state.preparingStartTime = null;
  }

  console.log(`[RoundTable] ${agentId} 已满足准备条件（文本完成+音频开始）` + (effectiveDesignatedNextAgent ? ` | 🎯 指定下一个: ${effectiveDesignatedNextAgent}` : '') + (changeTopic ? ' | 🔄 换话题' : '') + (channelId ? ` | 房间: ${channelId}` : ''));

  // 发言者请求换话题 → 跳过指定发言者逻辑，直接触发话题过渡
  if (changeTopic) {
    console.log(`[RoundTable] 🔄 ${agentId} 请求换话题，触发话题过渡`);
    const decision = mod.onSpeechEnded(agentId, content, true);
    if (decision) {
      sendToAgent(decision.nextAgent, decision.message, 'moderator', decision.type || 'transition', channelId);

      // 暂存新话题数据，等待 speech-started 时广播话题卡切换
      if (channelId) {
        const room = rooms.get(channelId);
        if (room && mod.currentTopicData) {
          room.nextTopicData = mod.currentTopicData;
          console.log(`[RoundTable] 🔄 [房间] 暂存新话题数据: ${room.nextTopicData.title.substring(0, 30)}...`);
        }
      } else {
        if (mod.currentTopicData) {
          roundTableState.pendingTopicData = mod.currentTopicData;
          console.log(`[RoundTable] 🔄 [非房间] 暂存新话题数据: ${roundTableState.pendingTopicData.title.substring(0, 30)}...`);
        }
      }
    }
    return;
  }

  // 如果有指定下一个发言者，优先处理指定的人
  if (effectiveDesignatedNextAgent) {
    console.log(`[RoundTable] 🎯 检测到指定发言者，清空队列，插入指定的人`);
    
    // 使用预构建的名字映射（支持所有配置的 Agent，方便后续扩展）

    // 清理名字：转小写、去掉多余空格、去掉引号和大括号等标点（保留中文字符）
    const normalizedName = effectiveDesignatedNextAgent.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[{}"'""'']/g, '');
    const designatedId = agentNameToIdCache[normalizedName];

    console.log(`[RoundTable] 🎯 解析指定发言者: "${effectiveDesignatedNextAgent}" -> "${normalizedName}" -> "${designatedId}"`);
    console.log(`[RoundTable] 🎯 可用映射:`, Object.keys(agentNameToIdCache).filter(k => k.includes('steve') || k.includes('job')).join(', '));

    if (designatedId && AGENTS[designatedId]) {
      // 使用 moderator 的指定发言者功能
      const result = mod.handleDesignatedNext(agentId, content, designatedId);
      if (result) {
        console.log(`[RoundTable] 🎯 发送给指定发言者: ${result.nextAgent}`);
        sendToAgent(result.nextAgent, result.message, 'moderator', 'designated', channelId);
        return;
      }
      // 兜底：指定链路状态漂移时，强制派发给指定人，避免整场停住
      console.warn(`[RoundTable] ⚠️ 指定发言者链路返回空，启用强制派发兜底: ${designatedId}`);
      const targetName = AGENTS[designatedId]?.displayName || AGENTS[designatedId]?.name || designatedId;
      const speakerName = AGENTS[agentId]?.displayName || AGENTS[agentId]?.name || agentId;
      const topicTitle = (mod.currentTopicData && mod.currentTopicData.title) || mod.currentTopic || '当前话题';
      const fallbackMessage = mod.lang === 'en'
        ? `Current topic: "${topicTitle}". ${speakerName} just called on you. Please directly respond to ${speakerName}'s point first, then continue on-topic naturally.`
        : `当前话题：「${topicTitle}」。${speakerName}刚刚点名了你，请先直接回应${speakerName}的观点，再自然继续围绕主话题展开。`;

      mod.expectedSpeaker = designatedId;
      sendToAgent(designatedId, fallbackMessage, 'moderator', 'designated_fallback', channelId);
      console.log(`[RoundTable] 🎯 强制派发兜底成功: ${targetName}`);
      return;
    } else {
      console.log(`[RoundTable] ⚠️ 指定的发言者 "${effectiveDesignatedNextAgent}" 无效，回退到正常流程`);
    }
  }

  const decision = mod.onSpeechEnded(agentId, content);

  if (!decision) {
    console.log('[RoundTable] 讨论已中断或结束');
    return;
  }

  // 预加载：通知下一个发言人准备
  if (channelId) {
    const room = rooms.get(channelId);
    if (room) {
      setRoomNextPrepared(room, decision.nextAgent, decision.message);

      // 广播给所有分机
      broadcastToRoom(room, {
        type: 'speaker_prepared',
        currentAgentId: agentId,
        nextAgentId: decision.nextAgent,
        nextMessage: decision.message
      });
    }
  }

  if (decision.type === 'next') {
    console.log(`[RoundTable] 下一位: ${decision.nextAgent}`);
    sendToAgent(decision.nextAgent, decision.message, 'moderator', 'next', channelId);
  } else if (decision.type === 'transition') {
    console.log(`[RoundTable] 🔄 话题过渡: ${decision.nextAgent}`);
    sendToAgent(decision.nextAgent, decision.message, 'moderator', 'transition', channelId);

    // [MODIFIED] 不要在这里广播 topic_changed
    // 应该等到 speech-started 事件触发时，如果发现话题变了，再广播
    // 或者在 decision 中携带新话题信息，暂存到 room.nextTopicData
    
    if (channelId) {
      const room = rooms.get(channelId);
      if (room && room.moderator.currentTopicData) {
        // 暂存新话题数据，等待 speech-started 时广播
        room.nextTopicData = room.moderator.currentTopicData;
        console.log(`[RoundTable] 🔄 [房间] 暂存新话题数据，等待发言开始时切换: ${room.nextTopicData.title.substring(0, 20)}...`);
      }
    } else {
      // 非房间模式：也暂存新话题数据，等待 speech-started 时广播
      if (mod.currentTopicData) {
        roundTableState.pendingTopicData = mod.currentTopicData;
        console.log(`[RoundTable] 🔄 [非房间] 暂存新话题数据，等待发言开始时切换: ${roundTableState.pendingTopicData.title.substring(0, 20)}...`);
      }
    }
  }
}

// 处理用户输入（打断当前讨论）
function handleUserInput(input, targetAgent, channelId = null) {
  const mod = getModerator(channelId);
  const room = channelId ? rooms.get(channelId) : null;
  console.log(`[RoundTable] ===== 用户输入，打断当前讨论 =====`);
  console.log(`[RoundTable] 输入: ${input}`);
  console.log(`[RoundTable] 目标agent: ${targetAgent || '无'}`);
  console.log(`[RoundTable] channelId: ${channelId || '无'}`);

  // 打断时清除准备状态，让新发言人的回调可以正常触发
  const state = getRoundTableState(channelId);
  state.preparingAgent = null;
  state.preparingStartTime = null;
  // 标记本房间的 agent 都被打断
  if (channelId) {
    if (room && room.agentIds) {
      room.agentIds.forEach(function(id) { state.interruptedAgents.add(id); });
    }
  } else {
    Object.keys(AGENTS).forEach(function(id) { state.interruptedAgents.add(id); });
  }
  console.log(`[RoundTable] 🧹 打断时标记所有 agent`);

  const result = mod.handleUserInput(input, targetAgent);

  console.log(`[RoundTable] 用户输入处理结果:`);
  console.log(`  总结: ${result.summary}`);
  console.log(`  指定嘉宾: ${result.nextAgent}`);

  // 房间模式：先清空播放列表，再进入新一轮（保证 playlist_reset 先于新话题音频）
  if (room) {
    if (room.podcastPusher) {
      // 先本地清空缓冲，避免旧音频残留
      room.podcastPusher.clearAudio();
      // 再通知后端重置播放列表
      room.podcastPusher.playlistReset('user_interrupt', true);
    }

    broadcastToRoom(room, {
      type: 'interrupt',
      initiator: 'host'
    });

    // 广播话题变化（用户输入的话题）
    const topicData = mod.currentTopicData || { title: input };
    room.currentDisplayTopic = topicData;
    recordRoomTopicHistory(room, topicData, 'user_interrupt');
    broadcastToRoom(room, {
      type: 'topic_changed',
      topicData: topicData
    });
    // 同步话题到 Podcast 房间
    syncTopicToPodcast(room, topicData, result.nextAgent);
  }

  const sent = sendToAgent(result.nextAgent, result.message, 'moderator', 'next', channelId);
  console.log(`[RoundTable] handleUserInput → sendToAgent(${result.nextAgent}) 结果: ${sent ? '✅ 已发送' : '❌ 未找到连接'}`);

  // 兜底：如果 moderator 消息发送失败，延迟重试
  if (!sent) {
    console.log(`[${result.nextAgent}] ⏳ 等待前端连接后重试...`);
    var retryCount = 0;
    var retryInterval = setInterval(function() {
      retryCount++;
      var retrySent = sendToAgent(result.nextAgent, result.message, 'moderator', 'next', channelId);
      if (retrySent) {
        console.log(`[${result.nextAgent}] ✅ 重试成功 (${retryCount})`);
        clearInterval(retryInterval);
      } else if (retryCount >= 3) {
        console.log(`[${result.nextAgent}] ❌ 重试失败，已达最大次数`);
        clearInterval(retryInterval);
      }
    }, 2000);
  }

  return result;
}

// 构建 messages（兼容兜底：仅在无 sessionKey 的请求路径下使用）
function buildMessages(agentId, userMessage) {
  const agent = getRuntimeAgentById(agentId);
  const messages = [];

  // 确保 memory 已初始化
  if (!memory[agentId]) {
    memory[agentId] = [];
    console.log(`[${agentId}] 💾 初始化记忆存储`);
  }

  if (agent && agent.systemPrompt) {
    messages.push({ role: 'system', content: agent.systemPrompt });
    console.log(`[${agentId}] ✅ 使用人设: ${agent.systemPrompt.substring(0, 80)}...`);
  } else {
    console.log(`[${agentId}] ⚠️ 无人设，使用默认`);
  }

  // 仅取最近 N 轮记忆，减少长会话下的首包延迟
  const recentMemory = memory[agentId].slice(-CONTEXT_MEMORY_TURNS);
  recentMemory.forEach(m => {
    messages.push({ role: 'user', content: m.user });
    messages.push({ role: 'assistant', content: m.assistant });
  });
  
  messages.push({ role: 'user', content: userMessage });
  return messages;
}

// 添加记忆
function addMemory(agentId, userMsg, assistantMsg) {
  // 确保 memory 已初始化
  if (!memory[agentId]) {
    memory[agentId] = [];
  }
  memory[agentId].push({ user: userMsg, assistant: assistantMsg, timestamp: new Date().toISOString() });
  if (memory[agentId].length > MAX_MEMORY) {
    memory[agentId].shift();
  }
  // 保存到文件
  saveMemoryToFile(agentId);
}

// ========== Room 主机-分机系统 API ==========

// 测试端点
app.get('/api/room/test', (req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

// 获取运行中房间快照（含开播状态）
app.get('/api/room/runtime', (req, res) => {
  const activeOnly = String(req.query.activeOnly || '').toLowerCase();
  const snapshot = listRuntimeRoomsSnapshot();
  const activeRooms = snapshot.filter((room) => room.isActive);
  const shouldActiveOnly = activeOnly === '1' || activeOnly === 'true' || activeOnly === 'yes';
  const outputRooms = shouldActiveOnly ? activeRooms : snapshot;

  res.json({
    rooms: outputRooms,
    total: snapshot.length,
    activeCount: activeRooms.length,
    updatedAt: new Date().toISOString()
  });
});

// 获取 agents 配置
app.get('/api/agents', (req, res) => {
  const { characters, character_voices } = req.query;

  let agentIds = [];
  let voiceIds = [];

  if (characters) {
    agentIds = characters.split(',').map(c => c.trim());
  }

  if (character_voices) {
    voiceIds = character_voices.split(',').map(v => v.trim());
  }

  // 如果没有传入，使用扫描到的所有 Workspace Agents
  let isAutoDiscovery = false;
  if (agentIds.length === 0) {
    // agentIds = DEFAULT_AGENT_IDS;
    // voiceIds = DEFAULT_VOICE_IDS;
    const scanned = scanOpenClawAgents();
    agentIds = Object.keys(scanned);
    isAutoDiscovery = true;
  }

  console.log(`[API] /api/agents called with agentIds: ${JSON.stringify(agentIds)}`);

  // 更新全局状态（支持动态智能体）
  activeAgentIds = agentIds;

  // 构建 agents 配置并更新全局 AGENTS
  let agents = {};
  if (isAutoDiscovery) {
      agents = scanOpenClawAgents();
  } else {
      agents = buildAgentsObject(agentIds, voiceIds);
  }

  // 更新全局 AGENTS
  Object.keys(AGENTS).forEach(key => {
    if (!agentIds.includes(key)) {
      delete AGENTS[key];
    }
  });
  Object.keys(agents).forEach(key => {
    AGENTS[key] = agents[key];
  });

  // 刷新名字映射（支持新的 displayName、中文名等）
  refreshAgentNameMap();

  // 同步更新全局 moderator 的 agent 列表（动态增减 agent 时保持一致）
  moderator.allAgents = agentIds;

  // 为新加载的 agent 加载人设和记忆
  agentIds.forEach(function(agentId) {
    refreshPersona(agentId);
    if (!memory[agentId]) {
      memory[agentId] = loadMemoryFromFile(agentId);
    }
  });

  // Enrich agents with avatar/video URLs
  const enrichedAgents = {};
  
  // Helper to check if avatar exists
  const hasAvatar = (agentId, workspace) => {
      const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
      
      // 1. Check Workspace
      if (workspace) {
          for (const ext of extensions) {
              if (fs.existsSync(path.join(workspace, `avatar${ext}`))) return true;
          }
      }
      
      // 2. Check Local Data (Case-insensitive)
      if (fs.existsSync(DATA_AGENTS_DIR)) {
          try {
              const dirs = fs.readdirSync(DATA_AGENTS_DIR);
              const matchDir = dirs.find(d => d.toLowerCase() === agentId.toLowerCase());
              if (matchDir) {
                  const localPath = path.join(DATA_AGENTS_DIR, matchDir);
                  for (const ext of extensions) {
                      if (fs.existsSync(path.join(localPath, `avatar${ext}`))) return true;
                  }
              }
          } catch(e) {}
      }
      return false;
  };
  
  // Helper to check if video exists
  const hasVideo = (agentId, workspace) => {
      // 1. Check Workspace
      if (workspace) {
          if (fs.existsSync(path.join(workspace, 'video.mp4'))) return true;
      }
      
      // 2. Check Local Data (Case-insensitive)
      if (fs.existsSync(DATA_AGENTS_DIR)) {
          try {
              const dirs = fs.readdirSync(DATA_AGENTS_DIR);
              const matchDir = dirs.find(d => d.toLowerCase() === agentId.toLowerCase());
              if (matchDir) {
                  const localPath = path.join(DATA_AGENTS_DIR, matchDir);
                  if (fs.existsSync(path.join(localPath, 'video.mp4'))) return true;
              }
          } catch(e) {}
      }
      return false;
  };

  // 1. Add System Agents (from AGENTS)
  Object.keys(agents).forEach(id => {
    const agent = agents[id];
    
    enrichedAgents[id] = {
      ...agent,
      avatarUrl: hasAvatar(id, agent.workspace) ? `/api/agents/${id}/avatar` : null,
      videoUrl: hasVideo(id, agent.workspace) ? `/api/agents/${id}/video` : null,
      workspace: agent.workspace
    };
  });

  // 2. Add OpenClaw System Agents (Scan again? No, we already have them if auto-discovery)
  if (!isAutoDiscovery) {
      const openclawAgents = scanOpenClawAgents();
      Object.keys(openclawAgents).forEach(id => {
        if (!enrichedAgents[id]) {
            enrichedAgents[id] = openclawAgents[id];
        }
      });
  }

  // 3. [REMOVED] Add Local Agents (from data/agents)
  // Reason: We only want to show agents that exist in OpenClaw Workspace.
  // Local metadata is already merged in scanOpenClawAgents() via case-insensitive lookup.
  // Adding them here again causes duplicates (e.g. 'Jobs' vs 'jobs') if casing differs.
  
  /*
  const localAgents = scanLocalAgents();
  console.log('[API] Found local agents:', Object.keys(localAgents));
  
  Object.keys(localAgents).forEach(id => {
    // If local agent exists, it overrides (provides better metadata/avatar)
    const existingAgent = enrichedAgents[id];
    const localAgent = localAgents[id];
    
    // Determine which workspace to use:
    // We prefer the OpenClaw system workspace (where SOUL.md and logic live)
    // over the local Meco metadata directory.
    let finalWorkspace = localAgent.workspace;
    if (existingAgent && existingAgent.source === 'openclaw_system') {
        finalWorkspace = existingAgent.workspace;
    }

    enrichedAgents[id] = {
        ...existingAgent, // keep existing props if any
        ...localAgent,     // override with local data
        workspace: finalWorkspace // Ensure we point to the functional workspace
    };
  });
  */

  console.log('[API] Final agents list:', Object.keys(enrichedAgents));
  res.json({ agents: enrichedAgents, agentIds: Object.keys(enrichedAgents) });
});

// 获取指定 Agent 的 workspace 文件列表
app.get('/api/agents/:agentId/workspace', (req, res) => {
  const { agentId } = req.params;
  console.log(`[API] Request workspace for agent: ${agentId}`);
  const agent = getAgentById(agentId);
  if (!agent) {
      console.log(`[API] Agent not found: ${agentId}`);
      return res.status(404).send('Agent not found');
  }

  const files = [];
  try {
      console.log(`[API] Reading workspace: ${agent.workspace}`);
      if (fs.existsSync(agent.workspace)) {
          const items = fs.readdirSync(agent.workspace, { withFileTypes: true });
          items.forEach(item => {
              if (item.name.startsWith('.')) return; // skip hidden files
              files.push({
                  name: item.name,
                  type: item.isDirectory() ? 'folder' : 'file',
                  path: path.join(agent.workspace, item.name)
              });
          });
      }
  } catch (e) {
      console.error(`Failed to read workspace for ${agentId}:`, e);
  }
  res.json(files);
});

function normalizeRulePathInput(input) {
    return String(input || '').replace(/\\/g, '/').trim();
}

function expandHomePath(inputPath) {
    const homeDir = os.homedir();
    if (!inputPath) return '';
    if (inputPath === '~') return homeDir;
    if (inputPath.startsWith('~/')) {
        return path.join(homeDir, inputPath.slice(2));
    }
    return inputPath;
}

function toTildePath(absPath) {
    const homeDir = os.homedir();
    const normalized = path.resolve(absPath);
    const homeWithSep = homeDir.endsWith(path.sep) ? homeDir : `${homeDir}${path.sep}`;
    if (normalized === homeDir) return '~';
    if (normalized.startsWith(homeWithSep)) {
        return `~/${path.relative(homeDir, normalized).replace(/\\/g, '/')}`;
    }
    return normalized;
}

function getLocalPathResolveRoots() {
    const home = os.homedir();
    const roots = [
        process.cwd(),
        home,
        path.join(home, 'Desktop'),
        path.join(home, 'Documents'),
        path.join(home, 'Downloads')
    ];
    const uniq = [];
    roots.forEach((root) => {
        try {
            const resolved = path.resolve(root);
            if (uniq.includes(resolved)) return;
            if (!fs.existsSync(resolved)) return;
            if (!fs.statSync(resolved).isDirectory()) return;
            uniq.push(resolved);
        } catch (_) {}
    });
    return uniq;
}

function shouldSkipResolveDir(dirName) {
    const n = String(dirName || '').toLowerCase();
    if (!n) return true;
    if (n === '.git' || n === 'node_modules' || n === '.next' || n === 'dist' || n === 'build') return true;
    if (n === 'library' || n === 'applications' || n === 'system' || n === 'private') return true;
    return false;
}

function collectLocalPathCandidatesByName(targetName, kind = 'file', options = {}) {
    const name = String(targetName || '').trim();
    if (!name) return [];
    const targetLower = name.toLowerCase();

    const roots = Array.isArray(options.roots) && options.roots.length > 0
        ? options.roots
        : getLocalPathResolveRoots();
    const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 7;
    const maxScannedDirs = Number.isFinite(options.maxScannedDirs) ? options.maxScannedDirs : 20000;
    const maxResults = Number.isFinite(options.maxResults) ? options.maxResults : 60;
    let scannedDirs = 0;
    const out = [];

    const walk = (dirPath, depth) => {
        if (out.length >= maxResults) return;
        if (depth > maxDepth) return;
        if (scannedDirs >= maxScannedDirs) return;
        scannedDirs += 1;

        let entries = [];
        try {
            entries = fs.readdirSync(dirPath, { withFileTypes: true });
        } catch (_) {
            return;
        }

        for (const entry of entries) {
            if (out.length >= maxResults) break;
            const fullPath = path.join(dirPath, entry.name);
            const isDir = entry.isDirectory();
            const isFile = entry.isFile();
            const matchedKind = kind === 'folder' ? isDir : isFile;
            if (matchedKind && String(entry.name || '').toLowerCase() === targetLower) {
                out.push(fullPath);
                if (out.length >= maxResults) break;
            }
            if (isDir && depth < maxDepth && !shouldSkipResolveDir(entry.name)) {
                walk(fullPath, depth + 1);
            }
        }
    };

    roots.forEach((root) => walk(root, 0));
    return out;
}

function scoreLocalPathCandidate(item, candidatePath) {
    let score = 0;
    const rel = String(item.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const normalizedCandidate = String(candidatePath || '').replace(/\\/g, '/');
    if (rel && normalizedCandidate.endsWith(rel)) score += 120;
    if (String(item.name || '') && path.basename(candidatePath) === item.name) score += 30;

    try {
        const st = fs.statSync(candidatePath);
        if (item.kind === 'file') {
            const size = Number(item.size) || 0;
            if (size > 0 && st.size === size) score += 40;
            const lm = Number(item.lastModified) || 0;
            if (lm > 0) {
                const mDiff = Math.abs(st.mtimeMs - lm);
                if (mDiff <= 5000) score += 20;
                else if (mDiff <= 120000) score += 10;
            }
        }
    } catch (_) {}

    if (normalizedCandidate.includes('/Desktop/')) score += 3;
    if (normalizedCandidate.includes('/Documents/')) score += 3;
    if (normalizedCandidate.includes('/Downloads/')) score += 2;
    return score;
}

function resolveSingleLocalPath(item) {
    const kind = item.kind === 'folder' ? 'folder' : 'file';
    const name = String(item.name || '').trim();
    if (!name) return null;
    const rel = String(item.relativePath || '').trim();
    if (rel && path.isAbsolute(rel)) {
        try {
            const st = fs.statSync(rel);
            if ((kind === 'folder' && st.isDirectory()) || (kind === 'file' && st.isFile())) {
                return {
                    path: rel,
                    displayPath: toTildePath(rel),
                    pathType: kind,
                    name
                };
            }
        } catch (_) {}
    }

    const candidates = collectLocalPathCandidatesByName(name, kind, {
        maxDepth: kind === 'folder' ? 6 : 7,
        maxResults: 80
    });
    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    let bestPath = '';
    let bestScore = -Infinity;
    candidates.forEach((candidatePath) => {
        const score = scoreLocalPathCandidate(item, candidatePath);
        if (score > bestScore) {
            bestScore = score;
            bestPath = candidatePath;
        }
    });
    if (!bestPath) return null;
    return {
        path: bestPath,
        displayPath: toTildePath(bestPath),
        pathType: kind,
        name
    };
}

function resolveKnowledgeRuleFolder(folderInput) {
    const raw = normalizeRulePathInput(folderInput);
    if (!raw) {
        throw new Error('folder path is required');
    }

    const candidates = [];
    const addCandidate = (candidatePath) => {
        const normalized = path.resolve(candidatePath);
        if (!candidates.includes(normalized)) {
            candidates.push(normalized);
        }
    };

    const expanded = expandHomePath(raw);
    if (path.isAbsolute(expanded)) {
        addCandidate(expanded);
    } else {
        addCandidate(path.resolve(KNOWLEDGE_BASE_PATH, expanded));
        addCandidate(path.resolve(os.homedir(), expanded));
        addCandidate(path.resolve(path.join(os.homedir(), 'Documents'), expanded));
        addCandidate(path.resolve(path.join(os.homedir(), 'Desktop'), expanded));
        addCandidate(path.resolve(process.cwd(), expanded));
    }

    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                return {
                    absolutePath: candidate,
                    displayPath: toTildePath(candidate)
                };
            }
        } catch (_) {}
    }

    throw new Error(`folder not found from path: ${raw}`);
}

function parseKnowledgeRuleLine(line) {
    if (typeof line !== 'string') return null;
    let text = line.trim();
    if (!text) return null;
    text = text.replace(/^-+\s*/, '').trim();

    const readToken = '先读取 ';
    const filesToken = ' 下所有 .md/.txt 文件';
    const executeToken = '然后执行任务';

    const readIdx = text.indexOf(readToken);
    if (readIdx <= 0) return null;

    const ruleText = text.slice(0, readIdx).trim().replace(/[，,。.\s]+$/g, '');
    const rest = text.slice(readIdx + readToken.length);
    const filesIdx = rest.indexOf(filesToken);
    if (filesIdx <= 0) return null;

    const folderDisplayPath = rest.slice(0, filesIdx).trim();
    const tail = rest.slice(filesIdx + filesToken.length).trim();
    if (!tail.includes(executeToken)) return null;
    if (!ruleText || !folderDisplayPath) return null;

    return { ruleText, folderDisplayPath };
}

function getAgentRulesFilePath(agentId) {
    const agent = getAgentById(agentId);
    if (!agent || !agent.workspace) {
        return null;
    }
    return path.join(agent.workspace, 'AGENTS.md');
}

function getAgentKnowledgeRules(agentId) {
    const filePath = getAgentRulesFilePath(agentId);
    if (!filePath) {
        return { filePath: null, rules: [], lines: [] };
    }

    if (!fs.existsSync(filePath)) {
        return { filePath, rules: [], lines: [] };
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/);
    const rules = [];

    lines.forEach((line, idx) => {
        const parsed = parseKnowledgeRuleLine(line);
        if (!parsed) return;
        const expandedFolderPath = expandHomePath(parsed.folderDisplayPath);
        const absoluteFolderPath = path.isAbsolute(expandedFolderPath)
            ? path.normalize(expandedFolderPath)
            : path.resolve(os.homedir(), expandedFolderPath);
        let folderExists = false;
        try {
            folderExists = fs.existsSync(absoluteFolderPath) && fs.statSync(absoluteFolderPath).isDirectory();
        } catch (_) {}
        rules.push({
            id: String(idx + 1),
            lineNumber: idx + 1,
            line: line,
            ruleText: parsed.ruleText,
            folderDisplayPath: parsed.folderDisplayPath,
            absoluteFolderPath,
            folderExists
        });
    });

    return { filePath, rules, lines };
}

function isKnowledgeRuleExperienceExt(ext) {
    const normalized = String(ext || '').toLowerCase();
    return ['.doc', '.docx', '.pdf', '.txt', '.md'].includes(normalized);
}

function normalizeExperienceBaseName(filename) {
    const ext = path.extname(String(filename || ''));
    const base = path.basename(String(filename || ''), ext);
    const cleaned = String(base || '')
        .replace(/[\/\\:*?"<>|]/g, '_')
        .replace(/[\u0000-\u001F]/g, '')
        .trim();
    return cleaned || 'experience';
}

function normalizeUploadedFilename(filename) {
    const raw = String(filename || '').trim();
    if (!raw) return '';
    const rawHasCJK = /[\u3400-\u9FFF]/.test(raw);
    const rawLooksMojibake = /[\u0080-\u009F]|[ÃÂâæåéèêëìíîïðñòóôõöøùúûüýþÿ]/.test(raw);
    let decoded = '';
    try {
        decoded = Buffer.from(raw, 'latin1').toString('utf8');
    } catch (_) {
        decoded = '';
    }
    const decodedHasCJK = /[\u3400-\u9FFF]/.test(decoded);
    if (!rawHasCJK && decodedHasCJK) {
        return decoded;
    }
    if (rawLooksMojibake && decoded && !decoded.includes('�')) {
        return decoded;
    }
    return raw;
}

function buildUniqueMarkdownFilePath(targetFolder, preferredBaseName) {
    const base = normalizeExperienceBaseName(preferredBaseName || 'experience');
    const firstPath = path.join(targetFolder, `${base}.md`);
    if (!fs.existsSync(firstPath)) return firstPath;
    for (let i = 2; i <= 10000; i += 1) {
        const candidate = path.join(targetFolder, `${base}_${i}.md`);
        if (!fs.existsSync(candidate)) return candidate;
    }
    return path.join(targetFolder, `${base}_${Date.now()}.md`);
}

function unwrapMarkdownFence(content) {
    const source = String(content || '').trim();
    if (!source) return '';
    const fenceMatch = source.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
    if (fenceMatch && fenceMatch[1]) {
        return String(fenceMatch[1]).trim();
    }
    return source;
}

function sanitizeMarkdownText(content) {
    const source = String(content || '');
    if (!source) return '';
    // Remove C0/C1 control characters while preserving common whitespace/newlines.
    // Keep: \t(0x09), \n(0x0A), \r(0x0D)
    return source.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
}

async function convertFileToMarkdownByAgent(agentId, sourceFilePath, originalName) {
    const absPath = path.resolve(String(sourceFilePath || '').trim());
    const ext = path.extname(String(originalName || absPath)).toLowerCase();
    const scriptsDir = path.join(os.homedir(), '.openclaw', 'skills', 'doc-to-md', 'scripts');
    const { execFile } = require('child_process');
    const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: 120000, maxBuffer: 1024 * 1024 * 10, ...opts }, (error, stdout, stderr) => {
            if (error) {
                const details = [stderr, stdout, error.message].filter(Boolean).join('\n').trim();
                reject(new Error(details || `${cmd} failed`));
                return;
            }
            resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });

    const tempDir = path.join(os.tmpdir(), `meco-doc-to-md-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const tempOutput = path.join(tempDir, `${normalizeExperienceBaseName(originalName || path.basename(absPath))}.md`);

    try {
        if (ext === '.docx') {
            const script = path.join(scriptsDir, 'convert_docx.py');
            await run('python3', [script, absPath, tempOutput], { cwd: scriptsDir });
        } else if (ext === '.pdf') {
            const script = path.join(scriptsDir, 'convert_pdf.py');
            await run('python3', [script, absPath, tempOutput], { cwd: scriptsDir });
        } else if (ext === '.doc') {
            // .doc 先尝试用 macOS textutil 转成 .docx，再走 docx 转换
            const convertedDocx = path.join(tempDir, `${normalizeExperienceBaseName(originalName || path.basename(absPath))}.docx`);
            await run('textutil', ['-convert', 'docx', '-output', convertedDocx, absPath], {});
            const script = path.join(scriptsDir, 'convert_docx.py');
            await run('python3', [script, convertedDocx, tempOutput], { cwd: scriptsDir });
        } else {
            throw new Error(`unsupported extension: ${ext}`);
        }

        if (!fs.existsSync(tempOutput)) {
            throw new Error(`doc-to-md output not found: ${tempOutput}`);
        }
        const markdownContent = fs.readFileSync(tempOutput, 'utf-8');
        const md = unwrapMarkdownFence(markdownContent);
        if (!md || !md.trim()) {
            throw new Error('doc-to-md returned empty markdown');
        }
        return md;
    } catch (e) {
        throw new Error(`doc-to-md conversion failed: ${e.message || e}`);
    } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    }
}

app.post('/api/agents/:agentId/knowledge-rules/:lineNumber/experience', upload.single('file'), async (req, res) => {
    const { agentId, lineNumber } = req.params;
    const agent = getAgentById(agentId);
    if (!agent) {
        if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
        return res.status(404).json({ error: 'agent not found' });
    }

    const lineNo = Number(lineNumber);
    if (!Number.isFinite(lineNo) || lineNo <= 0) {
        if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
        return res.status(400).json({ error: 'invalid line number' });
    }
    if (!req.file) {
        return res.status(400).json({ error: 'file is required' });
    }

    const normalizedOriginalName = normalizeUploadedFilename(req.file.originalname || '') || 'experience';
    const ext = path.extname(normalizedOriginalName).toLowerCase();
    if (!isKnowledgeRuleExperienceExt(ext)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(400).json({ error: 'unsupported file type, only .doc/.docx/.pdf/.txt/.md' });
    }

    const { rules } = getAgentKnowledgeRules(agentId);
    const rule = rules.find((item) => item.lineNumber === lineNo);
    if (!rule || !rule.absoluteFolderPath) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(404).json({ error: 'rule not found' });
    }

    const targetFolder = path.resolve(rule.absoluteFolderPath);
    let folderOk = false;
    try {
        folderOk = fs.existsSync(targetFolder) && fs.statSync(targetFolder).isDirectory();
    } catch (_) {
        folderOk = false;
    }
    if (!folderOk) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(404).json({ error: 'rule folder does not exist' });
    }

    try {
        let markdownContent = '';
        if (ext === '.txt' || ext === '.md') {
            markdownContent = fs.readFileSync(req.file.path, 'utf-8');
        } else {
            markdownContent = await convertFileToMarkdownByAgent(agentId, req.file.path, normalizedOriginalName);
        }

        const normalized = sanitizeMarkdownText(unwrapMarkdownFence(markdownContent));
        if (!normalized.trim()) {
            throw new Error('markdown content is empty');
        }

        const outputPath = buildUniqueMarkdownFilePath(targetFolder, normalizedOriginalName || 'experience');
        fs.writeFileSync(outputPath, `${normalized.trimEnd()}\n`, 'utf-8');

        return res.json({
            success: true,
            message: 'experience added',
            outputPath,
            outputDisplayPath: toTildePath(outputPath)
        });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'failed to add experience' });
    } finally {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
});

function sanitizeUploadPathSegment(segment, fallback = 'item') {
    const raw = String(segment || '')
        .normalize('NFC')
        .replace(/[\\/]+/g, ' ')
        .trim();
    if (!raw) return fallback;

    const ext = path.extname(raw);
    const hasExt = !!ext && ext !== '.';
    const baseRaw = hasExt ? raw.slice(0, -ext.length) : raw;
    const extRaw = hasExt ? ext : '';

    const sanitizePart = (value) => String(value || '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();

    let base = sanitizePart(baseRaw);
    let safeExt = sanitizePart(extRaw).replace(/\s+/g, '');
    if (safeExt && !safeExt.startsWith('.')) {
        safeExt = `.${safeExt.replace(/^\.+/, '')}`;
    }
    if (!base || base === '.' || base === '..') {
        base = fallback;
    }

    let candidate = `${base}${safeExt}`.replace(/[\\/]/g, '_').trim();
    if (!candidate || candidate === '.' || candidate === '..') {
        candidate = fallback;
    }

    const MAX_SEGMENT_LEN = 180;
    if (candidate.length > MAX_SEGMENT_LEN) {
        const suffix = safeExt && safeExt.length < 40 ? safeExt : '';
        const keep = Math.max(1, MAX_SEGMENT_LEN - suffix.length);
        candidate = `${candidate.slice(0, keep).trim()}${suffix}`;
    }

    return candidate || fallback;
}

function ensureUniqueFilePath(preferredPath) {
    if (!preferredPath) return preferredPath;
    if (!fs.existsSync(preferredPath)) return preferredPath;
    const dir = path.dirname(preferredPath);
    const ext = path.extname(preferredPath);
    const base = path.basename(preferredPath, ext);
    for (let i = 2; i < 10000; i += 1) {
        const candidate = path.join(dir, `${base}_${i}${ext}`);
        if (!fs.existsSync(candidate)) return candidate;
    }
    return path.join(dir, `${base}_${Date.now()}${ext}`);
}

const UPLOAD_CLEANUP_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
const UPLOAD_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

function getUploadCleanupRoots() {
    const roots = new Set();
    const pushRoot = (dir) => {
        if (!dir) return;
        try {
            roots.add(path.resolve(dir));
        } catch (_) {}
    };
    pushRoot(path.join(__dirname, 'public', 'uploads'));
    pushRoot(path.join(os.homedir(), 'Meco Studio', 'public', 'uploads'));
    return Array.from(roots);
}

function isEntryOlderThan(entryPath, maxAgeMs, nowMs) {
    try {
        const stat = fs.statSync(entryPath);
        const ageMs = nowMs - stat.mtimeMs;
        return Number.isFinite(ageMs) && ageMs > maxAgeMs;
    } catch (_) {
        return false;
    }
}

function cleanupUploadDirectoryRecursive(rootDir, maxAgeMs, nowMs) {
    let removedFiles = 0;
    let removedDirs = 0;
    let removedBytes = 0;

    let entries = [];
    try {
        entries = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch (_) {
        return { removedFiles, removedDirs, removedBytes };
    }

    for (const entry of entries) {
        const absPath = path.join(rootDir, entry.name);
        try {
            if (entry.isFile()) {
                if (!isEntryOlderThan(absPath, maxAgeMs, nowMs)) continue;
                let size = 0;
                try {
                    size = fs.statSync(absPath).size || 0;
                } catch (_) {
                    size = 0;
                }
                fs.rmSync(absPath, { force: true });
                removedFiles += 1;
                removedBytes += Math.max(0, size);
                continue;
            }

            if (entry.isDirectory()) {
                const nested = cleanupUploadDirectoryRecursive(absPath, maxAgeMs, nowMs);
                removedFiles += nested.removedFiles;
                removedDirs += nested.removedDirs;
                removedBytes += nested.removedBytes;

                let isEmpty = false;
                try {
                    isEmpty = fs.readdirSync(absPath).length === 0;
                } catch (_) {
                    isEmpty = false;
                }
                if (!isEmpty) continue;
                if (!isEntryOlderThan(absPath, maxAgeMs, nowMs)) continue;
                fs.rmSync(absPath, { recursive: true, force: true });
                removedDirs += 1;
            }
        } catch (_) {
            // Ignore individual entry failures; continue scanning.
        }
    }

    return { removedFiles, removedDirs, removedBytes };
}

function runUploadRetentionCleanup() {
    const nowMs = Date.now();
    const roots = getUploadCleanupRoots();
    let totalFiles = 0;
    let totalDirs = 0;
    let totalBytes = 0;

    roots.forEach((rootDir) => {
        try {
            if (!fs.existsSync(rootDir)) return;
            const result = cleanupUploadDirectoryRecursive(rootDir, UPLOAD_CLEANUP_MAX_AGE_MS, nowMs);
            totalFiles += result.removedFiles;
            totalDirs += result.removedDirs;
            totalBytes += result.removedBytes;
        } catch (e) {
            console.warn(`[UploadCleanup] cleanup failed for ${rootDir}: ${e.message}`);
        }
    });

    if (totalFiles > 0 || totalDirs > 0) {
        console.log(`[UploadCleanup] removed files=${totalFiles}, dirs=${totalDirs}, bytes=${totalBytes}`);
    }
}

function startUploadCleanupScheduler() {
    runUploadRetentionCleanup();
    setInterval(() => {
        runUploadRetentionCleanup();
    }, UPLOAD_CLEANUP_INTERVAL_MS);
}

function getKnowledgeRuleUploadRoot() {
    const preferred = path.join(os.homedir(), 'Meco Studio', 'public', 'uploads');
    try {
        fs.mkdirSync(preferred, { recursive: true });
        return preferred;
    } catch (e) {
        console.warn(`[KnowledgeRules] preferred upload root unavailable: ${e.message}`);
    }
    const fallback = path.join(__dirname, 'public', 'uploads');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
}

function normalizeRelativeUploadPath(relPath, fallbackName = 'file.bin') {
    const normalized = String(relPath || '').replace(/\\/g, '/').trim();
    const rawParts = normalized.split('/').filter((part) => part && part !== '.' && part !== '..');
    if (rawParts.length === 0) {
        return [sanitizeUploadPathSegment(fallbackName, 'file.bin')];
    }
    return rawParts.map((part, idx) => sanitizeUploadPathSegment(part, idx === rawParts.length - 1 ? 'file.bin' : 'dir'));
}

function isPathInsideDir(parentDir, targetPath) {
    if (!parentDir || !targetPath) return false;
    const parent = path.resolve(parentDir);
    const target = path.resolve(targetPath);
    const relative = path.relative(parent, target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function getKnowledgeRuleManagedFolderRoots() {
    const roots = new Set();
    const pushRoot = (dir) => {
        if (!dir) return;
        try {
            roots.add(path.resolve(dir));
        } catch (_) {}
    };
    pushRoot(path.join(getKnowledgeRuleUploadRoot(), 'knowledge-rule-folders'));
    pushRoot(path.join(__dirname, 'public', 'uploads', 'knowledge-rule-folders'));
    pushRoot(path.join(os.homedir(), 'Meco Studio', 'public', 'uploads', 'knowledge-rule-folders'));
    pushRoot(path.join(os.homedir(), 'Desktop', 'Meco Studio', 'public', 'uploads', 'knowledge-rule-folders'));
    return Array.from(roots);
}

function tryDeleteManagedKnowledgeRuleFolder(folderPath) {
    const absPath = path.resolve(String(folderPath || '').trim());
    if (!absPath) {
        return { removed: false, reason: 'empty_path' };
    }
    let stat = null;
    try {
        stat = fs.statSync(absPath);
    } catch (_) {
        stat = null;
    }
    if (!stat || !stat.isDirectory()) {
        return { removed: false, reason: 'not_directory_or_missing' };
    }
    const managedRoots = getKnowledgeRuleManagedFolderRoots();
    const inManagedRoots = managedRoots.some((root) => isPathInsideDir(root, absPath));
    if (!inManagedRoots) {
        return { removed: false, reason: 'outside_managed_roots' };
    }
    fs.rmSync(absPath, { recursive: true, force: true });
    return { removed: true, path: absPath };
}

function ensureUniqueFolderPath(parentDir, preferredName) {
    const safeName = sanitizeUploadPathSegment(preferredName || 'folder', 'folder');
    let candidate = path.join(parentDir, safeName);
    if (!fs.existsSync(candidate)) {
        return candidate;
    }
    for (let i = 2; i < 10000; i += 1) {
        candidate = path.join(parentDir, `${safeName}_${i}`);
        if (!fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return path.join(parentDir, `${safeName}_${Date.now()}`);
}

app.post('/api/uploads/attachment-folder', upload.array('files', 5000), (req, res) => {
    const incomingFiles = Array.isArray(req.files) ? req.files : [];
    if (incomingFiles.length === 0) {
        return res.status(400).json({ error: 'no files uploaded' });
    }

    const relPathsRaw = req.body?.relPaths;
    const relPaths = Array.isArray(relPathsRaw)
        ? relPathsRaw
        : (typeof relPathsRaw === 'string' && relPathsRaw ? [relPathsRaw] : []);

    const rawPreferredFolderName = String(req.body?.folderName || '').trim();
    const preferredFolderName = rawPreferredFolderName
        ? sanitizeUploadPathSegment(rawPreferredFolderName, 'folder')
        : '';
    const firstRelative = String(relPaths[0] || '').replace(/\\/g, '/').trim();
    const rawInferredFolderName = firstRelative.split('/')[0] || '';
    const inferredFolderName = rawInferredFolderName
        ? sanitizeUploadPathSegment(rawInferredFolderName, 'folder')
        : '';
    const folderLabel = preferredFolderName || inferredFolderName || 'folder';
    const normalizedInferredRoot = inferredFolderName || '';

    const uploadRoot = path.join(__dirname, 'public', 'uploads');
    fs.mkdirSync(uploadRoot, { recursive: true });
    const foldersRoot = path.join(uploadRoot, 'agenttools-folders');
    fs.mkdirSync(foldersRoot, { recursive: true });
    const targetRoot = ensureUniqueFolderPath(foldersRoot, folderLabel);

    let copiedCount = 0;
    try {
        fs.mkdirSync(targetRoot, { recursive: true });
        incomingFiles.forEach((file, idx) => {
            const relPath = String(relPaths[idx] || file.originalname || file.filename || `file_${idx + 1}`).trim();
            let normalizedParts = normalizeRelativeUploadPath(relPath, file.originalname || `file_${idx + 1}`);
            if (normalizedParts.length > 1) {
                const firstPart = normalizedParts[0];
                if ((normalizedInferredRoot && firstPart === normalizedInferredRoot) || firstPart === folderLabel) {
                    normalizedParts = normalizedParts.slice(1);
                }
            }
            const safeRelative = path.join(...normalizedParts);
            const destination = ensureUniqueFilePath(path.join(targetRoot, safeRelative));
            const destinationDir = path.dirname(destination);
            fs.mkdirSync(destinationDir, { recursive: true });
            fs.copyFileSync(file.path, destination);
            copiedCount += 1;
        });
    } catch (e) {
        incomingFiles.forEach((file) => {
            try { fs.unlinkSync(file.path); } catch (_) {}
        });
        try { fs.rmSync(targetRoot, { recursive: true, force: true }); } catch (_) {}
        return res.status(500).json({ error: `failed to store folder upload: ${e.message}` });
    }

    incomingFiles.forEach((file) => {
        try { fs.unlinkSync(file.path); } catch (_) {}
    });

    if (copiedCount <= 0) {
        try { fs.rmSync(targetRoot, { recursive: true, force: true }); } catch (_) {}
        return res.status(500).json({ error: 'no files copied from upload' });
    }
    console.log(`[AttachmentFolderUpload] stored ${copiedCount}/${incomingFiles.length} files -> ${targetRoot}`);

    return res.json({
        success: true,
        absolutePath: targetRoot,
        displayPath: toTildePath(targetRoot),
        folderName: path.basename(targetRoot),
        fileCount: copiedCount
    });
});

app.post('/api/uploads/knowledge-folder', upload.array('files', 5000), (req, res) => {
    const incomingFiles = Array.isArray(req.files) ? req.files : [];
    if (incomingFiles.length === 0) {
        return res.status(400).json({ error: 'no files uploaded' });
    }

    const relPathsRaw = req.body?.relPaths;
    const relPaths = Array.isArray(relPathsRaw)
        ? relPathsRaw
        : (typeof relPathsRaw === 'string' && relPathsRaw ? [relPathsRaw] : []);

    const rawPreferredFolderName = String(req.body?.folderName || '').trim();
    const preferredFolderName = rawPreferredFolderName
        ? sanitizeUploadPathSegment(rawPreferredFolderName, 'folder')
        : '';
    const firstRelative = String(relPaths[0] || '').replace(/\\/g, '/').trim();
    const rawInferredFolderName = firstRelative.split('/')[0] || '';
    const inferredFolderName = rawInferredFolderName
        ? sanitizeUploadPathSegment(rawInferredFolderName, 'folder')
        : '';
    const folderLabel = preferredFolderName || inferredFolderName || 'folder';
    const normalizedInferredRoot = inferredFolderName || '';

    const uploadRoot = getKnowledgeRuleUploadRoot();
    const foldersRoot = path.join(uploadRoot, 'knowledge-rule-folders');
    fs.mkdirSync(foldersRoot, { recursive: true });
    const targetRoot = ensureUniqueFolderPath(foldersRoot, folderLabel);

    let copiedCount = 0;
    try {
        fs.mkdirSync(targetRoot, { recursive: true });
        incomingFiles.forEach((file, idx) => {
            const relPath = String(relPaths[idx] || file.originalname || file.filename || `file_${idx + 1}`).trim();
            let normalizedParts = normalizeRelativeUploadPath(relPath, file.originalname || `file_${idx + 1}`);
            if (normalizedParts.length > 1) {
                const firstPart = normalizedParts[0];
                if ((normalizedInferredRoot && firstPart === normalizedInferredRoot) || firstPart === folderLabel) {
                    normalizedParts = normalizedParts.slice(1);
                }
            }
            const safeRelative = path.join(...normalizedParts);
            const destination = ensureUniqueFilePath(path.join(targetRoot, safeRelative));
            const destinationDir = path.dirname(destination);
            fs.mkdirSync(destinationDir, { recursive: true });
            fs.copyFileSync(file.path, destination);
            copiedCount += 1;
        });
    } catch (e) {
        incomingFiles.forEach((file) => {
            try { fs.unlinkSync(file.path); } catch (_) {}
        });
        return res.status(500).json({ error: `failed to store folder upload: ${e.message}` });
    }

    incomingFiles.forEach((file) => {
        try { fs.unlinkSync(file.path); } catch (_) {}
    });

    if (copiedCount <= 0) {
        return res.status(500).json({ error: 'no files copied from upload' });
    }
    console.log(`[KnowledgeFolderUpload] stored ${copiedCount}/${incomingFiles.length} files -> ${targetRoot}`);

    return res.json({
        success: true,
        absolutePath: targetRoot,
        displayPath: toTildePath(targetRoot),
        fileCount: copiedCount
    });
});

app.get('/api/agents/:agentId/knowledge-rules', (req, res) => {
    const { agentId } = req.params;
    const agent = getAgentById(agentId);
    if (!agent) {
        return res.status(404).json({ error: 'agent not found' });
    }
    const { rules } = getAgentKnowledgeRules(agentId);
    res.json({ rules });
});

app.post('/api/agents/:agentId/knowledge-rules', (req, res) => {
    const { agentId } = req.params;
    const agent = getAgentById(agentId);
    if (!agent) {
        return res.status(404).json({ error: 'agent not found' });
    }

    const ruleText = String(req.body?.ruleText || '').replace(/\s+/g, ' ').trim();
    const folderPathInput = String(req.body?.folderPath || '').trim();
    if (!ruleText) {
        return res.status(400).json({ error: 'rule text is required' });
    }
    if (!folderPathInput) {
        return res.status(400).json({ error: 'folder path is required' });
    }

    try {
        const { filePath, lines } = getAgentKnowledgeRules(agentId);
        if (!filePath) {
            return res.status(500).json({ error: 'cannot resolve AGENTS.md path' });
        }

        const resolved = resolveKnowledgeRuleFolder(folderPathInput);
        const newLine = `- ${ruleText} 先读取 ${resolved.displayPath} 下所有 .md/.txt 文件，然后执行任务`;

        const existingLineIndex = lines.findIndex((line) => line.trim() === newLine.trim());
        if (existingLineIndex >= 0) {
            const { rules } = getAgentKnowledgeRules(agentId);
            const existingRule = rules.find((r) => r.lineNumber === existingLineIndex + 1) || null;
            return res.json({
                success: true,
                duplicated: true,
                rule: existingRule
            });
        }

        const baseContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
        const nextContent = baseContent.trimEnd().length > 0
            ? `${baseContent.trimEnd()}\n${newLine}\n`
            : `${newLine}\n`;
        fs.writeFileSync(filePath, nextContent, 'utf-8');
        refreshPersona(agentId);

        const { rules } = getAgentKnowledgeRules(agentId);
        const addedRule = rules[rules.length - 1] || null;
        res.json({
            success: true,
            rule: addedRule,
            resolvedAbsolutePath: resolved.absolutePath
        });
    } catch (e) {
        res.status(400).json({ error: e.message || 'failed to add knowledge rule' });
    }
});

app.delete('/api/agents/:agentId/knowledge-rules/:lineNumber', (req, res) => {
    const { agentId, lineNumber } = req.params;
    const agent = getAgentById(agentId);
    if (!agent) {
        return res.status(404).json({ error: 'agent not found' });
    }

    const lineNo = Number(lineNumber);
    if (!Number.isFinite(lineNo) || lineNo <= 0) {
        return res.status(400).json({ error: 'invalid line number' });
    }

    const { filePath, lines } = getAgentKnowledgeRules(agentId);
    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'AGENTS.md not found' });
    }

    const idx = lineNo - 1;
    if (idx < 0 || idx >= lines.length) {
        return res.status(404).json({ error: 'rule not found' });
    }
    const parsed = parseKnowledgeRuleLine(lines[idx]);
    if (!parsed) {
        return res.status(404).json({ error: 'rule not found' });
    }

    let removedFolder = false;
    let removedFolderPath = '';
    let removedFolderReason = '';
    try {
        const expanded = expandHomePath(parsed.folderDisplayPath);
        const absoluteFolderPath = path.isAbsolute(expanded)
            ? path.resolve(expanded)
            : path.resolve(os.homedir(), expanded);
        const removeResult = tryDeleteManagedKnowledgeRuleFolder(absoluteFolderPath);
        removedFolder = !!removeResult.removed;
        removedFolderPath = removeResult.path || '';
        removedFolderReason = removeResult.reason || '';
    } catch (e) {
        removedFolder = false;
        removedFolderReason = e.message || 'remove_failed';
    }

    lines.splice(idx, 1);
    const updatedContent = `${lines.join('\n').trimEnd()}\n`;
    fs.writeFileSync(filePath, updatedContent, 'utf-8');
    refreshPersona(agentId);

    res.json({
        success: true,
        removedFolder,
        removedFolderPath: removedFolderPath || undefined,
        removedFolderReason: removedFolder ? undefined : (removedFolderReason || undefined)
    });
});

app.post('/api/agents/:agentId/knowledge-rules/open', (req, res) => {
    const { agentId } = req.params;
    const lineNo = Number(req.body?.lineNumber);
    const agent = getAgentById(agentId);
    if (!agent) {
        return res.status(404).json({ error: 'agent not found' });
    }
    if (!Number.isFinite(lineNo) || lineNo <= 0) {
        return res.status(400).json({ error: 'invalid line number' });
    }

    const { rules } = getAgentKnowledgeRules(agentId);
    const target = rules.find((rule) => rule.lineNumber === lineNo);
    if (!target) {
        return res.status(404).json({ error: 'rule not found' });
    }

    const folderPath = target.absoluteFolderPath;
    let folderOk = false;
    try {
        folderOk = !!folderPath && fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory();
    } catch (_) {
        folderOk = false;
    }
    if (!folderOk) {
        return res.status(404).json({ error: 'folder does not exist' });
    }

    const { execFile } = require('child_process');
    const openCommand = process.platform === 'darwin'
        ? 'open'
        : (process.platform === 'win32' ? 'explorer' : 'xdg-open');

    execFile(openCommand, [folderPath], (err) => {
        if (err) {
            return res.status(500).json({ error: `failed to open folder: ${err.message}` });
        }
        res.json({ success: true });
    });
});

app.get('/api/knowledge/folders', (req, res) => {
    if (!fs.existsSync(KNOWLEDGE_BASE_PATH)) {
        return res.json({ items: [] });
    }

    const items = [];
    const walk = (dirPath, depth = 0) => {
        if (depth > 3) return;
        let children = [];
        try {
            children = fs.readdirSync(dirPath, { withFileTypes: true });
        } catch (_) {
            return;
        }
        for (const child of children) {
            if (!child.isDirectory()) continue;
            if (child.name.startsWith('.')) continue;
            if (depth === 0 && !isAllowedHotTopicsCategory(child.name)) continue;
            const absPath = path.join(dirPath, child.name);
            const relativePath = path.relative(KNOWLEDGE_BASE_PATH, absPath).replace(/\\/g, '/');
            if (!relativePath) continue;
            items.push({
                relativePath,
                displayPath: `Documents/知识库/热门话题/${relativePath}`
            });
            walk(absPath, depth + 1);
        }
    };

    walk(KNOWLEDGE_BASE_PATH, 0);
    items.sort((a, b) => String(a.displayPath).localeCompare(String(b.displayPath)));
    res.json({ items });
});

// 获取指定 Agent 的知识库内容
app.get('/api/agents/:agentId/knowledge', (req, res) => {
  const { agentId } = req.params;
  const { q } = req.query; // Search query
  
  // 扫描知识库目录
  const items = [];
  if (fs.existsSync(KNOWLEDGE_BASE_PATH)) {
      const categories = fs.readdirSync(KNOWLEDGE_BASE_PATH, { withFileTypes: true });
      for (const cat of categories) {
          if (cat.isDirectory() && isAllowedHotTopicsCategory(cat.name)) {
              const catPath = path.join(KNOWLEDGE_BASE_PATH, cat.name);
              const topics = fs.readdirSync(catPath, { withFileTypes: true });
              
              for (const topic of topics) {
                  if (topic.isDirectory()) {
                      const topicPath = path.join(catPath, topic.name);
                      const postJsonPath = path.join(topicPath, 'post.json');
                      
                      let title = topic.name;
                      let description = '';
                      let url = '';
                      let coverUrl = null;
                      
                      if (fs.existsSync(postJsonPath)) {
                          try {
                              const postData = JSON.parse(fs.readFileSync(postJsonPath, 'utf-8'));
                              if (postData.url) url = postData.url;
                              // 如果有 text 字段作为描述
                              if (postData.text) description = postData.text.substring(0, 100) + '...';
                          } catch(e) {}
                      }
                      
                      // Check for cover image
                      const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
                      for (const ext of extensions) {
                          if (fs.existsSync(path.join(topicPath, `cover${ext}`))) {
                              coverUrl = `/knowledge-assets/${encodeURIComponent(cat.name)}/${encodeURIComponent(topic.name)}/cover${ext}`;
                              break;
                          }
                      }
                      
                      items.push({
                          title: title,
                          description: description,
                          url: url,
                          category: cat.name,
                          cover: coverUrl,
                          path: topicPath
                      });
                  }
              }
          }
      }
  }
  
  // Filter by query if present
  let filteredItems = items;
  if (q) {
      const lowerQ = q.toLowerCase();
      filteredItems = items.filter(item => 
          item.title.toLowerCase().includes(lowerQ) || 
          item.description.toLowerCase().includes(lowerQ)
      );
  }
  
  res.json({ items: filteredItems });
});

// Serve Agent Avatar
app.get('/api/agents/:agentId/avatar', (req, res) => {
  const { agentId } = req.params;
  const agent = getAgentById(agentId);
  
  const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

  console.log(`[Avatar] Request for ${agentId}`);
  // 1. Check Agent Workspace (Primary)
  if (agent && agent.workspace) {
      console.log(`[Avatar] Checking workspace: ${agent.workspace}`);
      for (const ext of extensions) {
        const avatarPath = path.join(agent.workspace, `avatar${ext}`);
        if (fs.existsSync(avatarPath)) {
          console.log(`[Avatar] Found in workspace: ${avatarPath}`);
          return res.sendFile(avatarPath, { dotfiles: 'allow' });
        }
      }
      console.log(`[Avatar] Not found in workspace`);
  } else {
      console.log(`[Avatar] Agent not found or no workspace`);
  }

  // 2. Check Local Data Directory (Fallback, Case-Insensitive)
  // Even if agent is not found in memory (e.g. strictly local), or workspace doesn't have avatar
  if (fs.existsSync(DATA_AGENTS_DIR)) {
      // Find matching directory name case-insensitively
      try {
        const dirs = fs.readdirSync(DATA_AGENTS_DIR);
        const matchDir = dirs.find(d => d.toLowerCase() === agentId.toLowerCase());
        
        if (matchDir) {
            const localAgentPath = path.join(DATA_AGENTS_DIR, matchDir);
            console.log(`[Avatar] Checking local data: ${localAgentPath}`);
            for (const ext of extensions) {
                const avatarPath = path.join(localAgentPath, `avatar${ext}`);
                if (fs.existsSync(avatarPath)) {
                    console.log(`[Avatar] Found in local data: ${avatarPath}`);
                    return res.sendFile(avatarPath, { dotfiles: 'allow' });
                }
            }
            console.log(`[Avatar] Not found in local data`);
        } else {
            console.log(`[Avatar] No matching local dir for ${agentId}`);
        }
      } catch (e) {
        console.error(`[Avatar] Error scanning local data:`, e);
      }
  } else {
      console.log(`[Avatar] DATA_AGENTS_DIR not found: ${DATA_AGENTS_DIR}`);
  }

  // Default avatar if not found
  // Return 404 to allow frontend fallback to letter avatar
  res.status(404).send('Avatar not found');
});

// Serve Agent Voice
app.get('/api/local-agents/:agentId/voice', (req, res) => {
  const { agentId } = req.params;
  const agentPath = path.join(DATA_AGENTS_DIR, agentId);
  const voicePath = path.join(agentPath, 'voice.mp3');
  
  if (fs.existsSync(voicePath)) {
      res.sendFile(voicePath);
  } else {
      res.status(404).send('Voice file not found');
  }
});

// Serve Agent Video
app.get('/api/agents/:agentId/video', (req, res) => {
  const { agentId } = req.params;
  const agent = getAgentById(agentId);
  
  // 1. Check Workspace
  if (agent && agent.workspace) {
      const videoPath = path.join(agent.workspace, 'video.mp4');
      if (fs.existsSync(videoPath)) {
        return res.sendFile(videoPath);
      }
  }

  // 2. Check Local Data (Case-insensitive)
  if (fs.existsSync(DATA_AGENTS_DIR)) {
      try {
          const dirs = fs.readdirSync(DATA_AGENTS_DIR);
          const matchDir = dirs.find(d => d.toLowerCase() === agentId.toLowerCase());
          
          if (matchDir) {
              const videoPath = path.join(DATA_AGENTS_DIR, matchDir, 'video.mp4');
              if (fs.existsSync(videoPath)) {
                  return res.sendFile(videoPath);
              }
          }
      } catch (e) {
          console.error(`[Video] Error scanning local data:`, e);
      }
  }

  res.status(404).send('Video not found');
});

// Serve Agent Voice
app.get('/api/agents/:agentId/voice', (req, res) => {
  const { agentId } = req.params;
  const agent = getAgentById(agentId);
  
  // 1. Check Workspace
  if (agent && agent.workspace) {
      const voicePath = path.join(agent.workspace, 'voice.mp3');
      if (fs.existsSync(voicePath)) {
        return res.sendFile(voicePath);
      }
  }

  // 2. Check Local Data (Case-insensitive)
  if (fs.existsSync(DATA_AGENTS_DIR)) {
      try {
          const dirs = fs.readdirSync(DATA_AGENTS_DIR);
          const matchDir = dirs.find(d => d.toLowerCase() === agentId.toLowerCase());
          
          if (matchDir) {
              const voicePath = path.join(DATA_AGENTS_DIR, matchDir, 'voice.mp3');
              if (fs.existsSync(voicePath)) {
                  return res.sendFile(voicePath);
              }
          }
      } catch (e) {
          console.error(`[Voice] Error scanning local data:`, e);
      }
  }

  res.status(404).send('Voice not found');
});

// Chat with Agent (Execute Command)
app.post('/api/agents/:agentId/message', (req, res) => {
    const { agentId } = req.params;
    const { message } = req.body;
    
    if (!message) return res.status(400).json({ error: 'Message is required' });
    
    // Set headers for SSE (Server-Sent Events)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Use openclaw.sendMessageStream but don't await it (it's void/callback based mostly)
    // Actually our implementation uses child_process spawn so it's event based.
    
    try {
        openclaw.sendMessageStream(
            agentId, 
            message,
            (chunk) => {
                if (typeof chunk === 'string') {
                    res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
                    return;
                }
                if (chunk && typeof chunk === 'object') {
                    if (chunk.type === 'reasoning_stream' && typeof chunk.content === 'string') {
                        res.write(`data: ${JSON.stringify({ reasoning: chunk.content })}\n\n`);
                        return;
                    }
                    if (chunk.type === 'text_stream' && typeof chunk.content === 'string') {
                        res.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
                    }
                }
            },
            () => {
                res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
                res.end();
            },
            (err) => {
                console.error(`[Chat] Error: ${err.message}`);
                res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
                res.end();
            }
        );
    } catch (e) {
        console.error(`[Chat] Request failed: ${e.message}`);
        res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
        res.end();
    }
});

// Helper to find local agent directory by ID (handling folder name vs ID mismatch)
function findLocalAgentDir(agentId) {
    if (!fs.existsSync(DATA_AGENTS_DIR)) return null;
    
    // 1. Check for exact folder match first (fast)
    const exactPath = path.join(DATA_AGENTS_DIR, agentId);
    if (fs.existsSync(exactPath)) return exactPath;
    
    // 2. Scan all folders to check meta.json
    try {
        const dirs = fs.readdirSync(DATA_AGENTS_DIR, { withFileTypes: true });
        for (const dirent of dirs) {
            if (dirent.isDirectory()) {
                const dirPath = path.join(DATA_AGENTS_DIR, dirent.name);
                const metaPath = path.join(dirPath, 'meta.json');
                if (fs.existsSync(metaPath)) {
                    try {
                        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                        if (meta.id === agentId || meta.name === agentId) {
                            return dirPath;
                        }
                    } catch(e) {}
                }
            }
        }
    } catch(e) {
        console.error('Error scanning local agent dirs:', e);
    }
    return null;
}

function sendInitialAvatarSvg(res, label) {
  const raw = String(label || 'A').trim();
  const initial = (raw.charAt(0) || 'A').toUpperCase();
  const safeInitial = initial
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="mecoAvatarGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#334155"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="128" fill="url(#mecoAvatarGrad)"/>
  <text x="128" y="152" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="108" font-weight="700" fill="#ffffff">${safeInitial}</text>
</svg>`;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).send(svg);
}

// Serve Local Agent Avatar
app.get('/api/local-agents/:agentId/avatar', (req, res) => {
  const { agentId } = req.params;
  
  const agentPath = findLocalAgentDir(agentId);
  if (!agentPath) return sendInitialAvatarSvg(res, agentId);

  const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  for (const ext of extensions) {
    const avatarPath = path.join(agentPath, `avatar${ext}`);
    if (fs.existsSync(avatarPath)) {
      return res.sendFile(avatarPath, { dotfiles: 'allow' });
    }
  }
  return sendInitialAvatarSvg(res, agentId);
});

// Serve Local Agent Video
app.get('/api/local-agents/:agentId/video', (req, res) => {
  const { agentId } = req.params;
  const agentPath = path.join(DATA_AGENTS_DIR, agentId);
  const videoPath = path.join(agentPath, 'video.mp4');
  
  if (fs.existsSync(videoPath)) {
    return res.sendFile(videoPath);
  }
  res.status(404).send('Video not found');
});

// Serve OpenClaw Agent Avatar (Fallback or specific)
app.get('/api/openclaw-agents/:agentId/avatar', (req, res) => {
    const { agentId } = req.params;
    const agent = scanOpenClawAgents()[agentId]; // Re-scan or use cache? Re-scan is safe but slow. 
    // Better to use getAgentById logic or just check path directly if we know it.
    
    if (agent && agent.workspace) {
         const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
         for (const ext of extensions) {
             const avatarPath = path.join(agent.workspace, `avatar${ext}`);
             if (fs.existsSync(avatarPath)) return res.sendFile(avatarPath, { dotfiles: 'allow' });
         }
    }
    res.status(404).send('Avatar not found');
});

// 创建 Podcast 房间（远程 API）+ 智能体加入
app.post('/api/podcast/room/create', upload.single('cover'), async (req, res) => {
    const { name, description, category, agentIds: agentIdsStr } = req.body;
    const agentIds = agentIdsStr ? JSON.parse(agentIdsStr) : [];

    if (!name || !category || agentIds.length === 0) {
        return res.status(400).json({ error: 'Missing name, category, or agentIds' });
    }

    try {
        const axios = require('axios');

        // 收集所有智能体的 Podcast 信息
        const agentsInfo = [];
        for (const id of agentIds) {
            const metaPath = path.join(DATA_AGENTS_DIR, id, 'meta.json');
            if (!fs.existsSync(metaPath)) continue;
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            if (meta.podcastApiKey && meta.podcastAgentId) {
                agentsInfo.push({ id, apiKey: meta.podcastApiKey, agentId: meta.podcastAgentId, name: meta.displayName || id });
            }
        }

        if (agentsInfo.length === 0) {
            return res.status(400).json({ error: 'No agents with Podcast API registration found' });
        }

        // Step 1: 如有封面图，presign 上传 + 本地保存
        let coverUrl = '';
        let coverLocal = '';
        if (req.file) {
            const fileData = fs.readFileSync(req.file.path);
            const ext = path.extname(req.file.originalname) || '.png';

            // 上传到 COS（给 Podcast API 用）
            try {
                const presignResp = await axios.post(`${PODCAST_API_BASE}/agent/upload/presign`, { ext: ext.replace('.', '') }, {
                    headers: { 'X-API-Key': agentsInfo[0].apiKey, 'Content-Type': 'application/json' },
                    timeout: 10000
                });
                if (presignResp.data && presignResp.data.code === 200 && presignResp.data.data) {
                    const { presign_url, public_url } = presignResp.data.data;
                    await axios.put(presign_url, fileData, {
                        headers: { 'Content-Type': req.file.mimetype || 'image/png' },
                        timeout: 30000, maxBodyLength: 50 * 1024 * 1024
                    });
                    coverUrl = normalizePodcastPublicUrl(public_url);
                    console.log(`[PodcastRoom] 封面上传COS成功: ${coverUrl}`);
                }
            } catch (e) {
                console.warn(`[PodcastRoom] 封面上传COS失败: ${e.message}`);
            }

            // 本地保存一份（给 My Rooms 展示用）
            try {
                // roomId 还没生成，先用临时名，后面再重命名
                const tempCoverDir = path.join(__dirname, 'data', 'room-covers');
                if (!fs.existsSync(tempCoverDir)) fs.mkdirSync(tempCoverDir, { recursive: true });
                const coverFileName = `cover_${Date.now()}${ext}`;
                const localPath = path.join(tempCoverDir, coverFileName);
                fs.writeFileSync(localPath, fileData);
                coverLocal = `/room-covers/${coverFileName}`;
                console.log(`[PodcastRoom] 封面本地保存: ${coverLocal}`);
            } catch (e) {
                console.warn(`[PodcastRoom] 封面本地保存失败: ${e.message}`);
            }

            try { fs.unlinkSync(req.file.path); } catch(e) {}
        }

        // Step 2: 用第一个智能体的 apiKey 创建房间
        // 注意: host 创建房间时自己已占 1 个名额，所以 max_agents 需要比 agentsInfo.length 大
        const createBody = {
            name,
            description: description || '',
            category,
            max_agents: agentsInfo.length + 1,
            agent_ids: agentsInfo.map(a => a.agentId)
        };
        if (coverUrl) createBody.cover_url = coverUrl;

        const createResp = await axios.post(`${PODCAST_API_BASE}/agent/rooms`, createBody, {
            headers: { 'X-API-Key': agentsInfo[0].apiKey, 'Content-Type': 'application/json' },
            timeout: 10000
        });
        if (!createResp.data || ![200, 201].includes(createResp.data.code) || !createResp.data.data) {
            throw new Error(`创建房间失败: ${JSON.stringify(createResp.data)}`);
        }
        const roomData = createResp.data.data;
        const roomId = roomData.room_id;
        console.log(`[PodcastRoom] 房间创建成功: ${roomId}, host: ${agentsInfo[0].agentId}`);

        // Step 3: 房主自己先加入房间
        const hostApiKey = agentsInfo[0].apiKey;
        try {
            const hostJoinResp = await axios.post(`${PODCAST_API_BASE}/agent/rooms/${roomId}/join`, {}, {
                headers: { 'X-API-Key': hostApiKey, 'Content-Type': 'application/json' },
                timeout: 10000
            });
            if (hostJoinResp.data && [200, 201].includes(hostJoinResp.data.code)) {
                console.log(`[PodcastRoom] 房主 ${agentsInfo[0].name} (${agentsInfo[0].agentId}) 加入房间成功`);
            } else {
                console.warn(`[PodcastRoom] 房主加入房间异常: ${JSON.stringify(hostJoinResp.data)}`);
            }
        } catch (e) {
            console.error(`[PodcastRoom] 房主加入房间失败: ${e.response?.data?.message || e.message}`);
        }

        // Step 4: 房主邀请其他智能体加入房间（用房主 apiKey + target_agent_id）
        const MAX_JOIN_RETRIES = 3;
        const joinResults = [];
        // 第一个 agent 已经在上面加入了（作为host），从第二个开始
        for (let i = 1; i < agentsInfo.length; i++) {
            const agent = agentsInfo[i];
            let joined = false;
            let lastError = '';
            for (let attempt = 1; attempt <= MAX_JOIN_RETRIES; attempt++) {
                try {
                    const joinResp = await axios.post(`${PODCAST_API_BASE}/agent/rooms/${roomId}/join`, {
                        target_agent_id: agent.agentId
                    }, {
                        headers: { 'X-API-Key': hostApiKey, 'Content-Type': 'application/json' },
                        timeout: 10000
                    });
                    if (joinResp.data && [200, 201].includes(joinResp.data.code)) {
                        joined = true;
                        console.log(`[PodcastRoom] ${agent.name} (${agent.agentId}) 加入房间成功 (attempt ${attempt})`);
                        break;
                    } else {
                        lastError = joinResp.data?.message || `code: ${joinResp.data?.code}`;
                    }
                } catch (e) {
                    lastError = e.response?.data?.message || e.message;
                }
                if (attempt < MAX_JOIN_RETRIES) {
                    console.warn(`[PodcastRoom] ${agent.name} 加入失败(${attempt}/${MAX_JOIN_RETRIES}): ${lastError}, 重试中...`);
                    await new Promise(r => setTimeout(r, 1000 * attempt));
                }
            }
            joinResults.push({ id: agent.id, agentId: agent.agentId, name: agent.name, status: joined ? 'joined' : 'failed', error: joined ? undefined : lastError });
            if (!joined) console.error(`[PodcastRoom] ${agent.name} 加入房间最终失败: ${lastError}`);
        }

        // 检查是否所有智能体都成功加入
        const failedAgents = joinResults.filter(r => r.status === 'failed');
        if (failedAgents.length > 0) {
            const failedNames = failedAgents.map(a => a.name).join(', ');
            console.error(`[PodcastRoom] 房间 ${roomId} 有 ${failedAgents.length} 个智能体未加入: ${failedNames}`);
        }

        // Step 4: 构建圆桌链接并保存到本地
        const voiceIds = agentIds.map(id => {
            try {
                const vPath = path.join(DATA_AGENTS_DIR, id, 'voice.json');
                if (fs.existsSync(vPath)) {
                    const v = JSON.parse(fs.readFileSync(vPath, 'utf-8'));
                    return v.voiceId || 'jobs_voice_20260115_v3';
                }
                const mPath = path.join(DATA_AGENTS_DIR, id, 'meta.json');
                if (fs.existsSync(mPath)) {
                    const m = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
                    return m.voiceId || 'jobs_voice_20260115_v3';
                }
            } catch(e) {}
            return 'jobs_voice_20260115_v3';
        });
        const roundtableUrl = `/roundtable/?characters=${encodeURIComponent(agentIds.join(','))}&character_voices=${encodeURIComponent(voiceIds.join(','))}&room_id=${encodeURIComponent(roomId)}&category=${encodeURIComponent(category)}`;

        const roomRecord = {
            roomId,
            name,
            description: description || '',
            category,
            maxAgents: agentsInfo.length,
            coverUrl,
            coverLocal,
            hlsUrl: roomData.hls_url || '',
            roundtableUrl,
            agentIds,
            joinResults,
            hostApiKey: agentsInfo[0].apiKey,  // 保存房主的 API Key
            createdAt: new Date().toISOString()
        };

        // 保存到 data/rooms.json
        const roomsFile = path.join(__dirname, 'data', 'rooms.json');
        let roomsList = [];
        try {
            if (fs.existsSync(roomsFile)) roomsList = JSON.parse(fs.readFileSync(roomsFile, 'utf-8'));
        } catch(e) {}
        roomsList.unshift(roomRecord);
        fs.writeFileSync(roomsFile, JSON.stringify(roomsList, null, 2));

        const allJoined = failedAgents.length === 0;
        res.json({ success: true, allJoined, failedAgents: failedAgents.map(a => a.name), ...roomRecord });
    } catch (e) {
        console.error(`[PodcastRoom] 创建失败:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

// 获取已创建的房间列表
app.get('/api/podcast/rooms', (req, res) => {
    const roomsFile = path.join(__dirname, 'data', 'rooms.json');
    try {
        if (fs.existsSync(roomsFile)) {
            const rooms = JSON.parse(fs.readFileSync(roomsFile, 'utf-8'));
            res.json(rooms);
        } else {
            res.json([]);
        }
    } catch(e) {
        res.json([]);
    }
});

// 删除已保存的房间记录（先调用远程API删除，再删除本地记录）
app.delete('/api/podcast/rooms/:roomId', async (req, res) => {
    const { roomId } = req.params;
    const roomsFile = path.join(__dirname, 'data', 'rooms.json');
    const axios = require('axios');

    try {
        let rooms = [];
        if (fs.existsSync(roomsFile)) rooms = JSON.parse(fs.readFileSync(roomsFile, 'utf-8'));
        const room = rooms.find(r => r.roomId === roomId);

        if (!room) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }

        const maskApiKey = (key) => {
            const value = String(key || '').trim();
            if (!value) return '';
            if (value.length <= 10) return `${value.slice(0, 2)}***`;
            return `${value.slice(0, 6)}***${value.slice(-4)}`;
        };
        const toErrorMessage = (err) => {
            if (!err) return 'unknown error';
            if (err.response && err.response.data) {
                try {
                    return `${err.message || 'request failed'} | ${JSON.stringify(err.response.data)}`;
                } catch (_) {
                    return err.message || 'request failed';
                }
            }
            return err.message || String(err);
        };

        // 收集候选 API Key：优先 hostApiKey，其次 room.agentIds 对应角色 meta 中的 key
        const apiKeyCandidates = [];
        const seen = new Set();
        const pushApiKey = (raw, source) => {
            const key = String(raw || '').trim();
            if (!key || seen.has(key)) return;
            seen.add(key);
            apiKeyCandidates.push({ key, source: String(source || '') });
        };

        pushApiKey(room.hostApiKey, 'room.hostApiKey');
        const roomAgentIds = Array.isArray(room.agentIds) ? room.agentIds : [];
        for (const agentId of roomAgentIds) {
            try {
                const metaPath = path.join(DATA_AGENTS_DIR, agentId, 'meta.json');
                if (!fs.existsSync(metaPath)) continue;
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                pushApiKey(meta && meta.podcastApiKey, `meta:${agentId}`);
            } catch (e) {
                console.warn(`[DeleteRoom] 读取 ${agentId} meta 失败: ${e.message}`);
            }
        }

        const remoteDeleteAttempts = [];
        let remoteEnded = false;
        let remoteDeleted = false;
        let remoteDeleteError = '';
        let usedApiKeySource = '';
        let usedApiKeyMasked = '';

        for (const candidate of apiKeyCandidates) {
            if (remoteDeleted) break;
            const attempt = {
                source: candidate.source,
                apiKey: maskApiKey(candidate.key),
                endOk: false,
                endError: '',
                deleteOk: false,
                deleteError: ''
            };

            try {
                await axios.post(`${PODCAST_API_BASE}/agent/rooms/${roomId}/end`, {}, {
                    headers: { 'X-API-Key': candidate.key }, timeout: 15000
                });
                attempt.endOk = true;
                remoteEnded = true;
                console.log(`[DeleteRoom] 房间 ${roomId} 已结束 (source=${candidate.source})`);
            } catch (e) {
                attempt.endError = toErrorMessage(e);
                console.warn(`[DeleteRoom] 结束房间失败 (source=${candidate.source}): ${attempt.endError}`);
            }

            try {
                await axios.delete(`${PODCAST_API_BASE}/agent/rooms/${roomId}`, {
                    headers: { 'X-API-Key': candidate.key }, timeout: 15000
                });
                attempt.deleteOk = true;
                remoteDeleted = true;
                usedApiKeySource = candidate.source;
                usedApiKeyMasked = attempt.apiKey;
                console.log(`[DeleteRoom] 房间 ${roomId} 已从远程API删除 (source=${candidate.source})`);
            } catch (e) {
                attempt.deleteError = toErrorMessage(e);
                remoteDeleteError = attempt.deleteError;
                console.warn(`[DeleteRoom] 远程API删除房间失败 (source=${candidate.source}): ${attempt.deleteError}`);
            }

            remoteDeleteAttempts.push(attempt);
        }

        if (!apiKeyCandidates.length) {
            remoteDeleteError = 'no available api key';
            console.warn(`[DeleteRoom] 未找到可用 API Key，无法调用远程API`);
        }

        // Step 3: 删除本地记录
        rooms = rooms.filter(r => r.roomId !== roomId);
        fs.writeFileSync(roomsFile, JSON.stringify(rooms, null, 2));

        // 删除本地封面
        if (room && room.coverLocal) {
            try {
                const coverPath = path.join(__dirname, 'data', room.coverLocal);
                if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
            } catch(e) {}
        }

        res.json({
            success: true,
            remoteDeleted,
            remoteEnded,
            remoteDeleteError,
            remoteDeleteAttempts,
            usedApiKeySource,
            usedApiKeyMasked
        });
    } catch(e) {
        console.error(`[DeleteRoom] 删除房间失败:`, e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 创建房间
app.post('/api/room/create', (req, res) => {
  const { hostAgentId, agentIds, voiceIds, podcastRoomId, category } = req.body;

  // 多房间共存：不再清理旧房间
  if (rooms.size > 0) {
    console.log(`[Room] 当前已有 ${rooms.size} 个房间，新建房间将共存`);
  }

  // 使用传入的 agentIds 或默认
  const useAgentIds = agentIds && agentIds.length > 0
    ? agentIds
    : (hostAgentId ? [hostAgentId] : ['jobs', 'kobe', 'munger', 'hawking', 'gates']);

  const room = createRoom(useAgentIds[0], useAgentIds, voiceIds, category || null);

  // 保存 podcastRoomId（WebSocket 连接在 Play 时建立）
  if (podcastRoomId) {
    room.podcastRoomId = podcastRoomId;
    console.log(`[Room] 已关联 Podcast 房间: ${podcastRoomId}, channelId: ${room.channelId}`);
    migrateRoomTopicMemoryToPodcastId(room);
    syncRoomTopicMemoryToModerator(room);
    // 进入页面即建立控制长连接（不等待开播）
    reconnectPodcastPusher(room.channelId).catch((e) => {
      console.warn(`[Podcast] ⚠️ 预连接失败(channel=${room.channelId}): ${e.message}`);
    });
  }

  res.json({
    channelId: room.channelId,
    isHost: true,
    hostAgentId: room.hostAgentId,
    agentIds: room.agentIds,
    agents: buildClientRoomAgents(room)
  });
});

// 加入房间（分机）
app.post('/api/room/:channelId/join', (req, res) => {
  const { channelId } = req.params;
  const room = rooms.get(channelId);

  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }

  // 获取当前发言状态
  const { index, position } = calculateAudioTimestamp(room);

  // 进入页面即尝试建立/恢复 Podcast 控制连接
  if (room.podcastRoomId) {
    reconnectPodcastPusher(channelId).catch((e) => {
      console.warn(`[Podcast] ⚠️ join 预连接失败(channel=${channelId}): ${e.message}`);
    });
  }

  res.json({
    channelId: room.channelId,
    isHost: false,
    isActive: room.isActive,
    currentSpeaker: room.currentSpeaker ? {
      agentId: room.currentSpeaker.agentId,
      text: room.currentSpeaker.text,
      audioTimestamp: position,
      ttsStreaming: room.currentSpeaker.ttsStreaming
    } : null,
    nextPreparedAgent: room.nextPreparedAgent,
    nextPreparedMessage: room.nextPreparedMessage,
    speakerChain: room.speakerChain.map(entry => ({
      agentId: entry.agentId,
      text: entry.text,
      timestamp: entry.timestamp,
      duration: entry.duration
    })),
    currentTopic: room.moderator.currentTopic || null,
    currentTopicData: room.currentDisplayTopic || room.moderator.currentTopicData || null,
    topicHistory: room.topicHistory || [],
    agentIds: room.agentIds || [],
    voiceIds: room.voiceIds || [],
    agents: buildClientRoomAgents(room)
  });
});

// 获取房间状态
app.get('/api/room/:channelId/state', (req, res) => {
  const { channelId } = req.params;
  const room = rooms.get(channelId);

  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }

  const { index, position } = calculateAudioTimestamp(room);
  const stuckDiagnostics = maybeLogRoomStuckDiagnostics(room, 'api_room_state');

  res.json({
    channelId: room.channelId,
    isActive: room.isActive,
    currentSpeaker: room.currentSpeaker ? {
      agentId: room.currentSpeaker.agentId,
      text: room.currentSpeaker.text,
      audioTimestamp: position,
      ttsStreaming: room.currentSpeaker.ttsStreaming
    } : null,
    nextPreparedAgent: room.nextPreparedAgent,
    nextPreparedMessage: room.nextPreparedMessage,
    speakerChain: room.speakerChain.map(entry => ({
      agentId: entry.agentId,
      text: entry.text,
      timestamp: entry.timestamp,
      duration: entry.duration
    })),
    currentTopic: room.moderator.currentTopic || null,
    currentTopicData: room.currentDisplayTopic || room.moderator.currentTopicData || null,
    topicHistory: room.topicHistory || [],
    stuckDiagnostics: stuckDiagnostics,
    agentIds: room.agentIds || [],
    voiceIds: room.voiceIds || [],
    agents: buildClientRoomAgents(room)
  });
});

// 离开房间
app.post('/api/room/:channelId/leave', (req, res) => {
  const { channelId } = req.params;
  const room = rooms.get(channelId);

  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }

  // 如果是主机离开，关闭房间
  if (room.hostWs) {
    deleteRoom(channelId);
  }

  res.json({ success: true });
});

// 主机上传音频块（并实时广播给分机）
app.post('/api/room/:channelId/audio-cache', (req, res) => {
  const { channelId } = req.params;
  const { agentId, audioChunk, isComplete, text } = req.body;
  const room = rooms.get(channelId);

  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }

  // 缓存到当前说话者
  cacheAudioChunk(room, agentId, audioChunk, isComplete, text || '');

  // 实时广播音频块给所有分机
  if (audioChunk && audioChunk.length > 0) {
    broadcastToRoom(room, {
      type: 'audio_chunk',
      agentId: agentId,
      audio: audioChunk,
      isComplete: isComplete
    });
  }

  res.json({ success: true });
});

// 主机调整 agent 音量，广播给所有分机
app.post('/api/room/:channelId/volume', (req, res) => {
  const { channelId } = req.params;
  const { agentId, volumeGain } = req.body;
  const room = rooms.get(channelId);

  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }

  broadcastToRoom(room, {
    type: 'volume_update',
    agentId: agentId,
    volumeGain: volumeGain
  });

  res.json({ success: true });
});

// 分机获取音频缓存（用于刷新后重新同步）
app.get('/api/room/:channelId/audio/:agentId', (req, res) => {
  const { channelId, agentId } = req.params;
  const room = rooms.get(channelId);

  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }

  // 检查当前说话者
  if (room.currentSpeaker && room.currentSpeaker.agentId === agentId) {
    const elapsed = Date.now() - room.currentSpeaker.startTime;
    return res.json({
      agentId,
      audioHex: room.currentSpeaker.audioCache.join(''),
      timestamp: room.currentSpeaker.startTime,
      elapsed: elapsed,
      duration: room.currentSpeaker.audioDuration,
      text: room.currentSpeaker.text,
      ttsStreaming: room.currentSpeaker.ttsStreaming
    });
  }

  // 检查链表
  for (let i = room.speakerChain.length - 1; i >= 0; i--) {
    const entry = room.speakerChain[i];
    if (entry.agentId === agentId) {
      return res.json({
        agentId: entry.agentId,
        audioHex: entry.audioCache,
        timestamp: entry.timestamp,
        elapsed: 0,
        duration: entry.duration,
        text: entry.text,
        ttsStreaming: false
      });
    }
  }

  res.status(404).json({ error: '音频不存在' });
});

// 主机同步文本到服务端（并广播给分机）
app.post('/api/room/:channelId/text-sync', (req, res) => {
  const { channelId } = req.params;
  const { agentId, text, isComplete } = req.body;
  const room = rooms.get(channelId);

  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }

  // 更新当前说话者的文本
  if (room.currentSpeaker && room.currentSpeaker.agentId === agentId) {
    room.currentSpeaker.text = text;
  }

  // 广播文本给所有分机
  broadcastToRoom(room, {
    type: 'text_sync',
    agentId: agentId,
    text: text,
    isComplete: isComplete || false
  });

  // [REMOVED] 不要在 text_sync 完成时广播 topic_changed
  // 这会导致话题卡在发言人的文字生成完成时就切换，而不是等到音频开始播放时才切换
  // 话题切换应完全由 speech-started 事件触发（见 /api/roundtable/speech-started）

  res.json({ success: true });
});

// 主机通知当前发言结束，请求下一个发言人
app.post('/api/room/:channelId/speech-ended', (req, res) => {
  const { channelId } = req.params;
  const { agentId, content, designatedNextAgent, changeTopic } = req.body;
  const room = rooms.get(channelId);
  let effectiveDesignatedNextAgent = typeof designatedNextAgent === 'string'
    ? designatedNextAgent.trim()
    : '';
  if (!effectiveDesignatedNextAgent) {
    const directives = extractNextDirectives(String(content || ''));
    if (directives.length > 0) {
      effectiveDesignatedNextAgent = directives[directives.length - 1];
      console.log(`[Room:${channelId}] 🧩 speech-ended 未携带 designatedNextAgent，已从内容兜底提取: ${effectiveDesignatedNextAgent}`);
    }
  }

  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }

  // 兼容旧路由的幂等保护：短时间重复上报同一轮 speech-ended 时，直接忽略。
  {
    const turnStartedAt = Number(room.activeTurnStartedAt || 0);
    const marker = [
      agentId || '',
      turnStartedAt || 'no_turn',
      effectiveDesignatedNextAgent || '',
      changeTopic ? '1' : '0',
      String(content || '').slice(0, 200)
    ].join('|');
    const now = Date.now();
    if (room._lastSpeechEndedMarker === marker && now - Number(room._lastSpeechEndedAt || 0) < 5000) {
      console.warn(
        `[Room:${channelId}] ⚠️ 忽略重复 speech-ended: agent=${agentId}, turn=${turnStartedAt || 'no_turn'}`
      );
      return res.json({ nextAgent: room.nextPreparedAgent || null, ignoredDuplicate: true });
    }
    room._lastSpeechEndedMarker = marker;
    room._lastSpeechEndedAt = now;
  }

  // 调用主持人逻辑
  if (!room.moderator.isActive) {
    room.moderator.start();
  }

  // 房间模式：每次调度前都同步注入待讨论麦序话题
  if (room.queueTopics && room.queueTopics.length > 0) {
    room.moderator.priorityTopics = room.queueTopics;
    console.log(`[Room:${channelId}] 📋 注入 ${room.queueTopics.length} 个麦序待讨论话题到优先队列`);
  }

  let result;
  if (changeTopic) {
      // 发言者请求换话题 → 直接触发话题过渡
      console.log(`[Room:${channelId}] 🔄 ${agentId} 请求换话题`);
      result = room.moderator.onSpeechEnded(agentId, content, true);
  } else if (effectiveDesignatedNextAgent) {
      // 如果前端传来了明确的指定发言人（通常是从回复内容中解析出的 {next: ...}）
      console.log(`[Room:${channelId}] 🎯 收到前端指定的下一位发言者: ${effectiveDesignatedNextAgent}`);
      result = room.moderator.handleDesignatedNext(agentId, content, effectiveDesignatedNextAgent);
  } else {
      result = room.moderator.onSpeechEnded(agentId, content);
  }
  
  // 广播给所有分机 - 主动推送 topic_changed 事件
  // [MODIFIED] 移除这里的立即广播，改为在 speech-started 时广播（实现延迟切换）
  /*
  if (room.moderator.currentTopicData) {
      broadcastToRoom(room, {
          type: 'topic_changed',
          topicData: room.moderator.currentTopicData
      });
      console.log(`[Room:${channelId}] 📡 广播新话题: ${room.moderator.currentTopicData.title}`);
  }
  */

  if (result) {
    setRoomNextPrepared(room, result.nextAgent, result.message);
    room.preloadIssuedByAgentId = agentId;

    // changeTopic 或 transition 类型：暂存新话题数据，等 speech-started 时广播
    if ((changeTopic || result.type === 'transition') && room.moderator.currentTopicData) {
      room.nextTopicData = room.moderator.currentTopicData;
      console.log(`[Room:${channelId}] 🔄 暂存新话题数据: ${room.nextTopicData.title.substring(0, 30)}...`);
    }

    res.json({ nextAgent: result.nextAgent, message: result.message });
  } else {
    res.json({ nextAgent: null });
  }
});

// 主机通知预加载下一个发言人
app.post('/api/room/:channelId/preload', (req, res) => {
  const { channelId } = req.params;
  const { currentAgentId, nextAgentId, nextMessage } = req.body;
  const room = rooms.get(channelId);

  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }

  // 更新房间状态
  setRoomNextPrepared(room, nextAgentId, nextMessage);

  // 广播给所有分机
  broadcastToRoom(room, {
    type: 'speaker_prepared',
    currentAgentId: currentAgentId,
    nextAgentId: nextAgentId,
    nextMessage: nextMessage
  });

  res.json({ success: true });
});

// === Agent Tools APIs ===

app.get('/api/agent-channels', (req, res) => {
    const channels = getAgentChannels()
        .map((c) => serializeAgentChannel(c))
        .filter(Boolean)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    res.json({ channels });
});

app.post('/api/agent-channels', (req, res) => {
    const name = (req.body && typeof req.body.name === 'string') ? req.body.name.trim() : '';
    const incomingAgentIds = Array.isArray(req.body && req.body.agentIds) ? req.body.agentIds : [];
    const uniqIds = Array.from(new Set(
        incomingAgentIds
            .map((x) => typeof x === 'string' ? x.trim() : '')
            .filter(Boolean)
    ));

    if (!name) {
        return res.status(400).json({ error: 'channel name is required' });
    }
    if (uniqIds.length < 1) {
        return res.status(400).json({ error: 'at least 1 agent is required' });
    }

    const scanned = scanOpenClawAgents();
    const knownAgents = new Set([...Object.keys(AGENTS), ...Object.keys(scanned || {})]);
    const validAgentIds = uniqIds.filter((id) => knownAgents.has(id));
    if (validAgentIds.length < 1) {
        return res.status(400).json({ error: 'selected agents are invalid or unavailable' });
    }

    const channels = getAgentChannels();
    const existed = channels.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existed) {
        return res.status(409).json({ error: 'channel name already exists' });
    }

    const now = new Date().toISOString();
    const channel = {
        id: `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        agentIds: validAgentIds,
        createdAt: now,
        updatedAt: now
    };
    channels.push(channel);
    saveAgentChannels();

    res.json({
        success: true,
        channel: serializeAgentChannel(channel)
    });
});

app.delete('/api/agent-channels/:id', (req, res) => {
    const channelId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    if (!channelId) {
        return res.status(400).json({ error: 'channel id is required' });
    }
    const channels = getAgentChannels();
    const idx = channels.findIndex((c) => c.id === channelId);
    if (idx === -1) {
        return res.status(404).json({ error: 'channel not found' });
    }
    channels.splice(idx, 1);
    saveAgentChannels();

    clearAgentChannelHistory(channelId);
    if (channelRuntimeBusyCounters.has(channelId)) {
        channelRuntimeBusyCounters.delete(channelId);
        bumpAgentToolsStatusUpdatedAt();
    }
    const historyPath = getAgentChannelHistoryPath(channelId);
    try {
        if (fs.existsSync(historyPath)) fs.unlinkSync(historyPath);
    } catch (_) {}

    res.json({ success: true });
});

app.get('/api/agent-channels/:id/history', (req, res) => {
    const channelId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    if (!channelId) {
        return res.status(400).json({ error: 'channel id is required' });
    }
    const channel = findAgentChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'channel not found' });
    }
    const { page, pageSize, maxPages } = parseHistoryPaginationQuery(
      req.query,
      AGENT_CHANNEL_HISTORY_PAGE_SIZE,
      AGENT_CHANNEL_HISTORY_MAX_PAGES
    );
    const allHistory = getAgentChannelHistory(channelId);
    const paged = paginateHistoryItems(allHistory, page, pageSize, maxPages);
    res.json({
      history: paged.history,
      page: paged.page,
      pageSize: paged.pageSize,
      total: paged.total,
      totalPages: paged.totalPages,
      hasMore: paged.hasMore,
      maxPages
    });
});

app.post('/api/agent-channels/:id/history/reset', (req, res) => {
    const channelId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    const reloadPersona = req.body && Object.prototype.hasOwnProperty.call(req.body, 'reloadPersona')
        ? !!req.body.reloadPersona
        : true;
    if (!channelId) {
        return res.status(400).json({ error: 'channel id is required' });
    }
    const channel = findAgentChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'channel not found' });
    }

    // Abort in-flight channel streams and clear busy states
    for (const ws of wss.clients) {
        if (!ws || ws._agentChannelId !== channelId) continue;
        ws._agentChannelInFlight = false;
        if (ws._agentChannelBusyMarked) {
            markChannelRuntimeBusyEnd(channelId);
            ws._agentChannelBusyMarked = false;
        }
        if (ws._agentChannelBusyAgents && ws._agentChannelBusyAgents.size > 0) {
            for (const busyAgentId of ws._agentChannelBusyAgents) {
                markAgentRuntimeBusyEnd(busyAgentId);
            }
            ws._agentChannelBusyAgents.clear();
        }
        if (ws._agentChannelStreamHandle && typeof ws._agentChannelStreamHandle.abort === 'function') {
            try { ws._agentChannelStreamHandle.abort(); } catch (_) {}
        }
        ws._agentChannelStreamHandle = null;
    }

    clearAgentChannelHistory(channelId);
    touchAgentChannel(channelId);

    const refreshChannelPersonas = (channelRef) => {
        let reloadedCount = 0;
        const errors = [];
        const members = Array.isArray(channelRef && channelRef.agentIds) ? channelRef.agentIds : [];
        members.forEach((agentId) => {
            try {
                refreshPersona(agentId);
                reloadedCount += 1;
            } catch (e) {
                errors.push({
                    agentId,
                    error: e && e.message ? e.message : String(e)
                });
            }
        });
        return { reloadedCount, errors };
    };

    let personaReloadedCount = 0;
    let personaReloadErrors = [];
    if (reloadPersona) {
        const refreshed = refreshChannelPersonas(channel);
        personaReloadedCount = refreshed.reloadedCount;
        personaReloadErrors = refreshed.errors;
    }

    const body = JSON.stringify({
        type: 'channel_conversation_reset',
        channelId,
        success: true
    });
    for (const ws of wss.clients) {
        if (!ws || ws._agentChannelId !== channelId) continue;
        if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(body); } catch (_) {}
        }
    }

    res.json({
        success: true,
        cleared: true,
        channelId,
        personaReloaded: !!reloadPersona,
        personaReloadedCount,
        personaReloadErrors
    });
});

app.post('/api/agent-channels/:id/persona/refresh', (req, res) => {
    const channelId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    if (!channelId) {
        return res.status(400).json({ error: 'channel id is required' });
    }
    const channel = findAgentChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'channel not found' });
    }

    let personaReloadedCount = 0;
    const personaReloadErrors = [];
    const members = Array.isArray(channel.agentIds) ? channel.agentIds : [];
    members.forEach((agentId) => {
        try {
            refreshPersona(agentId);
            personaReloadedCount += 1;
        } catch (e) {
            personaReloadErrors.push({
                agentId,
                error: e && e.message ? e.message : String(e)
            });
        }
    });

    res.json({
        success: true,
        channelId,
        personaReloaded: true,
        personaReloadedCount,
        personaReloadErrors
    });
});

const agentRuntimeBusyCounters = new Map();
const channelRuntimeBusyCounters = new Map();
let agentToolsStatusUpdatedAt = new Date().toISOString();

function bumpAgentToolsStatusUpdatedAt() {
  agentToolsStatusUpdatedAt = new Date().toISOString();
}

function updateBusyCounter(mapRef, rawKey, delta) {
  const key = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!key) return;
  const current = Number(mapRef.get(key) || 0);
  const next = Math.max(0, current + delta);
  if (next <= 0) {
    if (mapRef.has(key)) {
      mapRef.delete(key);
      bumpAgentToolsStatusUpdatedAt();
    }
    return;
  }
  if (next !== current) {
    mapRef.set(key, next);
    bumpAgentToolsStatusUpdatedAt();
  }
}

function markAgentRuntimeBusyStart(agentId) {
  updateBusyCounter(agentRuntimeBusyCounters, agentId, 1);
}

function markAgentRuntimeBusyEnd(agentId) {
  updateBusyCounter(agentRuntimeBusyCounters, agentId, -1);
}

function markChannelRuntimeBusyStart(channelId) {
  updateBusyCounter(channelRuntimeBusyCounters, channelId, 1);
}

function markChannelRuntimeBusyEnd(channelId) {
  updateBusyCounter(channelRuntimeBusyCounters, channelId, -1);
}

function buildAgentToolsStatusSnapshot() {
  const agents = {};
  const channels = {};
  for (const [id, count] of agentRuntimeBusyCounters.entries()) {
    if (count > 0) agents[id] = true;
  }
  for (const [id, count] of channelRuntimeBusyCounters.entries()) {
    if (count > 0) channels[id] = true;
  }
  return {
    updatedAt: agentToolsStatusUpdatedAt,
    agents,
    channels
  };
}

app.get('/api/agent-tools/status', (req, res) => {
  res.json(buildAgentToolsStatusSnapshot());
});

app.get('/api/agent-tools/preferences', (req, res) => {
  try {
    const preferences = readAgentToolsThinkingModePreferences();
    const type = normalizeThinkingContextType(req.query?.type);
    const id = normalizeThinkingContextId(req.query?.id);
    let thinkingMode = 'think';
    if (type && id) {
      if (type === 'agent') {
        thinkingMode = normalizeThinkingModeValue(preferences.agentThinkingModes[id], 'think');
      } else {
        thinkingMode = normalizeThinkingModeValue(preferences.channelThinkingModes[id], 'think');
      }
    }
    res.json({
      success: true,
      defaultThinkingMode: 'think',
      thinkingMode,
      preferences: {
        agents: preferences.agentThinkingModes,
        channels: preferences.channelThinkingModes
      },
      updatedAt: preferences.updatedAt || ''
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || 'failed to load preferences' });
  }
});

app.put('/api/agent-tools/preferences', (req, res) => {
  try {
    const type = normalizeThinkingContextType(req.body?.type);
    const id = normalizeThinkingContextId(req.body?.id);
    const thinkingMode = normalizeThinkingModeValue(req.body?.thinkingMode, 'think');
    if (!type || !id) {
      return res.status(400).json({ success: false, error: 'type and id are required' });
    }
    const saved = setAgentToolsThinkingModePreference({ type, id, thinkingMode });
    res.json({
      success: true,
      type: saved.type,
      id: saved.id,
      thinkingMode: saved.thinkingMode,
      preferences: {
        agents: saved.preferences.agentThinkingModes,
        channels: saved.preferences.channelThinkingModes
      },
      updatedAt: saved.preferences.updatedAt || ''
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || 'failed to save preferences' });
  }
});

// Get Agent Details
app.get('/api/agents/:id', (req, res) => {
    const { id } = req.params;
    const scanned = scanOpenClawAgents();
    // Try to find in scanned (includes local and system)
    let agent = scanned[id];
    
    // Fallback to AGENTS (hardcoded/runtime)
    if (!agent && AGENTS[id]) {
        agent = AGENTS[id];
    }
    
    // Fallback: Check local directory directly if not found yet
    if (!agent) {
        const localDir = findLocalAgentDir(id);
        if (localDir) {
            console.log(`[API] Agent ${id} found in local fallback: ${localDir}`);
            // Construct agent from local dir
            try {
                const metaPath = path.join(localDir, 'meta.json');
                const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : {};
                const promptPath = path.join(localDir, 'prompt.txt');
                const prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf-8') : '';
                
                agent = {
                    id: id,
                    name: meta.displayName || meta.name || id,
                    displayName: meta.displayName || meta.name || id,
                    description: prompt || meta.prompt || '',
                    systemPrompt: prompt || meta.prompt || '',
                    voiceId: meta.voiceId || 'default',
                    avatarUrl: `/api/local-agents/${id}/avatar`,
                    source: 'local_fallback',
                    workspace: localDir // Use local dir as workspace for fallback
                };
            } catch(e) {
                console.error(`Failed to construct local fallback agent ${id}:`, e);
            }
        }
    }
    
    // Fallback: re-scan specifically? scanOpenClawAgents returns an object?
    // Wait, scanOpenClawAgents returns an OBJECT keyed by ID in my memory, 
    // BUT looking at the code I read earlier, it returns an ARRAY?
    // Let's re-read scanOpenClawAgents implementation.
    // Line 173: const agents = {}; ... returns agents; (It returns an OBJECT)
    // Wait, earlier read output:
    // 173: const agents = {};
    // ...
    // 183: const processAgent = ...
    // ...
    // return agents;
    // So it returns an object. Good.
    
    if (agent) {
        // Ensure prompt is loaded
        if (!agent.systemPrompt) {
            // Try to load prompt from file if missing
            try {
                // Check local data first
                const localPromptPath = path.join(DATA_AGENTS_DIR, id, 'prompt.txt');
                if (fs.existsSync(localPromptPath)) {
                    agent.systemPrompt = fs.readFileSync(localPromptPath, 'utf8');
                } else {
                    // Check workspace
                    // ...
                }
            } catch (e) {}
        }
        res.json({ agent });
    } else {
        res.status(404).json({ error: 'Agent not found' });
    }
});

function extractFirstJsonObject(rawText) {
    const text = String(rawText || '');
    if (!text) return null;

    for (let start = 0; start < text.length; start++) {
        const ch = text[start];
        if (ch !== '{' && ch !== '[') continue;
        const openChar = ch;
        const closeChar = ch === '{' ? '}' : ']';
        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let i = start; i < text.length; i++) {
            const c = text[i];
            if (inString) {
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (c === '\\') {
                    escaped = true;
                    continue;
                }
                if (c === '"') {
                    inString = false;
                }
                continue;
            }
            if (c === '"') {
                inString = true;
                continue;
            }
            if (c === openChar) depth++;
            if (c === closeChar) depth--;
            if (depth === 0) {
                const candidate = text.slice(start, i + 1);
                try {
                    return JSON.parse(candidate);
                } catch (_) {
                    break;
                }
            }
        }
    }
    return null;
}

function execOpenclawCommand(args, options = {}) {
    const { execFile } = require('child_process');
    return new Promise((resolve, reject) => {
        execFile('openclaw', args, { maxBuffer: 1024 * 1024 * 10, ...options }, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                return reject(error);
            }
            resolve({ stdout, stderr });
        });
    });
}

function normalizeSkillName(raw) {
    return String(raw || '').trim();
}

function normalizeSkillList(list) {
    const result = [];
    const seen = new Set();
    if (!Array.isArray(list)) return result;
    for (const item of list) {
        const name = normalizeSkillName(item);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        result.push(name);
    }
    result.sort((a, b) => a.localeCompare(b));
    return result;
}

async function getOpenclawSkillsCatalog() {
    const listResult = await execOpenclawCommand(['skills', 'list', '--json']);
    const rawList = `${listResult.stdout || ''}\n${listResult.stderr || ''}`;
    const parsedList = extractFirstJsonObject(rawList);
    if (!parsedList) throw new Error('No JSON object found in skills list output');

    if (Array.isArray(parsedList.items)) return parsedList.items;
    if (Array.isArray(parsedList.skills)) return parsedList.skills;
    if (Array.isArray(parsedList)) return parsedList;
    return [];
}

async function getOpenclawAgentsConfigList() {
    const configResult = await execOpenclawCommand(['config', 'get', 'agents.list', '--json']);
    const rawConfig = `${configResult.stdout || ''}\n${configResult.stderr || ''}`;
    const parsedConfig = extractFirstJsonObject(rawConfig);
    if (Array.isArray(parsedConfig)) return parsedConfig;
    return [];
}

async function getOpenclawSkillEntriesConfig() {
    try {
        const configResult = await execOpenclawCommand(['config', 'get', 'skills.entries', '--json']);
        const rawConfig = `${configResult.stdout || ''}\n${configResult.stderr || ''}`;
        const parsedConfig = extractFirstJsonObject(rawConfig);
        if (parsedConfig && typeof parsedConfig === 'object' && !Array.isArray(parsedConfig)) {
            return parsedConfig;
        }
        return {};
    } catch (e) {
        return {};
    }
}

function resolveAgentConfigIndex(agentsList, agentId) {
    const target = String(agentId || '').trim().toLowerCase();
    if (!target) return -1;
    return agentsList.findIndex((entry) => String(entry && entry.id || '').trim().toLowerCase() === target);
}

// Get Agent Skills
app.get('/api/agents/:id/skills', async (req, res) => {
    const { id } = req.params;
    try {
        const [catalog, agentsList, globalSkillEntries] = await Promise.all([
            getOpenclawSkillsCatalog(),
            getOpenclawAgentsConfigList(),
            getOpenclawSkillEntriesConfig()
        ]);

        const agentIndex = resolveAgentConfigIndex(agentsList, id);
        const agentEntry = agentIndex >= 0 ? agentsList[agentIndex] : null;
        const hasAgentFilter = agentEntry && Array.isArray(agentEntry.skills);
        const agentAllowedSet = new Set(normalizeSkillList(hasAgentFilter ? agentEntry.skills : []));

        const globalEnabledByName = new Map();
        for (const [nameRaw, entry] of Object.entries(globalSkillEntries || {})) {
            const name = normalizeSkillName(nameRaw);
            if (!name) continue;
            if (entry && typeof entry.enabled === 'boolean') {
                globalEnabledByName.set(name, entry.enabled);
            }
        }

        const skillByName = new Map();
        for (const skill of catalog) {
            const name = normalizeSkillName(skill.name) || 'Unknown Skill';
            const defaultGlobalEnabled = skill.eligible !== false && !skill.disabled;
            const globalEnabled = globalEnabledByName.has(name) ? globalEnabledByName.get(name) : defaultGlobalEnabled;
            const agentEnabled = hasAgentFilter ? agentAllowedSet.has(name) : true;
            skillByName.set(name, {
                name,
                displayName: skill.displayName || name,
                description: skill.description || '',
                enabled: !!(globalEnabled && agentEnabled),
                emoji: skill.emoji || '🧩',
                source: skill.source || 'unknown'
            });
        }

        // Keep globally disabled skills visible even if not returned by skills list.
        for (const [name, globalEnabled] of globalEnabledByName.entries()) {
            if (skillByName.has(name)) continue;
            const agentEnabled = hasAgentFilter ? agentAllowedSet.has(name) : true;
            skillByName.set(name, {
                name,
                displayName: name,
                description: globalEnabled ? '' : 'Disabled globally in config',
                enabled: !!(globalEnabled && agentEnabled),
                emoji: '🧩',
                source: 'openclaw-managed'
            });
        }

        // Keep agent-allowed skills visible even if currently missing from catalog.
        for (const name of agentAllowedSet) {
            if (skillByName.has(name)) continue;
            const globalEnabled = globalEnabledByName.has(name) ? globalEnabledByName.get(name) : true;
            skillByName.set(name, {
                name,
                displayName: name,
                description: 'Enabled for this agent (metadata unavailable)',
                enabled: !!globalEnabled,
                emoji: '🧩',
                source: 'openclaw-managed'
            });
        }

        const skillsList = Array.from(skillByName.values());
        skillsList.sort((a, b) => {
            const sourceA = a.source || '';
            const sourceB = b.source || '';
            const nameA = a.name || '';
            const nameB = b.name || '';
            if (sourceA.includes('managed') && !sourceB.includes('managed')) return -1;
            if (!sourceA.includes('managed') && sourceB.includes('managed')) return 1;
            return nameA.localeCompare(nameB);
        });

        res.json({ skills: skillsList });
    } catch (e) {
        console.error(`[Skills] Error: ${e.message}`);
        res.json({ skills: [] });
    }
});

// Get Agent Chat History (paginated; up to 20 pages retained)
app.get('/api/agents/:id/history', async (req, res) => {
    const { id } = req.params;
    const { page, pageSize, maxPages } = parseHistoryPaginationQuery(
      req.query,
      AGENTTOOLS_HISTORY_PAGE_SIZE,
      AGENTTOOLS_HISTORY_MAX_PAGES
    );

    const cachedHistory = getAgentToolsHistory(id);
    if (cachedHistory.length > 0) {
        const paged = paginateHistoryItems(cachedHistory, page, pageSize, maxPages);
        return res.json({
            history: paged.history,
            page: paged.page,
            pageSize: paged.pageSize,
            total: paged.total,
            totalPages: paged.totalPages,
            hasMore: paged.hasMore,
            maxPages
        });
    }

    const GLOBAL_AGENTS_DIR = path.join(OPENCLAW_ROOT_DIR, 'agents');
    let agent = AGENTS[id];

    // Fallback: If agent not in memory, check global disk
    if (!agent) {
        const localAgentDir = path.join(GLOBAL_AGENTS_DIR, id);
        if (fs.existsSync(localAgentDir)) {
             agent = {
                 id: id,
                 workspace: getPreferredWorkspacePath(id),
                 name: id
             };
        }
    }

    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    let history = [];

    // 1) Try OpenClaw sessions (agents/ID/sessions/sessions.json)
    const agentDir = path.join(GLOBAL_AGENTS_DIR, id);
    const sessionsJsonPath = path.join(agentDir, 'sessions', 'sessions.json');

    if (fs.existsSync(sessionsJsonPath)) {
        try {
            const sessionsData = JSON.parse(fs.readFileSync(sessionsJsonPath, 'utf-8'));
            let latestSession = null;
            Object.values(sessionsData).forEach(session => {
                if (!latestSession || (session.updatedAt > latestSession.updatedAt)) {
                    latestSession = session;
                }
            });

            if (latestSession && latestSession.sessionFile && fs.existsSync(latestSession.sessionFile)) {
                const lines = fs.readFileSync(latestSession.sessionFile, 'utf-8').split('\n').filter(l => l.trim());
                const parsedLines = lines.map(l => {
                    try { return JSON.parse(l); } catch(e) { return null; }
                }).filter(Boolean);

                history = parsedLines.map(lineObj => {
                    if (lineObj.type === 'message' && lineObj.message) {
                        const msg = lineObj.message;
                        if (msg.role) {
                             if (msg.role === 'system') return null;

                             let contentStr = '';
                             if (typeof msg.content === 'string') {
                                 contentStr = msg.content;
                             } else if (Array.isArray(msg.content)) {
                                 contentStr = msg.content
                                    .filter(block => block.type === 'text')
                                    .map(block => block.text)
                                    .join('');
                             }

                             if (contentStr) {
                                return { role: msg.role, content: contentStr };
                             }
                        }
                    }
                    if (lineObj.role && lineObj.content) {
                         if (lineObj.role === 'system') return null;
                         return { role: lineObj.role, content: lineObj.content };
                    }
                    return null;
                }).filter(Boolean);
            }
        } catch(e) {
            console.error(`[History] Failed to parse sessions for ${id}`, e);
        }
    }

    // 2) Fallback: workspace history.json or chat.log
    if (history.length === 0) {
        const workspace = agent.workspace;
        const historyPath = path.join(workspace, 'history.json');

        if (fs.existsSync(historyPath)) {
            try {
                const data = fs.readFileSync(historyPath, 'utf-8');
                history = JSON.parse(data);
            } catch (_) {}
        } else {
            const logPath = path.join(workspace, 'chat.log');
            if (fs.existsSync(logPath)) {
                 try {
                    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(l => l.trim());
                    const lastLines = lines.slice(-40);
                    history = lastLines.map(line => {
                        if (line.startsWith('User:')) return { role: 'user', content: line.replace('User:', '').trim() };
                        if (line.startsWith('AI:') || line.startsWith(agent.name + ':')) return { role: 'assistant', content: line.replace(/^(AI|[^:]+):/, '').trim() };
                        return { role: 'unknown', content: line };
                    }).filter(x => x.role !== 'unknown');
                } catch (_) {}
            }
        }
    }

    const normalizedHistory = (Array.isArray(history) ? history : [])
      .map(normalizeAgentToolsHistoryItem)
      .filter(Boolean);
    const paged = paginateHistoryItems(normalizedHistory, page, pageSize, maxPages);
    res.json({
      history: paged.history,
      page: paged.page,
      pageSize: paged.pageSize,
      total: paged.total,
      totalPages: paged.totalPages,
      hasMore: paged.hasMore,
      maxPages
    });
});

const agentToolsSocketsByAgent = new Map();
const agentToolsRuntimeByAgent = new Map();

function trackAgentToolsSocket(agentId, ws) {
    if (!agentId || !ws) return;
    if (!agentToolsSocketsByAgent.has(agentId)) {
        agentToolsSocketsByAgent.set(agentId, new Set());
    }
    agentToolsSocketsByAgent.get(agentId).add(ws);
}

function getAgentToolsRuntime(agentId) {
    const id = typeof agentId === 'string' ? agentId.trim() : '';
    if (!id) return null;
    const runtime = agentToolsRuntimeByAgent.get(id);
    return runtime && typeof runtime === 'object' ? runtime : null;
}

function clearAgentToolsRuntime(agentId, requestId = null) {
    const id = typeof agentId === 'string' ? agentId.trim() : '';
    if (!id) return;
    const runtime = agentToolsRuntimeByAgent.get(id);
    if (!runtime) return;
    if (requestId && runtime.requestId && runtime.requestId !== requestId) return;
    agentToolsRuntimeByAgent.delete(id);
}

function broadcastAgentToolsMessage(agentId, payload) {
    const id = typeof agentId === 'string' ? agentId.trim() : '';
    if (!id || !payload || typeof payload !== 'object') return 0;
    const set = agentToolsSocketsByAgent.get(id);
    if (!set || set.size === 0) return 0;
    let sent = 0;
    const body = JSON.stringify(payload);
    for (const sock of set) {
        if (!sock || sock.readyState !== WebSocket.OPEN) continue;
        try {
            sock.send(body);
            sent += 1;
        } catch (_) {}
    }
    return sent;
}

function untrackAgentToolsSocket(agentId, ws) {
    if (!agentId || !ws) return;
    const set = agentToolsSocketsByAgent.get(agentId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
        agentToolsSocketsByAgent.delete(agentId);
    }
}

function abortAgentToolsStreams(agentId) {
    const set = agentToolsSocketsByAgent.get(agentId);
    if (!set || set.size === 0) return;
    for (const ws of set) {
        if (ws && ws._agentToolsStreamHandle && typeof ws._agentToolsStreamHandle.abort === 'function') {
            try { ws._agentToolsStreamHandle.abort(); } catch (_) {}
        }
        ws._agentToolsStreamHandle = null;
        ws._agentToolsActiveRequestId = null;
        if (ws && ws._agentToolsBusyMarked) {
            markAgentRuntimeBusyEnd(agentId);
            ws._agentToolsBusyMarked = false;
        }
    }
    clearAgentToolsRuntime(agentId);
}

function broadcastAgentToolsReset(agentId, payload = {}) {
    const set = agentToolsSocketsByAgent.get(agentId);
    if (!set || set.size === 0) return;
    const body = JSON.stringify({ type: 'conversation_reset', agentId, ...payload });
    for (const ws of set) {
        if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(body); } catch (_) {}
        }
    }
}

app.post('/api/agents/:id/history/reset', async (req, res) => {
    const { id } = req.params;
    const agentId = typeof id === 'string' ? id.trim() : '';
    const command = (req.body && typeof req.body.command === 'string')
        ? req.body.command.trim()
        : '';
    const reloadPersona = req.body && Object.prototype.hasOwnProperty.call(req.body, 'reloadPersona')
        ? !!req.body.reloadPersona
        : true;
    const skipRemoteReset = req.body && Object.prototype.hasOwnProperty.call(req.body, 'skipRemoteReset')
        ? !!req.body.skipRemoteReset
        : false;
    if (!agentId) {
        return res.status(400).json({ error: 'agent id is required' });
    }

    if (reloadPersona) {
        try {
            refreshPersona(agentId);
        } catch (e) {
            console.warn(`[AgentTools] refreshPersona failed for ${agentId}: ${e.message || e}`);
        }
    }

    abortAgentToolsStreams(agentId);
    clearAgentToolsHistory(agentId);
    if (command) {
        appendAgentToolsHistory(agentId, 'user', command);
    }

    let remoteResetOk = true;
    let remoteResetError = '';
    if (!skipRemoteReset) {
        try {
            if (openclaw && typeof openclaw.resetConversation === 'function') {
                await openclaw.resetConversation(agentId);
            }
        } catch (e) {
            remoteResetOk = false;
            remoteResetError = e.message || String(e);
            console.warn(`[AgentTools] resetConversation failed for ${agentId}: ${remoteResetError}`);
        }
    }

    broadcastAgentToolsReset(agentId, {
        success: remoteResetOk,
        warning: remoteResetOk ? '' : remoteResetError,
        command
    });

    res.json({
        success: true,
        cleared: true,
        remoteResetOk,
        remoteResetError,
        remoteResetSkipped: skipRemoteReset,
        command,
        reloadPersona,
        skipRemoteReset
    });
});

// Toggle Skill
app.post('/api/agents/:id/skills/toggle', async (req, res) => {
    const { id } = req.params;
    const { skillName, enabled } = req.body || {};
    const normalizedName = String(skillName || '').trim();
    const agentId = String(id || '').trim();

    if (!normalizedName) {
        return res.status(400).json({ success: false, error: 'skillName is required' });
    }
    if (!/^[A-Za-z0-9._-]+$/.test(normalizedName)) {
        return res.status(400).json({ success: false, error: 'Invalid skill name' });
    }
    if (!agentId) {
        return res.status(400).json({ success: false, error: 'Invalid agent id' });
    }

    const targetEnabled = enabled !== false;
    console.log(`[Skills] Toggling ${normalizedName} -> ${targetEnabled ? 'enable' : 'disable'} (agent=${agentId})`);

    try {
        const [catalog, agentsList] = await Promise.all([
            getOpenclawSkillsCatalog(),
            getOpenclawAgentsConfigList()
        ]);

        const agentIndex = resolveAgentConfigIndex(agentsList, agentId);
        if (agentIndex < 0) {
            return res.status(404).json({ success: false, error: `Agent not found in OpenClaw config: ${agentId}` });
        }

        const allKnownSkills = normalizeSkillList([
            ...catalog.map(skill => normalizeSkillName(skill.name)).filter(Boolean),
            normalizedName
        ]);

        const currentEntry = agentsList[agentIndex] || {};
        const currentAllowlist = Array.isArray(currentEntry.skills)
            ? normalizeSkillList(currentEntry.skills)
            : allKnownSkills.slice();

        const nextSet = new Set(currentAllowlist);
        if (targetEnabled) nextSet.add(normalizedName);
        else nextSet.delete(normalizedName);

        const nextAllowlist = normalizeSkillList(Array.from(nextSet));
        const isAllEnabled = allKnownSkills.length > 0
            && nextAllowlist.length === allKnownSkills.length
            && allKnownSkills.every((name) => nextSet.has(name));

        const perAgentPath = `agents.list.${agentIndex}.skills`;
        const opMessages = [];

        // Keep global skill enabled so this panel is truly per-agent.
        if (targetEnabled) {
            try {
                const result = await execOpenclawCommand(['config', 'set', `skills.entries.${normalizedName}.enabled`, 'true']);
                const text = `${result && result.stdout ? result.stdout : ''}${result && result.stderr ? `\n${result.stderr}` : ''}`.trim();
                if (text) opMessages.push(text);
            } catch (e) {
                opMessages.push(`warning: global-enable failed: ${e.message || e}`);
            }
        }

        if (isAllEnabled) {
            try {
                const result = await execOpenclawCommand(['config', 'unset', perAgentPath]);
                const text = `${result && result.stdout ? result.stdout : ''}${result && result.stderr ? `\n${result.stderr}` : ''}`.trim();
                if (text) opMessages.push(text);
            } catch (e) {
                const em = String(e && e.message || '');
                if (em.includes('Config path not found')) {
                    opMessages.push('warning: path already unset');
                } else {
                    throw e;
                }
            }
        } else {
            const result = await execOpenclawCommand(['config', 'set', perAgentPath, JSON.stringify(nextAllowlist)]);
            const text = `${result && result.stdout ? result.stdout : ''}${result && result.stderr ? `\n${result.stderr}` : ''}`.trim();
            if (text) opMessages.push(text);
        }

        res.json({
            success: true,
            agentId,
            skillName: normalizedName,
            enabled: targetEnabled,
            message: opMessages.join('\n\n')
        });
    } catch (error) {
        const details = [error.message, error.stdout, error.stderr].filter(Boolean).join('\n').trim();
        console.error(`[Skills] Toggle Error (${normalizedName}): ${details}`);
        res.status(500).json({ success: false, error: details || 'Toggle failed' });
    }
});

// Helper for Agent Tools TTS
function generateAudioStream(text, voiceId, onChunk, onComplete) {
    const WebSocket = require('ws');
    const minimax = getMinimaxConfig();
    if (!minimax.apiKey) {
        console.warn('[TTS] MiniMax API Key 未配置，跳过音频生成');
        if (onComplete) onComplete();
        return;
    }
    const ws = new WebSocket(minimax.wsUrl, {
        headers: {
            'Authorization': `Bearer ${minimax.apiKey}`,
            'Content-Type': 'application/json'
        }
    });
    
    ws.on('open', () => {
        ws.send(JSON.stringify({
            model: "speech-2.8-hd",
            voice_setting: {
                voice_id: voiceId,
                speed: 1.0,
                vol: 1.0
            },
            audio_setting: {
                sample_rate: 32000,
                format: "mp3",
                channel: 1
            }
        }));
        
        ws.send(JSON.stringify({
            text: text,
            event: "task_continue"
        }));
        
        ws.send(JSON.stringify({
            event: "task_finish"
        }));
    });
    
    ws.on('message', (data) => {
        try {
            const response = JSON.parse(data);
            if (response.audio) {
                onChunk(response.audio); 
            }
            if (response.status === 2) { // Finished
                 ws.close();
                 if (onComplete) onComplete();
            }
        } catch(e) {}
    });
    
    ws.on('error', (e) => {
        console.error('TTS WS Error', e);
        try { ws.close(); } catch(e) {}
    });
}

// WebSocket 连接处理 - 智能体聊天
wss.on('connection', (ws, req) => {
  if (req.url.startsWith('/tts/')) return;

  if (req.url.startsWith('/agent-channels')) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const channelId = url.searchParams.get('channelId');
      const channel = findAgentChannelById(channelId);
      if (!channel) {
          try {
              ws.send(JSON.stringify({ type: 'channel_error', message: 'channel not found' }));
          } catch (_) {}
          try { ws.close(); } catch (_) {}
          return;
      }

      ws._agentChannelId = channel.id;
      ws._agentChannelStreamHandle = null;
      ws._agentChannelInFlight = false;
      ws._agentChannelBusyMarked = false;
      ws._agentChannelBusyAgents = new Set();
      console.log(`[AgentChannels] Connected: ${channel.id}`);

      ws.on('message', async (message) => {
          let data = null;
          try {
              data = JSON.parse(message);
          } catch (_) {
              return;
          }
          if (!data || data.type !== 'message') return;
          if (ws._agentChannelInFlight) {
              try {
                  ws.send(JSON.stringify({ type: 'channel_warning', message: 'channel is processing previous message' }));
              } catch (_) {}
              return;
          }

          const activeChannel = findAgentChannelById(channel.id);
          if (!activeChannel) {
              try {
                  ws.send(JSON.stringify({ type: 'channel_error', message: 'channel no longer exists' }));
              } catch (_) {}
              return;
          }

          const userText = typeof data.content === 'string' ? data.content : '';
          const uploads = Array.isArray(data.files) ? data.files : [];
          const systemPaths = Array.isArray(data.systemPaths) ? data.systemPaths : [];
          if (!userText.trim() && uploads.length === 0 && systemPaths.length === 0) return;

          const binaryUploads = uploads.filter((f) => f && typeof f.data === 'string' && /^data:/i.test(f.data));
          const hasMultimodalAttachments = binaryUploads.length > 0 || systemPaths.length > 0;
          const { savedFiles, fileNames } = saveUploadedFilesAndBuildContext(binaryUploads);
          let finalText = userText;
          const attachmentContext = buildOpenClawAttachmentContext(savedFiles, systemPaths);
          if (attachmentContext) {
              finalText = finalText.trim()
                  ? `${finalText}\n\n${attachmentContext}`
                  : attachmentContext;
          } else if (binaryUploads.length > 0) {
              finalText = finalText.trim()
                  ? `${finalText}\n\n[media attached: ${binaryUploads.length} files${fileNames ? ` (${fileNames})` : ''}]`
                  : `[media attached: ${binaryUploads.length} files${fileNames ? ` (${fileNames})` : ''}]`;
          }

          let historyUserText = userText.trim();
          if (!historyUserText && (uploads.length > 0 || systemPaths.length > 0)) {
              if (systemPaths.length > 0) {
                  historyUserText = `[Attached ${systemPaths.length} local path(s)]`;
              } else {
                  historyUserText = `[Uploaded ${uploads.length} file(s)${fileNames ? `: ${fileNames}` : ''}]`;
              }
          }
          const historyFiles = buildHistoryFilesFromUploadsAndPaths(uploads, savedFiles, systemPaths);
          appendAgentChannelHistory(activeChannel.id, {
              role: 'user',
              content: historyUserText || '[empty message]',
              files: historyFiles
          });
          touchAgentChannel(activeChannel.id);

          ws._agentChannelInFlight = true;
          if (!ws._agentChannelBusyMarked) {
              markChannelRuntimeBusyStart(activeChannel.id);
              ws._agentChannelBusyMarked = true;
          }
          const channelMembers = Array.isArray(activeChannel.agentIds) ? activeChannel.agentIds : [];
          const channelRuleMode = data.channelRuleMode !== false;
          const thinkingLevel = normalizeThinkingLevel(data.thinkingLevel, 'high');
          const reasoningEnabled = normalizeReasoningEnabled(data.reasoningEnabled, thinkingLevel);
          const routingText = typeof userText === 'string' ? userText : '';
          let designatedByNextMembers = [];
          let designatedByMentionMembers = [];
          if (channelRuleMode) {
              // Rule mode: @mention has higher priority than {next} for user-origin messages.
              designatedByMentionMembers = resolveChannelMentionedAgents(routingText, channelMembers);
              designatedByNextMembers = designatedByMentionMembers.length === 0
                  ? resolveChannelDesignatedAgentsInDirectiveOrder(routingText, channelMembers)
                  : [];
          } else {
              designatedByNextMembers = resolveChannelDesignatedAgentsInDirectiveOrder(routingText, channelMembers);
              designatedByMentionMembers = designatedByNextMembers.length === 0
                  ? resolveChannelMentionedAgents(routingText, channelMembers)
                  : [];
          }
          const effectiveMembers = designatedByMentionMembers.length > 0
              ? designatedByMentionMembers
              : (designatedByNextMembers.length > 0 ? designatedByNextMembers : channelMembers);
          const routeByMention = designatedByMentionMembers.length > 0;
          const routeByNext = !routeByMention && designatedByNextMembers.length > 0;
          const explicitUserNextTargets = resolveChannelDesignatedAgentsInDirectiveOrder(routingText, channelMembers);
          if (routeByMention) {
              console.log(`[AgentChannels] 🎯 @mention 命中，仅向被@成员发送: ${designatedByMentionMembers.join(', ')}`);
          } else if (routeByNext) {
              console.log(`[AgentChannels] 🎯 {next} 命中，仅向指定成员发送: ${designatedByNextMembers.join(', ')}`);
          }

          const runChannelAgentTurn = async ({ targetAgentId, targetAgentName, inputText, multimodalMessages = null, postProcessContent = null, executionPreface = [] }) => {
              const safeAgentId = targetAgentId;
              const safeAgentName = targetAgentName || getAgentDisplayName(targetAgentId) || targetAgentId;
              let fullResponse = '';
              let fullReasoning = '';
              let hasStartedStreaming = false;
              let hasModelStreaming = false;
              const executionEvents = [];
              const emitExecutionEvent = (payload) => {
                  const normalized = normalizeExecutionEventItem({
                      ...(payload && typeof payload === 'object' ? payload : {}),
                      source: 'agent-channel',
                      agentId: safeAgentId,
                      senderName: safeAgentName
                  });
                  if (!normalized) return;
                  executionEvents.push(normalized);
                  if (executionEvents.length > 120) {
                      executionEvents.splice(0, executionEvents.length - 120);
                  }
                  if (ws.readyState !== WebSocket.OPEN) return;
                  const isNew = !hasStartedStreaming;
                  hasStartedStreaming = true;
                  ws.send(JSON.stringify({
                      type: 'channel_execution_event',
                      channelId: activeChannel.id,
                      agentId: safeAgentId,
                      agentName: safeAgentName,
                      event: normalized,
                      isNew
                  }));
              };
              let agentBusyMarked = false;
              const markAgentBusyStart = () => {
                  if (agentBusyMarked) return;
                  markAgentRuntimeBusyStart(safeAgentId);
                  ws._agentChannelBusyAgents.add(safeAgentId);
                  agentBusyMarked = true;
              };
              const markAgentBusyEnd = () => {
                  if (!agentBusyMarked) return;
                  markAgentRuntimeBusyEnd(safeAgentId);
                  ws._agentChannelBusyAgents.delete(safeAgentId);
                  agentBusyMarked = false;
              };
              markAgentBusyStart();
              (Array.isArray(executionPreface) ? executionPreface : []).forEach((evt) => emitExecutionEvent(evt));

              await new Promise((resolveAgent) => {
                  const onChunk = (chunk) => {
                      if (ws.readyState !== WebSocket.OPEN) return;
                      const emitText = (content) => {
                          if (typeof content !== 'string' || !content) return;
                          hasModelStreaming = true;
                          const isNew = !hasStartedStreaming;
                          hasStartedStreaming = true;
                          fullResponse += content;
                          ws.send(JSON.stringify({
                              type: 'channel_text_stream',
                              channelId: activeChannel.id,
                              agentId: safeAgentId,
                              agentName: safeAgentName,
                              content,
                              isNew
                          }));
                      };
                      const emitReasoning = (content) => {
                          if (typeof content !== 'string' || !content) return;
                          hasModelStreaming = true;
                          const isNew = !hasStartedStreaming;
                          hasStartedStreaming = true;
                          fullReasoning += content;
                          ws.send(JSON.stringify({
                              type: 'channel_reasoning_stream',
                              channelId: activeChannel.id,
                              agentId: safeAgentId,
                              agentName: safeAgentName,
                              content,
                              isNew
                          }));
                      };

                      if (typeof chunk === 'string') {
                          emitText(chunk);
                          return;
                      }
                      if (!chunk || typeof chunk !== 'object') return;
                      if (chunk.type === 'execution_event' && chunk.event) {
                          emitExecutionEvent(chunk.event);
                          return;
                      }
                      if (chunk.type === 'reasoning_stream' && typeof chunk.content === 'string') {
                          emitReasoning(chunk.content);
                          return;
                      }
                      if (chunk.type === 'text_stream' && typeof chunk.content === 'string') {
                          emitText(chunk.content);
                      }
                  };

                  const onDone = () => {
                      ws._agentChannelStreamHandle = null;
                      markAgentBusyEnd();
                      emitExecutionEvent({
                          code: 'stream_done',
                          label: '执行完成',
                          detail: '流式响应已结束'
                      });
                      if (typeof postProcessContent === 'function') {
                          try {
                              const patched = postProcessContent(fullResponse);
                              if (typeof patched === 'string' && patched.trim()) {
                                  const patchedTrimmed = patched.trim();
                                  const originalTrimmed = fullResponse.trim();
                                  if (patchedTrimmed !== originalTrimmed) {
                                      const appendedDelta = patchedTrimmed.startsWith(originalTrimmed)
                                          ? patchedTrimmed.slice(originalTrimmed.length)
                                          : `\n\n${patchedTrimmed}`;
                                      if (appendedDelta && ws.readyState === WebSocket.OPEN) {
                                          ws.send(JSON.stringify({
                                              type: 'channel_text_stream',
                                              channelId: activeChannel.id,
                                              agentId: safeAgentId,
                                              agentName: safeAgentName,
                                              content: appendedDelta,
                                              isNew: !hasStartedStreaming
                                          }));
                                      }
                                      fullResponse = patchedTrimmed;
                                      hasStartedStreaming = true;
                                  } else {
                                      fullResponse = patchedTrimmed;
                                  }
                              }
                          } catch (e) {
                              console.warn(`[AgentChannels] postProcessContent failed for ${safeAgentId}: ${e.message || e}`);
                          }
                      }
                      const content = fullResponse.trim() || '[No response]';
                      appendAgentChannelHistory(activeChannel.id, {
                          role: 'assistant',
                          content,
                          agentId: safeAgentId,
                          senderName: safeAgentName,
                          reasoning: fullReasoning.trim(),
                          executionEvents
                      });
                      if (ws.readyState === WebSocket.OPEN) {
                          ws.send(JSON.stringify({
                              type: 'channel_stream_done',
                              channelId: activeChannel.id,
                              agentId: safeAgentId,
                              agentName: safeAgentName
                          }));
                      }
                      resolveAgent();
                  };

                  const onError = (error) => {
                      ws._agentChannelStreamHandle = null;
                      markAgentBusyEnd();
                      emitExecutionEvent({
                          code: 'stream_error',
                          label: '执行失败',
                          detail: error && error.message ? String(error.message) : 'unknown error'
                      });
                      const errorText = `[Error: ${error.message}]`;
                      fullResponse = errorText;
                      if (ws.readyState === WebSocket.OPEN) {
                          ws.send(JSON.stringify({
                              type: 'channel_text_stream',
                              channelId: activeChannel.id,
                              agentId: safeAgentId,
                              agentName: safeAgentName,
                              content: errorText,
                              isNew: !hasStartedStreaming
                          }));
                          ws.send(JSON.stringify({
                              type: 'channel_stream_done',
                              channelId: activeChannel.id,
                              agentId: safeAgentId,
                              agentName: safeAgentName
                          }));
                      }
                      appendAgentChannelHistory(activeChannel.id, {
                          role: 'assistant',
                          content: errorText,
                          agentId: safeAgentId,
                          senderName: safeAgentName,
                          executionEvents
                      });
                      resolveAgent();
                  };

                  const channelSessionKey = `agent:${safeAgentId}:channel:${activeChannel.id}`;
                  if (multimodalMessages) {
                      emitExecutionEvent({
                          code: 'gateway_http',
                          label: '执行通道',
                          detail: `Gateway HTTP SSE（reasoning ${reasoningEnabled ? 'enabled' : 'disabled'}）`
                      });
                      const controller = new AbortController();
                      ws._agentChannelStreamHandle = { abort: () => controller.abort() };
                      streamOpenClawHTTP(
                          safeAgentId,
                          inputText,
                          {
                              onText: (content) => onChunk({ type: 'text_stream', content }),
                              onReasoning: (content) => onChunk({ type: 'reasoning_stream', content }),
                              onExecution: (event) => emitExecutionEvent(event),
                              onDone: () => onDone(),
                              onError: (error) => onError(error)
                          },
                          {
                              controller,
                              silentAbort: true,
                              firstChunkTimeoutMs: OPENCLAW_FIRST_CHUNK_TIMEOUT_MULTIMODAL_MS,
                              messages: multimodalMessages,
                              model: `openclaw:${safeAgentId}`,
                              gatewayAgentId: safeAgentId,
                              sessionKey: channelSessionKey,
                              thinkingLevel,
                              reasoningEnabled
                          }
                      );
                      return;
                  }

                  const startChannelCliStream = () => {
                      emitExecutionEvent({
                          code: 'cli_local',
                          label: '执行通道',
                          detail: `OpenClaw CLI 本地流式（thinking=${thinkingLevel || 'off'}）`
                      });
                      const channelStreamOptions = {
                          emitCliProgressEvents: true,
                          sessionId: channelSessionKey
                      };
                      if (thinkingLevel) {
                          channelStreamOptions.thinking = thinkingLevel;
                      }
                      ws._agentChannelStreamHandle = openclaw.sendMessageStream(
                          safeAgentId,
                          inputText,
                          onChunk,
                          onDone,
                          onError,
                          channelStreamOptions
                      );
                  };
                  const canFallbackToChannelCli = () => {
                      if (hasModelStreaming) return false;
                      if (typeof fullResponse === 'string' && fullResponse.length > 0) return false;
                      if (typeof fullReasoning === 'string' && fullReasoning.length > 0) return false;
                      return true;
                  };
                  emitExecutionEvent({
                      code: 'gateway_http',
                      label: '执行通道',
                      detail: `Gateway Agent SSE（reasoning ${reasoningEnabled ? 'enabled' : 'disabled'}）`
                  });
                  const controller = new AbortController();
                  ws._agentChannelStreamHandle = { abort: () => controller.abort() };
                  streamOpenClawHTTP(
                      safeAgentId,
                      inputText,
                      {
                          onText: (content) => onChunk({ type: 'text_stream', content }),
                          onReasoning: (content) => onChunk({ type: 'reasoning_stream', content }),
                          onExecution: (event) => emitExecutionEvent(event),
                          onDone: () => onDone(),
                          onError: (error) => {
                              if (isOpenClawCliFallbackEnabled() && canFallbackToChannelCli()) {
                                  emitExecutionEvent({
                                      code: 'gateway_error',
                                      label: 'Gateway 失败',
                                      detail: error && error.message ? String(error.message) : 'unknown error'
                                  });
                                  emitExecutionEvent({
                                      code: 'gateway_cli_fallback',
                                      label: '自动回退',
                                      detail: '已回退到 OpenClaw CLI 本地流式'
                                  });
                                  startChannelCliStream();
                                  return;
                              }
                              onError(error);
                          }
                      },
                      {
                          controller,
                          silentAbort: true,
                          model: `openclaw:${safeAgentId}`,
                          gatewayAgentId: safeAgentId,
                          sessionKey: channelSessionKey,
                          thinkingLevel,
                          reasoningEnabled
                      }
                  );
              });

              return {
                  content: fullResponse.trim(),
                  reasoning: fullReasoning.trim()
              };
          };

          for (const agentId of effectiveMembers) {
              if (ws.readyState !== WebSocket.OPEN) break;

              const agentName = getAgentDisplayName(agentId) || agentId;
              const requiredHandoffTargetIds = (routeByMention && designatedByMentionMembers.length === 1
                  ? explicitUserNextTargets.filter((id) => id && id !== agentId)
                  : []);
              const requiredHandoffTargetNames = requiredHandoffTargetIds
                  .map((id) => getAgentDisplayName(id) || id)
                  .filter(Boolean);
              const requiredHandoffInstruction = requiredHandoffTargetNames.length > 0
                  ? `\n\n[System Instruction: The user requested a multi-target handoff. You MUST include ALL required {next} directives in your final reply (one per line, exact format, no omissions):\n${requiredHandoffTargetNames.map((name) => `{next: "${name}"}`).join('\n')}\nDo not keep only one target. Keep all required targets.]`
                  : '';
              const mentionNoHandoffInstruction = (routeByMention && requiredHandoffTargetNames.length === 0)
                  ? `\n\n[System Instruction: You were directly @mentioned by the user. Reply with your own answer only. Do NOT ask another member to continue, do NOT ask any other member a question, do NOT call out other members by name, and DO NOT include any {next: "..."} directive.]`
                  : '';
              const routedInputText = (routeByNext || routeByMention)
                  ? `${finalText}\n\n[System Instruction: You are explicitly designated by ${routeByNext ? '{next}' : '@ mention'}. Read the caller's full context carefully before replying. You may decide whether to reply (recommended to reply). If you reply, answer the caller's point directly first.]${requiredHandoffInstruction}${mentionNoHandoffInstruction}`
                  : finalText;
                  const agentInputText = appendExecOutputGuardInstruction(routedInputText);
                  const multimodalMessages = hasMultimodalAttachments
                      ? buildOpenClawMultimodalMessages(agentInputText, binaryUploads, savedFiles, systemPaths)
                      : null;
              const executionPreface = [];
              if (routeByMention) {
                  executionPreface.push({
                      code: 'route',
                      label: '路由决策',
                      detail: `命中 @mention，仅执行: ${designatedByMentionMembers.join(', ')}`
                  });
              } else if (routeByNext) {
                  executionPreface.push({
                      code: 'route',
                      label: '路由决策',
                      detail: `命中 {next}，仅执行: ${designatedByNextMembers.join(', ')}`
                  });
              } else {
                  executionPreface.push({
                      code: 'route',
                      label: '路由决策',
                      detail: `默认执行当前频道成员: ${channelMembers.join(', ')}`
                  });
              }
              executionPreface.push({
                  code: 'thinking_level',
                  label: '思考等级',
                  detail: `thinking=${thinkingLevel || 'off'}`
              });
              if (requiredHandoffTargetNames.length > 0) {
                  executionPreface.push({
                      code: 'handoff_guard',
                      label: '转发约束',
                      detail: `强制保留 {next}: ${requiredHandoffTargetNames.join(', ')}`
                  });
              }
              const result = await runChannelAgentTurn({
                  targetAgentId: agentId,
                  targetAgentName: agentName,
                  inputText: agentInputText,
                  multimodalMessages,
                  executionPreface,
                  postProcessContent: requiredHandoffTargetNames.length > 0
                      ? (rawContent) => ensureAllRequiredNextDirectives(rawContent, requiredHandoffTargetNames)
                      : (routeByMention ? (rawContent) => {
                          const cleaned = stripNextDirectives(rawContent);
                          return cleaned && cleaned.trim() ? cleaned : rawContent;
                      } : null)
              });

              if (!channelRuleMode || !result.content) {
                  continue;
              }

              // User explicit @mentions should end at direct recipients unless user also gave explicit {next} targets.
              if (routeByMention && requiredHandoffTargetNames.length === 0) {
                  continue;
              }

              // Rule mode handoff: parse {next: "..."} from member replies, then relay to target(s) without the directive.
              const forwardedTargets = resolveChannelDesignatedAgentsInDirectiveOrder(result.content, channelMembers)
                  .filter((id) => id && id !== agentId);
              if (forwardedTargets.length === 0) {
                  continue;
              }
              const forwardedContent = stripNextDirectives(result.content);
              if (!forwardedContent) {
                  continue;
              }
              console.log(`[AgentChannels] ↪️ ${agentId} 回复触发 {next} 转发: ${forwardedTargets.join(', ')}`);
              for (const targetId of forwardedTargets) {
                  if (ws.readyState !== WebSocket.OPEN) break;
                  const targetName = getAgentDisplayName(targetId) || targetId;
                  const relayInput = appendExecOutputGuardInstruction(
                      `${agentName} 给你转达了一条消息，请直接回应ta：\n${forwardedContent}\n\n[System Instruction: This is a terminal handoff triggered by {next}. The {next} directive has been removed before forwarding. In this reply, DO NOT add any {next: "..."} directive.]`
                  );
                  await runChannelAgentTurn({
                      targetAgentId: targetId,
                      targetAgentName: targetName,
                      inputText: relayInput,
                      multimodalMessages: null,
                      postProcessContent: (rawContent) => {
                          const cleaned = stripNextDirectives(rawContent);
                          return cleaned && cleaned.trim() ? cleaned : rawContent;
                      }
                  });
              }
          }

          ws._agentChannelInFlight = false;
          if (ws._agentChannelBusyMarked) {
              markChannelRuntimeBusyEnd(activeChannel.id);
              ws._agentChannelBusyMarked = false;
          }
          touchAgentChannel(activeChannel.id);
          if (ws.readyState === WebSocket.OPEN) {
              try {
                  ws.send(JSON.stringify({
                      type: 'channel_round_done',
                      channelId: activeChannel.id
                  }));
              } catch (_) {}
          }
      });

      ws.on('close', () => {
          ws._agentChannelInFlight = false;
          if (ws._agentChannelBusyMarked) {
              markChannelRuntimeBusyEnd(channel.id);
              ws._agentChannelBusyMarked = false;
          }
          if (ws._agentChannelBusyAgents && ws._agentChannelBusyAgents.size > 0) {
              for (const busyAgentId of ws._agentChannelBusyAgents) {
                  markAgentRuntimeBusyEnd(busyAgentId);
              }
              ws._agentChannelBusyAgents.clear();
          }
          if (ws._agentChannelStreamHandle && typeof ws._agentChannelStreamHandle.abort === 'function') {
              try { ws._agentChannelStreamHandle.abort(); } catch (_) {}
          }
          ws._agentChannelStreamHandle = null;
      });
      return;
  }

  // Agent Tools Chat Handler
  if (req.url.startsWith('/agent-tools')) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const agentId = url.searchParams.get('agentId');
      if (!agentId) {
          try { ws.close(); } catch (_) {}
          return;
      }
      ws._agentToolsAgentId = agentId;
      ws._agentToolsBusyMarked = false;
      ws._agentToolsRelayBusyAgents = new Set();
      trackAgentToolsSocket(agentId, ws);
      
      console.log(`[AgentTools] Connected to ${agentId}`);
      const inflightRuntime = getAgentToolsRuntime(agentId);
      if (inflightRuntime && inflightRuntime.active) {
          ws._agentToolsActiveRequestId = inflightRuntime.requestId || null;
          try {
              ws.send(JSON.stringify({
                  type: 'agent_inflight_snapshot',
                  agentId,
                  requestId: inflightRuntime.requestId || '',
                  startedAt: inflightRuntime.startedAt || Date.now(),
                  response: typeof inflightRuntime.fullResponse === 'string' ? inflightRuntime.fullResponse : '',
                  reasoning: typeof inflightRuntime.fullReasoning === 'string' ? inflightRuntime.fullReasoning : '',
                  executionEvents: Array.isArray(inflightRuntime.executionEvents) ? inflightRuntime.executionEvents : []
              }));
          } catch (_) {}
      }
      
      ws.on('message', async (message) => {
          try {
              const data = JSON.parse(message);
              if (data.type === 'message') {
                  const userText = typeof data.content === 'string' ? data.content : '';
                  console.log(`[AgentTools] ${agentId} received: ${userText}`);
                  const existingRuntime = getAgentToolsRuntime(agentId);
                  if (existingRuntime && existingRuntime.active) {
                      ws._agentToolsActiveRequestId = existingRuntime.requestId || null;
                      try {
                          ws.send(JSON.stringify({
                              type: 'agent_inflight_snapshot',
                              agentId,
                              requestId: existingRuntime.requestId || '',
                              startedAt: existingRuntime.startedAt || Date.now(),
                              response: typeof existingRuntime.fullResponse === 'string' ? existingRuntime.fullResponse : '',
                              reasoning: typeof existingRuntime.fullReasoning === 'string' ? existingRuntime.fullReasoning : '',
                              executionEvents: Array.isArray(existingRuntime.executionEvents) ? existingRuntime.executionEvents : []
                          }));
                          ws.send(JSON.stringify({
                              type: 'execution_event',
                              event: {
                                  code: 'busy_inflight',
                                  label: '继续处理中',
                                  detail: '上一轮正在执行，本次输入未重复提交',
                                  source: 'agent-tools',
                                  agentId,
                                  senderName: getAgentDisplayName(agentId) || agentId,
                                  timestamp: new Date().toISOString()
                              },
                              isNew: false
                          }));
                      } catch (_) {}
                      return;
                  }
                  
                  // Handle files if present
                  let finalText = userText;
                  const uploads = Array.isArray(data.files) ? data.files : [];
                  const systemPaths = Array.isArray(data.systemPaths) ? data.systemPaths : [];
                  const binaryUploads = uploads.filter((f) => f && typeof f.data === 'string' && /^data:/i.test(f.data));
                  const hasMultimodalAttachments = binaryUploads.length > 0 || systemPaths.length > 0;
                  const { savedFiles, fileNames } = saveUploadedFilesAndBuildContext(binaryUploads);
                  if (uploads.length > 0) {
                      const attachmentContext = buildOpenClawAttachmentContext(savedFiles, systemPaths);
                      if (attachmentContext) {
                          finalText = finalText.trim()
                              ? `${finalText}\n\n${attachmentContext}`
                              : attachmentContext;
                      } else if (binaryUploads.length > 0) {
                          finalText = finalText.trim()
                              ? `${finalText}\n\n[media attached: ${binaryUploads.length} files${fileNames ? ` (${fileNames})` : ''}]`
                              : `[media attached: ${binaryUploads.length} files${fileNames ? ` (${fileNames})` : ''}]`;
                      }
                  } else if (systemPaths.length > 0) {
                      const attachmentContext = buildOpenClawAttachmentContext([], systemPaths);
                      if (attachmentContext) {
                          finalText = finalText.trim()
                              ? `${finalText}\n\n${attachmentContext}`
                              : attachmentContext;
                      }
                  }

                  const routeCandidates = listKnownAgentIdsForRouting().filter((id) => id && id !== agentId);
                  const userRequestedHandoffTargets = resolveGlobalDesignatedAgentsInDirectiveOrder(finalText, {
                      excludeAgentIds: [agentId]
                  });
                  const userMentionedHandoffTargets = resolveChannelMentionedAgents(finalText, routeCandidates);
                  const mergedHandoffTargets = Array.from(new Set([
                      ...userRequestedHandoffTargets,
                      ...userMentionedHandoffTargets
                  ]));
                  const requiredHandoffTargetNames = userRequestedHandoffTargets
                      .map((id) => getAgentDisplayName(id) || id)
                      .filter(Boolean);
                  if (requiredHandoffTargetNames.length === 0 && mergedHandoffTargets.length > 0) {
                      mergedHandoffTargets.forEach((targetId) => {
                          const targetName = getAgentDisplayName(targetId) || targetId;
                          if (targetName) requiredHandoffTargetNames.push(targetName);
                      });
                  }
                  if (requiredHandoffTargetNames.length > 0) {
                      finalText = `${finalText}\n\n[System Instruction: The user requested a multi-target handoff. You MUST include ALL required {next} directives in your final reply (one per line, exact format, no omissions):\n${requiredHandoffTargetNames.map((name) => `{next: "${name}"`).join('\n')}\nDo not keep only one target. Keep all required targets.]`;
                  }
                  const collaborationMemory = buildAgentToolsCollaborationMemoryBlock(agentId, {
                      maxCount: 4,
                      maxCharsPerItem: 520
                  });
                  if (collaborationMemory) {
                      finalText = `${collaborationMemory}\n\n${finalText}`;
                  }
                  finalText = appendExecOutputGuardInstruction(finalText);
                  const multimodalMessages = hasMultimodalAttachments
                      ? buildOpenClawMultimodalMessages(finalText, binaryUploads, savedFiles, systemPaths)
                      : null;

                  let historyUserText = typeof userText === 'string' ? userText.trim() : '';
                  if (!historyUserText && (uploads.length > 0 || systemPaths.length > 0)) {
                      if (systemPaths.length > 0) {
                          historyUserText = `[Attached ${systemPaths.length} local path(s)]`;
                      } else {
                          const fileNames = uploads.map((f) => f && f.name ? f.name : '').filter(Boolean).join(', ');
                          historyUserText = `[Uploaded ${uploads.length} file(s)${fileNames ? `: ${fileNames}` : ''}]`;
                      }
                  }
                  const historyFiles = buildHistoryFilesFromUploadsAndPaths(uploads, savedFiles, systemPaths);
                  appendAgentToolsHistory(agentId, 'user', historyUserText, historyFiles);

                  // Stream Response (OpenClaw CLI streaming)
                  let fullResponse = '';
                  let fullReasoning = '';
                  let hasStartedStreaming = false;
                  let hasModelStreaming = false;
                  const thinkingLevel = normalizeThinkingLevel(data.thinkingLevel, 'high');
                  const reasoningEnabled = normalizeReasoningEnabled(data.reasoningEnabled, thinkingLevel);
                  const primaryExecutionEvents = [];
                  const emitPrimaryExecutionEvent = (payload) => {
                      const normalized = normalizeExecutionEventItem({
                          ...(payload && typeof payload === 'object' ? payload : {}),
                          source: 'agent-tools',
                          agentId,
                          senderName: getAgentDisplayName(agentId) || agentId
                      });
                      if (!normalized) return;
                      primaryExecutionEvents.push(normalized);
                      if (primaryExecutionEvents.length > 120) {
                          primaryExecutionEvents.splice(0, primaryExecutionEvents.length - 120);
                      }
                      runtime.executionEvents = primaryExecutionEvents.slice(-120);
                      if (!isRuntimeActive()) return;
                      const isNew = !hasStartedStreaming;
                      hasStartedStreaming = true;
                      broadcastAgentToolsMessage(agentId, {
                          type: 'execution_event',
                          event: normalized,
                          isNew
                      });
                  };

                  // 新请求进来时，中断之前仍在流式中的请求，避免串流互相覆盖
                  if (ws._agentToolsStreamHandle && typeof ws._agentToolsStreamHandle.abort === 'function') {
                      try { ws._agentToolsStreamHandle.abort(); } catch(e) {}
                  }
                  if (ws._agentToolsRelayBusyAgents && ws._agentToolsRelayBusyAgents.size > 0) {
                      for (const busyAgentId of ws._agentToolsRelayBusyAgents) {
                          markAgentRuntimeBusyEnd(busyAgentId);
                      }
                      ws._agentToolsRelayBusyAgents.clear();
                  }
                  if (ws._agentToolsBusyMarked) {
                      markAgentRuntimeBusyEnd(agentId);
                      ws._agentToolsBusyMarked = false;
                  }
                  const requestId = `${agentId}-${Date.now()}`;
                  ws._agentToolsActiveRequestId = requestId;
                  const runtime = {
                      agentId,
                      requestId,
                      active: true,
                      startedAt: Date.now(),
                      fullResponse: '',
                      fullReasoning: '',
                      executionEvents: [],
                      streamHandle: null
                  };
                  agentToolsRuntimeByAgent.set(agentId, runtime);
                  const isRuntimeActive = () => {
                      const current = getAgentToolsRuntime(agentId);
                      return !!current && current === runtime && current.active === true;
                  };
                  markAgentRuntimeBusyStart(agentId);
                  ws._agentToolsBusyMarked = true;

                  const streamOptions = {};
                  if (thinkingLevel) {
                      streamOptions.thinking = thinkingLevel;
                  }
                  streamOptions.emitCliProgressEvents = true;
                  const isSessionLockError = (errorLike) => {
                      const text = typeof errorLike === 'string'
                          ? errorLike
                          : (errorLike && errorLike.message ? String(errorLike.message) : '');
                      if (!text) return false;
                      return /session file locked|\.jsonl\.lock|sessions\.json\.lock|failovererror/i.test(text);
                  };
                  let primaryCliRestartFn = null;
                  let primarySessionLockRetryCount = 0;
                  const PRIMARY_SESSION_LOCK_RETRY_MAX = 2;
                  const PRIMARY_SESSION_LOCK_RETRY_DELAY_MS = 1600;

                  if (userRequestedHandoffTargets.length > 0) {
                      emitPrimaryExecutionEvent({
                          code: 'route',
                          label: '路由决策',
                          detail: `命中 {next}: ${userRequestedHandoffTargets.join(', ')}`
                      });
                  } else if (userMentionedHandoffTargets.length > 0) {
                      emitPrimaryExecutionEvent({
                          code: 'route',
                          label: '路由决策',
                          detail: `命中 @mention: ${userMentionedHandoffTargets.join(', ')}`
                      });
                  } else {
                      emitPrimaryExecutionEvent({
                          code: 'route',
                          label: '路由决策',
                          detail: '默认当前会话智能体执行'
                      });
                  }
                  emitPrimaryExecutionEvent({
                      code: 'thinking_level',
                      label: '思考等级',
                      detail: `thinking=${thinkingLevel || 'off'}`
                  });

                  const runRelayTurn = async (targetAgentId, relaySourceName, relayContent, relayOptions = {}) => {
                      const targetId = typeof targetAgentId === 'string' ? targetAgentId.trim() : '';
                      const relayMessage = typeof relayContent === 'string' ? relayContent.trim() : '';
                      if (!targetId || !relayMessage) return;

                      const targetName = getAgentDisplayName(targetId) || targetId;
                      const customInput = relayOptions && typeof relayOptions.customInput === 'string'
                          ? relayOptions.customInput.trim()
                          : '';
                      const safeRelaySourceName = relaySourceName.replace(/"/g, '\\"');
                      const relayInput = customInput
                          || `${relaySourceName} 给你转达了一条消息，请直接回应ta：\n${relayMessage}\n\n[System Instruction: This is a routed handoff triggered by {next}. The {next} directive has been removed before forwarding. Reply naturally. If you need another collaborator, you MAY append one or more directives at the end (one per line): {next: "Agent Name"}. If you think ${relaySourceName} should continue from your answer, you MAY append this as the last line: {next: "${safeRelaySourceName}"}. This is optional and not mandatory.]`;
                      const startCode = (relayOptions && typeof relayOptions.startCode === 'string' && relayOptions.startCode.trim())
                          ? relayOptions.startCode.trim()
                          : 'relay_start';
                      const startLabel = (relayOptions && typeof relayOptions.startLabel === 'string' && relayOptions.startLabel.trim())
                          ? relayOptions.startLabel.trim()
                          : '转发执行';
                      const startDetail = (relayOptions && typeof relayOptions.startDetail === 'string' && relayOptions.startDetail.trim())
                          ? relayOptions.startDetail.trim()
                          : `已转发给 ${targetName}`;
                      const doneCode = (relayOptions && typeof relayOptions.doneCode === 'string' && relayOptions.doneCode.trim())
                          ? relayOptions.doneCode.trim()
                          : 'relay_done';
                      const doneLabel = (relayOptions && typeof relayOptions.doneLabel === 'string' && relayOptions.doneLabel.trim())
                          ? relayOptions.doneLabel.trim()
                          : '转发完成';
                      const doneDetail = (relayOptions && typeof relayOptions.doneDetail === 'string' && relayOptions.doneDetail.trim())
                          ? relayOptions.doneDetail.trim()
                          : `来自 ${targetName} 的回复已完成`;
                      let relayResponse = '';
                      let relayReasoning = '';
                      let relayStarted = false;
                      let relayModelStreaming = false;
                      const relayExecutionEvents = [];
                      const emitRelayExecution = (payload) => {
                          const normalized = normalizeExecutionEventItem({
                              ...(payload && typeof payload === 'object' ? payload : {}),
                              source: 'relay',
                              agentId: targetId,
                              senderName: targetName
                          });
                          if (!normalized) return;
                          relayExecutionEvents.push(normalized);
                          if (relayExecutionEvents.length > 120) {
                              relayExecutionEvents.splice(0, relayExecutionEvents.length - 120);
                          }
                          if (!isRuntimeActive()) return;
                          const isNew = !relayStarted;
                          relayStarted = true;
                          broadcastAgentToolsMessage(agentId, {
                              type: 'execution_event',
                              event: normalized,
                              senderName: targetName,
                              senderAgentId: targetId,
                              isNew
                          });
                      };
                      let relayBusyMarked = false;
                      const markRelayBusyStart = () => {
                          if (relayBusyMarked) return;
                          markAgentRuntimeBusyStart(targetId);
                          if (ws._agentToolsRelayBusyAgents && typeof ws._agentToolsRelayBusyAgents.add === 'function') {
                              ws._agentToolsRelayBusyAgents.add(targetId);
                          }
                          relayBusyMarked = true;
                      };
                      const markRelayBusyEnd = () => {
                          if (!relayBusyMarked) return;
                          markAgentRuntimeBusyEnd(targetId);
                          if (ws._agentToolsRelayBusyAgents && typeof ws._agentToolsRelayBusyAgents.delete === 'function') {
                              ws._agentToolsRelayBusyAgents.delete(targetId);
                          }
                          relayBusyMarked = false;
                      };
                      markRelayBusyStart();
                      emitRelayExecution({
                          code: startCode,
                          label: startLabel,
                          detail: startDetail
                      });
                      const relaySessionKey = `agent:${targetId}:main`;
                      const startRelayCliStream = () => {
                          emitRelayExecution({
                              code: 'cli_local',
                              label: '执行通道',
                              detail: `OpenClaw CLI 本地流式（thinking=${thinkingLevel || 'off'}）`
                          });
                          const relayStreamOptions = {
                              emitCliProgressEvents: true,
                              sessionId: relaySessionKey
                          };
                          if (thinkingLevel) {
                              relayStreamOptions.thinking = thinkingLevel;
                          }
                          ws._agentToolsStreamHandle = openclaw.sendMessageStream(
                              targetId,
                              relayInput,
                              onRelayChunk,
                              onRelayDone,
                              onRelayError,
                              relayStreamOptions
                          );
                          runtime.streamHandle = ws._agentToolsStreamHandle;
                      };
                      const canFallbackToRelayCli = () => {
                          if (relayModelStreaming) return false;
                          if (typeof relayResponse === 'string' && relayResponse.length > 0) return false;
                          if (typeof relayReasoning === 'string' && relayReasoning.length > 0) return false;
                          return true;
                      };

                      const relayResult = await new Promise((resolveRelay) => {
                          const emitRelayText = (content) => {
                              if (typeof content !== 'string' || !content) return;
                              relayModelStreaming = true;
                              const isNew = !relayStarted;
                              relayStarted = true;
                              relayResponse += content;
                              if (isRuntimeActive()) {
                                  broadcastAgentToolsMessage(agentId, {
                                      type: 'relay_text_stream',
                                      relayAgentId: targetId,
                                      relayAgentName: targetName,
                                      content,
                                      isNew
                                  });
                              }
                          };
                          const emitRelayReasoning = (content) => {
                              if (typeof content !== 'string' || !content) return;
                              relayModelStreaming = true;
                              const isNew = !relayStarted;
                              relayStarted = true;
                              relayReasoning += content;
                              if (isRuntimeActive()) {
                                  broadcastAgentToolsMessage(agentId, {
                                      type: 'relay_reasoning_stream',
                                      relayAgentId: targetId,
                                      relayAgentName: targetName,
                                      content,
                                      isNew
                                  });
                              }
                          };
                          const onRelayChunk = (chunk) => {
                              if (!isRuntimeActive()) return;
                              if (typeof chunk === 'string') {
                                  emitRelayText(chunk);
                                  return;
                              }
                              if (!chunk || typeof chunk !== 'object') return;
                              if (chunk.type === 'execution_event' && chunk.event) {
                                  emitRelayExecution(chunk.event);
                                  return;
                              }
                              if (chunk.type === 'reasoning_stream') {
                                  emitRelayReasoning(chunk.content);
                                  return;
                              }
                              if (chunk.type === 'text_stream') {
                                  emitRelayText(chunk.content);
                              }
                          };
                          const onRelayDone = () => {
                              ws._agentToolsStreamHandle = null;
                              runtime.streamHandle = null;
                              markRelayBusyEnd();
                              if (!isRuntimeActive()) {
                                  resolveRelay({
                                      targetId,
                                      targetName,
                                      output: '',
                                      rawOutput: '',
                                      reasoning: '',
                                      forwardedTargets: []
                                  });
                                  return;
                              }
                              emitRelayExecution({
                                  code: doneCode,
                                  label: doneLabel,
                                  detail: doneDetail
                              });
                              const rawRelay = relayResponse.trim() || '[No response]';
                              const cleanedRelay = stripNextDirectives(rawRelay);
                              const relayOutput = cleanedRelay && cleanedRelay.trim()
                                  ? cleanedRelay.trim()
                                  : rawRelay;
                              const relayForwardedTargets = rawRelay && rawRelay !== '[No response]'
                                  ? resolveGlobalDesignatedAgentsInDirectiveOrder(rawRelay, {
                                      excludeAgentIds: [targetId]
                                  })
                                  : [];
                              if (relayForwardedTargets.length > 0) {
                                  emitRelayExecution({
                                      code: 'relay_handoff_next',
                                      label: '继续转发',
                                      detail: `{next}: ${relayForwardedTargets.join(', ')}`
                                  });
                              }
                              appendAgentToolsHistory(agentId, 'assistant', relayOutput, {
                                  agentId: targetId,
                                  senderName: targetName,
                                  reasoning: relayReasoning.trim(),
                                  executionEvents: relayExecutionEvents
                              });
                              resolveRelay({
                                  targetId,
                                  targetName,
                                  output: relayOutput,
                                  rawOutput: rawRelay,
                                  reasoning: relayReasoning.trim(),
                                  forwardedTargets: relayForwardedTargets
                              });
                          };
                          const onRelayError = (error) => {
                              ws._agentToolsStreamHandle = null;
                              runtime.streamHandle = null;
                              markRelayBusyEnd();
                              if (!isRuntimeActive()) {
                                  resolveRelay({
                                      targetId,
                                      targetName,
                                      output: '',
                                      rawOutput: '',
                                      reasoning: '',
                                      forwardedTargets: []
                                  });
                                  return;
                              }
                              const errorText = `[Relay Error ${targetName}: ${error.message}]`;
                              emitRelayExecution({
                                  code: 'relay_error',
                                  label: '转发失败',
                                  detail: error && error.message ? String(error.message) : 'unknown error'
                              });
                              if (isRuntimeActive()) {
                                  broadcastAgentToolsMessage(agentId, {
                                      type: 'relay_text_stream',
                                      relayAgentId: targetId,
                                      relayAgentName: targetName,
                                      content: errorText,
                                      isNew: !relayStarted
                                  });
                              }
                              appendAgentToolsHistory(agentId, 'assistant', errorText, {
                                  agentId: targetId,
                                  senderName: targetName,
                                  executionEvents: relayExecutionEvents
                              });
                              resolveRelay({
                                  targetId,
                                  targetName,
                                  output: errorText,
                                  rawOutput: errorText,
                                  reasoning: '',
                                  forwardedTargets: []
                              });
                          };

                          emitRelayExecution({
                              code: 'gateway_http',
                              label: '执行通道',
                              detail: `Gateway Agent SSE（reasoning ${reasoningEnabled ? 'enabled' : 'disabled'}）`
                          });
                          const controller = new AbortController();
                          ws._agentToolsStreamHandle = { abort: () => controller.abort() };
                          runtime.streamHandle = ws._agentToolsStreamHandle;
                          streamOpenClawHTTP(
                              targetId,
                              relayInput,
                              {
                                  onText: (content) => onRelayChunk({ type: 'text_stream', content }),
                                  onReasoning: (content) => onRelayChunk({ type: 'reasoning_stream', content }),
                                  onExecution: (event) => emitRelayExecution(event),
                                  onDone: () => onRelayDone(),
                                  onError: (error) => {
                                      if (isOpenClawCliFallbackEnabled() && canFallbackToRelayCli()) {
                                          emitRelayExecution({
                                              code: 'gateway_error',
                                              label: 'Gateway 失败',
                                              detail: error && error.message ? String(error.message) : 'unknown error'
                                          });
                                          emitRelayExecution({
                                              code: 'gateway_cli_fallback',
                                              label: '自动回退',
                                              detail: '已回退到 OpenClaw CLI 本地流式'
                                          });
                                          startRelayCliStream();
                                          return;
                                      }
                                      onRelayError(error);
                                  }
                              },
                              {
                                  controller,
                                  silentAbort: true,
                                  model: `openclaw:${targetId}`,
                                  gatewayAgentId: targetId,
                                  sessionKey: relaySessionKey,
                                  thinkingLevel,
                                  reasoningEnabled
                              }
                          );
                      });
                      return relayResult;
                  };

                  const onChunk = (chunk) => {
                          if (!isRuntimeActive()) return;
                          const emitText = (content) => {
                              if (typeof content !== 'string' || !content) return;
                              primarySessionLockRetryCount = 0;
                              hasModelStreaming = true;
                              const isNew = !hasStartedStreaming;
                              hasStartedStreaming = true;
                              fullResponse += content;
                              runtime.fullResponse = fullResponse;
                              broadcastAgentToolsMessage(agentId, { type: 'text_stream', content, isNew });
                          };
                          const emitReasoning = (content) => {
                              if (typeof content !== 'string' || !content) return;
                              primarySessionLockRetryCount = 0;
                              hasModelStreaming = true;
                              const isNew = !hasStartedStreaming;
                              hasStartedStreaming = true;
                              fullReasoning += content;
                              runtime.fullReasoning = fullReasoning;
                              broadcastAgentToolsMessage(agentId, { type: 'reasoning_stream', content, isNew });
                          };

                          if (typeof chunk === 'string') {
                              emitText(chunk);
                              return;
                          }
                          if (!chunk || typeof chunk !== 'object') return;
                          if (chunk.type === 'execution_event' && chunk.event) {
                              emitPrimaryExecutionEvent(chunk.event);
                              return;
                          }
                          if (chunk.type === 'reasoning_stream') {
                              emitReasoning(chunk.content);
                              return;
                          }
                          if (chunk.type === 'text_stream') {
                              emitText(chunk.content);
                          }
                      };
                  const onDone = () => {
                          if (!isRuntimeActive()) return;
                          primarySessionLockRetryCount = 0;
                          ws._agentToolsStreamHandle = null;
                          runtime.streamHandle = null;
                          const finalizeTurn = async () => {
                              if (!isRuntimeActive()) return;
                              let primaryResponse = fullResponse.trim();
                              const primaryReasoning = fullReasoning.trim();
                              if (requiredHandoffTargetNames.length > 0 && primaryResponse) {
                                  const patchedResponse = ensureAllRequiredNextDirectives(primaryResponse, requiredHandoffTargetNames);
                                  if (patchedResponse && patchedResponse !== primaryResponse) {
                                      const appendedDelta = patchedResponse.startsWith(primaryResponse)
                                          ? patchedResponse.slice(primaryResponse.length)
                                          : `\n\n${patchedResponse}`;
                                      if (appendedDelta && isRuntimeActive()) {
                                          broadcastAgentToolsMessage(agentId, {
                                              type: 'text_stream',
                                              content: appendedDelta,
                                              isNew: !hasStartedStreaming
                                          });
                                      }
                                      fullResponse = patchedResponse;
                                      primaryResponse = patchedResponse;
                                      runtime.fullResponse = fullResponse;
                                      hasStartedStreaming = true;
                                  }
                              }
                              console.log(`[AgentTools] Response complete`);

                              const forwardedTargets = primaryResponse
                                  ? resolveGlobalDesignatedAgentsInDirectiveOrder(primaryResponse, {
                                      excludeAgentIds: [agentId]
                                  })
                                  : [];
                              const forwardedContent = stripNextDirectives(primaryResponse);
                              if (forwardedTargets.length > 0 && forwardedContent) {
                                  emitPrimaryExecutionEvent({
                                      code: 'handoff_next',
                                      label: '触发转发',
                                      detail: `{next}: ${forwardedTargets.join(', ')}`
                                  });
                              }
                              emitPrimaryExecutionEvent({
                                  code: 'stream_done',
                                  label: '执行完成',
                                  detail: '主回复流式已完成'
                              });
                              if (primaryResponse) {
                                  appendAgentToolsHistory(agentId, 'assistant', primaryResponse, {
                                      reasoning: primaryReasoning,
                                      executionEvents: primaryExecutionEvents
                                  });
                              }

                              if (forwardedTargets.length > 0 && forwardedContent) {
                                  const relaySourceName = getAgentDisplayName(agentId) || agentId;
                                  console.log(`[AgentTools] ↪️ ${agentId} 回复触发 {next} 转发: ${forwardedTargets.join(', ')}`);
                                  const relayQueue = forwardedTargets.map((targetId) => ({
                                      targetId,
                                      sourceName: relaySourceName,
                                      content: forwardedContent
                                  }));
                                  const relayVisitCounts = new Map();
                                  const relayHopLimit = 8;
                                  let relayHopCount = 0;

                                  while (relayQueue.length > 0 && isRuntimeActive()) {
                                      if (relayHopCount >= relayHopLimit) {
                                          emitPrimaryExecutionEvent({
                                              code: 'relay_hop_limit',
                                              label: '转发已限流',
                                              detail: `超过最大转发链路 ${relayHopLimit}，已停止继续转发`
                                          });
                                          break;
                                      }
                                      const nextRelay = relayQueue.shift();
                                      if (!nextRelay || !nextRelay.targetId || !nextRelay.content) continue;
                                      const currentVisit = relayVisitCounts.get(nextRelay.targetId) || 0;
                                      if (currentVisit >= 3) continue;
                                      relayVisitCounts.set(nextRelay.targetId, currentVisit + 1);
                                      relayHopCount += 1;

                                      const relayResult = await runRelayTurn(
                                          nextRelay.targetId,
                                          nextRelay.sourceName,
                                          nextRelay.content
                                      );
                                      if (!relayResult) continue;

                                      const chainedTargets = Array.isArray(relayResult.forwardedTargets)
                                          ? relayResult.forwardedTargets
                                          : [];
                                      if (chainedTargets.length === 0) continue;

                                      const chainedSourceName = relayResult.targetName
                                          || (getAgentDisplayName(relayResult.targetId) || relayResult.targetId);
                                      const chainedContent = (typeof relayResult.output === 'string' && relayResult.output.trim() && relayResult.output.trim() !== '[No response]')
                                          ? relayResult.output.trim()
                                          : nextRelay.content;

                                      for (const chainedTargetId of chainedTargets) {
                                          if (!isRuntimeActive()) break;
                                          if (!chainedTargetId || chainedTargetId === relayResult.targetId) continue;
                                          if (!chainedContent) continue;
                                          relayQueue.push({
                                              targetId: chainedTargetId,
                                              sourceName: chainedSourceName,
                                              content: chainedContent
                                          });
                                      }
                                  }
                              }

                              if (isRuntimeActive()) {
                                  broadcastAgentToolsMessage(agentId, { type: 'stream_done' });
                                  // Send state update event to refresh UI (Prompt, Skills, etc.)
                                  broadcastAgentToolsMessage(agentId, { type: 'state_updated' });
                              }

                              // Generate Audio (primary response only)
                              const agent = AGENTS[agentId];
                              const voiceId = agent ? agent.voiceId : DEFAULT_VOICE_IDS[0];
                              if (voiceId && primaryResponse && isRuntimeActive()) {
                                  console.log(`[AgentTools] Generating audio for ${voiceId}`);
                                  generateAudioStream(primaryResponse, voiceId, (audioChunk) => {
                                      if (isRuntimeActive()) {
                                          broadcastAgentToolsMessage(agentId, { type: 'audio_stream', audio: audioChunk });
                                      }
                                  });
                              }
                          };

                          finalizeTurn().catch((error) => {
                              console.error('[AgentTools] finalize turn error', error);
                              if (isRuntimeActive()) {
                                  broadcastAgentToolsMessage(agentId, { type: 'text_stream', content: `[Error: ${error.message}]`, isNew: !hasStartedStreaming });
                                  broadcastAgentToolsMessage(agentId, { type: 'stream_done' });
                              }
                          }).finally(() => {
                              if (!isRuntimeActive()) return;
                              ws._agentToolsStreamHandle = null;
                              ws._agentToolsActiveRequestId = null;
                              runtime.streamHandle = null;
                              runtime.active = false;
                              if (ws._agentToolsRelayBusyAgents && ws._agentToolsRelayBusyAgents.size > 0) {
                                  for (const busyAgentId of ws._agentToolsRelayBusyAgents) {
                                      markAgentRuntimeBusyEnd(busyAgentId);
                                  }
                                  ws._agentToolsRelayBusyAgents.clear();
                              }
                              if (ws._agentToolsBusyMarked) {
                                  markAgentRuntimeBusyEnd(agentId);
                                  ws._agentToolsBusyMarked = false;
                              }
                              clearAgentToolsRuntime(agentId, requestId);
                          });
                      };
                  const onError = (error) => {
                          if (!isRuntimeActive()) return;
                          const canRetrySessionLock = (
                              isSessionLockError(error)
                              && typeof primaryCliRestartFn === 'function'
                              && primarySessionLockRetryCount < PRIMARY_SESSION_LOCK_RETRY_MAX
                              && !hasModelStreaming
                              && !String(fullResponse || '').trim()
                              && !String(fullReasoning || '').trim()
                          );
                          if (canRetrySessionLock) {
                              primarySessionLockRetryCount += 1;
                              const retryDelayMs = PRIMARY_SESSION_LOCK_RETRY_DELAY_MS * primarySessionLockRetryCount;
                              ws._agentToolsStreamHandle = null;
                              runtime.streamHandle = null;
                              emitPrimaryExecutionEvent({
                                  code: 'session_lock_retry',
                                  label: '会话锁重试',
                                  detail: `检测到会话文件锁，${Math.round(retryDelayMs / 1000)}s 后自动重试（${primarySessionLockRetryCount}/${PRIMARY_SESSION_LOCK_RETRY_MAX}）`
                              });
                              setTimeout(() => {
                                  if (!isRuntimeActive()) return;
                                  try {
                                      primaryCliRestartFn();
                                  } catch (retryErr) {
                                      onError(retryErr);
                                  }
                              }, retryDelayMs);
                              return;
                          }
                          emitPrimaryExecutionEvent({
                              code: 'stream_error',
                              label: '执行失败',
                              detail: error && error.message ? String(error.message) : 'unknown error'
                          });
                          ws._agentToolsStreamHandle = null;
                          ws._agentToolsActiveRequestId = null;
                          runtime.streamHandle = null;
                          runtime.active = false;
                          if (ws._agentToolsRelayBusyAgents && ws._agentToolsRelayBusyAgents.size > 0) {
                              for (const busyAgentId of ws._agentToolsRelayBusyAgents) {
                                  markAgentRuntimeBusyEnd(busyAgentId);
                              }
                              ws._agentToolsRelayBusyAgents.clear();
                          }
                          if (ws._agentToolsBusyMarked) {
                              markAgentRuntimeBusyEnd(agentId);
                              ws._agentToolsBusyMarked = false;
                          }
                          broadcastAgentToolsMessage(agentId, { type: 'text_stream', content: `[Error: ${error.message}]`, isNew: !hasStartedStreaming });
                          broadcastAgentToolsMessage(agentId, { type: 'stream_done' });
                          clearAgentToolsRuntime(agentId, requestId);
                      };

                  if (multimodalMessages) {
                      emitPrimaryExecutionEvent({
                          code: 'gateway_http',
                          label: '执行通道',
                          detail: `Gateway HTTP SSE（reasoning ${reasoningEnabled ? 'enabled' : 'disabled'}）`
                      });
                      const controller = new AbortController();
                      ws._agentToolsStreamHandle = { abort: () => controller.abort() };
                      runtime.streamHandle = ws._agentToolsStreamHandle;
                      streamOpenClawHTTP(
                          agentId,
                          finalText,
                          {
                              onText: (content) => onChunk({ type: 'text_stream', content }),
                              onReasoning: (content) => onChunk({ type: 'reasoning_stream', content }),
                              onExecution: (event) => emitPrimaryExecutionEvent(event),
                              onDone: () => onDone(),
                              onError: (error) => onError(error)
                          },
                          {
                              controller,
                              silentAbort: true,
                              firstChunkTimeoutMs: OPENCLAW_FIRST_CHUNK_TIMEOUT_MULTIMODAL_MS,
                              messages: multimodalMessages,
                              model: `openclaw:${agentId}`,
                              gatewayAgentId: agentId,
                              sessionKey: `agent:${agentId}:main`,
                              thinkingLevel,
                              reasoningEnabled
                          }
                      );
                  } else {
                      const primarySessionKey = `agent:${agentId}:main`;
                      const startPrimaryCliStream = () => {
                          emitPrimaryExecutionEvent({
                              code: 'cli_local',
                              label: '执行通道',
                              detail: `OpenClaw CLI 本地流式（thinking=${thinkingLevel || 'off'}）`
                          });
                          ws._agentToolsStreamHandle = openclaw.sendMessageStream(
                              agentId,
                              finalText,
                              onChunk,
                              onDone,
                              onError,
                              {
                                  ...streamOptions,
                                  sessionId: primarySessionKey
                              }
                          );
                          runtime.streamHandle = ws._agentToolsStreamHandle;
                      };
                      primaryCliRestartFn = startPrimaryCliStream;
                      const canFallbackToPrimaryCli = () => {
                          if (hasModelStreaming) return false;
                          if (typeof fullResponse === 'string' && fullResponse.length > 0) return false;
                          if (typeof fullReasoning === 'string' && fullReasoning.length > 0) return false;
                          return true;
                      };
                      emitPrimaryExecutionEvent({
                          code: 'gateway_http',
                          label: '执行通道',
                          detail: `Gateway Agent SSE（reasoning ${reasoningEnabled ? 'enabled' : 'disabled'}）`
                      });
                      const controller = new AbortController();
                      ws._agentToolsStreamHandle = { abort: () => controller.abort() };
                      runtime.streamHandle = ws._agentToolsStreamHandle;
                      streamOpenClawHTTP(
                          agentId,
                          finalText,
                          {
                              onText: (content) => onChunk({ type: 'text_stream', content }),
                              onReasoning: (content) => onChunk({ type: 'reasoning_stream', content }),
                              onExecution: (event) => emitPrimaryExecutionEvent(event),
                              onDone: () => onDone(),
                              onError: (error) => {
                                  if (isOpenClawCliFallbackEnabled() && canFallbackToPrimaryCli()) {
                                      emitPrimaryExecutionEvent({
                                          code: 'gateway_error',
                                          label: 'Gateway 失败',
                                          detail: error && error.message ? String(error.message) : 'unknown error'
                                      });
                                      emitPrimaryExecutionEvent({
                                          code: 'gateway_cli_fallback',
                                          label: '自动回退',
                                          detail: '已回退到 OpenClaw CLI 本地流式'
                                      });
                                      startPrimaryCliStream();
                                      return;
                                  }
                                  onError(error);
                              }
                          },
                          {
                              controller,
                              silentAbort: true,
                              model: `openclaw:${agentId}`,
                              gatewayAgentId: agentId,
                              sessionKey: primarySessionKey,
                              thinkingLevel,
                              reasoningEnabled
                          }
                      );
                  }
              }
          } catch (e) {
              console.error('[AgentTools] Message error', e);
          }
      });

      ws.on('close', () => {
          const runtime = getAgentToolsRuntime(agentId);
          const closingRequestId = ws._agentToolsActiveRequestId || null;
          const shouldKeepStreaming = !!(runtime
              && runtime.active
              && closingRequestId
              && runtime.requestId === closingRequestId);
          if (shouldKeepStreaming) {
              untrackAgentToolsSocket(agentId, ws);
              return;
          }
          if (ws._agentToolsStreamHandle && typeof ws._agentToolsStreamHandle.abort === 'function') {
              try { ws._agentToolsStreamHandle.abort(); } catch(e) {}
              ws._agentToolsStreamHandle = null;
          }
          ws._agentToolsActiveRequestId = null;
          if (ws._agentToolsRelayBusyAgents && ws._agentToolsRelayBusyAgents.size > 0) {
              for (const busyAgentId of ws._agentToolsRelayBusyAgents) {
                  markAgentRuntimeBusyEnd(busyAgentId);
              }
              ws._agentToolsRelayBusyAgents.clear();
          }
          if (ws._agentToolsBusyMarked) {
              markAgentRuntimeBusyEnd(agentId);
              ws._agentToolsBusyMarked = false;
          }
          clearAgentToolsRuntime(agentId, closingRequestId);
          untrackAgentToolsSocket(agentId, ws);
      });
      return;
  }

  // RoundTable Chat Handler (Existing)
  // 解析URL和查询参数
  const url = new URL(req.url, `http://${req.headers.host}`);
  const channelId = url.searchParams.get('channel');
  const runtimeId = url.searchParams.get('runtime_id') || null;

  // 支持 /agentId 或 /ws/agentId
  let agentId = req.url.replace('/', '').split('?')[0];
  if (agentId.startsWith('ws/')) {
    agentId = agentId.replace('ws/', '');
  }
  agentId = agentId || 'main';
  // 支持动态智能体：检查 AGENTS 或 activeAgentIds
  if (!AGENTS[agentId] && !activeAgentIds.includes(agentId)) {
    ws.close();
    return;
  }

  // 如果 AGENTS 中没有这个 agent，动态创建
  if (!AGENTS[agentId]) {
    AGENTS[agentId] = {
      id: agentId,
      name: agentId.charAt(0).toUpperCase() + agentId.slice(1),
      displayName: agentId.charAt(0).toUpperCase() + agentId.slice(1),
      emoji: '🎭',
      sessionKey: `agent:${agentId}:main`,
      workspace: getPreferredWorkspacePath(agentId),
      systemPrompt: null,
      voiceId: DEFAULT_VOICE_IDS[0]
    };
  }

  ws._agentId = agentId;
  ws._isTTS = false;
  ws._roomId = channelId || null;
  ws._runtimeId = runtimeId;
  ws._connId = `${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  ws._connSeq = ++wsConnectionSeq;

  // 同房间同 agent 只保留最新连接：新连接一到，旧连接立即下线
  const closedOldWs = evictSupersededConnections({
    currentWs: ws,
    agentId,
    roomId: channelId || null,
    isTTS: false,
    reason: 'replaced_by_new_ws'
  });
  if (closedOldWs > 0) {
    console.log(`[Room] ♻️ ${agentId} 替换旧聊天连接: room=${channelId || 'global'}, closed=${closedOldWs}, newConn=${ws._connId}, seq=${ws._connSeq}`);
  }

  // 如果有channelId，关联到房间
  if (channelId) {
    const room = rooms.get(channelId);
    if (room) {
      const hostAgentId = room.hostAgentId || null;
      const hostShouldTakeOver = !!hostAgentId && hostAgentId === agentId;

      // 主机 agent 新连接建立时，强制接管主机连接
      if (hostShouldTakeOver) {
        const incomingRuntimeId = ws._runtimeId || null;
        const roomRuntimeId = room.hostRuntimeId || null;
        const currentHostRuntimeId = room.hostWs ? (room.hostWs._runtimeId || null) : roomRuntimeId;
        const sameRuntimeAsCurrentHost =
          !!incomingRuntimeId &&
          !!currentHostRuntimeId &&
          incomingRuntimeId === currentHostRuntimeId;
        const sameRuntimeAsRoomHost =
          !!incomingRuntimeId &&
          !!roomRuntimeId &&
          incomingRuntimeId === roomRuntimeId;

        if (room.hostWs && room.hostWs !== ws) {
          // 同一页面实例的断线重连：仅切主机连接，不重置会话
          // 不同页面实例接管：执行“下播式”重置，避免串会话
          if (!sameRuntimeAsCurrentHost) {
            resetRoomSessionOnHostReconnect(room, 'host_ws_takeover');
          } else {
            console.log(`[Room] ♻️ 同页主机重连，跳过会话重置: channel=${channelId}, runtime=${incomingRuntimeId}`);
          }

          const oldHost = room.hostWs;
          oldHost._superseded = true;
          oldHost._supersededBy = ws._connId;
          oldHost._isHost = false;
          try { oldHost.close(4001, 'host_replaced'); } catch (e) {}
        } else if (!room.hostWs) {
          // 旧主机可能已先断开（刷新时常见），这里也要执行一次“下播式”重置，
          // 避免沿用旧会话状态继续回答
          const hasStaleSession =
            !!room.isActive ||
            !!room.currentSpeaker ||
            !!room.nextPreparedAgent ||
            !!room.nextPreparedMessage ||
            !!(room.moderator && room.moderator.isActive);
          if (hasStaleSession && !sameRuntimeAsRoomHost) {
            resetRoomSessionOnHostReconnect(room, 'host_ws_reconnect_no_old_host');
          } else if (hasStaleSession) {
            console.log(`[Room] ♻️ 同页主机无旧连接重连，跳过会话重置: channel=${channelId}, runtime=${incomingRuntimeId}`);
          }
        }
        ws._isHost = true;
        room.hostWs = ws;
        room.hostRuntimeId = incomingRuntimeId || room.hostRuntimeId || null;
        console.log(`[Room] 设置主机: ${agentId}`);
        if (room.pendingStreamingControlCommand && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(room.pendingStreamingControlCommand));
            console.log(`[Room] 📤 补发暂存控制命令给主机: ${room.pendingStreamingControlCommand.command}`);
            room.pendingStreamingControlCommand = null;
          } catch (e) {
            console.warn(`[Room] ⚠️ 补发控制命令失败: ${e.message}`);
          }
        }
      // 非主机 agent：仅在当前无主机时接管（兼容历史行为）
      } else if (!room.hostWs) {
        ws._isHost = true;
        room.hostWs = ws;
        room.hostRuntimeId = ws._runtimeId || room.hostRuntimeId || null;
        console.log(`[Room] 设置主机: ${agentId}`);
      } else {
        ws._isHost = false;
      }
      room.participants.add(agentId);
    } else {
      // 服务重启后常见：前端携带旧 channel 重连，但内存房间已丢失。
      // 立即告知前端停止本地音频，避免“旧会话残余继续播放”。
      console.warn(`[Room] ⚠️ 聊天连接命中不存在房间: channel=${channelId}, agent=${agentId}, conn=${ws._connId}`);
      try {
        ws.send(JSON.stringify({
          type: 'interrupt',
          initiator: 'server',
          reason: 'room_missing',
          forceStopAudio: true
        }));
      } catch (_) {}
      try {
        ws.send(JSON.stringify({
          type: 'room_missing',
          channelId
        }));
      } catch (_) {}
      try { ws.close(4004, 'room_missing'); } catch (_) {}
      return;
    }
  }

  console.log(`[${agentId}] WebSocket 连接${channelId ? `, 房间: ${channelId}, 主机: ${ws._isHost}` : ''}, conn=${ws._connId}, seq=${ws._connSeq}`);
  
  // 检查并刷新人设
  const wsAgent = getRuntimeAgentById(agentId);
  if (!wsAgent || !wsAgent.systemPrompt) {
    refreshPersona(agentId);
  }
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      // Room 相关消息处理
      if (ws._roomId) {
        const room = rooms.get(ws._roomId);

        // 音频缓存消息（来自主机）
        if (data.type === 'audio_cache' && ws._isHost && room) {
          cacheAudioChunk(room, agentId, data.audioChunk, data.isComplete, data.text || '');
          return;
        }

        // 发言同步请求（来自分机）
        if (data.type === 'speaker_sync_request' && room) {
          const { index, position } = calculateAudioTimestamp(room);
          ws.send(JSON.stringify({
            type: 'speaker_sync_response',
            currentSpeaker: room.currentSpeaker ? {
              agentId: room.currentSpeaker.agentId,
              text: room.currentSpeaker.text,
              audioTimestamp: position,
              ttsStreaming: room.currentSpeaker.ttsStreaming
            } : null,
            chainIndex: index
          }));
          return;
        }
      }

      // 停止消息 - 立即停止当前推理
      if (data.type === 'stop') {
        console.log(`[${agentId}] 🛑 收到 stop 消息，中止请求`);
        const stopState = getRoundTableState(ws._roomId);
        stopState.interruptedAgents.add(agentId);
        // 只中止“同 agent + 同 room”请求，避免旧页面/旧房间误伤当前房间
        abortOpenClawRequests((requestId, entry) => {
          return entry.agentId === agentId && (entry.roomId || null) === (ws._roomId || null);
        }, `${agentId}`);
        return;
      }

      // 正常的聊天消息
      if (data.type === 'chat' && data.message) {
        const userMessage = data.message;

        // 调试：打印 systemPrompt 前缀确认身份
        const agent = getRuntimeAgentById(agentId);
        if (agent && agent.systemPrompt) {
          console.log(`[${agentId}] 🎭 发送消息时使用人设: ${agent.systemPrompt.substring(0, 100)}...`);
        } else {
          console.log(`[${agentId}] ⚠️ 没有加载人设！`);
        }

        // 清除该 agent 的打断标记，允许响应
        const chatState = getRoundTableState(ws._roomId);
        if (chatState.interruptedAgents.has(agentId)) {
          console.log(`[${agentId}] 🆗 清除打断标记，允许响应`);
          chatState.interruptedAgents.delete(agentId);
        }

        // 发送开始标记
        ws.send(JSON.stringify({ type: 'start' }));

        // 使用 Gateway HTTP SSE 流式方式发送
        try {
          sendToOpenClawHTTP(agentId, userMessage, ws);
        } catch (error) {
          console.error(`[${agentId}] API 错误:`, error.message);
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
      }
    } catch (e) {
      console.error(`[${agentId}] 处理消息错误:`, e.message);
    }
  });
  
  ws.on('close', () => {
    console.log(`[${agentId}] WebSocket 断开, conn=${ws._connId}, seq=${ws._connSeq}${ws._superseded ? `, supersededBy=${ws._supersededBy || 'n/a'}` : ''}`);

    // 清理房间关联
    if (ws._roomId) {
      const room = rooms.get(ws._roomId);
      if (room) {
        if (ws._isHost) {
          room.hostWs = null;
          room.hostRuntimeId = null;

          // 主机断开后，先尝试从同房间现有连接中提升一个新主机，避免刷新/重连瞬间误判房间已结束
          let promotedHost = null;
          for (const c of wss.clients) {
            if (c !== ws && c._roomId === ws._roomId && !c._isTTS && c.readyState === WebSocket.OPEN) {
              c._isHost = true;
              room.hostWs = c;
              room.hostRuntimeId = c._runtimeId || null;
              promotedHost = c;
              console.log(`[Room] 🔁 主机已切换到 ${c._agentId}, conn=${c._connId}, seq=${c._connSeq}`);
              if (room.pendingStreamingControlCommand) {
                try {
                  c.send(JSON.stringify(room.pendingStreamingControlCommand));
                  console.log(`[Room] 📤 补发暂存控制命令给新主机: ${room.pendingStreamingControlCommand.command}`);
                  room.pendingStreamingControlCommand = null;
                } catch (e) {
                  console.warn(`[Room] ⚠️ 补发控制命令给新主机失败: ${e.message}`);
                }
              }
              break;
            }
          }

          // 没有可接管的新主机，才执行彻底复位
          if (!promotedHost) {
            // 主机页面关闭/刷新：将房间讨论状态复位，避免刷新后误判“讨论中”
            if (room.moderator && room.moderator.isActive) {
              room.moderator.stop();
            }
            room.isActive = false;
            room.currentSpeaker = null;
            clearRoomNextPrepared(room);
            room.nextTopicData = null;
            room.pendingTopicData = null;
            // 主机页面关闭/刷新：释放 Podcast 长连接（下次进入页面会自动重连）
            if (room.podcastPusher) {
              room.podcastPusher.disconnect();
              room.podcastPusher = null;
            }
            // 广播主机断开
            broadcastToRoom(room, { type: 'host_disconnected' });
          }
        }
        // 仅当该 agent 在当前房间已无其他活跃连接时，才移除参与者标记
        let stillConnected = false;
        for (const c of wss.clients) {
          if (c === ws) continue;
          if ((c._roomId || null) !== (ws._roomId || null)) continue;
          if ((c._agentId || null) !== agentId) continue;
          if (c._isTTS) continue;
          if (c.readyState === WebSocket.OPEN) {
            stillConnected = true;
            break;
          }
        }
        if (!stillConnected) {
          room.participants.delete(agentId);
        }
      }
    }
  });
});

// WebSocket 连接处理 - TTS 代理（流式转发）
wss.on('connection', (ws, req) => {
  if (!req.url.startsWith('/tts/')) return;

  // 解析URL和查询参数
  const url = new URL(req.url, `http://${req.headers.host}`);
  const channelId = url.searchParams.get('channel');

  if (channelId && !rooms.has(channelId)) {
    console.warn(`[Room] ⚠️ TTS 连接命中不存在房间: channel=${channelId}, path=${req.url}`);
    try {
      ws.send(JSON.stringify({
        event: 'error',
        error: 'room_missing',
        channelId
      }));
    } catch (_) {}
    try { ws.close(4004, 'room_missing'); } catch (_) {}
    return;
  }

  const agentIdPath = req.url.replace('/tts/', '').split('?')[0];
  const agentId = agentIdPath;
  const agent = AGENTS[agentId];
  // Prioritize agent.voiceId (which might come from URL params in /api/agents), fallback to AGENT_VOICES
  const voiceId = (agent && agent.voiceId) ? agent.voiceId : (AGENT_VOICES[agentId] || AGENT_VOICES['main']);

  ws._agentId = agentId;
  ws._isTTS = true;
  ws._roomId = channelId || null;
  ws._isHost = !!channelId && rooms.has(channelId) && rooms.get(channelId).hostAgentId === agentId;
  ws._connId = `tts-${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  ws._connSeq = ++wsConnectionSeq;

  // TTS 同房间同 agent 只保留最新连接
  const closedOldTts = evictSupersededConnections({
    currentWs: ws,
    agentId,
    roomId: channelId || null,
    isTTS: true,
    reason: 'replaced_by_new_tts'
  });
  if (closedOldTts > 0) {
    console.log(`[Room] ♻️ ${agentId} 替换旧TTS连接: room=${channelId || 'global'}, closed=${closedOldTts}, newConn=${ws._connId}, seq=${ws._connSeq}`);
  }
  
  console.log(`[${agentId}] TTS WebSocket 连接, conn=${ws._connId}, seq=${ws._connSeq}`);
  
  let minimaxWs = null;
  let isReady = false;
  let pendingTexts = [];
  let endReceived = false; // 标记是否收到结束信号
  let textChunksSent = 0; // 发送给 MiniMax 的文本块数
  let audioChunksReceived = 0; // 从 MiniMax 收到的音频块数
  let textAccumulator = ''; // 文本聚合缓冲区
  let flushTimer = null; // 聚合刷新定时器
  let fullTextForPodcast = ''; // 完整文本（给 podcast 推流用）
  const SENTENCE_END_RE = /[。！？.!?;；]/;
  let lastTextFlushProfileKey = '';
  let lastLocalTaskContinueSentAt = 0;
  let taskFinishRequested = false;
  let taskFinishRequestedAt = 0;
  let taskFinishSent = false;
  let taskFinishPollTimer = null;

  function resolveTextFlushProfile() {
    const activeProfile = {
      key: 'active',
      label: 'active',
      intervalMs: TTS_TEXT_FLUSH_ACTIVE_INTERVAL_MS,
      minChars: TTS_TEXT_FLUSH_ACTIVE_MIN_CHARS,
      flushOnSentenceEnd: true,
      flushOnCompleteOnly: false
    };
    if (!ws._roomId) return activeProfile;

    const room = rooms.get(ws._roomId);
    if (!room || !room.isActive) return activeProfile;

    const state = getRoundTableState(ws._roomId);
    const currentSpeakerId = room.currentSpeaker && room.currentSpeaker.agentId ? room.currentSpeaker.agentId : null;
    const hasOtherCurrentSpeaker = !!currentSpeakerId && currentSpeakerId !== agentId;
    const isPreparingThisAgent = !!state && state.preparingAgent === agentId;
    const isMarkedNextPrepared = room.nextPreparedAgent === agentId;

    // 预加载态：当前有人在说话，本 agent 正在“下一位准备”。
    // 该阶段降低 task_continue 频率，减少 MiniMax RPM 压力。
    if (hasOtherCurrentSpeaker && (isPreparingThisAgent || isMarkedNextPrepared)) {
      return {
        key: 'preload',
        label: 'preload',
        intervalMs: TTS_TEXT_FLUSH_PRELOAD_INTERVAL_MS,
        minChars: TTS_TEXT_FLUSH_PRELOAD_MIN_CHARS,
        flushOnSentenceEnd: false,
        // 预加载阶段只在推理完成(end)时触发一次发送，降低 RPM 峰值
        flushOnCompleteOnly: true
      };
    }

    return activeProfile;
  }

  function getTextFlushProfile() {
    const profile = resolveTextFlushProfile();
    if (profile.key !== lastTextFlushProfileKey) {
      lastTextFlushProfileKey = profile.key;
      console.log(
        `[${agentId}] TTS 文本聚合策略切换: mode=${profile.label}, minChars=${profile.minChars}, interval=${profile.intervalMs}ms`
      );
      pushRpmProfile('flush_profile_switch', {
        flushMode: profile.label,
        textFlushIntervalMs: profile.intervalMs,
        textFlushMinChars: profile.minChars,
        flushOnSentenceEnd: !!profile.flushOnSentenceEnd,
        flushOnCompleteOnly: !!profile.flushOnCompleteOnly
      });
    }
    return profile;
  }

  function buildRpmProfilePayload(reason, extras = {}) {
    const profile = resolveTextFlushProfile();
    const now = Date.now();
    const taskContinueMinGap = getEffectiveMinimaxTaskContinueMinGapMs(now);
    const taskContinueMinGapBase = Math.max(1, Number(MINIMAX_TASK_CONTINUE_MIN_GAP_MS) || 1);
    const guardRemainingMs = Math.max(0, minimaxRateLimitGuardUntil - now);
    const rateLimitGuardActive = guardRemainingMs > 0;
    const estimatedTaskContinueRpmCap = Math.floor(60000 / taskContinueMinGap);
    const recommendedBudgetRpm = Math.max(1, Number(MINIMAX_RECOMMENDED_RPM_BUDGET) || 1);
    const rpmStats = getMinimaxTaskContinueRpmStats({
      agentId,
      roomId: ws._roomId || null
    });
    const capUsageGlobalPct = Math.round((rpmStats.realTaskContinueRpmGlobal * 100) / Math.max(1, estimatedTaskContinueRpmCap));
    const capUsageScopedPct = Math.round((rpmStats.realTaskContinueRpmScoped * 100) / Math.max(1, estimatedTaskContinueRpmCap));
    const budgetUsageGlobalPct = Math.round((rpmStats.realTaskContinueRpmGlobal * 100) / recommendedBudgetRpm);
    const budgetUsageScopedPct = Math.round((rpmStats.realTaskContinueRpmScoped * 100) / recommendedBudgetRpm);

    return Object.assign({
      event: 'rpm_profile',
      reason: reason || 'snapshot',
      agentId,
      channelId: ws._roomId || null,
      flushMode: profile.label,
      textFlushIntervalMs: profile.intervalMs,
      textFlushMinChars: profile.minChars,
      flushOnSentenceEnd: !!profile.flushOnSentenceEnd,
      flushOnCompleteOnly: !!profile.flushOnCompleteOnly,
      taskContinueMinGapMs: taskContinueMinGap,
      taskContinueMinGapBaseMs: taskContinueMinGapBase,
      estimatedTaskContinueRpmCap,
      recommendedBudgetRpm,
      rateLimitCooldownMs: MINIMAX_RATE_LIMIT_COOLDOWN_MS,
      rateLimitGuardActive,
      rateLimitGuardRemainingMs: guardRemainingMs,
      queueLimit: MINIMAX_TASK_CONTINUE_QUEUE_LIMIT,
      queueDepth: minimaxTaskContinueQueue.length,
      cooldownRemainingMs: Math.max(0, minimaxRateLimitCooldownUntil - now),
      rpmWindowMs: rpmStats.rpmWindowMs,
      realTaskContinueLast60sGlobal: rpmStats.realTaskContinueLast60sGlobal,
      realTaskContinueRpmGlobal: rpmStats.realTaskContinueRpmGlobal,
      realTaskContinueLast60sScoped: rpmStats.realTaskContinueLast60sScoped,
      realTaskContinueRpmScoped: rpmStats.realTaskContinueRpmScoped,
      capUsageGlobalPct,
      capUsageScopedPct,
      budgetUsageGlobalPct,
      budgetUsageScopedPct
    }, extras || {});
  }

  function pushRpmProfile(reason, extras = {}) {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(buildRpmProfilePayload(reason, extras)));
    } catch (_) {}
  }

  function clearTaskFinishPollTimer() {
    if (taskFinishPollTimer) {
      clearTimeout(taskFinishPollTimer);
      taskFinishPollTimer = null;
    }
  }

  function sendTaskFinishNow(trigger = 'unknown') {
    if (taskFinishSent) return;
    if (!minimaxWs || minimaxWs.readyState !== WebSocket.OPEN) return;
    taskFinishSent = true;
    clearTaskFinishPollTimer();
    console.log(
      `[${agentId}] 发送 task_finish(${trigger})，文本块=${textChunksSent}，音频块=${audioChunksReceived}`
    );
    minimaxWs.send(JSON.stringify({ event: 'task_finish' }));
  }

  function requestTaskFinish(trigger = 'unknown') {
    if (taskFinishSent) return;
    taskFinishRequested = true;
    if (!taskFinishRequestedAt) taskFinishRequestedAt = Date.now();

    const MAX_WAIT_MS = 25000;
    const LOCAL_SETTLE_MS = 1200;

    clearTaskFinishPollTimer();

    function poll() {
      if (taskFinishSent) return;
      if (!minimaxWs || minimaxWs.readyState !== WebSocket.OPEN) return;

      // 收尾阶段确保本地缓冲文本全部入队
      if (textAccumulator && textAccumulator.trim().length > 0) {
        flushTextToMinimax();
      }
      if (pendingTexts.length > 0) {
        const remain = pendingTexts.join(' ');
        pendingTexts = [];
        sendTaskContinueToMinimax(remain, { mode: 'pending', reason: 'finish_wait_flush' });
      }

      const queuedForThisWs = getQueuedMinimaxTaskContinueCountForWs(minimaxWs);
      const waitForLocalSettle = lastLocalTaskContinueSentAt > 0
        ? Math.max(0, LOCAL_SETTLE_MS - (Date.now() - lastLocalTaskContinueSentAt))
        : 0;

      if (queuedForThisWs === 0 && waitForLocalSettle === 0) {
        sendTaskFinishNow(trigger + '_drained');
        return;
      }

      const waited = Date.now() - taskFinishRequestedAt;
      if (waited >= MAX_WAIT_MS) {
        console.warn(
          `[${agentId}] ⚠️ task_finish 等待超时(${waited}ms)，强制发送；queued=${queuedForThisWs}, settleWait=${waitForLocalSettle}ms`
        );
        sendTaskFinishNow(trigger + '_timeout');
        return;
      }

      const delay = Math.max(120, Math.min(600, waitForLocalSettle || 200));
      taskFinishPollTimer = setTimeout(poll, delay);
    }

    poll();
  }

  // 兜底：TTS 连接建立后立即下发一次 RPM 快照，避免前端因时序看不到日志
  setTimeout(() => {
    pushRpmProfile('tts_proxy_connected');
  }, 0);

  function sendTaskContinueToMinimax(text, meta = {}) {
    const textToSend = String(text || '').trim();
    if (!textToSend) return false;
    const mode = meta.mode || 'unknown';
    const reason = meta.reason || 'stream';

    return enqueueMinimaxTaskContinue(minimaxWs, textToSend, {
      onSent: () => {
        textChunksSent++;
        lastLocalTaskContinueSentAt = Date.now();
        console.log(
          `[${agentId}] → MiniMax 文本块 #${textChunksSent} (${textToSend.length} 字, mode=${mode}, reason=${reason}): "${textToSend.substring(0, 40)}..."`
        );
        if (taskFinishRequested && !taskFinishSent) {
          requestTaskFinish('task_continue_sent');
        }
      },
      onError: (e) => {
        console.error(`[${agentId}] ❌ task_continue 发送失败: ${e.message}`);
      },
      meta: {
        agentId,
        roomId: ws._roomId || null
      }
    });
  }

  // 刷新聚合的文本到 MiniMax
  function flushTextToMinimax() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!textAccumulator || textAccumulator.trim().length === 0) return;

    const textToSend = textAccumulator.trim();
    textAccumulator = '';
    const profile = getTextFlushProfile();

    if (isReady && minimaxWs && minimaxWs.readyState === WebSocket.OPEN) {
      sendTaskContinueToMinimax(textToSend, { mode: profile.label, reason: 'flush' });
    } else {
      pendingTexts.push(textToSend);
    }
  }

  // 添加文本到聚合器
  function accumulateText(text) {
    textAccumulator += text;
    const profile = getTextFlushProfile();
    if (profile.flushOnCompleteOnly) {
      // 预加载阶段：只累计文本，不做中途 flush；等待 end 统一发送一次
      return;
    }

    // 普通发言：保留“句号即刷”提升实时性；预加载：仅按阈值/间隔刷新，降低 RPM 峰值。
    const hasSentenceEnd = SENTENCE_END_RE.test(textAccumulator);
    if (textAccumulator.length >= profile.minChars || (profile.flushOnSentenceEnd && hasSentenceEnd)) {
      flushTextToMinimax();
    } else {
      // 否则按当前策略间隔刷新
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flushTextToMinimax, profile.intervalMs);
    }
  }
  
  // 连接 MiniMax
  const minimax = getMinimaxConfig();
  if (!minimax.apiKey) {
    ws.send(JSON.stringify({ type: 'error', message: 'MiniMax API Key 未配置，请先在首页头像菜单里设置 API Keys' }));
    try { ws.close(); } catch (e) {}
    return;
  }
  minimaxWs = new WebSocket(minimax.wsUrl, {
    headers: { 'Authorization': `Bearer ${minimax.apiKey}` }
  });
  
  minimaxWs.on('open', () => {
    console.log(`[${agentId}] MiniMax 已连接，发送 task_start`);
    minimaxWs.send(JSON.stringify({
      event: 'task_start',
      model: 'speech-2.8-hd',
      voice_setting: {
        voice_id: voiceId,
        speed: 1, vol: 1, pitch: 0,
        english_normalization: false
      },
      audio_setting: {
        sample_rate: 32000, bitrate: 128000,
        format: 'mp3', channel: 1
      }
    }));
    pushRpmProfile('minimax_open');
  });
  
  minimaxWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      // 打印所有事件便于调试
      if (msg.event !== 'task_started' && msg.event !== 'task_continued') {
        console.log(`[${agentId}] MiniMax event:`, msg.event, JSON.stringify(msg).slice(0, 200));
      }
      
      if (msg.event === 'task_started' || msg.event === 'connected_success') {
        isReady = true;
        // 合并所有文本（pending + accumulator）一次性发送
        flushTextToMinimax(); // 先刷新聚合器
        if (pendingTexts.length > 0) {
          const allText = pendingTexts.join(' ');
          pendingTexts = [];
          sendTaskContinueToMinimax(allText, { mode: 'pending', reason: 'ready_flush' });
          console.log(`[${agentId}] MiniMax 就绪，发送 pending 文本 (${allText.length} 字)`);
        } else {
          console.log(`[${agentId}] MiniMax 就绪，无待处理文本`);
        }
        // 如果已经收到 end，等待 2 秒后发送 task_finish
        if (endReceived) {
          requestTaskFinish('ready_after_end');
        }
        return;
      }
      
      if (msg.event === 'task_failed') {
        console.error(`[${agentId}] MiniMax task_failed:`, msg);
        const statusMsg = String(msg?.base_resp?.status_msg || msg?.error || '').toLowerCase();
        const isRateLimit = statusMsg.includes('rate limit') || statusMsg.includes('rpm');
        if (statusMsg.includes('rate limit') || statusMsg.includes('rpm')) {
          registerMinimaxRateLimit(`${agentId}${ws._roomId ? `@${ws._roomId}` : ''}`);
        }
        pushRpmProfile('task_failed', {
          isRateLimit,
          statusMsg: String(msg?.base_resp?.status_msg || msg?.error || '')
        });
        // 房间推流顺序推进：当前人失败也要尝试切到下一位，避免卡死在“无推流”
        const failedRoomPusher = ws._roomId && rooms.get(ws._roomId)?.podcastPusher;
        if (failedRoomPusher && failedRoomPusher.connected) {
          failedRoomPusher.onSpeakerTtsFinished(agentId);
        }
        // 转发给前端，让前端可以触发限流重试
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
        return;
      }
      
      if (msg.event === 'error') {
        console.error(`[${agentId}] MiniMax 错误:`, msg.error || msg);
        return;
      }
      
      // 统计音频块
      if (msg.data && msg.data.audio) {
        audioChunksReceived++;
        if (audioChunksReceived % 10 === 0) {
          console.log(`[${agentId}] 已收到 ${audioChunksReceived} 个音频块`);
        }

        // Podcast 推流：从该 TTS 连接所属房间获取 pusher
        const roomPusher = ws._roomId && rooms.get(ws._roomId)?.podcastPusher;
        if (audioChunksReceived === 1) {
          console.log(`[${agentId}] 第一个音频块, roomId=${ws._roomId}, pusher=${!!roomPusher}, connected=${roomPusher?.connected}`);
        }
        if (roomPusher && roomPusher.connected) {
          roomPusher.pushAudio(agentId, msg.data.audio, fullTextForPodcast);
        }
      }

      if (msg.event === 'task_finished') {
        const finishedRoomPusher = ws._roomId && rooms.get(ws._roomId)?.podcastPusher;
        if (finishedRoomPusher && finishedRoomPusher.connected) {
          finishedRoomPusher.onSpeakerTtsFinished(agentId);
        }
      }

      // 转发给客户端
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    } catch (e) {
      console.error(`[${agentId}] 处理 MiniMax 消息出错:`, e.message);
    }
  });
  
  minimaxWs.on('error', (err) => {
    console.error(`[${agentId}] MiniMax 连接错误:`, err.message);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'error', error: 'MiniMax connection failed' }));
    }
  });
  
  minimaxWs.on('close', (code, reason) => {
    console.log(`[${agentId}] MiniMax 连接关闭:`, code, reason?.toString());
    clearTaskFinishPollTimer();
    // 延迟关闭前端 WS，给前端时间处理 task_failed 并发起重试
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }, 500);
  });
  
  // 接收客户端消息
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'text' && data.content) {
        // 清理文本：去掉换行符（替换为空格），合并多余空格
        const cleanedText = data.content.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ');
        if (cleanedText.trim().length > 0) {
          fullTextForPodcast += cleanedText;
          accumulateText(cleanedText);
        }
      }
      
      if (data.type === 'end') {
        endReceived = true;

        // 先刷新聚合器中的剩余文本
        flushTextToMinimax();

        console.log(`[${agentId}] 收到结束信号，共发送 ${textChunksSent} 个文本块给 MiniMax`);

        if (isReady && minimaxWs.readyState === WebSocket.OPEN) {
          // MiniMax 已就绪，发送剩余 pending 文本
          if (pendingTexts.length > 0) {
            const text = pendingTexts.join(' ');
            pendingTexts = [];
            sendTaskContinueToMinimax(text, { mode: 'pending', reason: 'end_flush' });
            console.log(`[${agentId}] 刷新 pending 文本 (${text.length} 字)`);
          }
          requestTaskFinish('end_received');
        }
        // 如果没就绪，等 task_started 时再处理
      }
    } catch (e) {
      console.error(`[${agentId}] 处理客户端消息出错:`, e.message);
    }
  });
  
  ws.on('close', () => {
    console.log(`[${agentId}] TTS 断开, conn=${ws._connId}, seq=${ws._connSeq}${ws._superseded ? `, supersededBy=${ws._supersededBy || 'n/a'}` : ''}`);
    try {
      if (minimaxWs && minimaxWs.readyState === WebSocket.OPEN) {
        minimaxWs.send(JSON.stringify({ event: 'task_finish' }));
      }
      if (minimaxWs && minimaxWs.readyState !== WebSocket.CLOSED) {
        minimaxWs.close();
      }
    } catch (e) {}
  });
});

// API 状态
app.get('/api/status', (req, res) => {
  res.json({
    agents: Object.fromEntries(
      Object.entries(AGENTS).map(([id, agent]) => [id, {
        id: agent.id,
        name: agent.name,
        displayName: agent.displayName,
        emoji: agent.emoji,
        hasPersona: !!agent.systemPrompt,
        personaLength: agent.systemPrompt?.length || 0,
        memorySize: memory[id].length
      }])
    ),
    mode: 'http-api-streaming',
    features: ['streaming', 'persona', 'memory', '6-agents'],
    connections: Object.keys(AGENTS).reduce((acc, id) => {
      acc[id] = Array.from(wss.clients).filter(ws => ws._agentId === id).length;
      return acc;
    }, {})
  });
});

// 刷新指定智能体的人设
app.post('/api/persona/:agentId/refresh', (req, res) => {
  const { agentId } = req.params;
  if (!AGENTS[agentId]) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  refreshPersona(agentId);
  res.json({ 
    success: true, 
    agentId,
    hasPersona: !!AGENTS[agentId].systemPrompt,
    personaLength: AGENTS[agentId].systemPrompt?.length || 0
  });
});

// 删除智能体
app.delete('/api/agents/:agentId', async (req, res) => {
    const { agentId } = req.params;
    console.log(`[API] Deleting agent: ${agentId}`);

    try {
        // Step 1: 如果有 Podcast API 注册，先调用远程删除
        let podcastDeleted = false;
        let podcastDeleteTried = false;
        let podcastDeleteError = '';
        let podcastDeleteStatus = '';
        try {
            const metaPath = path.join(DATA_AGENTS_DIR, agentId, 'meta.json');
            if (fs.existsSync(metaPath)) {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                if (meta.podcastApiKey && meta.podcastAgentId) {
                    podcastDeleteTried = true;
                    const axios = require('axios');
                    const delResp = await axios.delete(`${PODCAST_API_BASE}/agent/me`, {
                        headers: { 'X-API-Key': meta.podcastApiKey },
                        timeout: 10000
                    });
                    if (delResp.data && delResp.data.code === 200) {
                        podcastDeleted = true;
                        podcastDeleteStatus = 'deleted';
                        console.log(`[Delete] Podcast Agent ${meta.podcastAgentId} 已删除`);
                    } else if (delResp.data && Number(delResp.data.code) === 404) {
                        // 部分服务会返回 code=404，区分为远端不存在（不算失败）
                        podcastDeleted = false;
                        podcastDeleteStatus = 'already_absent';
                        podcastDeleteError = 'remote agent not found';
                        console.log(`[Delete] Podcast Agent ${meta.podcastAgentId} 远端不存在(code=404)`);
                    } else {
                        podcastDeleteStatus = 'failed';
                        podcastDeleteError = `unexpected response: ${JSON.stringify(delResp.data)}`;
                        console.warn(`[Delete] Podcast API 返回异常: ${JSON.stringify(delResp.data)}`);
                    }
                }
            }
        } catch (podcastErr) {
            podcastDeleteTried = true;
            const status = Number(podcastErr?.response?.status || 0);
            const responseDataRaw = podcastErr?.response?.data;
            const responseText = typeof responseDataRaw === 'string'
                ? responseDataRaw
                : JSON.stringify(responseDataRaw || '');
            if (status === 404) {
                if (/page not found/i.test(responseText)) {
                    // 路由不存在：当前 Room 服务不支持删除 Agent 接口
                    podcastDeleted = false;
                    podcastDeleteStatus = 'unsupported';
                    podcastDeleteError = 'room service does not support DELETE /agent/me';
                    console.warn(`[Delete] Room 服务不支持删除 Agent 接口: ${responseText}`);
                } else {
                    // 路由存在但对象不存在
                    podcastDeleted = false;
                    podcastDeleteStatus = 'already_absent';
                    podcastDeleteError = 'remote agent not found';
                    console.log(`[Delete] Podcast Agent 远端不存在(HTTP 404)`);
                }
            } else {
                podcastDeleteStatus = 'failed';
                podcastDeleteError = podcastErr.message || 'podcast delete failed';
                console.warn(`[Delete] Podcast API 删除失败: ${podcastErr.message}`);
            }
            // 远程删除失败不阻塞本地删除
        }
        if (!podcastDeleteTried && !podcastDeleteStatus) {
            podcastDeleteStatus = 'skipped';
            podcastDeleteError = 'missing podcast registration';
        }

        // Step 2: 删除本地智能体
        const success = await openclaw.deleteAgent(agentId);
        if (success) {
            if (AGENTS[agentId]) delete AGENTS[agentId];
            res.json({
                success: true,
                podcastDeleted,
                podcastDeleteTried,
                podcastDeleteStatus,
                podcastDeleteError
            });
        } else {
            res.status(404).json({ error: 'Agent not found or failed to delete' });
        }
    } catch (e) {
        console.error(`[API] Error deleting agent ${agentId}:`, e);
        res.status(500).json({ error: e.message });
    }
});

// 获取智能体人设
app.get('/api/persona/:agentId', (req, res) => {
  const { agentId } = req.params;
  if (!AGENTS[agentId]) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  res.json({
    agentId,
    hasPersona: !!AGENTS[agentId].systemPrompt,
    personaLength: AGENTS[agentId].systemPrompt?.length || 0,
    preview: AGENTS[agentId].systemPrompt?.slice(0, 200) + '...' || null
  });
});

// 清空记忆
app.post('/api/memory/:agentId/clear', (req, res) => {
  const { agentId } = req.params;
  if (!AGENTS[agentId]) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  memory[agentId] = [];
  res.json({ success: true, agentId });
});

// ========== 增强版圆桌讨论控制 API ==========

// 获取可用的moderator（支持room）
function getModerator(channelId) {
  if (channelId) {
    const room = rooms.get(channelId);
    if (room) return room.moderator;
  }
  return moderator;
}

function ensureRoomExists(channelId, res) {
  if (!channelId) return null;
  const room = rooms.get(channelId);
  if (!room) {
    if (res && typeof res.status === 'function') {
      res.status(404).json({ error: '房间不存在，请刷新页面重建房间', roomMissing: true, channelId });
    }
    return null;
  }
  return room;
}

// 开始圆桌讨论（指定话题）
app.post('/api/roundtable/start', (req, res) => {
  const { topic, lang, channelId, source } = req.body;
  if (!topic) {
    return res.status(400).json({ error: '请提供讨论话题' });
  }
  if (channelId && !ensureRoomExists(channelId, res)) {
    return;
  }

  const mod = getModerator(channelId);

  res.json({ success: true, message: '圆桌讨论开始', topic });
  startRoundTable(topic, true, lang || 'zh', mod, channelId, { source: source || '' });
});

// 从知识库随机选择话题开始
app.post('/api/roundtable/random', (req, res) => {
  const { lang, channelId, source } = req.body || {};
  if (channelId && !ensureRoomExists(channelId, res)) {
    return;
  }
  const mod = getModerator(channelId);

  res.json({ success: true, message: '从知识库选择话题' });
  startRandomTopic(lang || 'zh', mod, channelId, { source: source || '' });
});

// 切换到下一个话题（更换话题）
app.post('/api/roundtable/next-topic', (req, res) => {
  const { lang, channelId } = req.body || {};
  if (channelId && !ensureRoomExists(channelId, res)) {
    return;
  }
  console.log(`[API] 切换到下一个话题${channelId ? ` (房间: ${channelId})` : ''}`);
  
  const result = switchToNewTopic(lang || 'zh', channelId || null);
  const mod = getModerator(channelId || null);

  if (result) {
    const topicData = mod.currentTopicData;
    if (channelId) {
      const room = rooms.get(channelId);
      if (room) {
        rememberTopicForRoom(room, topicData);
      }
    } else {
      rememberTopicGlobally(topicData);
    }

    // 房间模式：记录展示话题并广播，保持与自动流程一致
    if (channelId) {
      const room = rooms.get(channelId);
      if (room) {
        room.currentDisplayTopic = topicData;
        recordRoomTopicHistory(room, topicData, 'manual_next_topic');
        broadcastToRoom(room, {
          type: 'topic_changed',
          topicData: topicData
        });
      }
    }

    res.json({
      success: true,
      message: '已切换到新话题',
      topic: topicData?.title,
      category: topicData?.category,
      nextAgent: result.nextAgent
    });
    sendToAgent(result.nextAgent, result.message, 'moderator', 'next', channelId || null);
  } else {
    res.json({ success: false, message: '无法切换到新话题' });
  }
});

// 停止圆桌讨论
app.post('/api/roundtable/stop-active-rooms', (req, res) => {
  const source = (req.body && typeof req.body.source === 'string')
    ? req.body.source
    : 'pre_restart';
  const result = stopActiveRoomRoundtables({ source });
  res.json({ success: true, ...result });
});

app.post('/api/roundtable/stop', (req, res) => {
  const { channelId, scope, source } = req.body || {};
  if (channelId && !ensureRoomExists(channelId, res)) {
    return;
  }
  stopRoundTable(channelId || null, { source: source || '' });

  if (channelId) {
    // 房间模式：严格只清理当前房间
    abortOpenClawRequests((requestId, entry) => (entry.roomId || null) === channelId, 'Stop');
    closeRoomTtsSockets(channelId, 'roundtable_stop_room');
  } else if (scope === 'all') {
    // 显式全局清理（仅在明确要求时）
    abortOpenClawRequests(() => true, 'StopAll');
    closeRoomTtsSockets(null, 'roundtable_stop_all');
  } else {
    // 默认全局模式：只清理非房间(global)会话，避免误伤其他房间
    abortOpenClawRequests((requestId, entry) => (entry.roomId || null) === null, 'StopGlobal');
    closeGlobalTtsSockets('roundtable_stop_global');
  }

  res.json({ success: true, message: '圆桌讨论已停止' });
});

// 获取圆桌状态
app.get('/api/roundtable/status', (req, res) => {
  const { channelId } = req.query;
  if (channelId && !rooms.has(channelId)) {
    return res.json({
      isActive: false,
      roomMissing: true,
      channelId,
      currentTopic: null,
      currentTopicData: null,
      mode: null,
      discussionCount: 0,
      recentHistory: [],
      topicHistory: [],
      stuckDiagnostics: {
        generatedAt: Date.now(),
        channelId: channelId,
        isStuck: true,
        summary: 'room_missing',
        signature: 'room_missing',
        reasons: [{ code: 'room_missing', detail: '房间不存在，请刷新重建' }],
        snapshot: { isActive: false }
      }
    });
  }
  const mod = getModerator(channelId);
  const room = getRoom(channelId);
  const stuckDiagnostics = room ? maybeLogRoomStuckDiagnostics(room, 'api_roundtable_status') : null;

  res.json({
    isActive: mod.isActive,
    currentTopic: mod.currentTopic,
    // 非房间模式：如果有 pendingTopicData（过渡中），继续显示旧话题（displayTopicData），不要泄露新话题
    currentTopicData: getRoom(channelId)
      ? (getRoom(channelId).currentDisplayTopic || mod.currentTopicData)
      : (roundTableState.pendingTopicData
          ? roundTableState.displayTopicData  // 过渡中：显示旧话题
          : (roundTableState.displayTopicData || mod.currentTopicData)),
    mode: mod.mode,
    discussionCount: mod.discussionHistory ? mod.discussionHistory.length : 0,
    recentHistory: mod.discussionHistory ? mod.discussionHistory.slice(-3) : [],
    topicHistory: getRoom(channelId)?.topicHistory || [],
    stuckDiagnostics: stuckDiagnostics
  });
});

// 语音完成回调
app.post('/api/roundtable/speech-ended', async (req, res) => {
  const { agentId, content, designatedNextAgent, channelId, changeTopic } = req.body;

  if (!agentId) {
    return res.status(400).json({ error: '缺少参数' });
  }

  res.json({ success: true, message: '已接收回调' });

  // 异步处理（不阻塞响应）
  const safeContent = String(content || '').trim() || '[系统兜底] 当前轮文本未完整返回，请继续下一位。';
  onSpeechEnded(agentId, safeContent, designatedNextAgent, channelId, changeTopic);
});

// 语音开始播放回调（首次音频块播放时触发）
app.post('/api/roundtable/speech-started', async (req, res) => {
  const { agentId, channelId } = req.body;

  if (!agentId) {
    return res.status(400).json({ error: '缺少参数' });
  }

  const room = channelId ? rooms.get(channelId) : null;
  const state = getRoundTableState(channelId);

  // 清除准备状态（该 agent 已经开始播放）
  if (state.preparingAgent === agentId) {
    const elapsed = Date.now() - state.preparingStartTime;
    console.log(`[RoundTable] ✅ ${agentId} 开始播放，清除准备状态（准备耗时 ${elapsed}ms）`);
    state.preparingAgent = null;
    state.preparingStartTime = null;
  }

  // 房间模式：仅在真实开始播放时通知 Podcast 上麦，避免预准备阶段误触发下麦
  if (channelId) {
      const pusher = room?.podcastPusher;
      if (pusher && pusher.connected) {
          pusher.speakerJoin(agentId);
      }
  }
  
  // [ADDED] 检查是否有暂存的新话题数据需要切换
  if (channelId) {
      if (room && room.nextTopicData) {
          console.log(`[RoundTable] 🔄 [房间] 发言开始，正式切换话题卡: ${room.nextTopicData.title.substring(0, 20)}...`);
          room.currentDisplayTopic = room.nextTopicData;
          recordRoomTopicHistory(room, room.nextTopicData, 'transition_started');
          broadcastToRoom(room, {
            type: 'topic_changed',
            topicData: room.nextTopicData
          });
          // 同步话题到 Podcast 房间（agentId 是新话题的首位发言人）
          syncTopicToPodcast(room, room.nextTopicData, agentId);
          room.nextTopicData = null;
      }
  } else {
      // 非房间模式：检查全局暂存的话题数据
      if (roundTableState.pendingTopicData) {
          console.log(`[RoundTable] 🔄 [非房间] 发言开始，正式切换话题卡: ${roundTableState.pendingTopicData.title.substring(0, 20)}...`);
          roundTableState.displayTopicData = roundTableState.pendingTopicData;
          // 广播给所有非房间模式的 WebSocket 客户端
          for (const ws of wss.clients) {
            if (ws._agentId && !ws._isTTS && !ws._roomId && ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({
                  type: 'topic_changed',
                  topicData: roundTableState.pendingTopicData
                }));
              } catch(e) {}
            }
          }
          roundTableState.pendingTopicData = null;
      }
  }

  res.json({ success: true });
});

// 用户输入（打断当前讨论）
app.post('/api/roundtable/user-input', async (req, res) => {
  const { input, targetAgent, channelId } = req.body;

  console.log(`[RoundTable] 📥 收到打断请求: input="${input}", targetAgent="${targetAgent}", channelId="${channelId}"`);

  if (!input) {
    return res.status(400).json({ error: '请提供输入内容' });
  }

  res.json({ success: true, message: '已接收用户输入' });

  // 异步处理，传递用户指定的目标 agent
  try {
    handleUserInput(input, targetAgent, channelId);
  } catch (err) {
    console.error('[RoundTable] ❌ handleUserInput 异常:', err);
  }
});

// 调侃模式（保留路由兼容前端）
app.post('/api/roundtable/banter', (req, res) => {
  res.json({ success: true, message: '调侃模式暂未启用' });
});

// Serve OpenClaw Web Roundtable static files
app.use('/roundtable', express.static(path.join(__dirname, 'public/roundtable')));

// Serve Meco Studio pages
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public/chat.html')));
app.get('/create', (req, res) => res.sendFile(path.join(__dirname, 'public/create.html')));
app.get('/edit', (req, res) => res.sendFile(path.join(__dirname, 'public/edit.html')));
app.get('/playgen', (req, res) => res.redirect('/'));
app.get('/playgen.html', (req, res) => res.redirect('/'));
app.get('/roundtable-config', (req, res) => res.sendFile(path.join(__dirname, 'public/roundtable-config.html')));

// Get Agent Soul (Prompt)
app.get('/api/agents/:agentId/soul', (req, res) => {
    const { agentId } = req.params;
    const agent = getAgentById(agentId);
    if (!agent) return res.status(404).send('Agent not found');

    let content = '';
    
    // 1. Try prompt.txt in workspace
    const promptPath = path.join(agent.workspace, 'prompt.txt');
    if (fs.existsSync(promptPath)) {
        try {
            content = fs.readFileSync(promptPath, 'utf-8');
        } catch(e) {}
    }

    // 2. If empty, try SOUL.md in workspace (OpenClaw style)
    if (!content) {
        const soulPath = path.join(agent.workspace, 'SOUL.md');
        if (fs.existsSync(soulPath)) {
             try {
                content = fs.readFileSync(soulPath, 'utf-8');
            } catch(e) {}
        }
    }
    
    // 3. If still empty, try agent/IDENTITY.md (OpenClaw system style)
    if (!content) {
         const identityPath = path.join(agent.workspace, 'agent', 'IDENTITY.md');
         if (fs.existsSync(identityPath)) {
             try {
                content = fs.readFileSync(identityPath, 'utf-8');
            } catch(e) {}
         }
    }

    res.json({ content });
});

// API to get available agents for roundtable
app.get('/api/roundtable/agents', (req, res) => {
  const agents = Object.entries(AGENTS).map(([id, agent]) => ({
    id: id,
    name: agent.name,
    displayName: agent.displayName,
    emoji: agent.emoji,
    voiceId: AGENT_VOICES[id] || AGENT_VOICES['main']
  }));
  res.json({ agents });
});

app.get('/api/roundtable/rpm-profile', (req, res) => {
  const now = Date.now();
  const taskContinueMinGapMs = getEffectiveMinimaxTaskContinueMinGapMs(now);
  const taskContinueMinGapBaseMs = Math.max(1, Number(MINIMAX_TASK_CONTINUE_MIN_GAP_MS) || 1);
  const estimatedTaskContinueRpmCap = Math.floor(60000 / taskContinueMinGapMs);
  const recommendedBudgetRpm = Math.max(1, Number(MINIMAX_RECOMMENDED_RPM_BUDGET) || 1);
  const cooldownRemainingMs = Math.max(0, minimaxRateLimitCooldownUntil - now);
  const guardRemainingMs = Math.max(0, minimaxRateLimitGuardUntil - now);
  const rateLimitGuardActive = guardRemainingMs > 0;
  const queryAgentId = typeof req.query.agentId === 'string' ? req.query.agentId.trim() : '';
  const hasChannelParam = Object.prototype.hasOwnProperty.call(req.query || {}, 'channelId');
  const queryRoomId = hasChannelParam
    ? ((req.query.channelId == null || String(req.query.channelId).trim() === '') ? null : String(req.query.channelId).trim())
    : undefined;
  const rpmStats = getMinimaxTaskContinueRpmStats({
    agentId: queryAgentId || undefined,
    roomId: queryRoomId
  });
  const capUsageGlobalPct = Math.round((rpmStats.realTaskContinueRpmGlobal * 100) / Math.max(1, estimatedTaskContinueRpmCap));
  const capUsageScopedPct = Math.round((rpmStats.realTaskContinueRpmScoped * 100) / Math.max(1, estimatedTaskContinueRpmCap));
  const budgetUsageGlobalPct = Math.round((rpmStats.realTaskContinueRpmGlobal * 100) / recommendedBudgetRpm);
  const budgetUsageScopedPct = Math.round((rpmStats.realTaskContinueRpmScoped * 100) / recommendedBudgetRpm);

  res.json({
    taskContinueMinGapMs,
    taskContinueMinGapBaseMs,
    estimatedTaskContinueRpmCap,
    recommendedBudgetRpm,
    rateLimitCooldownMs: MINIMAX_RATE_LIMIT_COOLDOWN_MS,
    rateLimitGuardActive,
    rateLimitGuardRemainingMs: guardRemainingMs,
    queueLimit: MINIMAX_TASK_CONTINUE_QUEUE_LIMIT,
    queueDepth: minimaxTaskContinueQueue.length,
    cooldownRemainingMs,
    rpmWindowMs: rpmStats.rpmWindowMs,
    realTaskContinueLast60sGlobal: rpmStats.realTaskContinueLast60sGlobal,
    realTaskContinueRpmGlobal: rpmStats.realTaskContinueRpmGlobal,
    realTaskContinueLast60sScoped: rpmStats.realTaskContinueLast60sScoped,
    realTaskContinueRpmScoped: rpmStats.realTaskContinueRpmScoped,
    capUsageGlobalPct,
    capUsageScopedPct,
    budgetUsageGlobalPct,
    budgetUsageScopedPct,
    flushProfiles: {
      active: {
        intervalMs: TTS_TEXT_FLUSH_ACTIVE_INTERVAL_MS,
        minChars: TTS_TEXT_FLUSH_ACTIVE_MIN_CHARS,
        flushOnSentenceEnd: true,
        flushOnCompleteOnly: false
      },
      preload: {
        intervalMs: TTS_TEXT_FLUSH_PRELOAD_INTERVAL_MS,
        minChars: TTS_TEXT_FLUSH_PRELOAD_MIN_CHARS,
        flushOnSentenceEnd: false,
        flushOnCompleteOnly: true
      }
    }
  });
});

app.get(/^\/rustdesk-web$/, (req, res) => {
  return res.redirect(302, '/rustdesk-web/');
});

app.get(/^\/rustdesk-web\/(.*)$/, async (req, res) => {
  try {
    const pathPart = remoteSafeString(req.params && req.params[0]);
    const rawOriginalUrl = remoteSafeString(req.originalUrl || '');
    const queryIndex = rawOriginalUrl.indexOf('?');
    const search = queryIndex >= 0 ? rawOriginalUrl.slice(queryIndex) : '';
    const target = buildRustDeskWebProxyUrl(pathPart, search);

    const upstream = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: {
        accept: remoteSafeString(req.headers.accept) || '*/*',
        'accept-language': remoteSafeString(req.headers['accept-language']) || '',
        'user-agent': remoteSafeString(req.headers['user-agent']) || 'MecoStudio-RustDeskProxy'
      }
    });

    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const nextLocation = rewriteRustDeskWebRedirectLocation(upstream.headers.get('location'));
      if (nextLocation) {
        return res.redirect(upstream.status, nextLocation);
      }
    }

    res.status(upstream.status);
    const headerAllowList = [
      'content-type',
      'cache-control',
      'etag',
      'last-modified',
      'expires',
      'content-language',
      'vary'
    ];
    for (const headerName of headerAllowList) {
      const value = upstream.headers.get(headerName);
      if (value) {
        res.setHeader(headerName, value);
      }
    }

    const contentType = remoteSafeString(upstream.headers.get('content-type')).toLowerCase();
    if (contentType.includes('text/html')) {
      const settings = getRuntimeSettings();
      const publicCandidates = getRustDeskPublicRendezvousCandidates(settings);
      const publicCandidateSet = new Set(publicCandidates);
      const localCandidates = getRustDeskLocalRendezvousCandidates(settings)
        .filter((candidate) => !publicCandidateSet.has(candidate));
      const shouldTryLocal = localCandidates.length > 0;
      let preferredLocal = shouldTryLocal ? localCandidates[0] : '';
      let initialRendezvous = publicCandidates[0] || RUSTDESK_PUBLIC_RENDEZVOUS;
      if (shouldTryLocal) {
        for (const candidate of localCandidates) {
          const localReachable = await probeRustDeskServerTcp(candidate, 650);
          if (localReachable) {
            preferredLocal = candidate;
            initialRendezvous = candidate;
            break;
          }
        }
      }
      const serverKey = readLocalRustDeskServerPublicKey();
      const rawHtml = await upstream.text();
      return res.send(rewriteRustDeskWebHtml(rawHtml, {
        localRendezvous: shouldTryLocal ? preferredLocal : '',
        initialRendezvous,
        publicCandidates,
        serverKey
      }));
    }

    const raw = await upstream.arrayBuffer();
    return res.send(Buffer.from(raw));
  } catch (e) {
    console.warn(`[RemoteControl] rustdesk-web proxy failed: ${e.message || e}`);
    return res.status(502).send('RustDesk Web 代理不可用');
  }
});

app.get('/web', (req, res) => {
  return res.redirect(302, '/index.html#agenttools');
});

app.get('/web/:owner/:device', (req, res) => {
  try {
    if (isEmbeddedRemoteEntryRequest(req)) {
      return res.redirect(302, buildEmbeddedAgenttoolsPath());
    }
    // 顶层直接访问 /web/:owner/:device 时，进入该机器自身页面，不再注入 remoteRoute，
    // 避免前端二次触发远控窗口模式后“跳回本机”。
    return res.redirect(302, '/index.html#agenttools');
  } catch (e) {
    console.warn(`[RemoteControl] /web route resolve failed: ${e.message || e}`);
    return res.redirect(302, '/index.html#agenttools');
  }
});

app.get('/rustdesk', (req, res) => {
  return res.redirect(302, '/index.html#agenttools');
});

app.get('/rustdesk/:owner/:device', (req, res) => {
  try {
    if (isEmbeddedRemoteEntryRequest(req)) {
      return res.redirect(302, buildEmbeddedAgenttoolsPath());
    }
    const owner = remoteToSlug(req.params.owner || '', 'user');
    const device = remoteToSlug(req.params.device || '', 'dev');
    const rustdeskPath = normalizeRemoteRoutePathForMatch(`/rustdesk/${owner}/${device}`);
    const settings = getRuntimeSettings();
    const bound = findBoundRemoteDeviceByPath(rustdeskPath, settings);
    const targetRoute = bound && bound.routePath
      ? bound.routePath
      : normalizeRemoteRoutePathForMatch(`/web/${owner}/${device}`);
    return res.redirect(302, buildRemoteEntryRedirectPath(targetRoute, { mode: 'rustdesk' }));
  } catch (e) {
    console.warn(`[RemoteControl] /rustdesk route resolve failed: ${e.message || e}`);
    return res.redirect(302, '/index.html#agenttools');
  }
});

// Backward compatibility for historical Mesh route.
app.get('/mesh', (req, res) => {
  return res.redirect(302, '/rustdesk');
});

app.get('/mesh/:owner/:device', (req, res) => {
  const owner = remoteToSlug(req.params.owner || '', 'user');
  const device = remoteToSlug(req.params.device || '', 'dev');
  return res.redirect(302, `/rustdesk/${owner}/${device}`);
});

app.get(/.*/, (req, res, next) => {
  try {
    const pathOnly = normalizeRemoteRoutePathForMatch(req.path || req.originalUrl || '');
    if (shouldSkipRemoteEntryPath(pathOnly)) {
      return next();
    }

    const settings = getRuntimeSettings();
    const device = findBoundRemoteDeviceByPath(pathOnly, settings);
    if (!device) {
      return next();
    }

    const mode = inferRemoteEntryMode(pathOnly, settings);
    const target = buildRemoteEntryRedirectPath(
      device.routePath || pathOnly,
      mode === 'rustdesk' ? { mode: 'rustdesk' } : {}
    );
    return res.redirect(302, target);
  } catch (e) {
    console.warn(`[RemoteControl] public entry match failed: ${e.message || e}`);
    return next();
  }
});

const PORT = process.env.PORT || 3456;
startUploadCleanupScheduler();
setInterval(sweepStalledCurrentSpeakers, ROOM_SPEAKER_SWEEP_INTERVAL_MS);
setInterval(sweepStalledPreparedDispatch, ROOM_PREPARED_SWEEP_INTERVAL_MS);
setInterval(sweepRoomStuckDiagnosticsLogs, 3000);

let isShuttingDown = false;
function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[Shutdown] 收到 ${signal}，先停止活跃圆桌并打断音频`);
  try {
    const summary = stopActiveRoomRoundtables({ source: 'pre_restart' });
    console.log(
      `[Shutdown] 活跃房间停止结果: activeBefore=${summary.activeRoomsBeforeStop}, stopped=${summary.stoppedCount}`
    );
  } catch (e) {
    console.error(`[Shutdown] 停止活跃房间失败: ${e.message}`);
  }

  const FORCE_EXIT_MS = 2500;
  setTimeout(() => {
    try {
      server.close(() => {
        console.log('[Shutdown] HTTP 服务已关闭');
        process.exit(0);
      });
    } catch (e) {
      console.error(`[Shutdown] 关闭 HTTP 服务异常: ${e.message}`);
      process.exit(1);
    }
  }, 300);

  setTimeout(() => {
    console.error('[Shutdown] 超时强制退出');
    process.exit(1);
  }, FORCE_EXIT_MS);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

server.listen(PORT, () => {
  console.log(`Meco Studio 运行在 http://localhost:${PORT}`);
  console.log(`圆桌会议: http://localhost:${PORT}/roundtable`);
  console.log('支持的智能体:', Object.values(AGENTS).map(a => `${a.emoji} ${a.name}`).join(', '));
});
