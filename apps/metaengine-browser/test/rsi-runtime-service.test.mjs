import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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


test('runtime ingests only terminal verified Browser receipts into the durable zero-authority ledger', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-runtime-outcome-'));
  try {
    const source = 'a'.repeat(40);
    const runtime = new RsiRuntimeService({ source_sha: source, ledgerPath: path.join(root, 'rsi.jsonl') });
    await runtime.start();
    const commandId = '11111111-1111-4111-8111-111111111111';
    const d = (char) => `sha256:${char.repeat(64)}`;
    const episode = await runtime.ingestBrowserOutcome({
      readback: {
        schema: 'metaengine.rsi.result-receipt-readback.v1',
        command_id: commandId,
        found: true,
        terminal: true,
        status: 'COMPLETED',
        receipt: {
          schema: 'metaengine.native-supervisor.command-receipt.v2',
          command_id: commandId,
          action: 'SCROLL',
          platform: 'CHATGPT',
          result: { moved: true, user_value: 'must-not-enter-ledger' },
          effect_outcome: 'CONFIRMED',
          lane: 'MUTATION',
          effect_key: 'effect-runtime-1',
          execution_ms: 11.2,
          recorded_at: '2026-09-18T16:40:00.000Z',
          authority_effect: false,
        },
        error: null,
        execution_authority: false,
        production_mutation_authority: false,
        promotion_authority: false,
        self_update_authority: false,
        automatic_retry_allowed: false,
        authority_effect: false,
      },
      attribution: {
        task_id: 'task.runtime.outcome.1',
        task_signature_digest: d('1'),
        environment_fingerprint: 'env.browser.chatgpt.v1',
        model_family: 'GPT_5_6_SOL',
        candidate_id: `candidate_sha256_${'b'.repeat(64)}`,
        candidate_sha: 'b'.repeat(40),
        proposal_digest: d('2'),
        skill_digests: [d('3')],
        external_attribution: true,
        authored_by_candidate: false,
      },
    });
    assert.equal(episode.outcome_state, 'VERIFIED_CONFIRMED_EFFECT');
    assert.equal(episode.eligible_for_experience_graph, true);
    const snapshot = runtime.snapshot();
    assert.equal(snapshot.browser_outcome_ingest.outcome_count, 1);
    assert.equal(snapshot.browser_outcome_ingest.learning_eligible_count, 1);
    assert.equal(snapshot.browser_outcome_ingest.quarantined_count, 0);
    assert.equal(snapshot.ledger.last_event_type, 'BROWSER_OUTCOME_INGESTED');
    const ledgerText = await fs.readFile(path.join(root, 'rsi.jsonl'), 'utf8');
    assert.doesNotMatch(ledgerText, /must-not-enter-ledger/);
    assert.doesNotMatch(ledgerText, /"result":/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
