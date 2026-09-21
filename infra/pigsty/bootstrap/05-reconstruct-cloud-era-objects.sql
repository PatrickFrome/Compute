-- ============================================================================
-- METAENGINE reconstruction 2026-09-21 — восстановление облачных объектов,
-- отсутствующих в каталоге миграций (эпоха ad-hoc DDL до 2026-08-21+).
-- Источники контрактов: smoke-тесты (test/*.sql), тела миграций, edge-роуты.
-- Принципы: нулевые authority-эффекты, дефолты canonical/authority_effect=false,
-- grants как в миграциях (service_role — полный доступ).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TIER 1: браузерно-критичная командная/флотовая плоскость
-- ----------------------------------------------------------------------------

-- 1. devos_fleet_task (контракт: test/workspace-reincarnation-transition-smoke.sql)
create table if not exists destruktion_meta.devos_fleet_task_h205f22 (
  task_id uuid primary key,
  workspace_id uuid not null,
  point_id text not null,
  claim_class text not null,
  base_sha text not null,
  branch_name text,
  state text not null,
  lease_generation bigint not null,
  lease_agent_id text,
  lease_tab_id text,
  lease_target_id text,
  lease_agent_generation_epoch bigint,
  lease_expires_at timestamptz,
  role text,
  task_spec jsonb not null default '{}'::jsonb,
  priority integer,
  error_code text,
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  authority_effect boolean not null default false
);
grant all on destruktion_meta.devos_fleet_task_h205f22 to service_role;

-- 2. devos_fleet_claim (контракт: test/devos-dispatch-admission-*-smoke.sql)
create table if not exists destruktion_meta.devos_fleet_claim_h205f22 (
  claim_id bigserial primary key,
  workspace_id uuid not null,
  role text not null,
  agent_id text not null,
  tab_id text not null,
  target_id text not null,
  agent_generation_epoch bigint not null,
  state text not null default 'ACTIVE'
);
grant all on destruktion_meta.devos_fleet_claim_h205f22 to service_role;

-- 3. actuation_lease (контракт: test/c5-transport-promotion-lease-verifier-v2-smoke.sql)
create table if not exists public.compute_fabric_a2_supervisor_actuation_lease_h205f22 (
  lease_id uuid not null primary key,
  workspace_id uuid not null,
  target_client_id text not null,
  holder_supervisor_instance_id text not null,
  effect_scope text not null,
  effect_key text not null,
  status text not null,
  command_id uuid,
  acquired_at timestamptz not null,
  expires_at timestamptz not null,
  released_at timestamptz,
  release_reason text,
  authority_effect boolean not null default false
);
create index if not exists actuation_lease_active_idx
  on public.compute_fabric_a2_supervisor_actuation_lease_h205f22(workspace_id, target_client_id)
  where status='ACTIVE';
grant all on public.compute_fabric_a2_supervisor_actuation_lease_h205f22 to service_role;

-- 4. mesh_instance (колонки из миграции 20260902205500, insert/update/on conflict)
create table if not exists public.compute_fabric_a2_supervisor_mesh_instance_h205f22 (
  workspace_id uuid not null,
  supervisor_instance_id text not null,
  conversation_url_sha256 text,
  tab_id text,
  status text,
  priority integer,
  capabilities jsonb not null default '{}'::jsonb,
  registered_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz,
  retired_at timestamptz,
  authority_effect boolean not null default false,
  constraint supervisor_mesh_instance_pk primary key (workspace_id, supervisor_instance_id)
);
grant all on public.compute_fabric_a2_supervisor_mesh_instance_h205f22 to service_role;

-- 5. predecessor_command_id на chat_bridge_remote_command (fsm-миграция 20260826162536)
alter table public.compute_fabric_a2_chat_bridge_remote_command_h205f22
  add column if not exists predecessor_command_id uuid;

-- 6. Стаб devos_fleet_enqueue_v1 — миграция 20260913185443 сначала RENAME-ает
--    существующую функцию (в облаке она была), затем создаёт новую.
create or replace function public.devos_fleet_enqueue_v1(
  p_workspace uuid, p_point text, p_role text, p_task_class text,
  p_payload jsonb, p_base text, p_branch text, p_max_claims integer
) returns void language plpgsql as $stub$
begin
  -- legacy ad-hoc реализация эпохи облака не сохранилась в миграциях;
  -- миграция 20260913185443 переименует этот стаб и создаст каноническую версию.
  return;
end $stub$;

-- 7. Стаб coordination_read_barrier_h205f22 — миграция 20260831123000 только
--    ALTER/GRANT. Полная реализация на main (coordination/read-plane/) тянет 4
--    несуществующие таблицы; стаб достаточно для применения миграции.
create or replace function public.coordination_read_barrier_h205f22()
returns jsonb language plpgsql as $stub$
begin
  return jsonb_build_object('schema','metaengine.coordination.read-barrier.v1','stub',true);
end $stub$;
grant execute on function public.coordination_read_barrier_h205f22() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- TIER 2: W1 linux-worker admission plane (минимальный паритет по колонкам,
-- извлечённым из тел функций миграций 20260823085243 / 20260823141025)
-- ----------------------------------------------------------------------------

create table if not exists destruktion_meta.compute_fabric_worker_enrollment_h205f22 (
  enrollment_id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  node_class_id text,
  state text not null default 'PENDING',
  probe_verified boolean not null default false,
  latest_probe_sha256 text,
  created_at timestamptz not null default clock_timestamp(),
  canonical boolean not null default false,
  authority_effect boolean not null default false
);

create table if not exists destruktion_meta.compute_fabric_linux_worker_backend_binding_h205f22 (
  binding_id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  backend_kind text not null,
  backend_instance_name text,
  endpoint_ref text,
  persistence_mode text,
  execution_state text,
  canonical boolean not null default false,
  authority_effect boolean not null default false
);

create table if not exists destruktion_meta.compute_fabric_linux_worker_safety_verification_h205f22 (
  verification_id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  enrollment_id uuid,
  observation_id uuid,
  verification_status text not null default 'PENDING',
  verified_at timestamptz,
  verifier_id text,
  verifier_kind text,
  probe_sha256 text,
  receipt_sha256 text,
  verification_proof_sha256 text,
  policy_key text,
  policy_sha256 text,
  evidence jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default clock_timestamp() + interval '1 hour',
  canonical boolean not null default false,
  authority_effect boolean not null default false
);

create table if not exists destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22 (
  reboot_receipt_id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  provider_kind text,
  provider_instance_id text,
  action_kind text,
  action_id text,
  requested_at timestamptz,
  completed_at timestamptz,
  identity_attestation_kind text,
  identity_attestation_verified boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text,
  accepted boolean not null default false,
  canonical boolean not null default false,
  authority_effect boolean not null default false
);

create table if not exists destruktion_meta.compute_fabric_worker_probe_receipt_h205f22 (
  probe_receipt_id bigserial primary key,
  enrollment_id uuid,
  worker_id text,
  probe_schema text,
  verdict text,
  probe_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default clock_timestamp(),
  canonical boolean not null default false,
  authority_effect boolean not null default false
);
-- миграция 20260823141025 делает revoke insert from service_role — таблица должна существовать
grant select, update, delete on destruktion_meta.compute_fabric_worker_probe_receipt_h205f22 to service_role;

-- ----------------------------------------------------------------------------
-- TIER 3: roadmap / orchestration / ledger (колонки из 20260821125449 и
-- 20260831200500 / 20260901001500 / 20260914001000)
-- ----------------------------------------------------------------------------

-- non-canonical roadmap_release (canonical_* версия создаётся миграцией 20260821121846)
create table if not exists destruktion_meta.compute_fabric_roadmap_release_h205f22 (
  roadmap_id text primary key default gen_random_uuid(),
  version bigint not null,
  is_current boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
grant all on destruktion_meta.compute_fabric_roadmap_release_h205f22 to service_role;

create table if not exists destruktion_meta.compute_fabric_roadmap_milestone_h205f22 (
  roadmap_id text not null,
  milestone_key text not null,
  status text not null default 'PLANNED',
  verified_checkpoint_id text,
  phase_order integer not null default 0,
  priority integer not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (roadmap_id, milestone_key)
);
grant all on destruktion_meta.compute_fabric_roadmap_milestone_h205f22 to service_role;

create table if not exists destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 (
  claim_id bigserial primary key,
  roadmap_id uuid not null,
  milestone_key text not null,
  holder_id text,
  state text not null default 'ACTIVE',
  expires_at timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  result_checkpoint_id text,
  created_at timestamptz not null default clock_timestamp()
);
grant all on destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 to service_role;

create table if not exists destruktion_meta.compute_fabric_roadmap_step_receipt_h205f22 (
  receipt_id bigserial primary key,
  roadmap_id uuid not null,
  milestone_key text not null,
  step_kind text not null,
  status text not null,
  result_checkpoint_id text,
  summary jsonb not null default '{}'::jsonb,
  claim_id bigint,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
grant all on destruktion_meta.compute_fabric_roadmap_step_receipt_h205f22 to service_role;

create table if not exists destruktion_meta.chat_capsule_checkpoint (
  checkpoint_id text primary key,
  created_at timestamptz not null default clock_timestamp(),
  payload jsonb not null default '{}'::jsonb
);
grant all on destruktion_meta.chat_capsule_checkpoint to service_role;

create table if not exists destruktion_meta.metaengine_devos_roadmap_authority_h205f22 (
  authority_id bigserial primary key,
  roadmap_id uuid not null,
  authority_key text,
  alignment_epoch bigint not null default 0,
  baseline_sha text,
  integration_line text,
  active_milestone_key text,
  updated_at timestamptz not null default clock_timestamp()
);
grant all on destruktion_meta.metaengine_devos_roadmap_authority_h205f22 to service_role;

-- toolchain_contract (INSERT в 20260821090100: on conflict (contract_key); foreach по text[])
create table if not exists destruktion_meta.compute_fabric_toolchain_contract_h205f22 (
  contract_key text primary key,
  schema_version integer not null,
  hash_algorithm text not null default 'SHA256',
  environment_mode text not null default 'DECLARED_COMPLETE',
  required_environment_keys text[] not null default '{}',
  contract jsonb not null default '{}'::jsonb,
  contract_sha256 text,
  enabled boolean not null default true,
  canonical boolean not null default false,
  authority_effect boolean not null default false
);
grant all on destruktion_meta.compute_fabric_toolchain_contract_h205f22 to service_role;

-- checkpoint_ledger (триггер 20260914001000 читает new.state / new.state_hash)
create table if not exists destruktion_meta.checkpoint_ledger (
  ledger_id bigserial primary key,
  checkpoint_id text,
  state jsonb not null default '{}'::jsonb,
  state_hash text,
  created_at timestamptz not null default clock_timestamp()
);
grant insert, select on destruktion_meta.checkpoint_ledger to service_role;

-- ----------------------------------------------------------------------------
-- Облачные функции-стабы (тела не сохранились в миграциях; миграции 21846/25449
-- создают поверх них v2/обёртки, а 20260831123000 только ALTER/GRANT)
create or replace function destruktion_meta.compute_fabric_roadmap_status_h205f22() returns jsonb language plpgsql as 'begin return jsonb_build_object(''roadmap_id'',''compute-fabric-roadmap-v1'',''definition_integrity'',true); end';
create or replace function destruktion_meta.compute_fabric_supervisor_snapshot_h205f22() returns jsonb language plpgsql as 'begin return jsonb_build_object(''schema'',''metaengine.compute.fabric-supervisor-snapshot.h205f22.v1''); end';
create or replace function public.h205f22_a2_supervisor_mesh_sync_v1(text, jsonb) returns jsonb language plpgsql as 'begin return jsonb_build_object(''stub'',true); end';
create or replace function public.devos_transport_promotion_lease_v1(uuid, text, text, text, text, bigint) returns jsonb language plpgsql as 'begin return jsonb_build_object(''stub'',true); end';

-- Стартовые данные: current roadmap (нужен функциям seal-gate и orchestrator)
-- ----------------------------------------------------------------------------
insert into destruktion_meta.compute_fabric_roadmap_release_h205f22 (roadmap_id, version, is_current)
select 'local-reconstructed-roadmap-v1', 1, true
on conflict (roadmap_id) do nothing;
