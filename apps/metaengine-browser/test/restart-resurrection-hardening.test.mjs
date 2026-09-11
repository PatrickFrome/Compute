import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  NATIVE_SUPERVISOR_CONTROL_STATE_SCHEMA,
  loadNativeSupervisorControlState,
  persistNativeSupervisorControlState,
} from '../src/native-supervisor-control-state.mjs';
import { FleetProvisioner } from '../src/fleet-provisioner.mjs';

test('persisted CONTROL authority survives a process boundary as the sole final-runtime state', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-control-restart-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const statePath = path.join(dir, 'native-supervisor-control-state.json');

  await persistNativeSupervisorControlState(statePath, {
    supervisor_mode: 'CONTROL',
    armed: true,
  });

  const restored = await loadNativeSupervisorControlState(statePath);
  assert.equal(restored.supervisor_mode, 'CONTROL');
  assert.equal(restored.armed, true);
  assert.equal(restored.recovered_fail_closed, false);
  assert.equal(restored.recovery_reason, null);
  assert.equal(restored.authority_effect, false);
});

test('legacy MONITOR/disarmed checkpoint is migrated to CONTROL+armed at restart without becoming effect authority', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-monitor-restart-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const statePath = path.join(dir, 'native-supervisor-control-state.json');

  await fs.writeFile(statePath, `${JSON.stringify({
    schema: NATIVE_SUPERVISOR_CONTROL_STATE_SCHEMA,
    supervisor_mode: 'MONITOR',
    armed: false,
    updated_at: '2026-09-09T00:00:00.000Z',
    recovered_fail_closed: false,
    recovery_reason: null,
    authority_effect: false,
  }, null, 2)}\n`);

  const restored = await loadNativeSupervisorControlState(statePath);
  assert.equal(restored.supervisor_mode, 'CONTROL');
  assert.equal(restored.armed, true);
  assert.equal(restored.recovered_fail_closed, true);
  assert.equal(restored.recovery_reason, 'LEGACY_AUTHORITY_STATE_MIGRATED');
  assert.equal(restored.authority_effect, false);

  const rewritten = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(rewritten.supervisor_mode, 'CONTROL');
  assert.equal(rewritten.armed, true);
});

test('restart-lost fleet identity is preserved as evidence, never resurrected, and demand gets a fresh agent id', async () => {
  const oldAgentId = 'agent_aaaaaaaa';
  const spawnedAgentIds = [];
  let savedState = {
    schema: 'metaengine.browser.fleet-state.v1',
    version: '1.5.0',
    policy: {},
    updated_at: '2026-09-09T00:00:00.000Z',
    agents: [{
      agent_id: oldAgentId,
      role: 'RESEARCHER',
      ownership: 'FLEET_OWNED',
      lifecycle_state: 'ACTIVE',
      tab_id: 'old-tab',
      target_id: 'webcontents:11',
      conversation_epoch: 3,
      generation_epoch: 4,
      created_at: '2026-09-08T00:00:00.000Z',
      updated_at: '2026-09-08T23:00:00.000Z',
      lost_reason: null,
      ambiguous_reason: null,
      transport_proof: null,
      automatic_retry_allowed: false,
      authority_effect: false,
    }],
  };

  const provisioner = new FleetProvisioner({
    createTab: async ({ agent_id }) => {
      spawnedAgentIds.push(agent_id);
      return { tab_id: 'fresh-tab', webcontents_id: 22 };
    },
    loadTab: async () => {},
    tabExists: () => false,
    loadState: async () => structuredClone(savedState),
    saveState: async (next) => { savedState = structuredClone(next); },
    policy: {
      profile: 'BALANCED',
      warm_agents: 0,
      desired_agents: 1,
      spawn_burst_limit: 8,
    },
    clock: () => Date.parse('2026-09-09T06:00:00.000Z'),
    uuid: () => 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  });

  const initialized = await provisioner.init();
  const lost = initialized.agents.find((agent) => agent.agent_id === oldAgentId);
  assert.equal(lost.lifecycle_state, 'LOST');
  assert.equal(lost.lost_reason, 'PHYSICAL_TAB_MISSING_ON_RESTART');
  assert.equal(lost.automatic_retry_allowed, false);

  const reconciled = await provisioner.reconcile({ active: true, target_agents: 1 });
  const oldAfter = reconciled.agents.find((agent) => agent.agent_id === oldAgentId);
  const fresh = reconciled.agents.find((agent) => agent.agent_id !== oldAgentId && agent.lifecycle_state === 'BOUND_UNVERIFIED');

  assert.equal(oldAfter.lifecycle_state, 'LOST');
  assert.equal(oldAfter.lost_reason, 'PHYSICAL_TAB_MISSING_ON_RESTART');
  assert.equal(oldAfter.automatic_retry_allowed, false);
  assert.deepEqual(spawnedAgentIds, ['agent_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']);
  assert.ok(fresh);
  assert.notEqual(fresh.agent_id, oldAgentId);
  assert.equal(fresh.tab_id, 'fresh-tab');
  assert.equal(reconciled.counts.LOST, 1);
  assert.equal(reconciled.counts.RETIRED, 0);
  assert.equal(reconciled.counts.BOUND_UNVERIFIED, 1);
});
