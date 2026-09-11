import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(here, '../../..', 'supabase/migrations/20260831193000_meta_orchestrator_plan_state_v1.sql');

async function sql() { return fs.readFile(migrationPath, 'utf8'); }

test('durable plan state has one ACTIVE generation per workspace and roadmap', async () => {
  const source = await sql();
  assert.match(source, /primary key \(workspace_id, roadmap_id, plan_generation\)/i);
  assert.match(source, /create unique index meta_orchestrator_plan_one_active_uq[\s\S]*where state = 'ACTIVE'/i);
  assert.match(source, /state in \('ACTIVE','SUPERSEDED'\)/i);
  assert.match(source, /\(state = 'SUPERSEDED'\) = \(retired_at is not null\)/i);
});

test('plan activation uses optimistic generation fencing plus an atomic workspace-roadmap lock', async () => {
  const source = await sql();
  assert.match(source, /pg_advisory_xact_lock\(hashtextextended\('meta-orchestrator-plan:'/i);
  assert.match(source, /v_current_generation <> p_expected_current_generation/i);
  assert.match(source, /raise exception 'meta_plan_generation_fenced'/i);
  assert.match(source, /v_next_generation := v_current_generation \+ 1/i);
  assert.match(source, /raise exception 'meta_plan_next_generation_mismatch'/i);
});

test('activation rereads roadmap authority and rejects baseline or alignment drift', async () => {
  const source = await sql();
  assert.match(source, /from destruktion_meta\.metaengine_devos_roadmap_authority_h205f22/i);
  assert.match(source, /p_plan->>'roadmap_id' <> v_auth\.roadmap_id/i);
  assert.match(source, /p_plan->>'active_milestone_key' <> v_auth\.active_milestone_key/i);
  assert.match(source, /p_plan->>'integration_line' <> v_auth\.integration_line/i);
  assert.match(source, /p_plan->>'baseline_sha'[\s\S]*v_auth\.baseline_sha/i);
  assert.match(source, /p_plan->>'alignment_epoch'[\s\S]*v_auth\.alignment_epoch/i);
  assert.match(source, /raise exception 'meta_plan_roadmap_authority_drift'/i);
});

test('durable plan forbids scheduler-owned identity at every JSON depth', async () => {
  const source = await sql();
  for (const key of [
    'agent_id', 'lease_agent_id', 'tab_id', 'lease_tab_id', 'target_id', 'lease_target_id',
    'agent_generation_epoch', 'lease_agent_generation_epoch', 'lease_generation',
    'lease_expires_at', 'claim_id', 'workspace_id',
  ]) {
    assert.match(source, new RegExp(`jsonb_path_exists\\(p_plan, '\\$\\.\\*\\*\\.${key}'\\)`));
  }
  assert.match(source, /raise exception 'meta_plan_scheduler_identity_forbidden'/i);
});

test('plan state remains zero-authority and does not create another scheduler', async () => {
  const source = await sql();
  assert.match(source, /automatic_retry_allowed boolean not null default false/i);
  assert.match(source, /scheduler_authority boolean not null default false/i);
  assert.match(source, /browser_authority boolean not null default false/i);
  assert.match(source, /release_authority boolean not null default false/i);
  assert.match(source, /authority_effect boolean not null default false/i);
  assert.doesNotMatch(source, /devos_fleet_lease_v1\s*\(/i);
  assert.doesNotMatch(source, /devos_fleet_enqueue_v1\s*\(/i);
  assert.doesNotMatch(source, /setInterval|polling loop/i);
});

test('plan digest is DB-derived and RPCs are service-role only', async () => {
  const source = await sql();
  assert.match(source, /extensions\.digest\(convert_to\(p_plan::text,'UTF8'\),'sha256'\)/i);
  assert.match(source, /revoke all on function public\.meta_orchestrator_plan_activate_v1[\s\S]*from public, anon, authenticated/i);
  assert.match(source, /grant execute on function public\.meta_orchestrator_plan_activate_v1[\s\S]*to service_role/i);
  assert.match(source, /revoke all on function public\.meta_orchestrator_plan_snapshot_v1[\s\S]*from public, anon, authenticated/i);
  assert.match(source, /grant execute on function public\.meta_orchestrator_plan_snapshot_v1[\s\S]*to service_role/i);
});
