import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const file = path.join(ROOT, "coordination/chat-control-plane/extension/background-v063.js");
const source = fs.readFileSync(file, "utf8");
const local = new Map([["armed", false],["autoOpenTabs", false],["pollMs", 1000],["chatgptUrl", ""],["zaiUrl", ""],["daemonUrl", "https://example.invalid/bridge"]]);
const bridgeCalls = [];

function storageArea(map) {
  return {
    async get(keys) { const list = Array.isArray(keys) ? keys : (keys && typeof keys === "object" ? Object.keys(keys) : [keys]); const out = {}; for (const key of list) if (map.has(key)) out[key] = map.get(key); return out; },
    async set(obj) { for (const [key, value] of Object.entries(obj)) map.set(key, value); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) map.delete(key); }
  };
}

const chrome = {
  storage: { local: storageArea(local), onChanged: { addListener: () => {} } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
  alarms: { create: async () => {}, onAlarm: { addListener: () => {} } },
  runtime: { onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} }, onMessage: { addListener: () => {} } },
  tabs: { query: async () => [], sendMessage: async () => ({ ok: false }), create: async () => { throw new Error("unexpected_tab_create"); }, get: async () => { throw new Error("unexpected_tab_get"); }, update: async () => { throw new Error("unexpected_tab_update"); } }
};

const context = vm.createContext({ console, chrome, URL, Response, Headers, TextEncoder, Uint8Array, setTimeout, clearTimeout, encodeURIComponent });
context.globalThis = context;
context.A2_SECRET_VAULT_READY = Promise.resolve();
context.A2_BRIDGE_CLIENT_ID = async () => "client-v063";
context.A2_BRIDGE_REQUEST = async (url, init = {}) => {
  bridgeCalls.push({ url, init });
  if (url === "/v1/commands/next") return new Response(JSON.stringify({ command: null, ordering_policy: "STRICT_GLM_FIRST_ACTUATED_V1" }), { status: 200, headers: { "content-type": "application/json" } });
  if (url === "/v1/snapshots") return new Response("{}", { status: 202 });
  return new Response("{}", { status: 200 });
};

vm.runInContext(source, context, { filename: file });
await new Promise((resolve) => setTimeout(resolve, 30));

assert.equal(typeof context.A2_BRIDGE_POLL_NOW, "function");
await context.A2_BRIDGE_POLL_NOW();
assert.equal(bridgeCalls.filter((call) => call.url === "/v1/commands/next").length, 0, "DISARMED bridge still leased model commands");
assert.equal(local.get("bridgeCommandFetchSuppressed"), "DISARMED");

await chrome.storage.local.set({ armed: true });
await context.A2_BRIDGE_POLL_NOW();
assert.equal(bridgeCalls.filter((call) => call.url === "/v1/commands/next").length, 1, "ARMED bridge did not query command plane");

assert.ok(source.includes("globalThis.A2_BRIDGE_POLL_NOW=directPoll"));
assert.ok(source.includes('bridgeCommandFetchSuppressed:"DISARMED"'));

console.log("a2_v063_bridge_disarm_lab: PASS", { bridgeCalls: bridgeCalls.map((call) => call.url) });
