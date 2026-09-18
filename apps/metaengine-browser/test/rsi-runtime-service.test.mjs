import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BROWSER_BRAIN_WORKING_MEMORY_SCHEMA } from '../src/browser-brain-working-memory.mjs';
import { RSI_HARD_INVARIANTS } from '../src/rsi-shadow-core.mjs';
import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';

test('unified RSI runtime binds the full converged trust-root set with zero authority', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-runtime-'));
  try {
    const runtime = new RsiRuntimeService({
      source_sha: 'a'.repeat(40),
      ledgerPath: path.join(root, 'rsi.jsonl'),
      clock: () => 1_800_000_000_000,
    });
    await runtime.start();
    const snapshot = runtime.snapshot();
    assert.equal(snapshot.state, 'READY');
    assert.equal(snapshot.mode, 'SHADOW_VERIFIED');
    assert.ok(snapshot.trust_root_count >= 30, `expected broad RSI convergence, got ${snapshot.trust_root_count}`);
    assert.equal(snapshot.shadow_only, true);
    assert.equal(snapshot.candidate_effect_executor_exposed, false);
    assert.equal(snapshot.physical_effect_replay_allowed, false);
    assert.equal(snapshot.direct_promotion_enabled, false);
    assert.equal(snapshot.direct_self_update_enabled, false);
    assert.equal(snapshot.scheduler_authority, false);
    assert.equal(snapshot.execution_authority, false);
    assert.equal(snapshot.promotion_authority, false);
    assert.equal(snapshot.self_update_authority, false);
    assert.equal(snapshot.authority_effect, false);
    assert.equal(snapshot.ledger.event_count, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('runtime can qualify a candidate but only emit an external promotion nomination', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-runtime-candidate-'));
  try {
    const source = 'a'.repeat(40);
    const runtime = new RsiRuntimeService({ source_sha: source, ledgerPath: path.join(root, 'rsi.jsonl') });
    await runtime.start();
    const candidate = await runtime.proposeCandidate({
      candidate_id: 'candidate.runtime.1',
      parent_sha: source,
      candidate_sha: 'b'.repeat(40),
      mutation_surface: 'BROWSER_RUNTIME',
      hypothesis: 'bounded candidate improves runtime behavior without authority expansion',
    });
    assert.equal(candidate.state, 'PROPOSED');
    await runtime.beginEvaluation(candidate.candidate_id);
    for (const invariant of RSI_HARD_INVARIANTS) {
      await runtime.recordInvariant(candidate.candidate_id, {
        invariant,
        result: 'PASS',
        evaluator_id: 'external.evaluator.1',
        evaluator_digest: 'c'.repeat(64),
        evidence_refs: [`evidence:${invariant.toLowerCase()}`],
      });
    }
    await runtime.recordObjective(candidate.candidate_id, {
      objective: { name: 'latency', direction: 'MINIMIZE', baseline: 10, candidate: 7 },
      evaluator_id: 'external.evaluator.1',
      evaluator_digest: 'd'.repeat(64),
      evidence_refs: ['evidence:latency'],
    });
    const qualified = await runtime.finalizeCandidate(candidate.candidate_id);
    assert.equal(qualified.state, 'SHADOW_QUALIFIED');

    const nomination = await runtime.nominatePromotion({
      candidate_id: candidate.candidate_id,
      qualification_digest: 'e'.repeat(64),
    });
    assert.equal(nomination.requires_external_promotion_gate, true);
    assert.equal(nomination.direct_promotion_enabled, false);
    assert.equal(nomination.self_update_authority, false);
    assert.equal(nomination.execution_authority, false);
    assert.equal(nomination.authority_effect, false);
    assert.equal(runtime.snapshot().promotion_nomination_count, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('runtime fences candidates to the exact installed source identity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-runtime-source-'));
  try {
    const runtime = new RsiRuntimeService({ source_sha: 'a'.repeat(40), ledgerPath: path.join(root, 'rsi.jsonl') });
    await runtime.start();
    await assert.rejects(() => runtime.proposeCandidate({
      candidate_id: 'candidate.runtime.2',
      parent_sha: 'f'.repeat(40),
      candidate_sha: 'b'.repeat(40),
      mutation_surface: 'RSI_IMPROVER',
      hypothesis: 'wrong parent must be rejected',
    }), /parent_not_bound_source/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('runtime sidecar coalesces repeated Brain state before fsync while preserving critical changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-runtime-observation-'));
  try {
    let now = 1_800_000_000_000;
    const runtime = new RsiRuntimeService({
      source_sha: 'a'.repeat(40),
      ledgerPath: path.join(root, 'rsi.jsonl'),
      clock: () => now,
    });
    await runtime.start();

    const brain = (overrides = {}) => ({
      schema: BROWSER_BRAIN_WORKING_MEMORY_SCHEMA,
      cells: [{ status: 'READY', last_command: { status: 'COMPLETED', effect_outcome: 'CONFIRMED' } }],
      global: { process_revision: 1, cognitive_sequence: 1, dropped_events: 0 },
      execution_authority: false,
      authority_effect: false,
      raw_dom_stored: false,
      page_text_stored: false,
      input_values_stored: false,
      ...overrides,
    });

    await runtime.observeBrainSnapshot(brain());
    assert.equal(runtime.snapshot().ledger.event_count, 2);
    assert.equal(runtime.snapshot().experience_gate.persisted_count, 1);

    now += 10;
    await runtime.observeBrainSnapshot(brain({ global: { process_revision: 1, cognitive_sequence: 2, dropped_events: 0 } }));
    assert.equal(runtime.snapshot().ledger.event_count, 2);
    assert.equal(runtime.snapshot().experience_gate.deduplicated_count, 1);

    now += 10;
    await runtime.observeBrainSnapshot(brain({
      cells: [{ status: 'READY', last_command: { status: 'AMBIGUOUS', effect_outcome: 'AMBIGUOUS' } }],
      global: { process_revision: 1, cognitive_sequence: 3, dropped_events: 0 },
    }));
    assert.equal(runtime.snapshot().ledger.event_count, 3);
    assert.equal(runtime.snapshot().experience_gate.persisted_count, 2);
    assert.equal(runtime.snapshot().experience_gate.authority_effect, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
