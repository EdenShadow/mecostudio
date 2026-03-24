const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const STORE_DIR = path.join(os.homedir(), '.meco-studio');
const STORE_PATH = process.env.MECO_REMOTE_STORE_PATH
  ? path.resolve(String(process.env.MECO_REMOTE_STORE_PATH))
  : path.join(STORE_DIR, 'remote-devices.json');
const STORE_VERSION = 1;
const CONTROL_CODE_PREFIX = 'MRC1';
const REMOTE_PUBLIC_PATH_SEGMENT = 'web';
const REMOTE_RUSTDESK_PATH_SEGMENT = 'rustdesk';

function toSafeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toSlug(value, fallback = 'device') {
  const normalized = toSafeString(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || fallback;
}

function trimTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function trimSlashes(value) {
  return toSafeString(value).replace(/^\/+|\/+$/g, '');
}

function joinPathSegments(...segments) {
  const clean = [];
  for (const seg of segments) {
    const part = trimSlashes(seg);
    if (part) clean.push(part);
  }
  return `/${clean.join('/')}`;
}

function normalizeHttpUrl(raw, options = {}) {
  const value = toSafeString(raw);
  if (!value) return '';

  let candidate = value;
  if (!/^https?:\/\//i.test(candidate)) {
    const fallbackProtocol = options.defaultProtocol || 'https://';
    candidate = `${fallbackProtocol}${candidate}`;
  }

  try {
    const u = new URL(candidate);
    if (!/^https?:$/i.test(u.protocol)) return '';
    u.hash = '';
    const pathname = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host}${pathname}${u.search}`;
  } catch (_) {
    return '';
  }
}

function normalizeLaunchUrl(raw) {
  const value = toSafeString(raw);
  if (!value) return '';
  if (/^rustdesk:\/\//i.test(value)) return value;
  return normalizeHttpUrl(value, { defaultProtocol: 'https://' }) || '';
}

function normalizeHostBase(raw) {
  const normalized = normalizeHttpUrl(raw, { defaultProtocol: 'https://' });
  return trimTrailingSlash(normalized);
}

function parseHttpUrl(raw) {
  const normalized = normalizeHttpUrl(raw, { defaultProtocol: 'https://' });
  if (!normalized) return null;
  try {
    return new URL(normalized);
  } catch (_) {
    return null;
  }
}

function hasGotoNodeParam(rawUrl) {
  const parsed = parseHttpUrl(rawUrl);
  if (!parsed) return false;
  return !!toSafeString(parsed.searchParams.get('gotonode'));
}

function isMeshDesktopFallbackUrl(rawUrl) {
  const parsed = parseHttpUrl(rawUrl);
  if (!parsed) return false;
  return parsed.searchParams.get('mecoControl') === '1';
}

function isLikelyMeshNodeId(value) {
  const nodeId = toSafeString(value);
  if (!nodeId) return false;
  if (!/^node\//i.test(nodeId)) return false;
  // Default domain uses `node//<id>`, explicit domain uses `node/<domain>/<id>`.
  return nodeId.split('/').filter(Boolean).length >= 2;
}

function isLikelyRustDeskId(value) {
  const id = toSafeString(value);
  if (!id) return false;
  if (isLikelyMeshNodeId(id)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]{4,}$/.test(id);
}

function safeJsonParse(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function ensureStoreDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      return { version: STORE_VERSION, devices: [] };
    }
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = safeJsonParse(raw);
    if (!parsed) return { version: STORE_VERSION, devices: [] };
    const devices = Array.isArray(parsed.devices) ? parsed.devices : [];
    return {
      version: Number(parsed.version) || STORE_VERSION,
      devices: devices.filter((d) => d && typeof d === 'object')
    };
  } catch (_) {
    return { version: STORE_VERSION, devices: [] };
  }
}

function writeStore(store) {
  const snapshot = {
    version: STORE_VERSION,
    devices: Array.isArray(store.devices) ? store.devices : []
  };
  ensureStoreDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  return snapshot;
}

function createError(message, status = 400, code = 'bad_request') {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function buildRemotePathPrefixSegments(settings = {}, leafSegment = REMOTE_PUBLIC_PATH_SEGMENT) {
  const configured = trimSlashes(settings && settings.cloudflarePathPrefix);
  const segments = configured ? configured.split('/').filter(Boolean) : [];
  const last = segments.length ? segments[segments.length - 1] : '';
  const target = toSafeString(leafSegment || REMOTE_PUBLIC_PATH_SEGMENT) || REMOTE_PUBLIC_PATH_SEGMENT;
  if (last !== target) {
    segments.push(target);
  }
  return segments;
}

function computePath(ownerSlug, deviceSlug, settings = {}) {
  const prefixSegments = buildRemotePathPrefixSegments(settings, REMOTE_PUBLIC_PATH_SEGMENT);
  return joinPathSegments(...prefixSegments, ownerSlug, deviceSlug);
}

function computeRustDeskPath(ownerSlug, deviceSlug, settings = {}) {
  const prefixSegments = buildRemotePathPrefixSegments(settings, REMOTE_RUSTDESK_PATH_SEGMENT);
  return joinPathSegments(...prefixSegments, ownerSlug, deviceSlug);
}

function derivePublicUrlFromSettings(ownerSlug, deviceSlug, settings = {}) {
  const host = normalizeHostBase(settings && settings.cloudflarePublicHost);
  if (!host) return '';
  return `${host}${computePath(ownerSlug, deviceSlug, settings)}`;
}

function deriveMeshUrlFromSettings(ownerSlug, deviceSlug, settings = {}) {
  const host = normalizeHostBase(settings && settings.cloudflarePublicHost);
  if (!host) return '';
  return `${host}${computeRustDeskPath(ownerSlug, deviceSlug, settings)}`;
}

function normalizeDevicePayload(input = {}, settings = {}, existing = null) {
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

  const owner = toSafeString(
    input.owner || input.username || input.user || (existing ? existing.owner : '')
  );
  const deviceName = toSafeString(
    input.deviceName || input.device || input.name || (existing ? existing.deviceName : '')
  );
  if (!owner) throw createError('owner is required', 400, 'owner_required');
  if (!deviceName) throw createError('deviceName is required', 400, 'device_name_required');

  const ownerSlug = toSlug(owner, 'user');
  const deviceSlug = toSlug(deviceName, 'dev');

  const hasPublicUrl = hasOwn(input, 'publicUrl') || hasOwn(input, 'domainUrl');
  const rawPublicUrl = hasOwn(input, 'publicUrl')
    ? input.publicUrl
    : (hasOwn(input, 'domainUrl') ? input.domainUrl : (existing ? existing.publicUrl : ''));
  const normalizedPublicUrl = normalizeHttpUrl(rawPublicUrl || '', { defaultProtocol: 'https://' });
  const publicUrl = hasPublicUrl
    ? normalizedPublicUrl
    : (normalizedPublicUrl || (existing && existing.publicUrl) || derivePublicUrlFromSettings(ownerSlug, deviceSlug, settings));

  const hasLanUrl = hasOwn(input, 'lanUrl') || hasOwn(input, 'localUrl');
  const rawLanUrl = hasOwn(input, 'lanUrl')
    ? input.lanUrl
    : (hasOwn(input, 'localUrl') ? input.localUrl : (existing ? existing.lanUrl : ''));
  const lanUrl = hasLanUrl
    ? (normalizeHttpUrl(rawLanUrl || '', { defaultProtocol: 'http://' }) || '')
    : (normalizeHttpUrl(rawLanUrl || '', { defaultProtocol: 'http://' }) || '');

  const hasRustDeskLaunchUrl = hasOwn(input, 'rustdeskLaunchUrl') || hasOwn(input, 'meshLaunchUrl');
  const rawRustDeskLaunchUrl = hasOwn(input, 'rustdeskLaunchUrl')
    ? input.rustdeskLaunchUrl
    : (hasOwn(input, 'meshLaunchUrl') ? input.meshLaunchUrl : (existing ? (existing.rustdeskLaunchUrl || existing.meshLaunchUrl) : ''));
  const rustdeskLaunchUrl = hasRustDeskLaunchUrl
    ? (normalizeLaunchUrl(rawRustDeskLaunchUrl || '') || '')
    : (normalizeLaunchUrl(rawRustDeskLaunchUrl || '') || '');

  const hasRustDeskId = hasOwn(input, 'rustdeskId') || hasOwn(input, 'meshNodeId');
  const rustdeskId = toSafeString(
    hasOwn(input, 'rustdeskId')
      ? input.rustdeskId
      : (hasOwn(input, 'meshNodeId') ? input.meshNodeId : (existing ? (existing.rustdeskId || existing.meshNodeId) : ''))
  );

  const password = toSafeString(
    hasOwn(input, 'rustdeskPassword')
      ? input.rustdeskPassword
      : (
        hasOwn(input, 'password')
          ? input.password
          : (hasOwn(input, 'accessPassword') ? input.accessPassword : (existing ? existing.password : ''))
      )
  );

  return {
    owner,
    ownerSlug,
    deviceName,
    deviceSlug,
    routePath: computePath(ownerSlug, deviceSlug, settings),
    note: toSafeString(
      hasOwn(input, 'note')
        ? input.note
        : (hasOwn(input, 'remark') ? input.remark : (existing ? existing.note : ''))
    ),
    lanUrl,
    publicUrl,
    meshNodeId: hasRustDeskId ? rustdeskId : toSafeString(existing ? existing.meshNodeId : ''),
    meshDomain: toSafeString(
      hasOwn(input, 'meshDomain')
        ? input.meshDomain
        : (existing ? existing.meshDomain : '')
    ),
    meshLaunchUrl: rustdeskLaunchUrl,
    rustdeskId,
    rustdeskLaunchUrl,
    password,
    meta: {
      importedFromCode: !!(input && input.importedFromCode)
    }
  };
}

function buildMeshLaunchUrl(device, settings = {}) {
  if (!device) return '';
  const explicitMeshUrl = toSafeString(device.rustdeskLaunchUrl || device.meshLaunchUrl || '');
  if (explicitMeshUrl && hasGotoNodeParam(explicitMeshUrl)) {
    return explicitMeshUrl;
  }

  // Keep user-provided explicit URL unless it's known fallback marker.
  if (explicitMeshUrl && !isMeshDesktopFallbackUrl(explicitMeshUrl)) {
    return explicitMeshUrl;
  }

  const rawRustDeskId = toSafeString(device.rustdeskId || device.meshNodeId || '');
  if (isLikelyRustDeskId(rawRustDeskId)) {
    const authority = toSafeString(settings.rustdeskSchemeAuthority || 'connect') || 'connect';
    const params = new URLSearchParams();
    const password = toSafeString(device.password || '');
    if (password) {
      params.set('password', password);
    }
    const query = params.toString();
    const encodedId = encodeURIComponent(rawRustDeskId);
    return `rustdesk://${authority}/${encodedId}${query ? `?${query}` : ''}`;
  }

  return '';
}

function toPublicDeviceView(device, settings = {}, options = {}) {
  const includeSensitive = !!(options && options.includeSensitive);
  const canonicalRoutePath = computePath(device.ownerSlug, device.deviceSlug, settings);
  const derivedPublicUrl = derivePublicUrlFromSettings(device.ownerSlug, device.deviceSlug, settings);
  const resolvedMeshLaunchUrl = buildMeshLaunchUrl(device, settings);
  const meshDesktopReady = !!toSafeString(resolvedMeshLaunchUrl);
  const rustdeskId = toSafeString(device.rustdeskId || device.meshNodeId);

  const view = {
    id: toSafeString(device.id),
    owner: toSafeString(device.owner),
    ownerSlug: toSafeString(device.ownerSlug),
    deviceName: toSafeString(device.deviceName),
    deviceSlug: toSafeString(device.deviceSlug),
    routePath: canonicalRoutePath,
    note: toSafeString(device.note),
    lanUrl: toSafeString(device.lanUrl),
    publicUrl: toSafeString(derivedPublicUrl || device.publicUrl),
    meshNodeId: rustdeskId,
    meshDomain: toSafeString(device.meshDomain),
    meshLaunchUrl: resolvedMeshLaunchUrl,
    meshDesktopReady: !!meshDesktopReady,
    rustdeskId,
    rustdeskLaunchUrl: resolvedMeshLaunchUrl,
    rustdeskReady: !!meshDesktopReady,
    hasPassword: !!toSafeString(device.password),
    passwordMasked: toSafeString(device.password) ? '******' : '',
    importedFromCode: !!(device.meta && device.meta.importedFromCode),
    createdAt: toSafeString(device.createdAt),
    updatedAt: toSafeString(device.updatedAt)
  };

  if (includeSensitive) {
    view.password = toSafeString(device.password);
  }

  return view;
}

function assertUniqueRoute(store, ownerSlug, deviceSlug, excludeId = '') {
  const key = `${ownerSlug}/${deviceSlug}`;
  for (const dev of store.devices) {
    if (!dev) continue;
    if (excludeId && String(dev.id) === String(excludeId)) continue;
    const routeKey = `${toSafeString(dev.ownerSlug)}/${toSafeString(dev.deviceSlug)}`;
    if (routeKey && routeKey === key) {
      throw createError('owner + deviceName already exists, please use another one', 409, 'duplicate_route');
    }
  }
}

function createDevice(input = {}, settings = {}) {
  const store = readStore();
  const payload = normalizeDevicePayload(input, settings, null);
  assertUniqueRoute(store, payload.ownerSlug, payload.deviceSlug, '');

  const now = new Date().toISOString();
  const device = {
    id: crypto.randomBytes(8).toString('hex'),
    ...payload,
    createdAt: now,
    updatedAt: now
  };

  store.devices.push(device);
  writeStore(store);
  return toPublicDeviceView(device, settings);
}

function updateDevice(id, input = {}, settings = {}) {
  const targetId = toSafeString(id);
  if (!targetId) throw createError('device id is required', 400, 'device_id_required');

  const store = readStore();
  const idx = store.devices.findIndex((d) => toSafeString(d.id) === targetId);
  if (idx < 0) throw createError('device not found', 404, 'device_not_found');

  const existing = store.devices[idx];
  const payload = normalizeDevicePayload(input, settings, existing);
  assertUniqueRoute(store, payload.ownerSlug, payload.deviceSlug, targetId);

  const merged = {
    ...existing,
    ...payload,
    id: existing.id,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    meta: {
      ...(existing.meta && typeof existing.meta === 'object' ? existing.meta : {}),
      ...(payload.meta && typeof payload.meta === 'object' ? payload.meta : {})
    }
  };

  store.devices[idx] = merged;
  writeStore(store);
  return toPublicDeviceView(merged, settings);
}

function deleteDevice(id) {
  const targetId = toSafeString(id);
  if (!targetId) throw createError('device id is required', 400, 'device_id_required');

  const store = readStore();
  const before = store.devices.length;
  store.devices = store.devices.filter((d) => toSafeString(d.id) !== targetId);
  if (store.devices.length === before) {
    throw createError('device not found', 404, 'device_not_found');
  }
  writeStore(store);
  return true;
}

function getDeviceById(id, settings = {}, options = {}) {
  const targetId = toSafeString(id);
  const store = readStore();
  const device = store.devices.find((d) => toSafeString(d.id) === targetId);
  if (!device) throw createError('device not found', 404, 'device_not_found');
  return toPublicDeviceView(device, settings, options);
}

function listDevices(settings = {}) {
  const store = readStore();
  const sorted = [...store.devices].sort((a, b) => {
    const ta = Date.parse(a && a.updatedAt ? a.updatedAt : 0) || 0;
    const tb = Date.parse(b && b.updatedAt ? b.updatedAt : 0) || 0;
    return tb - ta;
  });
  return sorted.map((d) => toPublicDeviceView(d, settings));
}

function encodeControlCodePayload(payload) {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, 'utf8').toString('base64url');
  const checksum = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
  return `${CONTROL_CODE_PREFIX}.${encoded}.${checksum}`;
}

function decodeControlCodePayload(code) {
  const raw = toSafeString(code);
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== CONTROL_CODE_PREFIX) {
    throw createError('invalid control code format', 400, 'invalid_control_code');
  }

  const encoded = parts[1];
  const checksum = parts[2];
  let json = '';
  try {
    json = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch (_) {
    throw createError('invalid control code payload', 400, 'invalid_control_code');
  }

  const expected = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
  if (expected !== checksum) {
    throw createError('control code checksum mismatch', 400, 'invalid_control_code');
  }

  const payload = safeJsonParse(json);
  if (!payload) {
    throw createError('invalid control code payload', 400, 'invalid_control_code');
  }
  return payload;
}

function generateControlCode(id, settings = {}) {
  const device = getDeviceById(id, settings, { includeSensitive: true });
  const payload = {
    v: 1,
    owner: device.owner,
    deviceName: device.deviceName,
    note: device.note,
    lanUrl: device.lanUrl,
    publicUrl: device.publicUrl,
    meshNodeId: device.meshNodeId,
    meshDomain: device.meshDomain,
    meshLaunchUrl: device.meshLaunchUrl,
    rustdeskId: device.rustdeskId || device.meshNodeId,
    rustdeskLaunchUrl: device.rustdeskLaunchUrl || device.meshLaunchUrl,
    rustdeskPassword: device.password,
    rustdeskOneTimePassword: device.password,
    rustdeskRememberPassword: !!toSafeString(device.password),
    password: device.password,
    routePath: device.routePath,
    createdAt: new Date().toISOString()
  };

  return {
    code: encodeControlCodePayload(payload),
    payload
  };
}

function importControlCode(code, settings = {}) {
  const payload = decodeControlCodePayload(code);
  const candidate = {
    owner: payload.owner,
    deviceName: payload.deviceName,
    note: payload.note,
    lanUrl: payload.lanUrl,
    publicUrl: payload.publicUrl,
    meshNodeId: payload.rustdeskId || payload.meshNodeId,
    meshDomain: payload.meshDomain,
    meshLaunchUrl: payload.rustdeskLaunchUrl || payload.meshLaunchUrl,
    password: payload.rustdeskPassword || payload.rustdeskOneTimePassword || payload.password,
    importedFromCode: true
  };
  return createDevice(candidate, settings);
}

function resolveLaunch(id, options = {}, settings = {}) {
  const store = readStore();
  const targetId = toSafeString(id);
  const found = store.devices.find((d) => toSafeString(d.id) === targetId);
  if (!found) throw createError('device not found', 404, 'device_not_found');

  const device = toPublicDeviceView(found, settings, { includeSensitive: true });
  const forceModeRaw = toSafeString(options.forceMode || '').toLowerCase();
  const forceMode = forceModeRaw === 'mesh' ? 'rustdesk' : forceModeRaw;
  const preferLan = options.preferLan !== false;
  const lanReachable = !!options.lanReachable;

  const lanUrl = toSafeString(device.lanUrl);
  const publicUrl = toSafeString(device.publicUrl);
  const meshUrl = toSafeString(device.rustdeskLaunchUrl || device.meshLaunchUrl);
  const meshReady = !!meshUrl;

  const candidates = {
    lan: lanUrl,
    rustdesk: meshReady ? meshUrl : '',
    mesh: meshReady ? meshUrl : '',
    public: publicUrl
  };
  const resolvedMeshUrl = candidates.rustdesk;

  if (forceMode) {
    const forced = candidates[forceMode] || '';
    if (!forced) {
      throw createError(`requested mode unavailable: ${forceMode}`, 400, 'launch_mode_unavailable');
    }
    return {
      mode: forceMode,
      url: forced,
      fallbackUrl: forceMode === 'lan' ? (publicUrl || meshUrl || '') : (lanUrl || publicUrl || meshUrl || ''),
      lanReachable,
      device
    };
  }

  if (preferLan && lanReachable && lanUrl) {
    return {
      mode: 'lan',
      url: lanUrl,
      fallbackUrl: publicUrl || meshUrl || '',
      lanReachable,
      device
    };
  }

  if (resolvedMeshUrl) {
    return {
      mode: 'rustdesk',
      url: resolvedMeshUrl,
      fallbackUrl: publicUrl || lanUrl || '',
      lanReachable,
      device
    };
  }

  if (publicUrl) {
    return {
      mode: 'public',
      url: publicUrl,
      fallbackUrl: lanUrl || '',
      lanReachable,
      device
    };
  }

  if (lanUrl) {
    return {
      mode: 'lan',
      url: lanUrl,
      fallbackUrl: '',
      lanReachable,
      device
    };
  }

  throw createError('no launch url available for this device', 400, 'launch_url_missing');
}

module.exports = {
  STORE_PATH,
  CONTROL_CODE_PREFIX,
  listDevices,
  getDeviceById,
  createDevice,
  updateDevice,
  deleteDevice,
  generateControlCode,
  importControlCode,
  resolveLaunch,
  decodeControlCodePayload,
  buildMeshLaunchUrl,
  buildRustDeskLaunchUrl: buildMeshLaunchUrl
};
