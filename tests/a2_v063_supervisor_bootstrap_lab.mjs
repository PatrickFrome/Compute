import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const file = path.join(ROOT, "coordination/chat-control-plane/extension/supervisor-bootstrap-v063.js");
const source = fs.readFileSync(file, "utf8");

const local = new Map([["armed", false]]);
const session = new Map([["a2SupervisorModeV1", "OFF"]]);
const alarmListeners = [];
const storageListeners = [];
const fetchCalls = [];
const postedResults = [];
let queuedCommand = null;
let supervisorPollHandoffs = 0;

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

const chrome = {
  storage: {
    local: storageArea(local),
    session: storageArea(session),
    onChanged: { addListener: (fn) => storageListeners.push(fn) }
  },
  alarms: {
    create: () => {},
    onAlarm: { addListener: (fn) => alarmListeners.push(fn) }
  }
};

const context = vm.createContext({
  console,
  chrome,
  Headers,
  Response,
  Request,
  URL,
  queueMicrotask,
  setTimeout,
  clearTimeout,
  fetch: async (input, init = {}) => {
    const url = String(input);
    fetchCalls.push({ url, init });
    if (url.endsWith("/v1/commands/bootstrap-next")) {
      const command = queuedCommand;
      queuedCommand = null;
      return new Response(JSON.stringify({ command }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (/\/v1\/commands\/[^/]+\/result$/.test(url)) {
      postedResults.push(JSON.parse(String(init.body || "{}")));
      return new Response(JSON.stringify({ accepted: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  }
});
context.globalThis = context;
context.A2_GET_PAIRING_SECRET = async () => "x".repeat(64);
context.A2_BRIDGE_CLIENT_ID = async () => "client-v063-bootstrap";
context.A2_SUPERVISOR_POLL = async () => { supervisorPollHandoffs += 1; return { ok: true }; };

queuedCommand = {
  command_id: "00000000-0000-4000-8000-000000000631",
  idempotency_key: "v063.bootstrap.control.0001",
  action: "SET_SUPERVISOR_MODE",
  platform: null,
  payload: { mode: "CONTROL" }
};

vm.runInContext(source, context, { filename: file });
await new Promise((resolve) => setTimeout(resolve, 20));

assert.equal(session.get("a2SupervisorModeV1"), "CONTROL", "remote supervisor did not bootstrap CONTROL");
assert.equal(postedResults.at(-1)?.ok, true, "CONTROL bootstrap receipt was not accepted");
assert.equal(postedResults.at(-1)?.receipt?.action, "SET_SUPERVISOR_MODE");
assert.equal(supervisorPollHandoffs, 1, "CONTROL bootstrap did not hand off to main supervisor FSM");

session.set("a2SupervisorModeV1", "OFF");
queuedCommand = {
  command_id: "00000000-0000-4000-8000-000000000632",
  idempotency_key: "v063.bootstrap.arm.000001",
  action: "ARM",
  platform: null,
  payload: {}
};
await context.A2_SUPERVISOR_BOOTSTRAP_POLL();
assert.equal(local.get("armed"), true, "remote supervisor could not ARM from OFF");
assert.equal(postedResults.at(-1)?.ok, true);
assert.equal(postedResults.at(-1)?.receipt?.action, "ARM");

session.set("a2SupervisorModeV1", "MONITOR");
queuedCommand = {
  command_id: "00000000-0000-4000-8000-000000000633",
  idempotency_key: "v063.bootstrap.disarm.0001",
  action: "DISARM",
  platform: null,
  payload: {}
};
await context.A2_SUPERVISOR_BOOTSTRAP_POLL();
assert.equal(local.get("armed"), false, "remote supervisor could not DISARM from MONITOR");
assert.equal(postedResults.at(-1)?.ok, true);
assert.equal(postedResults.at(-1)?.receipt?.action, "DISARM");

// Defense in depth: even if a malformed edge response ever hands a normal action
// to the bootstrap client, the extension itself must reject it before execution.
session.set("a2SupervisorModeV1", "OFF");
queuedCommand = {
  command_id: "00000000-0000-4000-8000-000000000634",
  idempotency_key: "v063.bootstrap.capture.0001",
  action: "CAPTURE",
  platform: "CHATGPT",
  payload: {}
};
const rejected = await context.A2_SUPERVISOR_BOOTSTRAP_POLL();
assert.equal(rejected.status, "FAILED", "non-bootstrap action was accepted before CONTROL");
assert.match(rejected.error, /bootstrap_action_not_allowed/);
assert.equal(postedResults.at(-1)?.ok, false);

assert.ok(fetchCalls.some((row) => row.url.endsWith("/v1/commands/bootstrap-next")), "bootstrap did not use the filtered v3 lease route");
assert.ok(source.includes("a2-browser-supervisor-v3-canary"), "bootstrap is not pinned to the v3 edge canary");
assert.equal(alarmListeners.length, 1);
assert.equal(storageListeners.length, 1);

console.log("a2_v063_supervisor_bootstrap_lab: PASS", {
  postedResults: postedResults.length,
  supervisorPollHandoffs,
  fetchCalls: fetchCalls.length
});
