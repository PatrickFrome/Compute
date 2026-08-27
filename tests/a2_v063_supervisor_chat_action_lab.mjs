import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const actionFile = path.join(ROOT, "coordination/chat-control-plane/extension/supervisor-chat-action-v063.js");
const monitorFile = path.join(ROOT, "coordination/chat-control-plane/extension/supervisor-chat-action-monitor-v063.js");
const actionSource = fs.readFileSync(actionFile, "utf8");
const monitorSource = fs.readFileSync(monitorFile, "utf8");
const local = new Map();
const session = new Map();
const storageListeners = [];
let scrollCalls = 0;
let pollCalls = 0;

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
    onChanged: { addListener: (fn) => storageListeners.push(fn) }
  },
  tabs: {
    query: async () => [],
    sendMessage: async () => ({ ok: true })
  }
};

const context = vm.createContext({ console, chrome, URL, setTimeout, clearTimeout });
context.globalThis = context;
context.A2_BRIDGE_POLL_NOW = async () => { pollCalls += 1; return { ok: true }; };
context.A2_OPERATOR_SCROLL = async (_platform, deltaY) => { scrollCalls += 1; return { ok: true, delta_y: deltaY }; };
context.A2_OPERATOR_STOP_GENERATION = async () => ({ ok: true });
context.A2_OPERATOR_CAPTURE_PERCEPTION = async (platform) => ({ platform, captured_at: "2026-08-27T12:00:00Z", frame_token: "frame-1", accessibility: [] });
context.A2_OPERATOR_SEMANTIC_ACTION = async () => ({ ok: true });

vm.runInContext(actionSource, context, { filename: actionFile });
vm.runInContext(monitorSource, context, { filename: monitorFile });
assert.equal(typeof context.A2_SUPERVISOR_CHAT_PROCESS_RESPONSE, "function");
assert.equal(typeof context.A2_SUPERVISOR_CHAT_PARSE_ACTION, "function");
assert.equal(typeof context.A2_SUPERVISOR_CHAT_MAYBE_PROCESS_ACTION, "function");

function row(text, hash = "response-1", count = 1) {
  return {
    observed_at: new Date().toISOString(),
    snapshot: {
      generating: false,
      message_count: count,
      messages: [{ role: "assistant", text, text_sha256: hash }]
    }
  };
}

const controlText = `Diagnosis: enable supervisor authority.\nA2_SUPERVISOR_ACTION\n{"action":"SET_SUPERVISOR_MODE","payload":{"mode":"CONTROL"}}`;
const control = await context.A2_SUPERVISOR_CHAT_PROCESS_RESPONSE({ incident_id: "i-control" }, row(controlText));
assert.equal(control.detected, true);
assert.equal(control.ok, true);
assert.equal(control.action, "SET_SUPERVISOR_MODE");
assert.equal(session.get("a2SupervisorModeV1"), "CONTROL");

const armText = `A2_SUPERVISOR_ACTION\n\`\`\`json\n{"action":"ARM","payload":{}}\n\`\`\``;
const arm = await context.A2_SUPERVISOR_CHAT_PROCESS_RESPONSE({ incident_id: "i-arm" }, row(armText, "response-arm"));
assert.equal(arm.ok, true);
assert.equal(arm.action, "ARM");
assert.equal(local.get("armed"), true);

await chrome.storage.session.set({ a2SupervisorModeV1: "OFF" });
const scrollText = `A2_SUPERVISOR_ACTION\n{"action":"SCROLL","platform":"CHATGPT","payload":{"delta_y":400}}`;
const blocked = await context.A2_SUPERVISOR_CHAT_PROCESS_RESPONSE({ incident_id: "i-scroll" }, row(scrollText, "response-scroll"));
assert.equal(blocked.detected, true);
assert.equal(blocked.ok, false);
assert.match(blocked.error_code, /supervisor_chat_control_required:OFF/);
assert.equal(scrollCalls, 0);

assert.throws(
  () => context.A2_SUPERVISOR_CHAT_PARSE_ACTION(`A2_SUPERVISOR_ACTION\n{"action":"EXECUTE_JS","payload":{"code":"alert(1)"}}`),
  /supervisor_chat_action_not_allowed/
);
assert.throws(
  () => context.A2_SUPERVISOR_CHAT_PARSE_ACTION(`A2_SUPERVISOR_ACTION\n{"action":"ARM","payload":{"secret":"x"}}`),
  /supervisor_chat_action_payload_unknown_field/
);
assert.throws(
  () => context.A2_SUPERVISOR_CHAT_PARSE_ACTION(`A2_SUPERVISOR_ACTION\n{"action":"SCROLL","platform":"CHATGPT","payload":{"delta_y":99999}}`),
  /supervisor_chat_scroll_invalid/
);

await chrome.storage.session.set({ a2SupervisorModeV1: "CONTROL" });
await chrome.storage.local.set({
  a2SupervisorPendingIncidentV1: {
    incident_id: "i-monitor",
    status: "WAITING_RESPONSE",
    baseline: { assistant_count: 1, assistant_tail_sha256: "old-a", generating: false }
  }
});
const monitorRow = {
  observed_at: new Date().toISOString(),
  snapshot: {
    generating: false,
    message_count: 3,
    messages: [
      { role: "assistant", text: "old", text_sha256: "old-a" },
      { role: "user", text: "incident", text_sha256: "u" },
      { role: "assistant", text: `A2_SUPERVISOR_ACTION\n{"action":"POLL","payload":{}}`, text_sha256: "new-a" }
    ]
  }
};
const monitorFirst = await context.A2_SUPERVISOR_CHAT_MAYBE_PROCESS_ACTION(monitorRow);
assert.equal(monitorFirst.ok, true);
assert.equal(monitorFirst.action, "POLL");
assert.equal(monitorFirst.response_sha256, "new-a");
assert.equal(pollCalls, 1);
const monitorReplay = await context.A2_SUPERVISOR_CHAT_MAYBE_PROCESS_ACTION(monitorRow);
assert.equal(monitorReplay.response_sha256, "new-a");
assert.equal(pollCalls, 1, "same supervisor response executed twice");

assert.ok(!actionSource.includes("eval("));
assert.ok(!actionSource.includes("new Function"));
assert.ok(actionSource.includes("BOOTSTRAP_ACTIONS"));
assert.ok(actionSource.includes("supervisor_chat_control_required"));
assert.ok(actionSource.includes("supervisor_chat_action_payload_unknown_field"));

console.log("a2_v063_supervisor_chat_action_lab: PASS", {
  mode: session.get("a2SupervisorModeV1"),
  armed: local.get("armed"),
  pollCalls,
  scrollCalls
});