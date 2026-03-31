const axios = require('axios');

const API_BASE = 'https://openspeech.bytedance.com';

const DEFAULT_APP_ID = process.env.DOUBAO_O2O_APP_ID || '';
const DEFAULT_TOKEN = process.env.DOUBAO_O2O_TOKEN || '';
const DEFAULT_RESOURCE_ID = process.env.DOUBAO_O2O_RESOURCE_ID || 'volc.service_type.10029';
const DEFAULT_MODEL_TYPE = Number(process.env.DOUBAO_O2O_MODEL_TYPE || 5);
const DEFAULT_LANGUAGE = Number(process.env.DOUBAO_O2O_LANGUAGE || 0);
const DEFAULT_SOURCE = Number(process.env.DOUBAO_O2O_SOURCE || 2);

function buildHeaders(token, resourceId) {
  return {
    Authorization: `Bearer;${token}`,
    'Resource-Id': resourceId,
    'Content-Type': 'application/json'
  };
}

function normalizeAudioFormat(input) {
  const format = String(input || '').trim().toLowerCase();
  if (format === 'mp3' || format === 'wav' || format === 'pcm') return format;
  if (format === 'x-wav') return 'wav';
  if (format === 'mpeg' || format === 'mpga') return 'mp3';
  return 'wav';
}

function normalizeSpeakerId(agentId, speakerId = '') {
  const safeAgent = String(agentId || 'agent')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28) || 'agent';

  const safeSpeaker = String(speakerId || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '');

  if (safeSpeaker) return safeSpeaker.slice(0, 64);
  return `${safeAgent}_o2o_${Date.now()}`.slice(0, 64);
}

function parseBaseResp(data) {
  if (!data || typeof data !== 'object') return {};
  return data.BaseResp || data.base_resp || {};
}

function baseRespError(baseResp) {
  const statusCode = Number(baseResp?.StatusCode || baseResp?.status_code || 0);
  const statusMessage = String(baseResp?.StatusMessage || baseResp?.status_msg || '').trim();
  if (statusCode === 0) return '';
  return statusMessage || `status_code=${statusCode}`;
}

function mapSpeakerStatus(rawStatus) {
  const status = Number(rawStatus);
  if (status === 0) return 'untrained';
  if (status === 1) return 'training';
  if (status === 2) return 'success';
  if (status === 3) return 'failure';
  if (status === 4) return 'active';
  return 'unknown';
}

async function submitO2oClone(options = {}) {
  const appId = String(options.appId || DEFAULT_APP_ID).trim();
  const token = String(options.token || DEFAULT_TOKEN).trim();
  const resourceId = String(options.resourceId || DEFAULT_RESOURCE_ID).trim();
  const modelType = Number.isFinite(Number(options.modelType)) ? Number(options.modelType) : DEFAULT_MODEL_TYPE;
  const language = Number.isFinite(Number(options.language)) ? Number(options.language) : DEFAULT_LANGUAGE;
  const source = Number.isFinite(Number(options.source)) ? Number(options.source) : DEFAULT_SOURCE;
  const audioBytes = String(options.audioBytes || '').trim();
  const audioFormat = normalizeAudioFormat(options.audioFormat || 'wav');
  const speakerId = normalizeSpeakerId(options.agentId, options.speakerId || '');

  if (!appId) throw new Error('missing appId');
  if (!token) throw new Error('missing token');
  if (!audioBytes) throw new Error('missing audio data');

  const payload = {
    appid: appId,
    speaker_id: speakerId,
    audios: [
      {
        audio_bytes: audioBytes,
        audio_format: audioFormat
      }
    ],
    source,
    language,
    model_type: modelType
  };

  const response = await axios.post(
    `${API_BASE}/api/v1/mega_tts/audio/upload`,
    payload,
    {
      headers: buildHeaders(token, resourceId),
      timeout: 30000
    }
  );

  const data = response?.data || {};
  const baseResp = parseBaseResp(data);
  const err = baseRespError(baseResp);
  if (err) throw new Error(`doubao upload failed: ${err}`);

  return {
    speakerId: String(data.speaker_id || speakerId),
    baseResp,
    raw: data
  };
}

async function queryO2oCloneStatus(options = {}) {
  const appId = String(options.appId || DEFAULT_APP_ID).trim();
  const token = String(options.token || DEFAULT_TOKEN).trim();
  const resourceId = String(options.resourceId || DEFAULT_RESOURCE_ID).trim();
  const source = Number.isFinite(Number(options.source)) ? Number(options.source) : DEFAULT_SOURCE;
  const speakerId = String(options.speakerId || '').trim();

  if (!appId) throw new Error('missing appId');
  if (!token) throw new Error('missing token');
  if (!speakerId) throw new Error('missing speakerId');

  const response = await axios.post(
    `${API_BASE}/api/v1/mega_tts/status`,
    {
      appid: appId,
      speaker_id: speakerId,
      source
    },
    {
      headers: buildHeaders(token, resourceId),
      timeout: 20000
    }
  );

  const data = response?.data || {};
  const baseResp = parseBaseResp(data);
  const err = baseRespError(baseResp);
  if (err) throw new Error(`doubao status failed: ${err}`);

  const speakerStatus = Number(data.speaker_status);
  return {
    speakerId,
    speakerStatus,
    speakerStatusLabel: mapSpeakerStatus(speakerStatus),
    baseResp,
    raw: data
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function pollO2oReady(options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 8);
  const intervalMs = Math.max(300, Number(options.intervalMs) || 2500);

  let last = null;
  for (let i = 0; i < maxAttempts; i++) {
    last = await queryO2oCloneStatus(options);
    if (!last) continue;
    if (last.speakerStatus === 2 || last.speakerStatus === 4) {
      return {
        ...last,
        ready: true,
        done: true,
        attempts: i + 1
      };
    }
    if (last.speakerStatus === 3) {
      return {
        ...last,
        ready: false,
        done: true,
        attempts: i + 1
      };
    }
    if (i < maxAttempts - 1) {
      await sleep(intervalMs);
    }
  }

  return {
    ...(last || {
      speakerId: String(options.speakerId || ''),
      speakerStatus: null,
      speakerStatusLabel: 'unknown'
    }),
    ready: false,
    done: false,
    attempts: maxAttempts
  };
}

module.exports = {
  submitO2oClone,
  queryO2oCloneStatus,
  pollO2oReady,
  mapSpeakerStatus,
  normalizeAudioFormat
};
