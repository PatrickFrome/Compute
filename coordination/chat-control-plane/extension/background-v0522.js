(() => {
"use strict";

const bootstrap = globalThis.A2_BRIDGE_BOOTSTRAP || {};
const DEFAULTS = Object.freeze({
  daemonUrl: String(bootstrap.daemonUrl || "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-chat-bridge-remote"),
  bridgeSecret: String(bootstrap.bridgeSecret || ""),
  armed: false,
  autoOpenTabs: true,
  pollMs: 2500,
  chatgptUrl: "",
  zaiUrl: "https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db"
});
const CHATGPT_ROOT_URL = "https://chatgpt.com/";
const CHATGPT_ROLLOVER_TIMEOUT_MS = 12000;
const CONTENT_SEND_STATUSES = new Set(["SENT_AND_DOM_VERIFIED", "SENT_WEAK_DOM_VERIFIED", "DUPLICATE_IGNORED"]);
const inFlightCommands = new Set();
const rolloverTabs = new Set();
let lastPollAt = 0;
let pollPromise = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (value) => String(value ?? "").replace(/\r\n/g, "\n").trim();
const canonicalVisible = (value) => String(value ?? "")
  .replace(/\r\n?/g, "\n")
  .replace(/\u00a0/g, " ")
  .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
  .replace(/\s+/gu, " ")
  .trim();

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${url.pathname}`;
  } catch (_) { return ""; }
}
function isLoopbackBridge(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch (_) { return false; }
}
function platformForUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "chatgpt.com" || host === "chat.openai.com") return "CHATGPT";
    if (host === "chat.z.ai") return "GLM_ZAI";
  } catch (_) {}
  return "UNKNOWN";
}
function isChatgptConversationUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["chatgpt.com", "chat.openai.com"].includes(url.hostname.toLowerCase()) && url.pathname.startsWith("/c/");
  } catch (_) { return false; }
}
function isConversationExhaustedError(value) {
  return String(value || "").includes("chatgpt_cdp_conversation_exhausted");
}

function snapshotEvidence(before, after, prompt, platform) {
  const messages = Array.isArray(after?.messages) ? after.messages : [];
  const expected = platform === "CHATGPT" ? canonicalVisible(prompt) : normalize(prompt);
  const exactUserTurn = messages.some((message) => {
    if (message?.role !== "user") return false;
    const actual = platform === "CHATGPT" ? canonicalVisible(message?.text) : normalize(message?.text);
    return actual === expected;
  });
  const beforeCount = Number(before?.message_count || 0);
  const afterCount = Number(after?.message_count || 0);
  const composerEmpty = normalize(after?.composer_text || "") === "";
  const countAdvanced = afterCount > beforeCount;
  return {
    verified: exactUserTurn || (composerEmpty && countAdvanced),
    exact_user_turn_seen: exactUserTurn,
    verification_strength: exactUserTurn ? "EXACT_USER_TURN" : (composerEmpty && countAdvanced ? "CLEARED_AND_COUNT_ADVANCED" : "NONE"),
    composer_cleared: composerEmpty,
    message_count_before: beforeCount,
    message_count_after: afterCount,
    after_snapshot: after || null
  };
}
function resultFromEvidence(commandId, evidence, extra = {}) {
  return {
    status: evidence.exact_user_turn_seen ? "SENT_AND_DOM_VERIFIED" : "SENT_WEAK_DOM_VERIFIED",
    command_id: commandId,
    clicked_send_button: true,
    verification: evidence,
    ...extra
  };
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
async function singleOpenChatgptConversation() {
  const tabs = await chrome.tabs.query({});
  const unique = [...new Set(tabs
    .filter((tab) => tab?.id && tab?.url && platformForUrl(tab.url) === "CHATGPT")
    .map((tab) => normalizeUrl(tab.url))
    .filter((url) => isChatgptConversationUrl(url)))];
  return unique.length === 1 ? unique[0] : "";
}
async function setBadge() {
  const settings = await getSettings();
  await chrome.action.setBadgeText({ text: settings.armed ? "ON" : "OFF" });
  await chrome.action.setBadgeBackgroundColor({ color: settings.armed ? "#16803a" : "#5d6470" });
  await chrome.action.setTitle({ title: settings.armed ? "METAENGINE Chat Control Plane — ARMED" : "METAENGINE Chat Control Plane — DISARMED" });
}
async function daemonFetch(path, init = {}) {
  const settings = await getSettings();
  const clientId = await ensureClientId();
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json");
  headers.set("x-a2-chat-bridge-client", clientId);
  return fetch(`${settings.daemonUrl}${path}`, { ...init, headers, cache: "no-store" });
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
    const response = await daemonFetch("/v1/snapshots", { method: "POST", body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`snapshot_http_${response.status}`);
  } catch (error) {
    await chrome.storage.local.set({ daemonLastError: String(error?.message || error), daemonLastErrorAt: new Date().toISOString() });
  }
}
async function currentSnapshotEnvelopes() {
  const stored = await chrome.storage.local.get(["snapshot:CHATGPT", "snapshot:GLM_ZAI"]);
  return [stored["snapshot:CHATGPT"], stored["snapshot:GLM_ZAI"]].filter((item) => item?.snapshot);
}
async function refreshSnapshotEnvelopesIfStale(settings) {
  let envelopes = await currentSnapshotEnvelopes();
  const maxAgeMs = Math.max(5000, settings.pollMs * 2);
  const now = Date.now();
  const stale = envelopes.length < 2 || envelopes.some((envelope) => {
    const observed = Date.parse(envelope?.observed_at || "");
    return !Number.isFinite(observed) || now - observed > maxAgeMs;
  });
  if (stale) {
    await pollPinnedTabSnapshots();
    envelopes = await currentSnapshotEnvelopes();
  }
  return envelopes;
}
function targetUrlFor(command, settings) {
  if (command.target_platform === "CHATGPT") return normalizeUrl(settings.chatgptUrl);
  if (command.target_platform === "GLM_ZAI") return normalizeUrl(settings.zaiUrl);
  return "";
}
async function findPinnedTab(targetUrl, platform) {
  const tabs = await chrome.tabs.query({});
  const normalized = normalizeUrl(targetUrl);
  return tabs.find((tab) => tab?.id && tab?.url && platformForUrl(tab.url) === platform && normalizeUrl(tab.url) === normalized) || null;
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
      if (response?.ok && response?.snapshot) await reportSnapshot(tab.id, response.snapshot);
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
    await sleep(200);
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
  if (actual !== targetUrl) throw new Error(`target_url_mismatch:${actual}:${targetUrl}`);
  return live;
}
async function sendChatgptViaContent(tab, command, settings) {
  const before = await waitForContentScript(tab.id, 8000);
  if (before.platform !== "CHATGPT") throw new Error(`platform_mismatch:${before.platform}:CHATGPT`);
  if (normalizeUrl(before.url) !== targetUrlFor(command, settings)) throw new Error("snapshot_url_not_pinned_target");
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "EXECUTE_CHAT_SEND",
    command: { command_id: String(command.command_id || ""), prompt: String(command.prompt || ""), allow_while_generating: false }
  });
  if (!response?.ok) throw Object.assign(new Error(response?.error || "content_send_failed"), { before });
  const status = String(response.result?.status || "");
  if (!CONTENT_SEND_STATUSES.has(status)) throw Object.assign(new Error(`unexpected_send_result_status:${status || "missing"}`), { before });
  return response.result;
}

async function waitForNewChatgptConversation(tabId, prompt) {
  const deadline = Date.now() + CHATGPT_ROLLOVER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (isChatgptConversationUrl(tab?.url || "")) {
      try {
        const snapshot = await waitForContentScript(tabId, 1800);
        const evidence = snapshotEvidence({ message_count: 0 }, snapshot, prompt, "CHATGPT");
        if (evidence.verified) return { tab, snapshot, evidence };
      } catch (_) {}
    }
    await sleep(150);
  }
  throw new Error("chatgpt_rollover_verification_timeout");
}
async function rolloverChatgptAndRetry(command, tab) {
  if (rolloverTabs.has(tab.id)) throw new Error("chatgpt_rollover_already_in_flight");
  rolloverTabs.add(tab.id);
  await chrome.storage.local.set({ chatgptRolloverPending: true, chatgptRolloverPendingTabId: tab.id });
  try {
    await chrome.tabs.update(tab.id, { url: CHATGPT_ROOT_URL, active: false });
    const root = await waitForContentScript(tab.id, 15000);
    if (root.platform !== "CHATGPT") throw new Error("chatgpt_rollover_root_platform_mismatch");
    if (normalizeUrl(root.url) !== normalizeUrl(CHATGPT_ROOT_URL)) throw new Error("chatgpt_rollover_root_url_mismatch");
    if (root.generating) throw new Error("chatgpt_rollover_root_generating");
    if (canonicalVisible(root.composer_text || "") !== "") throw new Error("chatgpt_rollover_root_composer_not_empty");
    if (typeof globalThis.A2_CHATGPT_TRUSTED_SEND !== "function") throw new Error("chatgpt_rollover_trusted_send_unavailable");
    const sent = await globalThis.A2_CHATGPT_TRUSTED_SEND(tab.id, String(command.prompt || ""));
    if (sent?.ok !== true) throw new Error(`chatgpt_rollover_send_failed:${sent?.error || "unknown"}`);
    const completed = await waitForNewChatgptConversation(tab.id, String(command.prompt || ""));
    const newUrl = normalizeUrl(completed.tab.url || "");
    await chrome.storage.local.set({ chatgptUrl: newUrl, chatgptRolloverPending: false, chatgptRolloverPendingTabId: null });
    await reportSnapshot(tab.id, completed.snapshot);
    return resultFromEvidence(command.command_id, completed.evidence, { recovery: "CHATGPT_NEW_CHAT_ROLLOVER" });
  } finally {
    await chrome.storage.local.set({ chatgptRolloverPending: false, chatgptRolloverPendingTabId: null });
    rolloverTabs.delete(tab.id);
  }
}
async function postCommandResult(commandId, result) {
  try {
    const response = await daemonFetch(`/v1/commands/${encodeURIComponent(commandId)}/result`, { method: "POST", body: JSON.stringify(result) });
    if (!response.ok) throw new Error(`result_http_${response.status}`);
    return true;
  } catch (error) {
    await chrome.storage.local.set({ daemonLastError: `result:${String(error?.message || error)}`, daemonLastErrorAt: new Date().toISOString() });
    return false;
  }
}
function scheduleReciprocalPoll() {
  setTimeout(() => { pollPinnedTabSnapshots().finally(() => pollCommands(true)); }, 5200);
}
async function executeCommand(command) {
  const settings = await getSettings();
  const commandId = String(command?.command_id || "");
  if (!commandId) throw new Error("missing_command_id");
  if (!settings.armed) {
    await postCommandResult(commandId, { status: "BLOCKED_NOT_ARMED", authority_effect: false, captured_at: new Date().toISOString() });
    return;
  }
  if (inFlightCommands.has(commandId)) return;
  inFlightCommands.add(commandId);
  try {
    const tab = await resolveTargetTab(command, settings);
    let result;
    if (command.target_platform === "GLM_ZAI") {
      if (typeof globalThis.A2_GLM_TRUSTED_SEND !== "function") throw new Error("glm_trusted_send_unavailable");
      result = await globalThis.A2_GLM_TRUSTED_SEND(tab.id, command);
    } else if (command.target_platform === "CHATGPT") {
      try {
        result = await sendChatgptViaContent(tab, command, settings);
      } catch (error) {
        if (isConversationExhaustedError(error?.message || error)) result = await rolloverChatgptAndRetry(command, tab);
        else throw error;
      }
    } else {
      throw new Error(`unsupported_target_platform:${command.target_platform}`);
    }

    const currentSettings = await getSettings();
    const targetUrl = targetUrlFor(command, currentSettings) || normalizeUrl((await chrome.tabs.get(tab.id)).url || "");
    await postCommandResult(commandId, {
      status: String(result?.status || "FAILED_CLOSED"),
      target_platform: command.target_platform,
      target_url: targetUrl,
      tab_id: tab.id,
      clicked_send_button: result?.clicked_send_button === true,
      prompt_hash_local: result?.prompt_hash_local || null,
      transport_trace_id: result?.transport_trace_id || null,
      verification: result?.verification || null,
      recovery: result?.recovery || null,
      authority_effect: false,
      captured_at: new Date().toISOString()
    });
    scheduleReciprocalPoll();
  } catch (error) {
    await postCommandResult(commandId, { status: "FAILED_CLOSED", error: String(error?.message || error), authority_effect: false, captured_at: new Date().toISOString() });
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
      const snapshots = await refreshSnapshotEnvelopesIfStale(settings);
      const response = await daemonFetch("/v1/commands/next", { method: "POST", body: JSON.stringify({ snapshots }) });
      if (!response.ok) throw new Error(`command_http_${response.status}`);
      const body = await response.json();
      if (body?.command) await executeCommand(body.command);
      await chrome.storage.local.set({ daemonOnlineAt: new Date().toISOString(), daemonLastError: null });
    } catch (error) {
      await chrome.storage.local.set({ daemonLastError: String(error?.message || error), daemonLastErrorAt: new Date().toISOString() });
    }
  })().finally(() => { pollPromise = null; });
  return pollPromise;
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const seed = {};
  for (const [key, value] of Object.entries(DEFAULTS)) if (existing[key] === undefined) seed[key] = value;
  if (isLoopbackBridge(existing.daemonUrl) && String(bootstrap.daemonUrl || "").startsWith("https://")) {
    seed.daemonUrl = bootstrap.daemonUrl;
    if (String(bootstrap.bridgeSecret || "").length >= 32) seed.bridgeSecret = bootstrap.bridgeSecret;
  }
  if (!existing.chatgptUrl) {
    const detected = await singleOpenChatgptConversation();
    if (detected) seed.chatgptUrl = detected;
  }
  await chrome.storage.local.set(seed);
  await ensureClientId();
  await chrome.alarms.create("a2-chat-bridge-poll", { periodInMinutes: 0.5 });
  await setBadge();
  await pollPinnedTabSnapshots();
  await pollCommands(true);
});
chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create("a2-chat-bridge-poll", { periodInMinutes: 0.5 });
  await setBadge();
  await pollPinnedTabSnapshots();
  await pollCommands(true);
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "a2-chat-bridge-poll") pollPinnedTabSnapshots().finally(() => pollCommands(true));
});
chrome.action.onClicked.addListener(async () => {
  const settings = await getSettings();
  await chrome.storage.local.set({ armed: !settings.armed });
  await setBadge();
  if (!settings.armed) await pollCommands(true);
});
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes.armed || changes.chatgptUrl || changes.zaiUrl || changes.daemonUrl || changes.bridgeSecret) {
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
    pollPinnedTabSnapshots()
      .then(() => pollCommands(true))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  return false;
});

setBadge();
pollCommands(true);
})();
