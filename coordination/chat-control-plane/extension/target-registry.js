(() => {
  "use strict";

  const REGISTRY_KEY = "a2TargetRegistryV1";
  const BINDINGS_KEY = "a2TargetBindingsV1";
  const SESSION_NONCE_KEY = "a2TargetRegistrySessionNonceV1";
  const SCHEMA = "metaengine.a2-browser-operator.target-registry.v1";
  const BINDING_SCHEMA = "metaengine.a2-browser-operator.target-bindings.v1";
  const TARGET_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,95}$/;
  const STATUSES = new Set(["UNBOUND", "ACTIVE", "IDLE", "GENERATING", "STALLED", "EXHAUSTED", "ROLLOVER", "RETIRED"]);
  const PLATFORMS = Object.freeze({
    CHATGPT: Object.freeze({ provider: "OPENAI", surface: "WEB_CHAT", configKey: "chatgptUrl", seedId: "gpt_primary" }),
    GLM_ZAI: Object.freeze({ provider: "ZAI", surface: "WEB_CHAT", configKey: "zaiUrl", seedId: "glm_primary" })
  });

  let mutation = Promise.resolve();
  let suppressLegacyStorageSync = false;

  const nowIso = () => new Date().toISOString();
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

  function normUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.protocol !== "https:") return "";
      url.hash = "";
      url.search = "";
      url.pathname = url.pathname.replace(/\/+$/, "") || "/";
      return `${url.origin}${url.pathname}`;
    } catch (_) { return ""; }
  }

  function platformOf(value) {
    try {
      const host = new URL(String(value || "")).hostname.toLowerCase();
      if (host === "chatgpt.com" || host === "chat.openai.com") return "CHATGPT";
      if (host === "chat.z.ai") return "GLM_ZAI";
    } catch (_) {}
    return "UNKNOWN";
  }

  function normalizeTargetId(value) {
    const id = String(value || "").trim().toLowerCase();
    if (!TARGET_ID_RE.test(id)) throw new Error("target_id_invalid");
    return id;
  }

  function normalizeRole(value) {
    const role = String(value || "WORKER").trim().toUpperCase().replace(/[^A-Z0-9_:-]+/g, "_").slice(0, 64);
    if (!role) throw new Error("target_role_invalid");
    return role;
  }

  function normalizeStatus(value, hasUrl) {
    const status = String(value || (hasUrl ? "ACTIVE" : "UNBOUND")).trim().toUpperCase();
    if (!STATUSES.has(status)) throw new Error("target_status_invalid");
    if (!hasUrl && status !== "UNBOUND" && status !== "RETIRED") return "UNBOUND";
    return status;
  }

  function assertPlatformUrl(platform, url) {
    if (!PLATFORMS[platform]) throw new Error("target_platform_invalid");
    if (url && platformOf(url) !== platform) throw new Error("target_platform_url_mismatch");
  }

  function canonicalTarget(raw, previous = null) {
    const platform = String(raw?.platform || previous?.platform || "").toUpperCase();
    const spec = PLATFORMS[platform];
    if (!spec) throw new Error("target_platform_invalid");
    const conversationUrl = normUrl(raw?.conversation_url ?? raw?.conversationUrl ?? previous?.conversation_url ?? "");
    assertPlatformUrl(platform, conversationUrl);
    const createdAt = String(previous?.created_at || raw?.created_at || nowIso());
    const epochRaw = Number(raw?.conversation_epoch ?? raw?.conversationEpoch ?? previous?.conversation_epoch ?? (conversationUrl ? 1 : 0));
    const epoch = Number.isInteger(epochRaw) && epochRaw >= 0 ? epochRaw : 0;
    const legacyAlias = raw?.legacy_alias == null && previous?.legacy_alias == null
      ? null
      : String(raw?.legacy_alias ?? previous?.legacy_alias ?? "").toUpperCase() || null;
    if (legacyAlias && !PLATFORMS[legacyAlias]) throw new Error("target_legacy_alias_invalid");
    return {
      schema: "metaengine.a2-browser-operator.target.v1",
      target_id: normalizeTargetId(raw?.target_id || previous?.target_id),
      provider: spec.provider,
      platform,
      surface: spec.surface,
      role: normalizeRole(raw?.role ?? previous?.role ?? "WORKER"),
      legacy_alias: legacyAlias,
      conversation_epoch: epoch,
      conversation_url: conversationUrl || null,
      status: normalizeStatus(raw?.status ?? previous?.status, Boolean(conversationUrl)),
      created_at: createdAt,
      updated_at: String(raw?.updated_at || previous?.updated_at || nowIso())
    };
  }

  function emptyRegistry() {
    return { schema: SCHEMA, revision: 0, targets: [], updated_at: nowIso() };
  }

  function validateRegistry(registry) {
    const ids = new Set(), aliases = new Set(), urls = new Set();
    const targets = [];
    for (const raw of Array.isArray(registry?.targets) ? registry.targets : []) {
      const target = canonicalTarget(raw, raw);
      if (ids.has(target.target_id)) throw new Error("target_registry_duplicate_id");
      ids.add(target.target_id);
      if (target.legacy_alias) {
        if (aliases.has(target.legacy_alias)) throw new Error("target_registry_duplicate_legacy_alias");
        aliases.add(target.legacy_alias);
      }
      if (target.status !== "RETIRED" && target.conversation_url) {
        if (urls.has(target.conversation_url)) throw new Error("target_registry_duplicate_active_url");
        urls.add(target.conversation_url);
      }
      targets.push(target);
    }
    return {
      schema: SCHEMA,
      revision: Math.max(0, Number(registry?.revision) || 0),
      targets,
      updated_at: String(registry?.updated_at || nowIso())
    };
  }

  async function loadRegistry() {
    const stored = await chrome.storage.local.get(REGISTRY_KEY);
    if (!stored[REGISTRY_KEY]) return emptyRegistry();
    return validateRegistry(stored[REGISTRY_KEY]);
  }

  async function persistRegistry(registry) {
    const clean = validateRegistry({ ...registry, revision: (Number(registry?.revision) || 0) + 1, updated_at: nowIso() });
    await chrome.storage.local.set({ [REGISTRY_KEY]: clean });
    return clean;
  }

  function mutate(operation) {
    const run = mutation.then(operation, operation);
    mutation = run.catch(() => {});
    return run;
  }

  async function ensureSessionNonce() {
    const stored = await chrome.storage.session.get(SESSION_NONCE_KEY);
    if (stored[SESSION_NONCE_KEY]) return String(stored[SESSION_NONCE_KEY]);
    const nonce = crypto.randomUUID();
    await chrome.storage.session.set({ [SESSION_NONCE_KEY]: nonce });
    return nonce;
  }

  async function loadBindings() {
    const stored = await chrome.storage.session.get(BINDINGS_KEY);
    const raw = stored[BINDINGS_KEY];
    return raw && raw.schema === BINDING_SCHEMA && raw.bindings && typeof raw.bindings === "object"
      ? raw
      : { schema: BINDING_SCHEMA, browser_session_nonce: await ensureSessionNonce(), bindings: {}, updated_at: nowIso() };
  }

  async function persistBindings(bindings) {
    const clean = { schema: BINDING_SCHEMA, browser_session_nonce: await ensureSessionNonce(), bindings: { ...(bindings?.bindings || {}) }, updated_at: nowIso() };
    await chrome.storage.session.set({ [BINDINGS_KEY]: clean });
    return clean;
  }

  async function syncLegacySeeds() {
    return mutate(async () => {
      const registry = await loadRegistry();
      const settings = await chrome.storage.local.get(Object.values(PLATFORMS).map((spec) => spec.configKey));
      let changed = false;
      for (const [platform, spec] of Object.entries(PLATFORMS)) {
        const configured = normUrl(settings[spec.configKey] || "");
        if (configured) assertPlatformUrl(platform, configured);
        const index = registry.targets.findIndex((target) => target.legacy_alias === platform);
        if (index < 0) {
          registry.targets.push(canonicalTarget({
            target_id: spec.seedId,
            platform,
            role: platform === "CHATGPT" ? "OPERATOR_PRIMARY" : "OPERATOR_PREDECESSOR",
            legacy_alias: platform,
            conversation_epoch: configured ? 1 : 0,
            conversation_url: configured || null,
            status: configured ? "ACTIVE" : "UNBOUND",
            updated_at: nowIso()
          }));
          changed = true;
          continue;
        }
        const current = registry.targets[index];
        if ((current.conversation_url || "") !== configured) {
          const nextEpoch = current.conversation_url && configured ? current.conversation_epoch + 1 : configured ? Math.max(1, current.conversation_epoch) : current.conversation_epoch;
          registry.targets[index] = canonicalTarget({
            ...current,
            conversation_url: configured || null,
            conversation_epoch: nextEpoch,
            status: configured ? "ACTIVE" : "UNBOUND",
            updated_at: nowIso()
          }, current);
          changed = true;
        }
      }
      return changed ? persistRegistry(registry) : registry;
    });
  }

  async function listTargets({ includeRetired = false } = {}) {
    const registry = await loadRegistry();
    return registry.targets.filter((target) => includeRetired || target.status !== "RETIRED").map(clone);
  }

  async function getTarget(targetId) {
    const id = normalizeTargetId(targetId);
    const registry = await loadRegistry();
    const target = registry.targets.find((row) => row.target_id === id);
    return target ? clone(target) : null;
  }

  async function resolveSelector(selector) {
    const registry = await loadRegistry();
    const value = typeof selector === "string" ? selector : selector?.target_id || selector?.legacy_alias || selector?.platform || "";
    const raw = String(value || "").trim();
    if (!raw) throw new Error("target_selector_missing");
    const upper = raw.toUpperCase();
    let target = registry.targets.find((row) => row.target_id === raw.toLowerCase());
    if (!target && PLATFORMS[upper]) target = registry.targets.find((row) => row.legacy_alias === upper);
    if (!target || target.status === "RETIRED") throw new Error("target_not_found");
    return clone(target);
  }

  async function createTarget(input = {}) {
    return mutate(async () => {
      const registry = await loadRegistry();
      const platform = String(input.platform || "").toUpperCase();
      if (!PLATFORMS[platform]) throw new Error("target_platform_invalid");
      const targetId = input.target_id
        ? normalizeTargetId(input.target_id)
        : `${platform === "CHATGPT" ? "gpt" : "glm"}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
      if (registry.targets.some((row) => row.target_id === targetId)) throw new Error("target_id_exists");
      const target = canonicalTarget({
        target_id: targetId,
        platform,
        role: input.role || "WORKER",
        conversation_url: input.conversation_url ?? input.conversationUrl ?? null,
        conversation_epoch: input.conversation_url || input.conversationUrl ? 1 : 0,
        status: input.conversation_url || input.conversationUrl ? "ACTIVE" : "UNBOUND",
        updated_at: nowIso()
      });
      registry.targets.push(target);
      await persistRegistry(registry);
      return clone(target);
    });
  }

  async function updateConversation(targetId, newUrl, { status = "ACTIVE" } = {}) {
    return mutate(async () => {
      const registry = await loadRegistry();
      const id = normalizeTargetId(targetId);
      const index = registry.targets.findIndex((row) => row.target_id === id);
      if (index < 0) throw new Error("target_not_found");
      const current = registry.targets[index];
      if (current.status === "RETIRED") throw new Error("target_retired");
      const url = normUrl(newUrl || "");
      if (!url) throw new Error("target_conversation_url_invalid");
      assertPlatformUrl(current.platform, url);
      if (registry.targets.some((row, i) => i !== index && row.status !== "RETIRED" && row.conversation_url === url)) throw new Error("target_registry_duplicate_active_url");
      const changedUrl = current.conversation_url !== url;
      const next = canonicalTarget({
        ...current,
        conversation_url: url,
        conversation_epoch: changedUrl ? Math.max(1, current.conversation_epoch + 1) : current.conversation_epoch,
        status,
        updated_at: nowIso()
      }, current);
      registry.targets[index] = next;
      await persistRegistry(registry);
      await clearBinding(id);
      if (next.legacy_alias) {
        const configKey = PLATFORMS[next.legacy_alias].configKey;
        suppressLegacyStorageSync = true;
        try { await chrome.storage.local.set({ [configKey]: url }); }
        finally { suppressLegacyStorageSync = false; }
      }
      return clone(next);
    });
  }

  async function setStatus(targetId, status) {
    return mutate(async () => {
      const registry = await loadRegistry();
      const id = normalizeTargetId(targetId);
      const index = registry.targets.findIndex((row) => row.target_id === id);
      if (index < 0) throw new Error("target_not_found");
      registry.targets[index] = canonicalTarget({ ...registry.targets[index], status, updated_at: nowIso() }, registry.targets[index]);
      await persistRegistry(registry);
      return clone(registry.targets[index]);
    });
  }

  async function retireTarget(targetId) {
    return setStatus(targetId, "RETIRED").then(async (target) => {
      await clearBinding(target.target_id);
      return target;
    });
  }

  async function bind(target, tab) {
    if (!target?.target_id || !Number.isInteger(Number(tab?.id))) throw new Error("target_binding_invalid");
    const liveUrl = normUrl(tab?.url || "");
    if (!target.conversation_url || liveUrl !== target.conversation_url || platformOf(liveUrl) !== target.platform) throw new Error("target_binding_url_mismatch");
    const state = await loadBindings();
    for (const [otherId, binding] of Object.entries(state.bindings)) {
      if (otherId !== target.target_id && Number(binding?.tab_id) === Number(tab.id)) delete state.bindings[otherId];
    }
    state.bindings[target.target_id] = {
      schema: "metaengine.a2-browser-operator.target-binding.v1",
      target_id: target.target_id,
      tab_id: Number(tab.id),
      conversation_epoch: target.conversation_epoch,
      conversation_url: target.conversation_url,
      browser_session_nonce: state.browser_session_nonce,
      bound_at: state.bindings[target.target_id]?.bound_at || nowIso(),
      validated_at: nowIso()
    };
    await persistBindings(state);
    return clone(state.bindings[target.target_id]);
  }

  async function clearBinding(targetId) {
    const id = normalizeTargetId(targetId);
    const state = await loadBindings();
    if (state.bindings[id]) {
      delete state.bindings[id];
      await persistBindings(state);
    }
  }

  async function clearBindingsForTab(tabId) {
    const state = await loadBindings();
    let changed = false;
    for (const [targetId, binding] of Object.entries(state.bindings)) {
      if (Number(binding?.tab_id) === Number(tabId)) { delete state.bindings[targetId]; changed = true; }
    }
    if (changed) await persistBindings(state);
  }

  async function getBinding(targetId) {
    const id = normalizeTargetId(targetId);
    const state = await loadBindings();
    return state.bindings[id] ? clone(state.bindings[id]) : null;
  }

  async function resolveLiveTab(selector, { exactTabId = null, allowBind = true } = {}) {
    const target = await resolveSelector(selector);
    if (!target.conversation_url) throw new Error(`target_not_configured:${target.target_id}`);
    const existing = await getBinding(target.target_id);
    if (existing) {
      try {
        const live = await chrome.tabs.get(Number(existing.tab_id));
        if (Number.isInteger(Number(live?.id)) && normUrl(live.url || "") === target.conversation_url && platformOf(live.url || "") === target.platform) {
          if (exactTabId != null && Number(live.id) !== Number(exactTabId)) throw new Error("target_tab_binding_mismatch");
          if (allowBind) await bind(target, live);
          return { target, tab: live, binding: allowBind ? await getBinding(target.target_id) : existing };
        }
      } catch (error) {
        if (String(error?.message || error) === "target_tab_binding_mismatch") throw error;
      }
      await clearBinding(target.target_id);
    }
    const tabs = await chrome.tabs.query({});
    const matches = tabs.filter((tab) => Number.isInteger(Number(tab?.id)) && normUrl(tab.url || "") === target.conversation_url && platformOf(tab.url || "") === target.platform);
    if (matches.length !== 1) throw new Error(matches.length ? `target_duplicate_tabs:${target.target_id}:${matches.length}` : `target_tab_not_found:${target.target_id}`);
    if (exactTabId != null && Number(matches[0].id) !== Number(exactTabId)) throw new Error("target_tab_binding_mismatch");
    const binding = allowBind ? await bind(target, matches[0]) : null;
    return { target, tab: matches[0], binding };
  }

  async function bindObservedTab(tab) {
    const tabId = Number(tab?.id);
    const url = normUrl(tab?.url || "");
    const platform = platformOf(url);
    if (!Number.isInteger(tabId) || !url || !PLATFORMS[platform]) return null;
    const registry = await loadRegistry();
    const matches = registry.targets.filter((target) => target.status !== "RETIRED" && target.platform === platform && target.conversation_url === url);
    if (matches.length !== 1) return null;
    return bind(matches[0], { id: tabId, url });
  }

  function trustedExtensionPage(sender) {
    if (sender?.id !== chrome.runtime.id || typeof sender?.url !== "string") return false;
    const root = String(chrome.runtime.getURL("") || "");
    return Boolean(root) && String(sender.url).startsWith(root);
  }

  const ready = syncLegacySeeds().then(ensureSessionNonce);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || suppressLegacyStorageSync) return;
    if (Object.values(PLATFORMS).some((spec) => changes[spec.configKey])) syncLegacySeeds().catch(() => {});
  });

  chrome.tabs.onRemoved.addListener((tabId) => { clearBindingsForTab(tabId).catch(() => {}); });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (typeof changeInfo?.url === "string") {
      clearBindingsForTab(tabId).then(() => bindObservedTab({ id: tabId, url: changeInfo.url })).catch(() => {});
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = String(message?.type || "");
    if (type === "CHAT_SNAPSHOT" && sender?.tab?.id) {
      // Observe only. Do not answer CHAT_SNAPSHOT: runtime-core owns its response contract.
      bindObservedTab(sender.tab).catch(() => {});
      return false;
    }
    if (!["A2_TARGET_REGISTRY_LIST", "A2_TARGET_REGISTRY_CREATE", "A2_TARGET_REGISTRY_ROLLOVER", "A2_TARGET_REGISTRY_RETIRE", "A2_TARGET_REGISTRY_RESOLVE"].includes(type)) return false;
    if (!trustedExtensionPage(sender)) { sendResponse({ ok: false, error: "target_registry_sender_not_trusted" }); return false; }
    const job = type === "A2_TARGET_REGISTRY_LIST" ? listTargets({ includeRetired: message?.include_retired === true })
      : type === "A2_TARGET_REGISTRY_CREATE" ? createTarget(message?.target || {})
      : type === "A2_TARGET_REGISTRY_ROLLOVER" ? updateConversation(message?.target_id, message?.conversation_url, { status: message?.status || "ACTIVE" })
      : type === "A2_TARGET_REGISTRY_RETIRE" ? retireTarget(message?.target_id)
      : resolveLiveTab(message?.selector || message?.target_id || message?.platform, { exactTabId: message?.exact_tab_id ?? null });
    Promise.resolve(job).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  globalThis.A2_TARGET_REGISTRY = Object.freeze({
    schema: SCHEMA,
    ready,
    listTargets,
    getTarget,
    resolveSelector,
    resolveLiveTab,
    createTarget,
    updateConversation,
    setStatus,
    retireTarget,
    bindObservedTab,
    getBinding,
    clearBinding,
    syncLegacySeeds,
    platformOf,
    normUrl
  });
})();
