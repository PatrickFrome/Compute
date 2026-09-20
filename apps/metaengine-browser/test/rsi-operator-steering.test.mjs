import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';
import { RsiOperatorSteering, rsiOperatorSteeringTrustRootSnapshot } from '../src/rsi-operator-steering.mjs';

const SOURCE = 'a'.repeat(40);

async function fresh(root, name) {
  const runtime = new RsiRuntimeService({ source_sha: SOURCE, ledgerPath: path.join(root, `${name}.jsonl`) });
  await runtime.start();
  const steering = new RsiOperatorSteering({
    source_sha: SOURCE,
    statePath: path.join(root, `${name}.jsonl.operator-steering.json`),
  }).attach(runtime);
  await steering.init();
  return { runtime, steering };
}

test('pause/resume gates learning-side scopes and never claims execution authority', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-steering-'));
  try {
    const { steering } = await fresh(root, 'steer-a');
    assert.equal(steering.allows('CREDIT_ASSIGNMENT'), true);
    const paused = await steering.pause({ scope: 'CREDIT_ASSIGNMENT', reason: 'operator review' });
    assert.equal(paused.paused, true);
    assert.equal(paused.authority_effect, false);
    assert.equal(steering.allows('CREDIT_ASSIGNMENT'), false);
    assert.equal(steering.allows('SKILL_ROUTING'), true);
    assert.deepEqual(steering.snapshot().paused_scopes, ['CREDIT_ASSIGNMENT']);
    await steering.recordGateSkip('CREDIT_ASSIGNMENT');
    assert.equal(steering.snapshot().counters.credit_skipped_paused, 1);
    const resumed = await steering.resume({ scope: 'CREDIT_ASSIGNMENT' });
    assert.equal(resumed.resumed, true);
    assert.equal(steering.allows('CREDIT_ASSIGNMENT'), true);
    assert.equal(steering.snapshot().pause_gates_execution, false);
    // invalid scope refused
    await assert.rejects(() => steering.pause({ scope: 'EXECUTION' }), /rsi_steering_scope_invalid/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('nominate proposes a real candidate with operator external-planner origin', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-steering-nominate-'));
  try {
    const { runtime, steering } = await fresh(root, 'steer-b');
    const nominated = await steering.nominate({
      candidate_id: 'candidate.operator.steer.1',
      hypothesis: 'operator-nominated prompt routing experiment',
      mutation_surface: 'PROMPT_ROUTING',
    });
    assert.equal(nominated.nominated, true);
    assert.equal(nominated.requires_external_promotion_gate, true);
    assert.equal(runtime.snapshot().candidate_count, 1);
    const candidates = runtime.snapshot().candidate_state_counts;
    assert.equal(candidates.PROPOSED, 1);
    const snap = steering.snapshot();
    assert.equal(snap.counters.nominate_count, 1);
    assert.equal(snap.recent_decisions[0].kind, 'CANDIDATE_NOMINATION');
    assert.equal(snap.recent_decisions[0].external_confirmation_gate, true);
    assert.equal(snap.recent_decisions[0].approval_is_execution_authority, false);
    // duplicate nomination of the same id is refused by the archive
    await assert.rejects(() => steering.nominate({ candidate_id: 'candidate.operator.steer.1' }), /rsi_candidate_already_exists/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('approve records an external confirmation decision that is never execution authority', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-steering-approve-'));
  try {
    const { steering } = await fresh(root, 'steer-c');
    const d = 'sha256:' + 'a'.repeat(64);
    const approved = await steering.approve({ kind: 'PROMOTION_NOMINATION', digest: d, note: 'operator ack' });
    assert.equal(approved.approved, true);
    assert.equal(approved.approval_is_execution_authority, false);
    assert.equal(approved.authority_effect, false);
    const snap = steering.snapshot();
    assert.equal(snap.counters.approve_count, 1);
    assert.equal(snap.recent_decisions[0].decision, 'APPROVE');
    assert.equal(snap.approval_is_execution_authority, false);
    await assert.rejects(() => steering.approve({ kind: 'UNKNOWN_KIND', digest: d }), /rsi_steering_decision_kind_invalid/);
    await assert.rejects(() => steering.approve({ kind: 'PROMOTION_NOMINATION', digest: 'not-a-digest' }), /rsi_steering_decision_digest_invalid/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('steering state is durable across restarts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-steering-durable-'));
  try {
    const statePath = path.join(root, 'steer.jsonl.operator-steering.json');
    const runtimeA = new RsiRuntimeService({ source_sha: SOURCE, ledgerPath: path.join(root, 'rsi.jsonl') });
    await runtimeA.start();
    const a = new RsiOperatorSteering({ source_sha: SOURCE, statePath }).attach(runtimeA);
    await a.init();
    await a.pause({ scope: 'SKILL_ROUTING', reason: 'hold' });
    await a.approve({ kind: 'SKILL_REVISION', digest: 'sha256:' + 'b'.repeat(64) });

    const runtimeB = new RsiRuntimeService({ source_sha: SOURCE, ledgerPath: path.join(root, 'rsi.jsonl') });
    await runtimeB.start();
    const b = new RsiOperatorSteering({ source_sha: SOURCE, statePath }).attach(runtimeB);
    await b.init();
    assert.equal(b.allows('SKILL_ROUTING'), false);
    assert.equal(b.allows('CREDIT_ASSIGNMENT'), true);
    assert.equal(b.snapshot().counters.approve_count, 1);
    // tamper detection
    const raw = JSON.parse(await fs.readFile(statePath, 'utf8'));
    raw.counters.approve_count = 99;
    await fs.writeFile(statePath, `${JSON.stringify(raw)}\n`);
    const c = new RsiOperatorSteering({ source_sha: SOURCE, statePath }).attach(runtimeB);
    await assert.rejects(() => c.init(), /rsi_steering_state_digest_mismatch/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('steering trust root pins the zero-authority operator contract', () => {
  const root = rsiOperatorSteeringTrustRootSnapshot();
  assert.equal(root.schema, 'metaengine.rsi.operator-steering-root.v1');
  assert.equal(root.pause_gates_execution, false);
  assert.equal(root.pause_gates_learning_side_effects_only, true);
  assert.equal(root.approval_is_execution_authority, false);
  assert.equal(root.operator_nomination_is_external_planner, true);
  assert.match(root.steering_root_digest, /^sha256:[0-9a-f]{64}$/);
});
