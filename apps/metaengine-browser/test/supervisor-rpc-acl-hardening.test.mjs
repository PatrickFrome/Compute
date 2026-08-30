import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260830175500_h205f22_supervisor_rpc_acl_hardening_v1.sql', import.meta.url),
  'utf8',
)
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const hasStatement = (statement) => migration.includes(`${statement.toLowerCase()};`);

const effectFunctions = [
  'public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid, text, jsonb)',
  'public.h205f22_a2_browser_supervisor_continuity_trigger_v1()',
];

for (const fn of effectFunctions) {
  test(`effect-capable supervisor RPC is service-role only: ${fn}`, () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      assert.equal(
        hasStatement(`revoke execute on function ${fn} from ${role}`),
        true,
        `missing explicit revoke from ${role} for ${fn}`,
      );
    }
    assert.equal(
      hasStatement(`grant execute on function ${fn} to service_role`),
      true,
      `missing service_role grant for ${fn}`,
    );
  });
}

test('zero-authority coordination read barrier remains available to authenticated agents only', () => {
  const fn = 'public.coordination_read_barrier_h205f22()';

  assert.equal(hasStatement(`alter function ${fn} set search_path = ''`), true);
  assert.equal(hasStatement(`revoke execute on function ${fn} from public`), true);
  assert.equal(hasStatement(`revoke execute on function ${fn} from anon`), true);
  assert.equal(hasStatement(`grant execute on function ${fn} to authenticated`), true);
  assert.equal(hasStatement(`grant execute on function ${fn} to service_role`), true);
  assert.equal(hasStatement(`revoke execute on function ${fn} from authenticated`), false);
});

test('no browser-facing role receives effect-capable RPC authority', () => {
  for (const fn of effectFunctions) {
    for (const role of ['public', 'anon', 'authenticated']) {
      assert.equal(
        hasStatement(`grant execute on function ${fn} to ${role}`),
        false,
        `unexpected browser-facing grant to ${role} for ${fn}`,
      );
    }
  }
});
