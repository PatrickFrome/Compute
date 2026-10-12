-- A separate owner-approved host configuration provisions trusted roots. Task
-- commands contain identity only; branch/base/paths are resolved server-side.
create table public.compute_fabric_a2_managed_project_repository_h205f22 (
  coordination_workspace_id uuid not null,
  device_id uuid not null references public.compute_fabric_a2_browser_device_h205f22(device_id),
  client_id text not null check (length(client_id) between 1 and 160),
  admin_grant_epoch bigint not null check (admin_grant_epoch>0),
  repo_id text not null check (repo_id ~ '^[a-zA-Z0-9][a-zA-Z0-9:._/-]{2,159}$'),
  repo_root text not null check (length(repo_root) between 1 and 4096),
  managed_root text not null check (length(managed_root) between 1 and 4096),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  authority_effect boolean not null default false check (authority_effect=false),
  primary key(coordination_workspace_id,device_id,client_id)
);
alter table public.compute_fabric_a2_managed_project_repository_h205f22 enable row level security;
revoke all on table public.compute_fabric_a2_managed_project_repository_h205f22 from public,anon,authenticated,service_role;

create or replace function public.h205f22_a2_managed_project_repository_provision_v1(
  p_coordination_workspace_id uuid,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint,
  p_repo_id text,p_repo_root text,p_managed_root text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare v_device public.compute_fabric_a2_browser_device_h205f22%rowtype;
  v_repo public.compute_fabric_a2_managed_project_repository_h205f22%rowtype; v_replayed boolean:=false;
begin
  if p_coordination_workspace_id is null or p_device_id is null or p_client_id is null
     or length(p_client_id) not between 1 and 160 or coalesce(p_admin_grant_epoch,0)<1
     or coalesce(p_repo_id,'') !~ '^[a-zA-Z0-9][a-zA-Z0-9:._/-]{2,159}$'
     or coalesce(length(p_repo_root),0) not between 1 and 4096
     or coalesce(length(p_managed_root),0) not between 1 and 4096
     or p_repo_root=p_managed_root
     or not (p_repo_root like '/%' or p_repo_root ~ '^[A-Za-z]:[\\/]')
     or not (p_managed_root like '/%' or p_managed_root ~ '^[A-Za-z]:[\\/]')
     or p_repo_root ~ '(^|[\\/])\.\.([\\/]|$)' or p_managed_root ~ '(^|[\\/])\.\.([\\/]|$)' then
    raise exception 'MANAGED_PROJECT_REPOSITORY_CONFIG_INVALID' using errcode='22023';
  end if;
  select * into v_device from public.compute_fabric_a2_browser_device_h205f22
    where device_id=p_device_id and client_id=p_client_id for share;
  if not found or v_device.active is distinct from true or v_device.revoked_at is not null
     or v_device.access_tier is distinct from 'ADMIN' or v_device.admin_revoked_at is not null
     or v_device.admin_grant_epoch is distinct from p_admin_grant_epoch
     or not (v_device.admin_scopes @> '["CONTROL_PLANE","DEVOS"]'::jsonb)
     or not exists (select 1 from public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22
       where token_hash=v_device.enrollment_pairing_token_hash and active=true) then
    raise exception 'MANAGED_PROJECT_DEVICE_GRANT_REVOKED' using errcode='42501';
  end if;
  insert into public.compute_fabric_a2_managed_project_repository_h205f22(
    coordination_workspace_id,device_id,client_id,admin_grant_epoch,repo_id,repo_root,managed_root
  ) values(p_coordination_workspace_id,p_device_id,p_client_id,p_admin_grant_epoch,p_repo_id,p_repo_root,p_managed_root)
  on conflict do nothing returning * into v_repo;
  if not found then
    select * into v_repo from public.compute_fabric_a2_managed_project_repository_h205f22
      where coordination_workspace_id=p_coordination_workspace_id and device_id=p_device_id and client_id=p_client_id for update;
    if v_repo.repo_id is distinct from p_repo_id or v_repo.repo_root is distinct from p_repo_root
       or v_repo.managed_root is distinct from p_managed_root or v_repo.admin_grant_epoch>p_admin_grant_epoch then
      raise exception 'MANAGED_PROJECT_REPOSITORY_CONFIG_CONFLICT' using errcode='55000';
    end if;
    v_replayed:=true;
    if v_repo.admin_grant_epoch<>p_admin_grant_epoch then
      update public.compute_fabric_a2_managed_project_repository_h205f22
        set admin_grant_epoch=p_admin_grant_epoch,updated_at=clock_timestamp()
        where coordination_workspace_id=p_coordination_workspace_id and device_id=p_device_id and client_id=p_client_id returning * into v_repo;
    end if;
  end if;
  return jsonb_build_object('schema','metaengine.devos.managed-project-repository.v1','provisioned',true,
    'repository',to_jsonb(v_repo),'replayed',v_replayed,'automatic_retry_allowed',false,'authority_effect',false);
end;
$$;
revoke all on function public.h205f22_a2_managed_project_repository_provision_v1(uuid,uuid,text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.h205f22_a2_managed_project_repository_provision_v1(uuid,uuid,text,bigint,text,text,text) to service_role;

create or replace function destruktion_meta.a2_managed_project_admission_read_h205f22(
  p_coordination_workspace_id uuid, p_task_id uuid, p_agent_id text,
  p_claim_id bigint, p_lease_generation bigint, p_workspace_id uuid,
  p_workspace_generation bigint, p_device_id uuid, p_client_id text,
  p_admin_grant_epoch bigint, p_allow_frozen boolean default false
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_device public.compute_fabric_a2_browser_device_h205f22%rowtype;
  v_repo public.compute_fabric_a2_managed_project_repository_h205f22%rowtype;
  v_registered jsonb;
  v_worktree_path text;
  v_binding public.compute_fabric_a2_workspace_binding_h205f22%rowtype;
  v_claim destruktion_meta.devos_fleet_claim_h205f22%rowtype;
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_state jsonb;
  v_seen timestamptz;
  v_agents jsonb;
  v_agent jsonb;
  v_proof jsonb;
  v_transport_identity jsonb;
  v_control jsonb;
  v_proven_at timestamptz;
begin
  if p_coordination_workspace_id is null or p_task_id is null or p_workspace_id is null or p_device_id is null
     or p_agent_id is null or p_agent_id !~ '^agent_[a-z0-9-]{8,64}$'
     or p_client_id is null or length(p_client_id) not between 1 and 160
     or coalesce(p_claim_id,0)<1 or coalesce(p_lease_generation,0)<1
     or coalesce(p_workspace_generation,0)<1 or coalesce(p_admin_grant_epoch,0)<1 then
    raise exception 'MANAGED_PROJECT_IDENTITY_INVALID' using errcode='22023';
  end if;

  select * into v_device from public.compute_fabric_a2_browser_device_h205f22
    where device_id=p_device_id and client_id=p_client_id for share;
  if not found or v_device.active is distinct from true or v_device.revoked_at is not null
     or v_device.access_tier is distinct from 'ADMIN' or v_device.admin_revoked_at is not null
     or v_device.admin_grant_epoch is distinct from p_admin_grant_epoch
     or not (v_device.admin_scopes @> '["CONTROL_PLANE","DEVOS"]'::jsonb)
     or not exists (select 1 from public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22
       where token_hash=v_device.enrollment_pairing_token_hash and active=true) then
    raise exception 'MANAGED_PROJECT_DEVICE_GRANT_REVOKED' using errcode='42501';
  end if;

  select * into v_repo from public.compute_fabric_a2_managed_project_repository_h205f22
    where coordination_workspace_id=p_coordination_workspace_id and device_id=p_device_id and client_id=p_client_id for share;
  if not found or v_repo.admin_grant_epoch is distinct from p_admin_grant_epoch then
    raise exception 'MANAGED_PROJECT_REPOSITORY_NOT_PROVISIONED' using errcode='55000';
  end if;
  select * into v_binding from public.compute_fabric_a2_workspace_binding_h205f22
    where workspace_id=p_workspace_id and retired_at is null for share;
  if not found then
    -- Resolve the initial identity from the existing scheduler, never task JSON.
    select * into v_claim from destruktion_meta.devos_fleet_claim_h205f22 where claim_id=p_claim_id for share;
    if not found or v_claim.state is distinct from 'ACTIVE' or v_claim.claim_class is distinct from 'MUTATING'
       or v_claim.authority_effect is distinct from false or v_claim.expires_at<=v_now
       or v_claim.workspace_id is distinct from p_coordination_workspace_id or v_claim.task_id is distinct from p_task_id
       or v_claim.agent_id is distinct from p_agent_id or v_claim.lease_generation is distinct from p_lease_generation then
      raise exception 'MANAGED_PROJECT_CLAIM_NOT_CURRENT' using errcode='55000';
    end if;
    select * into v_task from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task_id for share;
    if not found or v_task.state not in ('LEASED','RUNNING') or v_task.claim_class is distinct from 'MUTATING'
       or v_task.workspace_id is distinct from v_claim.workspace_id or v_task.lease_generation is distinct from v_claim.lease_generation
       or v_task.lease_agent_id is distinct from v_claim.agent_id or v_task.lease_tab_id is distinct from v_claim.tab_id
       or v_task.lease_target_id is distinct from v_claim.target_id or v_task.lease_agent_generation_epoch is distinct from v_claim.agent_generation_epoch
       or v_task.lease_expires_at is distinct from v_claim.expires_at or v_task.base_sha is distinct from v_claim.base_sha
       or v_task.point_id is distinct from v_claim.point_id or v_task.authority_effect is distinct from false
       or coalesce(v_task.branch_name,'')='' or p_workspace_generation<>1 then
      raise exception 'MANAGED_PROJECT_TASK_NOT_CURRENT' using errcode='55000';
    end if;
    v_worktree_path:=regexp_replace(v_repo.managed_root,'[\\/]+$','') ||
      case when v_repo.managed_root ~ '^[A-Za-z]:\\' then chr(92) else '/' end ||
      replace(p_agent_id,'_','-')||'--'||p_task_id::text||'--l'||p_lease_generation::text;
    v_registered:=public.h205f22_a2_workspace_binding_register_v1(p_workspace_id,1,gen_random_uuid(),
      p_coordination_workspace_id,p_task_id,p_claim_id,v_claim.point_id,v_repo.repo_id,v_repo.repo_root,
      v_repo.managed_root,v_worktree_path,v_claim.base_sha,v_task.branch_name,v_claim.agent_id,v_claim.tab_id,
      v_claim.target_id,v_claim.agent_generation_epoch,v_claim.lease_generation,v_claim.expires_at);
    if (v_registered->>'ok')::boolean is distinct from true then raise exception 'MANAGED_PROJECT_BINDING_REGISTRATION_FAILED'; end if;
    select * into v_binding from public.compute_fabric_a2_workspace_binding_h205f22
      where workspace_id=p_workspace_id and retired_at is null for share;
  end if;
  if v_binding.repo_id is distinct from v_repo.repo_id or v_binding.repo_root is distinct from v_repo.repo_root
     or v_binding.managed_root is distinct from v_repo.managed_root then
    raise exception 'MANAGED_PROJECT_REPOSITORY_BINDING_DRIFT' using errcode='55000';
  end if;
  if v_binding.coordination_workspace_id is distinct from p_coordination_workspace_id
     or v_binding.task_id is distinct from p_task_id or v_binding.agent_id is distinct from p_agent_id
     or v_binding.claim_id is distinct from p_claim_id or v_binding.lease_generation is distinct from p_lease_generation
     or v_binding.workspace_generation is distinct from p_workspace_generation then
    raise exception 'MANAGED_PROJECT_BINDING_IDENTITY_DRIFT' using errcode='55000';
  end if;
  if v_binding.state not in ('RESERVED','READY') and not (p_allow_frozen and v_binding.state='FROZEN')
     or v_binding.dirty_hold is distinct from false
     or (v_binding.ambiguity_code is not null and not (p_allow_frozen and v_binding.state='FROZEN'))
     or v_binding.claim_class is distinct from 'MUTATING' or v_binding.authority_effect is distinct from false
     or v_binding.page_data_authority is distinct from false or v_binding.automatic_retry_allowed is distinct from false then
    raise exception 'MANAGED_PROJECT_BINDING_FENCED' using errcode='55000';
  end if;

  select * into v_claim from destruktion_meta.devos_fleet_claim_h205f22 where claim_id=p_claim_id for share;
  if not found or v_claim.state is distinct from 'ACTIVE' or v_claim.claim_class is distinct from 'MUTATING'
     or v_claim.authority_effect is distinct from false or v_claim.expires_at<=v_now
     or v_claim.workspace_id is distinct from v_binding.coordination_workspace_id
     or v_claim.task_id is distinct from v_binding.task_id or v_claim.point_id is distinct from v_binding.point_id
     or v_claim.agent_id is distinct from v_binding.agent_id or v_claim.base_sha is distinct from v_binding.base_sha
     or v_claim.tab_id is distinct from v_binding.tab_id or v_claim.target_id is distinct from v_binding.target_id
     or v_claim.agent_generation_epoch is distinct from v_binding.agent_generation_epoch
     or v_claim.lease_generation is distinct from v_binding.lease_generation
     or v_claim.expires_at<v_binding.lease_expires_at then
    raise exception 'MANAGED_PROJECT_CLAIM_NOT_CURRENT' using errcode='55000';
  end if;
  select * into v_task from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task_id for share;
  if not found or v_task.state not in ('LEASED','RUNNING') or v_task.claim_class is distinct from 'MUTATING'
     or v_task.authority_effect is distinct from false or v_task.workspace_id is distinct from v_claim.workspace_id
     or v_task.point_id is distinct from v_claim.point_id or v_task.base_sha is distinct from v_claim.base_sha
     or v_task.branch_name is distinct from v_binding.branch_name or v_task.role is distinct from v_claim.role
     or v_task.lease_agent_id is distinct from v_claim.agent_id or v_task.lease_tab_id is distinct from v_claim.tab_id
     or v_task.lease_target_id is distinct from v_claim.target_id
     or v_task.lease_agent_generation_epoch is distinct from v_claim.agent_generation_epoch
     or v_task.lease_generation is distinct from v_claim.lease_generation
     or v_task.lease_expires_at is distinct from v_claim.expires_at or v_task.lease_expires_at<=v_now then
    raise exception 'MANAGED_PROJECT_TASK_NOT_CURRENT' using errcode='55000';
  end if;

  v_control := public.devos_environment_state_v1(p_coordination_workspace_id);
  if v_control->>'schema' is distinct from 'metaengine.devos.environment-state.v1'
     or (v_control->>'authority_effect')::boolean is distinct from false
     or (v_control->>'refill_enabled')::boolean is distinct from true
     or (v_control->>'supervisor_admission_enabled')::boolean is distinct from true
     or coalesce((v_control->>'generation_floor')::bigint,0)>v_claim.lease_generation then
    raise exception 'MANAGED_PROJECT_ENVIRONMENT_FENCED' using errcode='55000';
  end if;

  -- Read the same signed client's fresh physical incarnation, never the latest
  -- snapshot of another device. This telemetry can deny an existing DB claim.
  select destruktion_meta.devos_normalize_native_supervisor_state_h205f22(s.state),s.last_seen_at
    into v_state,v_seen from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
    where s.client_id=p_client_id and s.workspace_id=p_coordination_workspace_id for share;
  if not found or v_seen<v_now-interval '45 seconds' or v_seen>v_now+interval '5 seconds'
     or v_state->>'schema' is distinct from 'metaengine.native-browser-supervisor.state.v1'
     or v_state->'fleet'->>'schema' is distinct from 'metaengine.browser.fleet-snapshot.v1'
     or v_state->'fleet'->>'readiness_contract' is distinct from 'TRANSPORT_PROOF_REQUIRED'
     or jsonb_typeof(v_state->'fleet'->'agents') is distinct from 'array' then
    raise exception 'MANAGED_PROJECT_DEVICE_SNAPSHOT_STALE' using errcode='55000';
  end if;
  -- The outer row flag records CONTROL/armed ingestion provenance. The signed
  -- heartbeat identity, rather than that flag, binds the physical client to
  -- the exact currently approved device and key.
  v_transport_identity:=v_state->'transport_identity';
  if v_state->>'client_kind' is distinct from 'METAENGINE_BROWSER_ELECTRON_NATIVE'
     or jsonb_typeof(v_transport_identity) is distinct from 'object'
     or v_transport_identity->>'profile' is distinct from 'A2_DEVICE_HTTP_SIGNATURE_V1'
     or v_transport_identity->>'profile' is distinct from v_device.profile
     or lower(v_transport_identity->>'device_id') is distinct from p_device_id::text
     or lower(v_transport_identity->>'key_fingerprint_sha256') is distinct from lower(v_device.key_fingerprint_sha256)
     or coalesce(v_transport_identity->>'key_fingerprint_sha256','') !~ '^[0-9a-f]{64}$'
     or v_transport_identity->>'access_tier' is distinct from 'ADMIN'
     or (v_transport_identity->>'admin_grant_epoch')::bigint is distinct from p_admin_grant_epoch
     or (v_transport_identity->>'admin_ready')::boolean is distinct from true then
    raise exception 'MANAGED_PROJECT_DEVICE_SNAPSHOT_IDENTITY_DRIFT' using errcode='55000';
  end if;
  select jsonb_agg(a.value) into v_agents from jsonb_array_elements(v_state->'fleet'->'agents') a(value)
    where a.value->>'agent_id'=v_claim.agent_id;
  if coalesce(jsonb_array_length(v_agents),0)<>1 then raise exception 'MANAGED_PROJECT_AGENT_AMBIGUOUS' using errcode='55000'; end if;
  v_agent:=v_agents->0;
  if v_agent->>'ownership' is distinct from 'FLEET_OWNED' or v_agent->>'lifecycle_state' is distinct from 'ACTIVE'
     or (v_agent->>'authority_effect')::boolean is distinct from false
     or (v_agent->>'automatic_retry_allowed')::boolean is distinct from false
     or v_agent->>'role' is distinct from v_claim.role or v_agent->>'tab_id' is distinct from v_claim.tab_id
     or v_agent->>'target_id' is distinct from v_claim.target_id
     or (v_agent->>'generation_epoch')::bigint is distinct from v_claim.agent_generation_epoch then
    raise exception 'MANAGED_PROJECT_AGENT_NOT_CURRENT' using errcode='55000';
  end if;
  v_proof:=v_agent->'transport_proof';
  if v_proof->>'schema' is distinct from 'metaengine.browser.fleet-transport-proof.v1'
     or (v_proof->>'authority_effect')::boolean is distinct from false
     or v_proof->>'tab_id' is distinct from v_claim.tab_id or v_proof->>'target_id' is distinct from v_claim.target_id
     or (v_proof->>'generation_epoch')::bigint is distinct from v_claim.agent_generation_epoch
     or coalesce(v_proof->>'conversation_url_sha256','') !~ '^[0-9a-f]{64}$' then
    raise exception 'MANAGED_PROJECT_TRANSPORT_NOT_CURRENT' using errcode='55000';
  end if;
  begin v_proven_at:=(v_proof->>'proven_at')::timestamptz;
  exception when others then raise exception 'MANAGED_PROJECT_TRANSPORT_TIME_INVALID' using errcode='55000'; end;
  if v_proven_at is null or v_proven_at>v_seen+interval '5 seconds' then
    raise exception 'MANAGED_PROJECT_TRANSPORT_TIME_INVALID' using errcode='55000';
  end if;

  return jsonb_build_object(
    'schema','metaengine.devos.managed-project-admission.v1','authoritative',true,'active',true,
    'device_id',p_device_id,'client_id',p_client_id,'admin_grant_epoch',p_admin_grant_epoch,'observed_at',v_now,
    'claim',jsonb_build_object('coordination_workspace_id',v_claim.workspace_id,'task_id',v_claim.task_id,
      'claim_id',v_claim.claim_id,'point_id',v_claim.point_id,'claim_class',v_claim.claim_class,'base_sha',v_claim.base_sha,
      'branch_name',v_task.branch_name,'agent_id',v_claim.agent_id,'tab_id',v_claim.tab_id,'target_id',v_claim.target_id,
      'agent_generation_epoch',v_claim.agent_generation_epoch,'lease_generation',v_claim.lease_generation,
      'lease_expires_at',v_claim.expires_at),
    'workspace_binding',to_jsonb(v_binding)||jsonb_build_object('schema','metaengine.devos.workspace-binding.v1','lease_expires_at',v_claim.expires_at),
    'automatic_retry_allowed',false,'scheduler_authority',false,'browser_actuation_authority',false,'authority_effect',false
  );
end;
$$;
revoke all on function destruktion_meta.a2_managed_project_admission_read_h205f22(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint,boolean) from public,anon,authenticated,service_role;

create or replace function public.h205f22_a2_managed_project_admission_v1(
  p_coordination_workspace_id uuid, p_task_id uuid, p_agent_id text,
  p_claim_id bigint, p_lease_generation bigint, p_workspace_id uuid,
  p_workspace_generation bigint, p_device_id uuid, p_client_id text, p_admin_grant_epoch bigint
) returns jsonb language sql security definer
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
  select destruktion_meta.a2_managed_project_admission_read_h205f22(
    p_coordination_workspace_id,p_task_id,p_agent_id,p_claim_id,p_lease_generation,
    p_workspace_id,p_workspace_generation,p_device_id,p_client_id,p_admin_grant_epoch,false);
$$;
revoke all on function public.h205f22_a2_managed_project_admission_v1(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.h205f22_a2_managed_project_admission_v1(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint) to service_role;

create or replace function public.h205f22_a2_managed_project_binding_effect_v1(
  p_coordination_workspace_id uuid, p_task_id uuid, p_agent_id text,
  p_claim_id bigint, p_lease_generation bigint, p_workspace_id uuid,
  p_workspace_generation bigint, p_device_id uuid, p_client_id text, p_admin_grant_epoch bigint,
  p_operation text, p_effect_state text, p_head_sha text, p_locked boolean,
  p_realpath_verified boolean, p_ambiguity_code text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare v_admission jsonb; v_binding public.compute_fabric_a2_workspace_binding_h205f22%rowtype; v_result jsonb;
begin
  if p_operation not in ('reserve','readback') or p_operation is null then raise exception 'MANAGED_PROJECT_OPERATION_INVALID' using errcode='22023'; end if;
  -- The mutation and final authority read share one transaction and row fence.
  perform 1 from public.compute_fabric_a2_workspace_binding_h205f22 where workspace_id=p_workspace_id and retired_at is null for update;
  v_admission:=destruktion_meta.a2_managed_project_admission_read_h205f22(
    p_coordination_workspace_id,p_task_id,p_agent_id,p_claim_id,p_lease_generation,
    p_workspace_id,p_workspace_generation,p_device_id,p_client_id,p_admin_grant_epoch,p_operation='readback');
  select * into v_binding from public.compute_fabric_a2_workspace_binding_h205f22 where workspace_id=p_workspace_id and retired_at is null;
  if p_operation='reserve' then
    if v_binding.state<>'RESERVED' or p_effect_state is not null or p_head_sha is not null
       or p_locked is distinct from false or p_realpath_verified is distinct from false or p_ambiguity_code is not null then
      raise exception 'MANAGED_PROJECT_RESERVE_INVALID' using errcode='55000';
    end if;
  elsif p_effect_state='PROVEN' then
    if p_head_sha is distinct from v_binding.base_sha or p_locked is distinct from true
       or p_realpath_verified is distinct from true or p_ambiguity_code is not null or v_binding.state='FROZEN' then
      raise exception 'MANAGED_PROJECT_RECEIPT_INVALID' using errcode='55000';
    end if;
  elsif p_effect_state='AMBIGUOUS' then
    if p_head_sha is not null or p_locked is distinct from false or p_realpath_verified is distinct from false
       or coalesce(p_ambiguity_code,'') !~ '^[A-Z0-9_]{1,96}$' or v_binding.state='READY'
       or (v_binding.state='FROZEN' and v_binding.ambiguity_code is distinct from p_ambiguity_code) then
      raise exception 'MANAGED_PROJECT_RECEIPT_INVALID' using errcode='55000';
    end if;
  else raise exception 'MANAGED_PROJECT_RECEIPT_INVALID' using errcode='22023'; end if;

  update public.compute_fabric_a2_workspace_binding_h205f22
    set lease_expires_at=(v_admission->'claim'->>'lease_expires_at')::timestamptz,updated_at=clock_timestamp()
    where binding_id=v_binding.binding_id returning * into v_binding;
  if p_operation='reserve' then
    return jsonb_build_object('ok',true,'operation','reserve','binding',to_jsonb(v_binding)||jsonb_build_object('schema','metaengine.devos.workspace-binding.v1'),'automatic_retry_allowed',false,'authority_effect',false);
  end if;
  v_result:=public.h205f22_a2_workspace_binding_readback_v1(v_binding.workspace_id,v_binding.task_id,
    v_binding.agent_id,v_binding.lease_generation,v_binding.branch_name,v_binding.worktree_path,p_effect_state,
    p_head_sha,case when p_effect_state='PROVEN' then v_binding.worktree_path else null end,p_ambiguity_code);
  return v_result||jsonb_build_object('binding',(v_result->'binding')||jsonb_build_object('schema','metaengine.devos.workspace-binding.v1'),'automatic_retry_allowed',false);
end;
$$;
revoke all on function public.h205f22_a2_managed_project_binding_effect_v1(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint,text,text,text,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.h205f22_a2_managed_project_binding_effect_v1(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint,text,text,text,boolean,boolean,text) to service_role;
notify pgrst,'reload schema';
