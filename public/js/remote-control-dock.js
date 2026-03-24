(function () {
  const state = {
    devices: [],
    devicesLoaded: false,
    pendingRemoteRoute: '',
    pendingRemoteMode: '',
    sessions: new Map(),
    activeSessionId: '',
    viewerMinimized: false,
    viewerFullscreen: false,
    viewerRect: { left: 0, top: 0, width: 0, height: 0 },
    viewerPrevRect: null,
    dragging: null,
    prevBodyUserSelect: '',
    prevBodyCursor: '',
    bootstrap: {
      defaultOwner: '',
      defaultDeviceName: '',
      lanUrl: '',
      lanIp: '',
      port: 0,
      cloudflarePublicHost: '',
      cloudflarePathPrefix: '',
      cloudflareTunnelToken: ''
    },
    localRustDesk: {
      appInstalled: false,
      running: false,
      id: '',
      password: '',
      passwordSource: '',
      lastReadAt: ''
    },
    remoteConfig: {
      rustdeskWebBaseUrl: '',
      rustdeskSchemeAuthority: 'connect'
    },
    rustdeskPasswordDirty: false,
    bindTab: 'import',
    localBindingDeviceId: '',
    localProfile: {
      owner: '',
      deviceName: '',
      note: '',
      lanUrl: '',
      rustdeskId: '',
      password: '',
      bindingId: ''
    }
  };

  const els = {};
  const REMOTE_CF_FORM_CACHE_KEY = 'meco.remote.cloudflareForm.v1';
  const REMOTE_LOCAL_PROFILE_CACHE_KEY = 'meco.remote.localProfile.v1';

  function q(id) {
    return document.getElementById(id);
  }

  function escapeHtml(text) {
    const raw = String(text == null ? '' : text);
    return raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function readJson(res, fallbackMessage) {
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      body = null;
    }
    if (!res.ok) {
      const errorMessage = (body && (body.error || body.message)) || fallbackMessage || `request failed (${res.status})`;
      throw new Error(errorMessage);
    }
    return body || {};
  }

  function toSafeString(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  function slugify(value, fallback = 'device') {
    const normalized = toSafeString(value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return normalized || fallback;
  }

  function normalizeRustDeskId(value) {
    return toSafeString(value).replace(/\s+/g, '');
  }

  function trimSlashes(value) {
    return toSafeString(value).replace(/^\/+|\/+$/g, '');
  }

  function normalizePublicHost(host) {
    const raw = toSafeString(host);
    if (!raw) return '';
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const u = new URL(candidate);
      if (!/^https?:$/i.test(u.protocol)) return '';
      return `${u.protocol}//${u.host}`.replace(/\/+$/, '');
    } catch (_) {
      return '';
    }
  }

  function normalizePathPrefix(prefix) {
    const trimmed = trimSlashes(prefix);
    return trimmed ? `/${trimmed}` : '';
  }

  function normalizeRoutePath(value) {
    const raw = toSafeString(value);
    if (!raw) return '';
    const noQuery = raw.split('?')[0].split('#')[0];
    const normalized = `/${trimSlashes(noQuery)}`.replace(/\/+$/g, '');
    return normalized || '/';
  }

  function getRemoteRouteFromUrl() {
    try {
      const u = new URL(window.location.href);
      const route = u.searchParams.get('remoteRoute');
      return normalizeRoutePath(route || '');
    } catch (_) {
      return '';
    }
  }

  function getRemoteModeFromUrl() {
    try {
      const u = new URL(window.location.href);
      const mode = toSafeString(u.searchParams.get('remoteMode') || '').toLowerCase();
      return (mode === 'mesh' || mode === 'rustdesk') ? 'rustdesk' : '';
    } catch (_) {
      return '';
    }
  }

  function isEmbeddedMecoWindow() {
    if (window.self !== window.top) return true;
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get('mecoEmbed') === '1' || u.searchParams.get('meco_window') === '1';
    } catch (_) {
      return false;
    }
  }

  function hideRemoteDockUiForEmbed() {
    const remoteDock = q('remote-dock');
    if (remoteDock) {
      remoteDock.classList.add('hidden');
      remoteDock.style.display = 'none';
    }
    const bindModal = q('remote-bind-modal');
    if (bindModal) {
      bindModal.classList.add('hidden');
      bindModal.style.display = 'none';
    }
    const legacyViewer = q('remote-viewer-window');
    if (legacyViewer) {
      legacyViewer.classList.add('hidden');
      legacyViewer.style.display = 'none';
    }
  }

  function clearRemoteRouteFromUrl() {
    try {
      const u = new URL(window.location.href);
      const hasRoute = u.searchParams.has('remoteRoute');
      const hasMode = u.searchParams.has('remoteMode');
      if (!hasRoute && !hasMode) return;
      if (hasRoute) u.searchParams.delete('remoteRoute');
      if (hasMode) u.searchParams.delete('remoteMode');
      const nextUrl = `${u.pathname}${u.search}${u.hash}`;
      window.history.replaceState({}, '', nextUrl);
    } catch (_) {}
  }

  function normalizeComparableHttpUrl(rawUrl) {
    const text = toSafeString(rawUrl);
    if (!text) return '';
    const candidate = /^https?:\/\//i.test(text) ? text : `http://${text}`;
    try {
      const u = new URL(candidate);
      if (!/^https?:$/i.test(u.protocol)) return '';
      const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
      return `${u.hostname.toLowerCase()}:${u.port || (u.protocol === 'https:' ? '443' : '80')}${path}`;
    } catch (_) {
      return '';
    }
  }

  function readLocalProfileCache() {
    try {
      const raw = localStorage.getItem(REMOTE_LOCAL_PROFILE_CACHE_KEY);
      if (!raw) return { ...state.localProfile };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { ...state.localProfile };
      return {
        owner: toSafeString(parsed.owner),
        deviceName: toSafeString(parsed.deviceName),
        note: toSafeString(parsed.note),
        lanUrl: toSafeString(parsed.lanUrl),
        rustdeskId: normalizeRustDeskId(parsed.rustdeskId),
        password: toSafeString(parsed.password),
        bindingId: toSafeString(parsed.bindingId)
      };
    } catch (_) {
      return { ...state.localProfile };
    }
  }

  function writeLocalProfileCache(profile = {}) {
    try {
      localStorage.setItem(REMOTE_LOCAL_PROFILE_CACHE_KEY, JSON.stringify({
        owner: toSafeString(profile.owner),
        deviceName: toSafeString(profile.deviceName),
        note: toSafeString(profile.note),
        lanUrl: toSafeString(profile.lanUrl),
        rustdeskId: normalizeRustDeskId(profile.rustdeskId),
        password: toSafeString(profile.password),
        bindingId: toSafeString(profile.bindingId)
      }));
    } catch (_) {}
  }

  function setBindTab(tab) {
    const next = tab === 'local' ? 'local' : 'import';
    state.bindTab = next;
    if (els.bindTabLocalBtn) {
      els.bindTabLocalBtn.classList.toggle('bg-primary/15', next === 'local');
      els.bindTabLocalBtn.classList.toggle('border-primary/40', next === 'local');
      els.bindTabLocalBtn.classList.toggle('text-primary', next === 'local');
      els.bindTabLocalBtn.classList.toggle('bg-white/5', next !== 'local');
      els.bindTabLocalBtn.classList.toggle('border-white/10', next !== 'local');
      els.bindTabLocalBtn.classList.toggle('text-gray-300', next !== 'local');
    }
    if (els.bindTabImportBtn) {
      els.bindTabImportBtn.classList.toggle('bg-primary/15', next === 'import');
      els.bindTabImportBtn.classList.toggle('border-primary/40', next === 'import');
      els.bindTabImportBtn.classList.toggle('text-primary', next === 'import');
      els.bindTabImportBtn.classList.toggle('bg-white/5', next !== 'import');
      els.bindTabImportBtn.classList.toggle('border-white/10', next !== 'import');
      els.bindTabImportBtn.classList.toggle('text-gray-300', next !== 'import');
    }
    if (els.bindPanelLocal) {
      els.bindPanelLocal.classList.toggle('hidden', next !== 'local');
    }
    if (els.bindPanelImport) {
      els.bindPanelImport.classList.toggle('hidden', next !== 'import');
    }
  }

  function extractTunnelToken(raw) {
    const text = toSafeString(raw);
    if (!text) return '';
    const tokenFlagMatch = text.match(/--token\s+([^\s"']+)/i);
    if (tokenFlagMatch && tokenFlagMatch[1]) {
      return toSafeString(tokenFlagMatch[1]);
    }
    const quotedTokenMatch = text.match(/--token\s+["']([^"']+)["']/i);
    if (quotedTokenMatch && quotedTokenMatch[1]) {
      return toSafeString(quotedTokenMatch[1]);
    }
    return text;
  }

  function readCloudflareFormCache() {
    try {
      const raw = localStorage.getItem(REMOTE_CF_FORM_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        cloudflarePublicHost: toSafeString(parsed.cloudflarePublicHost),
        cloudflarePathPrefix: normalizePathPrefix(parsed.cloudflarePathPrefix),
        cloudflareTunnelToken: toSafeString(parsed.cloudflareTunnelToken)
      };
    } catch (_) {
      return null;
    }
  }

  function writeCloudflareFormCache(form) {
    try {
      localStorage.setItem(REMOTE_CF_FORM_CACHE_KEY, JSON.stringify({
        cloudflarePublicHost: toSafeString(form.cloudflarePublicHost),
        cloudflarePathPrefix: normalizePathPrefix(form.cloudflarePathPrefix),
        cloudflareTunnelToken: toSafeString(form.cloudflareTunnelToken)
      }));
    } catch (_) {}
  }

  function getCloudflareFormValues() {
    const host = normalizePublicHost(els.cfHostInput && els.cfHostInput.value);
    const prefix = normalizePathPrefix(els.cfPrefixInput && els.cfPrefixInput.value);
    const token = extractTunnelToken(els.cfTokenInput && els.cfTokenInput.value);
    return {
      cloudflarePublicHost: host,
      cloudflarePathPrefix: prefix,
      cloudflareTunnelToken: token
    };
  }

  function applyCloudflareFormValues(values = {}, options = {}) {
    const keepUserInput = !!(options && options.keepUserInput);
    const host = normalizePublicHost(values.cloudflarePublicHost || '');
    const prefix = normalizePathPrefix(values.cloudflarePathPrefix || '');
    const token = extractTunnelToken(values.cloudflareTunnelToken || '');

    if (els.cfHostInput && (!keepUserInput || !toSafeString(els.cfHostInput.value))) {
      els.cfHostInput.value = host;
    }
    if (els.cfPrefixInput && (!keepUserInput || !toSafeString(els.cfPrefixInput.value))) {
      els.cfPrefixInput.value = prefix;
    }
    if (els.cfTokenInput && (!keepUserInput || !toSafeString(els.cfTokenInput.value))) {
      els.cfTokenInput.value = token;
    }
  }

  async function persistCloudflareSettingsFromForm() {
    const form = getCloudflareFormValues();
    const payload = {
      settings: {
        cloudflarePublicHost: form.cloudflarePublicHost,
        cloudflarePathPrefix: form.cloudflarePathPrefix,
        cloudflareTunnelToken: form.cloudflareTunnelToken
      }
    };
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    await readJson(res, '保存 Cloudflare 配置失败');

    state.bootstrap.cloudflarePublicHost = form.cloudflarePublicHost;
    state.bootstrap.cloudflarePathPrefix = form.cloudflarePathPrefix;
    state.bootstrap.cloudflareTunnelToken = form.cloudflareTunnelToken;
    writeCloudflareFormCache(form);
    updatePublicPreview();
    return form;
  }

  function buildPublicPreview(owner, deviceName) {
    const host = normalizePublicHost((els.cfHostInput && els.cfHostInput.value) || state.bootstrap.cloudflarePublicHost || '');
    if (!host) return '';
    const prefix = trimSlashes((els.cfPrefixInput && els.cfPrefixInput.value) || state.bootstrap.cloudflarePathPrefix || '');
    const prefixSegments = prefix ? prefix.split('/').filter(Boolean) : [];
    const last = prefixSegments.length ? prefixSegments[prefixSegments.length - 1] : '';
    if (last !== 'web') {
      prefixSegments.push('web');
    }
    const ownerSlug = slugify(owner || state.bootstrap.defaultOwner || '', 'user');
    const deviceSlug = slugify(deviceName || '', 'dev');
    const pathParts = [...prefixSegments, ownerSlug, deviceSlug].filter(Boolean).join('/');
    return `${host}/${pathParts}`;
  }

  function setText(el, text) {
    if (!el) return;
    el.textContent = text || '';
  }

  function getRustDeskPasswordInputValue() {
    if (!els.rustdeskPasswordView) return '';
    if (typeof els.rustdeskPasswordView.value === 'string') {
      return toSafeString(els.rustdeskPasswordView.value);
    }
    return toSafeString(els.rustdeskPasswordView.textContent);
  }

  function getLocalProfileFormSnapshot() {
    return {
      owner: toSafeString(els.ownerInput && els.ownerInput.value),
      deviceName: toSafeString(els.deviceInput && els.deviceInput.value),
      note: toSafeString(els.noteInput && els.noteInput.value),
      lanUrl: toSafeString(els.lanInput && els.lanInput.value),
      rustdeskId: normalizeRustDeskId((els.rustdeskIdInput && els.rustdeskIdInput.value) || ''),
      password: toSafeString(getRustDeskPasswordInputValue() || ''),
      bindingId: toSafeString(state.localProfile.bindingId || '')
    };
  }

  function applyLocalProfileToForm(options = {}) {
    const keepUserInput = !!(options && options.keepUserInput);
    const profile = state.localProfile || {};
    if (els.ownerInput && (!keepUserInput || !toSafeString(els.ownerInput.value))) {
      els.ownerInput.value = toSafeString(profile.owner);
    }
    if (els.deviceInput && (!keepUserInput || !toSafeString(els.deviceInput.value))) {
      els.deviceInput.value = toSafeString(profile.deviceName);
    }
    if (els.noteInput && (!keepUserInput || !toSafeString(els.noteInput.value))) {
      els.noteInput.value = toSafeString(profile.note);
    }
    if (els.lanInput && (!keepUserInput || !toSafeString(els.lanInput.value))) {
      els.lanInput.value = toSafeString(profile.lanUrl);
    }
    if (els.rustdeskIdInput && (!keepUserInput || !normalizeRustDeskId(els.rustdeskIdInput.value))) {
      els.rustdeskIdInput.value = normalizeRustDeskId(profile.rustdeskId);
    }
    if (!keepUserInput || !toSafeString(getRustDeskPasswordInputValue())) {
      setRustDeskPasswordView(profile.password || '');
    }
  }

  function persistLocalProfileFromForm(extra = {}) {
    const merged = {
      ...state.localProfile,
      ...getLocalProfileFormSnapshot(),
      ...extra
    };
    merged.rustdeskId = normalizeRustDeskId(merged.rustdeskId);
    merged.bindingId = toSafeString(merged.bindingId);
    state.localProfile = merged;
    writeLocalProfileCache(merged);
    return merged;
  }

  function isLocalDevice(device) {
    if (!device) return false;
    const bindingId = toSafeString(state.localProfile.bindingId);
    if (bindingId && toSafeString(device.id) === bindingId) {
      return true;
    }

    const localRustdeskId = normalizeRustDeskId(state.localRustDesk.id || state.localProfile.rustdeskId);
    const deviceRustdeskId = normalizeRustDeskId(device.rustdeskId || device.meshNodeId || '');
    if (localRustdeskId && deviceRustdeskId && localRustdeskId === deviceRustdeskId) {
      return true;
    }

    const localLan = normalizeComparableHttpUrl(state.bootstrap.lanUrl || state.localProfile.lanUrl);
    const deviceLan = normalizeComparableHttpUrl(device.lanUrl || '');
    if (localLan && deviceLan && localLan === deviceLan) {
      return true;
    }

    const profileOwner = toSafeString(state.localProfile.owner);
    const profileDeviceName = toSafeString(state.localProfile.deviceName);
    if (!profileOwner || !profileDeviceName) return false;
    return toSafeString(device.owner) === profileOwner && toSafeString(device.deviceName) === profileDeviceName;
  }

  function findLocalBoundDevice() {
    const byBindingId = toSafeString(state.localProfile.bindingId);
    if (byBindingId) {
      const found = state.devices.find((d) => toSafeString(d && d.id) === byBindingId);
      if (found) return found;
    }

    const owner = toSafeString(els.ownerInput && els.ownerInput.value) || toSafeString(state.localProfile.owner);
    const deviceName = toSafeString(els.deviceInput && els.deviceInput.value) || toSafeString(state.localProfile.deviceName);
    if (owner && deviceName) {
      const byIdentity = state.devices.find((d) => toSafeString(d && d.owner) === owner && toSafeString(d && d.deviceName) === deviceName);
      if (byIdentity) return byIdentity;
    }

    const rustdeskId = normalizeRustDeskId(
      (els.rustdeskIdInput && els.rustdeskIdInput.value)
      || state.localRustDesk.id
      || state.localProfile.rustdeskId
      || ''
    );
    if (rustdeskId) {
      const byRustdeskId = state.devices.find((d) => normalizeRustDeskId((d && (d.rustdeskId || d.meshNodeId)) || '') === rustdeskId);
      if (byRustdeskId) return byRustdeskId;
    }

    return null;
  }

  function syncLocalProfileFromBoundDevice(options = {}) {
    const overwriteForm = !!(options && options.overwriteForm);
    const device = findLocalBoundDevice();
    if (!device) return false;

    const next = {
      ...state.localProfile,
      owner: toSafeString(device.owner || state.localProfile.owner),
      deviceName: toSafeString(device.deviceName || state.localProfile.deviceName),
      note: toSafeString(device.note || state.localProfile.note),
      lanUrl: toSafeString(device.lanUrl || state.localProfile.lanUrl || state.bootstrap.lanUrl),
      rustdeskId: normalizeRustDeskId(
        (device.rustdeskId || device.meshNodeId || state.localProfile.rustdeskId || state.localRustDesk.id || '')
      ),
      bindingId: toSafeString(device.id || state.localProfile.bindingId)
    };

    state.localProfile = next;
    writeLocalProfileCache(next);

    if (overwriteForm) {
      if (els.ownerInput) els.ownerInput.value = next.owner;
      if (els.deviceInput) els.deviceInput.value = next.deviceName;
      if (els.noteInput) els.noteInput.value = next.note;
      if (els.lanInput) els.lanInput.value = next.lanUrl;
      if (els.rustdeskIdInput) els.rustdeskIdInput.value = next.rustdeskId;
      updatePublicPreview();
    }
    return true;
  }

  function refreshLocalBindingMode() {
    const localBoundDevice = findLocalBoundDevice();
    state.localBindingDeviceId = localBoundDevice ? toSafeString(localBoundDevice.id) : '';
    if (state.localBindingDeviceId && state.localProfile.bindingId !== state.localBindingDeviceId) {
      persistLocalProfileFromForm({ bindingId: state.localBindingDeviceId });
    }
    if (!state.localBindingDeviceId && state.localProfile.bindingId && state.devicesLoaded) {
      persistLocalProfileFromForm({ bindingId: '' });
    }
    const idleText = state.localBindingDeviceId ? '修改绑定' : '创建绑定';
    if (els.createBtn && !els.createBtn.disabled) {
      els.createBtn.textContent = idleText;
    }
  }

  function setRustDeskPasswordView(password, options = {}) {
    if (!els.rustdeskPasswordView) return;
    const value = toSafeString(password);
    const preserveUserInput = !!(options && options.preserveUserInput);
    if (typeof els.rustdeskPasswordView.value === 'string') {
      const current = toSafeString(els.rustdeskPasswordView.value);
      if (preserveUserInput && current) return;
      els.rustdeskPasswordView.value = value || '';
      state.rustdeskPasswordDirty = false;
      return;
    }
    els.rustdeskPasswordView.textContent = value || '-';
    state.rustdeskPasswordDirty = false;
  }

  function showStatus(el, message, isError) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.remove('text-red-400', 'text-emerald-400', 'text-gray-400');
    if (!message) {
      el.classList.add('text-gray-400');
    } else if (isError) {
      el.classList.add('text-red-400');
    } else {
      el.classList.add('text-emerald-400');
    }
  }

  function getDeviceLabel(device) {
    if (!device) return 'Unknown';
    const note = String(device.note || '').trim();
    if (note) return note;
    return `${device.owner || 'user'}/${device.deviceName || 'device'}`;
  }

  function openBindModal() {
    if (!els.bindModal) return;
    els.bindModal.classList.remove('hidden');
    els.bindModal.classList.add('flex');
    setBindTab('import');
    showStatus(els.createStatus, '', false);
    showStatus(els.importStatus, '', false);
    showStatus(els.cloudflareStatus, '', false);
    state.rustdeskPasswordDirty = false;
    state.localProfile = readLocalProfileCache();
    applyLocalProfileToForm({ keepUserInput: false });
    syncLocalProfileFromBoundDevice({ overwriteForm: true });
    updatePublicPreview();
    refreshLocalBindingMode();
    loadBootstrap().catch((e) => {
      console.warn('[RemoteDock] bootstrap load failed', e);
      showStatus(els.cloudflareStatus, e.message || '读取默认值失败', true);
    }).finally(() => {
      syncLocalProfileFromBoundDevice({ overwriteForm: true });
      refreshLocalBindingMode();
      persistLocalProfileFromForm();
    });
    readLocalRustDeskInfo({ launchIfNeeded: false, silent: true }).catch((e) => {
      console.warn('[RemoteDock] local rustdesk read failed', e);
      if (els.rustdeskReadStatus) {
        showStatus(els.rustdeskReadStatus, e.message || '读取本机 RustDesk 失败', true);
      }
    }).finally(() => {
      syncLocalProfileFromBoundDevice({ overwriteForm: true });
      refreshLocalBindingMode();
      persistLocalProfileFromForm();
    });
    renderBindDeviceList();
  }

  function closeBindModal() {
    if (!els.bindModal) return;
    els.bindModal.classList.add('hidden');
    els.bindModal.classList.remove('flex');
  }

  function setCreateLoading(loading) {
    if (!els.createBtn) return;
    els.createBtn.disabled = !!loading;
    const isUpdate = !!state.localBindingDeviceId;
    els.createBtn.textContent = loading
      ? (isUpdate ? '修改中...' : '创建中...')
      : (isUpdate ? '修改绑定' : '创建绑定');
  }

  function setImportLoading(loading) {
    if (!els.importBtn) return;
    els.importBtn.disabled = !!loading;
    els.importBtn.textContent = loading ? '导入中...' : '导入绑定';
  }

  function setCloudflareLoading(loading) {
    if (!els.cloudflareBtn) return;
    els.cloudflareBtn.disabled = !!loading;
    els.cloudflareBtn.textContent = loading ? '处理中...' : 'Cloudflare Tunnel 绑定引导';
  }

  function setRustDeskReadLoading(loading) {
    if (!els.rustdeskReadBtn) return;
    if (!state.localRustDesk.appInstalled && !loading) return;
    els.rustdeskReadBtn.disabled = !!loading;
    els.rustdeskReadBtn.textContent = loading ? '读取中...' : (state.localRustDesk.running ? '重新读取' : '点击读取');
  }

  function updatePublicPreview() {
    if (!els.publicPreviewInput) return;
    const owner = toSafeString(els.ownerInput && els.ownerInput.value);
    const deviceName = toSafeString(els.deviceInput && els.deviceInput.value);
    const preview = buildPublicPreview(owner, deviceName);
    els.publicPreviewInput.value = preview || '';
    if (!preview) {
      els.publicPreviewInput.placeholder = '未配置 cloudflarePublicHost，去 API Keys 配置后自动生成';
    }
  }

  async function loadBootstrap() {
    const owner = toSafeString(els.ownerInput && els.ownerInput.value);
    const deviceName = toSafeString(els.deviceInput && els.deviceInput.value);
    const query = new URLSearchParams();
    if (owner) query.set('owner', owner);
    if (deviceName) query.set('deviceName', deviceName);

    const suffix = query.toString() ? `?${query.toString()}` : '';
    const res = await fetch(`/api/remote/bootstrap${suffix}`, { cache: 'no-store' });
    const body = await readJson(res, '读取远控默认信息失败');
    const bootstrap = body.bootstrap || {};

    state.bootstrap.defaultOwner = toSafeString(bootstrap.defaultOwner);
    state.bootstrap.defaultDeviceName = toSafeString(bootstrap.defaultDeviceName);
    state.bootstrap.lanUrl = toSafeString(bootstrap.lanUrl);
    state.bootstrap.lanIp = toSafeString(bootstrap.lanIp);
    state.bootstrap.port = Number(bootstrap.port) || 0;
    state.bootstrap.cloudflarePublicHost = toSafeString(bootstrap.cloudflarePublicHost);
    state.bootstrap.cloudflarePathPrefix = toSafeString(bootstrap.cloudflarePathPrefix);
    state.bootstrap.cloudflareTunnelToken = toSafeString(bootstrap.cloudflareTunnelToken);

    if (els.ownerInput && !toSafeString(els.ownerInput.value)) {
      els.ownerInput.value = state.bootstrap.defaultOwner || '';
    }
    if (
      els.deviceInput
      && !toSafeString(els.deviceInput.value)
      && !toSafeString(state.localProfile.deviceName)
      && !toSafeString(state.localProfile.bindingId)
    ) {
      els.deviceInput.value = state.bootstrap.defaultDeviceName || '';
    }
    if (els.lanInput && !toSafeString(els.lanInput.value)) {
      els.lanInput.value = state.bootstrap.lanUrl || '';
    }

    const cached = readCloudflareFormCache();
    if (cached) {
      applyCloudflareFormValues(cached, { keepUserInput: true });
    } else {
      applyCloudflareFormValues({
        cloudflarePublicHost: state.bootstrap.cloudflarePublicHost,
        cloudflarePathPrefix: state.bootstrap.cloudflarePathPrefix,
        cloudflareTunnelToken: state.bootstrap.cloudflareTunnelToken
      }, { keepUserInput: true });
    }

    updatePublicPreview();
    refreshLocalBindingMode();
  }

  async function loadRemoteConfig() {
    const res = await fetch('/api/remote/config', { cache: 'no-store' });
    const body = await readJson(res, '读取远控配置失败');
    const config = body && body.config ? body.config : {};
    state.remoteConfig.rustdeskWebBaseUrl = toSafeString(config.rustdeskWebBaseUrl);
    state.remoteConfig.rustdeskSchemeAuthority = toSafeString(config.rustdeskSchemeAuthority) || 'connect';
  }

  function applyLocalRustDeskInfo(info = {}, options = {}) {
    const keepUserInput = !!(options && options.keepUserInput);
    const next = {
      appInstalled: !!info.appInstalled,
      running: !!info.running,
      id: normalizeRustDeskId(info.id),
      password: toSafeString(info.password),
      passwordSource: toSafeString(info.passwordSource),
      lastReadAt: toSafeString(info.readAt)
    };
    state.localRustDesk = next;

    if (els.rustdeskIdInput && (!keepUserInput || !normalizeRustDeskId(els.rustdeskIdInput.value))) {
      els.rustdeskIdInput.value = next.id || '';
    }
    setRustDeskPasswordView(next.password, {
      preserveUserInput: keepUserInput && state.rustdeskPasswordDirty
    });

    if (els.rustdeskReadBtn) {
      if (!next.appInstalled) {
        els.rustdeskReadBtn.textContent = '未安装 RustDesk';
        els.rustdeskReadBtn.disabled = true;
      } else {
        els.rustdeskReadBtn.disabled = false;
        els.rustdeskReadBtn.textContent = next.running ? '重新读取' : '点击读取';
      }
    }

    if (els.rustdeskReadStatus) {
      if (!next.appInstalled) {
        showStatus(els.rustdeskReadStatus, '未检测到 RustDesk.app', true);
      } else if (!next.running) {
        showStatus(els.rustdeskReadStatus, 'RustDesk 未运行，点击读取会自动启动', false);
      } else if (!next.id) {
        showStatus(els.rustdeskReadStatus, '已启动 RustDesk，但暂未读取到 ID', true);
      } else if (!next.password) {
        showStatus(els.rustdeskReadStatus, '已读取 ID，暂未读取到密码', false);
      } else {
        showStatus(els.rustdeskReadStatus, `已读取 ID 和密码（来源: ${next.passwordSource || 'local'}）`, false);
      }
    }
    refreshLocalBindingMode();
    renderBindDeviceList();
    renderDockTabs();
  }

  async function readLocalRustDeskInfo(options = {}) {
    const launchIfNeeded = !!(options && options.launchIfNeeded);
    const silent = !!(options && options.silent);
    if (!silent && els.rustdeskReadStatus) {
      showStatus(els.rustdeskReadStatus, launchIfNeeded ? '正在读取（必要时会启动 RustDesk）...' : '正在读取...', false);
    }
    const qs = new URLSearchParams();
    if (launchIfNeeded) qs.set('launch', '1');
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await fetch(`/api/remote/rustdesk/local-info${suffix}`, { cache: 'no-store' });
    const body = await readJson(res, '读取本机 RustDesk 信息失败');
    const info = body && body.rustdesk ? body.rustdesk : {};
    applyLocalRustDeskInfo(info, { keepUserInput: !launchIfNeeded });
    persistLocalProfileFromForm();
    return info;
  }

  async function loadDevices() {
    const res = await fetch('/api/remote/devices', { cache: 'no-store' });
    const body = await readJson(res, '加载远控设备失败');
    state.devices = Array.isArray(body.devices) ? body.devices : [];
    state.devicesLoaded = true;
    renderDockTabs();
    renderBindDeviceList();
    refreshLocalBindingMode();
  }

  function renderDockTabs() {
    if (!els.dockTabs) return;
    if (!state.devices.length) {
      els.dockTabs.innerHTML = '<span class="text-xs text-gray-500 px-2">暂无设备，点击“绑定设备”开始</span>';
      updateWindowLayerBounds();
      return;
    }

    const html = state.devices.map((device) => {
      const existing = getLatestSessionByDevice(device.id);
      const isOpen = !!existing;
      const isActive = Array.from(state.sessions.values()).some((session) => (
        session
        && session.id === state.activeSessionId
        && !session.minimized
        && toSafeString(session.deviceId) === toSafeString(device.id)
      ));
      const isLocal = isLocalDevice(device);
      const classes = [
        'h-9 px-3 rounded-xl border text-xs font-medium transition-colors inline-flex items-center gap-2 shrink-0',
        isActive
          ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200'
          : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10'
      ].join(' ');
      const dot = isOpen ? '<span class="w-2 h-2 rounded-full bg-emerald-400"></span>' : '<span class="w-2 h-2 rounded-full bg-gray-600"></span>';
      const label = escapeHtml(getDeviceLabel(device));
      const localFlag = isLocal
        ? '<span class="text-[10px] px-1.5 py-0.5 rounded border border-blue-400/40 text-blue-200 bg-blue-500/10">本机</span>'
        : '';
      return `<button type="button" data-action="open" data-device-id="${escapeHtml(device.id)}" class="${classes}">${dot}<span>${label}</span>${localFlag}</button>`;
    }).join('');

    els.dockTabs.innerHTML = html;
    updateWindowLayerBounds();
  }

  function renderBindDeviceList() {
    if (!els.bindDeviceList) return;
    if (!state.devices.length) {
      els.bindDeviceList.innerHTML = '<div class="text-xs text-gray-500 border border-white/10 rounded-lg p-3">还没有绑定设备</div>';
      return;
    }

    const html = state.devices.map((device) => {
      const isLocal = isLocalDevice(device);
      const openFlag = getLatestSessionByDevice(device.id)
        ? '<span class="text-[10px] px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-300">在线窗口</span>'
        : '<span class="text-[10px] px-2 py-0.5 rounded border border-white/15 text-gray-400">未打开</span>';
      const localFlag = isLocal
        ? '<span class="text-[10px] px-2 py-0.5 rounded border border-blue-400/35 text-blue-200 bg-blue-500/10">本机</span>'
        : '';
      const meta = `${escapeHtml(device.owner || '')}/${escapeHtml(device.deviceName || '')}`;
      const route = escapeHtml(device.routePath || '');
      const lanUrl = escapeHtml(device.lanUrl || '');
      const publicUrl = escapeHtml(device.publicUrl || '');
      const rustdeskReady = !!(device.rustdeskReady || device.meshDesktopReady);
      const title = escapeHtml(getDeviceLabel(device));
      const rustdeskButtonClass = rustdeskReady
        ? 'px-2.5 h-7 rounded-lg border border-cyan-400/35 text-xs text-cyan-200 hover:bg-cyan-500/10'
        : 'px-2.5 h-7 rounded-lg border border-amber-400/35 text-xs text-amber-200 hover:bg-amber-500/10';
      const rustdeskButtonAttrs = rustdeskReady
        ? 'data-action="open-rustdesk"'
        : 'data-action="open-rustdesk" title="未配置 RustDesk ID/启动链接"';
      const rustdeskIdText = escapeHtml(device.rustdeskId || device.meshNodeId || '');
      return `
        <div class="rounded-xl border border-white/10 bg-white/[0.03] p-3" data-device-id="${escapeHtml(device.id)}">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm text-white font-medium truncate">${title}</div>
              <div class="text-[11px] text-gray-400 truncate mt-0.5">${meta} · ${route}</div>
            </div>
            <div class="flex items-center gap-1">${openFlag}${localFlag}</div>
          </div>
          <div class="text-[11px] text-gray-500 mt-1 truncate">LAN: ${lanUrl || '-'} </div>
          <div class="text-[11px] text-gray-500 truncate">Public: ${publicUrl || '-'} </div>
          <div class="text-[11px] text-gray-500 truncate">RustDesk ID: ${rustdeskIdText || '-'} </div>
          <div class="flex items-center gap-2 mt-2">
            <button type="button" data-action="open" class="px-2.5 h-7 rounded-lg border border-white/15 text-xs text-white hover:bg-white/10">打开</button>
            <button type="button" ${rustdeskButtonAttrs} class="${rustdeskButtonClass}">RustDesk 远控</button>
            <button type="button" data-action="copy-code" class="px-2.5 h-7 rounded-lg border border-white/15 text-xs text-white hover:bg-white/10">复制被控码</button>
            <button type="button" data-action="delete" class="px-2.5 h-7 rounded-lg border border-red-500/35 text-xs text-red-300 hover:bg-red-500/10">删除</button>
          </div>
        </div>
      `;
    }).join('');

    els.bindDeviceList.innerHTML = html;
  }

  function getCreatePayload() {
    const owner = toSafeString((els.ownerInput && els.ownerInput.value) || state.bootstrap.defaultOwner || '');
    const deviceName = toSafeString((els.deviceInput && els.deviceInput.value) || '');
    const note = toSafeString((els.noteInput && els.noteInput.value) || '');
    const lanUrl = toSafeString((els.lanInput && els.lanInput.value) || state.bootstrap.lanUrl || '');
    const password = toSafeString(getRustDeskPasswordInputValue() || '');
    const rustdeskId = normalizeRustDeskId((els.rustdeskIdInput && els.rustdeskIdInput.value) || '');

    return {
      owner,
      deviceName,
      note,
      lanUrl,
      password,
      rustdeskId,
      rustdeskPassword: password
    };
  }

  async function createBinding() {
    try {
      persistLocalProfileFromForm();
      refreshLocalBindingMode();
      const existingLocal = findLocalBoundDevice();
      const targetId = toSafeString(state.localBindingDeviceId || (existingLocal && existingLocal.id));
      const isUpdate = !!targetId;
      setCreateLoading(true);
      showStatus(els.createStatus, '', false);
      const payload = getCreatePayload();
      const url = isUpdate
        ? `/api/remote/devices/${encodeURIComponent(targetId)}`
        : '/api/remote/devices';
      const method = isUpdate ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await readJson(res, isUpdate ? '修改绑定失败' : '创建绑定失败');
      const device = body && body.device ? body.device : null;
      const nextBindingId = toSafeString(device && device.id) || targetId;
      persistLocalProfileFromForm({ bindingId: nextBindingId });
      triggerAutoCloudflareTunnelStart(payload).catch((e) => {
        console.warn('[RemoteDock] auto cloudflare start skipped:', e);
      });
      showStatus(els.createStatus, isUpdate ? '修改成功' : '创建成功', false);
      await loadDevices();
      refreshLocalBindingMode();
    } catch (e) {
      showStatus(els.createStatus, e.message || '保存失败', true);
    } finally {
      setCreateLoading(false);
    }
  }

  async function startCloudflareGuide() {
    const owner = toSafeString((els.ownerInput && els.ownerInput.value) || state.bootstrap.defaultOwner || '');
    const deviceName = toSafeString((els.deviceInput && els.deviceInput.value) || '');
    if (!owner || !deviceName) {
      showStatus(els.cloudflareStatus, '先填写用户名和设备名', true);
      return;
    }

    try {
      setCloudflareLoading(true);
      showStatus(els.cloudflareStatus, '', false);
      await persistCloudflareSettingsFromForm();
      const res = await fetch('/api/remote/cloudflare/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, deviceName })
      });
      const body = await readJson(res, 'Cloudflare Tunnel 引导失败');

      const preview = toSafeString(body.previewPublicUrl || '');
      if (preview && els.publicPreviewInput) {
        els.publicPreviewInput.value = preview;
      }

      const message = toSafeString(body.message || '');
      showStatus(els.cloudflareStatus, message || '已执行', false);

      const commands = Array.isArray(body.commands) ? body.commands.filter(Boolean) : [];
      if (commands.length > 0) {
        const tips = commands.map((cmd) => `- ${cmd}`).join('\n');
        alert(`${message || 'Cloudflare Tunnel 引导'}\n\n建议命令:\n${tips}`);
      }
    } catch (e) {
      showStatus(els.cloudflareStatus, e.message || 'Cloudflare Tunnel 引导失败', true);
    } finally {
      setCloudflareLoading(false);
    }
  }

  async function triggerAutoCloudflareTunnelStart(payload = {}) {
    const owner = toSafeString(payload.owner || state.bootstrap.defaultOwner || '');
    const deviceName = toSafeString(payload.deviceName || '');
    if (!owner || !deviceName) return;
    try {
      await fetch('/api/remote/cloudflare/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, deviceName })
      });
    } catch (e) {
      console.warn('[RemoteDock] auto cloudflare start failed', e);
    }
  }

  function parseImportCodes(rawText) {
    const text = String(rawText == null ? '' : rawText).trim();
    if (!text) return [];

    const pattern = /MRC1\.[A-Za-z0-9_-]+\.[A-Fa-f0-9]{16}/g;
    const extracted = text.match(pattern) || [];
    const base = extracted.length > 0
      ? extracted
      : text
        .split(/\r?\n+/g)
        .map((line) => toSafeString(line))
        .filter(Boolean)
        .map((line) => {
          const match = line.match(pattern);
          return match && match[0] ? match[0] : line;
        });

    const seen = new Set();
    const codes = [];
    for (const item of base) {
      const code = toSafeString(item);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      codes.push(code);
    }
    return codes;
  }

  async function importBindingCode() {
    const rawInput = els.importInput && els.importInput.value ? String(els.importInput.value) : '';
    const codes = parseImportCodes(rawInput);
    if (!codes.length) {
      showStatus(els.importStatus, '请先粘贴被控码（支持多行）', true);
      return;
    }

    try {
      setImportLoading(true);
      showStatus(els.importStatus, '', false);
      const succeeded = [];
      const failed = [];

      for (let i = 0; i < codes.length; i += 1) {
        const code = codes[i];
        showStatus(els.importStatus, `导入中 ${i + 1}/${codes.length}...`, false);
        try {
          const res = await fetch('/api/remote/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
          });
          const body = await readJson(res, '导入失败');
          succeeded.push({
            code,
            deviceId: toSafeString(body && body.device && body.device.id)
          });
        } catch (e) {
          failed.push({
            code,
            error: e && e.message ? String(e.message) : '导入失败'
          });
        }
      }

      if (succeeded.length > 0) {
        await loadDevices();
      }

      if (failed.length === 0) {
        showStatus(els.importStatus, `导入成功，共 ${succeeded.length} 台`, false);
        if (els.importInput) els.importInput.value = '';
        return;
      }

      if (els.importInput) {
        els.importInput.value = failed.map((item) => item.code).join('\n');
      }

      const summary = succeeded.length > 0
        ? `部分成功：成功 ${succeeded.length} 台，失败 ${failed.length} 台`
        : `导入失败，共 ${failed.length} 台`;
      showStatus(els.importStatus, summary, true);

      const detail = failed
        .slice(0, 5)
        .map((item, idx) => `${idx + 1}. ${item.error}`)
        .join('\n');
      alert(`${summary}\n\n失败原因:\n${detail}${failed.length > 5 ? `\n... 其余 ${failed.length - 5} 条请重试` : ''}`);
    } catch (e) {
      showStatus(els.importStatus, e.message || '导入失败', true);
    } finally {
      setImportLoading(false);
    }
  }

  async function deleteBinding(deviceId) {
    const ok = window.confirm('确认删除该绑定设备吗？');
    if (!ok) return;

    const res = await fetch(`/api/remote/devices/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE'
    });
    await readJson(res, '删除失败');

    if (toSafeString(state.localProfile.bindingId) === toSafeString(deviceId)) {
      persistLocalProfileFromForm({ bindingId: '' });
    }
    closeSessionsByDevice(deviceId);
    await loadDevices();
  }

  async function copyControlCode(deviceId) {
    const res = await fetch(`/api/remote/devices/${encodeURIComponent(deviceId)}/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const body = await readJson(res, '生成被控码失败');
    const code = body.code || '';
    if (!code) throw new Error('空被控码');

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(code);
      alert('被控码已复制到剪贴板');
      return;
    }

    const textArea = document.createElement('textarea');
    textArea.value = code;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    alert('被控码已复制到剪贴板');
  }

  async function probeLanReachable(lanUrl) {
    const target = String(lanUrl || '').trim();
    if (!target) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try { controller.abort(); } catch (_) {}
    }, 1200);
    try {
      await fetch(target, {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller.signal
      });
      return true;
    } catch (_) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  function ensureViewerRect() {
    if (!els.viewerWindow) return;
    const rect = els.viewerWindow.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      state.viewerRect = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
      return;
    }
    state.viewerRect = {
      left: Math.max(8, Math.round(window.innerWidth * 0.08)),
      top: Math.max(8, Math.round(window.innerHeight * 0.08)),
      width: Math.max(640, Math.round(window.innerWidth * 0.84)),
      height: Math.max(420, Math.round(window.innerHeight * 0.78))
    };
  }

  function applyViewerRect() {
    if (!els.viewerWindow) return;
    const { left, top, width, height } = state.viewerRect;
    els.viewerWindow.style.left = `${Math.max(0, Math.round(left))}px`;
    els.viewerWindow.style.top = `${Math.max(0, Math.round(top))}px`;
    els.viewerWindow.style.width = `${Math.max(520, Math.round(width))}px`;
    els.viewerWindow.style.height = `${Math.max(320, Math.round(height))}px`;
  }

  function showViewerWindow() {
    if (!els.viewerWindow) return;
    if (els.viewerWindow.classList.contains('hidden')) {
      els.viewerWindow.classList.remove('hidden');
    }
    state.viewerMinimized = false;
  }

  function hideViewerWindow() {
    if (!els.viewerWindow) return;
    els.viewerWindow.classList.add('hidden');
  }

  function setViewerModeBadge(modeText) {
    if (!els.viewerModeBadge) return;
    const text = String(modeText || '').trim();
    if (!text) {
      els.viewerModeBadge.classList.add('hidden');
      els.viewerModeBadge.textContent = '';
      return;
    }
    els.viewerModeBadge.classList.remove('hidden');
    els.viewerModeBadge.textContent = text;
  }

  function setViewerTitle(device, mode) {
    if (!els.viewerTitle) return;
    const label = getDeviceLabel(device);
    const route = device && device.routePath ? device.routePath : '';
    els.viewerTitle.textContent = route ? `${label} · ${route}` : label;
    if (mode) setViewerModeBadge(mode.toUpperCase());
  }

  function getDeviceById(deviceId) {
    return state.devices.find((d) => d && d.id === deviceId) || null;
  }

  function createSession(device, launch) {
    const iframe = document.createElement('iframe');
    iframe.className = 'absolute inset-0 w-full h-full border-0 bg-black hidden';
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.src = launch.url;
    iframe.dataset.deviceId = device.id;
    iframe.dataset.mode = launch.mode || '';
    els.viewerBody.appendChild(iframe);

    const session = {
      id: device.id,
      device,
      mode: launch.mode || '',
      url: launch.url || '',
      fallbackUrl: launch.fallbackUrl || '',
      iframe
    };

    state.sessions.set(device.id, session);
    return session;
  }

  function normalizeRemoteLaunchUrl(rawUrl) {
    const text = toSafeString(rawUrl);
    if (!text) return '';
    if (/^rustdesk:\/\//i.test(text)) return text;
    try {
      const u = new URL(text);
      const isMeshUrl = u.searchParams.has('gotonode');
      if (isMeshUrl) {
        u.searchParams.set('viewmode', '11');
      }
      return u.toString();
    } catch (_) {
      return text;
    }
  }

  function parseRustDeskConnectData(rawUrl) {
    const text = toSafeString(rawUrl);
    if (!/^rustdesk:\/\//i.test(text)) {
      return { id: '', password: '', key: '' };
    }
    try {
      const u = new URL(text);
      const idFromPath = decodeURIComponent(String(u.pathname || '').replace(/^\/+/, '').split('/').filter(Boolean).pop() || '');
      const password = toSafeString(u.searchParams.get('password') || '');
      const key = toSafeString(u.searchParams.get('key') || '');
      return {
        id: normalizeRustDeskId(idFromPath),
        password,
        key
      };
    } catch (_) {
      return { id: '', password: '', key: '' };
    }
  }

  function buildRustDeskWebAutoConnectUrl(baseUrl, data = {}) {
    const base = toSafeString(baseUrl);
    if (!base) return '';
    try {
      const u = new URL(base, window.location.origin);
      const id = normalizeRustDeskId(data.id);
      const password = toSafeString(data.password);
      const key = toSafeString(data.key);
      if (id) {
        const hashQuery = new URLSearchParams();
        if (password) {
          hashQuery.set('password', password);
        }
        if (key) {
          hashQuery.set('key', key);
        }
        const hashQueryText = hashQuery.toString();
        u.hash = `/connection/new/${encodeURIComponent(id)}${hashQueryText ? `?${hashQueryText}` : ''}`;
      }
      if (id) {
        u.searchParams.set('meco_id', id);
        u.searchParams.set('meco_autoconnect', '1');
      }
      if (password) {
        u.searchParams.set('meco_password', password);
      }
      u.searchParams.set('meco_nonce', String(Date.now()));
      return u.toString();
    } catch (_) {
      return base;
    }
  }

  function isSameOriginHttpUrl(rawUrl) {
    const text = toSafeString(rawUrl);
    if (!text) return false;
    try {
      const candidate = new URL(text, window.location.origin);
      if (!/^https?:$/i.test(candidate.protocol)) return false;
      const current = new URL(window.location.href);
      return candidate.origin === current.origin;
    } catch (_) {
      return false;
    }
  }

  function isLoopbackHostname(hostname) {
    const host = toSafeString(hostname).toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  }

  function normalizeRustDeskWebEmbedUrl(rawUrl) {
    const text = toSafeString(rawUrl);
    if (!text) return '';
    try {
      const candidate = new URL(text, window.location.origin);
      const current = new URL(window.location.href);
      if (!isLoopbackHostname(candidate.hostname) || !isLoopbackHostname(current.hostname)) {
        return candidate.toString();
      }
      if (candidate.hostname !== 'localhost') {
        candidate.hostname = 'localhost';
      }
      return candidate.toString();
    } catch (_) {
      return text;
    }
  }

  function canEmbedRustDeskWebUrl(rawUrl) {
    const text = toSafeString(rawUrl);
    if (!text) return false;
    try {
      const candidate = new URL(text, window.location.origin);
      if (!/^https?:$/i.test(candidate.protocol)) return false;
      const current = new URL(window.location.href);
      if (candidate.origin === current.origin) return true;
      if (
        candidate.protocol === current.protocol &&
        candidate.port === current.port &&
        isLoopbackHostname(candidate.hostname) &&
        isLoopbackHostname(current.hostname)
      ) {
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  const WINDOW_MIN_WIDTH = 420;
  const WINDOW_MIN_HEIGHT = 260;
  const WINDOW_SNAP_GAP = 12;

  function getTaskbarReserveHeight() {
    const dock = q('remote-dock');
    if (!dock) return 0;
    try {
      const style = window.getComputedStyle(dock);
      if (style.display === 'none' || style.visibility === 'hidden') return 0;
    } catch (_) {}
    const rect = dock.getBoundingClientRect();
    if (!rect || rect.height <= 0) return 0;
    return Math.max(0, Math.round(rect.height));
  }

  function getWindowWorkspaceBounds() {
    const reserveBottom = getTaskbarReserveHeight();
    const width = Math.max(WINDOW_MIN_WIDTH, Math.round(window.innerWidth));
    const height = Math.max(WINDOW_MIN_HEIGHT, Math.round(window.innerHeight - reserveBottom));
    return {
      left: 0,
      top: 0,
      width,
      height,
      reserveBottom
    };
  }

  function clampRectToWorkspace(rect = {}) {
    const ws = getWindowWorkspaceBounds();
    const safeWidth = Math.max(WINDOW_MIN_WIDTH, Math.round(Number(rect.width) || WINDOW_MIN_WIDTH));
    const safeHeight = Math.max(WINDOW_MIN_HEIGHT, Math.round(Number(rect.height) || WINDOW_MIN_HEIGHT));
    const width = Math.min(safeWidth, ws.width);
    const height = Math.min(safeHeight, ws.height);
    const maxLeft = Math.max(ws.left, ws.left + ws.width - width);
    const maxTop = Math.max(ws.top, ws.top + ws.height - height);
    const left = Math.min(Math.max(ws.left, Math.round(Number(rect.left) || ws.left)), maxLeft);
    const top = Math.min(Math.max(ws.top, Math.round(Number(rect.top) || ws.top)), maxTop);
    return { left, top, width, height };
  }

  function updateWindowLayerBounds() {
    if (!els.windowLayer || !document.body.contains(els.windowLayer)) return;
    const ws = getWindowWorkspaceBounds();
    els.windowLayer.style.left = '0px';
    els.windowLayer.style.top = '0px';
    els.windowLayer.style.right = '0px';
    els.windowLayer.style.bottom = `${ws.reserveBottom}px`;
  }

  function ensureWindowLayer() {
    if (els.windowLayer && document.body.contains(els.windowLayer)) {
      updateWindowLayerBounds();
      return els.windowLayer;
    }
    const layer = document.createElement('div');
    layer.id = 'remote-window-layer';
    layer.className = 'fixed inset-0 z-[72] pointer-events-none';
    document.body.appendChild(layer);
    els.windowLayer = layer;
    updateWindowLayerBounds();
    return layer;
  }

  function ensureDragShield() {
    if (els.dragShield && document.body.contains(els.dragShield)) return els.dragShield;
    const shield = document.createElement('div');
    shield.id = 'remote-window-drag-shield';
    shield.className = 'fixed inset-0 hidden pointer-events-auto z-[2147483000]';
    shield.style.background = 'transparent';
    shield.addEventListener('mouseup', stopDragging);
    document.body.appendChild(shield);
    els.dragShield = shield;
    return shield;
  }

  function setSessionIframesPointerEvents(enabled) {
    const pointerValue = enabled ? 'auto' : 'none';
    Array.from(state.sessions.values()).forEach((session) => {
      if (!session || !session.iframe) return;
      session.iframe.style.pointerEvents = pointerValue;
    });
  }

  function beginDragging(payload) {
    if (!payload || !payload.sessionId) return;
    const cursor = payload.kind === 'resize' ? 'nwse-resize' : 'move';
    state.dragging = payload;
    const shield = ensureDragShield();
    shield.classList.remove('hidden');
    shield.style.cursor = cursor;
    state.prevBodyUserSelect = document.body.style.userSelect || '';
    state.prevBodyCursor = document.body.style.cursor || '';
    document.body.style.userSelect = 'none';
    document.body.style.cursor = cursor;
    setSessionIframesPointerEvents(false);
  }

  function getSessionsByDevice(deviceId) {
    const target = toSafeString(deviceId);
    if (!target) return [];
    return Array.from(state.sessions.values()).filter((session) => toSafeString(session && session.deviceId) === target);
  }

  function getLatestSessionByDevice(deviceId) {
    const sessions = getSessionsByDevice(deviceId);
    if (!sessions.length) return null;
    return sessions
      .slice()
      .sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0))
      .pop() || null;
  }

  function ensureSingleSessionForDevice(deviceId, preferredSessionId = '') {
    const sessions = getSessionsByDevice(deviceId);
    if (!sessions.length) return null;

    let keep = null;
    const preferred = toSafeString(preferredSessionId);
    if (preferred) {
      keep = sessions.find((session) => session && session.id === preferred) || null;
    }
    if (!keep) {
      const candidates = sessions.filter((session) => session && !session.minimized);
      const pool = candidates.length ? candidates : sessions;
      keep = pool
        .slice()
        .sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0))
        .pop() || sessions[0];
    }

    sessions.forEach((session) => {
      if (!session || !keep) return;
      if (session.id === keep.id) return;
      closeSession(session.id);
    });
    return keep;
  }

  function minimizeSession(sessionId) {
    const session = state.sessions.get(sessionId);
    if (!session || !session.el) return;
    session.minimized = true;
    session.el.classList.add('hidden');
    if (state.activeSessionId === session.id) {
      const topRemaining = Array.from(state.sessions.values())
        .filter((item) => item && !item.minimized && item.id !== session.id)
        .sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0))
        .pop();
      state.activeSessionId = topRemaining ? topRemaining.id : '';
    }
    renderDockTabs();
    renderBindDeviceList();
  }

  function renderViewerTabs() {
    if (els.viewerWindow) {
      els.viewerWindow.classList.add('hidden');
      els.viewerWindow.style.display = 'none';
    }
  }

  function updateSessionModeSwitchState(session) {
    if (!session) return;
    const mode = toSafeString(session.mode).toLowerCase() === 'rustdesk' ? 'rustdesk' : 'web';
    const title = `${getDeviceLabel(session.device)} · ${(session.device && session.device.routePath) ? session.device.routePath : ''}`;
    if (session.titleEl) session.titleEl.textContent = title;
    if (session.badgeEl) session.badgeEl.textContent = mode === 'rustdesk' ? 'RUSTDESK' : 'WEB';
    if (session.modeWebBtn) {
      session.modeWebBtn.classList.toggle('bg-white/20', mode === 'web');
      session.modeWebBtn.classList.toggle('text-white', mode === 'web');
      session.modeWebBtn.classList.toggle('text-gray-300', mode !== 'web');
    }
    if (session.modeRustdeskBtn) {
      session.modeRustdeskBtn.classList.toggle('bg-cyan-500/25', mode === 'rustdesk');
      session.modeRustdeskBtn.classList.toggle('text-cyan-200', mode === 'rustdesk');
      session.modeRustdeskBtn.classList.toggle('text-gray-300', mode !== 'rustdesk');
    }
  }

  function bringSessionToFront(session) {
    if (!session || !session.el) return;
    state.zCounter = Math.max(120, Number(state.zCounter) || 120) + 1;
    session.zIndex = state.zCounter;
    session.el.style.zIndex = String(session.zIndex);
    state.activeSessionId = session.id;
  }

  function applySessionRect(session, rect = null) {
    if (!session || !session.el) return;
    if (rect && typeof rect === 'object') {
      session.rect = {
        left: Number(rect.left) || 0,
        top: Number(rect.top) || 0,
        width: Number(rect.width) || WINDOW_MIN_WIDTH,
        height: Number(rect.height) || WINDOW_MIN_HEIGHT
      };
    }
    const r = clampRectToWorkspace(session.rect || { left: 16, top: 16, width: 860, height: 560 });
    session.rect = { ...r };
    session.el.style.left = `${Math.round(r.left)}px`;
    session.el.style.top = `${Math.round(r.top)}px`;
    session.el.style.width = `${Math.round(r.width)}px`;
    session.el.style.height = `${Math.round(r.height)}px`;
  }

  function calcInitialSessionRect() {
    const count = Array.from(state.sessions.values()).length;
    const offset = (count % 7) * 28;
    const ws = getWindowWorkspaceBounds();
    const width = Math.max(680, Math.round(ws.width * 0.66));
    const height = Math.max(420, Math.round(ws.height * 0.62));
    return clampRectToWorkspace({
      left: Math.max(0, Math.round(ws.width * 0.08) + offset),
      top: Math.max(0, Math.round(ws.height * 0.08) + offset),
      width: Math.min(width, Math.max(WINDOW_MIN_WIDTH, ws.width - 20)),
      height: Math.min(height, Math.max(WINDOW_MIN_HEIGHT, ws.height - 20))
    });
  }

  function normalizeAndEmbedWebUrl(rawUrl) {
    const text = normalizeRemoteLaunchUrl(rawUrl);
    if (!text || /^rustdesk:\/\//i.test(text)) return text;
    try {
      const u = new URL(text, window.location.origin);
      if (!/^https?:$/i.test(u.protocol)) return text;
      u.searchParams.set('mecoEmbed', '1');
      u.searchParams.set('meco_window', '1');
      u.searchParams.set('meco_nonce', String(Date.now()));
      return u.toString();
    } catch (_) {
      return text;
    }
  }

  function collectSnapTargets(excludeSessionId = '') {
    const targets = [];
    for (const session of state.sessions.values()) {
      if (!session || !session.el) continue;
      if (session.id === excludeSessionId) continue;
      if (session.minimized) continue;
      const r = session.rect || null;
      if (!r) continue;
      targets.push({ left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height });
    }
    return targets;
  }

  function snapMoveRect(rect, excludeSessionId = '') {
    const next = { ...rect };
    const ws = getWindowWorkspaceBounds();
    next.left = Math.min(Math.max(ws.left, next.left), Math.max(ws.left, ws.width - next.width));
    next.top = Math.min(Math.max(ws.top, next.top), Math.max(ws.top, ws.height - next.height));

    const targets = collectSnapTargets(excludeSessionId);
    const edgeTargetsX = [ws.left, ws.left + ws.width];
    const edgeTargetsY = [ws.top, ws.top + ws.height];
    for (const t of targets) {
      edgeTargetsX.push(t.left, t.right);
      edgeTargetsY.push(t.top, t.bottom);
    }

    for (const tx of edgeTargetsX) {
      if (Math.abs(next.left - tx) <= WINDOW_SNAP_GAP) next.left = tx;
      if (Math.abs((next.left + next.width) - tx) <= WINDOW_SNAP_GAP) next.left = tx - next.width;
    }
    for (const ty of edgeTargetsY) {
      if (Math.abs(next.top - ty) <= WINDOW_SNAP_GAP) next.top = ty;
      if (Math.abs((next.top + next.height) - ty) <= WINDOW_SNAP_GAP) next.top = ty - next.height;
    }

    next.left = Math.min(Math.max(ws.left, next.left), Math.max(ws.left, ws.width - next.width));
    next.top = Math.min(Math.max(ws.top, next.top), Math.max(ws.top, ws.height - next.height));
    return next;
  }

  function snapResizeRect(rect, excludeSessionId = '') {
    const next = { ...rect };
    const ws = getWindowWorkspaceBounds();
    next.width = Math.max(WINDOW_MIN_WIDTH, next.width);
    next.height = Math.max(WINDOW_MIN_HEIGHT, next.height);

    const targets = collectSnapTargets(excludeSessionId);
    const edgeTargetsX = [ws.left + ws.width];
    const edgeTargetsY = [ws.top + ws.height];
    for (const t of targets) {
      edgeTargetsX.push(t.left, t.right);
      edgeTargetsY.push(t.top, t.bottom);
    }

    let right = next.left + next.width;
    let bottom = next.top + next.height;
    for (const tx of edgeTargetsX) {
      if (Math.abs(right - tx) <= WINDOW_SNAP_GAP) right = tx;
    }
    for (const ty of edgeTargetsY) {
      if (Math.abs(bottom - ty) <= WINDOW_SNAP_GAP) bottom = ty;
    }

    next.width = Math.max(WINDOW_MIN_WIDTH, right - next.left);
    next.height = Math.max(WINDOW_MIN_HEIGHT, bottom - next.top);
    next.width = Math.min(next.width, Math.max(WINDOW_MIN_WIDTH, ws.width - next.left));
    next.height = Math.min(next.height, Math.max(WINDOW_MIN_HEIGHT, ws.height - next.top));
    return clampRectToWorkspace(next);
  }

  function activateSession(sessionId) {
    const session = state.sessions.get(sessionId);
    if (!session || !session.el) return;
    session.minimized = false;
    session.el.classList.remove('hidden');
    bringSessionToFront(session);
    renderDockTabs();
    renderBindDeviceList();
  }

  function closeSession(sessionId) {
    const session = state.sessions.get(sessionId);
    if (!session) return;
    if (state.dragging && state.dragging.sessionId === sessionId) {
      stopDragging();
    }
    try {
      if (session.iframe) session.iframe.src = 'about:blank';
    } catch (_) {}
    try {
      if (session.el && session.el.parentNode) {
        session.el.parentNode.removeChild(session.el);
      }
    } catch (_) {}
    state.sessions.delete(sessionId);
    if (state.activeSessionId === sessionId) {
      const topRemaining = Array.from(state.sessions.values())
        .filter((item) => item && !item.minimized)
        .sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0))
        .pop();
      state.activeSessionId = topRemaining ? topRemaining.id : '';
    }
    renderDockTabs();
    renderBindDeviceList();
  }

  function closeSessionsByDevice(deviceId) {
    const sessions = getSessionsByDevice(deviceId);
    for (const session of sessions) {
      closeSession(session.id);
    }
  }

  function createSession(device, launch) {
    ensureWindowLayer();

    state.windowSeq = (Number(state.windowSeq) || 0) + 1;
    const sessionId = `remote-session-${Date.now()}-${state.windowSeq}`;
    const rect = calcInitialSessionRect();

    const win = document.createElement('div');
    win.className = 'fixed rounded-none border border-white/15 bg-[#060606] shadow-2xl overflow-hidden flex flex-col pointer-events-auto';
    win.dataset.sessionId = sessionId;

    const header = document.createElement('div');
    header.className = 'h-10 px-3 border-b border-white/10 bg-black/75 cursor-move flex items-center justify-between gap-2 select-none shrink-0';
    header.innerHTML = `
      <div class="min-w-0 flex items-center gap-2">
        <span class="material-icons-round text-primary text-base">desktop_windows</span>
        <span data-role="title" class="text-sm text-white font-medium truncate"></span>
        <span data-role="mode-badge" class="text-[10px] px-2 py-0.5 rounded border border-white/20 text-gray-300">WEB</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="h-7 rounded border border-white/20 bg-white/5 p-0.5 flex items-center gap-0.5">
          <button type="button" data-action="mode-web" class="h-5 px-2 rounded text-[10px] text-gray-300">Web</button>
          <button type="button" data-action="mode-rustdesk" class="h-5 px-2 rounded text-[10px] text-gray-300">RustDesk</button>
        </div>
        <button type="button" data-action="min" class="w-7 h-7 rounded hover:bg-white/10 text-gray-300" title="最小化"><span class="material-icons-round text-[17px]">remove</span></button>
        <button type="button" data-action="full" class="w-7 h-7 rounded hover:bg-white/10 text-gray-300" title="全屏"><span class="material-icons-round text-[17px]">fullscreen</span></button>
        <button type="button" data-action="close" class="w-7 h-7 rounded hover:bg-red-500/20 text-gray-300 hover:text-red-300" title="关闭"><span class="material-icons-round text-[17px]">close</span></button>
      </div>
    `;

    const body = document.createElement('div');
    body.className = 'relative flex-1 bg-black';
    const iframe = document.createElement('iframe');
    iframe.className = 'absolute inset-0 w-full h-full border-0 bg-black';
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.dataset.deviceId = toSafeString(device && device.id);
    iframe.dataset.mode = toSafeString(launch && launch.sessionMode);
    iframe.src = toSafeString(launch && launch.url);
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'absolute right-0 bottom-0 w-5 h-5 cursor-nwse-resize';
    resizeHandle.dataset.action = 'resize';
    resizeHandle.innerHTML = '<span class="absolute right-1 bottom-1 block w-3 h-3 border-r-2 border-b-2 border-white/35"></span>';
    body.appendChild(iframe);
    body.appendChild(resizeHandle);

    win.appendChild(header);
    win.appendChild(body);
    els.windowLayer.appendChild(win);

    const session = {
      id: sessionId,
      deviceId: toSafeString(device && device.id),
      device,
      mode: toSafeString(launch && launch.sessionMode) || 'web',
      url: toSafeString(launch && launch.url),
      launch: launch || {},
      iframe,
      el: win,
      headerEl: header,
      titleEl: header.querySelector('[data-role="title"]'),
      badgeEl: header.querySelector('[data-role="mode-badge"]'),
      modeWebBtn: header.querySelector('[data-action="mode-web"]'),
      modeRustdeskBtn: header.querySelector('[data-action="mode-rustdesk"]'),
      fullBtnIcon: header.querySelector('[data-action="full"] .material-icons-round'),
      rect,
      fullscreen: false,
      prevRect: null,
      minimized: false,
      switching: false
    };

    header.addEventListener('mousedown', (event) => {
      const target = event.target;
      if (target && target.closest('button')) return;
      if (session.fullscreen) return;
      bringSessionToFront(session);
      beginDragging({
        kind: 'move',
        sessionId: session.id,
        startX: event.clientX,
        startY: event.clientY,
        left: session.rect.left,
        top: session.rect.top
      });
      event.preventDefault();
    });

    win.addEventListener('mousedown', () => {
      bringSessionToFront(session);
    });

    const modeWebBtn = session.modeWebBtn;
    if (modeWebBtn) {
      modeWebBtn.addEventListener('click', () => {
        switchSessionMode(session.id, 'web').catch((e) => {
          alert(`切换到 Web 失败: ${e.message || e}`);
        });
      });
    }
    const modeRustdeskBtn = session.modeRustdeskBtn;
    if (modeRustdeskBtn) {
      modeRustdeskBtn.addEventListener('click', () => {
        switchSessionMode(session.id, 'rustdesk').catch((e) => {
          alert(`切换到 RustDesk 失败: ${e.message || e}`);
        });
      });
    }
    const minBtn = header.querySelector('[data-action="min"]');
    if (minBtn) {
      minBtn.addEventListener('click', () => {
        minimizeSession(session.id);
      });
    }
    const fullBtn = header.querySelector('[data-action="full"]');
    if (fullBtn) {
      fullBtn.addEventListener('click', () => {
        toggleSessionFullscreen(session.id);
      });
    }
    const closeBtn = header.querySelector('[data-action="close"]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        closeSession(session.id);
      });
    }
    resizeHandle.addEventListener('mousedown', (event) => {
      if (session.fullscreen) return;
      bringSessionToFront(session);
      beginDragging({
        kind: 'resize',
        sessionId: session.id,
        startX: event.clientX,
        startY: event.clientY,
        width: session.rect.width,
        height: session.rect.height
      });
      event.preventDefault();
      event.stopPropagation();
    });

    state.sessions.set(session.id, session);
    applySessionRect(session, rect);
    updateSessionModeSwitchState(session);
    bringSessionToFront(session);
    renderDockTabs();
    renderBindDeviceList();
    return session;
  }

  async function resolveRemoteLaunch(deviceId, payload = {}, fallbackMessage = '解析远控地址失败') {
    const res = await fetch(`/api/remote/devices/${encodeURIComponent(deviceId)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    return readJson(res, fallbackMessage);
  }

  async function resolveWebLaunch(device) {
    const deviceId = toSafeString(device && device.id);
    const lanReachable = await probeLanReachable(device && device.lanUrl);
    if (lanReachable && toSafeString(device && device.lanUrl)) {
      try {
        const body = await resolveRemoteLaunch(deviceId, { preferLan: true, lanReachable: true, forceMode: 'lan' });
        const launch = body && body.launch ? body.launch : {};
        if (toSafeString(launch.url)) {
          return { ...launch, sessionMode: 'web', url: normalizeAndEmbedWebUrl(launch.url) };
        }
      } catch (_) {}
    }
    try {
      const body = await resolveRemoteLaunch(deviceId, { preferLan: true, lanReachable: false, forceMode: 'public' });
      const launch = body && body.launch ? body.launch : {};
      if (toSafeString(launch.url)) {
        return { ...launch, sessionMode: 'web', url: normalizeAndEmbedWebUrl(launch.url) };
      }
    } catch (_) {}

    const body = await resolveRemoteLaunch(deviceId, { preferLan: true, lanReachable });
    const launch = body && body.launch ? body.launch : {};
    if (!toSafeString(launch.url)) throw new Error('没有可用的 Web 连接地址');
    if ((launch.mode || '') === 'rustdesk' || /^rustdesk:\/\//i.test(toSafeString(launch.url))) {
      throw new Error('当前设备没有可用的 Web 地址');
    }
    return { ...launch, sessionMode: 'web', url: normalizeAndEmbedWebUrl(launch.url) };
  }

  async function resolveRustdeskLaunch(device) {
    const deviceId = toSafeString(device && device.id);
    let body = null;
    try {
      body = await resolveRemoteLaunch(deviceId, { preferLan: true, forceMode: 'rustdesk' }, '当前设备未配置可用的 RustDesk 连接');
    } catch (e) {
      const detail = toSafeString(e && e.message);
      throw new Error(detail ? `当前设备未配置可用的 RustDesk 连接: ${detail}` : '当前设备未配置可用的 RustDesk 连接');
    }
    const launch = body && body.launch ? body.launch : {};
    const launchUrl = normalizeRemoteLaunchUrl(launch.url || '');
    if (!launchUrl) throw new Error('没有可用的 RustDesk 连接地址');

    const rustdeskWebBaseUrl = normalizeRustDeskWebEmbedUrl(
      normalizeRemoteLaunchUrl(state.remoteConfig.rustdeskWebBaseUrl || '')
    );
    if (!rustdeskWebBaseUrl || !canEmbedRustDeskWebUrl(rustdeskWebBaseUrl)) {
      throw new Error('RustDesk Web 嵌入地址不可用');
    }

    const parsed = parseRustDeskConnectData(launchUrl);
    const fallbackId = normalizeRustDeskId(
      (launch && launch.device && (launch.device.rustdeskId || launch.device.meshNodeId))
      || (device && (device.rustdeskId || device.meshNodeId))
      || ''
    );
    const fallbackPassword = toSafeString(
      (launch && launch.device && launch.device.password)
      || (device && device.password)
      || ''
    );
    const embedUrl = buildRustDeskWebAutoConnectUrl(rustdeskWebBaseUrl, {
      id: parsed.id || fallbackId,
      password: parsed.password || fallbackPassword,
      key: parsed.key || ''
    });
    return { ...launch, sessionMode: 'rustdesk', url: embedUrl };
  }

  async function switchSessionMode(sessionId, targetMode) {
    const session = state.sessions.get(sessionId);
    if (!session) return;
    const nextMode = targetMode === 'rustdesk' ? 'rustdesk' : 'web';
    if (session.mode === nextMode) {
      activateSession(session.id);
      return;
    }
    if (session.switching) return;
    session.switching = true;
    try {
      const device = getDeviceById(session.deviceId) || session.device;
      if (!device || !device.id) throw new Error('设备不存在');
      const launch = nextMode === 'rustdesk'
        ? await resolveRustdeskLaunch(device)
        : await resolveWebLaunch(device);
      session.mode = nextMode;
      session.device = device;
      session.launch = launch;
      session.url = toSafeString(launch.url);
      if (session.iframe) {
        session.iframe.dataset.mode = nextMode;
        session.iframe.src = session.url;
      }
      updateSessionModeSwitchState(session);
      activateSession(session.id);
    } finally {
      session.switching = false;
    }
  }

  async function openDeviceSession(deviceId, options = {}) {
    if (!deviceId) return;
    const forceModeRaw = toSafeString(options.forceMode).toLowerCase();
    const targetMode = forceModeRaw === 'rustdesk' ? 'rustdesk' : 'web';

    const device = getDeviceById(deviceId);
    if (!device) {
      alert('设备不存在，列表将刷新');
      await loadDevices();
      return;
    }

    let session = ensureSingleSessionForDevice(deviceId);
    if (session) {
      if (session.minimized) {
        activateSession(session.id);
      }
      if (session.mode !== targetMode) {
        await switchSessionMode(session.id, targetMode);
      } else {
        activateSession(session.id);
      }
      return;
    }

    const launch = targetMode === 'rustdesk'
      ? await resolveRustdeskLaunch(device)
      : await resolveWebLaunch(device);
    session = createSession(device, launch);
    activateSession(session.id);
  }

  async function tryAutoOpenRemoteRoute() {
    if (window.self !== window.top) return;
    const routePath = normalizeRoutePath(state.pendingRemoteRoute || '');
    const mode = toSafeString(state.pendingRemoteMode || '').toLowerCase();
    if (!routePath || routePath === '/') return;

    clearRemoteRouteFromUrl();

    const device = state.devices.find((item) => normalizeRoutePath(item && item.routePath) === routePath);
    if (!device || !device.id) {
      console.warn('[RemoteDock] remoteRoute not found in bound devices:', routePath);
      return;
    }

    try {
      await openDeviceSession(device.id, { forceMode: mode === 'rustdesk' ? 'rustdesk' : 'web' });
    } catch (e) {
      console.warn('[RemoteDock] auto-open by remoteRoute failed', e);
    }
  }

  function toggleSessionFullscreen(sessionId) {
    const session = state.sessions.get(sessionId);
    if (!session) return;
    const ws = getWindowWorkspaceBounds();
    if (!session.fullscreen) {
      session.prevRect = { ...session.rect };
      session.rect = {
        left: ws.left,
        top: ws.top,
        width: ws.width,
        height: ws.height
      };
      session.fullscreen = true;
    } else {
      session.rect = clampRectToWorkspace(session.prevRect || calcInitialSessionRect());
      session.prevRect = null;
      session.fullscreen = false;
    }
    if (session.fullBtnIcon) {
      session.fullBtnIcon.textContent = session.fullscreen ? 'fullscreen_exit' : 'fullscreen';
    }
    applySessionRect(session);
  }

  function ensureViewerRect() {}
  function applyViewerRect() {}
  function showViewerWindow() {}
  function hideViewerWindow() {}
  function setViewerModeBadge() {}
  function setViewerTitle() {}

  function onDragging(event) {
    if (!state.dragging) return;
    const drag = state.dragging;
    const session = state.sessions.get(drag.sessionId);
    if (!session) {
      stopDragging();
      return;
    }
    if (drag.kind === 'move') {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const rect = snapMoveRect({
        left: drag.left + dx,
        top: drag.top + dy,
        width: session.rect.width,
        height: session.rect.height
      }, session.id);
      applySessionRect(session, rect);
      return;
    }
    if (drag.kind === 'resize') {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const rect = snapResizeRect({
        left: session.rect.left,
        top: session.rect.top,
        width: drag.width + dx,
        height: drag.height + dy
      }, session.id);
      applySessionRect(session, rect);
    }
  }

  function stopDragging() {
    if (!state.dragging) return;
    state.dragging = null;
    const shield = els.dragShield && document.body.contains(els.dragShield)
      ? els.dragShield
      : q('remote-window-drag-shield');
    if (shield) {
      shield.classList.add('hidden');
    }
    setSessionIframesPointerEvents(true);
    document.body.style.userSelect = state.prevBodyUserSelect || '';
    document.body.style.cursor = state.prevBodyCursor || '';
    state.prevBodyUserSelect = '';
    state.prevBodyCursor = '';
  }

  async function onDockTabsClick(event) {
    const btn = event.target && event.target.closest('button[data-action="open"][data-device-id]');
    if (!btn) return;
    const deviceId = btn.getAttribute('data-device-id') || '';
    if (!deviceId) return;

    try {
      const existing = ensureSingleSessionForDevice(deviceId);
      if (!existing) {
        await openDeviceSession(deviceId, { forceMode: 'web' });
        return;
      }
      if (existing.minimized) {
        activateSession(existing.id);
        return;
      }
      if (state.activeSessionId === existing.id) {
        minimizeSession(existing.id);
        return;
      }
      activateSession(existing.id);
    } catch (e) {
      alert(`打开远控失败: ${e.message || e}`);
    }
  }

  async function onBindListClick(event) {
    const actionNode = event.target && event.target.closest('[data-action]');
    const container = event.target && event.target.closest('[data-device-id]');
    if (!actionNode || !container) return;

    const action = actionNode.getAttribute('data-action') || '';
    const deviceId = container.getAttribute('data-device-id') || '';
    if (!action || !deviceId) return;

    try {
      if (action === 'open') {
        await openDeviceSession(deviceId);
        closeBindModal();
        return;
      }
      if (action === 'open-rustdesk') {
        await openDeviceSession(deviceId, { forceMode: 'rustdesk' });
        closeBindModal();
        return;
      }
      if (action === 'copy-code') {
        await copyControlCode(deviceId);
        return;
      }
      if (action === 'delete') {
        await deleteBinding(deviceId);
      }
    } catch (e) {
      alert(e.message || '操作失败');
    }
  }

  function onViewerTabsClick(event) {
    const closeNode = event.target && event.target.closest('[data-action="close-session"]');
    if (closeNode) {
      const id = closeNode.getAttribute('data-device-id') || '';
      if (id) closeSession(id);
      return;
    }

    const activateNode = event.target && event.target.closest('[data-action="activate-session"]');
    if (activateNode) {
      const id = activateNode.getAttribute('data-device-id') || '';
      if (id) activateSession(id);
    }
  }

  function bindEvents() {
    if (els.addBtn) {
      els.addBtn.addEventListener('click', openBindModal);
    }
    if (els.bindCloseBtn) {
      els.bindCloseBtn.addEventListener('click', closeBindModal);
    }
    if (els.bindModalBackdrop) {
      els.bindModalBackdrop.addEventListener('click', closeBindModal);
    }
    if (els.bindTabImportBtn) {
      els.bindTabImportBtn.addEventListener('click', () => setBindTab('import'));
    }
    if (els.bindTabLocalBtn) {
      els.bindTabLocalBtn.addEventListener('click', () => setBindTab('local'));
    }
    if (els.createBtn) {
      els.createBtn.addEventListener('click', createBinding);
    }
    if (els.importBtn) {
      els.importBtn.addEventListener('click', importBindingCode);
    }
    if (els.cloudflareBtn) {
      els.cloudflareBtn.addEventListener('click', startCloudflareGuide);
    }
    if (els.rustdeskReadBtn) {
      els.rustdeskReadBtn.addEventListener('click', async () => {
        try {
          setRustDeskReadLoading(true);
          await readLocalRustDeskInfo({ launchIfNeeded: true, silent: false });
        } catch (e) {
          showStatus(els.rustdeskReadStatus, e.message || '读取失败', true);
        } finally {
          setRustDeskReadLoading(false);
        }
      });
    }
    if (els.cfHostInput) {
      els.cfHostInput.addEventListener('input', updatePublicPreview);
      els.cfHostInput.addEventListener('blur', () => {
        els.cfHostInput.value = normalizePublicHost(els.cfHostInput.value);
        updatePublicPreview();
      });
    }
    if (els.cfPrefixInput) {
      els.cfPrefixInput.addEventListener('input', updatePublicPreview);
      els.cfPrefixInput.addEventListener('blur', () => {
        els.cfPrefixInput.value = normalizePathPrefix(els.cfPrefixInput.value);
        updatePublicPreview();
      });
    }
    if (els.cfTokenInput) {
      els.cfTokenInput.addEventListener('blur', () => {
        els.cfTokenInput.value = extractTunnelToken(els.cfTokenInput.value);
      });
    }
    if (els.ownerInput) {
      els.ownerInput.addEventListener('input', () => {
        updatePublicPreview();
        persistLocalProfileFromForm();
        refreshLocalBindingMode();
        renderBindDeviceList();
        renderDockTabs();
      });
    }
    if (els.deviceInput) {
      els.deviceInput.addEventListener('input', () => {
        updatePublicPreview();
        persistLocalProfileFromForm();
        refreshLocalBindingMode();
        renderBindDeviceList();
        renderDockTabs();
      });
    }
    if (els.noteInput) {
      els.noteInput.addEventListener('input', () => {
        persistLocalProfileFromForm();
      });
    }
    if (els.lanInput) {
      els.lanInput.addEventListener('input', () => {
        persistLocalProfileFromForm();
        renderBindDeviceList();
        renderDockTabs();
      });
      els.lanInput.addEventListener('blur', () => {
        els.lanInput.value = toSafeString(els.lanInput.value);
        persistLocalProfileFromForm();
      });
    }
    if (els.rustdeskIdInput) {
      els.rustdeskIdInput.addEventListener('blur', () => {
        els.rustdeskIdInput.value = normalizeRustDeskId(els.rustdeskIdInput.value);
        persistLocalProfileFromForm();
        refreshLocalBindingMode();
        renderBindDeviceList();
        renderDockTabs();
      });
      els.rustdeskIdInput.addEventListener('input', () => {
        persistLocalProfileFromForm();
        refreshLocalBindingMode();
        renderBindDeviceList();
        renderDockTabs();
      });
    }
    if (els.rustdeskPasswordView && typeof els.rustdeskPasswordView.value === 'string') {
      els.rustdeskPasswordView.addEventListener('input', () => {
        state.rustdeskPasswordDirty = true;
        persistLocalProfileFromForm();
      });
      els.rustdeskPasswordView.addEventListener('blur', () => {
        els.rustdeskPasswordView.value = toSafeString(els.rustdeskPasswordView.value);
        persistLocalProfileFromForm();
      });
    }
    if (els.dockTabs) {
      els.dockTabs.addEventListener('click', onDockTabsClick);
    }
    if (els.bindDeviceList) {
      els.bindDeviceList.addEventListener('click', onBindListClick);
    }

    window.addEventListener('mousemove', onDragging);
    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('blur', stopDragging);
    window.addEventListener('resize', () => {
      updateWindowLayerBounds();
      Array.from(state.sessions.values()).forEach((session) => {
        if (!session || !session.el) return;
        if (session.fullscreen) {
          const ws = getWindowWorkspaceBounds();
          session.rect = {
            left: ws.left,
            top: ws.top,
            width: ws.width,
            height: ws.height
          };
          applySessionRect(session);
          return;
        }
        const bounded = clampRectToWorkspace(snapMoveRect({
          left: session.rect.left,
          top: session.rect.top,
          width: session.rect.width,
          height: session.rect.height
        }, session.id));
        applySessionRect(session, bounded);
      });
    });
  }

  function initElements() {
    els.addBtn = q('remote-dock-add-btn');
    els.dockTabs = q('remote-dock-tabs');

    els.bindModal = q('remote-bind-modal');
    els.bindModalBackdrop = els.bindModal ? els.bindModal.querySelector('[data-role="backdrop"]') : null;
    els.bindCloseBtn = q('remote-bind-close-btn');
    els.bindTabImportBtn = q('remote-bind-tab-import-btn');
    els.bindTabLocalBtn = q('remote-bind-tab-local-btn');
    els.bindPanelImport = q('remote-bind-panel-import');
    els.bindPanelLocal = q('remote-bind-panel-local');

    els.ownerInput = q('remote-bind-owner');
    els.deviceInput = q('remote-bind-device');
    els.noteInput = q('remote-bind-note');
    els.lanInput = q('remote-bind-lan-url');
    els.rustdeskIdInput = q('remote-bind-rustdesk-id');
    els.rustdeskReadBtn = q('remote-bind-rustdesk-read-btn');
    els.rustdeskReadStatus = q('remote-bind-rustdesk-read-status');
    els.rustdeskPasswordView = q('remote-bind-rustdesk-password-view');
    els.cfHostInput = q('remote-bind-cf-host');
    els.cfPrefixInput = q('remote-bind-cf-prefix');
    els.cfTokenInput = q('remote-bind-cf-token');
    els.publicPreviewInput = q('remote-bind-public-preview');
    els.cloudflareBtn = q('remote-bind-cloudflare-btn');
    els.cloudflareStatus = q('remote-bind-cloudflare-status');

    els.createBtn = q('remote-bind-create-btn');
    els.createStatus = q('remote-bind-create-status');
    els.importInput = q('remote-bind-import-code');
    els.importBtn = q('remote-bind-import-btn');
    els.importStatus = q('remote-bind-import-status');
    els.bindDeviceList = q('remote-bind-device-list');

    els.viewerWindow = q('remote-viewer-window');
    els.viewerHeader = q('remote-viewer-header');
    els.viewerTitle = q('remote-viewer-title');
    els.viewerModeBadge = q('remote-viewer-mode-badge');
    els.viewerTabs = q('remote-viewer-tabs');
    els.viewerBody = q('remote-viewer-body');
    els.viewerMinBtn = q('remote-viewer-min-btn');
    els.viewerFullBtn = q('remote-viewer-full-btn');
    els.viewerFullBtnIcon = els.viewerFullBtn ? els.viewerFullBtn.querySelector('.material-icons-round') : null;
    els.viewerCloseBtn = q('remote-viewer-close-btn');
  }

  async function init() {
    if (isEmbeddedMecoWindow()) {
      hideRemoteDockUiForEmbed();
      return;
    }
    initElements();
    if (!els.dockTabs) return;
    state.localProfile = readLocalProfileCache();
    applyLocalProfileToForm({ keepUserInput: false });
    setBindTab('import');
    state.pendingRemoteRoute = getRemoteRouteFromUrl();
    state.pendingRemoteMode = getRemoteModeFromUrl();
    bindEvents();
    ensureViewerRect();
    applyViewerRect();
    renderViewerTabs();

    try {
      await loadBootstrap();
      await loadRemoteConfig();
      await loadDevices();
      try {
        await readLocalRustDeskInfo({ launchIfNeeded: false, silent: true });
      } catch (_) {}
      await tryAutoOpenRemoteRoute();
    } catch (e) {
      console.warn('[RemoteDock] init failed', e);
      if (els.dockTabs) {
        els.dockTabs.innerHTML = `<span class="text-xs text-red-400 px-2">远控模块初始化失败: ${escapeHtml(e.message || String(e))}</span>`;
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  window.openRemoteBindModal = openBindModal;
})();
