const OSS = require('ali-oss');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function toSafeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeEndpointUrl(rawEndpoint) {
  const raw = toSafeString(rawEndpoint);
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed = null;
  try {
    parsed = new URL(withProtocol);
  } catch (_) {
    return null;
  }
  const host = toSafeString(parsed.hostname).toLowerCase();
  if (!host) return null;
  const protocol = parsed.protocol === 'http:' ? 'http:' : 'https:';
  return {
    raw,
    host,
    protocol,
    url: `${protocol}//${host}`
  };
}

function parseEndpointInfo(endpointUrl) {
  const normalized = normalizeEndpointUrl(endpointUrl);
  if (!normalized) return null;

  const host = normalized.host;
  let bucketFromHost = '';
  let endpointRoot = host;

  const bucketHostMatch = host.match(/^([^.]+)\.(oss-[^.]+\.aliyuncs\.com)$/i);
  if (bucketHostMatch) {
    bucketFromHost = bucketHostMatch[1];
    endpointRoot = bucketHostMatch[2];
  }

  const rootMatch = endpointRoot.match(/^(oss-[^.]+)\.aliyuncs\.com$/i);
  const region = rootMatch ? rootMatch[1] : '';

  return {
    host,
    endpointRoot,
    bucketFromHost,
    region,
    protocol: normalized.protocol,
    normalizedBaseUrl: normalized.url
  };
}

function sanitizeObjectSegment(segment) {
  const s = toSafeString(segment)
    .replace(/\\/g, '/')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!s) return '';
  return s;
}

function normalizeObjectPath(inputPath) {
  const raw = toSafeString(inputPath).replace(/\\/g, '/');
  if (!raw) return '';
  const parts = raw
    .split('/')
    .map((p) => sanitizeObjectSegment(p))
    .filter((p) => p && p !== '.' && p !== '..');
  return parts.join('/');
}

function ensureUniqueLocalPath(targetPath) {
  const preferred = path.resolve(String(targetPath || '').trim());
  if (!preferred) return preferred;
  if (!fs.existsSync(preferred)) return preferred;
  const dir = path.dirname(preferred);
  const ext = path.extname(preferred);
  const base = path.basename(preferred, ext);
  for (let i = 2; i < 10000; i += 1) {
    const candidate = path.join(dir, `${base}_${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base}_${Date.now()}${ext}`);
}

function resolveOssConfig(settings = {}) {
  const endpointRaw = toSafeString(settings.ossEndpoint);
  const endpointInfo = parseEndpointInfo(endpointRaw);
  if (!endpointInfo) {
    return {
      ready: false,
      error: 'invalid ossEndpoint',
      endpoint: endpointRaw
    };
  }

  const bucket = toSafeString(settings.ossBucket) || endpointInfo.bucketFromHost;
  const accessKeyId = toSafeString(settings.ossAccessKeyId);
  const accessKeySecret = toSafeString(settings.ossAccessKeySecret);
  const region = endpointInfo.region;

  if (!bucket) {
    return {
      ready: false,
      error: 'missing ossBucket',
      endpoint: endpointInfo.normalizedBaseUrl
    };
  }

  const endpointForClient = endpointInfo.bucketFromHost
    ? endpointInfo.host
    : endpointInfo.endpointRoot;
  const cname = !!endpointInfo.bucketFromHost;
  const publicBaseUrl = endpointInfo.bucketFromHost
    ? `${endpointInfo.protocol}//${endpointInfo.host}`
    : `${endpointInfo.protocol}//${bucket}.${endpointInfo.endpointRoot}`;

  return {
    ready: !!(accessKeyId && accessKeySecret && endpointForClient && bucket && region),
    endpoint: endpointInfo.normalizedBaseUrl,
    endpointForClient,
    publicBaseUrl,
    region,
    bucket,
    cname,
    accessKeyId,
    accessKeySecret
  };
}

function createClient(settings = {}) {
  const cfg = resolveOssConfig(settings);
  if (!cfg.ready) {
    throw new Error(`OSS config not ready: ${cfg.error || 'missing credentials'}`);
  }

  const client = new OSS({
    region: cfg.region,
    bucket: cfg.bucket,
    endpoint: cfg.endpointForClient,
    cname: cfg.cname,
    secure: true,
    accessKeyId: cfg.accessKeyId,
    accessKeySecret: cfg.accessKeySecret
  });
  return { client, cfg };
}

function buildObjectKey({ originalName = '', objectKey = '', prefix = '' } = {}) {
  const normalizedObjectKey = normalizeObjectPath(objectKey);
  if (normalizedObjectKey) return normalizedObjectKey;

  const normalizedPrefix = normalizeObjectPath(prefix);
  const sourceName = toSafeString(originalName) || 'file.bin';
  const ext = path.extname(sourceName);
  const safeExt = ext && ext !== '.' ? ext : '';
  const base = path.basename(sourceName, safeExt) || 'file';
  const dataKey = `${base}${Date.now()}`;
  const digest = crypto.createHash('md5').update(dataKey).digest('hex');
  const generated = `${digest}${safeExt}`;
  return normalizedPrefix ? `${normalizedPrefix}/${generated}` : generated;
}

async function uploadLocalFile(settings, options = {}) {
  const localPath = path.resolve(String(options.localPath || '').trim());
  if (!localPath || !fs.existsSync(localPath)) {
    throw new Error('local file not found');
  }
  const stat = fs.statSync(localPath);
  if (!stat.isFile()) {
    throw new Error('localPath must be a file');
  }

  const originalName = toSafeString(options.originalName) || path.basename(localPath);
  const objectKey = buildObjectKey({
    originalName,
    objectKey: options.objectKey,
    prefix: options.prefix
  });

  const { client, cfg } = createClient(settings);
  const putOptions = {};
  const contentType = toSafeString(options.contentType);
  if (contentType) {
    putOptions.headers = {
      'Content-Type': contentType
    };
  }

  const result = await client.put(objectKey, localPath, putOptions);
  const url = `${cfg.publicBaseUrl}/${objectKey}`;
  return {
    objectKey,
    url,
    bucket: cfg.bucket,
    endpoint: cfg.endpoint,
    etag: result && result.etag ? result.etag : '',
    requestId: result && result.res && result.res.requestUrls ? result.res.requestUrls[0] : ''
  };
}

async function downloadObjectToLocal(settings, options = {}) {
  const objectKey = normalizeObjectPath(options.objectKey);
  if (!objectKey) {
    throw new Error('objectKey is required');
  }

  const { client, cfg } = createClient(settings);
  const targetPathInput = toSafeString(options.targetPath);
  const defaultDir = path.resolve(String(options.defaultDir || process.cwd()));
  const fallbackName = path.basename(objectKey) || `oss_${Date.now()}`;
  let targetPath = targetPathInput
    ? path.resolve(targetPathInput)
    : path.join(defaultDir, fallbackName);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (!options.overwrite) {
    targetPath = ensureUniqueLocalPath(targetPath);
  }

  await client.get(objectKey, targetPath);
  return {
    objectKey,
    localPath: targetPath,
    url: `${cfg.publicBaseUrl}/${objectKey}`,
    bucket: cfg.bucket,
    endpoint: cfg.endpoint
  };
}

function signObjectUrl(settings, options = {}) {
  const objectKey = normalizeObjectPath(options.objectKey);
  if (!objectKey) {
    throw new Error('objectKey is required');
  }
  const expires = Number.isFinite(Number(options.expires))
    ? Math.max(60, Math.min(86400, Number(options.expires)))
    : 3600;

  const { client } = createClient(settings);
  const signedUrl = client.signatureUrl(objectKey, { expires, method: 'GET' });
  return {
    objectKey,
    expires,
    signedUrl
  };
}

module.exports = {
  resolveOssConfig,
  buildObjectKey,
  uploadLocalFile,
  downloadObjectToLocal,
  signObjectUrl
};

