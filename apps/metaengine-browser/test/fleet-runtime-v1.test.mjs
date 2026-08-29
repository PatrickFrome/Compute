import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FleetRuntimeStore } from '../src/fleet-runtime-store-v1.mjs';
import { FleetRuntime } from '../src/fleet-runtime-v1.mjs';

async function harness() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-c5-runtime-'));
  let now = Date.parse('2026-08-29T16:00:00Z');
  let seq = 0;
  const clock = () => now;
  const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const statePath = path.join(dir, 'state.json');
  const store = new FleetRuntimeStore({ statePath, clock });
  const runtime = new FleetRuntime({ store, clock, uuid });
  await runtime.init();
  return { dir, statePath, store, runtime, clock, uuid, advance: (ms) => { now += ms; } };
}

async function boundAssignment(h) {
  const binding = await h.runtime.bindWorkerIncarnation({
    agent_id: 'agent_12345678',
    role: 'IMPLEMENTER',
    lifecycle_state: 'BOUND_UNVERIFIED',
    tab_id: 'tab-1',
    target_id: 'webcontents:44',
    generation_epoch: 1,
    conversation_epoch: 0,
  });
  const assignment = await h.runtime.createAssignment({
    assignment_id: 'assignment-c5-1',
    attempt_id: 'attempt-1',
    worker_id: 'agent_12345678',
    cycle_id: 'cycle-c5-1',
    authority_refs: [
      { system: 'GITHUB', ref: 'integration/compute-unified-v1@fd70c3a' },
      { system: 'SUPABASE', ref: 'checkpoint:c5' },
    ],
  });
  return { binding, assignment };
}

test('durable assignment is BOUND_UNVERIFIED and workers have zero browser/peer authority', async (t) => {
  const h = await harness();
  t.after(() => fs.rm(h.dir, { recursive: true, force: true }));
  const { binding, assignment } = await boundAssignment(h);
  assert.equal(binding.browser_authority, false);
  assert.equal(binding.direct_peer_messaging, false);
  assert.equal(assignment.state, 'BOUND_UNVERIFIED');
  assert.equal(assignment.browser_authority, false);
  assert.equal(assignment.direct_peer_messaging, false);
  assert.equal(assignment.automatic_work_retry, false);

  const reloadedStore = new FleetRuntimeStore({ statePath: h.statePath, clock: h.clock });
  const reloadedRuntime = new FleetRuntime({ store: reloadedStore, clock: h.clock, uuid: h.uuid });
  await reloadedRuntime.init();
  assert.equal(reloadedRuntime.snapshot().assignments[0].assignment_key, 'assignment-c5-1::attempt-1');
});

test('page/model/worker evidence cannot satisfy readiness; trusted transport proof can', async (t) => {
  const h = await harness();
  t.after(() => fs.rm(h.dir, { recursive: true, force: true }));
  const { binding } = await boundAssignment(h);

  await assert.rejects(() => h.runtime.recordReadinessProof({
    assignment_id: 'assignment-c5-1',
    attempt_id: 'attempt-1',
    worker_incarnation_id: binding.worker_incarnation_id,
    authority: 'TRUSTED_NATIVE_CONTROL_PLANE',
    source_taint: 'PAGE',
    transport_kind: 'SUPERVISOR_MEDIATED_ROUNDTRIP',
    transport_session_id: 'transport-1',
    ready: true,
  }), /readiness_taint_invalid/);

  await assert.rejects(() => h.runtime.recordReadinessProof({
    assignment_id: 'assignment-c5-1',
    attempt_id: 'attempt-1',
    worker_incarnation_id: binding.worker_incarnation_id,
    authority: 'MODEL_TEXT',
    source_taint: 'TRUSTED_CONTROL_PLANE',
    transport_kind: 'SUPERVISOR_MEDIATED_ROUNDTRIP',
    transport_session_id: 'transport-1',
    ready: true,
  }), /readiness_authority_invalid/);

  await h.runtime.recordReadinessProof({
    assignment_id: 'assignment-c5-1',
    attempt_id: 'attempt-1',
    worker_incarnation_id: binding.worker_incarnation_id,
    proof_id: 'proof-1',
    authority: 'TRUSTED_NATIVE_CONTROL_PLANE',
    source_taint: 'TRUSTED_CONTROL_PLANE',
    transport_kind: 'SUPERVISOR_MEDIATED_ROUNDTRIP',
    transport_session_id: 'transport-1',
    ready: true,
  });
  assert.equal(h.runtime.snapshot().assignments[0].state, 'READY');
});

test('result receipt is exact-attempt/incarnation bound and ambiguous effect installs a durable retry barrier', async (t) => {
  const h = await harness();
  t.after(() => fs.rm(h.dir, { recursive: true, force: true }));
  const { binding } = await boundAssignment(h);
  await h.runtime.recordReadinessProof({
    assignment_id: 'assignment-c5-1',
    attempt_id: 'attempt-1',
    worker_incarnation_id: binding.worker_incarnation_id,
    proof_id: 'proof-1',
    authority: 'TRUSTED_NATIVE_CONTROL_PLANE',
    source_taint: 'TRUSTED_CONTROL_PLANE',
    transport_kind: 'LOCAL_NATIVE_TRANSPORT',
    transport_session_id: 'transport-1',
    ready: true,
  });
  await h.runtime.startAssignment({ assignment_id: 'assignment-c5-1', attempt_id: 'attempt-1' });

  await assert.rejects(() => h.runtime.recordResultReceipt({
    assignment_id: 'assignment-c5-1',
    attempt_id: 'attempt-1',
    worker_incarnation_id: 'stale-incarnation',
    result_status: 'SUCCEEDED',
    effect_outcome: 'CONFIRMED_EFFECT',
  }), /incarnation_mismatch/);

  await h.runtime.recordResultReceipt({
    assignment_id: 'assignment-c5-1',
    attempt_id: 'attempt-1',
    worker_incarnation_id: binding.worker_incarnation_id,
    receipt_id: 'receipt-ambiguous-1',
    result_status: 'FAILED',
    effect_outcome: 'AMBIGUOUS_EFFECT',
    evidence_refs: [{ kind: 'TRACE', ref: 'artifact:trace-1', sha256: 'a'.repeat(64) }],
  });
  const snap = h.runtime.snapshot();
  assert.equal(snap.assignments[0].state, 'AMBIGUOUS_EFFECT');
  assert.equal(snap.assignments[0].automatic_work_retry, false);
  assert.equal(snap.assignments[0].retry_barrier, 'AMBIGUOUS_EFFECT_REQUIRES_MANUAL_RECONCILIATION');
  assert.equal(snap.wake_events[0].reason, 'SUPERVISOR_RECOVERY_REQUIRED');
  assert.equal(snap.wake_events[0].status, 'PENDING');
  assert.equal(snap.result_receipts[0].evidence_refs[0].authority_effect, false);
});

test('lost worker produces one deduplicated typed wake event without retrying work', async (t) => {
  const h = await harness();
  t.after(() => fs.rm(h.dir, { recursive: true, force: true }));
  const { binding } = await boundAssignment(h);
  const first = await h.runtime.markWorkerLost({
    worker_id: 'agent_12345678',
    worker_incarnation_id: binding.worker_incarnation_id,
    reason: 'PHYSICAL_TAB_CLOSED',
  });
  const second = await h.runtime.markWorkerLost({
    worker_id: 'agent_12345678',
    worker_incarnation_id: binding.worker_incarnation_id,
    reason: 'PHYSICAL_TAB_CLOSED',
  });
  assert.equal(first.changed, 1);
  assert.equal(second.changed, 0);
  const snap = h.runtime.snapshot();
  assert.equal(snap.assignments[0].state, 'LOST');
  assert.equal(snap.assignments[0].automatic_work_retry, false);
  assert.equal(snap.wake_events.length, 1);
  assert.equal(snap.wake_events[0].reason, 'WORKER_LOST');
});
