import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const sql = await fs.readFile(
  new URL('../../../supabase/migrations/20260918170000_rsi_runtime_frontier_advisory_intake_v1.sql', import.meta.url),
  'utf8',
);
const edge = await fs.readFile(
  new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url),
  'utf8',
);

test('RSI frontier intake uses the existing DevOS scheduler and advisory Planner role only', () => {
  assert.match(sql, /public\.devos_fleet_enqueue_v1\(/);
  assert.match(sql, /'PLANNER'/);
  assert.doesNotMatch(sql, /'IMPLEMENTER'/);
  assert.match(sql, /'candidate_materialization_allowed',false/);
  assert.match(sql, /'implementation_dispatch_allowed',false/);
  assert.match(sql, /'existing_devos_scheduler_only',true/);
  assert.match(sql, /'can_promote_production',false/);
  assert.match(sql, /'can_direct_browser_effects',false/);
  assert.match(sql, /'automatic_retry_after_ambiguous_effect',false/);
});

test('RSI frontier intake validates exact source and bounded zero-authority envelopes', () => {
  assert.match(sql, /v_source_sha !~ '\^\[0-9a-f\]\{40\}\$'/);
  assert.match(sql, /jsonb_array_length\(v_frontier\) > 4/);
  assert.match(sql, /frontier_count/);
  assert.match(sql, /v_active_reviews >= 16/);
  assert.match(sql, /browser_can_enqueue_devos_tasks/);
  assert.match(sql, /direct_execution_enabled/);
  assert.match(sql, /direct_promotion_enabled/);
  assert.match(sql, /direct_self_update_enabled/);
  assert.match(sql, /requires_independent_evaluator/);
  assert.match(sql, /candidate_can_modify_acceptance_contract/);
  assert.match(sql, /paired_parent_candidate_required/);
  assert.match(sql, /holdout_required/);
  assert.match(sql, /no_optional_stopping/);
  assert.match(sql, /scalar_reward_authoritative/);
  assert.match(sql, /candidate_authored_receipts_allowed/);
  assert.match(sql, /command_created/);
  assert.match(sql, /automatic_retry_allowed/);
});

test('RSI frontier intake is service-role only and the state route remains the only ingress', () => {
  assert.match(sql, /revoke all on function public\.h205f22_rsi_runtime_frontier_intake_v1\(uuid,text,jsonb\) from authenticated/);
  assert.match(sql, /grant execute on function public\.h205f22_rsi_runtime_frontier_intake_v1\(uuid,text,jsonb\) to service_role/);
  assert.match(edge, /path==='\/v1\/state'/);
  assert.match(edge, /rsiFrontierIntake\(\{workspaceId:WORKSPACE_ID,clientId:id,state:body\?\.state\}\)/);
  assert.doesNotMatch(edge, /path==='\/v1\/rsi/);
});


test('RSI frontier intake binds opportunity, observation, signal and mutation surface across all envelopes', () => {
  assert.match(sql, /v_hypothesis ->> 'opportunity_id'/);
  assert.match(sql, /v_entry ->> 'observation_digest'/);
  assert.match(sql, /task_spec,rsi,observation_digest/);
  assert.match(sql, /v_entry ->> 'signal'/);
  assert.match(sql, /task_spec,rsi,signal/);
  assert.match(sql, /v_entry ->> 'mutation_surface'/);
  assert.match(sql, /task_spec,rsi,mutation_surface/);
});
