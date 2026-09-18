import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  here,
  '../../../supabase/migrations/20260918150000_devos_transport_promotion_json_null_admission_fix_v1.sql',
);
const sql = readFileSync(migrationPath, 'utf8');
const executableSql = sql.replace(/--.*$/gm, '');

test('promotion repair accepts only an explicitly present JSON-null transport proof before promotion', () => {
  assert.match(sql, /not \(v_agent \? 'transport_proof'\)/i,
    'missing transport_proof key must remain fail-closed');
  assert.match(sql, /jsonb_typeof\(v_agent->'transport_proof'\) <> 'null'/i,
    'explicit JSON null must be distinguished from a non-null proof');
  assert.doesNotMatch(executableSql, /v_agent->'transport_proof'\s+is\s+not\s+null/i,
    'SQL NULL semantics must not be used for JSON null in executable SQL');
});

test('promotion repair preserves exact binding and authority fences', () => {
  assert.match(sql, /v_agent->>'ownership'<>'FLEET_OWNED'/i);
  assert.match(sql, /v_agent->>'lifecycle_state'<>'BOUND_UNVERIFIED'/i);
  assert.match(sql, /v_agent->>'tab_id'<>v_tab_id/i);
  assert.match(sql, /lower\(coalesce\(v_agent->>'target_id',''\)\)<>v_target_id/i);
  assert.match(sql, /generation_epoch'\)::bigint,0\)<>v_epoch/i);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('devos-transport-promotion:'/i);
  assert.match(sql, /devos_transport_promotion_supervisor_state_stale/i);
  assert.match(sql, /devos_transport_promotion_holder_registry_missing/i);
  assert.match(sql, /automatic_retry_allowed',false/i);
  assert.match(sql, /authority_effect',false/i);
});

test('repair stays in the existing promotion authority plane', () => {
  assert.match(sql, /create or replace function public\.devos_fleet_transport_promotion_lease_v1/i);
  assert.match(sql, /create or replace function public\.devos_fleet_transport_promotion_release_v1/i);
  assert.match(sql, /grant execute on function public\.devos_fleet_transport_promotion_lease_v1[^\n]+to service_role/i);
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function\s+public\.devos_fleet_(?:enqueue|scheduler|lease)_v2/i);
  assert.doesNotMatch(sql, /\beval\b|copy\s+.*program/i);
});
