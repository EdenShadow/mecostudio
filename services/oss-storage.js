const OSS = require('ali-oss');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DEFAULT_MULTIPART_PART_SIZE = 16 * 1024 * 1024; // 16MB
const MIN_MULTIPART_PART_SIZE = 100 * 1024; // 100KB (OSS minimum, except last part)
const MAX_MULTIPART_PART_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_MULTIPART_PARTS = 10000;

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

function encodeObjectKeyForUrl(objectKey) {
  return String(objectKey || '')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function buildSignedUrlV1(cfg, options = {}) {
  const method = toSafeString(options.method || 'GET').toUpperCase();
  const objectKey = normalizeObjectPath(options.objectKey);
  if (!objectKey) {
    throw new Error('objectKey is required');
  }
  const expiresIn = Number.isFinite(Number(options.expires))
    ? Math.max(60, Math.min(86400, Number(options.expires)))
    : 600;
  const expires = Math.floor(Date.now() / 1000) + expiresIn;
  const contentType = toSafeString(options.contentType);
  const params = options.params && typeof options.params === 'object' ? { ...options.params } : {};
  const canonicalizedResource = `/${cfg.bucket}/${objectKey}`;
  const stringToSign = `${method}\n\n${contentType}\n${expires}\n${canonicalizedResource}`;
  const signature = crypto
    .createHmac('sha1', cfg.accessKeySecret)
    .update(stringToSign)
    .digest('base64');

  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === null || v === undefined) return;
    query.set(k, String(v));
  });
  query.set('OSSAccessKeyId', cfg.accessKeyId);
  query.set('Expires', String(expires));
  query.set('Signature', signature);

  const objectUrl = `${cfg.publicBaseUrl}/${encodeObjectKeyForUrl(objectKey)}`;
  return {
    signedUrl: `${objectUrl}?${query.toString()}`,
    expires
  };
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

  // For Aliyun OSS bucket-domain endpoints like:
  //   https://<bucket>.oss-<region>.aliyuncs.com
  // use regional endpoint + bucket (no cname) to keep signature stable.
  const endpointForClient = endpointInfo.endpointRoot;
  const cname = false;
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

function clampPartSize(fileSize, partSizeInput) {
  let partSize = Number.isFinite(Number(partSizeInput))
    ? Number(partSizeInput)
    : DEFAULT_MULTIPART_PART_SIZE;
  partSize = Math.max(MIN_MULTIPART_PART_SIZE, Math.min(MAX_MULTIPART_PART_SIZE, partSize));
  if (fileSize > 0) {
    const minRequired = Math.ceil(fileSize / MAX_MULTIPART_PARTS);
    if (minRequired > partSize) {
      partSize = Math.max(minRequired, MIN_MULTIPART_PART_SIZE);
    }
  }
  return Math.floor(partSize);
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

function signPutObjectUrl(settings, options = {}) {
  const objectKey = normalizeObjectPath(options.objectKey);
  if (!objectKey) {
    throw new Error('objectKey is required');
  }
  const expires = Number.isFinite(Number(options.expires))
    ? Math.max(60, Math.min(86400, Number(options.expires)))
    : 600;
  const contentType = toSafeString(options.contentType);
  const signOpts = { expires, method: 'PUT' };
  const { cfg } = createClient(settings);
  const signed = buildSignedUrlV1(cfg, {
    method: 'PUT',
    objectKey,
    expires: signOpts.expires,
    contentType
  });
  const uploadUrl = signed.signedUrl;
  const fileUrl = `${cfg.publicBaseUrl}/${objectKey}`;
  return {
    objectKey,
    expires,
    uploadUrl,
    fileUrl,
    bucket: cfg.bucket,
    endpoint: cfg.endpoint
  };
}

async function initMultipartUpload(settings, options = {}) {
  const fileSize = Number(options.fileSize);
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new Error('fileSize must be a positive number');
  }
  const objectKey = buildObjectKey({
    originalName: options.originalName || 'video.mp4',
    objectKey: options.objectKey || '',
    prefix: options.prefix || 'videos'
  });
  const contentType = toSafeString(options.contentType) || 'application/octet-stream';
  const expires = Number.isFinite(Number(options.expires))
    ? Math.max(300, Math.min(86400, Number(options.expires)))
    : 1800;

  const { client, cfg } = createClient(settings);
  const initOptions = contentType ? { headers: { 'Content-Type': contentType } } : undefined;
  const initResult = await client.initMultipartUpload(objectKey, initOptions);
  const uploadId = toSafeString(initResult?.uploadId || initResult?.upload_id);
  if (!uploadId) {
    throw new Error('failed to init multipart upload (missing uploadId)');
  }

  const partSize = clampPartSize(fileSize, options.partSize);
  const totalParts = Math.ceil(fileSize / partSize);
  const parts = [];
  for (let i = 1; i <= totalParts; i += 1) {
    const offset = (i - 1) * partSize;
    const size = Math.min(partSize, fileSize - offset);
    const signed = buildSignedUrlV1(cfg, {
      method: 'PUT',
      expires,
      objectKey,
      params: {
        partNumber: String(i),
        uploadId
      }
    });
    const uploadUrl = signed.signedUrl;
    parts.push({
      partNumber: i,
      offset,
      size,
      uploadUrl
    });
  }

  return {
    uploadId,
    objectKey,
    fileUrl: `${cfg.publicBaseUrl}/${objectKey}`,
    partSize,
    totalParts,
    parts,
    bucket: cfg.bucket,
    endpoint: cfg.endpoint
  };
}

async function completeMultipartUpload(settings, options = {}) {
  const objectKey = normalizeObjectPath(options.objectKey);
  const uploadId = toSafeString(options.uploadId);
  const rawParts = Array.isArray(options.parts) ? options.parts : [];
  if (!objectKey) {
    throw new Error('objectKey is required');
  }
  if (!uploadId) {
    throw new Error('uploadId is required');
  }
  if (rawParts.length === 0) {
    throw new Error('parts is required');
  }

  const parts = rawParts
    .map((part) => {
      const number = Number(part?.partNumber ?? part?.part_number ?? part?.number);
      const etag = toSafeString(part?.etag);
      if (!Number.isInteger(number) || number <= 0 || !etag) return null;
      return { number, etag };
    })
    .filter(Boolean)
    .sort((a, b) => a.number - b.number);

  if (parts.length === 0) {
    throw new Error('no valid parts');
  }

  const { client, cfg } = createClient(settings);
  const result = await client.completeMultipartUpload(objectKey, uploadId, parts);
  return {
    objectKey,
    uploadId,
    fileUrl: `${cfg.publicBaseUrl}/${objectKey}`,
    etag: toSafeString(result?.etag),
    bucket: cfg.bucket,
    endpoint: cfg.endpoint
  };
}

async function resumeMultipartUpload(settings, options = {}) {
  const objectKey = normalizeObjectPath(options.objectKey);
  const uploadId = toSafeString(options.uploadId);
  const fileSize = Number(options.fileSize);
  if (!objectKey) {
    throw new Error('objectKey is required');
  }
  if (!uploadId) {
    throw new Error('uploadId is required');
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new Error('fileSize must be a positive number');
  }

  const partSize = clampPartSize(fileSize, options.partSize);
  const totalParts = Math.ceil(fileSize / partSize);
  const expires = Number.isFinite(Number(options.expires))
    ? Math.max(300, Math.min(86400, Number(options.expires)))
    : 1800;

  const { client, cfg } = createClient(settings);
  const listResult = await client.listParts(objectKey, uploadId);
  const uploadedPartsRaw = Array.isArray(listResult?.parts) ? listResult.parts : [];
  const uploadedMap = new Map();
  uploadedPartsRaw.forEach((part) => {
    const number = Number(part?.number ?? part?.partNumber ?? part?.part_number);
    const etag = toSafeString(part?.etag);
    if (Number.isInteger(number) && number > 0 && etag) {
      uploadedMap.set(number, etag);
    }
  });

  const completedParts = Array.from(uploadedMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([partNumber, etag]) => ({ partNumber, etag }));

  const remainingParts = [];
  for (let i = 1; i <= totalParts; i += 1) {
    if (uploadedMap.has(i)) continue;
    const offset = (i - 1) * partSize;
    const size = Math.min(partSize, fileSize - offset);
    const signed = buildSignedUrlV1(cfg, {
      method: 'PUT',
      expires,
      objectKey,
      params: {
        partNumber: String(i),
        uploadId
      }
    });
    const uploadUrl = signed.signedUrl;
    remainingParts.push({
      partNumber: i,
      offset,
      size,
      uploadUrl
    });
  }

  return {
    uploadId,
    objectKey,
    fileUrl: `${cfg.publicBaseUrl}/${objectKey}`,
    partSize,
    totalParts,
    completedParts,
    remainingParts,
    bucket: cfg.bucket,
    endpoint: cfg.endpoint
  };
}

module.exports = {
  resolveOssConfig,
  buildObjectKey,
  uploadLocalFile,
  downloadObjectToLocal,
  signObjectUrl,
  signPutObjectUrl,
  initMultipartUpload,
  completeMultipartUpload,
  resumeMultipartUpload
};
