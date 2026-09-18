import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const migrationPath = path.join(root, 'supabase/migrations/20260901043000_devos_control_supervisor_authority_repair_v1.sql');

async function sql() { return fs.readFile(migrationPath, 'utf8'); }

test('CONTROL supervisor authority is mode+arming+freshness, not row authority_effect=false', async () => {
  const text = await sql();
  assert.match(text, /create or replace function public\.devos_control_supervisor_snapshot_v1/i);
  assert.match(text, /s\.supervisor_mode='CONTROL'/);
  assert.match(text, /s\.armed=true/);
  assert.match(text, /metaengine\.native-browser-supervisor\.state\.v1/);
  assert.match(text, /metaengine\.browser\.fleet-snapshot\.v1/);
  assert.match(text, /TRANSPORT_PROOF_REQUIRED/);
  assert.match(text, /make_interval\(secs=>v_horizon\)/);
  assert.doesNotMatch(text, /\bs\.authority_effect\s*=\s*false\b/i);
});

test('task claim admission serializes with promotion and re-reads CONTROL authority after the lock', async () => {
  const text = await sql();
  assert.match(text, /create or replace function destruktion_meta\.devos_fleet_claim_transport_admission_h205f22\(\)/i);
  assert.match(text, /pg_advisory_xact_lock\(/);
  assert.match(text, /devos-transport-promotion:/);
  const calls = [...text.matchAll(/devos_control_supervisor_snapshot_v1\(new\.workspace_id[^\n;]*/g)].map((m) => m[0]);
  assert.equal(calls.length, 2, 'claim admission must read authority before and after the shared lock');
  assert.match(calls[0], /null,45/);
  assert.match(calls[1], /v_client_id,45/);
  assert.match(text, /devos_transport_client_actuation_lease_active/);
  assert.match(text, /lifecycle_state'<>'ACTIVE'/);
  assert.match(text, /metaengine\.browser\.fleet-transport-proof\.v1/);
  assert.match(text, /conversation_url_sha256/);
});

test('capacity projection uses the same fresh CONTROL helper and remains read-only scheduler evidence', async () => {
  const text = await sql();
  assert.match(text, /create or replace function public\.devos_fleet_capacity_snapshot_v1\(p_workspace uuid\)/i);
  assert.match(text, /devos_control_supervisor_snapshot_v1\(p_workspace,null,45\)/);
  assert.match(text, /'new_frontier_slots'/);
  assert.match(text, /'RECOVERY_DEBT_HIGH'/);
  assert.match(text, /'READY_SATURATED'/);
  assert.match(text, /'automatic_retry_allowed',false/);
  assert.match(text, /'authority_effect',false/);
  assert.doesNotMatch(text, /devos_fleet_lease_v1\s*\(/i);
  assert.doesNotMatch(text, /devos_fleet_enqueue_v1\s*\(/i);
});
