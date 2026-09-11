import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const source = fs.readFileSync(path.join(process.cwd(), "coordination/chat-control-plane/extension/supervisor-chat-guard-v064.js"), "utf8");
const local = new Map();
const session = new Map();
let execCalls = 0;
let forceFailure = false;

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

function commandRow(command, secretText = "raw-supervisor-secret-text") {
  return {
    snapshot: {
      messages: [
        { role: "assistant", text: JSON.stringify({ ...command, raw_should_never_persist: secretText }) }
      ]
    }
  };
}

const chrome = { storage: { local: storageArea(local), session: storageArea(session) } };
const context = vm.createContext({ console, chrome, crypto: webcrypto, TextEncoder, Uint8Array, Date, JSON, String, Number, Array, Object, Math, Set });
context.globalThis = context;
context.A2_SUPERVISOR_CHAT_PARSE_ACTION = (text) => {
  const value = JSON.parse(text);
  return { action: value.action, platform: value.platform || null, payload: value.payload || {} };
};
context.A2_SUPERVISOR_CHAT_PROCESS_RESPONSE = async (_incident, row) => {
  execCalls += 1;
  const value = JSON.parse(row.snapshot.messages.at(-1).text);
  return {
    schema: "metaengine.a2-browser-supervisor.chat-action-receipt.v1",
    incident_id: _incident?.incident_id || null,
    detected: true,
    ok: forceFailure ? false : true,
    action: value.action,
    platform: value.platform || null,
    authority_effect: !forceFailure,
    error_code: forceFailure ? "synthetic_failure" : null,
    recorded_at: new Date().toISOString()
  };
};

vm.runInContext(source, context, { filename: "supervisor-chat-guard-v064.js" });
const processResponse = context.A2_SUPERVISOR_CHAT_PROCESS_RESPONSE;
assert.equal(typeof processResponse, "function");

// Fill exactly 24 weighted points with eight SEMANTIC_TYPE actions (3 each).
for (let i = 0; i < 8; i += 1) {
  const receipt = await processResponse(
    { incident_id: `budget-${i}` },
    commandRow({ action: "SEMANTIC_TYPE", platform: "CHATGPT", payload: { role: "textbox", accessible_name: "composer", text: `value-${i}` } })
  );
  assert.equal(receipt.ok, true);
}
assert.equal(execCalls, 8);
let status = await context.A2_SUPERVISOR_CHAT_GUARD_STATUS();
assert.equal(status.used_cost, 24);
assert.equal(status.recent_failures, 0);

const blockedBudget = await processResponse(
  { incident_id: "budget-block" },
  commandRow({ action: "SCROLL", platform: "CHATGPT", payload: { delta_y: 100 } })
);
assert.equal(blockedBudget.ok, false);
assert.equal(blockedBudget.error_code, "supervisor_action_budget_exceeded");
assert.equal(execCalls, 8, "budget-blocked action reached underlying executor");

const emergencyDisarm = await processResponse(
  { incident_id: "budget-emergency" },
  commandRow({ action: "DISARM", payload: {} })
);
assert.equal(emergencyDisarm.ok, true);
assert.equal(execCalls, 9, "DISARM emergency bypass was blocked by full budget");

// Reset only the rolling session guard; audit chain must remain continuous.
await chrome.storage.session.remove("a2SupervisorChatGuardV1");
forceFailure = true;
for (let i = 0; i < 5; i += 1) {
  const receipt = await processResponse(
    { incident_id: `failure-${i}` },
    commandRow({ action: "CAPTURE", platform: "GLM_ZAI", payload: {} })
  );
  assert.equal(receipt.ok, false);
}
status = await context.A2_SUPERVISOR_CHAT_GUARD_STATUS();
assert.equal(status.used_cost, 0);
assert.equal(status.recent_failures, 5);
const callsBeforeCircuit = execCalls;

const blockedCircuit = await processResponse(
  { incident_id: "failure-block" },
  commandRow({ action: "SCROLL", platform: "GLM_ZAI", payload: { delta_y: 100 } })
);
assert.equal(blockedCircuit.ok, false);
assert.equal(blockedCircuit.error_code, "supervisor_failure_circuit_open");
assert.equal(execCalls, callsBeforeCircuit, "circuit-blocked action reached underlying executor");

forceFailure = false;
const emergencyOff = await processResponse(
  { incident_id: "failure-emergency" },
  commandRow({ action: "SET_SUPERVISOR_MODE", payload: { mode: "OFF" } })
);
assert.equal(emergencyOff.ok, true);
assert.equal(execCalls, callsBeforeCircuit + 1, "OFF emergency bypass was blocked by failure circuit");

// Verify the persisted audit is metadata-only and hash chained.
const audit = local.get("a2SupervisorAuditChainV1");
assert.ok(Array.isArray(audit) && audit.length >= 16, "audit chain missing entries");
const serialized = JSON.stringify(audit);
assert.doesNotMatch(serialized, /raw-supervisor-secret-text/);
assert.doesNotMatch(serialized, /value-[0-9]/, "typed text payload leaked into audit");
assert.doesNotMatch(serialized, /accessible_name/);
assert.doesNotMatch(serialized, /payload/);

async function sha256(value) {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
for (let i = 0; i < audit.length; i += 1) {
  const row = audit[i];
  assert.equal(row.prev_hash, i === 0 ? null : audit[i - 1].hash, `audit prev_hash mismatch at ${i}`);
  const { hash, ...core } = row;
  assert.equal(hash, await sha256(JSON.stringify(core)), `audit hash mismatch at ${i}`);
}

assert.match(source, /BUDGET_LIMIT = 24/);
assert.match(source, /FAILURE_LIMIT = 5/);
assert.match(source, /action === "DISARM"/);
assert.match(source, /mode \|\| ""\)\.toUpperCase\(\) === "OFF"/);

console.log("a2_v064_supervisor_chat_guard_lab: PASS", {
  budgetUsed: 24,
  failureCircuit: 5,
  emergencyDisarm: true,
  emergencyOff: true,
  auditEntries: audit.length,
  auditHashChain: true
});
