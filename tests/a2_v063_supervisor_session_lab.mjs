import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const file = path.join(ROOT, "coordination/chat-control-plane/extension/supervisor-client-v063.js");
const source = fs.readFileSync(file, "utf8");

const local = new Map([["armed", true]]);
const session = new Map();
const messageListeners = [];
const startupListeners = [];
const fetchCalls = [];
let queuedCommand = null;
let directPollCalls = 0;
let runtimeSendCalls = 0;

function storageArea(map) {
  return {
    async get(keys) { const list = Array.isArray(keys) ? keys : [keys]; const out = {}; for (const key of list) if (map.has(key)) out[key] = map.get(key); return out; },
    async set(obj) { for (const [key, value] of Object.entries(obj)) map.set(key, value); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) map.delete(key); }
  };
}

const chrome = {
  runtime: {
    id: "unit",
    getURL: (p) => `chrome-extension://unit/${p}`,
    getManifest: () => ({ version: "0.6.3" }),
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: (fn) => startupListeners.push(fn) },
    sendMessage: async () => { runtimeSendCalls += 1; return { ok: true }; }
  },
  storage: { local: storageArea(local), session: storageArea(session), onChanged: { addListener: () => {} } },
  alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
  tabs: { query: async () => [], sendMessage: async () => ({ ok: true }) }
};

const context = vm.createContext({
  console, chrome, Headers, Response, Request, URL, TextEncoder, Uint8Array,
  crypto: globalThis.crypto, setTimeout, clearTimeout,
  fetch: async (input, init = {}) => {
    const url = String(input); fetchCalls.push({ url, init });
    if (url.endsWith("/v1/state")) return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { "content-type": "application/json" } });
    if (url.endsWith("/v1/commands/next")) { const command = queuedCommand; queuedCommand = null; return new Response(JSON.stringify({ command }), { status: 200, headers: { "content-type": "application/json" } }); }
    if (/\/v1\/commands\/[^/]+\/result$/.test(url)) return new Response(JSON.stringify({ accepted: true }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("{}", { status: 404 });
  }
});
context.globalThis = context;
context.A2_GET_PAIRING_SECRET = async () => "x".repeat(64);
context.A2_BRIDGE_CLIENT_ID = async () => "client-v063";
context.A2_BRIDGE_POLL_NOW = async () => { directPollCalls += 1; return { ok: true, source: "direct" }; };
context.A2_OPERATOR_CAPTURE_PERCEPTION = async () => ({ captured_at: new Date().toISOString(), url: "https://chatgpt.com/c/x", frame_token: "f", hashes: {}, page: { body_text: "" }, accessibility: [] });
context.A2_OPERATOR_STOP_GENERATION = async () => ({ ok: true });
context.A2_OPERATOR_SCROLL = async () => ({ ok: true });
context.A2_OPERATOR_SEMANTIC_ACTION = async () => ({ ok: true });

vm.runInContext(source, context, { filename: file });
await new Promise((resolve) => setTimeout(resolve, 20));

async function send(message, sender) {
  for (const fn of messageListeners) {
    let settled = false; let result;
    const ret = fn(message, sender, (value) => { settled = true; result = value; });
    if (ret === true) { for (let i = 0; i < 100 && !settled; i += 1) await new Promise((resolve) => setTimeout(resolve, 2)); return result; }
    if (settled) return result;
  }
  return undefined;
}

assert.equal(session.get("a2SupervisorModeV1"), "OFF", "mode must seed in storage.session");
assert.equal(local.has("a2SupervisorModeV1"), false, "CONTROL authority must not persist in storage.local");

const spoof = await send({ type: "A2_SUPERVISOR_SET_MODE", mode: "CONTROL" }, { id: "unit", url: "chrome-extension://unit/sidepanel.html.evil" });
assert.equal(spoof?.ok, false, "prefix-spoofed sidepanel URL was trusted");
assert.equal(session.get("a2SupervisorModeV1"), "OFF");

const granted = await send({ type: "A2_SUPERVISOR_SET_MODE", mode: "CONTROL" }, { id: "unit", url: "chrome-extension://unit/sidepanel.html" });
assert.equal(granted?.ok, true);
assert.equal(session.get("a2SupervisorModeV1"), "CONTROL");

queuedCommand = { command_id: "00000000-0000-4000-8000-000000000063", action: "POLL", platform: null, payload: {} };
await context.A2_SUPERVISOR_POLL();
assert.equal(directPollCalls, 1, "POLL did not use direct bridge API");
assert.equal(runtimeSendCalls, 0, "POLL regressed to service-worker self-message");

assert.equal(startupListeners.length, 1);
await startupListeners[0]();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(session.get("a2SupervisorModeV1"), "OFF", "browser startup must revoke CONTROL");
assert.equal(local.get("armed"), false, "browser startup must DISARM");

assert.ok(!source.includes("sender.url.startsWith(expected)"));
assert.ok(!source.includes('chrome.runtime.sendMessage({type:"BRIDGE_POLL_NOW"'));

console.log("a2_v063_supervisor_session_lab: PASS", { directPollCalls, runtimeSendCalls, fetchCalls: fetchCalls.length });
