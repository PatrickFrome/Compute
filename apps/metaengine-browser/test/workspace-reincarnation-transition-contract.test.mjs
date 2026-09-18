import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const sql = await fs.readFile(new URL('../../../supabase/migrations/20260902103000_a2_workspace_reincarnation_transition_v1.sql', import.meta.url), 'utf8');

test('transition keeps the same active registry row and exact predecessor CAS fences', () => {
  assert.match(sql, /update public\.compute_fabric_a2_workspace_binding_h205f22/i);
  assert.match(sql, /set workspace_generation = workspace_generation \+ 1/i);
  for (const fence of [
    'binding_id = p_binding_id', 'workspace_id = p_workspace_id',
    'workspace_generation = p_expected_workspace_generation', 'claim_id = p_expected_claim_id',
    'agent_generation_epoch = p_expected_agent_generation_epoch', 'lease_generation = p_expected_lease_generation',
    "state = 'READY'", 'ambiguity_code is null', 'dirty_hold = false',
    'automatic_retry_allowed = false', 'authority_effect = false',
  ]) assert.ok(sql.toLowerCase().includes(fence.toLowerCase()), `missing CAS fence: ${fence}`);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.compute_fabric_a2_workspace_binding_h205f22/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.compute_fabric_a2_workspace_binding_h205f22/i);
});

test('successor is scheduler-owned and claim remains exact, active and fresh', () => {
  assert.match(sql, /from destruktion_meta\.devos_fleet_claim_h205f22[\s\S]*where claim_id = p_successor_claim_id[\s\S]*for share/i);
  assert.match(sql, /v_claim\.state <> 'ACTIVE'/i);
  assert.match(sql, /v_claim\.claim_class <> 'MUTATING'/i);
  assert.match(sql, /v_claim\.expires_at <= v_now/i);
  assert.match(sql, /from destruktion_meta\.devos_fleet_task_h205f22[\s\S]*where task_id = v_row\.task_id[\s\S]*for share/i);
  assert.match(sql, /v_task\.state not in \('LEASED','RUNNING'\)/i);
  assert.match(sql, /v_task\.lease_expires_at <> v_claim\.expires_at/i);
  assert.match(sql, /v_task\.lease_generation <> p_successor_lease_generation/i);
});

test('post-lock physical incarnation revalidation reuses existing fleet proof and watchdog horizon', () => {
  assert.match(sql, /compute_fabric_a2_browser_supervisor_state_h205f22/i);
  assert.match(sql, /v_supervisor_seen < v_now - interval '45 seconds'/i);
  assert.match(sql, /v_agent->>'ownership' <> 'FLEET_OWNED'/i);
  assert.match(sql, /v_agent->>'lifecycle_state' <> 'ACTIVE'/i);
  assert.match(sql, /metaengine\.browser\.fleet-transport-proof\.v1/i);
  assert.match(sql, /conversation_url_sha256/i);
  assert.match(sql, /v_proven_at > v_supervisor_seen \+ interval '5 seconds'/i);
  assert.doesNotMatch(sql, /devos_fleet_lease_v1\s*\(/i);
  assert.doesNotMatch(sql, /devos_fleet_transport_promote/i);
});

test('append-only receipt supports reconciliation without blind retry', () => {
  assert.match(sql, /create table public\.compute_fabric_a2_workspace_reincarnation_receipt_h205f22/i);
  assert.match(sql, /transition_id uuid primary key/i);
  assert.match(sql, /successor_workspace_generation = predecessor_workspace_generation \+ 1/i);
  assert.match(sql, /insert into public\.compute_fabric_a2_workspace_reincarnation_receipt_h205f22/i);
  assert.match(sql, /h205f22_a2_workspace_reincarnation_receipt_v1/i);
  assert.match(sql, /reconciled_from_durable_receipt/i);
  assert.match(sql, /automatic_retry_allowed',false/i);
  assert.doesNotMatch(sql, /on conflict/i);
});

test('SQL authority surface is service-role-only and contains no executable/content channel', () => {
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /security definer[\s\S]*set search_path = pg_catalog, public, destruktion_meta/i);
  assert.match(sql, /grant execute on function public\.h205f22_a2_workspace_reincarnation_transition_v1[\s\S]*to service_role/i);
  assert.match(sql, /grant execute on function public\.h205f22_a2_workspace_reincarnation_receipt_v1[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /\bexecute\s+format\b|\bexecute\s+\$|\beval\b|task_spec|page_text|model_text|prompt_text/i);
});
