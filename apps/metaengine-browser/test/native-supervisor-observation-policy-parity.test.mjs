import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { NativeSupervisorClient } from '../src/native-supervisor-client-base.mjs';
import { classifyNativeSupervisorCommand } from '../src/native-supervisor-command-lanes.mjs';

const baseSource = await readFile(new URL('../src/native-supervisor-client-base.mjs', import.meta.url), 'utf8');

function response(status, body = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return structuredClone(body); },
  };
}

function identity() {
  return {
    async ensure() { return { device_id: 'dev_policy_parity', profile: 'BROWSER_SUPERVISOR' }; },
    snapshot() { return { device_id: 'dev_policy_parity', profile: 'BROWSER_SUPERVISOR' }; },
    async deviceHeaders() { return { 'content-type': 'application/json' }; },
    async enrollmentHeaders() { return { 'content-type': 'application/json' }; },
  };
}

function clientFor(command, { executeCommand, receipts }) {
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/v1/state')) return response(202, { accepted: true });
    if (path.endsWith('/v1/commands/wait-batch')) return response(200, { commands: [structuredClone(command)] });
    if (path.endsWith('/v1/commands/result-batch')) {
      const posted = JSON.parse(init.body || '{}');
      receipts.push(posted);
      return response(202, {
        schema: 'metaengine.native-browser-supervisor.complete-batch.v1',
        results: (posted.results || []).map((row) => ({
          command_id: row.command_id,
          accepted: true,
          status: row.ok === true ? 'COMPLETED' : 'FAILED',
          authority_effect: false,
        })),
        authority_effect: false,
      });
    }
    throw new Error(`unexpected_fetch:${path}`);
  };
  return new NativeSupervisorClient({
    identity: identity(),
    fetchImpl,
    version: '0.0.0-policy-test',
    getState: async () => ({ tabs: [], active_tab: null }),
    executeCommand,
    commandBatchWaitMs: 250,
  });
}

test('base authority policy delegates read-only truth to the central lane classifier', () => {
  assert.match(baseSource, /READ_ONLY_ACTIONS = Object\.freeze\(\{/);
  assert.match(baseSource, /classifyNativeSupervisorCommand\(\{ action \}\)\.read_only/);
  assert.doesNotMatch(baseSource, /READ_ONLY_ACTIONS = new Set\(/);

  for (const action of ['PROCESS_CENSUS', 'PROCESS_EVENTS', 'SEMANTIC_CENSUS', 'SEMANTIC_EVENTS', 'CONTROL_LATENCY_STATUS']) {
    assert.equal(classifyNativeSupervisorCommand({ action }).read_only, true, action);
  }
  assert.equal(classifyNativeSupervisorCommand({ action: 'NAVIGATE', payload: { tab_id: 'tab_a' } }).read_only, false);
});

test('MONITOR plus disarmed still admits semantic observation through the real batch execution path', async () => {
  const receipts = [];
  const executed = [];
  const client = clientFor(
    { command_id: '11111111-1111-4111-8111-111111111111', action: 'SEMANTIC_CENSUS', payload: {}, platform: null },
    {
      receipts,
      executeCommand: async (command) => {
        executed.push(command.action);
        return { schema: 'semantic-read-test.v1', authority_effect: false };
      },
    },
  );
  client.setControlState({ mode: 'MONITOR', armed: false });
  await client.cycle();
  assert.deepEqual(executed, ['SEMANTIC_CENSUS']);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].results[0].ok, true);
  assert.equal(receipts[0].results[0].receipt.effect_outcome, null);
  assert.equal(receipts[0].results[0].receipt.lane, 'READ_ONLY');
  client.stop();
});

test('MONITOR plus disarmed still rejects a tab mutation before the physical executor', async () => {
  const receipts = [];
  let physicalEffects = 0;
  const client = clientFor(
    { command_id: '22222222-2222-4222-8222-222222222222', action: 'NAVIGATE', payload: { tab_id: 'tab_a', url: 'https://example.com/' }, platform: null },
    {
      receipts,
      executeCommand: async () => {
        physicalEffects += 1;
        return { ok: true, effect_outcome: 'CONFIRMED' };
      },
    },
  );
  client.setControlState({ mode: 'MONITOR', armed: false });
  await client.cycle();
  assert.equal(physicalEffects, 0);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].results[0].ok, false);
  assert.match(receipts[0].results[0].error, /native_supervisor_control_required:MONITOR/);
  assert.equal(receipts[0].results[0].receipt.effect_outcome, 'AMBIGUOUS');
  client.stop();
});

test('DOWNLOAD_FILE completes only from an exact verified receipt and otherwise stays ambiguous', async () => {
  const digest = 'a'.repeat(64);
  const payload = {
    url: 'https://example.com/METAENGINE.exe',
    filename: 'METAENGINE.exe',
    expected_sha256: digest,
    max_bytes: 4096,
  };
  const verifiedReceipt = {
    schema: 'metaengine.verified-download-receipt.v1',
    request_id: '33333333-3333-4333-8333-333333333333',
    url: payload.url,
    url_chain: [payload.url],
    filename: payload.filename,
    path: `/tmp/${payload.filename}`,
    bytes: 2048,
    sha256: digest,
    completed_at: '2026-09-09T09:00:00.000Z',
    executable_started: false,
    authority_effect: true,
  };
  for (const [expected, result] of [
    ['CONFIRMED', verifiedReceipt],
    ['AMBIGUOUS', { ...verifiedReceipt, sha256: 'b'.repeat(64) }],
    ['AMBIGUOUS', { effect_outcome: 'CONFIRMED', effect_state: 'CONFIRMED' }],
  ]) {
    const receipts = [];
    const client = clientFor(
      { command_id: crypto.randomUUID(), action: 'DOWNLOAD_FILE', payload, platform: null },
      { receipts, executeCommand: async () => result },
    );
    client.setControlState({ mode: 'CONTROL', armed: true });
    await client.cycle();
    assert.equal(receipts[0].results[0].receipt.effect_outcome, expected);
    assert.equal(client.snapshot().last_command_status, expected === 'CONFIRMED' ? 'COMPLETED' : 'AMBIGUOUS');
    client.stop();
  }
});

test('failed read-only batch rows remain observation receipts, never ambiguous effects', () => {
  assert.match(baseSource, /descriptor\.read_only \? null : 'AMBIGUOUS'/);
  assert.doesNotMatch(baseSource, /row\.descriptor === COMMAND_LANES\.READ_ONLY/);
});
