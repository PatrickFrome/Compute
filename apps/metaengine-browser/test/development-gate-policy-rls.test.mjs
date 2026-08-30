import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const migrationPath = path.join(repoRoot, 'supabase/migrations/20260830164500_h205f22_development_gate_policy_rls_v1.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

test('development gate policy storage is fail-closed behind RLS', () => {
  assert.match(sql, /alter\s+table\s+public\.compute_fabric_development_gate_policy_h205f22\s+enable\s+row\s+level\s+security/i);
  assert.match(sql, /revoke\s+all\s+on\s+table\s+public\.compute_fabric_development_gate_policy_h205f22\s+from\s+anon/i);
  assert.match(sql, /revoke\s+all\s+on\s+table\s+public\.compute_fabric_development_gate_policy_h205f22\s+from\s+authenticated/i);
  assert.doesNotMatch(sql, /create\s+policy/i, 'no permissive client policy may be introduced');
});

test('authoritative SECURITY DEFINER policy readback is not executable by client roles', () => {
  assert.match(sql, /revoke\s+execute\s+on\s+function\s+public\.h205f22_development_gate_policy_v1\(\)\s+from\s+public/i);
  assert.match(sql, /revoke\s+execute\s+on\s+function\s+public\.h205f22_development_gate_policy_v1\(\)\s+from\s+anon/i);
  assert.match(sql, /revoke\s+execute\s+on\s+function\s+public\.h205f22_development_gate_policy_v1\(\)\s+from\s+authenticated/i);
});
