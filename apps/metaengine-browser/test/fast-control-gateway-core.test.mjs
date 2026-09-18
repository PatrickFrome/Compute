import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FAST_CONTROL_MAX_STEPS,
  FAST_CONTROL_TOOL_NAMES,
  FastControlGatewayCore,
  fastControlToolManifest,
} from '../src/fast-control-gateway-core.mjs';
import { CONTROL_ACTION_MANIFEST_REVISION } from '../src/control-actions-manifest.mjs';

function gateway(overrides = {}) {
  const calls = { context: [], dev: [], batch: [], delta: [], emergency: [] };
  const instance = new FastControlGatewayCore({
    contextGet: async (input) => { calls.context.push(input); return { revision: 'ctx:test', authority_effect: false }; },
    devQuery: async (input) => { calls.dev.push(input); return { revision: 'dev:test', hits: [], authority_effect: false }; },
    issueBatch: async (input) => { calls.batch.push(input); return { accepted: true, authority_effect: false }; },
    resultDelta: async (input) => { calls.delta.push(input); return { next_seq: input.after_seq, results: [], authority_effect: false }; },
    issueEmergency: async (input) => { calls.emergency.push(input); return { accepted: true, authority_effect: false }; },
    ...overrides,
  });
  return { instance, calls };
}

test('gateway exposes exactly five goal-level tools and no raw execution surface', () => {
  assert.deepEqual(FAST_CONTROL_TOOL_NAMES, ['context_get', 'dev_query', 'run_submit', 'run_status', 'emergency_stop']);
  const manifest = fastControlToolManifest();
  assert.equal(manifest.tools.length, 5);
  assert.equal(manifest.raw_sql, false);
  assert.equal(manifest.arbitrary_eval, false);
  assert.equal(manifest.raw_cdp_passthrough, false);
  assert.equal(manifest.command_leasing_authority, false);
  assert.equal(manifest.browser_execution_authority, false);
  assert.equal(manifest.authority_effect, false);
});

test('dev_query is one bounded read-only indexed lookup for chat', async () => {
  const { instance, calls } = gateway();
  const result = await instance.invoke('dev_query', {
    query: 'emergency boundedNavigation',
    kinds: ['BLOCKER', 'CI'],
    limit: 6,
    if_none_match: 'q:old',
    max_bytes: 4096,
  });
  assert.equal(calls.dev.length, 1);
  assert.deepEqual(calls.dev[0], {
    query: 'emergency boundedNavigation',
    kinds: ['BLOCKER', 'CI'],
    limit: 6,
    if_none_match: 'q:old',
    max_bytes: 4096,
    authority_effect: false,
  });
  assert.equal(result.indexed_read_only, true);
  assert.equal(result.network_reads_required_by_gateway, 0);
  assert.equal(result.filesystem_reads_required_by_gateway, 0);
  assert.equal(result.command_leasing_authority, false);
  assert.equal(result.authority_effect, false);
  await assert.rejects(() => instance.invoke('dev_query', { query: '', limit: 6 }), /dev_query_invalid/);
  await assert.rejects(() => instance.invoke('dev_query', { query: 'x', limit: 13 }), /dev_query_limit_invalid/);
  await assert.rejects(() => instance.invoke('dev_query', { query: 'x', kinds: ['PAGE_TEXT'] }), /dev_query_kinds_invalid/);
});

test('run_submit is capability-revision fenced and delegates one bounded batch', async () => {
  const { instance, calls } = gateway();
  const result = await instance.invoke('run_submit', {
    capability_revision: CONTROL_ACTION_MANIFEST_REVISION,
    steps: [{ idempotency_key: 'run:test:001', action: 'POLL', payload: {} }],
  });
  assert.equal(calls.batch.length, 1);
  assert.equal(calls.batch[0].steps.length, 1);
  assert.equal(calls.batch[0].capability_revision, CONTROL_ACTION_MANIFEST_REVISION);
  assert.equal(result.browser_effect_executed_by_gateway, false);
  assert.equal(result.command_leasing_authority, false);
  assert.equal(result.authority_effect, false);
  await assert.rejects(() => instance.invoke('run_submit', {
    capability_revision: 'sha256:stale',
    steps: [{ idempotency_key: 'run:test:002', action: 'POLL', payload: {} }],
  }), /capability_revision_mismatch/);
});

test('run_submit hard-bounds step count and rejects duplicate idempotency keys', async () => {
  const { instance } = gateway();
  const tooMany = Array.from({ length: FAST_CONTROL_MAX_STEPS + 1 }, (_, index) => ({
    idempotency_key: `run:test:${String(index).padStart(3, '0')}`,
    action: 'POLL',
    payload: {},
  }));
  await assert.rejects(() => instance.invoke('run_submit', {
    capability_revision: CONTROL_ACTION_MANIFEST_REVISION,
    steps: tooMany,
  }), /run_steps_invalid/);
  await assert.rejects(() => instance.invoke('run_submit', {
    capability_revision: CONTROL_ACTION_MANIFEST_REVISION,
    steps: [
      { idempotency_key: 'run:test:dup', action: 'POLL', payload: {} },
      { idempotency_key: 'run:test:dup', action: 'POLL', payload: {} },
    ],
  }), /duplicate_idempotency_key/);
});

test('run_status is one monotonic result-delta read', async () => {
  const { instance, calls } = gateway();
  const result = await instance.invoke('run_status', { after_seq: 41, limit: 8 });
  assert.deepEqual(calls.delta, [{ after_seq: 41, limit: 8 }]);
  assert.equal(result.authority_effect, false);
  await assert.rejects(() => instance.invoke('run_status', { after_seq: -1, limit: 8 }), /after_seq_invalid/);
  await assert.rejects(() => instance.invoke('run_status', { after_seq: 0, limit: 17 }), /result_limit_invalid/);
});

test('emergency_stop can only issue DISARM or supervisor OFF and never executes locally', async () => {
  const { instance, calls } = gateway();
  const disarm = await instance.invoke('emergency_stop', { kind: 'DISARM', idempotency_key: 'emergency:001', reason: 'owner stop' });
  const off = await instance.invoke('emergency_stop', { kind: 'OFF', idempotency_key: 'emergency:002' });
  assert.equal(calls.emergency.length, 2);
  assert.equal(calls.emergency[0].command.action, 'DISARM');
  assert.equal(calls.emergency[1].command.action, 'SET_SUPERVISOR_MODE');
  assert.equal(calls.emergency[1].command.payload.mode, 'OFF');
  assert.equal(disarm.browser_effect_executed_by_gateway, false);
  assert.equal(off.emergency_transport_is_authority, false);
  await assert.rejects(() => instance.invoke('emergency_stop', { kind: 'ARM', idempotency_key: 'emergency:003' }), /emergency_kind_invalid/);
});

test('unknown tools and unknown fields fail closed before delegated calls', async () => {
  const { instance, calls } = gateway();
  await assert.rejects(() => instance.invoke('raw_sql', {}), /tool_unknown/);
  await assert.rejects(() => instance.invoke('context_get', { query: 'select 1' }), /context_field_unknown/);
  await assert.rejects(() => instance.invoke('dev_query', { query: 'x', sql: 'select 1' }), /dev_query_field_unknown/);
  await assert.rejects(() => instance.invoke('run_status', { after_seq: 0, limit: 1, sql: 'x' }), /run_status_field_unknown/);
  assert.equal(calls.context.length + calls.dev.length + calls.batch.length + calls.delta.length + calls.emergency.length, 0);
});
