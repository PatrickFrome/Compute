import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sqlPath = path.resolve('supabase/command-fabric-terminal-broadcast-v1.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

test('terminal broadcast contract is rollback-only and cannot deploy by file placement', () => {
  assert.match(sql, /Rollback-only/i);
  assert.match(sql, /\bbegin\s*;/i);
  assert.match(sql, /\brollback\s*;/i);
  assert.equal(sqlPath.includes(`${path.sep}supabase${path.sep}migrations${path.sep}`), false);
});

test('terminal broadcast uses only live command-table terminal state', () => {
  for (const status of ['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED']) {
    assert.match(sql, new RegExp(`'${status}'`, 'i'));
  }
  assert.match(sql, /new\.command_id/i);
  assert.match(sql, /new\.completed_at/i);
  assert.match(sql, /new\.effect_binding_sha256/i);
  assert.doesNotMatch(sql, /receipt_version/i);
  assert.doesNotMatch(sql, /new\.receipt\b/i);
});

test('terminal broadcast is advisory private wake only', () => {
  assert.match(sql, /'COMMAND_TERMINAL'/i);
  assert.match(sql, /'metaengine-control:'/i);
  assert.match(sql, /realtime\.send\([\s\S]*true\s*\)/i);
  assert.match(sql, /'transport_delivery_is_authority',\s*false/i);
  assert.match(sql, /'authority_effect',\s*false/i);
});

test('terminal broadcast suppresses duplicate and terminal-to-terminal hints', () => {
  assert.match(sql, /old\.status\s*=\s*new\.status/i);
  assert.match(sql, /old\.status\s+in\s*\('COMPLETED','FAILED','EXPIRED','CANCELLED'\)/i);
  assert.match(sql, /old\.status\s+is\s+distinct\s+from\s+new\.status/i);
});

test('terminal trigger function is not exposed to public roles', () => {
  assert.match(sql, /revoke all on function[^;]+from public;/i);
  assert.match(sql, /revoke all on function[^;]+from anon;/i);
  assert.match(sql, /revoke all on function[^;]+from authenticated;/i);
  assert.match(sql, /grant execute on function[^;]+to service_role;/i);
});
