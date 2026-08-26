import assert from 'node:assert/strict';

const storage = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (Array.isArray(key)) {
          return Object.fromEntries(key.map((k) => [k, storage.get(k)]));
        }
        return { [key]: storage.get(key) };
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) storage.set(key, value);
      }
    }
  }
};

const nextResponses = [];
const resultCalls = [];
let failFirstVerifiedAck = true;

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || String(input);
  const method = String(init.method || 'GET').toUpperCase();
  if (method === 'POST' && url.endsWith('/v1/commands/next')) {
    const body = nextResponses.shift() || { command: null };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }
  if (method === 'POST' && /\/v1\/commands\/[^/]+\/result$/.test(url)) {
    const body = JSON.parse(String(init.body || '{}'));
    resultCalls.push({ url, body });
    if (body.status === 'SENT_AND_DOM_VERIFIED' && failFirstVerifiedAck) {
      failFirstVerifiedAck = false;
      throw new Error('simulated_daemon_ack_loss');
    }
    return new Response(JSON.stringify({ accepted: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }
  throw new Error(`unexpected fetch ${method} ${url}`);
};

await import('../coordination/chat-control-plane/extension/durable-fetch.js?behavior-test=1');

const BRIDGE_BASE = 'https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-chat-bridge-remote';
const NEXT_URL = `${BRIDGE_BASE}/v1/commands/next`;
const next = () => ({ method: 'POST', body: JSON.stringify({ snapshots: [] }) });
function command(commandId, idem) {
  return {
    command_id: commandId,
    idempotency_key: idem,
    target_platform: 'GLM_ZAI',
    prompt: 'continue'
  };
}

// 1) Lease a command and then lose the remote ACK after exact DOM verification.
nextResponses.push({ command: command('cmd-1', 'idem-A') });
let response = await fetch(NEXT_URL, next());
let body = await response.json();
assert.equal(body.command.command_id, 'cmd-1');

await assert.rejects(
  fetch(`${BRIDGE_BASE}/v1/commands/cmd-1/result`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'SENT_AND_DOM_VERIFIED',
      clicked_send_button: true,
      verification: { verified: true },
      target_url: 'https://chat.z.ai/c/example'
    })
  }),
  /simulated_daemon_ack_loss/
);

const completed = storage.get('a2BridgeCompletedCommandsV1');
assert.equal(completed.length, 1, 'verified Send must persist before remote ACK');
assert.equal(completed[0].idempotency_key, 'idem-A');
assert.equal(completed[0].dom_send_verified, true);

// 2) A restarted scheduler uses a new command ID but deterministic same idempotency key.
// The wrapper must ACK it as durable and hide it from background.js, preventing a second Send.
nextResponses.push({ command: command('cmd-2', 'idem-A') });
response = await fetch(NEXT_URL, next());
body = await response.json();
assert.equal(body.command, null);
assert.equal(body.durable_duplicate_command_id, 'cmd-2');
assert.equal(body.durable_duplicate_idempotency_key, 'idem-A');
assert.equal(resultCalls.at(-1).body.status, 'SENT_ALREADY_DURABLE');
assert.equal(resultCalls.at(-1).body.verification.verified, true);
assert.equal(resultCalls.at(-1).url, `${BRIDGE_BASE}/v1/commands/cmd-2/result`, 'remote Edge Function base path must be preserved');

// 3) A mere click/SENT status without exact DOM verification must NOT poison the durable ledger.
nextResponses.push({ command: command('cmd-3', 'idem-B') });
response = await fetch(NEXT_URL, next());
body = await response.json();
assert.equal(body.command.command_id, 'cmd-3');

response = await fetch(`${BRIDGE_BASE}/v1/commands/cmd-3/result`, {
  method: 'POST',
  body: JSON.stringify({
    status: 'SENT',
    clicked_send_button: true,
    verification: { verified: true }
  })
});
assert.equal(response.status, 200);
assert.equal(storage.get('a2BridgeCompletedCommandsV1').length, 1);

nextResponses.push({ command: command('cmd-4', 'idem-B') });
response = await fetch(NEXT_URL, next());
body = await response.json();
assert.equal(body.command.command_id, 'cmd-4', 'unverified prior result must not suppress a retry');

console.log('durable idempotency behavioral contract PASS');
