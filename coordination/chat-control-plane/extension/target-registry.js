(() => {
  "use strict";

  const REGISTRY_KEY = "a2TargetRegistryV2";
  const BINDINGS_KEY = "a2TargetBindingsV2";
  const SELECTED_KEY = "a2FleetSelectedAgentIdV1";
  const SESSION_NONCE_KEY = "a2TargetRegistrySessionNonceV2";
  const SCHEMA = "metaengine.a2-browser-operator.target-registry.v2";
  const BINDING_SCHEMA = "metaengine.a2-browser-operator.target-bindings.v2";
  const TARGET_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,95}$/;
  const STATUSES = new Set(["REGISTERED", "READY", "BUSY", "DRAINING", "LOST", "RETIRED"]);
  const SUPERVISOR_TAB_KEY = "a2SupervisorChatTabIdV1";
  const SUPERVISOR_URL_KEY = "a2SupervisorChatUrlV1";
  let mutation = Promise.resolve();

  const nowIso = () => new Date().toISOString();
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

  function normUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.protocol !== "https:") return "";
      if (!["chatgpt.com", "chat.openai.com"].includes(url.hostname.toLowerCase())) return "";
      url.hash = "";
      url.search = "";
      url.pathname = url.pathname.replace(/\/+$/, "") || "/";
      return `${url.origin}${url.pathname}`;
    } catch (_) { return ""; }
  }

  function isConversationUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return ["chatgpt.com", "chat.openai.com"].includes(url.hostname.toLowerCase()) && url.pathname.startsWith("/c/");
    } catch (_) { return false; }
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

  function normalizeStatus(value) {
    const status = String(value || "REGISTERED").trim().toUpperCase();
    if (!STATUSES.has(status)) throw new Error("target_status_invalid");
    return status;
  }

  function canonicalTarget(raw, previous = null) {
    const url = normUrl(raw?.conversation_url ?? previous?.conversation_url ?? "");
    const createdAt = String(previous?.created_at || raw?.created_at || nowIso());
    const epochRaw = Number(raw?.conversation_epoch ?? previous?.conversation_epoch ?? (url ? 1 : 0));
    const epoch = Number.isSafeInteger(epochRaw) && epochRaw >= 0 ? epochRaw : 0;
    return {
      schema: "metaengine.a2-browser-operator.target.v2",
      target_id: normalizeTargetId(raw?.target_id || previous?.target_id),
      agent_id: normalizeTargetId(raw?.agent_id || previous?.agent_id || raw?.target_id || previous?.target_id),
      provider: "OPENAI",
      platform: "CHATGPT",
      surface: "WEB_CHAT",
      role: normalizeRole(raw?.role ?? previous?.role ?? "WORKER"),
      capability_set: Array.isArray(raw?.capability_set ?? previous?.capability_set)
        ? [...new Set((raw?.capability_set ?? previous?.capability_set).map((v) => String(v || "").trim().toLowerCase()).filter(Boolean))].slice(0, 64)
        : ["chat", "perception"],
      conversation_epoch: epoch,
      conversation_url: url || null,
      status: normalizeStatus(raw?.status ?? previous?.status ?? (url ? "READY" : "REGISTERED")),
      created_at: createdAt,
      updated_at: String(raw?.updated_at || previous?.updated_at || nowIso())
    };
  }

  function emptyRegistry() {
    return { schema: SCHEMA, revision: 0, targets: [], updated_at: nowIso() };
  }

  function validateRegistry(registry) {
    const ids = new Set();
    const urls = new Set();
    const targets = [];
    for (const raw of Array.isArray(registry?.targets) ? registry.targets : []) {
      const target = canonicalTarget(raw, raw);
      if (ids.has(target.target_id)) throw new Error("target_registry_duplicate_id");
      ids.add(target.target_id);
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
    return stored[REGISTRY_KEY] ? validateRegistry(stored[REGISTRY_KEY]) : emptyRegistry();
  }

  async function persistRegistry(registry) {
    const clean = validateRegistry({
      ...registry,
      revision: (Number(registry?.revision) || 0) + 1,
      updated_at: nowIso()
    });
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
    if (raw?.schema === BINDING_SCHEMA && raw.bindings && typeof raw.bindings === "object") return raw;
    return { schema: BINDING_SCHEMA, browser_session_nonce: await ensureSessionNonce(), bindings: {}, updated_at: nowIso() };
  }

  async function persistBindings(state) {
    const clean = {
      schema: BINDING_SCHEMA,
      browser_session_nonce: await ensureSessionNonce(),
      bindings: { ...(state?.bindings || {}) },
      updated_at: nowIso()
    };
    await chrome.storage.session.set({ [BINDINGS_KEY]: clean });
    return clean;
  }

  async function getBinding(targetId) {
    const id = normalizeTargetId(targetId);
    const state = await loadBindings();
    return state.bindings[id] ? clone(state.bindings[id]) : null;
  }

  async function bind(target, tab) {
    const tabId = Number(tab?.id);
    const url = normUrl(tab?.url || "");
    if (!Number.isInteger(tabId) || !url || url !== target.conversation_url) throw new Error("target_binding_url_mismatch");
    const state = await loadBindings();
    for (const [otherId, row] of Object.entries(state.bindings)) {
      if (otherId !== target.target_id && Number(row?.tab_id) === tabId) delete state.bindings[otherId];
    }
    state.bindings[target.target_id] = {
      schema: "metaengine.a2-browser-operator.target-binding.v2",
      target_id: target.target_id,
      agent_id: target.agent_id,
      tab_id: tabId,
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
    if (!state.bindings[id]) return;
    delete state.bindings[id];
    await persistBindings(state);
  }

  async function targetForTab(tabId) {
    const state = await loadBindings();
    for (const [targetId, binding] of Object.entries(state.bindings)) {
      if (Number(binding?.tab_id) === Number(tabId)) return targetId;
    }
    return null;
  }

  async function selectedTargetId() {
    const stored = await chrome.storage.local.get(SELECTED_KEY);
    return stored[SELECTED_KEY] ? String(stored[SELECTED_KEY]) : null;
  }

  async function selectTarget(targetId) {
    const id = normalizeTargetId(targetId);
    const registry = await loadRegistry();
    const target = registry.targets.find((row) => row.target_id === id && row.status !== "RETIRED");
    if (!target) throw new Error("target_not_found");
    await chrome.storage.local.set({
      [SELECTED_KEY]: id,
      chatgptUrl: target.conversation_url || ""
    });
    return clone(target);
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
    const raw = typeof selector === "string" ? selector : selector?.target_id || selector?.agent_id || "";
    const id = normalizeTargetId(raw);
    const target = await getTarget(id);
    if (!target || target.status === "RETIRED") throw new Error("target_not_found");
    return target;
  }

  async function setRole(targetId, role) {
    return mutate(async () => {
      const registry = await loadRegistry();
      const id = normalizeTargetId(targetId);
      const index = registry.targets.findIndex((row) => row.target_id === id);
      if (index < 0) throw new Error("target_not_found");
      registry.targets[index] = canonicalTarget({ ...registry.targets[index], role: normalizeRole(role), updated_at: nowIso() }, registry.targets[index]);
      await persistRegistry(registry);
      return clone(registry.targets[index]);
    });
  }

  async function setStatus(targetId, status) {
    return mutate(async () => {
      const registry = await loadRegistry();
      const id = normalizeTargetId(targetId);
      const index = registry.targets.findIndex((row) => row.target_id === id);
      if (index < 0) throw new Error("target_not_found");
      registry.targets[index] = canonicalTarget({ ...registry.targets[index], status: normalizeStatus(status), updated_at: nowIso() }, registry.targets[index]);
      await persistRegistry(registry);
      return clone(registry.targets[index]);
    });
  }

  async function retireTarget(targetId) {
    const target = await setStatus(targetId, "RETIRED");
    await clearBinding(target.target_id);
    return target;
  }

  function nextAgentId(registry) {
    let id;
    do { id = `gpt_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`; }
    while (registry.targets.some((target) => target.target_id === id));
    return id;
  }

  async function supervisorIdentity() {
    const stored = await chrome.storage.local.get([SUPERVISOR_TAB_KEY, SUPERVISOR_URL_KEY]);
    return {
      tab_id: Number.isInteger(Number(stored[SUPERVISOR_TAB_KEY])) ? Number(stored[SUPERVISOR_TAB_KEY]) : null,
      url: normUrl(stored[SUPERVISOR_URL_KEY] || "")
    };
  }

  async function discoverOpenChats() {
    return mutate(async () => {
      const registry = await loadRegistry();
      const bindings = await loadBindings();
      const supervisor = await supervisorIdentity();
      const tabs = await chrome.tabs.query({});
      const chats = tabs
        .filter((tab) => Number.isInteger(Number(tab?.id)) && isConversationUrl(tab.url || ""))
        .filter((tab) => Number(tab.id) !== supervisor.tab_id && (!supervisor.url || normUrl(tab.url || "") !== supervisor.url))
        .sort((a, b) => Number(a.id) - Number(b.id));

      const liveIds = new Set();
      let changed = false;

      for (const tab of chats) {
        const tabId = Number(tab.id);
        const url = normUrl(tab.url || "");
        let target = null;
        const boundEntry = Object.entries(bindings.bindings).find(([, row]) => Number(row?.tab_id) === tabId);
        if (boundEntry) {
          target = registry.targets.find((row) => row.target_id === boundEntry[0] && row.status !== "RETIRED") || null;
          if (target && target.conversation_url !== url) {
            const index = registry.targets.findIndex((row) => row.target_id === target.target_id);
            target = canonicalTarget({ ...target, conversation_url: url, conversation_epoch: Math.max(1, target.conversation_epoch + 1), status: "READY", updated_at: nowIso() }, target);
            registry.targets[index] = target;
            changed = true;
          }
        }
        if (!target) target = registry.targets.find((row) => row.status !== "RETIRED" && row.conversation_url === url) || null;
        if (!target) {
          const id = nextAgentId(registry);
          target = canonicalTarget({ target_id: id, agent_id: id, role: "WORKER", capability_set: ["chat", "perception"], conversation_url: url, conversation_epoch: 1, status: "READY", updated_at: nowIso() });
          registry.targets.push(target);
          changed = true;
        } else if (!["BUSY", "DRAINING"].includes(target.status) && target.status !== "READY") {
          const index = registry.targets.findIndex((row) => row.target_id === target.target_id);
          target = canonicalTarget({ ...target, status: "READY", updated_at: nowIso() }, target);
          registry.targets[index] = target;
          changed = true;
        }
        liveIds.add(target.target_id);
        bindings.bindings[target.target_id] = { schema: "metaengine.a2-browser-operator.target-binding.v2", target_id: target.target_id, agent_id: target.agent_id, tab_id: tabId, conversation_epoch: target.conversation_epoch, conversation_url: url, browser_session_nonce: bindings.browser_session_nonce, bound_at: bindings.bindings[target.target_id]?.bound_at || nowIso(), validated_at: nowIso() };
      }

      for (let i = 0; i < registry.targets.length; i += 1) {
        const target = registry.targets[i];
        if (target.status === "RETIRED" || liveIds.has(target.target_id)) continue;
        if (target.status === "BUSY") continue;
        if (target.status !== "LOST") {
          registry.targets[i] = canonicalTarget({ ...target, status: "LOST", updated_at: nowIso() }, target);
          changed = true;
        }
        delete bindings.bindings[target.target_id];
      }

      const persisted = changed ? await persistRegistry(registry) : registry;
      await persistBindings(bindings);
      let selected = await selectedTargetId();
      const selectedTarget = selected ? persisted.targets.find((row) => row.target_id === selected && row.status !== "RETIRED") : null;
      if (!selectedTarget || !selectedTarget.conversation_url) {
        const fallback = persisted.targets.find((row) => row.status === "READY" && row.conversation_url);
        if (fallback) await selectTarget(fallback.target_id);
      } else {
        await chrome.storage.local.set({ chatgptUrl: selectedTarget.conversation_url });
      }
      return persisted.targets.filter((row) => row.status !== "RETIRED").map(clone);
    });
  }

  async function resolveLiveTab(selector, { exactTabId = null, allowBind = true } = {}) {
    const target = await resolveSelector(selector);
    if (!target.conversation_url) throw new Error(`target_not_configured:${target.target_id}`);
    const binding = await getBinding(target.target_id);
    if (binding) {
      try {
        const tab = await chrome.tabs.get(Number(binding.tab_id));
        if (normUrl(tab?.url || "") === target.conversation_url) {
          if (exactTabId != null && Number(tab.id) !== Number(exactTabId)) throw new Error("target_tab_binding_mismatch");
          return { target, tab, binding: allowBind ? await bind(target, tab) : binding };
        }
      } catch (error) {
        if (String(error?.message || error) === "target_tab_binding_mismatch") throw error;
      }
      await clearBinding(target.target_id);
    }
    await discoverOpenChats();
    const next = await getBinding(target.target_id);
    if (!next) throw new Error(`target_tab_not_found:${target.target_id}`);
    const tab = await chrome.tabs.get(Number(next.tab_id));
    if (exactTabId != null && Number(tab.id) !== Number(exactTabId)) throw new Error("target_tab_binding_mismatch");
    return { target: await getTarget(target.target_id), tab, binding: next };
  }

  async function bindObservedTab(tab) {
    if (!Number.isInteger(Number(tab?.id)) || !isConversationUrl(tab?.url || "")) return null;
    await discoverOpenChats();
    const id = await targetForTab(Number(tab.id));
    return id ? getBinding(id) : null;
  }

  function trustedExtensionPage(sender) {
    if (sender?.id !== chrome.runtime.id || typeof sender?.url !== "string") return false;
    const root = String(chrome.runtime.getURL("") || "");
    return Boolean(root) && String(sender.url).startsWith(root);
  }

  const ready = ensureSessionNonce().then(discoverOpenChats);

  chrome.tabs.onRemoved.addListener((tabId) => {
    mutate(async () => {
      const targetId = await targetForTab(tabId);
      if (!targetId) return;
      const registry = await loadRegistry();
      const index = registry.targets.findIndex((row) => row.target_id === targetId);
      if (index >= 0) {
        const current = registry.targets[index];
        if (current.status !== "RETIRED" && current.status !== "BUSY") {
          registry.targets[index] = canonicalTarget({ ...current, status: "LOST", updated_at: nowIso() }, current);
          await persistRegistry(registry);
        }
      }
      await clearBinding(targetId);
    }).catch(() => {});
  });

  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (typeof changeInfo?.url !== "string") return;
    discoverOpenChats().catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = String(message?.type || "");
    if (type === "CHAT_SNAPSHOT" && sender?.tab?.id) {
      bindObservedTab(sender.tab).catch(() => {});
      return false;
    }
    if (!["A2_TARGET_REGISTRY_LIST", "A2_TARGET_REGISTRY_DISCOVER", "A2_TARGET_REGISTRY_SELECT", "A2_TARGET_REGISTRY_SET_ROLE", "A2_TARGET_REGISTRY_RETIRE", "A2_TARGET_REGISTRY_RESOLVE"].includes(type)) return false;
    if (!trustedExtensionPage(sender)) {
      sendResponse({ ok: false, error: "target_registry_sender_not_trusted" });
      return false;
    }
    const job = type === "A2_TARGET_REGISTRY_LIST" ? listTargets({ includeRetired: message?.include_retired === true }) : type === "A2_TARGET_REGISTRY_DISCOVER" ? discoverOpenChats() : type === "A2_TARGET_REGISTRY_SELECT" ? selectTarget(message?.target_id) : type === "A2_TARGET_REGISTRY_SET_ROLE" ? setRole(message?.target_id, message?.role) : type === "A2_TARGET_REGISTRY_RETIRE" ? retireTarget(message?.target_id) : resolveLiveTab(message?.target_id || message?.agent_id, { exactTabId: message?.exact_tab_id ?? null });
    Promise.resolve(job).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  globalThis.A2_TARGET_REGISTRY = Object.freeze({ schema: SCHEMA, ready, listTargets, getTarget, resolveSelector, resolveLiveTab, discoverOpenChats, selectTarget, selectedTargetId, setRole, setStatus, retireTarget, bindObservedTab, getBinding, targetForTab, clearBinding, isConversationUrl, normUrl });
})();