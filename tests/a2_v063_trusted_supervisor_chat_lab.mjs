import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const file = path.join(ROOT, "coordination/chat-control-plane/extension/trusted-supervisor-chat-v063.js");
const source = fs.readFileSync(file, "utf8");
const local = new Map([
  ["a2SupervisorChatTabIdV1", 77],
  ["a2SupervisorChatUrlV1", ""],
  ["a2SupervisorChatEpochV1", 4]
]);
const inserted = [];
const keyEvents = [];
const messages = [];
let debuggerRuns = 0;
let ensureTabId = 77;

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
  storage: { local: storageArea(local) },
  tabs: {
    async get(id) {
      if (Number(id) !== 77) throw new Error("tab_missing");
      return { id: 77, url: "https://chatgpt.com/" };
    },
    async sendMessage(id, message) {
      messages.push({ id, message });
      if (message?.type === "A2_PROMPT_GATE_BRIDGE_BYPASS") return { ok: true };
      if (message?.type === "A2_PROMPT_GATE_BRIDGE_BYPASS_CLEAR") return { ok: true };
      return { ok: false };
    }
  }
};

const context = vm.createContext({ console, chrome, URL, Headers, TextEncoder, Uint8Array, setTimeout, clearTimeout });
context.globalThis = context;
context.A2_SUPERVISOR_CHAT_ENSURE = async () => ({ id: ensureTabId });
context.A2_DEBUGGER_RUN = async (tabId, owner, operation) => {
  debuggerRuns += 1;
  assert.equal(tabId, 77);
  assert.equal(owner, "supervisor-chat-incident");
  const session = {
    async send(method, params = {}) {
      if (method === "Runtime.evaluate") {
        const expr = String(params.expression || "");
        if (expr.includes("const buttons=")) return { result: { value: { ok: true } } };
        if (expr.includes("el.focus()")) return { result: { value: true } };
        return { result: { value: { ok: true, text: "" } } };
      }
      if (method === "Input.insertText") {
        inserted.push(String(params.text || ""));
        return {};
      }
      if (method === "Input.dispatchKeyEvent") {
        keyEvents.push({ ...params });
        return {};
      }
      throw new Error(`unexpected_method:${method}`);
    }
  };
  return operation(session);
};

vm.runInContext(source, context, { filename: file });
assert.equal(typeof context.A2_SUPERVISOR_CHAT_SEND_INCIDENT, "function");

const incident = {
  incident_id: "incident-001",
  source: "BRIDGE",
  message: "BRIDGE reported command_http_503",
  attempt: 1,
  context: {
    operator_runtime: "0.6.3-supervisor-authority-dev.2",
    extension_version: "0.6.3",
    error_code: "command_http_503",
    secret: "MUST_NOT_LEAK",
    body_excerpt: "PAGE_TEXT_MUST_NOT_LEAK"
  }
};

const first = await context.A2_SUPERVISOR_CHAT_SEND_INCIDENT(incident);
assert.equal(first.ok, true);
assert.equal(first.execution_class, "ACTUATED");
assert.equal(first.epoch, 4);
assert.equal(first.tab_id, 77);
assert.equal(debuggerRuns, 1);
assert.equal(inserted.length, 1);
assert.match(inserted[0], /^A2 BROWSER OPERATOR — SUPERVISOR INCIDENT V1/);
assert.ok(inserted[0].includes("command_http_503"));
assert.ok(inserted[0].includes("A2_SUPERVISOR_ACTION"));
assert.ok(!inserted[0].includes("MUST_NOT_LEAK"));
assert.ok(!inserted[0].includes("PAGE_TEXT_MUST_NOT_LEAK"));
assert.ok(keyEvents.some((event) => event.key === "Enter" && event.type === "rawKeyDown"));
assert.ok(messages.some((row) => row.message?.type === "A2_PROMPT_GATE_BRIDGE_BYPASS"));

const ledger = local.get("a2SupervisorChatDispatchLedgerV1");
assert.equal(ledger.length, 1);
assert.equal(ledger[0].incident_id, "incident-001");
assert.equal(ledger[0].epoch, 4);
assert.equal(ledger[0].phase, "ACTUATED");

const replay = await context.A2_SUPERVISOR_CHAT_SEND_INCIDENT(incident);
assert.equal(replay.status, "SENT_ALREADY_DURABLE");
assert.equal(replay.durable_replay, true);
assert.equal(debuggerRuns, 1, "durable replay re-entered debugger transport");
assert.equal(inserted.length, 1, "durable replay inserted a duplicate prompt");

ensureTabId = 88;
await assert.rejects(
  () => context.A2_SUPERVISOR_CHAT_SEND_INCIDENT({ ...incident, incident_id: "incident-002" }),
  /supervisor_chat_tab_role_mismatch/
);
assert.equal(debuggerRuns, 1, "role mismatch reached debugger transport");

assert.ok(!source.includes("eval("));
assert.ok(!source.includes("new Function"));
assert.ok(source.includes("A2_DEBUGGER_RUN"));
assert.ok(source.includes("PRE_ENTER_DURABLE"));
assert.ok(source.includes("AMBIGUOUS_NO_RETRY"));

console.log("a2_v063_trusted_supervisor_chat_lab: PASS", {
  debuggerRuns,
  insertedPrompts: inserted.length,
  enterEvents: keyEvents.filter((event) => event.key === "Enter").length,
  ledgerPhase: ledger[0].phase
});