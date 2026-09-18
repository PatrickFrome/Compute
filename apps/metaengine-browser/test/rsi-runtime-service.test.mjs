import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BROWSER_BRAIN_WORKING_MEMORY_SCHEMA } from '../src/browser-brain-working-memory.mjs';
import { RSI_HARD_INVARIANTS } from '../src/rsi-shadow-core.mjs';
import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';
import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiEvaluationIntegrityPolicy,
  createRsiEvaluationIntegrityReceipt,
  assessRsiEvaluationIntegrity,
} from '../src/rsi-evaluation-integrity-guard.mjs';

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


test('runtime adopts verified skills, reconciles credited pending evidence, and exposes only governed activation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-runtime-skill-loop-'));
  try {
    const source = 'a'.repeat(40);
    const d = (char) => `sha256:${char.repeat(64)}`;
    const skill = createRsiSkillCapsule({
      skill_id: 'skill.runtime.integrated',
      version: 1,
      parent_skill_digest: null,
      source_candidate_sha: 'b'.repeat(40),
      role: 'ANALYZER',
      input_schema_digest: d('1'),
      output_schema_digest: d('2'),
      implementation_digest: d('3'),
      components: [{ component_id: 'skill.runtime.integrated.component', artifact_digest: d('4'), kind: 'TYPED_TRANSFORM' }],
      capabilities: ['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
      max_context_tokens: 2048,
      max_output_tokens: 512,
      max_invocations: 2,
      external_builder: true,
      authored_by_candidate: false,
    });
    const skillEvidence = createRsiSkillEvidence({
      capsule: skill,
      hidden_holdout_digest: d('5'),
      evaluator_root_digest: d('6'),
      unit_test_digest: d('7'),
      runtime_feedback_digest: d('8'),
      attempt_count: 12,
      success_count: 10,
      hard_invariants_pass: true,
      verified_for_library: true,
      evidence_refs: ['VERIFY_skill.runtime.integrated'],
      external_evaluator: true,
      authored_by_candidate: false,
    });
    const verifiedLibrary = createRsiVerifiedSkillLibrary({
      library_id: 'runtime.skill.library.integrated',
      entries: [{ capsule: skill, evidence: skillEvidence }],
      external_library_owner: true,
      authored_by_candidate: false,
    });

    const runtime = new RsiRuntimeService({ source_sha: source, ledgerPath: path.join(root, 'rsi.jsonl') });
    await runtime.start();
    const candidate = await runtime.proposeCandidate({
      candidate_id: 'candidate.runtime.skill.1',
      parent_sha: source,
      candidate_sha: 'c'.repeat(40),
      mutation_surface: 'BROWSER_RUNTIME',
      hypothesis: 'verified skill should earn contextual lifecycle evidence only after receipt-bound credit',
    });
    await runtime.beginEvaluation(candidate.candidate_id);

    const commandId = '66666666-6666-4666-8666-666666666666';
    await runtime.bindBrowserCommandAttribution({
      command_id: commandId,
      action: 'SCROLL',
      platform: 'CHATGPT',
      effect_key: 'effect-runtime-skill-1',
      task_id: 'task.runtime.skill.1',
      task_signature_digest: d('9'),
      environment_fingerprint: 'env.browser.chatgpt.v1',
      model_family: 'GPT_5_6_SOL',
      candidate_id: candidate.candidate_id,
      proposal_digest: d('a'),
      skill_digests: [skill.skill_digest],
      trajectory_id: 'trajectory.runtime.skill.1',
      step_index: 1,
      step_count: 1,
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
          effect_key: 'effect-runtime-skill-1',
          execution_ms: 7.2,
          recorded_at: '2026-09-18T18:10:00.000Z',
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
    const credited = await runtime.recordBrowserStepCredit({
      episode,
      task_anchor: {
        task_id: 'task.runtime.skill.1',
        task_signature_digest: d('9'),
        challenge_family: 'BROWSER_INTERACTION',
        hidden_manifest_digest: d('b'),
        external_writer: true,
        authored_by_candidate: false,
      },
      credit_id: 'credit.runtime.skill.1',
      credit_sign: 'POSITIVE',
      credit_score: 0.7,
      method: 'EXTERNAL_STEP_EVALUATOR',
      evaluator_digest: d('c'),
      evaluation_digest: d('d'),
      lesson_digests: [d('e')],
      evidence_refs: ['evidence:runtime:skill:1'],
      skill_generation: 1,
      skill_authoring_prior: 'VERIFIED_DIRECT_SKILL',
      skill_authoring_provenance_digest: d('f'),
      external_credit_assigner: true,
      authored_by_candidate: false,
    });
    assert.equal(credited.skill_lifecycle.state, 'HELD_NO_LIBRARY');
    assert.equal(runtime.snapshot().runtime_skill_lifecycle.pending_count, 1);

    const adopted = await runtime.adoptVerifiedSkillLibrary({
      library: verifiedLibrary,
      external_library_owner: true,
      authored_by_candidate: false,
    });
    assert.equal(adopted.reconciled_pending, 1);
    assert.equal(runtime.snapshot().runtime_skill_lifecycle.pending_count, 0);
    assert.equal(runtime.snapshot().runtime_skill_lifecycle.lifecycle_evidence_count, 1);
    assert.equal(runtime.snapshot().runtime_skill_router.evidence_count, 1);

    const route = await runtime.routeVerifiedSkills({
      context_id: 'context.runtime.skill.1',
      task_signature_digest: d('9'),
      environment_fingerprint: 'env.browser.chatgpt.v1',
      model_family: 'GPT_5_6_SOL',
      challenge_family: 'BROWSER_INTERACTION',
      required_role: 'ANALYZER',
      required_capabilities: ['ANALYZE_FAILURE_CODES'],
      input_schema_digest: d('1'),
      output_schema_digest: d('2'),
      max_selected: 1,
      exploration_slots: 0,
      external_planner: true,
      authored_by_candidate: false,
    });
    assert.equal(route.selected_count, 1);
    assert.equal(route.selected[0].skill_digest, skill.skill_digest);
    assert.equal(route.selected[0].reason, 'CONTEXT_EVIDENCE');
    assert.equal(route.routing_is_execution_authority, false);
    assert.equal(runtime.snapshot().runtime_skill_router.route_count, 1);

    const activation = runtime.createSkillActivationView([skill.skill_digest]);
    assert.equal(activation.selected_count, 1);
    assert.equal(activation.selected[0].skill_digest, skill.skill_digest);
    assert.equal(activation.activation_view_is_execution_authority, false);

    const curation = await runtime.requestSkillCuration({
      request_id: 'curation.runtime.skill.1',
      parent_skill_digest: skill.skill_digest,
      reason: 'RELIABILITY_GAP',
      trigger_evidence_digests: [episode.episode_digest, credited.credit_receipt.receipt_digest],
      training_context_digest: d('1'),
      validation_holdout_digest: d('2'),
      meta_holdout_digest: d('3'),
      optimizer_model_family: 'GPT_5_6_SOL',
      allowed_edit_ops: ['ADD','DELETE','REPLACE'],
      edit_budget: 3,
      external_curator: true,
      authored_by_candidate: false,
    });
    assert.equal(curation.queued.state, 'QUEUED');
    assert.equal(curation.request.direct_library_replacement_allowed, false);

    const successorSkill = createRsiSkillCapsule({
      skill_id: skill.skill_id,
      version: 2,
      parent_skill_digest: skill.skill_digest,
      source_candidate_sha: 'd'.repeat(40),
      role: skill.role,
      input_schema_digest: skill.input_schema_digest,
      output_schema_digest: skill.output_schema_digest,
      implementation_digest: d('9'),
      components: [{ component_id: 'skill.runtime.integrated.component.v2', artifact_digest: d('a'), kind: 'TYPED_TRANSFORM' }],
      capabilities: skill.capabilities,
      max_context_tokens: skill.max_context_tokens,
      max_output_tokens: skill.max_output_tokens,
      max_invocations: skill.max_invocations,
      external_builder: true,
      authored_by_candidate: false,
    });
    const revision = await runtime.evaluateSkillRevision({
      request_id: curation.request.request_id,
      successor_skill: successorSkill,
      baseline_validation_score: 0.60,
      candidate_validation_score: 0.72,
      baseline_meta_score: 0.55,
      candidate_meta_score: 0.56,
      hard_invariants_pass: true,
      evaluator_digest: d('b'),
      evaluation_digest: d('c'),
      evidence_refs: ['evidence:runtime:curation:1'],
      external_evaluator: true,
      authored_by_candidate: false,
    });
    assert.equal(revision.evaluation.state, 'ELIGIBLE_FOR_EXISTING_RELIABILITY_GATE');
    assert.equal(revision.evaluation.accepted_for_existing_reliability_gate, true);
    assert.equal(revision.evaluation.direct_library_replacement_allowed, false);
    assert.equal(revision.frontier.state, 'ARCHIVED');
    assert.equal(revision.frontier.pareto_frontier, true);
    assert.equal(runtime.snapshot().runtime_skill_curation.accepted_count, 1);
    assert.equal(runtime.snapshot().skill_revision_frontier.archive_count, 1);
    assert.equal(runtime.snapshot().skill_revision_frontier.frontier_count, 1);
    const revisionFrontier = runtime.skillRevisionFrontier({ parent_skill_digest: skill.skill_digest });
    assert.equal(revisionFrontier.length, 1);
    assert.equal(revisionFrontier[0].successor_skill_digest, successorSkill.skill_digest);
    assert.equal(revisionFrontier[0].frontier_is_execution_authority, false);

    const integrityPolicy = createRsiEvaluationIntegrityPolicy({
      policy_id: 'integrity.runtime.skill.1',
      visible_suite_digest: d('5'),
      compositional_holdout_digest: d('4'),
      evaluator_root_digest: d('6'),
      workspace_baseline_digest: d('7'),
      max_visible_holdout_gap: 0.15,
      min_holdout_pass_rate: 0.8,
      external_policy_owner: true,
      authored_by_candidate: false,
    });
    const integrityReceipt = createRsiEvaluationIntegrityReceipt({
      policy: integrityPolicy,
      receipt_id: 'integrity.runtime.skill.receipt.1',
      candidate_id: `candidate_sha256_${successorSkill.skill_digest.slice('sha256:'.length)}`,
      candidate_sha: successorSkill.source_candidate_sha,
      visible_pass_rate: 0.92,
      holdout_pass_rate: 0.90,
      evaluator_root_digest: d('6'),
      workspace_before_digest: d('7'),
      workspace_after_digest: d('8'),
      patch_audit_digest: d('9'),
      file_access_audit_digest: d('a'),
      network_audit_digest: d('b'),
      external_integrity_monitor: true,
      authored_by_candidate: false,
      evidence_refs: ['integrity:runtime:skill:1'],
    });
    const integrityAssessment = assessRsiEvaluationIntegrity({ policy: integrityPolicy, receipt: integrityReceipt });
    assert.equal(integrityAssessment.state, 'INTEGRITY_VERIFIED');
    const integrity = await runtime.recordSkillRevisionIntegrity({
      request_id: curation.request.request_id,
      admission_id: 'admission.runtime.skill.1',
      integrity_policy: integrityPolicy,
      integrity_receipt: integrityReceipt,
      integrity_assessment: integrityAssessment,
      external_admission_owner: true,
      authored_by_candidate: false,
    });
    assert.equal(integrity.admission.state, 'INTEGRITY_ADMITTED');
    assert.equal(integrity.admission.eligible_for_existing_reliability_gate, true);
    assert.equal(runtime.snapshot().skill_revision_integrity.admitted_count, 1);
    assert.equal(runtime.integrityAdmittedSkillRevisions({ parent_skill_digest: skill.skill_digest }).length, 1);
    assert.equal(runtime.snapshot().runtime_skill_lifecycle.library_entry_count, 1);
    assert.equal(runtime.snapshot().execution_authority, false);
    assert.equal(runtime.snapshot().authority_effect, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
