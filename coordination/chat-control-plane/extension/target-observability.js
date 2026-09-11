(() => {
  "use strict";

  const INDEX_KEY = "a2TargetObservabilityV1";
  const SCHEMA = "metaengine.a2-browser-operator.target-observability.v1";
  const ENTRY_SCHEMA = "metaengine.a2-browser-operator.target-health.v1";
  const MAX_TARGETS = 128;

  const nowIso = () => new Date().toISOString();
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const boundedString = (value, max = 96) => String(value ?? "").slice(0, Math.max(0, Number(max) || 0));
  const boundedInt = (value, max = 1_000_000) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(max, Math.trunc(number)));
  };
  const normalizeText = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

  function registry() {
    const value = globalThis.A2_TARGET_REGISTRY;
    if (!value || typeof value.listTargets !== "function" || typeof value.normUrl !== "function" || typeof value.platformOf !== "function") {
      throw new Error("target_observability_registry_unavailable");
    }
    return value;
  }

  function emptyIndex() {
    return { schema: SCHEMA, entries: {}, updated_at: nowIso(), authority_effect: false };
  }

  async function loadIndex() {
    const stored = await chrome.storage.session.get(INDEX_KEY);
    const raw = stored[INDEX_KEY];
    if (!raw || raw.schema !== SCHEMA || !raw.entries || typeof raw.entries !== "object") return emptyIndex();
    return { schema: SCHEMA, entries: { ...raw.entries }, updated_at: String(raw.updated_at || nowIso()), authority_effect: false };
  }

  async function persistIndex(index) {
    const entries = Object.fromEntries(Object.entries(index?.entries || {}).slice(-MAX_TARGETS));
    const clean = { schema: SCHEMA, entries, updated_at: nowIso(), authority_effect: false };
    await chrome.storage.session.set({ [INDEX_KEY]: clean });
    return clean;
  }

  function sanitizeSnapshot(target, senderTab, snapshot) {
    const composer = String(snapshot?.composer_text ?? "");
    const composerPresent = snapshot?.composer_present === true;
    return {
      schema: ENTRY_SCHEMA,
      target_id: target.target_id,
      provider: target.provider,
      platform: target.platform,
      surface: target.surface,
      role: target.role,
      conversation_epoch: target.conversation_epoch,
      conversation_url: target.conversation_url,
      observed_tab_id: Number(senderTab.id),
      observed_at: nowIso(),
      snapshot_captured_at: boundedString(snapshot?.captured_at, 64) || null,
      generating: snapshot?.generating === true,
      processing_active: snapshot?.processing_active === true,
      generation_signal: boundedString(snapshot?.generation_signal, 64) || "NONE",
      composer_present: composerPresent,
      composer_empty: composerPresent ? normalizeText(composer).length === 0 : null,
      composer_length: composerPresent ? boundedInt(composer.length, 120000) : 0,
      message_count: boundedInt(snapshot?.message_count, 100000),
      dom_pair_error: boundedString(snapshot?.dom_pair_error, 128) || null,
      visibility_state: boundedString(snapshot?.visibility_state, 32) || null,
      tainted_page_data: true,
      authority_effect: false
    };
  }

  async function targetForSender(senderTab, snapshot) {
    const api = registry();
    await Promise.resolve(api.ready).catch(() => {});
    const tabId = Number(senderTab?.id);
    const senderUrl = api.normUrl(senderTab?.url || "");
    const senderPlatform = api.platformOf(senderUrl);
    const claimedPlatform = String(snapshot?.platform || "");
    if (!Number.isInteger(tabId) || !senderUrl || senderPlatform === "UNKNOWN") return null;
    if (claimedPlatform !== senderPlatform) return null;
    const snapshotUrl = api.normUrl(snapshot?.url || "");
    if (snapshotUrl && snapshotUrl !== senderUrl) return null;
    const targets = await api.listTargets({ includeRetired: false });
    const matches = targets.filter((target) => target.platform === senderPlatform && target.conversation_url === senderUrl);
    if (matches.length !== 1) return null;
    return matches[0];
  }

  async function observe(senderTab, snapshot) {
    const target = await targetForSender(senderTab, snapshot);
    if (!target) return null;
    const api = registry();
    await api.bindObservedTab?.(senderTab).catch?.(() => {});
    const index = await loadIndex();
    const entry = sanitizeSnapshot(target, senderTab, snapshot);
    index.entries[target.target_id] = entry;
    await persistIndex(index);
    return clone(entry);
  }

  async function getHealth(targetId) {
    const id = String(targetId || "").trim().toLowerCase();
    if (!id) throw new Error("target_observability_target_id_missing");
    const index = await loadIndex();
    return index.entries[id] ? clone(index.entries[id]) : null;
  }

  async function inventory() {
    const api = registry();
    await Promise.resolve(api.ready).catch(() => {});
    const targets = await api.listTargets({ includeRetired: false });
    const index = await loadIndex();
    const rows = [];
    for (const target of targets) {
      const binding = typeof api.getBinding === "function" ? await api.getBinding(target.target_id).catch(() => null) : null;
      const health = index.entries[target.target_id] || null;
      const healthEpoch = Number(health?.conversation_epoch ?? -1);
      rows.push({
        schema: "metaengine.a2-browser-operator.target-observability-row.v1",
        target: clone(target),
        binding: binding ? clone(binding) : null,
        health: health ? clone(health) : null,
        health_fresh_for_epoch: Boolean(health && healthEpoch === Number(target.conversation_epoch)),
        authority_effect: false
      });
    }
    return rows.sort((a, b) => String(a.target.target_id).localeCompare(String(b.target.target_id)));
  }

  function trustedExtensionPage(sender) {
    if (sender?.id !== chrome.runtime.id || typeof sender?.url !== "string") return false;
    const root = String(chrome.runtime.getURL("") || "");
    return Boolean(root) && String(sender.url).startsWith(root);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = String(message?.type || "");
    if (type === "CHAT_SNAPSHOT" && sender?.tab?.id && message?.snapshot) {
      observe(sender.tab, message.snapshot).catch(() => {});
      // Passive observer only. runtime-core owns CHAT_SNAPSHOT acknowledgement and dispatch semantics.
      return false;
    }
    if (type !== "A2_TARGET_OBSERVABILITY_LIST" && type !== "A2_TARGET_OBSERVABILITY_GET") return false;
    if (!trustedExtensionPage(sender)) {
      sendResponse({ ok: false, error: "target_observability_sender_not_trusted" });
      return false;
    }
    const job = type === "A2_TARGET_OBSERVABILITY_LIST" ? inventory() : getHealth(message?.target_id);
    Promise.resolve(job).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  globalThis.A2_TARGET_OBSERVABILITY = Object.freeze({
    schema: SCHEMA,
    observe,
    getHealth,
    inventory
  });
})();
