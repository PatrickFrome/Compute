import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const reconcile = read('supabase/migrations/20260831054300_devos_fleet_reconcile_v1.sql');
const hardening = read('supabase/migrations/20260831123000_browser_global_resilience_hardening_v1.sql');
const routes = read('apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/devos-routes.mjs');

test('expired DevOS effects are fenced ambiguous and never automatically requeued', () => {
  assert.match(reconcile, /state\s*=\s*'AMBIGUOUS'/);
  assert.match(reconcile, /LEASE_EXPIRED_EFFECT_UNKNOWN/);
  assert.match(reconcile, /automatic_retry_allowed',false/);
  assert.doesNotMatch(reconcile, /set\s+state\s*=\s*'READY'/i);
});

test('DB-native watchdog survives total Browser loss without becoming a second scheduler', () => {
  assert.match(hardening, /create or replace function destruktion_meta\.devos_fleet_watchdog_h205f22\(\)/i);
  assert.match(hardening, /metaengine-h205f22-devos-fleet-watchdog/);
  assert.match(hardening, /'30 seconds'/);
  assert.match(hardening, /pg_try_advisory_xact_lock/);
  assert.match(hardening, /public\.devos_fleet_reconcile_v1\(v_workspace\)/);
  assert.match(hardening, /'leases_ready_work',false/);
  assert.match(hardening, /'scheduler_source','NONE_RECOVERY_ONLY'/);
  assert.doesNotMatch(hardening, /devos_fleet_lease_v1/);
});

test('Browser heartbeat and DB watchdog share one reconciliation primitive', () => {
  assert.match(routes, /rpc\('devos_fleet_reconcile_v1'/);
  assert.ok(
    routes.indexOf("rpc('devos_fleet_reconcile_v1'") < routes.indexOf("rpc('devos_fleet_snapshot_v1'"),
    'Browser cycle must reconcile before reading backlog',
  );
  assert.match(hardening, /grant execute on function public\.devos_fleet_reconcile_v1\(uuid\) to service_role/i);
});

test('supervisor authority surfaces are least-authority and indexed for handoff', () => {
  for (const table of [
    'compute_fabric_a2_supervisor_mesh_instance_h205f22',
    'compute_fabric_a2_supervisor_actuation_lease_h205f22',
    'compute_fabric_development_gate_policy_h205f22',
  ]) {
    assert.match(hardening, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(hardening, /revoke execute on function public\.h205f22_a2_browser_supervisor_continue_if_needed_v1[^;]+from authenticated/i);
  assert.match(hardening, /grant execute on function public\.h205f22_a2_browser_supervisor_continue_if_needed_v1[^;]+to service_role/i);
  assert.match(hardening, /a2_supervisor_actuation_holder_fk_idx/);
  assert.match(hardening, /\(workspace_id, holder_supervisor_instance_id\)/);
});

test('stale persisted mesh health is retired without granting authority', () => {
  assert.match(hardening, /set status='LOST'/);
  assert.match(hardening, /last_seen_at < clock_timestamp\(\) - interval '5 minutes'/);
  assert.match(hardening, /'automatic_retry_allowed',false/);
  assert.match(hardening, /'authority_effect',false/);
});
