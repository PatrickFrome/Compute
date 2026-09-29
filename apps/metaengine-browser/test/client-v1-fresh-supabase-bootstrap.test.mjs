import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(
  new URL('../../../supabase/migrations/20260929010000_client_v1_fresh_project_bootstrap_v1.sql', import.meta.url),
  'utf8',
);
const lower = sql.toLowerCase();

const expect = (re, message) => assert.match(sql, re, message);

test('fresh Supabase bootstrap creates only the Client V1 Browser/DevOS durable substrate', () => {
  for (const table of [
    'destruktion_meta.devos_fleet_task_h205f22',
    'destruktion_meta.devos_fleet_claim_h205f22',
    'destruktion_meta.devos_fleet_event_h205f22',
    'destruktion_meta.devos_fleet_runtime_control_h205f22',
    'public.compute_fabric_a2_supervisor_mesh_instance_h205f22',
    'public.compute_fabric_a2_supervisor_actuation_lease_h205f22',
  ]) assert.ok(lower.includes(table), `missing ${table}`);

  for (const legacy of [
    'me2_event_mirror_h205f22',
    'chat_capsule_checkpoint',
    'compute_fabric_roadmap_milestone_h205f22',
    'compute_fabric_checkpoint_h205f22',
  ]) assert.equal(lower.includes(`create table ${legacy}`), false, `legacy bootstrap leak: ${legacy}`);
});

test('fresh bootstrap exposes the existing single DevOS task lifecycle without a second scheduler', () => {
  for (const fn of [
    'devos_fleet_enqueue_v1',
    'devos_fleet_reconcile_v1',
    'devos_fleet_snapshot_v1',
    'devos_fleet_lease_v1',
    'devos_fleet_mark_running_v1',
    'devos_fleet_complete_v1',
    'devos_environment_state_v1',
  ]) expect(new RegExp(`function\\s+(?:public\\.|destruktion_meta\\.)?${fn}\\s*\\(`, 'i'), `missing ${fn}`);

  assert.equal(/cron\.schedule/i.test(sql), false);
  assert.equal(/setinterval\s*\(/i.test(sql), false);
  assert.equal(/state\s*=\s*'ready'[\s\S]*lease_expired_effect_unknown/i.test(sql), false);
});

test('fresh bootstrap is fail closed around effects and least privilege', () => {
  expect(/authority_effect\s+boolean\s+not\s+null\s+default\s+false/i);
  expect(/check\s*\(\s*authority_effect\s*=\s*false\s*\)/i);
  expect(/revoke all on table[\s\S]*from public,anon,authenticated/i);
  expect(/grant execute on function[\s\S]*to service_role/i);
  expect(/state='ambiguous'[\s\S]*lease_expired_effect_unknown/i);
  assert.equal(/grant\s+execute[\s\S]*to\s+(?:anon|authenticated)/i.test(sql), false);
});

test('agent-origin migration remains the authoritative transport proof upgrade', () => {
  assert.equal(lower.includes('agent_surface_sha256'), false);
  assert.equal(lower.includes('zai_agent_surface_causal_v1'), false);
});
