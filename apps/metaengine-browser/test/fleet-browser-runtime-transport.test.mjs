import test from 'node:test';
import assert from 'node:assert/strict';
import { createFleetBrowserRuntimeTransport } from '../src/fleet-browser-runtime-transport.mjs';

function boundAgent(overrides = {}) {
  return {
    agent_id: 'agent_test-12345678',
    lifecycle_state: 'BOUND_UNVERIFIED',
    tab_id: 'tab_1',
    target_id: 'webcontents:101',
    generation_epoch: 7,
    transport_proof: null,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
}

function localView(overrides = {}) {
  return {
    webContents: {
      id: 101,
      isDestroyed: () => false,
      isLoadingMainFrame: () => false,
      getURL: () => 'https://chatgpt.com/c/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
      ...overrides,
    },
  };
}

function fixture({ agent = boundAgent(), view = localView() } = {}) {
  const calls = [];
  const provisioner = {
    snapshot: () => ({ agents: [agent] }),
    markTransportProven: async (input) => {
      calls.push(input);
      return { ok: true, lifecycle_state: 'ACTIVE' };
    },
  };
  const runtime = createFleetBrowserRuntimeTransport({
    provisioner,
    lookupView: () => view,
  });
  return { runtime, calls };
}

test('runtime facade promotes only from current Browser-local WebContents evidence', async () => {
  const { runtime, calls } = fixture();
  assert.equal(runtime.raw_transport_promotion_exposed, false);
  assert.equal(runtime.proof_input_surface_exposed, false);
  assert.equal('markTransportProven' in runtime, false);
  assert.equal('provisioner' in runtime, false);

  const result = await runtime.promoteAgentFromLiveLocalTransport({ agent_id: 'agent_test-12345678' });
  assert.deepEqual(result, { ok: true, lifecycle_state: 'ACTIVE' });
  assert.deepEqual(calls, [{
    agent_id: 'agent_test-12345678',
    tab_id: 'tab_1',
    target_id: 'webcontents:101',
    generation_epoch: 7,
    conversation_url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  }]);
});

test('caller-supplied proof-like fields cannot override local runtime evidence', async () => {
  const { runtime, calls } = fixture();
  await runtime.promoteAgentFromLiveLocalTransport({
    agent_id: 'agent_test-12345678',
    proof_input: {
      tab_id: 'tab_attacker',
      target_id: 'webcontents:999',
      generation_epoch: 999,
      conversation_url: 'https://example.com/',
    },
    tab_id: 'tab_attacker',
    target_id: 'webcontents:999',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tab_id, 'tab_1');
  assert.equal(calls[0].target_id, 'webcontents:101');
  assert.equal(calls[0].generation_epoch, 7);
  assert.match(calls[0].conversation_url, /^https:\/\/chatgpt\.com\/c\//);
});

test('replacement WebContents incarnation fails closed before promotion', async () => {
  const { runtime, calls } = fixture({ view: localView({ id: 102 }) });
  await assert.rejects(
    runtime.promoteAgentFromLiveLocalTransport({ agent_id: 'agent_test-12345678' }),
    /fleet_local_transport_/,
  );
  assert.equal(calls.length, 0);
});

test('destroyed or loading WebContents fails closed before promotion', async () => {
  for (const view of [
    localView({ isDestroyed: () => true }),
    localView({ isLoadingMainFrame: () => true }),
  ]) {
    const { runtime, calls } = fixture({ view });
    await assert.rejects(
      runtime.promoteAgentFromLiveLocalTransport({ agent_id: 'agent_test-12345678' }),
      /fleet_local_transport_/,
    );
    assert.equal(calls.length, 0);
  }
});

test('ACTIVE or authority-bearing agent cannot cross runtime transport boundary', async () => {
  for (const agent of [
    boundAgent({ lifecycle_state: 'ACTIVE' }),
    boundAgent({ authority_effect: true }),
    boundAgent({ automatic_retry_allowed: true }),
    boundAgent({ transport_proof: { schema: 'stale' } }),
  ]) {
    const { runtime, calls } = fixture({ agent });
    await assert.rejects(
      runtime.promoteAgentFromLiveLocalTransport({ agent_id: 'agent_test-12345678' }),
      /fleet_runtime_transport_/,
    );
    assert.equal(calls.length, 0);
  }
});
