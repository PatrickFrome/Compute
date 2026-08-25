"use strict";

const DEFAULTS = Object.freeze({
  daemonUrl: "http://127.0.0.1:8765",
  armed: false,
  autoOpenTabs: true,
  pollMs: 2500,
  chatgptUrl: "",
  zaiUrl: "https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db"
});

const CONTENT_SEND_STATUSES = new Set([
  "SENT_AND_DOM_VERIFIED",
  "SENT_WEAK_DOM_VERIFIED",
  "DUPLICATE_IGNORED"
]);
const inFlightCommands = new Set();
let lastPollAt = 0;
let pollPromise = null;

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    url.search = "";
    let pathname = url.pathname.replace(/\/+$/, "");
    if (!pathname) pathname = "/";
    return `${url.origin}${pathname}`;
  } catch (_) {
    return "";
  }
}

function platformForUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "chatgpt.com" || host === "chat.openai.com") return "CHATGPT";
    if (host === "chat.z.ai") return "GLM_ZAI";
  } catch (_) {}
  return "UNKNOWN";
}

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const settings = { ...DEFAULTS, ...stored };
  settings.daemonUrl = String(settings.daemonUrl || DEFAULTS.daemonUrl).replace(/\/+$/, "");
  settings.pollMs = Math.max(1000, Math.min(30000, Number(settings.pollMs) || DEFAULTS.pollMs));
  return settings;
}

async function ensureClientId() {
  const { clientId } = await chrome.storage.local.get("clientId");
  if (clientId) return clientId;
  const next = crypto.randomUUID();
  await chrome.storage.local.set({ clientId: next });
  return next;
}

async function setBadge() {
  const settings = await getSettings();
  await chrome.action.setBadgeText({ text: settings.armed ? "ON" : "OFF" });
  await chrome.action.setBadgeBackgroundColor({ color: settings.armed ? "#16803a" : "#5d6470" });
  await chrome.action.setTitle({
    title: settings.armed
      ? "METAENGINE Chat Control Plane — ARMED"
      : "METAENGINE Chat Control Plane — DISARMED"
  });
}

async function daemonFetch(path, init = {}) {
  const settings = await getSettings();
  const clientId = await ensureClientId();
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json");
  headers.set("x-a2-chat-bridge-client", clientId);
  return fetch(`${settings.daemonUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });
}

async function reportSnapshot(tabId, snapshot) {
  const payload = {
    schema: "metaengine.chat-bridge.snapshot-envelope.v1",
    tab_id: tabId,
    platform: snapshot?.platform || "UNKNOWN",
    observed_at: new Date().toISOString(),
    snapshot
  };
  await chrome.storage.local.set({ [`snapshot:${payload.platform}`]: payload });
  try {
    const response = await daemonFetch("/v1/snapshots", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`snapshot_http_${response.status}`);
  } catch (error) {
    await chrome.storage.local.set({
      daemonLastError: String(error?.message || error),
      daemonLastErrorAt: new Date().toISOString()
    });
  }
}

function targetUrlFor(command, settings) {
  if (command.target_platform === "CHATGPT") return normalizeUrl(settings.chatgptUrl);
  if (command.target_platform === "GLM_ZAI") return normalizeUrl(settings.zaiUrl);
  return "";
}

async function findPinnedTab(targetUrl, platform) {
  const tabs = await chrome.tabs.query({});
  const normalized = normalizeUrl(targetUrl);
  return tabs.find((tab) => {
    if (!tab.id || !tab.url) return false;
    return platformForUrl(tab.url) === platform && normalizeUrl(tab.url) === normalized;
  }) || null;
}

async function pollPinnedTabSnapshots() {
  const settings = await getSettings();
  const targets = [];
  if (settings.chatgptUrl) targets.push({ url: settings.chatgptUrl, platform: "CHATGPT" });
  if (settings.zaiUrl) targets.push({ url: settings.zaiUrl, platform: "GLM_ZAI" });
  await Promise.all(targets.map(async (target) => {
    try {
      const tab = await findPinnedTab(target.url, target.platform);
      if (!tab?.id) return;
      const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_CHAT_SNAPSHOT" });
      if (response?.ok && response?.snapshot) {
        await reportSnapshot(tab.id, response.snapshot);
      }
    } catch (_) {}
  }));
}

async function waitForContentScript(tabId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "GET_CHAT_SNAPSHOT" });
      if (response?.ok && response.snapshot) return response.snapshot;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("content_script_not_ready");
}

async function resolveTargetTab(command, settings) {
  const targetUrl = targetUrlFor(command, settings);
  if (!targetUrl) throw new Error(`target_url_not_configured:${command.target_platform}`);

  let tab = await findPinnedTab(targetUrl, command.target_platform);
  if (!tab && settings.autoOpenTabs) {
    tab = await chrome.tabs.create({ url: targetUrl, active: false });
    await waitForContentScript(tab.id);
  }
  if (!tab?.id) throw new Error(`target_tab_not_found:${command.target_platform}`);

  const live = await chrome.tabs.get(tab.id);
  const actual = normalizeUrl(live.url || "");
  if (actual !== targetUrl) {
    throw new Error(`target_url_mismatch:${actual}:${targetUrl}`);
  }
  return live;
}

async function postCommandResult(commandId, result) {
  try {
    const response = await daemonFetch(`/v1/commands/${encodeURIComponent(commandId)}/result`, {
      method: "POST",
      body: JSON.stringify(result)
    });
    if (!response.ok) throw new Error(`result_http_${response.status}`);
    return true;
  } catch (error) {
    await chrome.storage.local.set({
      daemonLastError: `result:${String(error?.message || error)}`,
      daemonLastErrorAt: new Date().toISOString()
    });
    return false;
  }
}

async function executeCommand(command) {
  const settings = await getSettings();
  const commandId = String(command?.command_id || "");
  if (!commandId) throw new Error("missing_command_id");
  if (!settings.armed) {
    await postCommandResult(commandId, {
      status: "BLOCKED_NOT_ARMED",
      authority_effect: false,
      captured_at: new Date().toISOString()
    });
    return;
  }
  if (inFlightCommands.has(commandId)) return;
  inFlightCommands.add(commandId);

  try {
    const tab = await resolveTargetTab(command, settings);
    const before = await waitForContentScript(tab.id, 8000);
    if (before.platform !== command.target_platform) {
      throw new Error(`platform_mismatch:${before.platform}:${command.target_platform}`);
    }
    if (normalizeUrl(before.url) !== targetUrlFor(command, settings)) {
      throw new Error("snapshot_url_not_pinned_target");
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "EXECUTE_CHAT_SEND",
      command: {
        command_id: commandId,
        prompt: String(command.prompt || ""),
        allow_while_generating: false
      }
    });
    if (!response?.ok) throw new Error(response?.error || "content_send_failed");

    const resultStatus = String(response.result?.status || "");
    if (!CONTENT_SEND_STATUSES.has(resultStatus)) {
      throw new Error(`unexpected_send_result_status:${resultStatus || "missing"}`);
    }

    await postCommandResult(commandId, {
      status: resultStatus,
      target_platform: command.target_platform,
      target_url: normalizeUrl(before.url),
      tab_id: tab.id,
      clicked_send_button: response.result?.clicked_send_button === true,
      prompt_hash_local: response.result?.prompt_hash_local || null,
      verification: response.result?.verification || null,
      authority_effect: false,
      captured_at: new Date().toISOString()
    });
  } catch (error) {
    await postCommandResult(commandId, {
      status: "FAILED_CLOSED",
      error: String(error?.message || error),
      authority_effect: false,
      captured_at: new Date().toISOString()
    });
  } finally {
    inFlightCommands.delete(commandId);
  }
}

async function pollCommands(force = false) {
  if (pollPromise) return pollPromise;
  pollPromise = (async () => {
    const settings = await getSettings();
    if (!force && Date.now() - lastPollAt < settings.pollMs) return;
    lastPollAt = Date.now();
    try {
      const response = await daemonFetch("/v1/commands/next", { method: "GET" });
      if (!response.ok) throw new Error(`command_http_${response.status}`);
      const body = await response.json();
      if (body?.command) await executeCommand(body.command);
      await chrome.storage.local.set({
        daemonOnlineAt: new Date().toISOString(),
        daemonLastError: null
      });
    } catch (error) {
      await chrome.storage.local.set({
        daemonLastError: String(error?.message || error),
        daemonLastErrorAt: new Date().toISOString()
      });
    }
  })().finally(() => {
    pollPromise = null;
  });
  return pollPromise;
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const seed = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (existing[key] === undefined) seed[key] = value;
  }
  await chrome.storage.local.set(seed);
  await ensureClientId();
  await chrome.alarms.create("a2-chat-bridge-poll", { periodInMinutes: 0.5 });
  await setBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create("a2-chat-bridge-poll", { periodInMinutes: 0.5 });
  await setBadge();
  await pollCommands(true);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "a2-chat-bridge-poll") return;
  pollPinnedTabSnapshots().finally(() => pollCommands(true));
});

chrome.action.onClicked.addListener(async () => {
  const settings = await getSettings();
  await chrome.storage.local.set({ armed: !settings.armed });
  await setBadge();
  if (!settings.armed) await pollCommands(true);
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes.armed || changes.chatgptUrl || changes.zaiUrl || changes.daemonUrl) {
    await setBadge();
    await pollCommands(true);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CHAT_SNAPSHOT" && sender.tab?.id && message.snapshot) {
    reportSnapshot(sender.tab.id, message.snapshot)
      .then(() => pollCommands(false))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === "BRIDGE_POLL_NOW") {
    pollCommands(true)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  return false;
});

setBadge();
pollCommands(true);
