import crypto from 'node:crypto';

import { buildRsiExperimentHypothesis } from './supervisor-rsi-experiment-hypothesis.mjs';
import { buildRsiDevosExperimentPlan } from './rsi-devos-experiment-plan.mjs';
import { createRsiEvaluatorMeshPlan } from './rsi-evaluator-mesh.mjs';

export const RSI_HYPOTHESIS_EVIDENCE_GATE_PLAN_SCHEMA = 'metaengine.rsi.hypothesis-evidence-gate-plan.v1';
export const RSI_HYPOTHESIS_EVIDENCE_RECEIPT_SCHEMA = 'metaengine.rsi.hypothesis-evidence-receipt.v1';
export const RSI_HYPOTHESIS_EVIDENCE_RESULT_SCHEMA = 'metaengine.rsi.hypothesis-evidence-result.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const RAW_SHA256_RE = /^[0-9a-f]{64}$/;
const EVIDENCE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,511}$/;
const MAX_EVIDENCE_REFS = 32;
const RECEIPT_KINDS = new Set(['REQUIRED_RECEIPT', 'HARD_GATE']);
const HYPOTHESIS_OUTCOMES = new Set(['SUPPORTS', 'FALSIFIES', 'INCONCLUSIVE']);
const HARD_GATE_RESULTS = new Set(['PASS', 'FAIL']);

const REQUIRED_RECEIPT_PRODUCERS = Object.freeze({
  FAULT_INJECTED_RESULT_TRANSPORT_TIMEOUT: Object.freeze({ producer_id: 'rsi.evidence.result-transport-timeout.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  ONE_ATTEMPT_EFFECT_PROOF: Object.freeze({ producer_id: 'rsi.evidence.one-attempt-effect.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  DURABLE_RECEIPT_READBACK: Object.freeze({ producer_id: 'rsi.evidence.durable-receipt-readback.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  COMMAND_PROGRESS_RECOVERY: Object.freeze({ producer_id: 'rsi.evidence.command-progress-recovery.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  HEALTHY_CONTROL_NEGATIVE_CASE: Object.freeze({ producer_id: 'rsi.evidence.healthy-control-negative.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  COMMAND_PROGRESS_SEQUENCE_READBACK: Object.freeze({ producer_id: 'rsi.evidence.command-progress-sequence.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  HEARTBEAT_FRESH_COMMAND_STALE_FAULT: Object.freeze({ producer_id: 'rsi.evidence.heartbeat-fresh-command-stale.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  STALL_CLASSIFICATION_RECEIPT: Object.freeze({ producer_id: 'rsi.evidence.stall-classification.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  AMBIGUITY_FENCE_PROOF: Object.freeze({ producer_id: 'rsi.evidence.ambiguity-fence.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  INDEPENDENT_READBACK_PROOF: Object.freeze({ producer_id: 'rsi.evidence.independent-readback.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  CELL_IDENTITY_PROOF: Object.freeze({ producer_id: 'rsi.evidence.cell-identity.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  RECOVERY_PRESSURE_COMPARISON: Object.freeze({ producer_id: 'rsi.evidence.recovery-pressure-comparison.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  CELL_REINCARNATION_PROOF: Object.freeze({ producer_id: 'rsi.evidence.cell-reincarnation.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  STALE_BINDING_REJECTION_PROOF: Object.freeze({ producer_id: 'rsi.evidence.stale-binding-rejection.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  BOUNDED_MEMORY_PROOF: Object.freeze({ producer_id: 'rsi.evidence.bounded-memory.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  RETRIEVAL_QUALITY_COMPARISON: Object.freeze({ producer_id: 'rsi.evidence.retrieval-quality-comparison.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  SCHEMA_DRIFT_REJECTION_PROOF: Object.freeze({ producer_id: 'rsi.evidence.schema-drift-rejection.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
  NORMALIZATION_COMPATIBILITY_PROOF: Object.freeze({ producer_id: 'rsi.evidence.normalization-compatibility.v1', runner: 'trusted/rsi-hypothesis-evidence' }),
});

const HARD_GATE_PRODUCER = Object.freeze({ producer_id: 'rsi.hypothesis-hard-gate.v1', runner: 'trusted/rsi-hypothesis-hard-gate' });

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function jsonStable(value) { return JSON.stringify(stable(value)); }
function digest(value) { return `sha256:${crypto.createHash('sha256').update(jsonStable(value), 'utf8').digest('hex')}`; }
function exactSha(value, label) {
  const normalized = String(value || '').toLowerCase();
  if (!SHA40_RE.test(normalized)) throw new Error(`rsi_hypothesis_evidence_${label}_exact_sha_required`);
  return normalized;
}
function exactDigest(value, label) {
  const normalized = String(value || '').toLowerCase();
  if (!SHA256_RE.test(normalized)) throw new Error(`rsi_hypothesis_evidence_${label}_digest_invalid`);
  return normalized;
}
function zeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_hypothesis_evidence_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_hypothesis_evidence_${label}_automatic_retry_invalid`);
}
function normalizeEvidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error('rsi_hypothesis_evidence_refs_invalid');
  const seen = new Set();
  return value.map((entry) => {
    const ref = String(entry || '').trim();
    if (!EVIDENCE_REF_RE.test(ref) || seen.has(ref)) throw new Error('rsi_hypothesis_evidence_ref_invalid');
    seen.add(ref);
    return ref;
  }).sort();
}
function assertCandidateDoesNotMutateSupervisorRoot(candidateHandoff) {
  const components = Array.isArray(candidateHandoff?.candidate_capsule?.components) ? candidateHandoff.candidate_capsule.components : [];
  for (const component of components) {
    if (String(component?.path || '').startsWith('apps/metaengine-browser/src/supervisor-')) {
      throw new Error('rsi_hypothesis_evidence_candidate_mutates_supervisor_root');
    }
  }
}
function verifyHandoffDigest(candidateHandoff) {
  if (!plainObject(candidateHandoff)) throw new Error('rsi_hypothesis_evidence_handoff_invalid');
  const supplied = exactDigest(candidateHandoff.handoff_digest, 'handoff');
  const material = structuredClone(candidateHandoff);
  delete material.handoff_digest;
  if (digest(material) !== supplied) throw new Error('rsi_hypothesis_evidence_handoff_digest_mismatch');
  return supplied;
}
function requiredReceiptSpec(evidenceClass) {
  const evidence = String(evidenceClass || '').toUpperCase();
  const producer = REQUIRED_RECEIPT_PRODUCERS[evidence];
  if (!producer) throw new Error('rsi_hypothesis_evidence_class_unregistered');
  const material = { kind: 'REQUIRED_RECEIPT', evidence_class: evidence, producer_id: producer.producer_id, runner: producer.runner };
  return Object.freeze({ ...material, producer_digest: digest(material) });
}
function hardGateSpec(hardGate) {
  const gate = String(hardGate || '').trim();
  if (!gate || gate.length > 512) throw new Error('rsi_hypothesis_evidence_hard_gate_invalid');
  const material = { kind: 'HARD_GATE', hard_gate: gate, producer_id: HARD_GATE_PRODUCER.producer_id, runner: HARD_GATE_PRODUCER.runner };
  return Object.freeze({ ...material, producer_digest: digest(material) });
}
function evidenceRoot(hypothesis) {
  const acceptance = hypothesis.acceptance_contract;
  return Object.freeze({
    version: 1,
    required_receipts: acceptance.required_receipts.map(requiredReceiptSpec),
    hard_gates: acceptance.hard_gates.map(hardGateSpec),
    candidate_selectable: false,
    candidate_mutable: false,
    candidate_can_register_producer: false,
    candidate_can_skip_required_evidence: false,
    candidate_can_override_verdict: false,
  });
}
function canonicalInputs({ observation, hypothesis, experiment_plan, candidate_handoff }) {
  if (!plainObject(hypothesis)) throw new Error('rsi_hypothesis_evidence_hypothesis_invalid');
  const canonicalHypothesis = buildRsiExperimentHypothesis({ observation, opportunity_id: hypothesis.opportunity_id });
  if (jsonStable(canonicalHypothesis) !== jsonStable(hypothesis)) throw new Error('rsi_hypothesis_evidence_hypothesis_mismatch');
  const canonicalExperiment = buildRsiDevosExperimentPlan({ observation, opportunity_id: hypothesis.opportunity_id, hypothesis: canonicalHypothesis });
  if (jsonStable(canonicalExperiment) !== jsonStable(experiment_plan)) throw new Error('rsi_hypothesis_evidence_experiment_mismatch');
  zeroAuthority(candidate_handoff, 'handoff');
  const handoffDigest = verifyHandoffDigest(candidate_handoff);
  assertCandidateDoesNotMutateSupervisorRoot(candidate_handoff);
  const evaluatorPlan = createRsiEvaluatorMeshPlan({ candidate_handoff });
  if (String(candidate_handoff.experiment_id || '') !== canonicalExperiment.experiment_id) throw new Error('rsi_hypothesis_evidence_handoff_experiment_mismatch');
  if (evaluatorPlan.candidate.parent_sha !== canonicalExperiment.source_sha) throw new Error('rsi_hypothesis_evidence_handoff_parent_mismatch');
  if (evaluatorPlan.candidate.handoff_digest !== handoffDigest) throw new Error('rsi_hypothesis_evidence_handoff_digest_binding_mismatch');
  return Object.freeze({
    hypothesis: canonicalHypothesis,
    experiment: canonicalExperiment,
    candidate: evaluatorPlan.candidate,
    evaluator_plan_id: evaluatorPlan.plan_id,
    evaluator_plan_digest: evaluatorPlan.plan_digest,
  });
}
function planCore(inputs) {
  const acceptance = inputs.hypothesis.acceptance_contract;
  return {
    schema: RSI_HYPOTHESIS_EVIDENCE_GATE_PLAN_SCHEMA,
    version: 1,
    hypothesis: {
      hypothesis_id: inputs.hypothesis.hypothesis_id,
      hypothesis_digest: inputs.hypothesis.hypothesis_digest,
      source_sha: inputs.hypothesis.source_sha,
      observation_digest: inputs.hypothesis.observation_digest,
      opportunity_id: inputs.hypothesis.opportunity_id,
      signal: inputs.hypothesis.signal,
      mutation_surface: inputs.hypothesis.mutation_surface,
      claim_digest: digest(inputs.hypothesis.claim),
      acceptance_contract_digest: digest(acceptance),
    },
    experiment: { experiment_id: inputs.experiment.experiment_id, plan_digest: inputs.experiment.plan_digest, target_branch: inputs.experiment.target_branch },
    candidate: { candidate_id: inputs.candidate.candidate_id, candidate_sha: inputs.candidate.candidate_sha, parent_sha: inputs.candidate.parent_sha, handoff_digest: inputs.candidate.handoff_digest },
    evaluator_mesh_binding: { plan_id: inputs.evaluator_plan_id, plan_digest: inputs.evaluator_plan_digest },
    evidence_root: evidenceRoot(inputs.hypothesis),
    protocol: {
      paired_parent_candidate_required: true,
      holdout_required: true,
      minimum_paired_repetitions: acceptance.minimum_paired_repetitions,
      no_optional_stopping: true,
      scalar_reward_authoritative: false,
      candidate_authored_receipts_allowed: false,
      all_precommitted_evidence_required_before_terminal_verdict: true,
    },
    objectives: acceptance.objectives.map((entry) => ({ ...entry })),
    shadow_only: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}
export function createRsiHypothesisEvidenceGatePlan({ observation, hypothesis, experiment_plan, candidate_handoff } = {}) {
  const inputs = canonicalInputs({ observation, hypothesis, experiment_plan, candidate_handoff });
  const core = planCore(inputs);
  const planDigest = digest(core);
  return Object.freeze({ ...core, plan_id: `rsi_hyp_evidence_${planDigest.slice('sha256:'.length)}`, plan_digest: planDigest });
}
function assertProducerRoot(plan) {
  const required = plan.evidence_root?.required_receipts;
  const gates = plan.evidence_root?.hard_gates;
  if (!Array.isArray(required) || required.length < 1 || !Array.isArray(gates) || gates.length < 1) throw new Error('rsi_hypothesis_evidence_root_invalid');
  const seenRequired = new Set();
  for (const entry of required) {
    const canonical = requiredReceiptSpec(entry.evidence_class);
    if (jsonStable(entry) !== jsonStable(canonical) || seenRequired.has(entry.evidence_class)) throw new Error('rsi_hypothesis_evidence_required_root_tampered');
    seenRequired.add(entry.evidence_class);
  }
  const seenGates = new Set();
  for (const entry of gates) {
    const canonical = hardGateSpec(entry.hard_gate);
    if (jsonStable(entry) !== jsonStable(canonical) || seenGates.has(entry.hard_gate)) throw new Error('rsi_hypothesis_evidence_hard_gate_root_tampered');
    seenGates.add(entry.hard_gate);
  }
  for (const flag of ['candidate_selectable', 'candidate_mutable', 'candidate_can_register_producer', 'candidate_can_skip_required_evidence', 'candidate_can_override_verdict']) {
    if (plan.evidence_root?.[flag] !== false) throw new Error('rsi_hypothesis_evidence_root_policy_invalid');
  }
}
export function verifyRsiHypothesisEvidenceGatePlan(plan) {
  if (!plainObject(plan) || plan.schema !== RSI_HYPOTHESIS_EVIDENCE_GATE_PLAN_SCHEMA || plan.version !== 1) throw new Error('rsi_hypothesis_evidence_plan_invalid');
  zeroAuthority(plan, 'plan');
  if (plan.shadow_only !== true) throw new Error('rsi_hypothesis_evidence_plan_shadow_only_invalid');
  const material = structuredClone(plan);
  delete material.plan_id;
  delete material.plan_digest;
  const expected = digest(material);
  if (plan.plan_digest !== expected || plan.plan_id !== `rsi_hyp_evidence_${expected.slice('sha256:'.length)}`) throw new Error('rsi_hypothesis_evidence_plan_digest_mismatch');
  if (!/^rsi_hyp_[0-9a-f]{24}$/.test(String(plan.hypothesis?.hypothesis_id || '')) || !SHA256_RE.test(String(plan.hypothesis?.hypothesis_digest || ''))) throw new Error('rsi_hypothesis_evidence_plan_hypothesis_identity_invalid');
  if (!RAW_SHA256_RE.test(String(plan.hypothesis?.observation_digest || ''))) throw new Error('rsi_hypothesis_evidence_plan_observation_identity_invalid');
  exactSha(plan.hypothesis?.source_sha, 'plan_source');
  exactSha(plan.candidate?.parent_sha, 'plan_parent');
  exactSha(plan.candidate?.candidate_sha, 'plan_candidate');
  exactDigest(plan.candidate?.handoff_digest, 'plan_handoff');
  if (plan.candidate.parent_sha !== plan.hypothesis.source_sha) throw new Error('rsi_hypothesis_evidence_plan_lineage_mismatch');
  if (!/^candidate_sha256_[0-9a-f]{64}$/.test(String(plan.candidate?.candidate_id || ''))) throw new Error('rsi_hypothesis_evidence_plan_candidate_identity_invalid');
  if (!/^rsi_exp_[0-9a-f]{24}$/.test(String(plan.experiment?.experiment_id || '')) || !RAW_SHA256_RE.test(String(plan.experiment?.plan_digest || ''))) throw new Error('rsi_hypothesis_evidence_plan_experiment_identity_invalid');
  if (!SHA256_RE.test(String(plan.evaluator_mesh_binding?.plan_digest || '')) || !/^rsi_eval_[0-9a-f]{64}$/.test(String(plan.evaluator_mesh_binding?.plan_id || ''))) throw new Error('rsi_hypothesis_evidence_plan_evaluator_binding_invalid');
  const protocol = plan.protocol;
  if (protocol?.paired_parent_candidate_required !== true || protocol?.holdout_required !== true || !Number.isSafeInteger(protocol?.minimum_paired_repetitions) || protocol.minimum_paired_repetitions < 1 || protocol?.no_optional_stopping !== true || protocol?.scalar_reward_authoritative !== false || protocol?.candidate_authored_receipts_allowed !== false || protocol?.all_precommitted_evidence_required_before_terminal_verdict !== true) throw new Error('rsi_hypothesis_evidence_plan_protocol_invalid');
  assertProducerRoot(plan);
  return Object.freeze({ schema: 'metaengine.rsi.hypothesis-evidence-gate-plan-verify.v1', ok: true, plan_id: plan.plan_id, plan_digest: plan.plan_digest, execution_authorized: false, promotion_authorized: false, authority_effect: false });
}
function evidenceSpec(plan, kind, key) {
  const normalizedKind = String(kind || '').toUpperCase();
  if (!RECEIPT_KINDS.has(normalizedKind)) throw new Error('rsi_hypothesis_evidence_receipt_kind_invalid');
  if (normalizedKind === 'REQUIRED_RECEIPT') {
    const evidenceClass = String(key || '').toUpperCase();
    const spec = plan.evidence_root.required_receipts.find((entry) => entry.evidence_class === evidenceClass);
    if (!spec) throw new Error('rsi_hypothesis_evidence_receipt_not_required');
    return spec;
  }
  const hardGate = String(key || '').trim();
  const spec = plan.evidence_root.hard_gates.find((entry) => entry.hard_gate === hardGate);
  if (!spec) throw new Error('rsi_hypothesis_evidence_hard_gate_not_required');
  return spec;
}
function protocolReceipt(plan, pairedRepetitions) {
  const repetitions = Number(pairedRepetitions);
  if (!Number.isSafeInteger(repetitions) || repetitions < plan.protocol.minimum_paired_repetitions) throw new Error('rsi_hypothesis_evidence_paired_repetitions_insufficient');
  return Object.freeze({ paired_parent_candidate: true, paired_repetitions: repetitions, holdout_used: true, optional_stopping_used: false, scalar_reward_authoritative: false });
}
export function createRsiHypothesisEvidenceReceipt({ plan, kind, evidence_class = null, hard_gate = null, hypothesis_outcome = null, result = null, evidence_refs = [], paired_repetitions = null } = {}) {
  verifyRsiHypothesisEvidenceGatePlan(plan);
  const normalizedKind = String(kind || '').toUpperCase();
  const key = normalizedKind === 'REQUIRED_RECEIPT' ? evidence_class : hard_gate;
  const spec = evidenceSpec(plan, normalizedKind, key);
  const evaluationProtocol = protocolReceipt(plan, paired_repetitions == null ? plan.protocol.minimum_paired_repetitions : paired_repetitions);
  const body = normalizedKind === 'REQUIRED_RECEIPT'
    ? (() => { const outcome = String(hypothesis_outcome || '').toUpperCase(); if (!HYPOTHESIS_OUTCOMES.has(outcome)) throw new Error('rsi_hypothesis_evidence_outcome_invalid'); return { evidence_class: spec.evidence_class, hypothesis_outcome: outcome }; })()
    : (() => { const normalizedResult = String(result || '').toUpperCase(); if (!HARD_GATE_RESULTS.has(normalizedResult)) throw new Error('rsi_hypothesis_evidence_hard_gate_result_invalid'); return { hard_gate: spec.hard_gate, result: normalizedResult }; })();
  const core = {
    schema: RSI_HYPOTHESIS_EVIDENCE_RECEIPT_SCHEMA, version: 1,
    plan_id: plan.plan_id, plan_digest: plan.plan_digest,
    hypothesis_id: plan.hypothesis.hypothesis_id, hypothesis_digest: plan.hypothesis.hypothesis_digest,
    experiment_id: plan.experiment.experiment_id, source_sha: plan.hypothesis.source_sha,
    candidate_id: plan.candidate.candidate_id, candidate_sha: plan.candidate.candidate_sha, handoff_digest: plan.candidate.handoff_digest,
    kind: normalizedKind, producer_id: spec.producer_id, producer_digest: spec.producer_digest, runner: spec.runner,
    evaluation_protocol: evaluationProtocol, evidence_refs: normalizeEvidenceRefs(evidence_refs), external_evaluator: true, authored_by_candidate: false,
    ...body,
    execution_authority: false, production_mutation_authority: false, promotion_authority: false, self_update_authority: false, automatic_retry_allowed: false, authority_effect: false,
  };
  return Object.freeze({ ...core, receipt_digest: digest(core) });
}
export function verifyRsiHypothesisEvidenceReceipt({ plan, receipt } = {}) {
  verifyRsiHypothesisEvidenceGatePlan(plan);
  if (!plainObject(receipt) || receipt.schema !== RSI_HYPOTHESIS_EVIDENCE_RECEIPT_SCHEMA || receipt.version !== 1) throw new Error('rsi_hypothesis_evidence_receipt_invalid');
  zeroAuthority(receipt, 'receipt');
  if (receipt.plan_id !== plan.plan_id || receipt.plan_digest !== plan.plan_digest) throw new Error('rsi_hypothesis_evidence_receipt_plan_mismatch');
  if (receipt.hypothesis_id !== plan.hypothesis.hypothesis_id || receipt.hypothesis_digest !== plan.hypothesis.hypothesis_digest || receipt.experiment_id !== plan.experiment.experiment_id || exactSha(receipt.source_sha, 'receipt_source') !== plan.hypothesis.source_sha) throw new Error('rsi_hypothesis_evidence_receipt_hypothesis_mismatch');
  if (String(receipt.candidate_id || '').toLowerCase() !== plan.candidate.candidate_id || exactSha(receipt.candidate_sha, 'receipt_candidate') !== plan.candidate.candidate_sha || exactDigest(receipt.handoff_digest, 'receipt_handoff') !== plan.candidate.handoff_digest) throw new Error('rsi_hypothesis_evidence_receipt_candidate_mismatch');
  if (receipt.external_evaluator !== true || receipt.authored_by_candidate !== false) throw new Error('rsi_hypothesis_evidence_receipt_origin_invalid');
  const kind = String(receipt.kind || '').toUpperCase();
  const key = kind === 'REQUIRED_RECEIPT' ? receipt.evidence_class : receipt.hard_gate;
  const spec = evidenceSpec(plan, kind, key);
  if (receipt.producer_id !== spec.producer_id || receipt.producer_digest !== spec.producer_digest || receipt.runner !== spec.runner) throw new Error('rsi_hypothesis_evidence_receipt_producer_mismatch');
  const protocol = receipt.evaluation_protocol;
  if (protocol?.paired_parent_candidate !== true || !Number.isSafeInteger(protocol?.paired_repetitions) || protocol.paired_repetitions < plan.protocol.minimum_paired_repetitions || protocol?.holdout_used !== true || protocol?.optional_stopping_used !== false || protocol?.scalar_reward_authoritative !== false) throw new Error('rsi_hypothesis_evidence_receipt_protocol_invalid');
  const refs = normalizeEvidenceRefs(receipt.evidence_refs);
  if (kind === 'REQUIRED_RECEIPT') {
    if (!HYPOTHESIS_OUTCOMES.has(String(receipt.hypothesis_outcome || '').toUpperCase())) throw new Error('rsi_hypothesis_evidence_outcome_invalid');
  } else if (!HARD_GATE_RESULTS.has(String(receipt.result || '').toUpperCase())) throw new Error('rsi_hypothesis_evidence_hard_gate_result_invalid');
  const material = structuredClone(receipt);
  delete material.receipt_digest;
  material.evidence_refs = refs;
  if (digest(material) !== receipt.receipt_digest) throw new Error('rsi_hypothesis_evidence_receipt_digest_mismatch');
  return Object.freeze(structuredClone(receipt));
}
function resultCore(plan, receipts) {
  const requiredByKey = new Map();
  const gateByKey = new Map();
  for (const receipt of receipts) {
    const verified = verifyRsiHypothesisEvidenceReceipt({ plan, receipt });
    if (verified.kind === 'REQUIRED_RECEIPT') {
      if (requiredByKey.has(verified.evidence_class)) throw new Error('rsi_hypothesis_evidence_receipt_duplicate');
      requiredByKey.set(verified.evidence_class, verified);
    } else {
      if (gateByKey.has(verified.hard_gate)) throw new Error('rsi_hypothesis_evidence_receipt_duplicate');
      gateByKey.set(verified.hard_gate, verified);
    }
  }
  const missingRequired = plan.evidence_root.required_receipts.map((entry) => entry.evidence_class).filter((key) => !requiredByKey.has(key));
  const missingGates = plan.evidence_root.hard_gates.map((entry) => entry.hard_gate).filter((key) => !gateByKey.has(key));
  const complete = missingRequired.length === 0 && missingGates.length === 0;
  const failedGates = [...gateByKey.values()].filter((receipt) => receipt.result === 'FAIL').map((receipt) => receipt.hard_gate).sort();
  const falsifying = [...requiredByKey.values()].filter((receipt) => receipt.hypothesis_outcome === 'FALSIFIES').map((receipt) => receipt.evidence_class).sort();
  const inconclusive = [...requiredByKey.values()].filter((receipt) => receipt.hypothesis_outcome === 'INCONCLUSIVE').map((receipt) => receipt.evidence_class).sort();
  let state = 'BLOCKED';
  let disposition = 'INCOMPLETE_EVIDENCE';
  if (complete) {
    if (failedGates.length > 0) { state = 'REJECTED'; disposition = 'HARD_GATE_FAILED'; }
    else if (falsifying.length > 0) { state = 'FALSIFIED'; disposition = 'HYPOTHESIS_FALSIFIED'; }
    else if (inconclusive.length > 0) { state = 'BLOCKED'; disposition = 'INCONCLUSIVE_EVIDENCE'; }
    else { state = 'ADMITTED'; disposition = 'HYPOTHESIS_SUPPORTED'; }
  }
  const normalizedReceipts = [...requiredByKey.values(), ...gateByKey.values()].sort((a, b) => {
    const aKey = a.kind === 'REQUIRED_RECEIPT' ? `0:${a.evidence_class}` : `1:${a.hard_gate}`;
    const bKey = b.kind === 'REQUIRED_RECEIPT' ? `0:${b.evidence_class}` : `1:${b.hard_gate}`;
    return aKey.localeCompare(bKey);
  });
  return {
    schema: RSI_HYPOTHESIS_EVIDENCE_RESULT_SCHEMA, version: 1,
    plan_id: plan.plan_id, plan_digest: plan.plan_digest,
    hypothesis_id: plan.hypothesis.hypothesis_id, hypothesis_digest: plan.hypothesis.hypothesis_digest,
    experiment_id: plan.experiment.experiment_id, candidate_id: plan.candidate.candidate_id, candidate_sha: plan.candidate.candidate_sha, handoff_digest: plan.candidate.handoff_digest,
    complete, state, disposition,
    missing_required_receipts: missingRequired.sort(), missing_hard_gates: missingGates.sort(), failed_hard_gates: failedGates,
    falsifying_evidence_classes: falsifying, inconclusive_evidence_classes: inconclusive,
    receipt_digests: normalizedReceipts.map((receipt) => receipt.receipt_digest),
    eligible_for_evaluator_mesh: state === 'ADMITTED', evolution_archive_eligible: ['ADMITTED', 'FALSIFIED', 'REJECTED'].includes(state), replay_authorized: false,
    execution_authority: false, production_mutation_authority: false, promotion_authority: false, self_update_authority: false, automatic_retry_allowed: false, authority_effect: false,
  };
}
export function applyRsiHypothesisEvidenceGate({ plan, receipts = [] } = {}) {
  verifyRsiHypothesisEvidenceGatePlan(plan);
  if (!Array.isArray(receipts)) throw new Error('rsi_hypothesis_evidence_receipts_invalid');
  const expectedCount = plan.evidence_root.required_receipts.length + plan.evidence_root.hard_gates.length;
  if (receipts.length > expectedCount) throw new Error('rsi_hypothesis_evidence_receipts_excess');
  const core = resultCore(plan, receipts);
  return Object.freeze({ ...core, result_digest: digest(core) });
}
