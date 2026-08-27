import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const ROOT = process.cwd();
const file = path.join(ROOT, "coordination/chat-control-plane/extension/supervisor-incident-router-v063.js");
const source = fs.readFileSync(file, "utf8");
const local = new Map();
const storageListeners = [];
const alarms = [];
const sends = [];
let recoverCalls = 0;
let sessionEpoch = 1;
let snapshot = {
  schema: "metaengine.a2-browser-supervisor.chat-snapshot.v1",
  observed_at: new Date().toISOString(),
  snapshot: {
    platform: "CHATGPT",
    generating: false,
    message_count: 2,
    messages: [
      { role: "user", text_sha256: "u1" },
      { role: "assistant", text_sha256: "a1" }
    ]
  }
};

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
    onChanged: { addListener: (fn) => storageListeners.push(fn) }
  },
  alarms: {
    create: async (name, info) => alarms.push({ name, info }),
    onAlarm: { addListener: () => {} }
  },
  runtime: {
    getManifest: () => ({ version: "0.6.3" })
  }
};

const crypto = {
  subtle: webcrypto.subtle,
  randomUUID: () => `incident-${Math.random().toString(16).slice(2)}`
};
const context = vm.createContext({ console, chrome, crypto, TextEncoder, Uint8Array, setTimeout, clearTimeout });
context.globalThis = context;
context.A2_OPERATOR_RUNTIME = "0.6.3-supervisor-authority-dev.2";
context.A2_SUPERVISOR_CHAT_SNAPSHOT = async () => snapshot;
context.A2_SUPERVISOR_CHAT_STATUS = async () => ({ epoch: sessionEpoch, tab_id: 91 });
context.A2_SUPERVISOR_CHAT_SEND_INCIDENT = async (incident) => {
  sends.push(JSON.parse(JSON.stringify(incident)));
  return { ok: true, status: "SENT_DISPATCHED", execution_class: "ACTUATED", epoch: sessionEpoch, tab_id: 91 };
};
context.A2_SUPERVISOR_CHAT_RECOVER = async () => {
  recoverCalls += 1;
  sessionEpoch += 1;
  snapshot = {
    schema: "metaengine.a2-browser-supervisor.chat-snapshot.v1",
    observed_at: new Date().toISOString(),
    snapshot: { platform: "CHATGPT", generating: false, message_count: 0, messages: [] }
  };
  return { id: 91 };
};

vm.runInContext(source, context, { filename: file });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(typeof context.A2_SUPERVISOR_ESCALATE_ERROR, "function");
assert.equal(typeof context.A2_SUPERVISOR_INCIDENT_TICK, "function");
assert.ok(alarms.some((row) => row.name === "a2-supervisor-incident-watch" && row.info?.periodInMinutes === 0.5));

const first = await context.A2_SUPERVISOR_ESCALATE_ERROR(
  "BRIDGE",
  "command_http_503 https://private.example/path?token=secret",
  { operator_runtime: "0.6.3-supervisor-authority-dev.2", extension_version: "0.6.3", secret: "SHOULD_NOT_PERSIST", body_excerpt: "RAW_PAGE_TEXT" }
);
assert.equal(first.status, "WAITING_RESPONSE");
assert.equal(first.attempt, 1);
assert.equal(sends.length, 1);
let pending = local.get("a2SupervisorPendingIncidentV1");
assert.equal(pending.status, "WAITING_RESPONSE");
assert.equal(pending.baseline.assistant_count, 1);
assert.equal(pending.baseline.assistant_tail_sha256, "a1");
const durable = JSON.stringify(pending);
assert.ok(!durable.includes("private.example"));
assert.ok(!durable.includes("secret"));
assert.ok(!durable.includes("SHOULD_NOT_PERSIST"));
assert.ok(!durable.includes("RAW_PAGE_TEXT"));
assert.ok(/^[a-f0-9]{64}$/.test(pending.fingerprint_sha256));

const duplicate = await context.A2_SUPERVISOR_ESCALATE_ERROR("BRIDGE", "command_http_503 https://other.example/x", {});
assert.equal(duplicate.deduplicated, true);
assert.equal(sends.length, 1);

snapshot = {
  schema: "metaengine.a2-browser-supervisor.chat-snapshot.v1",
  observed_at: new Date().toISOString(),
  snapshot: {
    platform: "CHATGPT",
    generating: false,
    message_count: 4,
    messages: [
      { role: "user", text_sha256: "u1" },
      { role: "assistant", text_sha256: "a1" },
      { role: "user", text_sha256: "incident-prompt" },
      { role: "assistant", text_sha256: "a2" }
    ]
  }
};
const completed = await context.A2_SUPERVISOR_INCIDENT_TICK();
assert.equal(completed.status, "COMPLETED");
assert.equal(local.get("a2SupervisorPendingIncidentV1"), null);
assert.equal(local.get("a2SupervisorLastIncidentReceiptV1")?.response?.assistant_tail_sha256, "a2");

snapshot = {
  schema: "metaengine.a2-browser-supervisor.chat-snapshot.v1",
  observed_at: new Date().toISOString(),
  snapshot: { platform: "CHATGPT", generating: false, message_count: 2, messages: [{ role: "user", text_sha256: "u2" }, { role: "assistant", text_sha256: "a3" }] }
};
const second = await context.A2_SUPERVISOR_ESCALATE_ERROR("SENSOR", "content_script_not_ready", { platform: "CHATGPT" });
assert.equal(second.status, "WAITING_RESPONSE");
pending = local.get("a2SupervisorPendingIncidentV1");
await chrome.storage.local.set({
  a2SupervisorPendingIncidentV1: {
    ...pending,
    last_progress_at: new Date(Date.now() - 180_000).toISOString(),
    sent_at: new Date(Date.now() - 180_000).toISOString()
  }
});
const recovered = await context.A2_SUPERVISOR_INCIDENT_TICK();
assert.equal(recoverCalls, 1);
assert.equal(recovered.status, "WAITING_RESPONSE");
assert.equal(recovered.attempt, 2);
assert.equal(recovered.epoch, 2);
assert.equal(sends.length, 3, "timeout should recover and resend exactly once");

pending = local.get("a2SupervisorPendingIncidentV1");
const recoverBeforeProgress = recoverCalls;
snapshot = {
  schema: "metaengine.a2-browser-supervisor.chat-snapshot.v1",
  observed_at: new Date().toISOString(),
  snapshot: { platform: "CHATGPT", generating: true, message_count: 1, messages: [{ role: "assistant", text_sha256: "stream-1" }] }
};
await chrome.storage.local.set({
  a2SupervisorPendingIncidentV1: {
    ...pending,
    last_progress_at: new Date(Date.now() - 180_000).toISOString(),
    last_signal: { assistant_count: 0, assistant_tail_sha256: null, message_count: 0, generating: false }
  }
});
const progressing = await context.A2_SUPERVISOR_INCIDENT_TICK();
assert.equal(recoverCalls, recoverBeforeProgress, "active assistant progress triggered destructive recovery");
assert.equal(progressing.status, "WAITING_RESPONSE");
assert.equal(progressing.last_signal.assistant_tail_sha256, "stream-1");

const epochPending = local.get("a2SupervisorPendingIncidentV1");
const recoverBeforeEpochAdvance = recoverCalls;
sessionEpoch = Number(epochPending.epoch || 2) + 1;
snapshot = {
  schema: "metaengine.a2-browser-supervisor.chat-snapshot.v1",
  observed_at: new Date().toISOString(),
  snapshot: { platform: "CHATGPT", generating: false, message_count: 0, messages: [] }
};
const afterEpoch = await context.A2_SUPERVISOR_INCIDENT_TICK();
assert.equal(recoverCalls, recoverBeforeEpochAdvance, "already advanced session epoch caused a second recovery");
assert.equal(afterEpoch.attempt, 3);
assert.equal(afterEpoch.epoch, sessionEpoch);
assert.equal(afterEpoch.status, "WAITING_RESPONSE");

assert.ok(source.includes("daemonLastError"));
assert.ok(source.includes("operatorSensorLastError"));
assert.ok(source.includes("unhandledrejection"));
assert.ok(source.includes("no_response_timeout"));
assert.ok(!source.includes("eval("));
assert.ok(!source.includes("new Function"));

console.log("a2_v063_supervisor_incident_lab: PASS", {
  sends: sends.length,
  recoverCalls,
  finalAttempt: afterEpoch.attempt,
  finalEpoch: afterEpoch.epoch
});