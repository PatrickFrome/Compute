import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA,
  RsiCommandPlaneLivenessObserver,
} from '../src/rsi-command-plane-liveness-observer.mjs';
import { buildRsiExperimentHypothesis } from '../src/supervisor-rsi-experiment-hypothesis.mjs';
import { buildRsiDevosExperimentPlan } from '../src/rsi-devos-experiment-plan.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from '../src/rsi-isolated-candidate-builder.mjs';
import {
  applyRsiHypothesisEvidenceGate,
  createRsiHypothesisEvidenceGatePlan,
  createRsiHypothesisEvidenceReceipt,
} from '../src/supervisor-rsi-hypothesis-evidence-gate.mjs';
import { RSI_L1_RESULT_DELIVERY_EVALUATION_SCHEMA } from './rsi-l1-result-delivery-evaluator.mjs';

export const RSI_L1_EVIDENCE_PRODUCER_CONTEXT_SCHEMA = 'metaengine.rsi.l1-evidence-producer-context.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const RAW_SHA256_RE = /^[0-9a-f]{64}$/;
const HELPER_PATH = 'apps/metaengine-browser/src/result-delivery-transport.mjs';
const INCIDENT_COMMAND_ID = 'd5d24937-c7e6-4ce1-bf93-134495b1d039';
const INCIDENT_OBSERVED_AT = '2026-09-17T10:41:40.000Z';
const INCIDENT_EFFECT_BOUND_AT = '2026-09-17T05:09:49.879Z';
const INCIDENT_LEASED_AT = '2026-09-17T05:09:48.211Z';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function stableJson(value) { return JSON.stringify(stable(value)); }
function sha256Hex(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function digest(value) { return `sha256:${sha256Hex(stableJson(value))}`; }
function exactSha(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_l1_bundle_${label}_sha_invalid`);
  return out;
}
function rawSha(value, label) {
  const out = String(value || '').toLowerCase();
  if (!RAW_SHA256_RE.test(out)) throw new Error(`rsi_l1_bundle_${label}_digest_invalid`);
  return out;
}
function positiveInt(value, label) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1) throw new Error(`rsi_l1_bundle_${label}_invalid`);
  return out;
}
function zeroAuthority(value, label) {
  for (const field of ['promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_l1_bundle_${label}_${field}_invalid`);
  }
  if (value?.automatic_effect_retry_allowed !== false) throw new Error(`rsi_l1_bundle_${label}_retry_invalid`);
}

function validateEvaluation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== RSI_L1_RESULT_DELIVERY_EVALUATION_SCHEMA) throw new Error('rsi_l1_bundle_evaluation_invalid');
  zeroAuthority(value, 'evaluation');
  if (value.candidate_execution_is_project_authority !== false || value.browser_actuation_available !== false || value.effect_executor_available !== false || value.production_credentials_available !== false) throw new Error('rsi_l1_bundle_evaluation_authority_surface_invalid');
  const repetitions = Number(value.repetitions);
  if (!Number.isSafeInteger(repetitions) || repetitions < 5 || repetitions > 25 || !Array.isArray(value.runs) || value.runs.length !== repetitions) throw new Error('rsi_l1_bundle_evaluation_repetitions_invalid');
  const summary = value.summary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) throw new Error('rsi_l1_bundle_evaluation_summary_invalid');
  for (const key of ['static_non_authority_surface','result_delivery_wall_clock_bounded','durable_receipt_reconciliation_required','absent_receipt_remains_ambiguous','healthy_control_negative_case','command_cycle_progress_recovers','immutable_receipt_redelivery']) {
    if (typeof summary[key] !== 'boolean') throw new Error(`rsi_l1_bundle_evaluation_summary_${key}_invalid`);
  }
  for (const key of ['duplicate_irreversible_effect_count','physical_effect_execution_count','ambiguous_followup_mutation_count']) {
    if (!Number.isSafeInteger(Number(summary[key])) || Number(summary[key]) < 0) throw new Error(`rsi_l1_bundle_evaluation_summary_${key}_invalid`);
  }
  return { evaluation: value, repetitions, summary };
}

function buildObservation(parentSha) {
  const observer = new RsiCommandPlaneLivenessObserver({
    source_sha: parentSha,
    clock: () => Date.parse(INCIDENT_OBSERVED_AT),
    heartbeat_fresh_ms: 15_000,
    perception_fresh_ms: 15_000,
    command_stall_ms: 120_000,
  });
  return observer.observe({
    schema: RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA,
    observed_at: INCIDENT_OBSERVED_AT,
    heartbeat_at: '2026-09-17T10:41:35.000Z',
    perception_at: '2026-09-17T10:41:36.000Z',
    command_progress_at: INCIDENT_EFFECT_BOUND_AT,
    pending_command_count: 5,
    active_command: {
      command_id: INCIDENT_COMMAND_ID,
      action: 'SCROLL',
      command_lane: 'TAB_MUTATION',
      status: 'LEASED',
      leased_at: INCIDENT_LEASED_AT,
      effect_bound_at: INCIDENT_EFFECT_BOUND_AT,
      receipt_recorded_at: null,
    },
    command_payload_exposed: false,
    page_text_exposed: false,
    input_values_exposed: false,
    raw_network_exposed: false,
    execution_authority: false,
    production_mutation_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function buildHandoff({ experimentId, parentSha, candidateSha, componentDigest, change }) {
  const candidateId = `candidate_sha256_${sha256Hex(`${candidateSha}:${componentDigest}:${change}`)}`;
  const core = {
    schema: RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA,
    version: 1,
    experiment_id: experimentId,
    mutation_surface: 'BROWSER_RUNTIME',
    parent_sha: parentSha,
    candidate_sha: candidateSha,
    candidate_capsule: {
      candidate_id: candidateId,
      source: { head: candidateSha },
      components: [{ path: HELPER_PATH, change, digest: `sha256:${componentDigest}` }],
    },
    candidate_verification: { ok: true, executable: false, promotion_authorized: false },
    sandbox_plan: { mode: 'PREPARE_ONLY' },
    sandbox_plan_verification: { execution_authorized: false },
    shadow_archive_proposal: { candidate_id: candidateId, parent_sha: parentSha, candidate_sha: candidateSha },
    eligible_for_evaluation: true,
    eligible_for_promotion: false,
    materialization_replay_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, handoff_digest: digest(core) });
}

function verdictForRequired(summary, evidenceClass) {
  switch (evidenceClass) {
    case 'FAULT_INJECTED_RESULT_TRANSPORT_TIMEOUT': return summary.result_delivery_wall_clock_bounded && summary.absent_receipt_remains_ambiguous;
    case 'ONE_ATTEMPT_EFFECT_PROOF': return summary.static_non_authority_surface && summary.duplicate_irreversible_effect_count === 0 && summary.physical_effect_execution_count <= 1;
    case 'DURABLE_RECEIPT_READBACK': return summary.durable_receipt_reconciliation_required;
    case 'COMMAND_PROGRESS_RECOVERY': return summary.command_cycle_progress_recovers;
    case 'HEALTHY_CONTROL_NEGATIVE_CASE': return summary.healthy_control_negative_case;
    default: throw new Error(`rsi_l1_bundle_unexpected_evidence_class:${evidenceClass}`);
  }
}
function verdictForGate(summary, gate) {
  switch (gate) {
    case 'duplicate_irreversible_effect_count==0': return summary.duplicate_irreversible_effect_count === 0;
    case 'physical_effect_execution_count<=1': return summary.physical_effect_execution_count <= 1;
    case 'result_delivery_wall_clock_bounded==true': return summary.result_delivery_wall_clock_bounded === true;
    case 'durable_receipt_reconciliation_required==true': return summary.durable_receipt_reconciliation_required === true;
    case 'ambiguous_followup_mutation_count==0': return summary.ambiguous_followup_mutation_count === 0;
    case 'command_cycle_progress_recovers==true': return summary.command_cycle_progress_recovers === true;
    default: throw new Error(`rsi_l1_bundle_unexpected_hard_gate:${gate}`);
  }
}

export function buildL1EvidenceBundle({ evaluation, parentSha, candidateSha, componentSha256, change = 'CREATE', runId, runAttempt = 1 } = {}) {
  const parent = exactSha(parentSha, 'parent');
  const candidate = exactSha(candidateSha, 'candidate');
  if (parent === candidate) throw new Error('rsi_l1_bundle_candidate_noop');
  const componentDigest = rawSha(componentSha256, 'component');
  const normalizedChange = String(change || '').toUpperCase();
  if (!['CREATE','MODIFY'].includes(normalizedChange)) throw new Error('rsi_l1_bundle_change_invalid');
  const producerRunId = positiveInt(runId, 'run_id');
  const producerRunAttempt = positiveInt(runAttempt, 'run_attempt');
  const { evaluation: measured, repetitions, summary } = validateEvaluation(evaluation);

  const observation = buildObservation(parent);
  const opportunity = observation.opportunities.find((entry) => entry.signal === 'RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING');
  if (!opportunity) throw new Error('rsi_l1_bundle_opportunity_missing');
  const hypothesis = buildRsiExperimentHypothesis({ observation, opportunity_id: opportunity.opportunity_id });
  const experiment = buildRsiDevosExperimentPlan({ observation, opportunity_id: opportunity.opportunity_id, hypothesis });
  const candidateHandoff = buildHandoff({ experimentId: experiment.experiment_id, parentSha: parent, candidateSha: candidate, componentDigest, change: normalizedChange });
  const plan = createRsiHypothesisEvidenceGatePlan({ observation, hypothesis, experiment_plan: experiment, candidate_handoff: candidateHandoff });
  const evidenceRefs = [
    `github:run:${producerRunId}`,
    `incident:command:${INCIDENT_COMMAND_ID}`,
    `candidate:sha:${candidate}`,
  ];
  const receipts = [
    ...plan.evidence_root.required_receipts.map((entry) => createRsiHypothesisEvidenceReceipt({
      plan,
      kind: 'REQUIRED_RECEIPT',
      evidence_class: entry.evidence_class,
      hypothesis_outcome: verdictForRequired(summary, entry.evidence_class) ? 'SUPPORTS' : 'FALSIFIES',
      evidence_refs: evidenceRefs,
      paired_repetitions: repetitions,
    })),
    ...plan.evidence_root.hard_gates.map((entry) => createRsiHypothesisEvidenceReceipt({
      plan,
      kind: 'HARD_GATE',
      hard_gate: entry.hard_gate,
      result: verdictForGate(summary, entry.hard_gate) ? 'PASS' : 'FAIL',
      evidence_refs: evidenceRefs,
      paired_repetitions: repetitions,
    })),
  ];
  const result = applyRsiHypothesisEvidenceGate({ plan, receipts });
  const context = Object.freeze({
    schema: RSI_L1_EVIDENCE_PRODUCER_CONTEXT_SCHEMA,
    producer_run_id: producerRunId,
    producer_run_attempt: producerRunAttempt,
    producer_role: 'TRUSTED_INDEPENDENT_EVALUATOR',
    candidate_surface: HELPER_PATH,
    parent_sha: parent,
    candidate_sha: candidate,
    component_sha256: componentDigest,
    change: normalizedChange,
    incident_binding: {
      classification: 'HISTORICAL_PRODUCTION_DERIVED_REPLAY_FIXTURE',
      historical_command_id: INCIDENT_COMMAND_ID,
      historical_leased_at: INCIDENT_LEASED_AT,
      historical_effect_bound_at: INCIDENT_EFFECT_BOUND_AT,
      historical_terminal_observed_at: '2026-09-17T10:41:41.875Z',
      replay_source_sha_semantics: 'CURRENT_EXACT_PARENT_FOR_REPLAY_NOT_HISTORICAL_INCIDENT_BUILD_IDENTITY',
    },
    evaluation_passed: measured.passed === true,
    gate_state: result.state,
    gate_disposition: result.disposition,
    candidate_authored_verdict: false,
    candidate_authored_receipts: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
  return Object.freeze({ observation, hypothesis, experiment, candidate_handoff: candidateHandoff, plan, receipts: Object.freeze(receipts), result, context });
}

async function writeStable(filePath, value) {
  await fs.writeFile(filePath, `${stableJson(value)}\n`, 'utf8');
}

async function main(argv) {
  const [evaluationPath, parentSha, candidateSha, componentSha256, change, runId, runAttempt, outputDir] = argv.slice(2);
  if (![evaluationPath,parentSha,candidateSha,componentSha256,change,runId,runAttempt,outputDir].every(Boolean)) throw new Error('usage: rsi-l1-evidence-bundle.mjs <evaluation> <parent> <candidate> <component-sha256> <change> <run-id> <run-attempt> <output-dir>');
  const evaluation = JSON.parse(await fs.readFile(evaluationPath, 'utf8'));
  const bundle = buildL1EvidenceBundle({ evaluation, parentSha, candidateSha, componentSha256, change, runId, runAttempt });
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeStable(path.join(outputDir, 'plan.json'), bundle.plan),
    writeStable(path.join(outputDir, 'receipts.json'), bundle.receipts),
    writeStable(path.join(outputDir, 'result.json'), bundle.result),
    writeStable(path.join(outputDir, 'candidate-handoff.json'), bundle.candidate_handoff),
    writeStable(path.join(outputDir, 'producer-context.json'), bundle.context),
    writeStable(path.join(outputDir, 'evaluation.json'), evaluation),
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).catch((error) => { console.error(String(error?.stack || error)); process.exitCode = 1; });
}
