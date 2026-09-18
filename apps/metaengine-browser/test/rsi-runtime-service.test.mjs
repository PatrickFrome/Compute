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


test('trusted command attribution converts an evaluated runtime candidate into receipt-bound learning credit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-runtime-attribution-'));
  try {
    const source = 'a'.repeat(40);
    const runtime = new RsiRuntimeService({ source_sha: source, ledgerPath: path.join(root, 'rsi.jsonl') });
    await runtime.start();
    const candidate = await runtime.proposeCandidate({
      candidate_id: 'candidate.runtime.credit.1',
      parent_sha: source,
      candidate_sha: 'b'.repeat(40),
      mutation_surface: 'BROWSER_RUNTIME',
      hypothesis: 'candidate behavior is credited only after exact stored receipt',
    });
    await runtime.beginEvaluation(candidate.candidate_id);

    const commandId = '22222222-2222-4222-8222-222222222222';
    const d = (char) => `sha256:${char.repeat(64)}`;
    const binding = await runtime.bindBrowserCommandAttribution({
      command_id: commandId,
      action: 'SCROLL',
      platform: 'CHATGPT',
      effect_key: 'effect-credit-1',
      task_id: 'task.runtime.credit.1',
      task_signature_digest: d('1'),
      environment_fingerprint: 'env.browser.chatgpt.v1',
      model_family: 'GPT_5_6_SOL',
      candidate_id: candidate.candidate_id,
      proposal_digest: d('2'),
      skill_digests: [d('3')],
      external_planner: true,
      authored_by_candidate: false,
    });
    assert.equal(binding.runtime_candidate_id, candidate.candidate_id);
    assert.equal(binding.candidate_id, `candidate_sha256_${candidate.candidate_digest}`);
    assert.equal(runtime.snapshot().command_attribution.pending_count, 1);

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
          result: { moved: true },
          effect_outcome: 'CONFIRMED',
          lane: 'MUTATION',
          effect_key: 'effect-credit-1',
          execution_ms: 9.5,
          recorded_at: '2026-09-18T17:10:00.000Z',
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
    });
    assert.equal(episode.candidate_id, binding.candidate_id);
    assert.equal(episode.proposal_digest, d('2'));
    assert.deepEqual(episode.skill_digests, [d('3')]);
    assert.equal(episode.eligible_for_experience_graph, true);
    assert.equal(episode.eligible_for_skill_evidence, true);
    assert.equal(runtime.snapshot().command_attribution.pending_count, 0);
    assert.equal(runtime.snapshot().command_attribution.consumed_count, 1);
    assert.equal(runtime.snapshot().ledger.last_event_type, 'COMMAND_ATTRIBUTION_CONSUMED');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('runtime closes verified Browser outcome -> external step credit -> durable experience graph loop', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-runtime-learning-loop-'));
  try {
    const source = 'a'.repeat(40);
    const runtime = new RsiRuntimeService({ source_sha: source, ledgerPath: path.join(root, 'rsi.jsonl') });
    await runtime.start();
    const candidate = await runtime.proposeCandidate({
      candidate_id: 'candidate.runtime.learning.1',
      parent_sha: source,
      candidate_sha: 'd'.repeat(40),
      mutation_surface: 'BROWSER_RUNTIME',
      hypothesis: 'receipt-bound action improves task progression',
    });
    await runtime.beginEvaluation(candidate.candidate_id);
    const commandId = '55555555-5555-4555-8555-555555555555';
    const d = (char) => `sha256:${char.repeat(64)}`;
    await runtime.bindBrowserCommandAttribution({
      command_id: commandId,
      action: 'SCROLL',
      platform: 'CHATGPT',
      effect_key: 'effect-learning-1',
      task_id: 'task.runtime.learning.1',
      task_signature_digest: d('1'),
      environment_fingerprint: 'env.browser.chatgpt.v1',
      model_family: 'GPT_5_6_SOL',
      candidate_id: candidate.candidate_id,
      proposal_digest: d('2'),
      skill_digests: [d('3')],
      trajectory_id: 'trajectory.runtime.learning.1',
      step_index: 1,
      step_count: 1,
      predecessor_episode_digest: null,
      external_planner: true,
      authored_by_candidate: false,
    });
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
          result: { moved: true },
          effect_outcome: 'CONFIRMED',
          lane: 'MUTATION',
          effect_key: 'effect-learning-1',
          execution_ms: 8.5,
          recorded_at: '2026-09-18T17:40:00.000Z',
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
    });
    assert.equal(episode.eligible_for_credit_assignment, true);
    const credited = await runtime.recordBrowserStepCredit({
      episode,
      task_anchor: {
        task_id: 'task.runtime.learning.1',
        task_signature_digest: d('1'),
        challenge_family: 'BROWSER_INTERACTION',
        hidden_manifest_digest: d('4'),
        external_writer: true,
        authored_by_candidate: false,
      },
      credit_id: 'credit.runtime.learning.1',
      credit_sign: 'POSITIVE',
      credit_score: 0.8,
      method: 'EXTERNAL_STEP_EVALUATOR',
      evaluator_digest: d('5'),
      evaluation_digest: d('6'),
      lesson_digests: [d('7')],
      evidence_refs: ['evidence:runtime:learning:1'],
      external_credit_assigner: true,
      authored_by_candidate: false,
    });
    assert.equal(credited.materialization.case_row.outcome, 'SUCCESS');
    assert.equal(credited.stored.state, 'APPENDED');
    const snapshot = runtime.snapshot();
    assert.equal(snapshot.runtime_experience_store.case_count, 1);
    assert.equal(snapshot.runtime_experience_store.graph_epoch, 1);
    assert.equal(snapshot.command_attribution.consumed_count, 1);
    assert.equal(snapshot.execution_authority, false);
    assert.equal(snapshot.authority_effect, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
