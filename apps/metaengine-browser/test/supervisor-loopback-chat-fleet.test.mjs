import test from 'node:test';
import assert from 'node:assert/strict';
import { SupervisorLoopbackRpcServer } from '../src/supervisor-loopback-rpc-server.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

async function withEndpoint(chatOperator, run) {
  const manifest = path.join(os.tmpdir(), 'chat-fleet-rpc-' + randomUUID() + '.json');
  const server = new SupervisorLoopbackRpcServer({
    executeCommand: async () => { throw new Error('generic_executor_not_allowed'); },
    chatOperator,
    manifestPath: manifest,
  });
  await server.start();
  const { url, token } = JSON.parse(await fs.readFile(manifest, 'utf8'));
  const post = async (method, params, bearer = token) => {
    const reply = await fetch(url, { method: 'POST',
      headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params }), });
    return { code: reply.status, body: await reply.json() };
  };
  try { await run(post); }
  finally { await server.stop(); }
}

test('authenticated local operator API has only three typed chat verbs', async () => {
  const calls = [];
  const operator = {
    create: async p => { calls.push(['create', p]); return { state: 'CREATED' }; },
    read: async p => { calls.push(['read', p]); return { state: 'READ', text: 'untrusted output' }; },
    assign: async p => { calls.push(['assign', p]); return { state: 'SENT' }; },
  };
  await withEndpoint(operator, async post => {
    const id = 'operator-request-20261012';
    const a = await post('chat.create', { request_id: id, count: 2 });
    const b = await post('chat.read', { tab_id: 'tab_1' });
    const c = await post('chat.assign', { request_id: id, tab_id: 'tab_1', text: 'Continue' });
    assert.deepEqual([a.code, b.code, c.code], [200, 200, 200]);
    assert.deepEqual(calls.map(row => row[0]), ['create', 'read', 'assign']);
    assert.equal(c.body.effect_class, 'LOCAL_OPERATOR');
    assert.equal(b.body.effect_class, 'READ_ONLY');
    assert.equal(c.body.authority_effect, false);
    assert.equal((await post('chat.assign', { text: 'malicious' }, 'invalid')).code, 401);
    assert.equal(calls.length, 3);
    assert.equal((await post('chat.execute-shell', {})).code, 400);
    assert.equal(calls.length, 3);
  });
});

test('chat methods fail closed when no operator or invalid params are bound', async () => {
  await withEndpoint(null, async post => {
    const r = await post('chat.create', { request_id: 'unused', count: 1 });
    assert.equal(r.code, 503);
    assert.equal(r.body.error, 'chat_fleet_operator_unavailable');
  });
  await withEndpoint({
    create: async () => { throw new Error('own_postgres_owner_required'); },
    read: async () => ({}),
    assign: async () => ({}),
  }, async post => {
    const missing = await post('chat.create', null);
    assert.equal(missing.code, 400);
    const refused = await post('chat.create', { request_id: 'test-a', count: 1 });
    assert.equal(refused.code, 400);
    assert.match(refused.body.message, /own_postgres_owner_required/);
  });
});
