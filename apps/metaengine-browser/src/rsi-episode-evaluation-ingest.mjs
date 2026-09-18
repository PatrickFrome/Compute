import crypto from 'node:crypto';

import {
  RsiShadowArchive,
  RSI_HARD_INVARIANTS,
  RSI_SHADOW_STATES,
} from './rsi-shadow-core.mjs';
import {
  applyRsiEvaluatorMesh,
  verifyRsiEvaluatorMeshPlan,
  RSI_EVALUATOR_MESH_RESULT_SCHEMA,
} from './rsi-evaluator-mesh.mjs';
import {
  evaluateRsiShadowTournament,
  verifyRsiShadowTournamentPlan,
  verifyRsiShadowTournamentResult,
} from './rsi-shadow-tournament.mjs';
import {
  verifyRsiRetentionGate,
} from './rsi-regression-replay.mjs';
import {
  verifyRsiEvaluationIntegrityAssessment,
  verifyRsiEvaluationIntegrityPolicy,
  verifyRsiEvaluationIntegrityReceipt,
} from './rsi-evaluation-integrity-guard.mjs';
import {
  RSI_EPISODE_SNAPSHOT_SCHEMA,
} from './rsi-episode-orchestrator.mjs';

export const RSI_EPISODE_EVALUATION_BUNDLE_SCHEMA = 'metaengine.rsi.episode-evaluation-bundle.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^(?:sha256:)?[0-9a-f]{64}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const EVIDENCE_KINDS = Object.freeze([
  'HARD_INVARIANTS',
  'OBJECTIVES',
  'HOLDOUT',
  'REGRESSION_REPLAY',
  'EVALUATION_INTEGRITY',
  'TOURNAMENT',
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(\`rsi_episode_eval_\${label}_sha_invalid\`);
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!DIGEST_RE.test(out)) throw new Error(\`rsi_episode_eval_\${label}_digest_invalid\`);
  return out.startsWith('sha256:') ? out.slice(7) : out;
}

function exactCandidateId(value) {
  const out = String(value || '').trim().toLowerCase();
  if (!CANDIDATE_ID_RE.test(out)) throw new Error('rsi_episode_eval_candidate_id_invalid');
  return out;
}

function assertZeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'browser_authority',
    'scheduler_authority',
    'task_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (Object.hasOwn(value || {}, field) && value[field] !== false) {
      throw new Error(\`rsi_episode_eval_\${label}_\${field}_invalid\`);
    }
  }
  if (Object.hasOwn(value || {}, 'automatic_retry_allowed') && value.automatic_retry_allowed !== false) {
    throw new Error(\`rsi_episode_eval_\${label}_automatic_retry_invalid\`);
  }
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    browser_authority: false,
    scheduler_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function canonicalDigest(value) {
  const clone = structuredClone(value);
  delete clone.result_digest;
  return digest(clone);
}

function verifyEpisodeCandidate(episode, candidateId) {
  if (!episode || typeof episode !== 'object' || Array.isArray(episode) || episode.schema !== RSI_EPISODE_SNAPSHOT_SCHEMA) {
    throw new Error('rsi_episode_eval_episode_schema_invalid');
  }
  assertZeroAuthority(episode, 'episode');
  const id = exactCandidateId(candidateId);
  const candidate = episode.candidates?.[id];
  if (!candidate) throw new Error('rsi_episode_eval_candidate_not_registered');
  assertZeroAuthority(candidate, 'episode_candidate');
  return Object.freeze({
    episode_id: String(episode.episode_id),
    source_sha: exactSha(episode.source_sha, 'source'),
    trust_root_set_digest: exactDigest(episode.trust_root_set_digest, 'trust_root_set'),
    candidate_id: id,
    candidate_sha: exactSha(candidate.candidate_sha, 'candidate'),
    parent_sha: exactSha(candidate.parent_sha, 'parent'),
    mutation_surface: String(candidate.mutation_surface || '').toUpperCase(),
  });
}

function verifyEvaluatorEvidence({ identity, candidate_handoff, evaluator_plan, evaluator_receipts, evaluator_result }) {
  verifyRsiEvaluatorMeshPlan(evaluator_plan);
  if (!Array.isArray(evaluator_receipts)) throw new Error('rsi_episode_eval_evaluator_receipts_invalid');

  const archive = new RsiShadowArchive({ clock: () => Date.parse('2026-01-01T00:00:00.000Z') });
  const proposal = candidate_handoff?.shadow_archive_proposal;
  if (!proposal || typeof proposal !== 'object') throw new Error('rsi_episode_eval_shadow_archive_proposal_missing');
  const proposed = archive.propose(proposal);
  if (proposed.candidate_id !== identity.candidate_id || proposed.candidate_sha !== identity.candidate_sha || proposed.parent_sha !== identity.parent_sha) {
    throw new Error('rsi_episode_eval_evaluator_candidate_identity_mismatch');
  }

  const canonical = applyRsiEvaluatorMesh({
    archive,
    candidate_handoff,
    plan: evaluator_plan,
    receipts: evaluator_receipts,
  });

  if (!evaluator_result || evaluator_result.schema !== RSI_EVALUATOR_MESH_RESULT_SCHEMA) {
    throw new Error('rsi_episode_eval_evaluator_result_schema_invalid');
  }
  assertZeroAuthority(evaluator_result, 'evaluator_result');
  const claimedDigest = exactDigest(evaluator_result.result_digest, 'evaluator_result');
  if (canonical.result_digest !== evaluator_result.result_digest || canonicalDigest(evaluator_result) !== claimedDigest) {
    throw new Error('rsi_episode_eval_evaluator_result_mismatch');
  }
  if (canonical.candidate_id !== identity.candidate_id || canonical.candidate_sha !== identity.candidate_sha) {
    throw new Error('rsi_episode_eval_evaluator_result_candidate_mismatch');
  }

  const hardPass = canonical.state === RSI_SHADOW_STATES.SHADOW_QUALIFIED
    && RSI_HARD_INVARIANTS.every((name) => canonical.hard_invariants?.[name] === 'PASS');
  const objectivesPass = canonical.state === RSI_SHADOW_STATES.SHADOW_QUALIFIED
    && Array.isArray(canonical.objectives)
    && canonical.objectives.some((row) => row?.improved === true);

  return Object.freeze({
    hard_invariants: Object.freeze({
      result: hardPass ? 'PASS' : 'FAIL',
      source_digest: claimedDigest,
      evidence_digest: digest({
        kind: 'HARD_INVARIANTS',
        candidate_id: identity.candidate_id,
        candidate_sha: identity.candidate_sha,
        evaluator_result_digest: claimedDigest,
        hard_invariants: canonical.hard_invariants,
      }),
    }),
    objectives: Object.freeze({
      result: objectivesPass ? 'PASS' : 'FAIL',
      source_digest: claimedDigest,
      evidence_digest: digest({
        kind: 'OBJECTIVES',
        candidate_id: identity.candidate_id,
        candidate_sha: identity.candidate_sha,
        evaluator_result_digest: claimedDigest,
        objectives: canonical.objectives,
      }),
    }),
  });
}

function verifyTournamentEvidence({ identity, tournament_plan, tournament_receipts, tournament_result }) {
  verifyRsiShadowTournamentPlan(tournament_plan);
  const canonical = evaluateRsiShadowTournament({ plan: tournament_plan, receipts: tournament_receipts });
  verifyRsiShadowTournamentResult({ plan: tournament_plan, result: tournament_result });
  if (canonical.result_digest !== tournament_result.result_digest) throw new Error('rsi_episode_eval_tournament_result_mismatch');
  if (canonical.candidate?.candidate_id !== identity.candidate_id || canonical.candidate?.candidate_sha !== identity.candidate_sha) {
    throw new Error('rsi_episode_eval_tournament_candidate_mismatch');
  }
  if (canonical.candidate?.parent_sha !== identity.parent_sha) throw new Error('rsi_episode_eval_tournament_parent_mismatch');

  const hardFailure = Array.isArray(canonical.hard_failures) && canonical.hard_failures.length > 0;
  const regression = Array.isArray(canonical.objectives) && canonical.objectives.some((row) => row?.status === 'REGRESSED');
  const holdoutPass = !hardFailure && !regression;
  const tournamentPass = canonical.relation === 'PARETO_ADVANCE';

  return Object.freeze({
    holdout: Object.freeze({
      result: holdoutPass ? 'PASS' : 'FAIL',
      source_digest: exactDigest(canonical.result_digest, 'tournament_result'),
      evidence_digest: digest({
        kind: 'HOLDOUT',
        candidate_id: identity.candidate_id,
        holdout_digest: tournament_plan.workload?.holdout_digest,
        pair_count: canonical.pair_count,
        hard_failures: canonical.hard_failures,
        objectives: canonical.objectives,
      }),
    }),
    tournament: Object.freeze({
      result: tournamentPass ? 'PASS' : 'FAIL',
      source_digest: exactDigest(canonical.result_digest, 'tournament_result'),
      evidence_digest: digest({
        kind: 'TOURNAMENT',
        candidate_id: identity.candidate_id,
        relation: canonical.relation,
        behavior_signature: canonical.behavior_signature,
        archive_eligible: canonical.archive_eligible,
      }),
    }),
  });
}

function verifyRetentionEvidence({ identity, retention_plan, retention_ledger, retention_receipts, retention_gate }) {
  const canonical = verifyRsiRetentionGate(retention_gate, retention_plan, retention_ledger, retention_receipts);
  if (canonical.current_candidate_id !== identity.candidate_id || exactSha(canonical.current_candidate_sha, 'retention_candidate') !== identity.candidate_sha) {
    throw new Error('rsi_episode_eval_retention_candidate_mismatch');
  }
  const pass = canonical.retention_gate_pass === true && canonical.state === 'RETENTION_GATE_PASS_FOR_EXTERNAL_REVIEW';
  return Object.freeze({
    result: pass ? 'PASS' : 'FAIL',
    source_digest: exactDigest(canonical.gate_digest, 'retention_gate'),
    evidence_digest: digest({
      kind: 'REGRESSION_REPLAY',
      candidate_id: identity.candidate_id,
      gate_digest: canonical.gate_digest,
      blockers: canonical.blockers,
      retained_count: canonical.retained_count,
      degraded_capability_count: canonical.degraded_capability_count,
      degraded_hard_invariant_count: canonical.degraded_hard_invariant_count,
    }),
  });
}

function verifyIntegrityEvidence({ identity, integrity_policy, integrity_receipt, integrity_assessment }) {
  const policy = verifyRsiEvaluationIntegrityPolicy(integrity_policy);
  const receipt = verifyRsiEvaluationIntegrityReceipt(integrity_receipt, policy);
  const assessment = verifyRsiEvaluationIntegrityAssessment(integrity_assessment, policy, receipt);
  if (receipt.candidate_id !== identity.candidate_id || exactSha(receipt.candidate_sha, 'integrity_candidate') !== identity.candidate_sha) {
    throw new Error('rsi_episode_eval_integrity_candidate_mismatch');
  }

  let result = 'AMBIGUOUS';
  if (assessment.state === 'INTEGRITY_VERIFIED') result = 'PASS';
  else if (assessment.state === 'REWARD_HACKING_DETECTED') result = 'FAIL';
  else if (assessment.state === 'SPECIFICATION_GAMING_SUSPECT') result = 'FAIL';

  return Object.freeze({
    result,
    source_digest: exactDigest(assessment.assessment_digest, 'integrity_assessment'),
    evidence_digest: digest({
      kind: 'EVALUATION_INTEGRITY',
      candidate_id: identity.candidate_id,
      assessment_digest: assessment.assessment_digest,
      state: assessment.state,
      visible_holdout_gap: assessment.visible_holdout_gap,
      blockers: assessment.blockers,
    }),
  });
}

export function createRsiEpisodeEvaluationEvidenceBundle({
  episode,
  candidate_id,
  candidate_handoff,
  evaluator_plan,
  evaluator_receipts,
  evaluator_result,
  tournament_plan,
  tournament_receipts,
  tournament_result,
  retention_plan,
  retention_ledger,
  retention_receipts,
  retention_gate,
  integrity_policy,
  integrity_receipt,
  integrity_assessment,
} = {}) {
  const identity = verifyEpisodeCandidate(episode, candidate_id);
  const evaluator = verifyEvaluatorEvidence({
    identity,
    candidate_handoff,
    evaluator_plan,
    evaluator_receipts,
    evaluator_result,
  });
  const tournament = verifyTournamentEvidence({
    identity,
    tournament_plan,
    tournament_receipts,
    tournament_result,
  });
  const retention = verifyRetentionEvidence({
    identity,
    retention_plan,
    retention_ledger,
    retention_receipts,
    retention_gate,
  });
  const integrity = verifyIntegrityEvidence({
    identity,
    integrity_policy,
    integrity_receipt,
    integrity_assessment,
  });

  const evidence = [
    ['HARD_INVARIANTS', evaluator.hard_invariants],
    ['OBJECTIVES', evaluator.objectives],
    ['HOLDOUT', tournament.holdout],
    ['REGRESSION_REPLAY', retention],
    ['EVALUATION_INTEGRITY', integrity],
    ['TOURNAMENT', tournament.tournament],
  ].map(([kind, row]) => Object.freeze({
    evidence_kind: kind,
    evidence_id: \`episode-eval:\${identity.episode_id}:\${identity.candidate_id}:\${kind.toLowerCase()}\`,
    evidence_digest: row.evidence_digest,
    source_artifact_digest: row.source_digest,
    result: row.result,
    ambiguous_effect: row.result === 'AMBIGUOUS',
    external_evidence_required: true,
    authored_by_candidate: false,
    physical_effect_replay_allowed: false,
    authority_effect: false,
    automatic_retry_allowed: false,
  }));

  if (evidence.map((row) => row.evidence_kind).join(',') !== EVIDENCE_KINDS.join(',')) {
    throw new Error('rsi_episode_eval_evidence_set_internal_mismatch');
  }

  const core = zeroAuthority({
    schema: RSI_EPISODE_EVALUATION_BUNDLE_SCHEMA,
    version: 1,
    episode_id: identity.episode_id,
    source_sha: identity.source_sha,
    trust_root_set_digest: identity.trust_root_set_digest,
    candidate_id: identity.candidate_id,
    candidate_sha: identity.candidate_sha,
    parent_sha: identity.parent_sha,
    mutation_surface: identity.mutation_surface,
    evidence,
    complete_evidence_set: true,
    candidate_authored_evidence_allowed: false,
    scalar_reward_authoritative: false,
    visible_suite_alone_sufficient: false,
    external_promotion_gate_still_required: true,
    direct_promotion_enabled: false,
  });
  return Object.freeze({ ...core, bundle_digest: digest(core) });
}

export function verifyRsiEpisodeEvaluationEvidenceBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle) || bundle.schema !== RSI_EPISODE_EVALUATION_BUNDLE_SCHEMA || bundle.version !== 1) {
    throw new Error('rsi_episode_eval_bundle_schema_invalid');
  }
  assertZeroAuthority(bundle, 'bundle');
  if (
    bundle.complete_evidence_set !== true
    || bundle.candidate_authored_evidence_allowed !== false
    || bundle.scalar_reward_authoritative !== false
    || bundle.visible_suite_alone_sufficient !== false
    || bundle.external_promotion_gate_still_required !== true
    || bundle.direct_promotion_enabled !== false
    || !Array.isArray(bundle.evidence)
    || bundle.evidence.length !== EVIDENCE_KINDS.length
  ) throw new Error('rsi_episode_eval_bundle_policy_invalid');

  exactSha(bundle.source_sha, 'bundle_source');
  exactDigest(bundle.trust_root_set_digest, 'bundle_trust_root');
  exactCandidateId(bundle.candidate_id);
  exactSha(bundle.candidate_sha, 'bundle_candidate');
  exactSha(bundle.parent_sha, 'bundle_parent');

  const kinds = bundle.evidence.map((row) => String(row?.evidence_kind || '').toUpperCase());
  if (kinds.join(',') !== EVIDENCE_KINDS.join(',')) throw new Error('rsi_episode_eval_bundle_evidence_order_invalid');
  for (const row of bundle.evidence) {
    if (!['PASS', 'FAIL', 'AMBIGUOUS'].includes(row.result)) throw new Error('rsi_episode_eval_bundle_result_invalid');
    if (row.authored_by_candidate !== false || row.external_evidence_required !== true || row.physical_effect_replay_allowed !== false) {
      throw new Error('rsi_episode_eval_bundle_evidence_origin_invalid');
    }
    if (row.authority_effect !== false || row.automatic_retry_allowed !== false) throw new Error('rsi_episode_eval_bundle_evidence_authority_invalid');
    exactDigest(row.evidence_digest, 'bundle_evidence');
    exactDigest(row.source_artifact_digest, 'bundle_source_artifact');
  }
  const clone = structuredClone(bundle);
  const claimed = exactDigest(clone.bundle_digest, 'bundle');
  delete clone.bundle_digest;
  if (digest(clone) !== claimed) throw new Error('rsi_episode_eval_bundle_digest_mismatch');
  return bundle;
}

export function rsiEpisodeEvaluationIngestTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.episode-evaluation-ingest-trust-root.v1',
    immutable_component_paths: [
      'apps/metaengine-browser/src/rsi-episode-evaluation-ingest.mjs',
      'apps/metaengine-browser/src/rsi-evaluator-mesh.mjs',
      'apps/metaengine-browser/src/rsi-shadow-tournament.mjs',
      'apps/metaengine-browser/src/rsi-regression-replay.mjs',
      'apps/metaengine-browser/src/rsi-evaluation-integrity-guard.mjs',
      'apps/metaengine-browser/src/rsi-episode-orchestrator.mjs',
      'apps/metaengine-browser/src/rsi-promotion-admission-gate.mjs',
    ],
    required_evidence_kinds: [...EVIDENCE_KINDS],
    external_evaluator_required: true,
    candidate_authored_evidence_allowed: false,
    scalar_reward_authoritative: false,
    visible_suite_alone_sufficient: false,
    reward_hacking_blocks_nomination: true,
    contamination_or_insufficient_evidence_is_ambiguous: true,
    direct_promotion_enabled: false,
    self_update_authority: false,
    physical_effect_replay_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, ingest_root_digest: digest(root) });
}
