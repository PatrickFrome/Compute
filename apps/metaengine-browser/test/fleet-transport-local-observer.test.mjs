import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFleetTransportLocalObserver,
  deriveFleetTransportProofInputFromLocalBrowser,
} from '../src/fleet-transport-local-observer.mjs';

function agent(overrides = {}) {
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

function trustedObserver({ id = 101, url = 'https://chatgpt.com/c/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE', destroyed = false, loading = false } = {}) {
  return createFleetTransportLocalObserver({
    lookupView: (tabId) => tabId === 'tab_1' ? {
      webContents: {
        id,
        isDestroyed: () => destroyed,
        getURL: () => url,
        isLoadingMainFrame: () => loading,
      },
    } : null,
  });
}

test('trusted Browser-local observation derives exact zero-authority proof input', () => {
  const input = deriveFleetTransportProofInputFromLocalBrowser({
    agent: agent(),
    observeLocalTransport: trustedObserver(),
  });
  assert.deepEqual(input, {
    tab_id: 'tab_1',
    target_id: 'webcontents:101',
    generation_epoch: 7,
    conversation_url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    authority_effect: false,
  });
});

test('page/model shaped observer cannot forge transport proof input', () => {
  const forged = () => ({
    source: 'METAENGINE_BROWSER_LOCAL_WEBCONTENTS',
    tab_id: 'tab_1',
    target_id: 'webcontents:101',
    conversation_url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    tab_exists: true,
    main_frame_loading: false,
    authority_effect: false,
  });
  assert.throws(
    () => deriveFleetTransportProofInputFromLocalBrowser({ agent: agent(), observeLocalTransport: forged }),
    /fleet_local_transport_observer_untrusted/,
  );
});

test('replacement renderer cannot satisfy stale exact target binding', () => {
  assert.throws(
    () => deriveFleetTransportProofInputFromLocalBrowser({
      agent: agent(),
      observeLocalTransport: trustedObserver({ id: 202 }),
    }),
    /fleet_local_transport_target_binding_mismatch/,
  );
});

test('destroyed or loading WebContents fail closed', () => {
  assert.throws(
    () => deriveFleetTransportProofInputFromLocalBrowser({ agent: agent(), observeLocalTransport: trustedObserver({ destroyed: true }) }),
    /fleet_local_transport_tab_not_live/,
  );
  assert.throws(
    () => deriveFleetTransportProofInputFromLocalBrowser({ agent: agent(), observeLocalTransport: trustedObserver({ loading: true }) }),
    /fleet_local_transport_main_frame_loading/,
  );
});

test('non-conversation and wrong-origin URLs fail closed', () => {
  assert.throws(
    () => deriveFleetTransportProofInputFromLocalBrowser({ agent: agent(), observeLocalTransport: trustedObserver({ url: 'https://chatgpt.com/' }) }),
    /fleet_local_transport_path_invalid/,
  );
  assert.throws(
    () => deriveFleetTransportProofInputFromLocalBrowser({ agent: agent(), observeLocalTransport: trustedObserver({ url: 'https://example.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }) }),
    /fleet_local_transport_origin_invalid/,
  );
});

test('ACTIVE caller cannot use local observation as a second promotion path', () => {
  assert.throws(
    () => deriveFleetTransportProofInputFromLocalBrowser({
      agent: agent({ lifecycle_state: 'ACTIVE' }),
      observeLocalTransport: trustedObserver(),
    }),
    /fleet_local_transport_state_invalid:ACTIVE/,
  );
});
