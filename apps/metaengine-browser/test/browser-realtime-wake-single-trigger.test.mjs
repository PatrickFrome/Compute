import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sourceSql = fs.readFileSync(new URL('../../../sql/browser_control_plane_realtime_wake_v1.sql', import.meta.url), 'utf8');
const migrationSql = fs.readFileSync(new URL('../../../supabase/migrations/20260906163500_browser_command_realtime_wake_single_trigger_v1.sql', import.meta.url), 'utf8');
const waiterSource = fs.readFileSync(new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url), 'utf8');
const wakeSource = fs.readFileSync(new URL('../supabase/a2-browser-native-supervisor-v1/realtime-command-wake.mjs', import.meta.url), 'utf8');

function assertSingleTriggerContract(sql) {
  assert.match(sql, /create or replace function public\.glm_browser_pulse_notify_v1\(\)/i);
  assert.match(sql, /pg_notify\(\s*'glm_browser_pulse'/i);
  assert.match(sql, /TG_TABLE_SCHEMA\s*=\s*'public'/i);
  assert.match(sql, /TG_TABLE_NAME\s*=\s*'compute_fabric_a2_browser_supervisor_command_h205f22'/i);
  assert.match(sql, /TG_OP\s*=\s*'INSERT'/i);
  assert.match(sql, /TG_OP\s*=\s*'UPDATE'/i);
  assert.match(sql, /v_status\s*=\s*'PENDING'/i);
  assert.match(sql, /v_old_status\s+is distinct from\s+v_status/i);
  assert.equal((sql.match(/realtime\.send\s*\(/gi) || []).length, 1);
  assert.match(sql, /'COMMAND_AVAILABLE'/);
  assert.match(sql, /format\('metaengine-control:%s:%s'/);
  assert.match(sql, /coalesce\(nullif\(btrim\(v_target\),\s*''\),\s*'all'\)/i);
  assert.match(sql, /'transport_delivery_is_authority',\s*false/i);
  assert.match(sql, /'authority_effect',\s*false/i);
  assert.match(sql, /'COMMAND_AVAILABLE',[\s\S]*?v_wake_target\),[\s\S]*?true\s*\)/i);
  assert.doesNotMatch(sql, /create\s+trigger\s+a2_browser_supervisor_command_realtime_wake_v1/i);
  assert.doesNotMatch(sql, /function\s+public\.h205f22_a2_browser_supervisor_command_realtime_wake_v1/i);
}

test('source proof and production migration reuse the canonical shared trigger boundary', () => {
  assertSingleTriggerContract(sourceSql);
  assertSingleTriggerContract(migrationSql);
});

test('wait-batch consumes exact or untargeted wake only as an advisory signal then re-leases DB state', () => {
  assert.match(waiterSource, /topics:\[realtimeTopic\(client\),realtimeAllTopic\(\)\]/);
  assert.match(waiterSource, /const afterSubscribe=await leaseBatch\(req,body\)/);
  assert.match(waiterSource, /const afterWake=await leaseBatch\(req,body\)/);
  assert.match(waiterSource, /transport_delivery_is_authority:false/);
  assert.match(wakeSource, /private:\s*true/);
  assert.match(wakeSource, /broadcast_received:\s*reason === 'BROADCAST'/);
  assert.match(wakeSource, /transport_delivery_is_authority:\s*false/);
});
