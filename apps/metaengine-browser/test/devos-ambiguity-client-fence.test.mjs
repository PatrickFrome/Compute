import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../../../supabase/migrations/20260901044000_devos_fleet_ambiguity_reconciliation_client_fence_v2.sql', import.meta.url);
const routeUrl = new URL('../supabase/a2-browser-native-supervisor-v1/devos-routes.mjs', import.meta.url);

async function sources() {
  const [sql, route] = await Promise.all([
    fs.readFile(migrationUrl, 'utf8'),
    fs.readFile(routeUrl, 'utf8'),
  ]);
  return { sql, route };
}

test('ambiguity recovery is fenced to authenticated CONTROL client and keeps stable wire contract', async () => {
  const { sql, route } = await sources();

  assert.match(sql, /create or replace function public\.devos_fleet_reconcile_ambiguous_v2\(\s*p_workspace uuid,\s*p_client text,/s);
  assert.match(sql, /v_client text:=nullif\(trim\(coalesce\(p_client,''\)\),''\)/);
  assert.match(sql, /devos_control_supervisor_snapshot_v1\(p_workspace,v_client,45\)/);
  assert.match(sql, /v_control->>'state'<>'FRESH_CONTROL'/);
  assert.match(sql, /devos_ambiguity_supervisor_client_fenced/);

  const clientFenceAt = sql.indexOf("v_control:=public.devos_control_supervisor_snapshot_v1");
  const taskLockAt = sql.indexOf('select * into v_task');
  assert.ok(clientFenceAt >= 0 && taskLockAt > clientFenceAt, 'authenticated CONTROL fence must precede task mutation lock');

  assert.match(sql, /revoke execute on function public\.devos_fleet_reconcile_ambiguous_v1\([^;]+\) from service_role;/s);
  assert.match(sql, /revoke all on function public\.devos_fleet_reconcile_ambiguous_v2\([^;]+\) from public,anon,authenticated;/s);
  assert.match(sql, /grant execute on function public\.devos_fleet_reconcile_ambiguous_v2\([^;]+\) to service_role;/s);

  // v2 is an authorization implementation revision. The response shape itself did not change,
  // so native rolling clients keep the stable v1 wire schema rather than requiring lockstep deploys.
  assert.match(sql, /'schema','metaengine\.devos\.ambiguity-reconciliation\.v1'/);
  assert.doesNotMatch(sql, /'schema','metaengine\.devos\.ambiguity-reconciliation\.v2'/);
  assert.match(sql, /'physical_effect_replayed',false/);
  assert.match(sql, /'new_lease_generation_allocated',false/);
  assert.match(sql, /'automatic_retry_allowed',false/);

  assert.match(route, /rpc\('devos_fleet_reconcile_ambiguous_v2',\{p_workspace:workspaceId,p_client:clientId,/);
  assert.doesNotMatch(route, /rpc\('devos_fleet_reconcile_ambiguous_v1'/);
  assert.doesNotMatch(route, /p_client\s*:\s*body(?:\.|\[)/);
  assert.doesNotMatch(route, /p_client\s*:\s*request(?:\.|\[)/);
  assert.doesNotMatch(route, /client_id\s*=\s*String\(body/);
});
