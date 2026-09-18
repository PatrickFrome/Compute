import crypto from 'node:crypto';

import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from './rsi-isolated-candidate-builder.mjs';
import {
  RSI_SHADOW_TOURNAMENT_RESULT_SCHEMA,
  verifyRsiShadowTournamentPlan,
  verifyRsiShadowTournamentResult,
} from './rsi-shadow-tournament.mjs';
import { RSI_VERIFIED_EVOLUTION_ARCHIVE_ADMISSION_SCHEMA } from './rsi-verified-evolution-archive.mjs';

export const RSI_EXTERNAL_PROMOTION_QUALIFICATION_SCHEMA = 'metaengine.rsi.external-promotion-qualification.v1';
export const RSI_PROMOTION_ADMISSION_GATE_RESULT_SCHEMA = 'metaengine.rsi.promotion-admission-gate-result.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_TEXT_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+\-= ]{1,511}$/;
const SLSA_PROVENANCE_V1 = 'https://slsa.dev/provenance/v1';
const MAX_EVIDENCE_REFS = 64;

const REQUIRED_WORKFLOWS = Object.freeze([
  'METAENGINE Browser Shell V1',
  'METAENGINE Browser Critical Audit V1',
  'Browser Windows Installed Chat Qualification',
  'METAENGINE Browser Final Runtime Activation V1',
  'METAENGINE Browser Windows Autonomous Soak V1',
  'Browser Windows Package Smoke',
  'METAENGINE Browser Self Update E2E',
]);

const PROMOTION_TRUST_ROOT_PATHS = new Set([
  'apps/metaengine-browser/src/rsi-promotion-admission-gate.mjs',
  'apps/metaengine-browser/src/rsi-episode-orchestrator.mjs',
  'apps/metaengine-browser/src/rsi-episode-devos-bridge.mjs',
  'apps/metaengine-browser/src/rsi-episode-evaluation-ingest.mjs',
  'apps/metaengine-browser/src/rsi-autonomous-episode-controller.mjs',
  'apps/metaengine-browser/src/rsi-verified-search-feedback.mjs',
  'apps/metaengine-browser/src/rsi-browser-outcome-ingest.mjs',
  'apps/metaengine-browser/src/rsi-browser-command-attribution-registry.mjs',
  'apps/metaengine-browser/src/rsi-trusted-credit-assignment.mjs',
  'apps/metaengine-browser/src/rsi-experience-context-planner.mjs',
  'apps/metaengine-browser/src/rsi-context-aware-candidate-synthesis.mjs',
  'apps/metaengine-browser/src/rsi-devos-materialization-handoff.mjs',
  'apps/metaengine-browser/src/rsi-verified-candidate-materialization.mjs',
  'apps/metaengine-browser/src/rsi-episode-promotion-review.mjs',
  'apps/metaengine-browser/src/rsi-external-release-handoff-intent.mjs',
  'apps/metaengine-browser/src/rsi-published-release-reconciliation.mjs',
  'apps/metaengine-browser/src/rsi-release-promotion-journal.mjs',
  'apps/metaengine-browser/src/rsi-release-promotion-outcome-ingest.mjs',
  'apps/metaengine-browser/src/rsi-self-update-controller-admission.mjs',
  'apps/metaengine-browser/src/rsi-self-update-download-readiness.mjs',
  'apps/metaengine-browser/src/rsi-self-update-restart-gate-probe-admission.mjs',
  'apps/metaengine-browser/src/rsi-self-update-restart-gate-probe-outcome.mjs',
  'apps/metaengine-browser/src/rsi-self-update-final-install-cycle-admission.mjs',
  'apps/metaengine-browser/src/rsi-self-update-final-apply-readback.mjs',
  'apps/metaengine-browser/src/rsi-self-update-successor-verification.mjs',
  'apps/metaengine-browser/src/rsi-post-adoption-causal-measurement.mjs',
  'apps/metaengine-browser/src/rsi-post-adoption-experience-admission.mjs',
  'apps/metaengine-browser/src/rsi-experience-context-utility-feedback.mjs',
  'apps/metaengine-browser/src/self-update-handoff.mjs',
  'apps/metaengine-browser/src/self-update-runtime-v8.mjs',
  'apps/metaengine-browser/src/self-update-transaction-journal.mjs',
  'apps/metaengine-browser/src/self-update-ambiguous-successor-recovery.mjs',
  'apps/metaengine-browser/src/self-update-successor-qualification.mjs',
  'apps/metaengine-browser/src/self-update-successor-recovery.mjs',
  'apps/metaengine-browser/src/host-resilience-runtime.mjs',
  'apps/metaengine-browser/src/browser-fabric-effect-ledger.mjs',
  'apps/metaengine-browser/src/browser-fabric-effect-domain-policy.mjs',
  'apps/metaengine-browser/src/browser-fabric-capability.mjs',
  'controller/rsi/promotion_attestation.py',
  '.github/workflows/rsi-promotion-attestation-contract.yml',
  'apps/metaengine-browser/src/rsi-devos-admission-adapter.mjs',
  'supabase/migrations/20260918171500_rsi_devos_prepared_request_admission_v1.sql',
  'apps/metaengine-browser/src/rsi-devos-experiment-plan.mjs',
  'apps/metaengine-browser/src/rsi-runtime-service.mjs',
  'apps/metaengine-browser/src/rsi-runtime-ledger.mjs',
  'apps/metaengine-browser/src/rsi-verified-evolution-archive.mjs',
  'apps/metaengine-browser/src/rsi-shadow-tournament.mjs',
  'apps/metaengine-browser/src/rsi-evaluator-mesh.mjs',
  'apps/metaengine-browser/src/rsi-isolated-candidate-builder.mjs',
  'apps/metaengine-browser/src/rsi-open-ended-search-policy.mjs',
  'apps/metaengine-browser/src/rsi-recursive-risk-budget.mjs',
  'apps/metaengine-browser/src/rsi-adversarial-challenge-producer.mjs',
  'apps/metaengine-browser/src/rsi-component-attribution.mjs',
  'apps/metaengine-browser/src/rsi-group-experience-exchange.mjs',
  'apps/metaengine-browser/src/rsi-adaptive-experience-retrieval.mjs',
  'apps/metaengine-browser/src/rsi-agent-architecture-search.mjs',
  'apps/metaengine-browser/src/rsi-clade-metaproductivity.mjs',
  'apps/metaengine-browser/src/rsi-comparative-lineage-operators.mjs',
  'apps/metaengine-browser/src/rsi-trace-guided-harness-repair.mjs',
  'apps/metaengine-browser/src/rsi-hierarchical-evaluation-economy.mjs',
  'apps/metaengine-browser/src/rsi-asynchronous-island-portfolio.mjs',
  'apps/metaengine-browser/src/rsi-proxy-reliability-calibration.mjs',
  'apps/metaengine-browser/src/rsi-recursive-depth-controller.mjs',
  'apps/metaengine-browser/src/rsi-disagreement-acquisition.mjs',
  'apps/metaengine-browser/src/rsi-experience-graph.mjs',
  'apps/metaengine-browser/src/rsi-benchmark-provenance-guard.mjs',
  'apps/metaengine-browser/src/rsi-frontier-coevolution.mjs',
  'apps/metaengine-browser/src/rsi-regression-replay.mjs',
  'apps/metaengine-browser/src/rsi-verified-skill-library.mjs',
  'apps/metaengine-browser/src/rsi-meta-skill-evolution.mjs',
  'apps/metaengine-browser/src/rsi-skill-scope-expansion.mjs',
  'apps/metaengine-browser/src/rsi-contrastive-skill-reliability.mjs',
  'apps/metaengine-browser/src/rsi-skill-library-governance.mjs',
  'apps/metaengine-browser/src/rsi-shadow-core.mjs',
  'apps/metaengine-browser/src/candidate-capsule.cjs',
  'apps/metaengine-browser/src/verification-sandbox-plan.cjs',
  'apps/metaengine-browser/src/verification-sandbox-backend-binding.cjs',
  'apps/metaengine-browser/src/browser-identity-signer-runtime.mjs',
  'apps/metaengine-browser/src/trusted-dev-release-resolver.mjs',
  'apps/metaengine-browser/src/verified-download-manager.mjs',
]);

const PROMOTION_TRUST_ROOT_PREFIXES = Object.freeze([
  'apps/metaengine-browser/src/self-update-',
  'apps/metaengine-browser/src/browser-guardian-',
  'apps/metaengine-browser/src/native-supervisor-',
  'apps/metaengine-browser/src/supervisor-',
]);

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

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function exactSha(value, label) {
  const normalized = String(value || '').toLowerCase();
  if (!SHA40_RE.test(normalized)) throw new Error(`rsi_promotion_${label}_exact_sha_required`);
  return normalized;
}

function exactDigest(value, label) {
  const normalized = String(value || '').toLowerCase();
  if (!SHA256_RE.test(normalized)) throw new Error(`rsi_promotion_${label}_digest_invalid`);
  return normalized;
}

function boundedText(value, label, max = 512) {
  const text = String(value || '').trim();
  if (!text || text.length > max || !SAFE_TEXT_RE.test(text)) throw new Error(`rsi_promotion_${label}_invalid`);
  return text;
}

function zeroAuthority(value, label) {
  for (const field of ['execution_authority', 'production_mutation_authority', 'promotion_authority', 'self_update_authority', 'authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_promotion_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_promotion_${label}_automatic_retry_invalid`);
}

function evidenceRefs(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) throw new Error(`rsi_promotion_${label}_evidence_refs_invalid`);
  const seen = new Set();
  return value.map((entry) => {
    const ref = boundedText(entry, `${label}_evidence_ref`);
    if (seen.has(ref)) throw new Error(`rsi_promotion_${label}_evidence_ref_duplicate`);
    seen.add(ref);
    return ref;
  }).sort();
}

function assertCandidateDoesNotMutatePromotionRoot(handoff) {
  const components = Array.isArray(handoff?.candidate_capsule?.components) ? handoff.candidate_capsule.components : [];
  for (const component of components) {
    const path = String(component?.path || '');
    if (PROMOTION_TRUST_ROOT_PATHS.has(path) || PROMOTION_TRUST_ROOT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      throw new Error('rsi_promotion_candidate_mutates_promotion_root');
    }
  }
}

function normalizeHandoff(handoff) {
  if (!plainObject(handoff) || handoff.schema !== RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA || handoff.version !== 1) throw new Error('rsi_promotion_candidate_handoff_invalid');
  zeroAuthority(handoff, 'handoff');
  if (handoff.eligible_for_evaluation !== true || handoff.eligible_for_promotion !== false || handoff.materialization_replay_authorized !== false) {
    throw new Error('rsi_promotion_candidate_handoff_policy_invalid');
  }
  assertCandidateDoesNotMutatePromotionRoot(handoff);
  const candidateSha = exactSha(handoff.candidate_sha, 'candidate');
  const parentSha = exactSha(handoff.parent_sha, 'parent');
  if (candidateSha === parentSha) throw new Error('rsi_promotion_candidate_noop');
  const candidateId = String(handoff.candidate_capsule?.candidate_id || '').toLowerCase();
  if (!/^candidate_sha256_[0-9a-f]{64}$/.test(candidateId)) throw new Error('rsi_promotion_candidate_id_invalid');
  if (handoff.candidate_capsule?.source?.head !== candidateSha || handoff.shadow_archive_proposal?.candidate_id !== candidateId) {
    throw new Error('rsi_promotion_candidate_identity_mismatch');
  }
  return Object.freeze({
    candidate_id: candidateId,
    candidate_sha: candidateSha,
    parent_sha: parentSha,
    handoff_digest: exactDigest(handoff.handoff_digest, 'handoff'),
  });
}

function verifyArchiveAdmission(admission, candidate, tournamentResult) {
  if (!plainObject(admission) || admission.schema !== RSI_VERIFIED_EVOLUTION_ARCHIVE_ADMISSION_SCHEMA || admission.version !== 1) {
    throw new Error('rsi_promotion_archive_admission_invalid');
  }
  zeroAuthority(admission, 'archive_admission');
  if (admission.eligible_for_promotion !== false || admission.canonical_recomputation_required !== true || admission.caller_supplied_verdict_trusted !== false || admission.paired_receipts_required !== true) {
    throw new Error('rsi_promotion_archive_admission_policy_invalid');
  }
  if (String(admission.candidate_id || '').toLowerCase() !== candidate.candidate_id || exactSha(admission.candidate_sha, 'archive_candidate') !== candidate.candidate_sha || exactSha(admission.parent_sha, 'archive_parent') !== candidate.parent_sha) {
    throw new Error('rsi_promotion_archive_candidate_mismatch');
  }
  if (exactDigest(admission.tournament_result_digest, 'archive_tournament_result') !== tournamentResult.result_digest) {
    throw new Error('rsi_promotion_archive_result_mismatch');
  }
  const clone = structuredClone(admission);
  delete clone.admission_digest;
  delete clone.row;
  if (exactDigest(admission.admission_digest, 'archive_admission') !== digest(clone)) throw new Error('rsi_promotion_archive_admission_digest_mismatch');
  return Object.freeze({
    archive_state: boundedText(admission.archive_state, 'archive_state', 64),
    archive_active: admission.archive_active === true,
    archive_row_digest: exactDigest(admission.archive_row_digest, 'archive_row'),
    admission_digest: admission.admission_digest,
  });
}

function normalizeCiChecks(value, candidateSha) {
  if (!Array.isArray(value)) throw new Error('rsi_promotion_ci_checks_invalid');
  const byName = new Map();
  for (const raw of value) {
    if (!plainObject(raw)) throw new Error('rsi_promotion_ci_check_invalid');
    const workflow = boundedText(raw.workflow, 'ci_workflow', 160);
    if (byName.has(workflow)) throw new Error('rsi_promotion_ci_check_duplicate');
    const runId = Number(raw.run_id);
    if (!Number.isSafeInteger(runId) || runId < 1) throw new Error('rsi_promotion_ci_run_id_invalid');
    const conclusion = String(raw.conclusion || '').toUpperCase();
    if (!['SUCCESS', 'FAILURE', 'CANCELLED', 'TIMED_OUT'].includes(conclusion)) throw new Error('rsi_promotion_ci_conclusion_invalid');
    byName.set(workflow, Object.freeze({
      workflow,
      run_id: runId,
      head_sha: exactSha(raw.head_sha, 'ci_head'),
      conclusion,
      evidence_ref: boundedText(raw.evidence_ref, 'ci_evidence_ref'),
    }));
  }
  for (const workflow of REQUIRED_WORKFLOWS) {
    if (!byName.has(workflow)) throw new Error(`rsi_promotion_ci_required_missing:${workflow}`);
  }
  if (byName.size !== REQUIRED_WORKFLOWS.length) throw new Error('rsi_promotion_ci_unexpected_check');
  for (const row of byName.values()) {
    if (row.head_sha !== candidateSha) throw new Error('rsi_promotion_ci_head_mismatch');
  }
  return Object.freeze(REQUIRED_WORKFLOWS.map((name) => byName.get(name)));
}

export function verifyRsiExternalPromotionQualification(receipt, candidate) {
  if (!plainObject(receipt) || receipt.schema !== RSI_EXTERNAL_PROMOTION_QUALIFICATION_SCHEMA || receipt.version !== 1) {
    throw new Error('rsi_promotion_qualification_invalid');
  }
  zeroAuthority(receipt, 'qualification');
  if (receipt.external_verifier !== true || receipt.authored_by_candidate !== false || receipt.direct_install_authorized !== false || receipt.self_update_invocation_authorized !== false) {
    throw new Error('rsi_promotion_qualification_origin_invalid');
  }
  if (String(receipt.candidate_id || '').toLowerCase() !== candidate.candidate_id || exactSha(receipt.candidate_sha, 'qualification_candidate') !== candidate.candidate_sha || exactSha(receipt.parent_sha, 'qualification_parent') !== candidate.parent_sha) {
    throw new Error('rsi_promotion_qualification_candidate_mismatch');
  }
  const artifact = receipt.artifact;
  if (!plainObject(artifact)) throw new Error('rsi_promotion_artifact_invalid');
  const artifactDigest = exactDigest(artifact.digest, 'artifact');
  const provenance = receipt.provenance;
  if (!plainObject(provenance)) throw new Error('rsi_promotion_provenance_invalid');
  const provenanceDigest = exactDigest(provenance.digest, 'provenance');
  if (provenance.predicate_type !== SLSA_PROVENANCE_V1) throw new Error('rsi_promotion_provenance_predicate_invalid');
  if (exactSha(provenance.source_sha, 'provenance_source') !== candidate.candidate_sha) throw new Error('rsi_promotion_provenance_source_mismatch');
  const ciChecks = normalizeCiChecks(receipt.ci_checks, candidate.candidate_sha);
  const canary = receipt.canary;
  if (!plainObject(canary) || canary.mode !== 'SHADOW_CANARY' || exactSha(canary.candidate_sha, 'canary_candidate') !== candidate.candidate_sha || exactDigest(canary.artifact_digest, 'canary_artifact') !== artifactDigest) {
    throw new Error('rsi_promotion_canary_binding_invalid');
  }
  const canaryResult = String(canary.result || '').toUpperCase();
  if (!['PASS', 'FAIL'].includes(canaryResult)) throw new Error('rsi_promotion_canary_result_invalid');
  for (const field of ['duplicate_irreversible_effects', 'ambiguous_effect_retries', 'authority_violations', 'workspace_escapes']) {
    const count = Number(canary[field]);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`rsi_promotion_canary_${field}_invalid`);
  }
  const rollback = receipt.rollback;
  if (!plainObject(rollback) || exactSha(rollback.predecessor_sha, 'rollback_predecessor') !== candidate.parent_sha) throw new Error('rsi_promotion_rollback_binding_invalid');
  const core = {
    schema: RSI_EXTERNAL_PROMOTION_QUALIFICATION_SCHEMA,
    version: 1,
    candidate_id: candidate.candidate_id,
    candidate_sha: candidate.candidate_sha,
    parent_sha: candidate.parent_sha,
    artifact: {
      digest: artifactDigest,
      signed: artifact.signed === true,
      signature_verified: artifact.signature_verified === true,
    },
    provenance: {
      digest: provenanceDigest,
      predicate_type: SLSA_PROVENANCE_V1,
      builder_id: boundedText(provenance.builder_id, 'provenance_builder', 256),
      source_repository: boundedText(provenance.source_repository, 'provenance_repository', 200),
      source_sha: candidate.candidate_sha,
      verified: provenance.verified === true,
    },
    ci_checks: ciChecks,
    canary: {
      mode: 'SHADOW_CANARY',
      candidate_sha: candidate.candidate_sha,
      artifact_digest: artifactDigest,
      result: canaryResult,
      duplicate_irreversible_effects: Number(canary.duplicate_irreversible_effects),
      ambiguous_effect_retries: Number(canary.ambiguous_effect_retries),
      authority_violations: Number(canary.authority_violations),
      workspace_escapes: Number(canary.workspace_escapes),
      evidence_refs: evidenceRefs(canary.evidence_refs, 'canary'),
    },
    rollback: {
      predecessor_sha: candidate.parent_sha,
      artifact_digest: exactDigest(rollback.artifact_digest, 'rollback_artifact'),
      ready: rollback.ready === true,
      ambiguous_effect_replay_allowed: rollback.ambiguous_effect_replay_allowed === true,
      evidence_refs: evidenceRefs(rollback.evidence_refs, 'rollback'),
    },
    evidence_refs: evidenceRefs(receipt.evidence_refs, 'qualification'),
    external_verifier: true,
    authored_by_candidate: false,
    direct_install_authorized: false,
    self_update_invocation_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  const qualificationDigest = digest(core);
  if (exactDigest(receipt.qualification_digest, 'qualification') !== qualificationDigest) throw new Error('rsi_promotion_qualification_digest_mismatch');
  return Object.freeze({ ...core, qualification_digest: qualificationDigest });
}

export function evaluateRsiPromotionAdmission({
  candidate_handoff,
  tournament_plan,
  tournament_result,
  archive_admission,
  qualification,
} = {}) {
  const candidate = normalizeHandoff(candidate_handoff);
  verifyRsiShadowTournamentPlan(tournament_plan);
  if (!plainObject(tournament_result) || tournament_result.schema !== RSI_SHADOW_TOURNAMENT_RESULT_SCHEMA) throw new Error('rsi_promotion_tournament_result_invalid');
  verifyRsiShadowTournamentResult({ plan: tournament_plan, result: tournament_result });
  if (tournament_plan.candidate?.candidate_id !== candidate.candidate_id || tournament_plan.candidate?.candidate_sha !== candidate.candidate_sha || tournament_result.candidate?.candidate_id !== candidate.candidate_id) {
    throw new Error('rsi_promotion_tournament_candidate_mismatch');
  }
  const archive = verifyArchiveAdmission(archive_admission, candidate, tournament_result);
  const verifiedQualification = verifyRsiExternalPromotionQualification(qualification, candidate);
  const blockers = [];

  if (tournament_result.relation !== 'PARETO_ADVANCE') blockers.push('TOURNAMENT_NOT_PARETO_ADVANCE');
  if (archive.archive_state !== 'PARETO_ELITE' || archive.archive_active !== true) blockers.push('ARCHIVE_NOT_ACTIVE_PARETO_ELITE');
  if (verifiedQualification.artifact.signed !== true || verifiedQualification.artifact.signature_verified !== true) blockers.push('ARTIFACT_SIGNATURE_NOT_VERIFIED');
  if (verifiedQualification.provenance.verified !== true) blockers.push('PROVENANCE_NOT_VERIFIED');
  if (verifiedQualification.ci_checks.some((entry) => entry.conclusion !== 'SUCCESS')) blockers.push('REQUIRED_CI_NOT_GREEN');
  if (verifiedQualification.canary.result !== 'PASS') blockers.push('SHADOW_CANARY_NOT_PASS');
  if (verifiedQualification.canary.duplicate_irreversible_effects !== 0) blockers.push('DUPLICATE_IRREVERSIBLE_EFFECT');
  if (verifiedQualification.canary.ambiguous_effect_retries !== 0) blockers.push('AMBIGUOUS_EFFECT_RETRY');
  if (verifiedQualification.canary.authority_violations !== 0) blockers.push('AUTHORITY_VIOLATION');
  if (verifiedQualification.canary.workspace_escapes !== 0) blockers.push('WORKSPACE_ESCAPE');
  if (verifiedQualification.rollback.ready !== true) blockers.push('ROLLBACK_NOT_READY');
  if (verifiedQualification.rollback.ambiguous_effect_replay_allowed !== false) blockers.push('ROLLBACK_AMBIGUOUS_REPLAY_ALLOWED');

  const state = blockers.length === 0 ? 'READY_FOR_EXTERNAL_PROMOTION_REVIEW' : 'BLOCKED';
  const core = {
    schema: RSI_PROMOTION_ADMISSION_GATE_RESULT_SCHEMA,
    version: 1,
    state,
    blockers: blockers.sort(),
    candidate_id: candidate.candidate_id,
    candidate_sha: candidate.candidate_sha,
    parent_sha: candidate.parent_sha,
    handoff_digest: candidate.handoff_digest,
    tournament_plan_digest: tournament_plan.plan_digest,
    tournament_result_digest: tournament_result.result_digest,
    archive_admission_digest: archive.admission_digest,
    qualification_digest: verifiedQualification.qualification_digest,
    artifact_digest: verifiedQualification.artifact.digest,
    provenance_digest: verifiedQualification.provenance.digest,
    ready_for_external_promotion_review: blockers.length === 0,
    existing_self_update_handoff_authorized: false,
    direct_install_authorized: false,
    promotion_token: null,
    scalar_winner: null,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, gate_digest: digest(core) });
}

export function rsiPromotionGateTrustRootSnapshot() {
  const root = {
    immutable_component_paths: [...PROMOTION_TRUST_ROOT_PATHS].sort(),
    immutable_component_prefixes: [...PROMOTION_TRUST_ROOT_PREFIXES],
    required_workflows: [...REQUIRED_WORKFLOWS],
    provenance_predicate_type: SLSA_PROVENANCE_V1,
    candidate_can_promote: false,
    candidate_can_invoke_self_update: false,
    scalar_winner_authoritative: false,
  };
  return Object.freeze({ ...root, promotion_gate_root_digest: digest(root) });
}
