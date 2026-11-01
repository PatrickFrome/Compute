import assert from 'node:assert/strict';
import test from 'node:test';
import { projectOwnPostgresClientConnection } from '../src/client-native-trust-boundary.mjs';
import { projectClientWorkReadiness } from '../src/client-work-readiness.mjs';
import { createClientRuntimeResource } from '../../me2-ui/src/lib/client-runtime-resource.ts';

// Compose the production IPC projections with the renderer resource. Inputs
// below are inert observations, not proof of an installed Owner or execution.
function readback(patch = {}, localProviderAttested = true) {
  const now = Date.now();
  const raw = { local_runtime_ready: true, admin_ready: true, access_tier: 'ADMIN',
    cloud_control_state: 'CONNECTED', ...patch };
  const work = projectClientWorkReadiness({ now, connection: raw, isCurrentBinding: () => true,
    snapshot: { supervisor_mode: 'CONTROL', armed: true, last_heartbeat_at: new Date(now).toISOString(),
      continuous_service: { actuation_allowed: true, runtime_control: {
        state: 'OPEN', authoritative: true, generation_floor: 28, refill_enabled: true,
        supervisor_admission_enabled: true, continuous_service_allowed: true, authority_effect: false,
      } },
      lifecycle: { keepalive: { state: 'WAITING', tab_id: 'tab_supervisor',
        conversation_url: 'https://chatgpt.com/c/test', admission_state: 'OPEN', admission_generation_floor: 28 } },
    },
    fleet: { agents: [{ agent_id: 'agent_implementer', role: 'IMPLEMENTER', lifecycle_state: 'ACTIVE',
      tab_id: 'tab_agent', target_id: 'target_agent', generation_epoch: 28,
      transport_proof: { tab_id: 'tab_agent', target_id: 'target_agent', generation_epoch: 28,
        agent_surface_sha256: 'a'.repeat(64), conversation_url_sha256: 'b'.repeat(64) } }] },
  });
  return { connection: projectOwnPostgresClientConnection(raw, { localProviderAttested }), work };
}
async function observe(t, next) {
  const timers = new Set();
  const resource = createClientRuntimeResource({ read: async () => next, isVisible: () => true,
    onVisibilityChange: () => () => {},
    schedule: () => { const id = {}; timers.add(id); return id; }, cancel: id => timers.delete(id) });
  t.after(resource.subscribe(() => {}));
  await resource.refresh();
  return resource.getSnapshot();
}

test('actual own-PG projection reaches chat-ready UI with cloud authority disabled', async t => {
  const next = readback();
  assert.equal(next.work.state, 'READY');
  assert.equal(next.connection.cloud_control_state, 'DISABLED');
  const state = await observe(t, next);
  assert.equal(state.state, 'LIVE');
  assert.equal(state.readback.connection.local_control_state, 'CONNECTED');
  assert.equal(state.readback.work.capabilities.coding_execution.ready, false);
  assert.equal(state.readback.work.continuous_autonomy_ready, false);
  assert.equal(state.readback.work.useful_work_verified, false);
});

test('local control state requires provider attestation and an allowlisted native observation', () => {
  assert.equal(readback({}, false).connection.local_control_state, 'UNAVAILABLE');
  assert.equal(readback({ local_runtime_ready: false }).connection.local_control_state, 'UNAVAILABLE');
  for (const state of ['CONNECTED', 'CONNECTING', 'RECONNECTING', 'LOCAL_ONLY', 'ENROLLMENT_REQUIRED']) {
    assert.equal(readback({ cloud_control_state: state }).connection.local_control_state, state);
  }
  for (const state of [null, '', 'ACTIVE', 'PRIVATE_ERROR', 'CONNECTED\nsecret']) {
    const connection = readback({ cloud_control_state: state }).connection;
    assert.equal(connection.local_control_state, 'UNAVAILABLE');
    assert.equal(connection.cloud_control_state, 'DISABLED');
  }
});

test('ready UI rejects inconsistent local readback and never falls back to a cloud flag', async t => {
  for (const patch of [{ local_control_state: 'RECONNECTING' }, { local_control_state: undefined },
    { local_runtime_ready: false }, { admin_ready: false }]) {
    const next = readback(); Object.assign(next.connection = { ...next.connection }, patch);
    next.connection.cloud_control_state = 'CONNECTED';
    assert.equal((await observe(t, next)).state, 'UNAVAILABLE');
  }
});

test('actual disconnected local projection preserves explanatory BLOCKED status', async t => {
  const next = readback({ cloud_control_state: 'RECONNECTING' });
  assert.equal(next.work.state, 'BLOCKED');
  const state = await observe(t, next);
  assert.equal(state.state, 'LIVE');
  assert.equal(state.readback.work.execution_ready, false);
});
