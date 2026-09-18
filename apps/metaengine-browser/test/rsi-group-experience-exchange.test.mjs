import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiExperienceLesson,
} from '../src/rsi-open-ended-search-policy.mjs';
import {
  RSI_COMPONENT_ATTRIBUTION_RECORD_SCHEMA,
} from '../src/rsi-component-attribution.mjs';
import {
  createRsiGroupMember,
  verifyRsiGroupMember,
  createRsiGroupExperiencePool,
  verifyRsiGroupExperiencePool,
  createRsiGroupTransferPlan,
  verifyRsiGroupTransferPlan,
  createRsiGroupTransferReceipt,
  verifyRsiGroupTransferReceipt,
  finalizeRsiGroupTransfer,
  rsiGroupExperienceTrustRootSnapshot,
} from '../src/rsi-group-experience-exchange.mjs';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

const sha = (char) => char.repeat(40);
const d = (char) => `sha256:${char.repeat(64)}`;
const candidateId = (char) => `candidate_sha256_${char.repeat(64)}`;

function member(char, overrides = {}) {
  return createRsiGroupMember({
    member_id: `member.${char}`,
    candidate_id: candidateId(char),
    candidate_sha: sha(char),
    mutation_surface: char === '3' ? 'AGENT_ORCHESTRATION' : 'BROWSER_RUNTIME',
    model_family: char === '1' ? 'GPT_5_6_SOL' : char === '2' ? 'GLM_5' : 'GPT_5_6_SOL',
    environment_family: char === '3' ? 'LINUX_SANDBOX' : 'WINDOWS_BROWSER',
    lineage_id: `lineage.${char}`,
    archive_generation: Number(char) + 10,
    external_identity_verified: true,
    authored_by_candidate: false,
    ...overrides,
  });
}

function lesson(char, failureClass, mechanismTag, family) {
  return createRsiExperienceLesson({
    source_candidate_id: candidateId(char),
    source_candidate_sha: sha(char),
    mutation_surface: char === '3' ? 'AGENT_ORCHESTRATION' : 'BROWSER_RUNTIME',
    failure_class: failureClass,
    mechanism_tags: [mechanismTag],
    challenge_families: [family],
    recommendation_codes: ['PRESERVE_EXTERNAL_EVIDENCE'],
    evidence_digest: d(char),
    evidence_refs: [`RUN_${char}`],
    external_verifier: true,
    authored_by_candidate: false,
  });
}

function attributionRecord(char = '1') {
  const core = {
    schema: RSI_COMPONENT_ATTRIBUTION_RECORD_SCHEMA,
    version: 1,
    candidate_id: candidateId(char),
    candidate_sha: sha(char),
    parent_sha: sha('0'),
    mutation_surface: 'BROWSER_RUNTIME',
    component_path: 'apps/metaengine-browser/src/command-fastlane.mjs',
    component_digest: d('a'),
    component_change: 'MODIFY',
    ablation_id: 'rsi_ablation_aaaaaaaaaaaaaaaaaaaaaaaa',
    ablated_candidate_sha: sha('9'),
    classification: 'CONTRIBUTING',
    safety_critical_invariants: [],
    objective_effects: [
      {
        metric: 'command_latency_ms',
        direction: 'MINIMIZE',
        materiality_threshold: 1,
        full_candidate_value: 10,
        ablated_candidate_value: 15,
        signed_component_contribution: 5,
        status: 'BENEFICIAL',
      },
    ],
    interaction_resolution_required: false,
    receipt_digest: d('b'),
    workload_digest: d('c'),
    holdout_digest: d('d'),
    environment_fingerprint: 'windows-x64-browsercell-v1',
    paired_seed_schedule_digest: d('e'),
    externally_attributed: true,
    authored_by_candidate: false,
    freeform_narrative_in_memory: false,
    causal_claim_scope: 'MATCHED_SINGLE_COMPONENT_ABLATION',
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, attribution_digest: digest(core) });
}

function pool() {
  return createRsiGroupExperiencePool({
    group_id: 'group.rsi.browser.1',
    members: [member('1'), member('2'), member('3')],
    attribution_records: [attributionRecord('1')],
    experience_lessons: [
      lesson('2', 'TRANSPORT_AMBIGUITY', 'RESULT_READBACK', 'COMMAND_LIVENESS'),
      lesson('3', 'GENERALIZATION_FAILURE', 'CROSS_MODEL_TRANSFER', 'AGENT_DESIGN'),
    ],
  });
}

function target() {
  return {
    target_id: 'target.candidate.8',
    candidate_id: candidateId('8'),
    candidate_sha: sha('8'),
    mutation_surface: 'BROWSER_RUNTIME',
    model_family: 'GPT_5_6_SOL',
    environment_family: 'WINDOWS_BROWSER',
    context_tags: ['RESULT_READBACK', 'COMMAND_LIVENESS'],
    external_identity_verified: true,
    authored_by_candidate: false,
  };
}

test('group member identity is external, typed and strips raw transcript/page/user channels', () => {
  const row = member('1');
  verifyRsiGroupMember(row);
  assert.equal(row.external_identity_verified, true);
  assert.equal(row.authored_by_candidate, false);
  assert.equal(row.raw_model_transcript_shared, false);
  assert.equal(row.raw_page_text_shared, false);
  assert.equal(row.raw_user_input_shared, false);
  assert.equal(row.secret_material_shared, false);
  assert.equal(row.candidate_can_edit_group_identity, false);
  assert.equal(row.authority_effect, false);

  assert.throws(() => createRsiGroupMember({
    member_id: 'member.bad',
    candidate_id: candidateId('4'),
    candidate_sha: sha('4'),
    mutation_surface: 'BROWSER_RUNTIME',
    model_family: 'GPT_5_6_SOL',
    environment_family: 'WINDOWS_BROWSER',
    lineage_id: 'lineage.bad',
    archive_generation: 1,
    external_identity_verified: false,
    authored_by_candidate: true,
  }), /external_origin_required/);
});

test('group pool shares only verified structured attribution/lesson evidence and never assumes portability', () => {
  const row = pool();
  verifyRsiGroupExperiencePool(row);
  assert.equal(row.group_is_evolutionary_unit, true);
  assert.equal(row.explicit_experience_sharing, true);
  assert.equal(row.member_count, 3);
  assert.equal(row.item_count, 3);
  assert.equal(new Set(row.items.map((item) => item.source_member_id)).size, 3);
  assert.equal(row.cross_branch_transfer_requires_external_validation, true);
  assert.equal(row.source_context_truth_not_assumed_portable, true);
  for (const item of row.items) {
    assert.equal(item.trusted_in_source_context, true);
    assert.equal(item.portable_to_other_context_without_validation, false);
    assert.equal(item.candidate_can_mark_portable, false);
    assert.equal(item.freeform_text_shared, false);
    assert.equal(item.raw_model_transcript_shared, false);
    assert.equal(item.raw_page_text_shared, false);
    assert.equal(item.raw_user_input_shared, false);
    assert.equal(item.secret_material_shared, false);
    assert.equal(item.authority_effect, false);
  }
});

test('experience from unknown candidate cannot enter the group pool', () => {
  assert.throws(() => createRsiGroupExperiencePool({
    group_id: 'group.rsi.bad',
    members: [member('1'), member('2')],
    experience_lessons: [
      lesson('3', 'GENERALIZATION_FAILURE', 'CROSS_MODEL_TRANSFER', 'AGENT_DESIGN'),
    ],
  }), /member_binding_mismatch/);
});

test('transfer plan uses diversity-first sources and keeps every item proposed until external target validation', () => {
  const group = pool();
  const plan = createRsiGroupTransferPlan({
    pool: group,
    target: target(),
    max_items: 3,
    max_items_per_source: 1,
  });
  verifyRsiGroupTransferPlan(plan, group);
  assert.equal(plan.selected_item_count, 3);
  assert.equal(plan.selected_source_count, 3);
  assert.equal(plan.diversity_first_source_round, true);
  assert.equal(plan.external_transfer_validation_required, true);
  assert.equal(plan.target_candidate_can_select_sources, false);
  assert.equal(plan.target_candidate_can_activate_transfer, false);
  for (const item of plan.selected_items) {
    assert.equal(item.transfer_state, 'PROPOSED_EXTERNAL_VALIDATION');
    assert.equal(item.candidate_can_activate_transfer, false);
    assert.equal(item.portable_for_target_search, false);
  }
  assert.equal(
    plan.selected_items.some((item) => item.source_model_family === 'GLM_5' && item.cross_model_transfer === true),
    true,
    'cross-model group experience remains available as a transfer hypothesis',
  );
});

test('positive transfer needs target hard-invariant pass and verified benefit', () => {
  const group = pool();
  const plan = createRsiGroupTransferPlan({ pool: group, target: target(), max_items: 2 });
  const item = plan.selected_items[0];

  assert.throws(() => createRsiGroupTransferReceipt({
    plan,
    pool: group,
    item_id: item.item_id,
    outcome: 'TRANSFER_VERIFIED',
    target_holdout_digest: d('5'),
    evaluator_root_digest: d('6'),
    target_hard_invariants_pass: false,
    net_benefit_verified: true,
    measured_delta: 0.1,
    evidence_refs: ['TARGET_RUN_1'],
    external_transfer_evaluator: true,
    authored_by_candidate: false,
  }), /positive_proof_invalid/);

  const receipt = createRsiGroupTransferReceipt({
    plan,
    pool: group,
    item_id: item.item_id,
    outcome: 'TRANSFER_VERIFIED',
    target_holdout_digest: d('5'),
    evaluator_root_digest: d('6'),
    target_hard_invariants_pass: true,
    net_benefit_verified: true,
    measured_delta: 0.1,
    evidence_refs: ['TARGET_RUN_2', 'TARGET_HOLDOUT_2'],
    external_transfer_evaluator: true,
    authored_by_candidate: false,
  });
  verifyRsiGroupTransferReceipt(receipt, plan, group);
  assert.equal(receipt.external_transfer_evaluator, true);
  assert.equal(receipt.authored_by_candidate, false);
  assert.equal(receipt.target_candidate_can_self_certify_transfer, false);
  assert.equal(receipt.authority_effect, false);
});

test('candidate cannot self-certify cross-branch experience transfer', () => {
  const group = pool();
  const plan = createRsiGroupTransferPlan({ pool: group, target: target(), max_items: 1 });
  const item = plan.selected_items[0];
  assert.throws(() => createRsiGroupTransferReceipt({
    plan,
    pool: group,
    item_id: item.item_id,
    outcome: 'TRANSFER_VERIFIED',
    target_holdout_digest: d('5'),
    evaluator_root_digest: d('6'),
    target_hard_invariants_pass: true,
    net_benefit_verified: true,
    measured_delta: 0.2,
    evidence_refs: ['MODEL_SELF_REPORT'],
    external_transfer_evaluator: false,
    authored_by_candidate: true,
  }), /external_origin_required/);
});

test('final result preserves positive, negative and uncertain transfer evidence without converting any into authority', () => {
  const group = pool();
  const plan = createRsiGroupTransferPlan({
    pool: group,
    target: target(),
    max_items: 3,
    max_items_per_source: 1,
  });
  const outcomes = ['TRANSFER_VERIFIED', 'NEGATIVE_TRANSFER', 'INSUFFICIENT_EVIDENCE'];
  const receipts = plan.selected_items.map((item, index) => createRsiGroupTransferReceipt({
    plan,
    pool: group,
    item_id: item.item_id,
    outcome: outcomes[index],
    target_holdout_digest: d(String(index + 4)),
    evaluator_root_digest: d('f'),
    target_hard_invariants_pass: outcomes[index] !== 'NEGATIVE_TRANSFER',
    net_benefit_verified: outcomes[index] === 'TRANSFER_VERIFIED',
    measured_delta: outcomes[index] === 'TRANSFER_VERIFIED' ? 0.12 : outcomes[index] === 'NEGATIVE_TRANSFER' ? -0.08 : 0,
    evidence_refs: [`TARGET_RUN_${index + 10}`],
    external_transfer_evaluator: true,
    authored_by_candidate: false,
  }));
  const result = finalizeRsiGroupTransfer({ plan, pool: group, receipts });
  assert.equal(result.verified_transfer_count, 1);
  assert.equal(result.negative_transfer_count, 1);
  assert.equal(result.insufficient_evidence_count, 1);
  assert.equal(result.all_selected_items_evaluated, true);
  assert.equal(result.target_search_may_consume_verified_transfers_only, true);
  assert.equal(result.negative_transfer_is_memory_not_authority, true);
  assert.equal(result.group_experience_is_promotion_authority, false);
  assert.equal(result.authority_effect, false);

  const positive = result.records.find((row) => row.transfer_outcome === 'TRANSFER_VERIFIED');
  const negative = result.records.find((row) => row.transfer_outcome === 'NEGATIVE_TRANSFER');
  assert.equal(positive.portable_for_target_search, true);
  assert.equal(negative.portable_for_target_search, false);
  assert.equal(negative.negative_transfer_memory, true);
});

test('group experience trust root preserves transfer validation and source diversity fences', () => {
  const root = rsiGroupExperienceTrustRootSnapshot();
  assert.equal(root.group_is_evolutionary_unit, true);
  assert.equal(root.explicit_experience_sharing, true);
  assert.equal(root.cross_branch_transfer_requires_external_validation, true);
  assert.equal(root.source_context_truth_not_assumed_portable, true);
  assert.equal(root.diversity_first_source_round, true);
  assert.equal(root.target_candidate_can_select_sources, false);
  assert.equal(root.target_candidate_can_self_certify_transfer, false);
  assert.equal(root.raw_model_transcript_shared, false);
  assert.equal(root.group_experience_is_promotion_authority, false);
  assert.equal(root.execution_authority, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.group_root_digest, /^sha256:[0-9a-f]{64}$/);
});
