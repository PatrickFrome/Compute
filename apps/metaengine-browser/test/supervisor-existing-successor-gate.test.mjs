import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existingSupervisorRolloverProof,
  createExistingSupervisorRolloverGate,
} from '../src/supervisor-existing-successor-gate.mjs';

const keepalive = {
  state: 'ROLLOVER_PENDING',
  supervisor_epoch: 4,
  conversation_url: 'https://chatgpt.com/c/primary',
  rollover_attempt: {
    attempt_id: 'rollover_exact-1',
    previous_conversation: 'https://chatgpt.com/c/primary',
  },
};

const standby = {
  supervisor_id: 'sup_standby',
  conversation_url: 'https://chatgpt.com/c/standby',
  status: 'ACTIVE',
  tab_id: 'tab_standby',
  tab_incarnations: ['tab_standby'],
  supervisor_capable: true,
  fleet_bound: false,
  coordination_blocked: false,
  pending_delivery: null,
  ambiguous_delivery: null,
};

const mesh = {
  schema: 'metaengine.supervisor-mesh.state.v2',
  supervisors: [standby],
};

test('proof requires a pending rollover and unique active non-fleet standby', () => {
  const proof = existingSupervisorRolloverProof({ keepalive, mesh });
  assert.equal(proof.suppress_new_tab, true);
  assert.equal(proof.rollover_attempt_id, 'rollover_exact-1');
  assert.equal(proof.existing_successor_count, 1);
  for (const patch of [
    { status: 'AMBIGUOUS_INCARNATION' },
    { fleet_bound: true },
    { coordination_blocked: true },
    { tab_incarnations: ['tab_standby', 'tab_duplicate'] },
    { pending_delivery: { delivery_id: 'd1' } },
    { ambiguous_delivery: { delivery_id: 'd2' } },
  ]) {
    assert.equal(existingSupervisorRolloverProof({ keepalive, mesh: { ...mesh, supervisors: [{ ...standby, ...patch }] } }).suppress_new_tab, false);
  }
});

test('gate suppresses only internal root NEW_TAB and performs zero Browser effect', async () => {
  const effects = [];
  const executeCommand = async (command) => { effects.push(command); return { tab_id: 'tab_new' }; };
  const gate = createExistingSupervisorRolloverGate({
    executeCommand,
    loadProof: async () => existingSupervisorRolloverProof({ keepalive, mesh }),
  });
  const suppressed = await gate({ action: 'NEW_TAB', payload: { url: 'https://chatgpt.com/', select: false }, platform: null });
  assert.equal(suppressed.suppressed, true);
  assert.equal(suppressed.reason, 'MESH_EXISTING_SUCCESSOR_AVAILABLE');
  assert.equal(effects.length, 0);

  await gate({ command_id: 'remote-1', action: 'NEW_TAB', payload: { url: 'https://chatgpt.com/', select: false }, platform: null });
  await gate({ action: 'NEW_TAB', payload: { url: 'https://example.com/', select: false }, platform: null });
  assert.equal(effects.length, 2);
});

test('proof failure falls back to legacy exact NEW_TAB path instead of inventing a successor', async () => {
  const effects = [];
  const gate = createExistingSupervisorRolloverGate({
    executeCommand: async (command) => { effects.push(command); return { tab_id: 'tab_new' }; },
    loadProof: async () => ({ suppress_new_tab: false, authority_effect: false }),
  });
  const result = await gate({ action: 'NEW_TAB', payload: { url: 'https://chatgpt.com/', select: false }, platform: null });
  assert.equal(result.tab_id, 'tab_new');
  assert.equal(effects.length, 1);
});
