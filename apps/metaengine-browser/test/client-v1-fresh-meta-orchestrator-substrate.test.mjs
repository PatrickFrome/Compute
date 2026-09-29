import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(
  new URL('../../../supabase/migrations/20260929133000_client_v1_fresh_meta_orchestrator_substrate_v1.sql', import.meta.url),
  'utf8',
);

test('fresh Client V1 project gets only the semantic plan/admission substrate', () => {
  for (const pattern of [
    /metaengine_devos_roadmap_authority_h205f22/,
    /meta_orchestrator_plan_state_h205f22/,
    /meta_orchestrator_plan_activate_v1/,
    /meta_orchestrator_plan_snapshot_v1/,
    /meta_orchestrator_authoritative_inputs_v1/,
    /meta_orchestrator_task_admit_v1/,
    /meta_orchestrator_frontier_admit_v1/,
    /devos_fleet_capacity_snapshot_v1/,
    /devos_fleet_enqueue_v1/,
  ]) assert.match(sql, pattern);

  assert.doesNotMatch(sql, /me2_event_mirror|legacy socket|mission control/i);
  assert.doesNotMatch(sql, /setInterval|setTimeout|pg_cron|cron\.schedule/i);
  assert.doesNotMatch(sql, /TYPED_CLICK|SEMANTIC_TYPE|PRESS_KEY|CAPTURE_VIEW/);
});

test('roadmap authority and plan state remain zero-authority and fail closed', () => {
  for (const pattern of [
    /authority_effect boolean not null default false/,
    /scheduler_authority boolean not null default false/,
    /browser_authority boolean not null default false/,
    /release_authority boolean not null default false/,
    /automatic_retry_allowed boolean not null default false/,
    /meta_plan_roadmap_authority_missing/,
    /meta_plan_roadmap_authority_drift/,
    /meta_plan_generation_fenced/,
    /meta_plan_scheduler_identity_forbidden/,
  ]) assert.match(sql, pattern);

  assert.doesNotMatch(sql, /scheduler_authority\s*=\s*true/i);
  assert.doesNotMatch(sql, /browser_authority\s*=\s*true/i);
  assert.doesNotMatch(sql, /release_authority\s*=\s*true/i);
  assert.doesNotMatch(sql, /automatic_retry_allowed\s*=\s*true/i);
});

test('fresh authoritative input projection does not import legacy roadmap receipt history', () => {
  assert.match(sql, /'roadmap_receipts','\[\]'::jsonb/);
  assert.doesNotMatch(sql, /from\s+destruktion_meta\.compute_fabric_roadmap_step_receipt_h205f22/i);
  assert.match(sql, /task_meta_projection_only',true/);
  assert.match(sql, /task_payload_exposed',false/);
  assert.match(sql, /scheduler_identity_exposed',false/);
});

test('task admission reconstructs canonical content and reuses the one existing scheduler ingress', () => {
  assert.match(sql, /select \* into v_plan[\s\S]*meta_orchestrator_plan_state_h205f22/);
  assert.match(sql, /select n\.value into v_node[\s\S]*jsonb_array_elements/);
  assert.match(sql, /v_enqueue := public\.devos_fleet_enqueue_v1\(/);
  assert.match(sql, /scheduler_identity_returned',false/);
  assert.doesNotMatch(sql, /devos_fleet_lease_v1\s*\(/i);
  assert.doesNotMatch(sql, /devos_fleet_mark_running_v1\s*\(/i);
  assert.doesNotMatch(sql, /devos_fleet_complete_v1\s*\(/i);
});
