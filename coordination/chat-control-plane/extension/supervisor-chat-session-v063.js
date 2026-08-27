(() => {
  "use strict";

  const CHATGPT_ROOT = "https://chatgpt.com/";
  const TAB_KEY = "a2SupervisorChatTabIdV1";
  const URL_KEY = "a2SupervisorChatUrlV1";
  const EPOCH_KEY = "a2SupervisorChatEpochV1";
  const HEALTH_KEY = "a2SupervisorChatHealthV1";
  const ENABLED_KEY = "a2SupervisorChatEnabledV1";
  const SNAPSHOT_KEY = "a2SupervisorChatSnapshotV1";
  const ALARM = "a2-supervisor-chat-health";
  const SNAPSHOT_STALE_MS = 45_000;
  const CONTENT_READY_TIMEOUT_MS = 15_000;
  const HEALTH_RELOAD_GRACE_MS = 45_000;
  const MAX_RECOVERY_COUNT = 8;

  let ensurePromise = null;
  let recoverPromise = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normUrl(value) {
    try {
      const u = new URL(String(value || ""));
      u.hash = "";
      u.search = "";
      u.pathname = u.pathname.replace(/\/+$/, "") || "/";
      return `${u.origin}${u.pathname}`;
    } catch (_) {
      return "";
    }
  }

  function isChatgpt(value) {
    try {
      const host = new URL(String(value || "")).hostname.toLowerCase();
      return host === "chatgpt.com" || host === "chat.openai.com";
    } catch (_) {
      return false;
    }
  }

  function isConversation(value) {
    try {
      const u = new URL(String(value || ""));
      return isChatgpt(value) && u.pathname.startsWith("/c/");
    } catch (_) {
      return false;
    }
  }

  async function enabled() {
    const x = await chrome.storage.local.get(ENABLED_KEY);
    if (x[ENABLED_KEY] === undefined) {
      await chrome.storage.local.set({ [ENABLED_KEY]: true });
      return true;
    }
    return x[ENABLED_KEY] === true;
  }

  async function readMeta() {
    const x = await chrome.storage.local.get([TAB_KEY, URL_KEY, EPOCH_KEY, HEALTH_KEY, ENABLED_KEY]);
    return {
      enabled: x[ENABLED_KEY] !== false,
      tab_id: Number.isInteger(Number(x[TAB_KEY])) ? Number(x[TAB_KEY]) : null,
      url: normUrl(x[URL_KEY] || "") || null,
      epoch: Math.max(0, Number(x[EPOCH_KEY]) || 0),
      health: x[HEALTH_KEY] || null
    };
  }

  async function writeHealth(state, reason, extra = {}) {
    const health = {
      schema: "metaengine.a2-browser-supervisor.chat-health.v1",
      state: String(state || "UNKNOWN"),
      reason: String(reason || "").slice(0, 240) || null,
      observed_at: new Date().toISOString(),
      ...extra
    };
    await chrome.storage.local.set({ [HEALTH_KEY]: health });
    return health;
  }

  async function tabById(tabId) {
    if (!Number.isInteger(Number(tabId))) return null;
    try {
      const tab = await chrome.tabs.get(Number(tabId));
      return tab?.id && isChatgpt(tab.url || "") ? tab : null;
    } catch (_) {
      return null;
    }
  }

  async function waitContent(tabId, timeout = CONTENT_READY_TIMEOUT_MS) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const response = await chrome.tabs.sendMessage(Number(tabId), { type: "GET_CHAT_SNAPSHOT" });
        if (response?.ok === true && response.snapshot) return response.snapshot;
      } catch (_) {}
      await sleep(200);
    }
    throw new Error("supervisor_chat_content_not_ready");
  }

  async function probeExhaustion(tabId) {
    try {
      const result = await chrome.tabs.sendMessage(Number(tabId), { type: "A2_CHATGPT_EXHAUSTION_STATUS" });
      if (result?.ok === true) return result;
    } catch (_) {}
    return { ok: false, exhausted: false, reason: "probe_unavailable" };
  }

  async function currentSnapshot() {
    const x = await chrome.storage.session.get(SNAPSHOT_KEY);
    return x[SNAPSHOT_KEY] || null;
  }

  function snapshotFresh(row) {
    const at = Date.parse(String(row?.observed_at || ""));
    return Number.isFinite(at) && Date.now() - at <= SNAPSHOT_STALE_MS;
  }

  async function tag(tabId, url = null, reason = "tag") {
    const meta = await readMeta();
    const next = {
      [TAB_KEY]: Number(tabId),
      [URL_KEY]: url ? normUrl(url) : null,
      [EPOCH_KEY]: meta.epoch
    };
    await chrome.storage.local.set(next);
    await writeHealth("TAGGED", reason, { tab_id: Number(tabId), url: next[URL_KEY], epoch: meta.epoch });
  }

  async function createRoot(reason) {
    const meta = await readMeta();
    const tab = await chrome.tabs.create({ url: CHATGPT_ROOT, active: false });
    if (!Number.isInteger(Number(tab?.id))) throw new Error("supervisor_chat_create_failed");
    const epoch = Math.max(1, meta.epoch + 1);
    await chrome.storage.local.set({
      [TAB_KEY]: Number(tab.id),
      [URL_KEY]: null,
      [EPOCH_KEY]: epoch
    });
    await chrome.storage.session.remove(SNAPSHOT_KEY);
    await writeHealth("BOOTSTRAP_ROOT", reason, { tab_id: Number(tab.id), epoch });
    await waitContent(Number(tab.id));
    await writeHealth("READY_ROOT", reason, { tab_id: Number(tab.id), epoch });
    return chrome.tabs.get(Number(tab.id));
  }

  async function adoptLiveUrl(tab, reason = "url_adopted") {
    const url = normUrl(tab?.url || "");
    if (!url || !isChatgpt(url)) throw new Error("supervisor_chat_url_invalid");
    const meta = await readMeta();
    const stored = meta.url;
    if (isConversation(url) && stored !== url) {
      await chrome.storage.local.set({ [URL_KEY]: url });
      await writeHealth("READY_CONVERSATION", reason, { tab_id: Number(tab.id), url, epoch: meta.epoch });
    } else if (!isConversation(url) && stored) {
      await chrome.storage.local.set({ [URL_KEY]: null });
    }
    return url;
  }

  async function ensure(reason = "ensure") {
    if (ensurePromise) return ensurePromise;
    ensurePromise = (async () => {
      if (!(await enabled())) return { enabled: false, state: "DISABLED" };
      const meta = await readMeta();
      let tab = await tabById(meta.tab_id);
      if (!tab) return createRoot(`${reason}:missing_tab`);

      await adoptLiveUrl(tab, `${reason}:adopt`);
      const exhausted = await probeExhaustion(tab.id);
      if (exhausted?.exhausted === true) return recover(`conversation_exhausted:${exhausted.reason || "detected"}`);

      const snap = await currentSnapshot();
      if (!snapshotFresh(snap)) {
        const previousReloadAt = Date.parse(String(meta.health?.reload_requested_at || ""));
        const reloadStillInGrace = Number.isFinite(previousReloadAt) && Date.now() - previousReloadAt < HEALTH_RELOAD_GRACE_MS;
        if (!reloadStillInGrace) {
          await chrome.tabs.reload(tab.id);
          await writeHealth("RELOAD_REQUESTED", `${reason}:snapshot_stale`, {
            tab_id: tab.id,
            epoch: meta.epoch,
            reload_requested_at: new Date().toISOString()
          });
          return { ...tab, supervisor_health: "RELOAD_REQUESTED" };
        }
        return recover(`${reason}:snapshot_stale_after_reload`);
      }

      await writeHealth(isConversation(tab.url || "") ? "READY_CONVERSATION" : "READY_ROOT", reason, {
        tab_id: tab.id,
        url: isConversation(tab.url || "") ? normUrl(tab.url) : null,
        epoch: meta.epoch,
        snapshot_observed_at: snap.observed_at || null
      });
      return tab;
    })().finally(() => { ensurePromise = null; });
    return ensurePromise;
  }

  async function recover(reason = "recover") {
    if (recoverPromise) return recoverPromise;
    recoverPromise = (async () => {
      if (!(await enabled())) return { enabled: false, state: "DISABLED" };
      const meta = await readMeta();
      const previousCount = Math.max(0, Number(meta.health?.recovery_count || 0));
      if (previousCount >= MAX_RECOVERY_COUNT) {
        await writeHealth("RECOVERY_HOLD", reason, { recovery_count: previousCount, epoch: meta.epoch });
        throw new Error("supervisor_chat_recovery_limit_reached");
      }

      let tab = await tabById(meta.tab_id);
      if (!tab) return createRoot(`${reason}:missing_tab`);

      const epoch = Math.max(1, meta.epoch + 1);
      await chrome.storage.local.set({ [URL_KEY]: null, [EPOCH_KEY]: epoch });
      await chrome.storage.session.remove(SNAPSHOT_KEY);
      await writeHealth("RECOVERING", reason, {
        tab_id: tab.id,
        epoch,
        recovery_count: previousCount + 1
      });

      await chrome.tabs.update(tab.id, { url: CHATGPT_ROOT, active: false });
      await waitContent(tab.id);
      tab = await chrome.tabs.get(tab.id);
      await writeHealth("READY_ROOT", reason, {
        tab_id: tab.id,
        epoch,
        recovery_count: previousCount + 1
      });
      return tab;
    })().finally(() => { recoverPromise = null; });
    return recoverPromise;
  }

  async function pinConversation(tabId, reason = "pin") {
    const tab = await tabById(tabId);
    if (!tab) throw new Error("supervisor_chat_pin_tab_missing");
    if (!isConversation(tab.url || "")) throw new Error("supervisor_chat_pin_not_conversation");
    const meta = await readMeta();
    const url = normUrl(tab.url);
    await chrome.storage.local.set({ [TAB_KEY]: Number(tab.id), [URL_KEY]: url });
    await writeHealth("READY_CONVERSATION", reason, { tab_id: tab.id, url, epoch: meta.epoch });
    return { tab_id: tab.id, url, epoch: meta.epoch };
  }

  async function status() {
    const meta = await readMeta();
    const tab = await tabById(meta.tab_id);
    const snap = await currentSnapshot();
    return {
      ...meta,
      tab_present: Boolean(tab),
      live_url: tab ? normUrl(tab.url || "") : null,
      snapshot_fresh: snapshotFresh(snap),
      snapshot_observed_at: snap?.observed_at || null
    };
  }

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) ensure("alarm").catch(() => {});
  });

  chrome.runtime.onStartup.addListener(() => ensure("browser_start").catch(() => {}));
  chrome.runtime.onInstalled.addListener(() => ensure("install").catch(() => {}));

  chrome.tabs.onRemoved?.addListener?.((tabId) => {
    readMeta().then((meta) => {
      if (Number(meta.tab_id) !== Number(tabId)) return;
      return chrome.storage.local.set({ [TAB_KEY]: null, [URL_KEY]: null })
        .then(() => writeHealth("MISSING", "tab_removed", { tab_id: Number(tabId), epoch: meta.epoch }));
    }).catch(() => {});
  });

  chrome.tabs.onUpdated?.addListener?.((tabId, changeInfo, tab) => {
    if (!changeInfo?.url) return;
    readMeta().then((meta) => {
      if (Number(meta.tab_id) !== Number(tabId) || !isChatgpt(tab?.url || changeInfo.url)) return;
      return adoptLiveUrl(tab || { id: tabId, url: changeInfo.url }, "tab_url_updated");
    }).catch(() => {});
  });

  globalThis.A2_SUPERVISOR_CHAT_ENSURE = ensure;
  globalThis.A2_SUPERVISOR_CHAT_RECOVER = recover;
  globalThis.A2_SUPERVISOR_CHAT_PIN = pinConversation;
  globalThis.A2_SUPERVISOR_CHAT_STATUS = status;
  globalThis.A2_SUPERVISOR_CHAT_SNAPSHOT = currentSnapshot;

  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  ensure("worker_load").catch(() => {});
})();