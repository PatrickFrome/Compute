import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const migrationPath = 'supabase/migrations/20260902211500_devos_precise_rate_limit_backpressure_v2.sql';

async function source() {
  return fs.readFile(path.join(root, migrationPath), 'utf8');
}

test('rate-limit classifier prefers typed throttle and legacy fallback reads only fresh native perception', async () => {
  const sql = await source();
  assert.match(sql, /devos_chatgpt_rate_limit_backpressure_v2/);
  assert.match(sql, /supervisor_lifecycle,service_throttle/);
  assert.match(sql, /metaengine\.chatgpt-service-throttle\.v1/);
  assert.match(sql, /v_typed_state = 'THROTTLED'/);
  assert.match(sql, /TYPED_SERVICE_THROTTLE_V1/);
  assert.match(sql, /v_root -> 'perception'/);
  assert.match(sql, /metaengine\.native-browser\.perception\.v1/);
  assert.match(sql, /v_captured_at >= p_now - interval '20 seconds'/);
  assert.match(sql, /p_state_seen_at[^\n]*p_now - interval '20 seconds'/);
  assert.match(sql, /LEGACY_FRESH_PERCEPTION_V1/);
  assert.match(sql, /semantic_targets/);
  assert.match(sql, /'textbox'/);
  assert.match(sql, /'понятно', 'got it', 'ok', 'okay'/);
  assert.match(sql, /chatgpt\\\.com/);
  assert.match(sql, /слишком\[\[:space:\]\]\+много/);
  assert.match(sql, /too\[\[:space:\]\]\+many/);
  assert.doesNotMatch(sql, /lower\(coalesce\(v_browser_state/);
});

test('backpressure is a deny-only pre-lease gate and cannot become scheduler authority', async () => {
  const sql = await source();
  const classifyAt = sql.indexOf('v_backpressure := destruktion_meta.devos_chatgpt_rate_limit_backpressure_v2');
  const denyAt = sql.indexOf("if coalesce((v_backpressure ->> 'blocked')::boolean, false)", classifyAt);
  const expiredReconcileAt = sql.indexOf('update destruktion_meta.devos_fleet_task_h205f22', denyAt);
  const pickAt = sql.indexOf('for update skip locked', expiredReconcileAt);
  const leasedWriteAt = sql.indexOf("set state = 'LEASED'", pickAt);
  assert.ok(classifyAt >= 0);
  assert.ok(denyAt > classifyAt, 'classifier must only feed a negative admission fence');
  assert.ok(expiredReconcileAt > denyAt, 'no lease-side mutation may happen before the negative throttle fence');
  assert.ok(pickAt > expiredReconcileAt, 'canonical SKIP LOCKED scheduler remains downstream');
  assert.ok(leasedWriteAt > pickAt, 'LEASED mutation remains downstream of canonical picker');
  assert.match(sql, /'leased', false/);
  assert.match(sql, /'page_signal_authority', false/);
  assert.match(sql, /'automatic_retry_allowed', false/);
  assert.match(sql, /'authority_effect', false/);
  assert.doesNotMatch(sql, /page_signal_authority', true/);
  assert.doesNotMatch(sql, /authority_effect', true/);
});

test('existing lease identity, mutation fence, priority aging and service-role boundary remain intact', async () => {
  const sql = await source();
  assert.match(sql, /t\.claim_class <> 'MUTATING'/);
  assert.match(sql, /c\.claim_class = 'MUTATING'/);
  assert.match(sql, /c\.state = 'ACTIVE'/);
  assert.match(sql, /lease_agent_id = lower\(p_agent\)/);
  assert.match(sql, /lease_tab_id = p_tab/);
  assert.match(sql, /lease_target_id = lower\(p_target\)/);
  assert.match(sql, /lease_agent_generation_epoch = p_epoch/);
  assert.match(sql, /least\([\s\S]*24,[\s\S]*floor\(extract\(epoch from \(v_now - t\.created_at\)\) \/ 900\.0\)/);
  assert.match(sql, /TASK_LEASED/);
  assert.match(sql, /revoke all on function public\.devos_fleet_lease_v1[^;]+from public;/i);
  assert.match(sql, /grant execute on function public\.devos_fleet_lease_v1[^;]+to service_role;/i);
});

test('classifier result never projects raw Browser text or perception payload', async () => {
  const sql = await source();
  const functionStart = sql.indexOf('create or replace function destruktion_meta.devos_chatgpt_rate_limit_backpressure_v2');
  const helperEnd = sql.indexOf('revoke all on function destruktion_meta.devos_chatgpt_rate_limit_backpressure_v2', functionStart);
  const helper = sql.slice(functionStart, helperEnd);
  assert.match(helper, /text_excerpt/); // input-only classification is expected.
  for (const rawKey of ["'text_excerpt'", "'perception'", "'semantic_targets'", "'url'"]) {
    const buildObjects = [...helper.matchAll(/jsonb_build_object\(([\s\S]*?)\)/g)].map((match) => match[1]);
    assert.equal(buildObjects.some((body) => body.includes(rawKey)), false, `helper output must not project ${rawKey}`);
  }
});
