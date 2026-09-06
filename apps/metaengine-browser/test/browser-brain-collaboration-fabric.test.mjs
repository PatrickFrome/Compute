import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainCollaborationFabric,
  BROWSER_BRAIN_AUTONOMY_DECISION_SCHEMA,
} from '../src/browser-brain-collaboration-fabric.mjs';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const BASE_SHA = '7'.repeat(40);

test('typed collaboration stays causal and idempotent without carrying execution authority', () => {
  const fabric = new BrowserBrainCollaborationFabric({ clock: () => Date.parse('2026-09-06T20:30:00.000Z') });
  fabric.recordTask({
    context_id: 'ctx.release-177',
    task_id: 'task.windows-soak',
    objective: 'repeat the physical Windows soak and preserve exact-head evidence',
    required_capabilities: ['windows', 'soak'],
  });
  const first = fabric.recordMessage({
    message_id: 'msg.result-001',
    context_id: 'ctx.release-177',
    task_id: 'task.windows-soak',
    source_agent_id: 'agent_windows_01',
    source_generation: 3,
    target: 'topic:task.windows-soak',
    kind: 'RESULT',
    body_digest: DIGEST_A,
    causal_epoch: 41,
  });
  const duplicate = fabric.recordMessage({
    message_id: 'msg.result-001',
    context_id: 'ctx.release-177',
    task_id: 'task.windows-soak',
    source_agent_id: 'agent_windows_01',
    source_generation: 3,
    target: 'topic:task.windows-soak',
    kind: 'RESULT',
    body_digest: DIGEST_A,
    causal_epoch: 41,
  });

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(first.delivery_grants_authority, false);
  assert.equal(fabric.snapshot().message_duplicate_count, 1);
  assert.throws(() => fabric.recordMessage({
    message_id: 'msg.result-001',
    context_id: 'ctx.release-177',
    task_id: 'task.windows-soak',
    source_agent_id: 'agent_windows_01',
    source_generation: 3,
    target: 'topic:task.windows-soak',
    kind: 'RESULT',
    body_digest: DIGEST_B,
    causal_epoch: 41,
  }), /message_id_collision/);
});

test('work claims reduce accidental duplication but never create a lease or a global work stop', () => {
  const fabric = new BrowserBrainCollaborationFabric({ clock: () => 1_000_000 });
  fabric.recordTask({
    context_id: 'ctx.memory',
    task_id: 'task.memory-index',
    objective: 'build hybrid episodic memory retrieval',
  });
  const primary = fabric.claimWork({
    claim_id: 'claim.primary-memory',
    context_id: 'ctx.memory',
    task_id: 'task.memory-index',
    agent_id: 'agent_alpha_01',
    scope: 'memory-index',
  });
  const conflict = fabric.claimWork({
    claim_id: 'claim.conflict-memory',
    context_id: 'ctx.memory',
    task_id: 'task.memory-index',
    agent_id: 'agent_beta_02',
    scope: 'memory-index',
  });
  const verifier = fabric.claimWork({
    claim_id: 'claim.verify-memory',
    context_id: 'ctx.memory',
    task_id: 'task.memory-index',
    agent_id: 'agent_beta_02',
    scope: 'memory-index',
    mode: 'INDEPENDENT_VERIFIER',
  });

  assert.equal(primary.claimed, true);
  assert.equal(primary.claim.lease_authority, false);
  assert.equal(conflict.claimed, false);
  assert.equal(conflict.work_blocked_globally, false);
  assert.equal(conflict.autonomous_alternative_required, true);
  assert.equal(verifier.claimed, true);
  assert.equal(verifier.claim.mode, 'INDEPENDENT_VERIFIER');
});

test('artifact records are immutable and handoff capsules avoid transcript transfer', () => {
  const fabric = new BrowserBrainCollaborationFabric({ clock: () => Date.parse('2026-09-06T20:31:00.000Z') });
  fabric.recordTask({
    context_id: 'ctx.collab',
    task_id: 'task.protocol',
    objective: 'implement typed collaboration protocol',
  });
  const artifact = fabric.recordArtifact({
    artifact_id: 'artifact.protocol-spec',
    context_id: 'ctx.collab',
    task_id: 'task.protocol',
    kind: 'spec',
    content_digest: DIGEST_A,
    base_sha: BASE_SHA,
    branch: 'work/browser-brain-collaboration-fabric-v1',
  });
  assert.equal(artifact.immutable, true);
  assert.equal(artifact.body_stored, false);
  assert.throws(() => fabric.recordArtifact({
    artifact_id: 'artifact.protocol-spec',
    context_id: 'ctx.collab',
    task_id: 'task.protocol',
    kind: 'spec',
    content_digest: DIGEST_B,
    base_sha: BASE_SHA,
  }), /artifact_immutable_conflict/);

  const handoff = fabric.recordHandoff({
    handoff_id: 'handoff.protocol-alpha-beta',
    context_id: 'ctx.collab',
    task_id: 'task.protocol',
    from_agent_id: 'agent_alpha_01',
    to_agent_id: 'agent_beta_02',
    objective: 'continue protocol implementation from exact branch state',
    completed: ['typed envelope schema created'],
    verified_facts: ['collaboration fabric owns no scheduler'],
    rejected_paths: ['all-to-all transcript broadcast'],
    next_actions: ['wire coordinator facade'],
    artifact_refs: ['artifact.protocol-spec'],
    base_sha: BASE_SHA,
    branch: 'work/browser-brain-collaboration-fabric-v1',
    confidence: 0.9,
  });
  assert.equal(handoff.full_transcript_stored, false);
  assert.equal(handoff.external_confirmation_required, false);
  assert.equal(handoff.execution_authority, false);
});

test('autonomy decisions never wait for a user or an external prompt', () => {
  const fabric = new BrowserBrainCollaborationFabric({ clock: () => 2_000_000 });
  const empty = fabric.decideAutonomousContinuation({
    context_id: 'ctx.autonomy-empty',
    agent_id: 'agent_alpha_01',
  });
  assert.equal(empty.schema, BROWSER_BRAIN_AUTONOMY_DECISION_SCHEMA);
  assert.equal(empty.action, 'DISCOVER_USEFUL_WORK');
  assert.equal(empty.continue_autonomously, true);
  assert.equal(empty.external_prompt_required, false);
  assert.equal(empty.user_confirmation_required, false);
  assert.equal(empty.idle_wait_allowed, false);
  assert.equal(empty.work_cycle_limit, null);

  fabric.recordTask({
    context_id: 'ctx.autonomy',
    task_id: 'task.ready-work',
    objective: 'continue useful branch-local development',
  });
  const ready = fabric.decideAutonomousContinuation({
    context_id: 'ctx.autonomy',
    agent_id: 'agent_alpha_01',
  });
  assert.equal(ready.action, 'CLAIM_READY_TASK');

  fabric.advanceTask({
    task_id: 'task.ready-work',
    progress_revision: 2,
    status: 'BLOCKED',
    blocker: 'dependency unavailable',
  });
  const replan = fabric.decideAutonomousContinuation({
    context_id: 'ctx.autonomy',
    agent_id: 'agent_alpha_01',
  });
  assert.equal(replan.action, 'REPLAN_AROUND_BLOCKERS');
  assert.equal(replan.user_confirmation_required, false);

  const snapshot = fabric.snapshot();
  assert.equal(snapshot.continuous_autonomous_work, true);
  assert.equal(snapshot.external_confirmation_gate, false);
  assert.equal(snapshot.external_prompt_required_for_continuation, false);
  assert.equal(snapshot.idle_wait_allowed, false);
  assert.equal(snapshot.work_cycle_limit, null);
  assert.equal(snapshot.second_scheduler, false);
  assert.equal(snapshot.hidden_queue, false);
});

test('progress ledger separates coordination state from execution authority', () => {
  const fabric = new BrowserBrainCollaborationFabric({ clock: () => 3_000_000 });
  fabric.recordTask({
    context_id: 'ctx.ledger',
    task_id: 'task.one',
    objective: 'first independent slice',
  });
  fabric.recordTask({
    context_id: 'ctx.ledger',
    task_id: 'task.two',
    objective: 'second dependent slice',
    dependencies: ['task.one'],
  });
  fabric.advanceTask({
    task_id: 'task.one',
    progress_revision: 2,
    status: 'COMPLETED',
  });
  const decision = fabric.decideAutonomousContinuation({
    context_id: 'ctx.ledger',
    agent_id: 'agent_alpha_01',
  });
  assert.equal(decision.task_id, 'task.two');
  const progress = fabric.progressLedger('ctx.ledger');
  assert.equal(progress.completed, 1);
  assert.equal(progress.ready, 1);
  assert.equal(progress.external_confirmation_required, false);
  assert.equal(progress.authority_effect, false);
});
