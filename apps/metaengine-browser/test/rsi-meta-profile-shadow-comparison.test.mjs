import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { RSI_META_PROFILE_QUALIFICATION_SCHEMA } from '../src/rsi-meta-profile-qualification.mjs';
import { createRsiMetaProfileShadowSelection } from '../src/rsi-meta-profile-shadow-selection.mjs';
import {
  RsiMetaProfileShadowComparisonLedger,
  createRsiMetaProfileShadowComparisonBinding,
  createRsiMetaProfileDualPlanComparison,
  rsiMetaProfileShadowComparisonTrustRootSnapshot,
  verifyRsiMetaProfileDualPlanComparison,
  verifyRsiMetaProfileShadowComparisonBinding,
} from '../src/rsi-meta-profile-shadow-comparison.mjs';

const SOURCE = 'a'.repeat(40);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function dg(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function qualification(id, parent, successor, confirmationIndex = 1) {
  const core = {
    schema: RSI_META_PROFILE_QUALIFICATION_SCHEMA,
    version: 1,
    source_sha: SOURCE,
    qualification_id: id,
    meta_record_digest: dg({ id, kind: 'meta' }),
    parent_profile_digest: dg({ parent }),
    successor_profile_digest: dg({ successor }),
    shadow_plan_digest: dg({ id, kind: 'plan' }),
    shadow_result_digest: dg({ id, kind: 'result' }),
    certificate_digest: dg({ id, kind: 'certificate' }),
    risk_budget_digest: dg({ kind: 'risk-budget' }),
    confirmation_index: confirmationIndex,
    allocated_alpha: 0.01,
    alpha_used: 0.005,
    global_alpha: 0.05,
    state: 'QUALIFIED_FOR_SHADOW_PROFILE_SELECTION',
    qualified_for_shadow_profile_selection: true,
    live_profile_activation_authorized: false,
    profile_replacement_authorized: false,
    canary_activation_authorized: false,
    external_activation_gate_still_required: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, qualification_digest: dg(core) });
}

function fixture() {
  const q1 = qualification('qd.qual.a', 'parent-a', 'successor-a', 1);
  const q2 = qualification('qd.qual.b', 'parent-b', 'successor-b', 2);
  const context = dg({ context: 'coding-a' });
  const selection = createRsiMetaProfileShadowSelection({
    source_sha: SOURCE,
    selection_id: 'qd.selection.1',
    context_class: 'CODING',
    context_digest: context,
    qualified_profiles: [q1, q2],
    selection_history: [],
    external_context_owner: true,
    authored_by_candidate: false,
  });
  const selected = [q1, q2].find((row) => row.qualification_digest === selection.selected.qualification_digest);
  const binding = createRsiMetaProfileShadowComparisonBinding({
    binding_id: 'qd.binding.1',
    selection,
    selected_qualification: selected,
    verified_context_digest: context,
    comparator_root_digest: dg({ comparator: 'external-v1' }),
    external_comparator_owner: true,
    authored_by_candidate: false,
  });
  return { q1, q2, selected, context, selection, binding };
}

test('QD-selected profile is bound to the same verified context before dual-plan comparison', () => {
  const fx = fixture();
  const checked = verifyRsiMetaProfileShadowComparisonBinding(fx.binding, {
    selection: fx.selection,
    selected_qualification: fx.selected,
  });
  assert.equal(checked.selection_digest, fx.selection.selection_digest);
  assert.equal(checked.qualification_digest, fx.selection.selected.qualification_digest);
  assert.equal(checked.verified_context_digest, fx.selection.context_digest);
  assert.equal(checked.champion_profile_digest, fx.selection.selected.parent_profile_digest);
  assert.equal(checked.challenger_profile_digest, fx.selection.selected.successor_profile_digest);
  assert.equal(checked.comparison_mode, 'READ_ONLY_DUAL_PLAN');
  assert.equal(checked.plan_execution_allowed, false);
  assert.equal(checked.canary_activation_authorized, false);
  assert.equal(checked.authority_effect, false);
});

test('selection, qualification and verified context cannot be swapped after QD selection', () => {
  const fx = fixture();
  const other = fx.selected.qualification_digest === fx.q1.qualification_digest ? fx.q2 : fx.q1;
  assert.throws(() => createRsiMetaProfileShadowComparisonBinding({
    binding_id: 'qd.binding.wrong-qualification',
    selection: fx.selection,
    selected_qualification: other,
    verified_context_digest: fx.context,
    comparator_root_digest: dg({ comparator: 'external-v1' }),
    external_comparator_owner: true,
    authored_by_candidate: false,
  }), /selected_qualification_mismatch/);

  assert.throws(() => createRsiMetaProfileShadowComparisonBinding({
    binding_id: 'qd.binding.wrong-context',
    selection: fx.selection,
    selected_qualification: fx.selected,
    verified_context_digest: dg({ context: 'other' }),
    comparator_root_digest: dg({ comparator: 'external-v1' }),
    external_comparator_owner: true,
    authored_by_candidate: false,
  }), /context_binding_mismatch/);

  assert.throws(() => createRsiMetaProfileShadowComparisonBinding({
    binding_id: 'qd.binding.candidate-owned',
    selection: fx.selection,
    selected_qualification: fx.selected,
    verified_context_digest: fx.context,
    comparator_root_digest: dg({ comparator: 'external-v1' }),
    external_comparator_owner: false,
    authored_by_candidate: true,
  }), /external_comparator_owner_required/);
});

test('external dual-plan comparison records divergence without granting execution or canary authority', () => {
  const fx = fixture();
  const comparison = createRsiMetaProfileDualPlanComparison({
    comparison_id: 'qd.comparison.1',
    binding: fx.binding,
    selection: fx.selection,
    selected_qualification: fx.selected,
    champion_plan_digest: dg({ plan: 'champion' }),
    challenger_plan_digest: dg({ plan: 'challenger' }),
    champion_projection_digest: dg({ projection: 'champion' }),
    challenger_projection_digest: dg({ projection: 'challenger' }),
    hard_invariants_pass: true,
    incident_observed: false,
    divergence_kind: 'ROUTING_DECISION',
    evidence_digest: dg({ evidence: 'sealed-comparator' }),
    evidence_refs: ['shadow:comparison:sealed:1'],
    external_comparator: true,
    authored_by_candidate: false,
  });
  const checked = verifyRsiMetaProfileDualPlanComparison(comparison, {
    binding: fx.binding,
    selection: fx.selection,
    selected_qualification: fx.selected,
  });
  assert.equal(checked.relation, 'SHADOW_DIVERGENCE');
  assert.equal(checked.eligible_for_future_canary_review_evidence, true);
  assert.equal(checked.plan_execution_observed, false);
  assert.equal(checked.plan_execution_authorized, false);
  assert.equal(checked.canary_activation_authorized, false);
  assert.equal(checked.live_profile_activation_authorized, false);
  assert.equal(checked.authority_effect, false);
});

test('hard invariant failure or incident remains negative evidence and never authorizes canary', () => {
  const fx = fixture();
  for (const [id, hardPass, incident, expected] of [
    ['hard-fail', false, false, 'HARD_INVARIANT_FAILURE'],
    ['incident', true, true, 'INCIDENT'],
  ]) {
    const row = createRsiMetaProfileDualPlanComparison({
      comparison_id: `qd.comparison.${id}`,
      binding: fx.binding,
      selection: fx.selection,
      selected_qualification: fx.selected,
      champion_plan_digest: dg({ plan: 'champion', id }),
      challenger_plan_digest: dg({ plan: 'challenger', id }),
      champion_projection_digest: dg({ projection: 'champion', id }),
      challenger_projection_digest: dg({ projection: 'challenger', id }),
      hard_invariants_pass: hardPass,
      incident_observed: incident,
      divergence_kind: 'ROUTING_DECISION',
      evidence_digest: dg({ evidence: id }),
      evidence_refs: [`shadow:comparison:${id}`],
      external_comparator: true,
      authored_by_candidate: false,
    });
    assert.equal(row.relation, expected);
    assert.equal(row.eligible_for_future_canary_review_evidence, false);
    assert.equal(row.canary_activation_authorized, false);
  }
});

test('comparison ledger is append-only, source-fenced and restart durable', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-qd-shadow-comparison-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fx = fixture();
  const comparison = createRsiMetaProfileDualPlanComparison({
    comparison_id: 'qd.comparison.persist',
    binding: fx.binding,
    selection: fx.selection,
    selected_qualification: fx.selected,
    champion_plan_digest: dg({ plan: 'champion' }),
    challenger_plan_digest: dg({ plan: 'challenger' }),
    champion_projection_digest: dg({ projection: 'same' }),
    challenger_projection_digest: dg({ projection: 'same' }),
    hard_invariants_pass: true,
    incident_observed: false,
    evidence_digest: dg({ evidence: 'persisted' }),
    evidence_refs: ['shadow:comparison:persisted'],
    external_comparator: true,
    authored_by_candidate: false,
  });
  const statePath = path.join(root, 'comparison.json');
  const ledger = new RsiMetaProfileShadowComparisonLedger({ statePath, source_sha: SOURCE });
  await ledger.init();
  assert.equal((await ledger.addBinding(fx.binding)).state, 'SHADOW_BOUND');
  assert.equal((await ledger.addComparison(comparison)).state, 'COMPARISON_RECORDED');
  assert.equal(ledger.snapshot().binding_count, 1);
  assert.equal(ledger.snapshot().comparison_count, 1);
  assert.equal(ledger.snapshot().active_profile_digest, null);
  assert.equal(ledger.snapshot().canary_profile_digest, null);

  const restored = new RsiMetaProfileShadowComparisonLedger({ statePath, source_sha: SOURCE });
  await restored.init();
  assert.equal(restored.snapshot().binding_count, 1);
  assert.equal(restored.snapshot().comparison_count, 1);
  assert.equal((await restored.addBinding(fx.binding)).state, 'IDEMPOTENT');
  assert.equal((await restored.addComparison(comparison)).state, 'IDEMPOTENT');
});

test('ledger rejects self-rehashed rows that weaken policy', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-qd-shadow-policy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fx = fixture();
  const statePath = path.join(root, 'comparison.json');
  const ledger = new RsiMetaProfileShadowComparisonLedger({ statePath, source_sha: SOURCE });
  await ledger.init();

  const badBindingCore = { ...fx.binding, plan_execution_allowed: true };
  delete badBindingCore.binding_digest;
  const badBinding = { ...badBindingCore, binding_digest: dg(badBindingCore) };
  await assert.rejects(() => ledger.addBinding(badBinding), /binding_policy_invalid/);

  await ledger.addBinding(fx.binding);
  const comparison = createRsiMetaProfileDualPlanComparison({
    comparison_id: 'qd.comparison.policy',
    binding: fx.binding,
    selection: fx.selection,
    selected_qualification: fx.selected,
    champion_plan_digest: dg({ plan: 'champion-policy' }),
    challenger_plan_digest: dg({ plan: 'challenger-policy' }),
    champion_projection_digest: dg({ projection: 'champion-policy' }),
    challenger_projection_digest: dg({ projection: 'challenger-policy' }),
    hard_invariants_pass: true,
    incident_observed: false,
    divergence_kind: 'ROUTING_DECISION',
    evidence_digest: dg({ evidence: 'policy' }),
    evidence_refs: ['shadow:comparison:policy'],
    external_comparator: true,
    authored_by_candidate: false,
  });
  const badComparisonCore = { ...comparison, canary_activation_authorized: true };
  delete badComparisonCore.comparison_digest;
  const badComparison = { ...badComparisonCore, comparison_digest: dg(badComparisonCore) };
  await assert.rejects(() => ledger.addComparison(badComparison), /comparison_.*invalid|receipt_policy_invalid/);
});

test('trust root keeps comparison external, read-only and separate from future canary admission', () => {
  const root = rsiMetaProfileShadowComparisonTrustRootSnapshot();
  assert.equal(root.phase18_qd_selection_required, true);
  assert.equal(root.exact_selected_qualification_required, true);
  assert.equal(root.same_verified_context_required, true);
  assert.equal(root.comparison_mode, 'READ_ONLY_DUAL_PLAN');
  assert.equal(root.candidate_can_choose_profile, false);
  assert.equal(root.plan_execution_allowed, false);
  assert.equal(root.browser_effects_allowed, false);
  assert.equal(root.future_canary_gate_still_required, true);
  assert.equal(root.canary_activation_authorized, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.comparison_root_digest, /^sha256:[0-9a-f]{64}$/);
});
