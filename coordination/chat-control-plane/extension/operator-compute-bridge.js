(() => {
  'use strict';

  const COMPUTE_BRIDGE_STORAGE_KEY = 'a2ComputeBridgeConfigV1';
  const DEFAULT_COMPUTE_BRIDGE_URL = '';

  async function loadConfig() {
    try {
      const stored = await chrome.storage.local.get(COMPUTE_BRIDGE_STORAGE_KEY);
      return stored[COMPUTE_BRIDGE_STORAGE_KEY] || null;
    } catch (_) { return null; }
  }

  async function saveConfig(config) {
    try { await chrome.storage.local.set({ [COMPUTE_BRIDGE_STORAGE_KEY]: config }); } catch (_) {}
  }

  async function discover() {
    const config = await loadConfig();
    if (!config?.url || !config?.token) return null;
    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Authorization': `Bearer ${config.token}`
        },
        body: JSON.stringify({ method: 'runtime.health', params: {}, id: 'discover' })
      });
      if (!response.ok) return null;
      return config;
    } catch (_) { return null; }
  }

  async function call(method, params = {}) {
    const config = await discover();
    if (!config) throw new Error('compute_bridge_unavailable');
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Authorization': `Bearer ${config.token}`
      },
      body: JSON.stringify({ method, params, id: crypto.randomUUID() })
    });
    if (!response.ok) throw new Error(`compute_bridge_http_${response.status}`);
    const body = await response.json();
    if (!body.ok) throw new Error(body.error || 'compute_bridge_call_failed');
    return body.result;
  }

  async function isReady() {
    return (await discover()) !== null;
  }

  async function configure(url, token) {
    await saveConfig({ url: String(url || '').trim(), token: String(token || '').trim() });
    return await isReady();
  }

  globalThis.A2_OPERATOR_COMPUTE_BRIDGE = {
    discover,
    call,
    isReady,
    configure
  };
})();