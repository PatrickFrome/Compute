import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  RsiMetaProfileCanaryEvidenceLedger,
  assessRsiMetaProfileCanary,
  createRsiMetaProfileCanaryManifest,
  createRsiMetaProfileCanaryObservation,
  rsiMetaProfileCanaryAdmissionTrustRootSnapshot,
  verifyRsiMetaProfileCanaryManifest,
  verifyRsiMetaProfileCanaryObservation,
} from '../src/rsi-meta-profile-canary-admission.mjs';

const SOURCE = 'a'.repeat(40);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function dg(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}
function tagged(label) {
  return dg({ label });
}
function shadowSelection() {
  const core = {
    schema: 'metaengine.rsi.meta-profile-shadow-selection.v1',
    version: 1,
    source_sha: SOURCE,
    selection_id: 'shadow.selection.one',
    qualification_digest: tagged('qualification'),
    meta_record_digest: tagged('meta-record'),
    library_digest: tagged('library'),
    incumbent_profile_digest: tagged('incumbent'),
    challenger_profile_digest: tagged('challenger'),
    mode: 'SHADOW_ONLY',
    external_selector: true,
    authored_by_candidate: false,
    candidate_can_select_profile: false,
    selection_can_change_execution: false,
    selection_can_replace_incumbent: false,
    selection_can_grant_skill_activity: false,
    continuous_shadow_review_required: true,
    canary_gate_still_required: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, selection_digest: dg(core) });
}
function comparisonBinding(selection, index, comparatorRoot) {
  const core = {
    schema: 'metaengine.rsi.shadow-comparison-binding.v1',
    version: 1,
    source_sha: SOURCE,
    selection_digest: selection.selection_digest,
    qualification_digest: selection.qualification_digest,
    champion_profile_digest: selection.incumbent_profile_digest,
    challenger_profile_digest: selection.challenger_profile_digest,
    verified_context_digest: tagged(`context-${index}`),
    baseline_plan_digest: tagged(`baseline-${index}`),
    comparator_root_digest: comparatorRoot,
    comparison_mode: 'READ_ONLY_DUAL_PLAN',
    context_source: 'BASELINE_PLAN',
    champion_challenger_roles_fixed: true,
    same_verified_context_required: true,
    external_comparator_owner: true,
    authored_by_candidate: false,
    candidate_can_choose_context: false,
    candidate_can_choose_comparator: false,
    candidate_can_swap_roles: false,
    raw_context_exposed_to_candidate: false,
    browser_effects_allowed: false,
    plan_execution_allowed: false,
    baseline_execution_path_unchanged: true,
    comparison_can_change_execution: false,
    comparison_can_activate_profile: false,
    comparison_can_authorize_canary: false,
    external_canary_gate_still_required: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, binding_digest: dg(core) });
}
function manifest(selection = shadowSelection(), overrides = {}) {
  return createRsiMetaProfileCanaryManifest({
    manifest_id: overrides.manifest_id || 'canary.manifest.one',
    selection,
    cohort_digest: overrides.cohort_digest || tagged('cohort-a'),
    comparator_root_digest: overrides.comparator_root_digest || tagged('comparator-root'),
    decision_budget: overrides.decision_budget || 3,
    window_budget: overrides.window_budget || 2,
    external_canary_owner: true,
    authored_by_candidate: false,
  });
}
function observation(manifestRow, selection, index, overrides = {}) {
  return createRsiMetaProfileCanaryObservation({
    observation_id: overrides.observation_id || `obs.${index}`,
    manifest: manifestRow,
    selection,
    decision_index: index,
    window_index: overrides.window_index || Math.min(index, manifestRow.window_budget),
    comparison_binding: overrides.comparison_binding || comparisonBinding(selection, index, manifestRow.comparator_root_digest),
    challenger_plan_digest: overrides.challenger_plan_digest || tagged(`challenger-${index}`),
    identity_match: overrides.identity_match ?? true,
    outcome_safety: overrides.outcome_safety || 'PASS',
    security_awareness: overrides.security_awareness || 'PASS',
    task_utility: overrides.task_utility || 'EQUIVALENT',
    divergence_class: overrides.divergence_class || 'MATCH',
    incident_codes: overrides.incident_codes || [],
    evidence_digest: overrides.evidence_digest || tagged(`evidence-${index}`),
    external_observer: true,
    authored_by_candidate: false,
    execution_attempted: false,
    browser_effect_attempted: false,
    state_mutation_attempted: false,
  });
}

test('canary manifest freezes identity, cohort and comparator while keeping the incumbent default', () => {
  const selection = shadowSelection();
  const row = manifest(selection);
  assert.equal(verifyRsiMetaProfileCanaryManifest(row, { selection }).manifest_digest, row.manifest_digest);
  assert.equal(row.mode, 'READ_ONLY_DECISION_SUPPORT_CANARY');
  assert.equal(row.baseline_profile_remains_default, true);
  assert.equal(row.baseline_profile_is_fallback, true);
  assert.equal(row.external_comparator_root_fixed, true);
  assert.equal(row.candidate_can_choose_comparator, false);
  assert.equal(row.challenger_output_is_advisory_only, true);
  assert.equal(row.browser_effects_allowed, false);
  assert.equal(row.profile_replacement_allowed, false);
  assert.equal(row.canary_token, null);
  assert.match(row.canary_identity_digest, /^sha256:[0-9a-f]{64}$/);
});

test('candidate cannot own the cohort or turn a canary observation into an effect', () => {
  const selection = shadowSelection();
  assert.throws(() => createRsiMetaProfileCanaryManifest({
    manifest_id: 'canary.bad-owner',
    selection,
    cohort_digest: tagged('cohort-a'),
    comparator_root_digest: tagged('comparator-root'),
    decision_budget: 2,
    window_budget: 1,
    external_canary_owner: false,
    authored_by_candidate: true,
  }), /external_owner_required/);

  const row = manifest(selection, { decision_budget: 2, window_budget: 1 });
  assert.throws(() => createRsiMetaProfileCanaryObservation({
    observation_id: 'obs.effect',
    manifest: row,
    selection,
    decision_index: 1,
    window_index: 1,
    comparison_binding: comparisonBinding(selection, 1, row.comparator_root_digest),
    challenger_plan_digest: tagged('challenger'),
    identity_match: true,
    outcome_safety: 'PASS',
    security_awareness: 'PASS',
    task_utility: 'EQUIVALENT',
    divergence_class: 'MATCH',
    incident_codes: [],
    evidence_digest: tagged('evidence'),
    external_observer: true,
    authored_by_candidate: false,
    execution_attempted: true,
  }), /read_only_observation_required/);
});

test('each decision is bound to an exact external comparison context and comparator root', () => {
  const selection = shadowSelection();
  const row = manifest(selection, { decision_budget: 2, window_budget: 1 });
  const first = observation(row, selection, 1);
  assert.equal(first.context_digest, first.comparison_binding.verified_context_digest);
  assert.equal(first.baseline_plan_digest, first.comparison_binding.baseline_plan_digest);
  assert.equal(first.comparison_binding.comparator_root_digest, row.comparator_root_digest);

  const drifted = comparisonBinding(selection, 2, tagged('different-comparator'));
  assert.throws(
    () => observation(row, selection, 2, { comparison_binding: drifted }),
    /comparator_root_drift/,
  );
});

test('complete safe trajectory evidence yields review readiness but never activation authority', () => {
  const selection = shadowSelection();
  const row = manifest(selection);
  const observations = [1, 2, 3].map((index) => observation(row, selection, index));
  observations.forEach((entry) => {
    assert.equal(
      verifyRsiMetaProfileCanaryObservation(entry, { manifest: row, selection }).observation_digest,
      entry.observation_digest,
    );
  });
  const admission = assessRsiMetaProfileCanary({
    admission_id: 'admission.safe',
    manifest: row,
    selection,
    observations,
    external_admission_owner: true,
    authored_by_candidate: false,
  });
  assert.equal(admission.state, 'READY_FOR_EXTERNAL_CANARY_REVIEW');
  assert.equal(admission.complete_evidence, true);
  assert.deepEqual(admission.blockers, []);
  assert.equal(admission.ready_for_external_canary_review, true);
  assert.equal(admission.challenger_activation_authorized, false);
  assert.equal(admission.live_profile_replacement_authorized, false);
  assert.equal(admission.canary_token, null);
  assert.equal(admission.execution_authority, false);
  assert.equal(admission.authority_effect, false);
});

test('identity drift, ambiguity, incidents and utility regression latch baseline-only', () => {
  const selection = shadowSelection();
  const row = manifest(selection, { decision_budget: 4, window_budget: 2 });
  const observations = [
    observation(row, selection, 1, { identity_match: false }),
    observation(row, selection, 2, { outcome_safety: 'AMBIGUOUS', divergence_class: 'AMBIGUOUS' }),
    observation(row, selection, 3, { security_awareness: 'FAIL', incident_codes: ['PROMPT_INJECTION'] }),
    observation(row, selection, 4, { task_utility: 'REGRESSED', divergence_class: 'SAFETY_RELEVANT_DIVERGENCE' }),
  ];
  const admission = assessRsiMetaProfileCanary({
    admission_id: 'admission.blocked',
    manifest: row,
    selection,
    observations,
    external_admission_owner: true,
    authored_by_candidate: false,
  });
  assert.equal(admission.state, 'BLOCKED_BASELINE_ONLY');
  assert.equal(admission.baseline_only_required, true);
  for (const blocker of [
    'IDENTITY_DRIFT',
    'OUTCOME_SAFETY_AMBIGUOUS',
    'AMBIGUOUS_DIVERGENCE',
    'SECURITY_AWARENESS_FAIL',
    'INCIDENT_RECORDED',
    'TASK_UTILITY_REGRESSION',
    'SAFETY_RELEVANT_DIVERGENCE',
  ]) assert.ok(admission.blockers.includes(blocker), blocker);
  assert.equal(admission.ready_for_external_canary_review, false);
  assert.equal(admission.canary_token, null);
});

test('incomplete evidence remains pending and cannot be promoted by a partial clean sample', () => {
  const selection = shadowSelection();
  const row = manifest(selection, { decision_budget: 3, window_budget: 1 });
  const admission = assessRsiMetaProfileCanary({
    admission_id: 'admission.pending',
    manifest: row,
    selection,
    observations: [observation(row, selection, 1)],
    external_admission_owner: true,
    authored_by_candidate: false,
  });
  assert.equal(admission.state, 'PENDING_EVIDENCE');
  assert.equal(admission.complete_evidence, false);
  assert.equal(admission.ready_for_external_canary_review, false);
  assert.equal(admission.challenger_activation_authorized, false);
});

test('durable evidence ledger is append-only, restart-safe and conflicts fail closed', async (t) => {
  const selection = shadowSelection();
  const row = manifest(selection, { decision_budget: 2, window_budget: 1 });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rsi-canary-ledger-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const statePath = path.join(dir, 'canary.json');
  const ledger = new RsiMetaProfileCanaryEvidenceLedger({
    statePath,
    source_sha: SOURCE,
    manifest_digest: row.manifest_digest,
  });
  await ledger.init();
  const first = observation(row, selection, 1);
  const stored = await ledger.add(first);
  assert.equal(stored.state, 'RECORDED');
  assert.equal(ledger.snapshot().observation_count, 1);
  assert.equal(ledger.snapshot().ledger_can_activate_profile, false);

  const restarted = new RsiMetaProfileCanaryEvidenceLedger({
    statePath,
    source_sha: SOURCE,
    manifest_digest: row.manifest_digest,
  });
  await restarted.init();
  assert.equal(restarted.observations().length, 1);
  assert.equal((await restarted.add(first)).state, 'IDEMPOTENT');

  const conflict = observation(row, selection, 1, {
    observation_id: first.observation_id,
    task_utility: 'IMPROVED',
    evidence_digest: tagged('different-evidence'),
  });
  await assert.rejects(() => restarted.add(conflict), /identity_conflict/);
});

test('trust root fixes safe-exploration boundaries and exposes no authority', () => {
  const root = rsiMetaProfileCanaryAdmissionTrustRootSnapshot();
  assert.equal(root.phase18_shadow_selection_required, true);
  assert.equal(root.identity_stable_canary_manifest_required, true);
  assert.equal(root.fixed_external_cohort_required, true);
  assert.equal(root.fixed_external_comparator_root_required, true);
  assert.equal(root.exact_context_comparison_binding_required_per_decision, true);
  assert.equal(root.baseline_profile_remains_default, true);
  assert.equal(root.first_canary_surface_read_only_decision_support_only, true);
  assert.equal(root.trajectory_outcome_safety_required, true);
  assert.equal(root.trajectory_security_awareness_required, true);
  assert.equal(root.trajectory_task_utility_required, true);
  assert.equal(root.identity_drift_blocks_canary, true);
  assert.equal(root.ambiguous_evidence_blocks_canary, true);
  assert.equal(root.candidate_can_choose_comparator, false);
  assert.equal(root.candidate_can_self_admit, false);
  assert.equal(root.canary_token_minted, false);
  assert.equal(root.profile_activation_authorized, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.canary_admission_root_digest, /^sha256:[0-9a-f]{64}$/);
});
