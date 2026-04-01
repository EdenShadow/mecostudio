const axios = require('axios');
const crypto = require('crypto');

const API_BASE = 'https://openspeech.bytedance.com';
const LEGACY_RESOURCE_ID = 'volc.service_type.10029';
const OPENAPI_HOST = process.env.DOUBAO_O2O_OPENAPI_HOST || 'open.volcengineapi.com';
const OPENAPI_REGION = process.env.DOUBAO_O2O_OPENAPI_REGION || 'cn-beijing';
const OPENAPI_SERVICE = process.env.DOUBAO_O2O_OPENAPI_SERVICE || 'speech_saas_prod';
const DEFAULT_OPENAPI_ACCESS_KEY_ID =
  process.env.MECO_DOUBAO_O2O_ACCESS_KEY_ID
  || process.env.DOUBAO_O2O_ACCESS_KEY_ID
  || '';
const DEFAULT_OPENAPI_SECRET_ACCESS_KEY =
  process.env.MECO_DOUBAO_O2O_SECRET_ACCESS_KEY
  || process.env.DOUBAO_O2O_SECRET_ACCESS_KEY
  || '';
const DEFAULT_ORDER_RESOURCE_ID = process.env.DOUBAO_O2O_ORDER_RESOURCE_ID || 'volc.megatts.voiceclone';
const DEFAULT_ORDER_CODE = process.env.DOUBAO_O2O_ORDER_CODE || 'Model_storage';
const DEFAULT_ORDER_PROJECT_NAME = process.env.DOUBAO_O2O_ORDER_PROJECT_NAME || 'default';

const DEFAULT_APP_ID = process.env.DOUBAO_O2O_APP_ID || '';
const DEFAULT_TOKEN = process.env.DOUBAO_O2O_TOKEN || '';
const DEFAULT_APP_KEY = process.env.DOUBAO_O2O_APP_KEY || 'PlgvMymc7f3tQnJ6';
const DEFAULT_LANGUAGE = Number(process.env.DOUBAO_O2O_LANGUAGE || 0);

function normalizePositiveInteger(value, fallback, min = 1) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= min) return Math.floor(n);
  return Math.max(min, Math.floor(Number(fallback) || min));
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function hmacSha256(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(String(value || ''), 'utf8').digest(encoding);
}

function buildUtcDateStamp(inputDate = new Date()) {
  const date = inputDate instanceof Date ? inputDate : new Date(inputDate);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

function buildUtcDateTimeStamp(inputDate = new Date()) {
  const date = inputDate instanceof Date ? inputDate : new Date(inputDate);
  const pad = (n) => String(n).padStart(2, '0');
  return `${buildUtcDateStamp(date)}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function buildSignedOpenApiHeaders({
  action,
  version,
  body,
  accessKeyId,
  secretAccessKey,
  host = OPENAPI_HOST,
  region = OPENAPI_REGION,
  service = OPENAPI_SERVICE
}) {
  const safeAccessKeyId = String(accessKeyId || '').trim();
  const safeSecretAccessKey = String(secretAccessKey || '').trim();
  if (!safeAccessKeyId || !safeSecretAccessKey) {
    throw new Error('missing access key or secret access key');
  }
  const safeAction = String(action || '').trim();
  const safeVersion = String(version || '').trim();
  if (!safeAction || !safeVersion) {
    throw new Error('missing action or version for signed openapi request');
  }

  const payload = JSON.stringify(body || {});
  const payloadHash = sha256Hex(payload);
  const xDate = buildUtcDateTimeStamp();
  const shortDate = xDate.slice(0, 8);
  const canonicalQuery = `Action=${encodeURIComponent(safeAction)}&Version=${encodeURIComponent(safeVersion)}`;
  const canonicalHeaders = `host:${host}\n` + `x-content-sha256:${payloadHash}\n` + `x-date:${xDate}\n`;
  const signedHeaders = 'host;x-content-sha256;x-date';
  const canonicalRequest = [
    'POST',
    '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const credentialScope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const dateKey = hmacSha256(Buffer.from(safeSecretAccessKey, 'utf8'), shortDate);
  const regionKey = hmacSha256(dateKey, region);
  const serviceKey = hmacSha256(regionKey, service);
  const signingKey = hmacSha256(serviceKey, 'request');
  const signature = hmacSha256(signingKey, stringToSign, 'hex');
  const authorization = `HMAC-SHA256 Credential=${safeAccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const requestPath = `/?${canonicalQuery}`;
  return {
    requestPath,
    payload,
    headers: {
      Host: host,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Date': xDate,
      'X-Content-Sha256': payloadHash,
      Authorization: authorization
    }
  };
}

function normalizeAudioFormat(input) {
  const format = String(input || '').trim().toLowerCase();
  if (format === 'mp3' || format === 'wav' || format === 'pcm' || format === 'm4a' || format === 'ogg' || format === 'aac') return format;
  if (format === 'x-wav') return 'wav';
  if (format === 'mpeg' || format === 'mpga') return 'mp3';
  return 'wav';
}

function normalizeSpeakerId(_agentId, speakerId = '') {
  const safeSpeaker = String(speakerId || '').trim();
  if (!safeSpeaker) return '';
  return safeSpeaker.slice(0, 128);
}

function summarizeRemoteError(data) {
  if (!data) return '';
  if (typeof data === 'string') return data.trim().slice(0, 400);
  if (typeof data !== 'object') return '';

  const directFields = [
    data.message,
    data.error,
    data.err_msg,
    data.statusMessage
  ];
  for (const field of directFields) {
    const text = String(field || '').trim();
    if (text) return text.slice(0, 400);
  }

  try {
    return JSON.stringify(data).slice(0, 400);
  } catch (_) {
    return '';
  }
}

function isSpeakerResourceMismatchText(text) {
  return /resource id is mismatched with speaker related resource/i.test(String(text || ''));
}

function normalizeResourceId(value) {
  return String(value || '').trim();
}

function buildResourceIdCandidates(inputResourceId) {
  const explicit = normalizeResourceId(inputResourceId);
  const fallback = [
    'seed-icl-2.0',
    'seed-icl-1.0',
    'volc.megatts.voiceclone',
    LEGACY_RESOURCE_ID,
    ''
  ];
  const arr = explicit ? [explicit, ...fallback] : fallback;
  return Array.from(new Set(arr.map((x) => normalizeResourceId(x))));
}

function buildHttpError(prefix, err, options = {}) {
  const status = Number(err?.response?.status || 0);
  const remote = summarizeRemoteError(err?.response?.data);
  const fallback = String(err?.message || '').trim();
  const detail = remote || fallback || 'request failed';
  const statusText = status > 0 ? `HTTP ${status}` : 'HTTP request failed';
  let hint = '';
  if (status === 401 || status === 403) {
    hint = '；请检查 Doubao O2O AppID/Token 是否正确，并确认应用已开通声音复刻 API-V3 权限';
  } else if (status === 500 && isSpeakerResourceMismatchText(detail)) {
    hint = '；当前 speaker_id 与该应用资源不匹配，请在火山控制台音色库选择同一应用下的可用 S_ 音色ID';
  }
  const resourceCandidates = Array.isArray(options.resourceCandidates)
    ? options.resourceCandidates.map((x) => normalizeResourceId(x)).filter(Boolean)
    : [];
  const resourcesText = resourceCandidates.length > 0
    ? `；已尝试 Resource-Id: ${resourceCandidates.join(', ')}`
    : '';
  return new Error(`${prefix}: ${statusText}: ${detail}${hint}${resourcesText}`);
}

function buildOpenApiBusinessError(prefix, data) {
  const metadata = data?.ResponseMetadata || {};
  const err = metadata?.Error || null;
  const code = String(err?.CodeN || err?.Code || '').trim();
  const message = String(err?.Message || '').trim();
  if (!code && !message) return null;
  const detail = [code, message].filter(Boolean).join(': ');
  return new Error(`${prefix}: ${detail || 'unknown business error'}`);
}

async function callSignedOpenApi(options = {}) {
  const action = String(options.action || '').trim();
  const version = String(options.version || '').trim();
  const body = options.body && typeof options.body === 'object' ? options.body : {};
  const accessKeyId = String(options.accessKeyId || DEFAULT_OPENAPI_ACCESS_KEY_ID).trim();
  const secretAccessKey = String(options.secretAccessKey || DEFAULT_OPENAPI_SECRET_ACCESS_KEY).trim();
  const host = String(options.host || OPENAPI_HOST).trim();
  const region = String(options.region || OPENAPI_REGION).trim();
  const service = String(options.service || OPENAPI_SERVICE).trim();
  const timeout = Math.max(5000, Number(options.timeoutMs) || 30000);

  if (!action) throw new Error('missing openapi action');
  if (!version) throw new Error('missing openapi version');
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('missing access key credentials for doubao openapi');
  }

  const signed = buildSignedOpenApiHeaders({
    action,
    version,
    body,
    accessKeyId,
    secretAccessKey,
    host,
    region,
    service
  });
  let response;
  try {
    response = await axios.post(
      `https://${host}${signed.requestPath}`,
      signed.payload,
      {
        headers: signed.headers,
        timeout,
        maxRedirects: 0
      }
    );
  } catch (err) {
    throw buildHttpError(`doubao openapi ${action} failed`, err);
  }
  const data = response?.data || {};
  const bizErr = buildOpenApiBusinessError(`doubao openapi ${action} failed`, data);
  if (bizErr) throw bizErr;
  return data;
}

async function orderAccessResourcePacks(options = {}) {
  const appId = String(options.appId || DEFAULT_APP_ID).trim();
  const projectName = String(options.projectName || DEFAULT_ORDER_PROJECT_NAME).trim() || DEFAULT_ORDER_PROJECT_NAME;
  const resourceId = String(options.resourceId || DEFAULT_ORDER_RESOURCE_ID).trim() || DEFAULT_ORDER_RESOURCE_ID;
  const code = String(options.code || DEFAULT_ORDER_CODE).trim() || DEFAULT_ORDER_CODE;
  const times = normalizePositiveInteger(options.times, 1, 1);
  const quantity = normalizePositiveInteger(options.quantity, 1, 1);
  const autoUseCoupon = options.autoUseCoupon !== false;
  const couponId = String(options.couponId || '').trim();
  const tags = Array.isArray(options.tags) ? options.tags.filter((x) => x && typeof x === 'object') : [];

  if (!appId) throw new Error('missing appId');

  const body = {
    AppID: appId,
    ProjectName: projectName,
    ResourceID: resourceId,
    Code: code,
    Times: times,
    Quantity: quantity,
    AutoUseCoupon: autoUseCoupon
  };
  if (couponId) body.CouponID = couponId;
  if (tags.length > 0) body.Tags = tags;

  const data = await callSignedOpenApi({
    action: 'OrderAccessResourcePacks',
    version: '2025-05-21',
    body,
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    host: options.host,
    region: options.region,
    service: options.service,
    timeoutMs: options.timeoutMs
  });

  const orderIds = Array.isArray(data?.Result?.OrderIDs) ? data.Result.OrderIDs : [];
  const orderId = String(orderIds[0] || '').trim();
  if (!orderId) {
    throw new Error('doubao order succeeded but no order id returned');
  }

  return {
    orderId,
    appId,
    projectName,
    resourceId,
    code,
    times,
    quantity,
    raw: data
  };
}

async function listMegaTTSByOrderId(options = {}) {
  const appId = String(options.appId || DEFAULT_APP_ID).trim();
  const orderId = String(options.orderId || '').trim();
  if (!appId) throw new Error('missing appId');
  if (!orderId) throw new Error('missing orderId');

  const data = await callSignedOpenApi({
    action: 'ListMegaTTSByOrderID',
    version: '2023-11-07',
    body: {
      AppID: appId,
      OrderID: orderId
    },
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    host: options.host,
    region: options.region,
    service: options.service,
    timeoutMs: options.timeoutMs
  });

  const result = data?.Result || {};
  const statuses = Array.isArray(result.Statuses) ? result.Statuses : [];
  const speakerIds = statuses
    .map((item) => String(item?.SpeakerID || '').trim())
    .filter(Boolean);
  return {
    orderId,
    appId,
    isAllProcessed: result?.IsAllProcessed === true,
    orderBuyQuantity: Number(result?.OrderBuyQuantity || 0),
    successQuantity: Number(result?.OrderBuyCurrentSuccessQuantity || 0),
    failedQuantity: Number(result?.OrderBuyCurrentFailedQuantity || 0),
    statuses,
    speakerIds,
    raw: data
  };
}

async function pollOrderedSpeaker(options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 10);
  const intervalMs = Math.max(500, Number(options.intervalMs) || 2000);
  let last = null;
  let lastErr = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      last = await listMegaTTSByOrderId(options);
      if (Array.isArray(last?.speakerIds) && last.speakerIds.length > 0) {
        return {
          ...last,
          attempts: i + 1,
          ready: true,
          done: true
        };
      }
      if (last?.isAllProcessed) {
        return {
          ...last,
          attempts: i + 1,
          ready: false,
          done: true
        };
      }
    } catch (err) {
      lastErr = err;
    }
    if (i < maxAttempts - 1) {
      await sleep(intervalMs);
    }
  }
  if (!last && lastErr) throw lastErr;
  return {
    ...(last || {}),
    attempts: maxAttempts,
    ready: false,
    done: false
  };
}

async function createSpeakerByOrder(options = {}) {
  const order = await orderAccessResourcePacks({
    ...options,
    quantity: normalizePositiveInteger(options.quantity, 1, 1)
  });
  const status = await pollOrderedSpeaker({
    ...options,
    appId: order.appId,
    orderId: order.orderId,
    maxAttempts: options.pollMaxAttempts,
    intervalMs: options.pollIntervalMs
  });
  const speakerId = String(status?.speakerIds?.[0] || '').trim();
  if (!speakerId) {
    throw new Error(
      `speaker slot order not ready: orderId=${order.orderId}, processed=${status?.isAllProcessed === true}, success=${Number(status?.successQuantity || 0)}, failed=${Number(status?.failedQuantity || 0)}`
    );
  }
  return {
    orderId: order.orderId,
    speakerId,
    resourceId: String(status?.statuses?.[0]?.ResourceID || order.resourceId || '').trim(),
    order,
    status
  };
}

function buildV3Headers(appId, token, appKey = '', resourceId = '') {
  const normalizedAppKey = String(appKey || '').trim() || DEFAULT_APP_KEY;
  const headers = {
    'Content-Type': 'application/json',
    'X-Api-App-ID': appId,
    'X-Api-Access-Key': token,
    'X-Api-Request-Id': crypto.randomUUID()
  };
  if (normalizedAppKey) headers['X-Api-App-Key'] = normalizedAppKey;
  const normalizedResourceId = normalizeResourceId(resourceId);
  if (normalizedResourceId) headers['X-Api-Resource-Id'] = normalizedResourceId;
  return headers;
}

function parseV3BusinessError(data) {
  if (!data || typeof data !== 'object') return '';
  const code = Number(data.code);
  if (!Number.isFinite(code) || code === 0) return '';
  const message = String(data.message || '').trim();
  return message ? `code=${code}, message=${message}` : `code=${code}`;
}

function buildRetrySpeakerId(baseSpeakerId, attempt) {
  const rawBase = String(baseSpeakerId || 'speaker')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '') || 'speaker';
  const suffix = `retry${attempt}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const maxBase = Math.max(1, 128 - suffix.length - 1);
  return `${rawBase.slice(0, maxBase)}_${suffix}`.slice(0, 128);
}

function buildFreshSpeakerId(agentId = '') {
  const rawAgent = String(agentId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '') || 'agent';
  const suffix = `${Date.now().toString(36)}_${Math.floor(Math.random() * 1e8).toString(36)}`;
  const maxAgentLen = Math.max(1, 128 - 'S__'.length - suffix.length);
  return `S_${rawAgent.slice(0, maxAgentLen)}_${suffix}`.slice(0, 128);
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
  const appKey = String(options.appKey || DEFAULT_APP_KEY).trim();
  const inputResourceId = String(options.resourceId || '').trim();
  const language = Number.isFinite(Number(options.language)) ? Number(options.language) : DEFAULT_LANGUAGE;
  const audioBytes = String(options.audioBytes || '').trim();
  const audioFormat = normalizeAudioFormat(options.audioFormat || 'wav');
  const speakerId = normalizeSpeakerId(options.agentId, options.speakerId || '');

  if (!appId) throw new Error('missing appId');
  if (!token) throw new Error('missing token');
  if (!audioBytes) throw new Error('missing audio data');
  if (!speakerId) throw new Error('missing speakerId');

  const extraParamsRaw = options.extraParams || options.extra_params;
  const payloadBase = {
    audio: {
      data: audioBytes,
      format: audioFormat
    },
    language
  };
  // Keep compatibility with existing caller shape: optional extra params pass-through.
  if (extraParamsRaw && typeof extraParamsRaw === 'object' && !Array.isArray(extraParamsRaw)) {
    payloadBase.extra_params = extraParamsRaw;
  }

  const maxSpeakerRetry = Math.max(0, Number(options.maxSpeakerRetryAttempts) || 2);
  const resourceCandidates = buildResourceIdCandidates(inputResourceId);
  let currentSpeakerId = speakerId;
  let response;
  let lastErr = null;
  let usedResourceId = '';
  let nonRetryableErr = null;
  const triedResourceIds = new Set();
  for (let attempt = 0; attempt <= maxSpeakerRetry; attempt++) {
    const payload = {
      ...payloadBase,
      speaker_id: currentSpeakerId
    };
    let mismatchOnly = true;
    for (const resourceId of resourceCandidates) {
      const normalizedResourceId = normalizeResourceId(resourceId);
      if (normalizedResourceId) triedResourceIds.add(normalizedResourceId);
      try {
        response = await axios.post(
          `${API_BASE}/api/v3/tts/voice_clone`,
          payload,
          {
            headers: buildV3Headers(appId, token, appKey, normalizedResourceId),
            timeout: 30000
          }
        );
        usedResourceId = normalizedResourceId;
        break;
      } catch (err) {
        lastErr = err;
        const detail = summarizeRemoteError(err?.response?.data) || err?.message || '';
        if (isSpeakerResourceMismatchText(detail)) {
          continue;
        }
        mismatchOnly = false;
        nonRetryableErr = err;
        break;
      }
    }
    if (response || nonRetryableErr) {
      break;
    }
    if (mismatchOnly && attempt < maxSpeakerRetry) {
      currentSpeakerId = buildRetrySpeakerId(speakerId, attempt + 1);
      continue;
    }
    break;
  }
  if (!response) {
    const errForThrow = nonRetryableErr || lastErr || new Error('request failed');
    throw buildHttpError('doubao upload failed', errForThrow, {
      resourceCandidates: resourceCandidates.length > 0
        ? resourceCandidates
        : Array.from(triedResourceIds)
    });
  }

  const data = response?.data || {};
  const bizErr = parseV3BusinessError(data);
  if (bizErr) throw new Error(`doubao upload failed: ${bizErr}`);

  return {
    speakerId: String(data.speaker_id || currentSpeakerId),
    resourceIdUsed: usedResourceId,
    baseResp: {},
    raw: data
  };
}

async function queryO2oCloneStatus(options = {}) {
  const appId = String(options.appId || DEFAULT_APP_ID).trim();
  const token = String(options.token || DEFAULT_TOKEN).trim();
  const appKey = String(options.appKey || DEFAULT_APP_KEY).trim();
  const inputResourceId = String(options.resourceId || '').trim();
  const speakerId = String(options.speakerId || '').trim();

  if (!appId) throw new Error('missing appId');
  if (!token) throw new Error('missing token');
  if (!speakerId) throw new Error('missing speakerId');

  const resourceCandidates = buildResourceIdCandidates(inputResourceId);
  let response = null;
  let lastErr = null;
  let usedResourceId = '';
  for (const resourceId of resourceCandidates) {
    const normalizedResourceId = normalizeResourceId(resourceId);
    try {
      response = await axios.post(
        `${API_BASE}/api/v3/tts/get_voice`,
        { speaker_id: speakerId },
        {
          headers: buildV3Headers(appId, token, appKey, normalizedResourceId),
          timeout: 20000
        }
      );
      usedResourceId = normalizedResourceId;
      break;
    } catch (err) {
      lastErr = err;
      const detail = summarizeRemoteError(err?.response?.data) || err?.message || '';
      if (isSpeakerResourceMismatchText(detail)) {
        continue;
      }
      throw buildHttpError('doubao status failed', err, {
        resourceCandidates
      });
    }
  }
  if (!response) {
    throw buildHttpError('doubao status failed', lastErr || new Error('request failed'), {
      resourceCandidates
    });
  }

  const data = response?.data || {};
  const bizErr = parseV3BusinessError(data);
  if (bizErr) throw new Error(`doubao status failed: ${bizErr}`);

  const speakerStatus = Number(data.status);
  return {
    speakerId: String(data.speaker_id || speakerId),
    resourceIdUsed: usedResourceId,
    speakerStatus,
    speakerStatusLabel: mapSpeakerStatus(speakerStatus),
    baseResp: {},
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
  callSignedOpenApi,
  orderAccessResourcePacks,
  listMegaTTSByOrderId,
  pollOrderedSpeaker,
  createSpeakerByOrder,
  submitO2oClone,
  queryO2oCloneStatus,
  pollO2oReady,
  mapSpeakerStatus,
  normalizeAudioFormat,
  buildFreshSpeakerId
};
