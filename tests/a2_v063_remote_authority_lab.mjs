import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const file = path.join(ROOT, "coordination/chat-control-plane/extension/supervisor-client-v063-authority.js");
const source = fs.readFileSync(file, "utf8");

const local = new Map([["armed", true]]);
const session = new Map();
const messageListeners = [];
const startupListeners = [];
const nextModes = [];
const resultBodies = [];
let queuedCommand = null;
let directPollCalls = 0;
let captureCalls = 0;

function storageArea(map) {
  return {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const key of list) if (map.has(key)) out[key] = map.get(key);
      return out;
    },
    async set(obj) { for (const [key, value] of Object.entries(obj)) map.set(key, value); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) map.delete(key); }
  };
}

function commandAllowedInMode(command, mode) {
  if (!command) return false;
  if (mode === "CONTROL") return true;
  return ["ARM", "DISARM", "SET_SUPERVISOR_MODE"].includes(command.action);
}

const chrome = {
  runtime: {
    id: "unit",
    getURL: (p) => `chrome-extension://unit/${p}`,
    getManifest: () => ({ version: "0.6.3" }),
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: (fn) => startupListeners.push(fn) }
  },
  storage: {
    local: storageArea(local),
    session: storageArea(session),
    onChanged: { addListener: () => {} }
  },
  alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
  tabs: { query: async () => [], sendMessage: async () => ({ ok: true }) }
};

const context = vm.createContext({
  console, chrome, Headers, Response, Request, URL, TextEncoder, Uint8Array,
  crypto: globalThis.crypto, setTimeout, clearTimeout,
  fetch: async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/v1/state")) {
      return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/v1/commands/next")) {
      const body = JSON.parse(String(init.body || "{}"));
      const mode = String(body.supervisor_mode || "OFF");
      nextModes.push(mode);
      let command = null;
      if (commandAllowedInMode(queuedCommand, mode)) {
        command = queuedCommand;
        queuedCommand = null;
      }
      return new Response(JSON.stringify({ command }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (/\/v1\/commands\/[^/]+\/result$/.test(url)) {
      resultBodies.push(JSON.parse(String(init.body || "{}")));
      return new Response(JSON.stringify({ accepted: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  }
});
context.globalThis = context;
context.A2_GET_PAIRING_SECRET = async () => "x".repeat(64);
context.A2_BRIDGE_CLIENT_ID = async () => "client-v063-authority";
context.A2_BRIDGE_POLL_NOW = async () => { directPollCalls += 1; return { ok: true, source: "direct" }; };
context.A2_OPERATOR_CAPTURE_PERCEPTION = async (platform) => {
  captureCalls += 1;
  return {
    captured_at: new Date().toISOString(),
    url: platform === "GLM_ZAI" ? "https://chat.z.ai/c/x" : "https://chatgpt.com/c/x",
    frame_token: "frame",
    hashes: { body_text_sha256: "body", screenshot_sha256: "shot" },
    page: { body_text: "UNTRUSTED_PAGE_TEXT_MUST_NOT_ENTER_HEARTBEAT" },
    accessibility: []
  };
};
context.A2_OPERATOR_STOP_GENERATION = async () => ({ ok: true });
context.A2_OPERATOR_SCROLL = async () => ({ ok: true });
context.A2_OPERATOR_SEMANTIC_ACTION = async () => ({ ok: true });

vm.runInContext(source, context, { filename: file });
await new Promise((resolve) => setTimeout(resolve, 20));

async function send(message, sender) {
  for (const fn of messageListeners) {
    let settled = false;
    let result;
    const ret = fn(message, sender, (value) => { settled = true; result = value; });
    if (ret === true) {
      for (let i = 0; i < 100 && !settled; i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
      return result;
    }
    if (settled) return result;
  }
  return undefined;
}

assert.equal(session.get("a2SupervisorModeV1"), "OFF", "fresh session must fail closed");
assert.equal(local.has("a2SupervisorModeV1"), false, "CONTROL authority must stay session-scoped");

queuedCommand = {
  command_id: "00000000-0000-4000-8000-000000000301",
  idempotency_key: "authority-bootstrap-000301",
  action: "SET_SUPERVISOR_MODE",
  platform: null,
  payload: { mode: "CONTROL" }
};
const remoteControl = await context.A2_SUPERVISOR_POLL();
assert.equal(remoteControl.status, "COMPLETED");
assert.equal(session.get("a2SupervisorModeV1"), "CONTROL", "remote supervisor failed to bootstrap CONTROL");
assert.equal(resultBodies.at(-1)?.receipt?.authority_effect, true, "CONTROL bootstrap must be truthfully authority-bearing");
assert.equal(nextModes.at(-1), "OFF", "bootstrap must be leaseable while local mode is OFF");

assert.equal(startupListeners.length, 1);
await startupListeners[0]();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(session.get("a2SupervisorModeV1"), "OFF", "browser startup must revoke CONTROL");
assert.equal(local.get("armed"), false, "browser startup must DISARM");

queuedCommand = {
  command_id: "00000000-0000-4000-8000-000000000302",
  idempotency_key: "authority-arm-000000302",
  action: "ARM",
  platform: null,
  payload: {}
};
const remoteArm = await context.A2_SUPERVISOR_POLL();
assert.equal(remoteArm.status, "COMPLETED");
assert.equal(local.get("armed"), true, "remote supervisor failed to ARM while mode OFF");
assert.equal(resultBodies.at(-1)?.receipt?.authority_effect, true);

queuedCommand = {
  command_id: "00000000-0000-4000-8000-000000000303",
  idempotency_key: "authority-capture-000303",
  action: "CAPTURE",
  platform: "CHATGPT",
  payload: {}
};
const blocked = await context.A2_SUPERVISOR_POLL();
assert.equal(blocked.supervisor_mode, "OFF", "OFF poll should return state when no bootstrap command can be leased");
assert.equal(captureCalls, 0, "non-bootstrap CAPTURE crossed OFF control boundary");
assert.equal(queuedCommand.action, "CAPTURE", "server-mode fence should leave non-bootstrap command pending");

const spoof = await send({ type: "A2_SUPERVISOR_SET_MODE", mode: "CONTROL" }, { id: "unit", url: "chrome-extension://unit/sidepanel.html.evil" });
assert.equal(spoof?.ok, false, "prefix-spoofed sidepanel URL was trusted");

const localControl = await send({ type: "A2_SUPERVISOR_SET_MODE", mode: "CONTROL" }, { id: "unit", url: "chrome-extension://unit/sidepanel.html" });
assert.equal(localControl?.ok, true);
assert.equal(session.get("a2SupervisorModeV1"), "CONTROL");
assert.equal(captureCalls, 1, "pending CAPTURE was not released after CONTROL");
assert.equal(queuedCommand, null);

const heartbeatBodies = source.includes("body_excerpt") || source.includes("original_draft: clip(");
assert.equal(heartbeatBodies, false, "raw page/prompt text regressed into persistent supervisor heartbeat");
assert.ok(source.includes("a2-browser-supervisor-v3-canary"));
assert.ok(source.includes("SET_SUPERVISOR_MODE"));
assert.equal(directPollCalls, 0);

console.log("a2_v063_remote_authority_lab: PASS", {
  nextModes,
  resultCount: resultBodies.length,
  captureCalls
});