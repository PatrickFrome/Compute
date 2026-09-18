import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiRuntimeFrontierIntake,
  RSI_RUNTIME_FRONTIER_INTAKE_RPC,
} from '../supabase/a2-browser-native-supervisor-v1/rsi-runtime-frontier-intake.mjs';

test('frontier intake skips state without RSI', async () => {
  let calls = 0;
  const intake = createRsiRuntimeFrontierIntake({ rpc: async () => { calls += 1; return {}; } });
  const result = await intake({
    workspaceId: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
    clientId: 'client-1',
    state: { schema: 'metaengine.native-browser-supervisor.state.v1' },
  });
  assert.equal(calls, 0);
  assert.equal(result.state, 'SKIPPED');
  assert.equal(result.authority_effect, false);
});

test('frontier intake invokes existing DB policy once with zero authority', async () => {
  const calls = [];
  const intake = createRsiRuntimeFrontierIntake({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { accepted: true, state: 'ADVISORY_REVIEW_MATERIALIZED', authority_effect: false };
    },
  });
  const result = await intake({
    workspaceId: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
    clientId: 'client-2',
    state: { rsi: { schema: 'metaengine.rsi.runtime-control-projection.v1', authority_effect: false } },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, RSI_RUNTIME_FRONTIER_INTAKE_RPC);
  assert.equal(result.state, 'ACCEPTED');
  assert.equal(result.scheduler, 'DEVOS_EXISTING_ONLY');
  assert.equal(result.browser_enqueue_authority, false);
  assert.equal(result.execution_authority, false);
  assert.equal(result.promotion_authority, false);
  assert.equal(result.self_update_authority, false);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.authority_effect, false);
});

test('frontier intake DB failure is fail-soft without retry authority', async () => {
  const intake = createRsiRuntimeFrontierIntake({
    rpc: async () => { throw new Error('synthetic_failure'); },
  });
  const result = await intake({
    workspaceId: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
    clientId: 'client-3',
    state: { rsi: { schema: 'metaengine.rsi.runtime-control-projection.v1', authority_effect: false } },
  });
  assert.equal(result.state, 'ERROR');
  assert.equal(result.reason, 'INTAKE_RPC_FAILED');
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.authority_effect, false);
});
