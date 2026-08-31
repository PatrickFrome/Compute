import test from 'node:test';
import assert from 'node:assert/strict';
import { createFleetBrowserMainTransport } from '../src/fleet-browser-main-transport.mjs';

function boundAgent() {
  return {
    agent_id: 'agent_main-12345678',
    lifecycle_state: 'BOUND_UNVERIFIED',
    tab_id: 'tab_1',
    target_id: 'webcontents:101',
    generation_epoch: 9,
    transport_proof: null,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function fixture() {
  const calls = [];
  const agent = boundAgent();
  const fleet = {
    snapshot: () => ({ agents: [agent] }),
    markTransportProven: async (input) => {
      calls.push(input);
      return { ok: true, lifecycle_state: 'ACTIVE' };
    },
  };
  const transport = createFleetBrowserMainTransport({
    fleet,
    lookupView: (tabId) => tabId === 'tab_1' ? {
      webContents: {
        id: 101,
        isDestroyed: () => false,
        isLoadingMainFrame: () => false,
        getURL: () => 'https://chatgpt.com/c/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
      },
    } : null,
  });
  return { transport, calls };
}

test('main-process composition exposes no raw provisioner or proof-input surface', async () => {
  const { transport, calls } = fixture();
  assert.equal(Object.isFrozen(transport), true);
  assert.equal(transport.raw_transport_promotion_exposed, false);
  assert.equal(transport.proof_input_surface_exposed, false);
  assert.equal(transport.renderer_input_authority, false);
  assert.equal(transport.worker_browser_authority, false);
  assert.equal('markTransportProven' in transport, false);
  assert.equal('fleet' in transport, false);
  assert.equal('provisioner' in transport, false);

  const result = await transport.promoteAgentFromLiveBrowser({ agent_id: 'agent_main-12345678' });
  assert.deepEqual(result, { ok: true, lifecycle_state: 'ACTIVE' });
  assert.deepEqual(calls, [{
    agent_id: 'agent_main-12345678',
    tab_id: 'tab_1',
    target_id: 'webcontents:101',
    generation_epoch: 9,
    conversation_url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  }]);
});

test('proof-shaped renderer or worker fields cannot override Browser-local evidence', async () => {
  const { transport, calls } = fixture();
  await transport.promoteAgentFromLiveBrowser({
    agent_id: 'agent_main-12345678',
    tab_id: 'tab_attacker',
    target_id: 'webcontents:999',
    generation_epoch: 999,
    proof_input: { authority_effect: true },
    worker_authorized: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tab_id, 'tab_1');
  assert.equal(calls[0].target_id, 'webcontents:101');
  assert.equal(calls[0].generation_epoch, 9);
});

test('main-process boundary requires agent identity and does not accept arbitrary remote eval', async () => {
  const { transport, calls } = fixture();
  await assert.rejects(transport.promoteAgentFromLiveBrowser({}), /agent_id_required/);
  assert.equal('eval' in transport, false);
  assert.equal('execute' in transport, false);
  assert.equal(calls.length, 0);
});
