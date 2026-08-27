import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const file = path.join(ROOT, "coordination/chat-control-plane/extension/supervisor-chat-session-v063.js");
const source = fs.readFileSync(file, "utf8");
const local = new Map();
const session = new Map();
const alarms = [];
const removedListeners = [];
const updatedListeners = [];
const tabs = new Map();
let nextTabId = 40;
let exhaustion = false;
let reloadCalls = 0;

function storageArea(map) {
  return {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : (keys && typeof keys === "object" ? Object.keys(keys) : [keys]);
      const out = {};
      for (const key of list) if (map.has(key)) out[key] = map.get(key);
      return out;
    },
    async set(obj) { for (const [key, value] of Object.entries(obj)) map.set(key, value); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) map.delete(key); }
  };
}

function snapshotFor(tab) {
  return {
    platform: "CHATGPT",
    url: tab.url,
    message_count: 0,
    messages: [],
    captured_at: new Date().toISOString()
  };
}

const chrome = {
  storage: { local: storageArea(local), session: storageArea(session) },
  alarms: {
    create: async (name, info) => { alarms.push({ name, info }); },
    onAlarm: { addListener: () => {} }
  },
  runtime: {
    onStartup: { addListener: () => {} },
    onInstalled: { addListener: () => {} }
  },
  tabs: {
    async create({ url, active }) {
      const tab = { id: nextTabId++, url, active, discarded: false };
      tabs.set(tab.id, tab);
      return { ...tab };
    },
    async get(id) {
      if (!tabs.has(Number(id))) throw new Error("tab_missing");
      return { ...tabs.get(Number(id)) };
    },
    async update(id, change) {
      if (!tabs.has(Number(id))) throw new Error("tab_missing");
      const tab = { ...tabs.get(Number(id)), ...change };
      tabs.set(Number(id), tab);
      return { ...tab };
    },
    async reload(id) {
      if (!tabs.has(Number(id))) throw new Error("tab_missing");
      reloadCalls += 1;
    },
    async sendMessage(id, message) {
      if (!tabs.has(Number(id))) throw new Error("tab_missing");
      const tab = tabs.get(Number(id));
      if (message?.type === "GET_CHAT_SNAPSHOT") return { ok: true, snapshot: snapshotFor(tab) };
      if (message?.type === "A2_CHATGPT_EXHAUSTION_STATUS") return { ok: true, exhausted: exhaustion, reason: exhaustion ? "conversation_length_limit" : "not_detected" };
      return { ok: false };
    },
    onRemoved: { addListener: (fn) => removedListeners.push(fn) },
    onUpdated: { addListener: (fn) => updatedListeners.push(fn) }
  }
};

const context = vm.createContext({ console, chrome, URL, setTimeout, clearTimeout });
context.globalThis = context;
vm.runInContext(source, context, { filename: file });
await new Promise((resolve) => setTimeout(resolve, 30));

assert.equal(typeof context.A2_SUPERVISOR_CHAT_ENSURE, "function");
assert.equal(typeof context.A2_SUPERVISOR_CHAT_RECOVER, "function");
assert.equal(typeof context.A2_SUPERVISOR_CHAT_PIN, "function");
assert.equal(typeof context.A2_SUPERVISOR_CHAT_STATUS, "function");
assert.ok(alarms.some((row) => row.name === "a2-supervisor-chat-health" && row.info?.periodInMinutes === 0.5));

const initial = await context.A2_SUPERVISOR_CHAT_STATUS();
assert.equal(initial.enabled, true);
assert.equal(initial.tab_present, true, "worker load did not create tagged supervisor root tab");
const tabId = initial.tab_id;
assert.ok(Number.isInteger(tabId));
assert.equal(local.get("a2SupervisorChatUrlV1"), null);
assert.ok(Number(local.get("a2SupervisorChatEpochV1")) >= 1);
assert.equal(tabs.get(tabId)?.url, "https://chatgpt.com/");

const conversationUrl = "https://chatgpt.com/c/supervisor-session-1";
tabs.set(tabId, { ...tabs.get(tabId), url: conversationUrl });
for (const listener of updatedListeners) listener(tabId, { url: conversationUrl }, { ...tabs.get(tabId) });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(local.get("a2SupervisorChatUrlV1"), conversationUrl);
const pinned = await context.A2_SUPERVISOR_CHAT_PIN(tabId, "test_pin");
assert.equal(pinned.url, conversationUrl);

await chrome.storage.session.set({
  a2SupervisorChatSnapshotV1: {
    observed_at: new Date().toISOString(),
    tab_id: tabId,
    url: conversationUrl,
    snapshot: { platform: "CHATGPT", url: conversationUrl, message_count: 2, messages: [] }
  }
});
const ready = await context.A2_SUPERVISOR_CHAT_ENSURE("test_ready");
assert.equal(ready.id, tabId);
assert.equal(local.get("a2SupervisorChatHealthV1")?.state, "READY_CONVERSATION");
assert.equal(reloadCalls, 0);

const epochBeforeRecovery = Number(local.get("a2SupervisorChatEpochV1"));
exhaustion = true;
const recovered = await context.A2_SUPERVISOR_CHAT_ENSURE("test_exhausted");
assert.equal(recovered.id, tabId, "recovery should reuse the dedicated supervisor tab");
assert.equal(tabs.get(tabId)?.url, "https://chatgpt.com/");
assert.equal(local.get("a2SupervisorChatUrlV1"), null);
assert.ok(Number(local.get("a2SupervisorChatEpochV1")) > epochBeforeRecovery);
assert.equal(local.get("a2SupervisorChatHealthV1")?.state, "READY_ROOT");
exhaustion = false;

await chrome.storage.session.set({
  a2SupervisorChatSnapshotV1: {
    observed_at: new Date(Date.now() - 120_000).toISOString(),
    tab_id: tabId,
    url: "https://chatgpt.com/",
    snapshot: { platform: "CHATGPT", url: "https://chatgpt.com/", message_count: 0, messages: [] }
  }
});
await context.A2_SUPERVISOR_CHAT_ENSURE("test_stale_first");
assert.equal(reloadCalls, 1, "first stale snapshot must request one reload before destructive recovery");
assert.equal(local.get("a2SupervisorChatHealthV1")?.state, "RELOAD_REQUESTED");

const health = local.get("a2SupervisorChatHealthV1");
await chrome.storage.local.set({
  a2SupervisorChatHealthV1: {
    ...health,
    reload_requested_at: new Date(Date.now() - 60_000).toISOString()
  }
});
const epochBeforeStaleRecovery = Number(local.get("a2SupervisorChatEpochV1"));
await context.A2_SUPERVISOR_CHAT_ENSURE("test_stale_second");
assert.ok(Number(local.get("a2SupervisorChatEpochV1")) > epochBeforeStaleRecovery);
assert.equal(local.get("a2SupervisorChatHealthV1")?.state, "READY_ROOT");

for (const listener of removedListeners) listener(tabId);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(local.get("a2SupervisorChatTabIdV1"), null);
assert.equal(local.get("a2SupervisorChatHealthV1")?.state, "MISSING");

assert.ok(source.includes("A2_CHATGPT_EXHAUSTION_STATUS"));
assert.ok(source.includes("a2SupervisorChatSnapshotV1"));
assert.ok(source.includes("snapshot_stale_after_reload"));
assert.ok(source.includes("supervisor_chat_recovery_limit_reached"));

console.log("a2_v063_supervisor_chat_session_lab: PASS", {
  tabId,
  reloadCalls,
  epoch: local.get("a2SupervisorChatEpochV1"),
  finalHealth: local.get("a2SupervisorChatHealthV1")?.state
});