import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  here,
  '../../../supabase/migrations/20260831184500_devos_fleet_transport_admission_v1.sql',
);
const sql = readFileSync(migrationPath, 'utf8');

function expectSql(pattern, message) {
  assert.match(sql, pattern, message);
}

test('admission augments the existing claim transaction instead of adding a scheduler', () => {
  expectSql(/before insert on destruktion_meta\.devos_fleet_claim_h205f22/i, 'claim admission trigger missing');
  expectSql(/execute function destruktion_meta\.devos_fleet_claim_transport_admission_h205f22\(\)/i);
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?devos_fleet_(?:lease|enqueue)_v\d+/i);
});

test('only a fresh native supervisor fleet snapshot can authorize claim creation', () => {
  expectSql(/s\.workspace_id\s*=\s*new\.workspace_id/i);
  expectSql(/s\.authority_effect\s*=\s*false/i);
  expectSql(/metaengine\.native-browser-supervisor\.state\.v1/i);
  expectSql(/metaengine\.browser\.fleet-snapshot\.v1/i);
  expectSql(/TRANSPORT_PROOF_REQUIRED/i);
  expectSql(/v_last_seen\s*<\s*clock_timestamp\(\)\s*-\s*interval\s*'45 seconds'/i);
  expectSql(/devos_transport_supervisor_snapshot_stale/i);
});

test('BOUND_UNVERIFIED and every other non-ACTIVE lifecycle fail closed', () => {
  expectSql(/v_agent->>'lifecycle_state'\s*<>\s*'ACTIVE'/i);
  expectSql(/devos_transport_agent_not_active/i);
  assert.doesNotMatch(sql, /lifecycle_state[^;\n]*BOUND_UNVERIFIED[^;\n]*ACTIVE/i);
});

test('claim identity is fenced to exact role tab target and agent generation', () => {
  expectSql(/lower\(a\.value->>'agent_id'\)\s*=\s*lower\(new\.agent_id\)/i);
  expectSql(/v_agent->>'role'\s*<>\s*new\.role/i);
  expectSql(/v_agent->>'tab_id'\s*<>\s*new\.tab_id/i);
  expectSql(/lower\(v_agent->>'target_id'\)\s*<>\s*lower\(new\.target_id\)/i);
  expectSql(/generation_epoch'\)::bigint,\s*0\)\s*<>\s*new\.agent_generation_epoch/i);
  expectSql(/devos_transport_agent_binding_mismatch/i);
});

test('ACTIVE still requires the exact C5 fleet transport proof', () => {
  expectSql(/metaengine\.browser\.fleet-transport-proof\.v1/i);
  expectSql(/v_proof->>'tab_id'\s*<>\s*new\.tab_id/i);
  expectSql(/lower\(v_proof->>'target_id'\)\s*<>\s*lower\(new\.target_id\)/i);
  expectSql(/v_proof->>'conversation_url_sha256'.*\^\[0-9a-f\]\{64\}\$/i);
  expectSql(/devos_transport_proof_mismatch/i);
  expectSql(/devos_transport_proof_time_in_future/i);
});

test('admission has no page/model execution surface and is service-role only', () => {
  expectSql(/revoke all on function destruktion_meta\.devos_fleet_claim_transport_admission_h205f22\(\) from public, anon, authenticated/i);
  expectSql(/grant execute on function destruktion_meta\.devos_fleet_claim_transport_admission_h205f22\(\) to service_role/i);
  assert.doesNotMatch(sql, /\beval\b|execute\s+format\s*\(|\bcopy\s+.*program\b/i);
});
