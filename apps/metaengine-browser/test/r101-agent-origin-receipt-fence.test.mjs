import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const route = await readFile(new URL('../supabase/a2-browser-native-supervisor-v1/devos-routes.mjs', import.meta.url), 'utf8');
const migration = await readFile(new URL('../../../supabase/migrations/20260928034500_devos_agent_origin_receipt_v1.sql', import.meta.url), 'utf8');

test('R101 Edge receipt keeps Agent-surface provenance through route and running projection', () => {
  assert.match(route, /agent_surface_sha256/);
  assert.match(route, /PROVEN_COMPOSER_CLEARED/);
  assert.match(route, /p_proof:\{prompt_sha256:promptSha,conversation_url_sha256:conversationSha,agent_surface_sha256:agentSurfaceSha,effect_state:effectState\}/);
  assert.match(route, /agent_surface_sha256:proof\?\.agent_surface_sha256\|\|null/);
});

test('R101 DB receipt rejects Chat-only proof and persists Agent-surface digest in the durable event', () => {
  assert.match(migration, /coalesce\(p_proof->>'agent_surface_sha256',''\)\s*!~\s*'\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /'PROVEN_COMPOSER_CLEARED'/);
  assert.match(migration, /'TASK_TRANSPORT_PROVEN'/);
  assert.match(migration, /'agent_surface_sha256',\s*p_proof->>'agent_surface_sha256'/);
  assert.match(migration, /'agent_origin_contract',\s*'ZAI_AGENT_SURFACE_CAUSAL_V1'/);
  assert.match(migration, /raise exception 'transport_not_proven'/);
  assert.match(migration, /revoke\s+all[\s\S]*from\s+public,\s*anon,\s*authenticated/i);
  assert.match(migration, /grant\s+execute[\s\S]*to\s+service_role/i);
});

test('R101 DB change preserves the existing lease/generation/target fencing', () => {
  for (const invariant of [
    /v_task\.state <> 'LEASED'/,
    /v_task\.lease_agent_id <> lower\(p_agent\)/,
    /v_task\.lease_generation <> p_generation/,
    /v_task\.lease_tab_id <> p_tab/,
    /v_task\.lease_target_id <> lower\(p_target\)/,
    /v_task\.lease_agent_generation_epoch <> p_epoch/,
    /v_task\.lease_expires_at <= clock_timestamp\(\)/,
  ]) assert.match(migration, invariant);
});
