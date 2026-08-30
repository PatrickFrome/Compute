import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260830175500_h205f22_supervisor_rpc_acl_hardening_v1.sql', import.meta.url),
  'utf8',
).toLowerCase();

const effectFunctions = [
  'public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid, text, jsonb)',
  'public.h205f22_a2_browser_supervisor_continuity_trigger_v1()',
];

for (const fn of effectFunctions) {
  test(`effect-capable supervisor RPC is service-role only: ${fn}`, () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      assert.match(
        migration,
        new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+${fn.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s+from\\s+${role}\\s*;`),
      );
    }
    assert.match(
      migration,
      new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${fn.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s+to\\s+service_role\\s*;`),
    );
  });
}

test('zero-authority coordination read barrier remains available to authenticated agents only', () => {
  const fn = 'public.coordination_read_barrier_h205f22()';
  const escaped = fn.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');

  assert.match(migration, /alter\s+function\s+public\.coordination_read_barrier_h205f22\(\)\s+set\s+search_path\s*=\s*''\s*;/);
  assert.match(migration, new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+${escaped}\\s+from\\s+public\\s*;`));
  assert.match(migration, new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+${escaped}\\s+from\\s+anon\\s*;`));
  assert.match(migration, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${escaped}\\s+to\\s+authenticated\\s*;`));
  assert.match(migration, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${escaped}\\s+to\\s+service_role\\s*;`));
  assert.doesNotMatch(migration, new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+${escaped}\\s+from\\s+authenticated\\s*;`));
});

test('no browser-facing role receives effect-capable RPC authority', () => {
  assert.doesNotMatch(
    migration,
    /grant\s+execute\s+on\s+function\s+public\.h205f22_a2_browser_supervisor_(?:continue_if_needed_v1|continuity_trigger_v1)[^;]*\s+to\s+(?:anon|authenticated|public)\s*;/i,
  );
});
