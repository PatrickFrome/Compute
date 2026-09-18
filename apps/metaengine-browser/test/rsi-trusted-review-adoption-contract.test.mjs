import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const intake = await fs.readFile(
  new URL('../../../supabase/migrations/20260918170000_rsi_runtime_frontier_advisory_intake_v1.sql', import.meta.url),
  'utf8',
);
const adoption = await fs.readFile(
  new URL('../../../supabase/migrations/20260918173000_rsi_trusted_review_adoption_v1.sql', import.meta.url),
  'utf8',
);
const edge = await fs.readFile(
  new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url),
  'utf8',
);

test('frontier review task precommits a typed result contract before any implementation dispatch',()=>{
  assert.match(intake,/required_result_schema','metaengine\.rsi\.frontier-review-result\.v1/);
  assert.match(intake,/external_reviewer_required',true/);
  assert.match(intake,/candidate_materialization_performed',false/);
  assert.match(intake,/implementation_dispatched',false/);
  assert.match(intake,/mutation_contract_required',true/);
});

test('trusted adoption accepts only COMPLETED advisory Planner review with exact result digest',()=>{
  assert.match(adoption,/v_task\.state <> 'COMPLETED'/);
  assert.match(adoption,/v_task\.role <> 'PLANNER'/);
  assert.match(adoption,/v_task\.claim_class <> 'ADVISORY'/);
  assert.match(adoption,/v_task\.result_sha256/);
  assert.match(adoption,/p_expected_result_sha256/);
  assert.match(adoption,/reviewed_by_external_agent/);
  assert.match(adoption,/authored_by_candidate/);
  assert.match(adoption,/review_is_execution_authority/);
});

test('trusted adoption cross-binds source, hypothesis, plan, mutation contract and target branch',()=>{
  assert.match(adoption,/v_review ->> 'hypothesis_digest' <> v_task\.task_spec ->> 'rsi_hypothesis_digest'/);
  assert.match(adoption,/v_review ->> 'plan_digest' <> v_task\.task_spec ->> 'rsi_plan_digest'/);
  assert.match(adoption,/mutation_contract,contract_digest/);
  assert.match(adoption,/external_scheduler_must_revalidate_current_source/);
  assert.match(adoption,/isolated_candidate_builder_required/);
  assert.match(adoption,/verification_sandbox_required/);
  assert.match(adoption,/benchmark_provenance_required/);
  assert.match(adoption,/evaluation_integrity_required/);
});

test('implementation uses only existing DevOS scheduler and cannot promote or self-update',()=>{
  assert.match(adoption,/public\.devos_fleet_enqueue_v1\(/);
  assert.match(adoption,/'IMPLEMENTER'/);
  assert.match(adoption,/'scheduler','DEVOS_EXISTING_ONLY'/);
  assert.match(adoption,/'production_promotion_authorized',false/);
  assert.match(adoption,/'self_update_authorized',false/);
  assert.match(adoption,/'automatic_retry_allowed',false/);
  assert.doesNotMatch(edge,/h205f22_rsi_adopt_frontier_review_v1/);
});

test('review adoption is service-role only and source-only migration does not expose browser ingress',()=>{
  assert.match(adoption,/revoke all on function public\.h205f22_rsi_adopt_frontier_review_v1\(uuid,text,jsonb\) from authenticated/);
  assert.match(adoption,/grant execute on function public\.h205f22_rsi_adopt_frontier_review_v1\(uuid,text,jsonb\) to service_role/);
  assert.doesNotMatch(edge,/\/v1\/rsi\/adopt|rsi_adopt_frontier_review/);
});
