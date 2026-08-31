import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFleetTransportLocalObserver,
  deriveFleetTransportProofInputFromLocalBrowser,
} from '../src/fleet-transport-local-observer.mjs';
import { createFleetTrustedTransportPromotion } from '../src/fleet-trusted-transport-promotion.mjs';

function agent() {
  return {
    agent_id: 'agent_test-12345678',
    lifecycle_state: 'BOUND_UNVERIFIED',
    tab_id: 'tab_1',
    target_id: 'webcontents:101',
    generation_epoch: 7,
    transport_proof: null,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function trustedProofInput() {
  const observe = createFleetTransportLocalObserver({
    lookupView: () => ({
      webContents: {
        id: 101,
        isDestroyed: () => false,
        getURL: () => 'https://chatgpt.com/c/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
        isLoadingMainFrame: () => false,
      },
    }),
  });
  return deriveFleetTransportProofInputFromLocalBrowser({ agent: agent(), observeLocalTransport: observe });
}

test('trusted adapter forwards only exact branded Browser-local proof fields', async () => {
  const calls = [];
  const adapter = createFleetTrustedTransportPromotion({
    provisioner: { markTransportProven: async (input) => { calls.push(input); return { ok: true }; } },
  });
  assert.equal(adapter.raw_transport_promotion_exposed, false);
  assert.equal('markTransportProven' in adapter, false);

  const result = await adapter.promoteFromTrustedLocalProof({
    agent_id: 'agent_test-12345678',
    proof_input: trustedProofInput(),
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{
    agent_id: 'agent_test-12345678',
    tab_id: 'tab_1',
    target_id: 'webcontents:101',
    generation_epoch: 7,
    conversation_url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  }]);
});

test('raw page/model/WebMCP-shaped proof cannot cross trusted promotion boundary', async () => {
  let called = false;
  const adapter = createFleetTrustedTransportPromotion({
    provisioner: { markTransportProven: async () => { called = true; } },
  });
  await assert.rejects(
    adapter.promoteFromTrustedLocalProof({
      agent_id: 'agent_test-12345678',
      proof_input: {
        tab_id: 'tab_1',
        target_id: 'webcontents:101',
        generation_epoch: 7,
        conversation_url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        authority_effect: false,
      },
    }),
    /fleet_local_transport_proof_input_untrusted/,
  );
  assert.equal(called, false);
});

test('copying a trusted proof strips module identity and fails closed', async () => {
  const adapter = createFleetTrustedTransportPromotion({
    provisioner: { markTransportProven: async () => ({ ok: true }) },
  });
  const copied = { ...trustedProofInput() };
  await assert.rejects(
    adapter.promoteFromTrustedLocalProof({ agent_id: 'agent_test-12345678', proof_input: copied }),
    /fleet_local_transport_proof_input_untrusted/,
  );
});
