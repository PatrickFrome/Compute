import test from 'node:test';
import assert from 'node:assert/strict';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';

const lease = {
  task_id: '09f2e414-5c31-4fc7-87a3-f5de1315cb81',
  agent_id: 'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',
  role: 'IMPLEMENTER',
  tab_id: 'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa6',
  target_id: 'webcontents:10',
  agent_generation_epoch: 7,
  lease_generation: 1,
  base_sha: '724612235eb7ceb4534c13d126425b274d876394',
  branch_name: 'work/devos-native-task-dispatch-v1',
  automatic_retry_allowed: false,
  task_spec: { schema: 'metaengine.devos.task.v1', objective: 'Implement safe slice.' },
};

const fleet = {
  schema: 'metaengine.browser.fleet-snapshot.v1',
  readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
  policy: { warm_agents: 1, spawn_burst_limit: 4 },
  agents: [{
    agent_id: lease.agent_id,
    role: lease.role,
    lifecycle_state: 'BOUND_UNVERIFIED',
    tab_id: lease.tab_id,
    target_id: lease.target_id,
    generation_epoch: lease.agent_generation_epoch,
    transport_proof: {
      schema: 'metaengine.browser.fleet-transport-proof.v1',
      transport_stage: 'PRECONVERSATION_ROOT',
      tab_id: lease.tab_id,
      target_id: lease.target_id,
      generation_epoch: lease.agent_generation_epoch,
      conversation_url_sha256: 'a'.repeat(64),
      proven_at: '2026-09-18T16:00:00.000Z',
      authority_effect: false,
    },
    automatic_retry_allowed: false,
    authority_effect: false,
  }],
};

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, async json(){ return structuredClone(body); } };
}

test('R98 scheduler never materializes a leased task from PRECONVERSATION_ROOT', async () => {
  const commands = [];
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({
      fleet,
      active_tab: { tab_id: 'tab_supervisor' },
      tabs: [
        { tab_id: 'tab_supervisor', selected: true },
        { tab_id: lease.tab_id, selected: false },
      ],
    }),
    executeCommand: async (command) => {
      commands.push(command.action);
      if (command.action === 'FLEET_RECONCILE') return fleet;
      throw new Error(`root_task_effect_must_not_run:${command.action}`);
    },
    signedRequest: async (requestPath) => {
      if (requestPath === '/v1/devos/cycle') {
        return response(200, {
          schema: 'metaengine.devos.browser-cycle.v1',
          backlog: { ready: 1, running: 0 },
          lease,
          running: [],
        });
      }
      throw new Error(`unexpected_request:${requestPath}`);
    },
  });

  await assert.rejects(() => cycle.cycle(), /devos_agent_state_invalid:ADMISSION_FENCED/);
  assert.deepEqual(commands, ['FLEET_RECONCILE']);
  const snapshot = cycle.snapshot();
  assert.equal(snapshot.bound_unverified_dispatch_allowed, false);
  assert.equal(snapshot.leased_dispatch_requires_preexisting_agent_conversation, true);
  assert.equal(snapshot.pre_admission_agent_bootstrap_owner, 'DEVOS_NATIVE_TASK_CYCLE_WRAPPER');
});
