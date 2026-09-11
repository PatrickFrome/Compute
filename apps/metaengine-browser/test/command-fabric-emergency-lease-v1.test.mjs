import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sqlPath = path.resolve('supabase/command-fabric-lease-emergency-v1.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

test('emergency lease contract is rollback-only and cannot deploy by file placement', () => {
  assert.match(sql, /Intentionally rollback-only/i);
  assert.match(sql, /\bbegin\s*;/i);
  assert.match(sql, /\brollback\s*;/i);
  assert.equal(sqlPath.includes(`${path.sep}supabase${path.sep}migrations${path.sep}`), false);
});

test('emergency lease can select only DISARM or supervisor OFF', () => {
  assert.match(sql, /c\.command_lane\s*=\s*'EMERGENCY'/i);
  assert.match(sql, /c\.action\s*=\s*'DISARM'/i);
  assert.match(sql, /c\.action\s*=\s*'SET_SUPERVISOR_MODE'/i);
  assert.match(sql, /upper\(coalesce\(c\.payload->>'mode',\s*''\)\)\s*=\s*'OFF'/i);
  assert.doesNotMatch(sql, /c\.action\s*=\s*'ARM'/i);
  assert.doesNotMatch(sql, /c\.action\s*=\s*'NAVIGATE'/i);
});

test('emergency lease does not inherit the general leased-mutation blocker', () => {
  assert.doesNotMatch(sql, /v_has_leased_mutation/i);
  assert.doesNotMatch(sql, /v_has_leased_exclusive/i);
  assert.match(sql, /general_mutation_lease_blocks_emergency',\s*false/i);
  assert.match(sql, /for update of c skip locked/i);
  assert.match(sql, /status\s*=\s*'LEASED'/i);
  assert.match(sql, /target_client_id is null or c\.target_client_id = v_client/i);
});

test('emergency lease is fail-closed, one-at-a-time and never claims transport authority', () => {
  assert.match(sql, /limit 1\s+for update of c skip locked/i);
  assert.match(sql, /automatic_retry_allowed',\s*false/i);
  assert.match(sql, /transport_delivery_is_authority',\s*false/i);
  assert.match(sql, /authority_effect',\s*false/i);
});

test('emergency lease RPC is service-role only', () => {
  assert.match(sql, /revoke all on function[^;]+from public;/i);
  assert.match(sql, /revoke all on function[^;]+from anon;/i);
  assert.match(sql, /revoke all on function[^;]+from authenticated;/i);
  assert.match(sql, /grant execute on function[^;]+to service_role;/i);
});
