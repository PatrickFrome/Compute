// The historical cloud-first fallback console is retired. These assertions
// replace tests that previously required hosted Supabase to remain functional.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import {
  NATIVE_SUPERVISOR_DEFAULT_BASE, NATIVE_SUPERVISOR_BASE,
  resolveNativeSupervisorBase, setNativeSupervisorBase,
} from '../src/native-supervisor-endpoints.mjs';

test('no Supabase/cloud fallback base exists in default runtime', () => {
  assert.equal(NATIVE_SUPERVISOR_DEFAULT_BASE, null);
  assert.equal(NATIVE_SUPERVISOR_BASE, null);
  assert.throws(() => resolveNativeSupervisorBase('https://example.supabase.co/edge'), /protocol_denied/);
  assert.throws(() => setNativeSupervisorBase('https://example.supabase.co/edge'), /local_owner_unconfigured/);
});

test('production Client does not start a fallback sentinel or change transport ownership', async () => {
  const source = await fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /createSupabaseHealthSentinel\(\{/);
  assert.doesNotMatch(source, /fallbackConsole\.start\(/);
  assert.match(source, /fallback_mode: localProvider \? 'LOCAL_PINNED' : 'DISABLED'/);
  assert.match(source, /cloud_health: 'NOT_CONFIGURED'/);
});
