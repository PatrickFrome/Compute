import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(
  new URL('../../../supabase/migrations/20260928025000_r97_agent_origin_running_proof_v1.sql', import.meta.url),
  'utf8',
);

test('R97 running proof requires durable z.ai Agent-surface origin digest', () => {
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.devos_fleet_mark_running_v1/i);
  assert.match(sql, /p_proof->>'agent_surface_sha256'/i);
  assert.match(sql, /agent_surface_sha256'\s*,\s*p_proof->>'agent_surface_sha256'/i);
  assert.match(sql, /agent_origin_contract'\s*,\s*'ZAI_AGENT_SURFACE_CAUSAL_V1'/i);
  assert.match(sql, /transport_not_proven/i);
});

test('R97 running proof preserves exact lease fences and one existing transition', () => {
  for (const required of [
    /v_task\.state\s*<>\s*'LEASED'/i,
    /v_task\.lease_agent_id\s*<>\s*lower\(p_agent\)/i,
    /v_task\.lease_generation\s*<>\s*p_generation/i,
    /v_task\.lease_tab_id\s*<>\s*p_tab/i,
    /v_task\.lease_target_id\s*<>\s*lower\(p_target\)/i,
    /v_task\.lease_agent_generation_epoch\s*<>\s*p_epoch/i,
    /v_task\.lease_expires_at\s*<=\s*clock_timestamp\(\)/i,
    /event_type|TASK_TRANSPORT_PROVEN/i,
  ]) assert.match(sql, required);
  assert.doesNotMatch(sql, /insert\s+into\s+destruktion_meta\.devos_fleet_task_h205f22/i);
  assert.doesNotMatch(sql, /pg_notify|realtime\.send|setInterval|retry/i);
});

test('R97 running proof remains service-role-only and zero Browser authority', () => {
  assert.match(sql, /revoke\s+all[\s\S]*from\s+public,\s*anon,\s*authenticated/i);
  assert.match(sql, /grant\s+execute[\s\S]*to\s+service_role/i);
  assert.match(sql, /'automatic_retry_allowed'\s*,\s*false/i);
  assert.match(sql, /'authority_effect'\s*,\s*false/i);
});
