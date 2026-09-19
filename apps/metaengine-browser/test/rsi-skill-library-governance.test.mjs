import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import {
  RSI_SKILL_LIBRARY_GOVERNANCE_SCHEMA,
  createRsiSkillLifecycleEvidence,
  verifyRsiSkillLifecycleEvidence,
  createRsiSkillLibraryGovernance,
  verifyRsiSkillLibraryGovernance,
  createRsiSkillActivationView,
  verifyRsiSkillActivationView,
  rsiSkillLibraryGovernanceTrustRootSnapshot,
} from '../src/rsi-skill-library-governance.mjs';

const sha = (char) => char.repeat(40);
const d = (char) => `sha256:${char.repeat(64)}`;

function capsule({
  id,
  source,
  implementation,
  role = 'ANALYZER',
  input = d('1'),
  output = d('2'),
  capabilities = ['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
} = {}) {
  return createRsiSkillCapsule({
    skill_id: id,
    version: 1,
    parent_skill_digest: null,
    source_candidate_sha: sha(source),
    role,
    input_schema_digest: input,
    output_schema_digest: output,
    implementation_digest: d(implementation),
    components: [{ component_id: `${id}.component`, artifact_digest: d('f'), kind: 'TYPED_TRANSFORM' }],
    capabilities,
    max_context_tokens: 2048,
    max_output_tokens: 512,
    max_invocations: 2,
    external_builder: true,
    authored_by_candidate: false,
  });
}

function evidence(skill, holdout) {
  return createRsiSkillEvidence({
    capsule: skill,
    hidden_holdout_digest: d(holdout),
    evaluator_root_digest: d('e'),
    unit_test_digest: d('d'),
    runtime_feedback_digest: d('c'),
    attempt_count: 12,
    success_count: 10,
    hard_invariants_pass: true,
    verified_for_library: true,
    evidence_refs: [`VERIFY_${skill.skill_id}`],
    external_evaluator: true,
    authored_by_candidate: false,
  });
}

function fixture() {
  const strong = capsule({ id: 'skill.strong', source: '1', implementation: '1' });
  const weak = capsule({ id: 'skill.weak', source: '2', implementation: '2' });
  const explore = capsule({
    id: 'skill.explore',
    source: '3',
    implementation: '3',
    role: 'RETRIEVER',
    capabilities: ['READ_VERIFIED_CONTEXT','SELECT_VERIFIED_MEMORY'],
  });
  const harmful = capsule({
    id: 'skill.harmful',
    source: '4',
    implementation: '4',
    role: 'VERIFIER',
    capabilities: ['CHECK_TYPED_OUTPUT'],
  });
  const library = createRsiVerifiedSkillLibrary({
    library_id: 'rsi.skill.library.governance.fixture',
    entries: [
      { capsule: strong, evidence: evidence(strong, '5') },
      { capsule: weak, evidence: evidence(weak, '6') },
      { capsule: explore, evidence: evidence(explore, '7') },
      { capsule: harmful, evidence: evidence(harmful, '8') },
    ],
    external_library_owner: true,
    authored_by_candidate: false,
  });
  return { library, strong, weak, explore, harmful };
}

function lifecycle(library, skill, {
  id,
  seq = 1,
  start = seq,
  end = seq,
  invocations = 6,
  helpful = 4,
  harmful = 1,
  neutral = 1,
  insufficient = 0,
  engagements = invocations,
  falsePositives = 0,
  hardViolations = 0,
  delta = 0.1,
  prior = 'VERIFIED_DIRECT_SKILL',
  provenance = '9',
} = {}) {
  return createRsiSkillLifecycleEvidence({
    library,
    evidence_id: id,
    skill_digest: skill.skill_digest,
    window_seq: seq,
    generation_start: start,
    generation_end: end,
    invocation_count: invocations,
    helpful_count: helpful,
    harmful_count: harmful,
    neutral_count: neutral,
    insufficient_evidence_count: insufficient,
    router_engagement_count: engagements,
    false_positive_injection_count: falsePositives,
    hard_invariant_violation_count: hardViolations,
    measured_net_delta: delta,
    authoring_prior: prior,
    authoring_provenance_digest: d(provenance),
    evidence_refs: [`LIFECYCLE_${id}`],
    external_evaluator: true,
    authored_by_candidate: false,
  });
}

test('lifecycle evidence is external, exact-bound and records router false-positive diagnostics', () => {
  const { library, strong } = fixture();
  const row = lifecycle(library, strong, {
    id: 'window.strong.1',
    engagements: 8,
    falsePositives: 1,
  });
  verifyRsiSkillLifecycleEvidence(row, library);
  assert.equal(row.skill_digest, strong.skill_digest);
  assert.equal(row.router_engagement_count, 8);
  assert.equal(row.false_positive_injection_count, 1);
  assert.equal(row.external_evaluator, true);
  assert.equal(row.authored_by_candidate, false);
  assert.equal(row.lifecycle_evidence_is_activation_authority, false);
  assert.equal(row.raw_model_transcript_stored, false);
  assert.equal(row.authority_effect, false);
});

test('candidate cannot author lifecycle evidence or mismatch outcome counts', () => {
  const { library, strong } = fixture();
  assert.throws(() => createRsiSkillLifecycleEvidence({
    library,
    evidence_id: 'candidate.self.window',
    skill_digest: strong.skill_digest,
    window_seq: 1,
    generation_start: 1,
    generation_end: 1,
    invocation_count: 1,
    helpful_count: 1,
    harmful_count: 0,
    neutral_count: 0,
    insufficient_evidence_count: 0,
    router_engagement_count: 1,
    false_positive_injection_count: 0,
    hard_invariant_violation_count: 0,
    measured_net_delta: 1,
    authoring_prior: 'VERIFIED_META_SKILL',
    authoring_provenance_digest: d('a'),
    evidence_refs: ['MODEL_SELF_REPORT'],
    external_evaluator: false,
    authored_by_candidate: true,
  }), /external_origin_required/);

  assert.throws(() => lifecycle(library, strong, {
    id: 'bad.counts',
    invocations: 4,
    helpful: 3,
    harmful: 2,
    neutral: 0,
    insufficient: 0,
  }), /outcome_count_mismatch/);
});

test('active cap preserves one bounded exploration slot and ranks proven positive skills separately', () => {
  const { library, strong, weak, explore } = fixture();
  const rows = [
    lifecycle(library, strong, {
      id: 'strong.1',
      invocations: 8,
      helpful: 7,
      harmful: 0,
      neutral: 1,
      delta: 0.25,
      prior: 'VERIFIED_DIRECT_SKILL',
    }),
    lifecycle(library, weak, {
      id: 'weak.1',
      invocations: 8,
      helpful: 5,
      harmful: 1,
      neutral: 2,
      delta: 0.08,
      prior: 'VERIFIED_DIRECT_SKILL',
    }),
    lifecycle(library, explore, {
      id: 'explore.1',
      invocations: 0,
      helpful: 0,
      harmful: 0,
      neutral: 0,
      insufficient: 0,
      engagements: 0,
      delta: 0,
      prior: 'VERIFIED_META_SKILL',
    }),
  ];
  const governance = createRsiSkillLibraryGovernance({
    governance_id: 'governance.active-cap.1',
    library,
    lifecycle_evidence: rows,
    max_active_skills: 2,
    exploration_slots: 1,
    min_positive_observations: 4,
    min_retirement_observations: 12,
    min_retirement_windows: 2,
    external_library_owner: true,
    authored_by_candidate: false,
  });
  verifyRsiSkillLibraryGovernance(governance, library);
  assert.equal(governance.schema, RSI_SKILL_LIBRARY_GOVERNANCE_SCHEMA);
  assert.equal(governance.active_count, 2);
  assert.ok(governance.active_count <= governance.config.max_active_skills);

  const strongState = governance.entries.find((row) => row.skill_digest === strong.skill_digest);
  const weakState = governance.entries.find((row) => row.skill_digest === weak.skill_digest);
  const exploreState = governance.entries.find((row) => row.skill_digest === explore.skill_digest);
  assert.equal(strongState.state, 'ACTIVE');
  assert.equal(exploreState.state, 'EXPLORATION_ACTIVE');
  assert.equal(weakState.state, 'DORMANT_CAP');
  assert.equal(governance.active_view_is_bounded, true);
  assert.equal(governance.meta_skill_authoring_prior_is_tiebreak_only, true);
  assert.equal(governance.candidate_can_bypass_active_cap, false);
});

test('admission exposure hold dominates positive lifecycle evidence until external governance release', () => {
  const { library, strong } = fixture();
  const rows = [
    lifecycle(library, strong, {
      id: 'held.strong.1',
      invocations: 8,
      helpful: 8,
      harmful: 0,
      neutral: 0,
      delta: 0.4,
      prior: 'VERIFIED_DIRECT_SKILL',
    }),
  ];
  const held = createRsiSkillLibraryGovernance({
    governance_id: 'governance.exposure-hold.1',
    library,
    lifecycle_evidence: rows,
    admission_exposure_hold_skill_digests: [strong.skill_digest],
    max_active_skills: 2,
    exploration_slots: 1,
    min_positive_observations: 4,
    external_library_owner: true,
    authored_by_candidate: false,
  });
  verifyRsiSkillLibraryGovernance(held, library);
  const row = held.entries.find((entry) => entry.skill_digest === strong.skill_digest);
  assert.equal(row.state, 'DORMANT_CAP');
  assert.equal(row.active_for_composition, false);
  assert.equal(row.admission_exposure_hold, true);
  assert.deepEqual(held.admission_exposure_hold_skill_digests, [strong.skill_digest]);
  assert.equal(held.admission_exposure_holds_force_nonactive, true);
  assert.equal(held.storage_admission_does_not_imply_retrieval_exposure, true);
  assert.equal(held.admission_exposure_hold_release_requires_external_governance, true);
  assert.throws(() => createRsiSkillActivationView({
    governance: held,
    library,
    requested_skill_digests: [strong.skill_digest],
    external_planner: true,
    authored_by_candidate: false,
  }), /requested_skill_not_active:DORMANT_CAP/);
});

test('newly appended verified skill with zero lifecycle windows stays dormant until shadow evidence exists', () => {
  const { library, explore } = fixture();
  const governance = createRsiSkillLibraryGovernance({
    governance_id: 'governance.zero-evidence.dormant',
    library,
    lifecycle_evidence: [],
    max_active_skills: 4,
    exploration_slots: 4,
    external_library_owner: true,
    authored_by_candidate: false,
  });
  const row = governance.entries.find((entry) => entry.skill_digest === explore.skill_digest);
  assert.equal(row.evidence_window_count, 0);
  assert.equal(row.state, 'DORMANT_CAP');
  assert.equal(row.active_for_composition, false);
  assert.throws(() => createRsiSkillActivationView({
    governance,
    library,
    requested_skill_digests: [explore.skill_digest],
    external_planner: true,
    authored_by_candidate: false,
  }), /requested_skill_not_active:DORMANT_CAP/);
});

test('append-only successor governance preserves exact predecessor-bound lifecycle evidence only through explicit lineage', () => {
  const { library, strong } = fixture();
  const historicalWindow = lifecycle(library, strong, {
    id: 'strong.predecessor.window',
    invocations: 8,
    helpful: 7,
    harmful: 0,
    neutral: 1,
    delta: 0.25,
  });
  const appended = capsule({ id: 'skill.appended.dormant', source: 'a', implementation: 'b' });
  const successorLibrary = createRsiVerifiedSkillLibrary({
    library_id: library.library_id,
    entries: [
      ...library.entries.map((entry) => ({ capsule: entry.capsule, evidence: entry.evidence })),
      { capsule: appended, evidence: evidence(appended, 'b') },
    ],
    external_library_owner: true,
    authored_by_candidate: false,
  });

  assert.throws(() => createRsiSkillLibraryGovernance({
    governance_id: 'governance.lineage.missing',
    library: successorLibrary,
    lifecycle_evidence: [historicalWindow],
    external_library_owner: true,
    authored_by_candidate: false,
  }), /lifecycle_evidence_library_lineage_missing/);

  const governance = createRsiSkillLibraryGovernance({
    governance_id: 'governance.lineage.exact',
    library: successorLibrary,
    lifecycle_evidence: [historicalWindow],
    historical_libraries: [library],
    max_active_skills: 4,
    exploration_slots: 1,
    external_library_owner: true,
    authored_by_candidate: false,
  });
  const retained = governance.entries.find((entry) => entry.skill_digest === strong.skill_digest);
  const added = governance.entries.find((entry) => entry.skill_digest === appended.skill_digest);
  assert.equal(retained.evidence_window_count, 1);
  assert.equal(retained.state, 'ACTIVE');
  assert.equal(added.evidence_window_count, 0);
  assert.equal(added.state, 'DORMANT_CAP');
  assert.equal(added.active_for_composition, false);

  const tamperedAncestor = structuredClone(library);
  tamperedAncestor.entries[0].evidence_digest = d('0');
  assert.throws(() => createRsiSkillLibraryGovernance({
    governance_id: 'governance.lineage.tampered',
    library: successorLibrary,
    lifecycle_evidence: [historicalWindow],
    historical_libraries: [tamperedAncestor],
    external_library_owner: true,
    authored_by_candidate: false,
  }));
});

test('retirement requires repeated negative evidence and never hard-deletes the skill', () => {
  const { library, harmful } = fixture();
  const oneWindow = lifecycle(library, harmful, {
    id: 'harmful.1',
    seq: 1,
    invocations: 6,
    helpful: 1,
    harmful: 4,
    neutral: 1,
    delta: -0.08,
    falsePositives: 1,
  });
  const firstGovernance = createRsiSkillLibraryGovernance({
    governance_id: 'governance.harmful.first',
    library,
    lifecycle_evidence: [oneWindow],
    max_active_skills: 4,
    exploration_slots: 1,
    min_retirement_observations: 12,
    min_retirement_windows: 2,
    external_library_owner: true,
    authored_by_candidate: false,
  });
  const firstState = firstGovernance.entries.find((row) => row.skill_digest === harmful.skill_digest);
  assert.equal(firstState.state, 'QUARANTINED');
  assert.equal(firstState.retirement_eligible, false);

  const secondWindow = lifecycle(library, harmful, {
    id: 'harmful.2',
    seq: 2,
    start: 2,
    end: 2,
    invocations: 6,
    helpful: 0,
    harmful: 5,
    neutral: 1,
    delta: -0.09,
    falsePositives: 2,
  });
  const governance = createRsiSkillLibraryGovernance({
    governance_id: 'governance.harmful.second',
    library,
    lifecycle_evidence: [oneWindow, secondWindow],
    max_active_skills: 4,
    exploration_slots: 1,
    min_retirement_observations: 12,
    min_retirement_windows: 2,
    external_library_owner: true,
    authored_by_candidate: false,
  });
  const row = governance.entries.find((entry) => entry.skill_digest === harmful.skill_digest);
  assert.equal(row.state, 'RETIRED');
  assert.equal(row.retirement_eligible, true);
  assert.equal(row.active_for_composition, false);
  assert.equal(row.retained_in_evidence_archive, true);
  assert.equal(row.hard_deleted, false);
  assert.equal(row.candidate_can_reactivate, false);
  assert.equal(governance.premature_retirement_protected_by_minimum_evidence, true);
  assert.equal(governance.retired_skills_remain_auditable, true);
});

test('hard-invariant violation quarantines immediately but does not let candidate retire or reactivate the skill', () => {
  const { library, weak } = fixture();
  const evidenceRow = lifecycle(library, weak, {
    id: 'weak.hard-violation',
    invocations: 2,
    helpful: 1,
    harmful: 1,
    neutral: 0,
    hardViolations: 1,
    delta: 0,
  });
  const governance = createRsiSkillLibraryGovernance({
    governance_id: 'governance.quarantine.hard',
    library,
    lifecycle_evidence: [evidenceRow],
    max_active_skills: 4,
    exploration_slots: 1,
    external_library_owner: true,
    authored_by_candidate: false,
  });
  const row = governance.entries.find((entry) => entry.skill_digest === weak.skill_digest);
  assert.equal(row.state, 'QUARANTINED');
  assert.equal(row.active_for_composition, false);
  assert.equal(row.candidate_can_retire, false);
  assert.equal(row.candidate_can_reactivate, false);
});

test('activation view rejects retired, quarantined and cap-dormant skills', () => {
  const { library, strong, weak, explore, harmful } = fixture();
  const rows = [
    lifecycle(library, strong, {
      id: 'activation.strong',
      invocations: 8,
      helpful: 7,
      harmful: 0,
      neutral: 1,
      delta: 0.2,
    }),
    lifecycle(library, weak, {
      id: 'activation.weak',
      invocations: 8,
      helpful: 5,
      harmful: 1,
      neutral: 2,
      delta: 0.05,
    }),
    lifecycle(library, explore, {
      id: 'activation.explore',
      invocations: 0,
      helpful: 0,
      harmful: 0,
      neutral: 0,
      insufficient: 0,
      engagements: 0,
      delta: 0,
      prior: 'VERIFIED_META_SKILL',
    }),
    lifecycle(library, harmful, {
      id: 'activation.harmful',
      invocations: 2,
      helpful: 0,
      harmful: 2,
      neutral: 0,
      delta: -0.1,
      hardViolations: 1,
    }),
  ];
  const governance = createRsiSkillLibraryGovernance({
    governance_id: 'governance.activation.1',
    library,
    lifecycle_evidence: rows,
    max_active_skills: 2,
    exploration_slots: 1,
    external_library_owner: true,
    authored_by_candidate: false,
  });

  const view = createRsiSkillActivationView({
    governance,
    library,
    requested_skill_digests: [strong.skill_digest, explore.skill_digest],
    external_planner: true,
    authored_by_candidate: false,
  });
  assert.equal(view.selected_count, 2);
  assert.equal(view.only_governance_active_skills, true);
  assert.equal(view.retired_or_quarantined_skill_activation_allowed, false);
  assert.equal(view.activation_view_is_execution_authority, false);
  verifyRsiSkillActivationView(view, governance, library);

  assert.throws(() => createRsiSkillActivationView({
    governance,
    library,
    requested_skill_digests: [weak.skill_digest],
    external_planner: true,
    authored_by_candidate: false,
  }), /requested_skill_not_active:DORMANT_CAP/);

  assert.throws(() => createRsiSkillActivationView({
    governance,
    library,
    requested_skill_digests: [harmful.skill_digest],
    external_planner: true,
    authored_by_candidate: false,
  }), /requested_skill_not_active:QUARANTINED/);
});

test('skill governance trust root encodes library-drift defenses without widening authority', () => {
  const root = rsiSkillLibraryGovernanceTrustRootSnapshot();
  assert.equal(root.library_evidence_remains_append_only, true);
  assert.equal(root.outcome_driven_retirement, true);
  assert.equal(root.active_cap_required, true);
  assert.equal(root.exploration_slots_required, true);
  assert.equal(root.premature_retirement_protected_by_minimum_evidence, true);
  assert.equal(root.router_false_positive_diagnostics_required, true);
  assert.equal(root.zero_evidence_skill_activation_forbidden, true);
  assert.equal(root.meta_skill_authoring_prior_is_tiebreak_only, true);
  assert.equal(root.candidate_can_change_governance, false);
  assert.equal(root.candidate_can_reactivate_skill, false);
  assert.equal(root.candidate_can_retire_skill, false);
  assert.equal(root.candidate_can_bypass_active_cap, false);
  assert.equal(root.skill_governance_is_promotion_authority, false);
  assert.equal(root.execution_authority, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.governance_root_digest, /^sha256:[0-9a-f]{64}$/);
});
