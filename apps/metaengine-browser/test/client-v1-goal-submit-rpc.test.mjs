import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(
  new URL('../../../supabase/migrations/20260929134500_client_v1_goal_submit_v1.sql', import.meta.url),
  'utf8',
);

test('Client V1 goal submission is one transaction over plan activation plus canonical admission', () => {
  assert.match(sql, /client_v1_goal_submit_v1/);
  assert.match(sql, /meta_orchestrator_plan_activate_v1\(/);
  assert.match(sql, /meta_orchestrator_task_admit_v1\(/);
  assert.match(sql, /atomic_plan_and_admission',true/);
  assert.match(sql, /task_payload_returned',false/);
  assert.match(sql, /scheduler_identity_returned',false/);
  assert.match(sql, /automatic_retry_allowed',false/);
  assert.match(sql, /scheduler_authority',false/);
  assert.match(sql, /browser_authority',false/);
  assert.match(sql, /release_authority',false/);
  assert.match(sql, /authority_effect',false/);
});

test('typed goal RPC accepts only one dependency-free Client V1 point', () => {
  assert.match(sql, /v_roadmap_id <> 'metaengine-client-v1'/);
  assert.match(sql, /jsonb_array_length\(v_nodes\) <> 1/);
  assert.match(sql, /jsonb_array_length\(coalesce\(v_node->'dependencies','\[\]'::jsonb\)\) <> 0/);
  assert.match(sql, /lower\(coalesce\(v_node->>'point_id',''\)\) <> v_point_id/);
});

test('typed goal RPC owns no scheduler loop, lease or Browser effect', () => {
  for (const forbidden of [
    /devos_fleet_lease_v1\s*\(/i,
    /devos_fleet_mark_running_v1\s*\(/i,
    /devos_fleet_complete_v1\s*\(/i,
    /TYPED_CLICK|SEMANTIC_TYPE|PRESS_KEY|CAPTURE_VIEW/,
    /setInterval|setTimeout|pg_cron|cron\.schedule/i,
  ]) assert.doesNotMatch(sql, forbidden);
});
