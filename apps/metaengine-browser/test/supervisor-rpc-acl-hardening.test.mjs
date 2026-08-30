import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260830175500_h205f22_supervisor_rpc_acl_hardening_v1.sql', import.meta.url),
  'utf8',
).toLowerCase();

const privilegedFunctions = [
  'public.coordination_read_barrier_h205f22()',
  'public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid, text, jsonb)',
  'public.h205f22_a2_browser_supervisor_continuity_trigger_v1()',
];

for (const fn of privilegedFunctions) {
  test(`revokes exposed execute for ${fn}`, () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      assert.match(
        migration,
        new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+${fn.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s+from\\s+${role}\\s*;`),
      );
    }
  });
}

test('does not grant browser/page/user roles an alternate RPC authority path', () => {
  assert.doesNotMatch(migration, /grant\s+execute/i);
  assert.doesNotMatch(migration, /grant\s+.+\s+to\s+(anon|authenticated|public)/i);
});
