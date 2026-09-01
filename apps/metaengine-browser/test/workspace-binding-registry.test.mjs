import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  here,
  '../../../supabase/migrations/20260831152000_a2_workspace_binding_registry_v1.sql',
);
const sql = readFileSync(migrationPath, 'utf8');

function expectSql(pattern, message) {
  assert.match(sql, pattern, message);
}

test('durable registry keeps four independent active mutation fences', () => {
  expectSql(
    /workspace_binding_active_agent_uq[\s\S]*?\(agent_id\)[\s\S]*?where retired_at is null;/i,
    'active agent fence missing',
  );
  expectSql(
    /workspace_binding_active_branch_uq[\s\S]*?\(branch_name\)[\s\S]*?where retired_at is null;/i,
    'active branch fence missing',
  );
  expectSql(
    /workspace_binding_active_worktree_uq[\s\S]*?lower\(worktree_path\)[\s\S]*?where retired_at is null;/i,
    'active worktree fence missing',
  );
  expectSql(
    /workspace_binding_active_task_uq[\s\S]*?\(task_id\)[\s\S]*?where retired_at is null;/i,
    'active task fence missing',
  );
});

test('FROZEN is durable and only RETIRED releases an active fence', () => {
  expectSql(/state in \('RESERVED','READY','FROZEN','RETIRED'\)/i);
  expectSql(/state <> 'FROZEN' or ambiguity_code is not null/i);
  expectSql(/\(state = 'RETIRED'\) = \(retired_at is not null\)/i);
  expectSql(/RETIREMENT_EFFECT_AMBIGUOUS/i);
});

test('register RPC binds the full trusted workspace identity and current lease generation', () => {
  expectSql(/function public\.h205f22_a2_workspace_binding_register_v1\(/i);
  for (const token of [
    'p_workspace_id uuid',
    'p_worktree_id uuid',
    'p_coordination_workspace_id uuid',
    'p_task_id uuid',
    'p_claim_id bigint',
    'p_worktree_path text',
    'p_base_sha text',
    'p_branch_name text',
    'p_agent_id text',
    'p_agent_generation_epoch bigint',
    'p_lease_generation bigint',
    'p_lease_expires_at timestamptz',
  ]) {
    assert.ok(sql.includes(token), `missing register identity token: ${token}`);
  }
  expectSql(/p_lease_expires_at <= v_now[\s\S]*?workspace_binding_lease_expired/i);
  expectSql(/workspace_binding_exact_identity_conflict/i);
  expectSql(/workspace_binding_active_fence_conflict/i);
});

test('materialization readback never turns ambiguous evidence into READY', () => {
  expectSql(/function public\.h205f22_a2_workspace_binding_readback_v1\(/i);
  expectSql(/if v_effect <> 'PROVEN'[\s\S]*?state='FROZEN'/i);
  expectSql(/LEASE_EXPIRED_BEFORE_READY/i);
  expectSql(/INITIAL_HEAD_MISMATCH/i);
  expectSql(/WORKTREE_REALPATH_MISMATCH/i);
  expectSql(/state='READY'[\s\S]*?initial_head_sha=v_head[\s\S]*?worktree_realpath=v_realpath/i);
});

test('retirement is exact-CAS and fail-closed on references, dirt or ambiguous effects', () => {
  expectSql(/function public\.h205f22_a2_workspace_binding_retire_v1\(/i);
  expectSql(/workspace_id = p_workspace_id[\s\S]*?task_id = p_task_id[\s\S]*?agent_id = lower[\s\S]*?lease_generation = p_lease_generation[\s\S]*?branch_name = trim[\s\S]*?lower\(worktree_path\) = lower/i);
  expectSql(/workspace_binding_cleanup_referenced/i);
  expectSql(/workspace_binding_cleanup_dirty/i);
  expectSql(/workspace_binding_cleanup_ambiguous/i);
  expectSql(/if v_effect <> 'PROVEN'[\s\S]*?state='FROZEN'/i);
  expectSql(/set state='RETIRED'[\s\S]*?retired_at=v_now/i);
});

test('registry has zero page/model authority and is exposed only through service-role RPCs', () => {
  expectSql(/automatic_retry_allowed boolean not null default false/i);
  expectSql(/page_data_authority boolean not null default false/i);
  expectSql(/authority_effect boolean not null default false/i);
  expectSql(/revoke all on table public\.compute_fabric_a2_workspace_binding_h205f22 from public, anon, authenticated/i);
  expectSql(/revoke all on function public\.h205f22_a2_workspace_binding_register_v1[\s\S]*?from public, anon, authenticated/i);
  expectSql(/grant execute on function public\.h205f22_a2_workspace_binding_register_v1[\s\S]*?to service_role/i);
  assert.doesNotMatch(sql, /\beval\b|execute\s+format\s*\(/i);
});
