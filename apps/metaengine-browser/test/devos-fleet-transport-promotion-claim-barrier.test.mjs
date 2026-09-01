import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const barrierPath = resolve(
  here,
  '../../../supabase/migrations/20260901023000_devos_fleet_transport_promotion_claim_barrier_v1.sql',
);
const promotionPath = resolve(
  here,
  '../../../supabase/migrations/20260901014000_devos_fleet_transport_promotion_lease_v1.sql',
);
const sql = readFileSync(barrierPath, 'utf8');
const promotionSql = readFileSync(promotionPath, 'utf8');

function expectSql(pattern, message) {
  assert.match(sql, pattern, message);
}

test('claim barrier and promotion acquire serialize on the same workspace/client advisory lock', () => {
  const lockPrefix = /devos-transport-promotion:/i;
  assert.match(promotionSql, lockPrefix, 'promotion acquire lock namespace missing');
  expectSql(lockPrefix, 'claim barrier must use the same promotion lock namespace');
  expectSql(/select\s+s\.client_id\s*,\s*s\.state\s*,\s*s\.last_seen_at\s+into\s+v_client_id/i,
    'client identity must come from the authoritative supervisor row');
  expectSql(/hashtextextended\('devos-transport-promotion:'\|\|new\.workspace_id::text\|\|':'\|\|v_client_id\s*,\s*0\)/i);
});

test('expired Browser actuation authority is reconciled before claim admission', () => {
  expectSql(/update\s+public\.compute_fabric_a2_supervisor_actuation_lease_h205f22/i);
  expectSql(/effect_scope\s*=\s*'BROWSER_CLIENT_ACTUATION'/i);
  expectSql(/status\s*=\s*'ACTIVE'/i);
  expectSql(/expires_at\s*<=\s*v_now/i);
  expectSql(/status\s*=\s*'EXPIRED'/i);
  expectSql(/release_reason\s*=\s*'TTL_EXPIRED'/i);
});

test('non-expired Browser actuation authority blocks the enclosing task-claim transaction', () => {
  expectSql(/if\s+exists\s*\([\s\S]*compute_fabric_a2_supervisor_actuation_lease_h205f22/i);
  expectSql(/l\.workspace_id\s*=\s*new\.workspace_id/i);
  expectSql(/l\.target_client_id\s*=\s*v_client_id/i);
  expectSql(/l\.effect_scope\s*=\s*'BROWSER_CLIENT_ACTUATION'/i);
  expectSql(/l\.status\s*=\s*'ACTIVE'/i);
  expectSql(/l\.expires_at\s*>\s*v_now/i);
  expectSql(/devos_transport_client_actuation_lease_active/i);
});

test('barrier preserves exact ACTIVE transport-proof admission after mutual exclusion', () => {
  expectSql(/v_agent->>'lifecycle_state'\s*<>\s*'ACTIVE'/i);
  expectSql(/v_agent->>'role'\s*<>\s*new\.role/i);
  expectSql(/v_agent->>'tab_id'\s*<>\s*new\.tab_id/i);
  expectSql(/lower\(v_agent->>'target_id'\)\s*<>\s*lower\(new\.target_id\)/i);
  expectSql(/generation_epoch'\)::bigint,\s*0\)\s*<>\s*new\.agent_generation_epoch/i);
  expectSql(/metaengine\.browser\.fleet-transport-proof\.v1/i);
  expectSql(/devos_transport_proof_mismatch/i);
});

test('barrier remains inside the single existing claim admission plane', () => {
  expectSql(/create\s+or\s+replace\s+function\s+destruktion_meta\.devos_fleet_claim_transport_admission_h205f22\(\)/i);
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?devos_fleet_(?:lease|enqueue)_v\d+/i);
  assert.doesNotMatch(sql, /\beval\b|execute\s+format\s*\(|\bcopy\s+.*program\b/i);
  expectSql(/grant execute on function destruktion_meta\.devos_fleet_claim_transport_admission_h205f22\(\) to service_role/i);
});
