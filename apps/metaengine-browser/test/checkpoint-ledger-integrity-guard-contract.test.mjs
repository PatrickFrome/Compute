import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const migration = fs.readFileSync(
  path.join(repoRoot, 'supabase/migrations/20260914001000_checkpoint_ledger_integrity_guard_v1.sql'),
  'utf8',
);

test('checkpoint ledger verifies the sealed state hash on every new row', () => {
  assert.match(migration, /create or replace function destruktion_meta\.checkpoint_ledger_integrity_guard_v1\(\)/i);
  assert.match(migration, /if tg_op = 'INSERT'/i);
  assert.match(migration, /extensions\.digest\(new\.state::text,'sha256'::text\)/i);
  assert.match(migration, /new\.state_hash is distinct from v_expected_hash/i);
  assert.match(migration, /checkpoint_ledger_state_hash_mismatch/);
  assert.match(migration, /errcode='23514'/);
  assert.match(migration, /before insert on destruktion_meta\.checkpoint_ledger/i);
});

test('checkpoint ledger is append-only without rewriting historical mismatches', () => {
  assert.match(migration, /before update or delete on destruktion_meta\.checkpoint_ledger/i);
  assert.match(migration, /checkpoint ledger is append-only/i);
  assert.match(migration, /errcode='55000'/);
  assert.match(migration, /Historical rows are never rewritten/i);
  assert.doesNotMatch(migration, /update\s+destruktion_meta\.checkpoint_ledger\s+set/i);
  assert.doesNotMatch(migration, /delete\s+from\s+destruktion_meta\.checkpoint_ledger/i);
  assert.doesNotMatch(migration, /validate\s+constraint/i);
});

test('ledger integrity trigger function is not an application callable authority', () => {
  assert.match(migration, /security invoker/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /revoke all on function destruktion_meta\.checkpoint_ledger_integrity_guard_v1\(\) from public/i);
  assert.match(migration, /from anon/i);
  assert.match(migration, /from authenticated/i);
});
