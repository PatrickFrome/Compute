import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = 'supabase/migrations/20260830085500_a2_supervisor_mesh_rls_hardening_v1.sql';
const sql = fs.readFileSync(path, 'utf8').toLowerCase();

for (const table of [
  'compute_fabric_a2_supervisor_mesh_instance_h205f22',
  'compute_fabric_a2_supervisor_actuation_lease_h205f22',
]) {
  assert.match(sql, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 's'));
  assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+anon,\\s*authenticated`, 's'));
}

assert.doesNotMatch(sql, /create\s+policy/i, 'hardening must remain fail-closed unless an explicit policy is separately reviewed');
assert.match(sql, /security definer/i, 'migration rationale must preserve trusted server-side RPC boundary');
assert.match(sql, /direct anon\/authenticated table access is forbidden/i);

console.log(JSON.stringify({
  ok: true,
  contract: 'A2_SUPERVISOR_MESH_RLS_HARDENING_V1',
  rls_tables: 2,
  direct_client_access: false,
  authority_effect: false,
}));
