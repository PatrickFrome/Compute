import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('coordination/chat-control-plane/extension/background.js', 'utf8');
const ZAI = 'https://chat.z.ai/c/restart-idempotency';
const COMPLETED_KEY = 'a2BridgeCompletedCommandsV0523';
const PENDING_KEY = 'a2BridgePendingCommandV0523';
const storage = new Map([
  ['armed', true],
  ['autoOpenTabs', false],
  ['pollMs', 2500],
  ['chatgptUrl', ''],
  ['zaiUrl', ZAI],
  ['daemonUrl', 'https://example.invalid/a2']
]);

const command = (id, idem) => ({
  command_id: id,
  idempotency_key: idem,
  target_platform: 'GLM_ZAI',
  prompt: 'A2 CHAT BRIDGE — AUTONOMOUS CONTINUE\nbridge_job_target=GLM',
  launch_order: 1,
  ordering_basis: 'GLM_FIRST',
  predecessor_command_id: null,
  authority_effect: false
});

function makeStorage() {
  return {
    async get(keys) {
      if (keys == null) return Object.fromEntries(storage);
      if (typeof keys === 'string') return { [keys]: storage.get(keys) };
      const names = Array.isArray(keys) ? keys : Object.keys(keys || {});
      const out = {};
      for (const key of names) if (storage.has(key)) out[key] = storage.get(key);
      return out;
    },
    async set(values) { for (const [key, value] of Object.entries(values || {})) storage.set(key, structuredClone(value)); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) storage.delete(key); }
  };
}

function makeRuntime({ nextResponses, resultPolicy, trustedCounter, resultCalls }) {
  const listeners = { installed: [], startup: [], alarm: [], action: [], storage: [], runtime: [] };
  const chrome = {
    storage: {
      local: makeStorage(),
      onChanged: { addListener(fn) { listeners.storage.push(fn); } }
    },
    action: {
      async setBadgeText() {},
      async setBadgeBackgroundColor() {},
      async setTitle() {},
      onClicked: { addListener(fn) { listeners.action.push(fn); } }
    },
    alarms: {
      async create() {},
      onAlarm: { addListener(fn) { listeners.alarm.push(fn); } }
    },
    tabs: {
      async query() { return [{ id: 7, url: ZAI }]; },
      async get(id) { assert.equal(id, 7); return { id: 7, url: ZAI }; },
      async sendMessage(id, message) {
        assert.equal(id, 7);
        if (message?.type === 'GET_CHAT_SNAPSHOT') {
          return { ok: true, snapshot: { platform: 'GLM_ZAI', generating: false, composer_text: '', message_count: 1, messages: [] } };
        }
        throw new Error(`unexpected tab message ${String(message?.type)}`);
      },
      async create() { throw new Error('unexpected tab create'); },
      async update() { throw new Error('unexpected tab update'); }
    },
    runtime: {
      onInstalled: { addListener(fn) { listeners.installed.push(fn); } },
      onStartup: { addListener(fn) { listeners.startup.push(fn); } },
      onMessage: { addListener(fn) { listeners.runtime.push(fn); } }
    }
  };

  const context = vm.createContext({
    chrome,
    globalThis: null,
    console,
    URL,
    Date,
    Promise,
    Response,
    structuredClone,
    setTimeout,
    clearTimeout
  });
  context.globalThis = context;
  context.A2_BRIDGE_BOOTSTRAP = { daemonUrl: 'https://example.invalid/a2' };
  context.A2_SECRET_VAULT_READY = Promise.resolve();
  context.A2_BRIDGE_CLIENT_ID = async () => 'restart-test-client';
  context.A2_GLM_RECONCILE = async () => null;
  context.A2_GLM_TRUSTED_SEND = async (_tabId, cmd) => {
    trustedCounter.count += 1;
    return {
      ok: true,
      status: 'SENT_AND_DOM_VERIFIED',
      execution_class: 'VERIFIED',
      clicked_send_button: true,
      verification: { verified: true, command_id: cmd.command_id },
      transport_trace_id: 'a'.repeat(32)
    };
  };
  context.A2_CHATGPT_TRUSTED_SEND = async () => { throw new Error('unexpected GPT send'); };
  context.A2_BRIDGE_REQUEST = async (path, init = {}) => {
    if (path === '/v1/snapshots') return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { 'content-type': 'application/json' } });
    if (path === '/v1/commands/next') {
      const body = nextResponses.shift() || { command: null, ordering_policy: 'STRICT_GLM_FIRST_ACTUATED_V1' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const match = String(path).match(/^\/v1\/commands\/([^/]+)\/result$/);
    if (match) {
      const body = JSON.parse(String(init.body || '{}'));
      resultCalls.push({ command_id: decodeURIComponent(match[1]), body });
      const result = resultPolicy(decodeURIComponent(match[1]), body);
      if (result instanceof Error) throw result;
      return new Response(JSON.stringify({ accepted: true }), { status: result ?? 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected bridge request ${path}`);
  };

  vm.runInContext(source, context, { filename: 'background.js' });
  return { context, listeners };
}

const trustedCounter = { count: 0 };
const phase1Results = [];

// Phase 1: physical GLM actuation succeeds, but every final result ACK is lost.
makeRuntime({
  nextResponses: [{ command: command('cmd-1', 'idem-A'), ordering_policy: 'STRICT_GLM_FIRST_ACTUATED_V1' }],
  resultPolicy: () => new Error('simulated_result_ack_loss'),
  trustedCounter,
  resultCalls: phase1Results
});

await new Promise((resolve) => setTimeout(resolve, 420));
assert.equal(trustedCounter.count, 1, 'phase 1 must physically actuate exactly once');
const completedAfterLoss = storage.get(COMPLETED_KEY);
assert.equal(Array.isArray(completedAfterLoss), true, 'durable completion ledger missing after ACK loss');
assert.equal(completedAfterLoss.length, 1, 'verified send must persist exactly once before remote ACK');
assert.equal(completedAfterLoss[0].idempotency_key, 'idem-A');
assert.equal(completedAfterLoss[0].execution_class, 'VERIFIED');
assert.equal(storage.get(PENDING_KEY)?.command_id, 'cmd-1', 'pending command must remain until result ACK is accepted');

const phase2Results = [];

// Phase 2: service-worker restart over the same storage. First replay the old
// pending command, then receive a new command id with the same idempotency key.
makeRuntime({
  nextResponses: [{ command: command('cmd-2', 'idem-A'), ordering_policy: 'STRICT_GLM_FIRST_ACTUATED_V1' }],
  resultPolicy: () => 200,
  trustedCounter,
  resultCalls: phase2Results
});

await new Promise((resolve) => setTimeout(resolve, 420));
assert.equal(trustedCounter.count, 1, 'restart/idempotent replay caused a duplicate physical Send');
assert.equal(storage.has(PENDING_KEY), false, 'accepted replay result did not clear pending journal');

const replayCmd1 = phase2Results.find((row) => row.command_id === 'cmd-1' && row.body.status === 'SENT_ALREADY_DURABLE');
const replayCmd2 = phase2Results.find((row) => row.command_id === 'cmd-2' && row.body.status === 'SENT_ALREADY_DURABLE');
assert.ok(replayCmd1, 'restart did not ACK durable pending command without re-actuation');
assert.ok(replayCmd2, 'same-idempotency new command was not suppressed as durable replay');
assert.equal(replayCmd1.body.verification?.durable_replay, true);
assert.equal(replayCmd2.body.verification?.durable_replay, true);
assert.equal(replayCmd2.body.execution_class, 'VERIFIED');
assert.equal(storage.get(COMPLETED_KEY).length, 1, 'durable replay mutated completion identity unexpectedly');

console.log('v0.6 durable restart idempotency behavioral contract PASS', {
  trusted_send_calls: trustedCounter.count,
  phase1_result_attempts: phase1Results.length,
  phase2_result_attempts: phase2Results.length,
  durable_entries: storage.get(COMPLETED_KEY).length
});
