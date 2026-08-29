import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FleetRuntimeStore } from '../src/fleet-runtime-store-v1.mjs';
import { FleetRuntime } from '../src/fleet-runtime-v1.mjs';
import { SystemIntelligence } from '../src/system-intelligence-v1.mjs';
import { AutonomousWorkScheduler } from '../src/autonomous-work-scheduler-v1.mjs';
import { AutonomousAssignmentDispatcher } from '../src/autonomous-assignment-dispatcher-v1.mjs';

async function harness() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-dispatch-'));
  let now = Date.parse('2026-08-29T19:00:00Z');
  let seq = 0;
  const clock = () => now;
  const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const store = new FleetRuntimeStore({ statePath: path.join(dir, 'runtime.json'), clock });
  const fleetRuntime = new FleetRuntime({ store, clock, uuid });
  await fleetRuntime.init();
  const intelligence = new SystemIntelligence({ store, clock, uuid });
  const scheduler = new AutonomousWorkScheduler({ store, clock, uuid });
  const dispatcher = new AutonomousAssignmentDispatcher({ store, fleetRuntime, clock, uuid });
  return { dir, store, fleetRuntime, intelligence, scheduler, dispatcher, clock, advance: (ms) => { now += ms; } };
}

async function prepare(h, { source_system = 'SUPABASE', authority = 'SUPABASE' } = {}) {
  await h.fleetRuntime.bindWorkerIncarnation({
    agent_id: 'agent_research', role: 'RESEARCHER', lifecycle_state: 'BOUND_UNVERIFIED',
    tab_id: 'tab-r', target_id: 'webcontents:81', generation_epoch: 1, conversation_epoch: 0,
  });
  const process = await h.intelligence.ingestProcessObservation({
    source_system,
    source_instance: source_system === 'GITHUB' ? 'PatrickFrome/Compute' : 'xpeibufgzjknrhbhpffp',
    process_kind: 'WORKSTREAM', process_id: 'C5_MEMORY', state: 'ACTIVE', authority,
    source_cursor: 'cursor:1', stale_after_ms: 30_000, payload_ref: 'ref:process',
  });
  const plan = h.scheduler.plan({
    supervisor_busy: true,
    workers: [{ worker_id: 'agent_research', role: 'RESEARCHER', ready: true }],
    opportunities: [{
      objective_key: 'memory-eval', task_kind: 'RESEARCH', work_branch: 'research/memory-eval-v1',
      process_refs: [process.process_key], effect_class: 'READ_ONLY', dependencies_satisfied: true,
      requires_supervisor_exclusive: false, urgency: 2, expected_information_gain: 4, unblock_count: 2, confidence: 1,
    }],
  });
  await h.scheduler.recordDecision(plan);
  return plan.proposals[0];
}

test('trusted native dispatcher can reserve independent work while supervisor is busy without starting it', async (t) => {
  const h = await harness();
  t.after(() => fs.rm(h.dir, { recursive: true, force: true }));
  const proposal = await prepare(h);
  const receipt = await h.dispatcher.dispatchProposal(proposal, { authority: 'TRUSTED_NATIVE_CONTROL_PLANE' });
  assert.equal(receipt.assignment.state, 'BOUND_UNVERIFIED');
  assert.equal(receipt.assignment.browser_authority, false);
  assert.equal(receipt.automatic_start_authority, false);
  assert.equal(receipt.mainline_promotion_authority, false);
  assert.equal(receipt.assignment.cycle_id, proposal.proposal_id);
  assert.equal(h.store.snapshot().assignments.length, 1);
});

test('dispatcher refuses non-native authority, non-durable proposals and stale process evidence', async (t) => {
  const h = await harness();
  t.after(() => fs.rm(h.dir, { recursive: true, force: true }));
  const proposal = await prepare(h);
  await assert.rejects(() => h.dispatcher.dispatchProposal(proposal, { authority: 'MODEL_TEXT' }), /authority_invalid/);
  await assert.rejects(() => h.dispatcher.dispatchProposal({ ...proposal, proposal_id: 'proposal_not_durable' }, { authority: 'TRUSTED_NATIVE_CONTROL_PLANE' }), /proposal_not_durable/);
  h.advance(31_000);
  await assert.rejects(() => h.dispatcher.dispatchProposal(proposal, { authority: 'TRUSTED_NATIVE_CONTROL_PLANE' }), /process_ref_stale/);
  assert.equal(h.store.snapshot().assignments.length, 0);
});

test('same durable proposal is idempotent and cannot create duplicate assignments', async (t) => {
  const h = await harness();
  t.after(() => fs.rm(h.dir, { recursive: true, force: true }));
  const proposal = await prepare(h, { source_system: 'GITHUB', authority: 'GITHUB' });
  const first = await h.dispatcher.dispatchProposal(proposal, { authority: 'TRUSTED_NATIVE_CONTROL_PLANE' });
  const second = await h.dispatcher.dispatchProposal(proposal, { authority: 'TRUSTED_NATIVE_CONTROL_PLANE' });
  assert.equal(first.assignment.assignment_key, second.assignment.assignment_key);
  assert.equal(second.duplicate, true);
  assert.equal(h.store.snapshot().assignments.length, 1);
});
