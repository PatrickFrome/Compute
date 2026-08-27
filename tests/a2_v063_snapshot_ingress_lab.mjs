import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const file = path.join(ROOT, "coordination/chat-control-plane/extension/background-v063.js");
const source = fs.readFileSync(file, "utf8");
const operatorUrl = "https://chatgpt.com/c/operator-063";
const supervisorUrl = "https://chatgpt.com/c/supervisor-063";
const local = new Map([
  ["armed", false], ["autoOpenTabs", false], ["pollMs", 1000],
  ["chatgptUrl", operatorUrl], ["zaiUrl", ""], ["daemonUrl", "https://example.invalid/bridge"]
]);
const session = new Map();
const bridgeCalls = [];
const messageListeners = [];

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

const chrome = {
  storage: {
    local: storageArea(local),
    session: storageArea(session),
    onChanged: { addListener: () => {} }
  },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
  alarms: { create: async () => {}, onAlarm: { addListener: () => {} } },
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: (fn) => messageListeners.push(fn) }
  },
  tabs: {
    query: async () => [],
    sendMessage: async () => ({ ok: false }),
    create: async () => { throw new Error("unexpected_tab_create"); },
    get: async () => { throw new Error("unexpected_tab_get"); },
    update: async () => { throw new Error("unexpected_tab_update"); }
  }
};

const context = vm.createContext({ console, chrome, URL, Response, Headers, TextEncoder, Uint8Array, setTimeout, clearTimeout, encodeURIComponent });
context.globalThis = context;
context.A2_SECRET_VAULT_READY = Promise.resolve();
context.A2_BRIDGE_CLIENT_ID = async () => "client-v063-ingress";
context.A2_BRIDGE_REQUEST = async (url, init = {}) => {
  bridgeCalls.push({ url, init });
  if (url === "/v1/snapshots") return new Response("{}", { status: 202 });
  if (url === "/v1/commands/next") return new Response(JSON.stringify({ command: null }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response("{}", { status: 200 });
};

vm.runInContext(source, context, { filename: file });
await new Promise((resolve) => setTimeout(resolve, 30));
assert.ok(messageListeners.length >= 1, "background did not register runtime message listener");

async function sendSnapshot(tab, snapshot) {
  for (const fn of messageListeners) {
    let settled = false;
    let value;
    const ret = fn({ type: "CHAT_SNAPSHOT", snapshot }, { tab }, (response) => { settled = true; value = response; });
    if (ret === true) {
      for (let i = 0; i < 100 && !settled; i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
      return value;
    }
    if (settled) return value;
  }
  return undefined;
}

const operatorSnapshot = { platform: "CHATGPT", url: operatorUrl, message_count: 3, messages: [{ role: "assistant", text: "operator" }] };
const operatorResult = await sendSnapshot({ id: 11, url: operatorUrl }, operatorSnapshot);
assert.equal(operatorResult?.ok, true);
assert.equal(operatorResult?.accepted, true);
assert.equal(operatorResult?.role, "OPERATOR");
assert.equal(local.get("snapshot:CHATGPT")?.tab_id, 11);
const snapshotPostsAfterOperator = bridgeCalls.filter((x) => x.url === "/v1/snapshots").length;
assert.equal(snapshotPostsAfterOperator, 1);

const unmanagedSnapshot = { platform: "CHATGPT", url: supervisorUrl, message_count: 4, messages: [{ role: "assistant", text: "unmanaged" }] };
const unmanagedResult = await sendSnapshot({ id: 22, url: supervisorUrl }, unmanagedSnapshot);
assert.equal(unmanagedResult?.ok, true);
assert.equal(unmanagedResult?.accepted, false);
assert.equal(unmanagedResult?.role, "UNMANAGED");
assert.equal(local.get("snapshot:CHATGPT")?.tab_id, 11, "unmanaged ChatGPT tab polluted operator snapshot");
assert.equal(bridgeCalls.filter((x) => x.url === "/v1/snapshots").length, snapshotPostsAfterOperator);

await chrome.storage.local.set({ a2SupervisorChatUrlV1: supervisorUrl, a2SupervisorChatTabIdV1: 22 });
const supervisorSnapshot = { platform: "CHATGPT", url: supervisorUrl, message_count: 5, messages: [{ role: "assistant", text: "supervisor" }] };
const supervisorResult = await sendSnapshot({ id: 22, url: supervisorUrl }, supervisorSnapshot);
assert.equal(supervisorResult?.ok, true);
assert.equal(supervisorResult?.accepted, true);
assert.equal(supervisorResult?.role, "SUPERVISOR");
assert.equal(session.get("a2SupervisorChatSnapshotV1")?.tab_id, 22);
assert.equal(session.get("a2SupervisorChatSnapshotV1")?.snapshot?.messages?.[0]?.text, "supervisor");
assert.equal(local.get("snapshot:CHATGPT")?.tab_id, 11, "supervisor ChatGPT tab polluted operator snapshot");
assert.equal(bridgeCalls.filter((x) => x.url === "/v1/snapshots").length, snapshotPostsAfterOperator, "supervisor snapshot leaked into operator bridge");

const spoofResult = await sendSnapshot({ id: 33, url: supervisorUrl }, { platform: "GLM_ZAI", url: supervisorUrl, message_count: 9, messages: [] });
assert.equal(spoofResult?.accepted, false);
assert.equal(spoofResult?.reason, "platform_mismatch");

assert.ok(source.includes("ingestContentSnapshot"));
assert.ok(source.includes("a2SupervisorChatSnapshotV1"));
assert.ok(source.includes("0.6.3-supervisor-authority-dev.2"));

console.log("a2_v063_snapshot_ingress_lab: PASS", {
  snapshotPosts: bridgeCalls.filter((x) => x.url === "/v1/snapshots").length,
  operatorTab: local.get("snapshot:CHATGPT")?.tab_id,
  supervisorTab: session.get("a2SupervisorChatSnapshotV1")?.tab_id
});