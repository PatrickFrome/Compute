-- METAENGINE DevBrowser durable Workspace Binding registry v1.
-- Branch-local migration only. Do not apply to production from this implementation task.
--
-- Safety invariants:
--   * one active mutating workspace per agent, target branch, worktree path and task;
--   * RESERVED, READY and FROZEN all retain the active fence;
--   * exact task/agent/lease/branch/worktree identity is required for every mutation;
--   * ambiguous materialization/retirement freezes the binding; it never frees a fence;
--   * page/model/worker text has no authority and no RPC accepts executable text.

-- Deliberately fail if this relation already exists. A migration collision must not silently
-- adopt an unknown/pre-existing registry schema and weaken any fence below.
create table public.compute_fabric_a2_workspace_binding_h205f22 (
  binding_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  workspace_generation bigint not null,
  worktree_id uuid not null,
  coordination_workspace_id uuid not null,
  task_id uuid not null,
  claim_id bigint not null,
  point_id text not null,
  claim_class text not null default 'MUTATING',
  repo_id text not null,
  repo_root text not null,
  managed_root text not null,
  worktree_path text not null,
  base_sha text not null,
  branch_name text not null,
  agent_id text not null,
  tab_id text not null,
  target_id text not null,
  agent_generation_epoch bigint not null,
  lease_generation bigint not null,
  lease_expires_at timestamptz not null,
  state text not null default 'RESERVED',
  initial_head_sha text,
  last_verified_head_sha text,
  worktree_realpath text,
  ambiguity_code text,
  dirty_hold boolean not null default false,
  automatic_retry_allowed boolean not null default false,
  page_data_authority boolean not null default false,
  authority_effect boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,

  constraint a2_workspace_binding_workspace_generation_ck check (workspace_generation > 0),
  constraint a2_workspace_binding_claim_id_ck check (claim_id > 0),
  constraint a2_workspace_binding_claim_class_ck check (claim_class = 'MUTATING'),
  constraint a2_workspace_binding_agent_generation_ck check (agent_generation_epoch > 0),
  constraint a2_workspace_binding_lease_generation_ck check (lease_generation > 0),
  constraint a2_workspace_binding_state_ck check (state in ('RESERVED','READY','FROZEN','RETIRED')),
  constraint a2_workspace_binding_sha_ck check (base_sha ~ '^[0-9a-f]{40}$'),
  constraint a2_workspace_binding_initial_sha_ck check (initial_head_sha is null or initial_head_sha ~ '^[0-9a-f]{40}$'),
  constraint a2_workspace_binding_last_sha_ck check (last_verified_head_sha is null or last_verified_head_sha ~ '^[0-9a-f]{40}$'),
  constraint a2_workspace_binding_agent_ck check (agent_id ~ '^agent_[a-z0-9-]{8,64}$'),
  constraint a2_workspace_binding_branch_ck check (
    length(branch_name) between 3 and 200
    and branch_name !~ '(^|/)\.\.(/|$)'
    and branch_name not like '%//%'
    and branch_name !~ '\.lock$'
  ),
  constraint a2_workspace_binding_path_ck check (
    length(worktree_path) between 1 and 4096
    and length(repo_root) between 1 and 4096
    and length(managed_root) between 1 and 4096
  ),
  constraint a2_workspace_binding_ready_ck check (
    state <> 'READY'
    or (
      initial_head_sha = base_sha
      and last_verified_head_sha is not null
      and worktree_realpath = worktree_path
      and ambiguity_code is null
    )
  ),
  constraint a2_workspace_binding_frozen_ck check (state <> 'FROZEN' or ambiguity_code is not null),
  constraint a2_workspace_binding_retired_ck check ((state = 'RETIRED') = (retired_at is not null)),
  constraint a2_workspace_binding_retry_ck check (automatic_retry_allowed = false),
  constraint a2_workspace_binding_page_authority_ck check (page_data_authority = false),
  constraint a2_workspace_binding_authority_effect_ck check (authority_effect = false),
  constraint a2_workspace_binding_workspace_generation_uq unique (workspace_id, workspace_generation)
);

-- FROZEN remains active by design. Only a proven RETIRED transition releases these fences.
create unique index compute_fabric_a2_workspace_binding_active_agent_uq
  on public.compute_fabric_a2_workspace_binding_h205f22(agent_id)
  where retired_at is null;

create unique index compute_fabric_a2_workspace_binding_active_branch_uq
  on public.compute_fabric_a2_workspace_binding_h205f22(branch_name)
  where retired_at is null;

-- lower(path) is intentionally conservative across Windows/Linux fleets: aliases that differ
-- only by case fail closed instead of permitting two mutating workspaces on one physical path.
create unique index compute_fabric_a2_workspace_binding_active_worktree_uq
  on public.compute_fabric_a2_workspace_binding_h205f22(lower(worktree_path))
  where retired_at is null;

create unique index compute_fabric_a2_workspace_binding_active_task_uq
  on public.compute_fabric_a2_workspace_binding_h205f22(task_id)
  where retired_at is null;

create index compute_fabric_a2_workspace_binding_identity_idx
  on public.compute_fabric_a2_workspace_binding_h205f22(workspace_id,task_id,agent_id,lease_generation);

alter table public.compute_fabric_a2_workspace_binding_h205f22 enable row level security;
revoke all on table public.compute_fabric_a2_workspace_binding_h205f22 from public, anon, authenticated;

create or replace function public.h205f22_a2_workspace_binding_register_v1(
  p_workspace_id uuid,
  p_workspace_generation bigint,
  p_worktree_id uuid,
  p_coordination_workspace_id uuid,
  p_task_id uuid,
  p_claim_id bigint,
  p_point_id text,
  p_repo_id text,
  p_repo_root text,
  p_managed_root text,
  p_worktree_path text,
  p_base_sha text,
  p_branch_name text,
  p_agent_id text,
  p_tab_id text,
  p_target_id text,
  p_agent_generation_epoch bigint,
  p_lease_generation bigint,
  p_lease_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.compute_fabric_a2_workspace_binding_h205f22%rowtype;
  v_agent text := lower(trim(coalesce(p_agent_id,'')));
  v_branch text := trim(coalesce(p_branch_name,''));
  v_worktree text := trim(coalesce(p_worktree_path,''));
  v_base text := lower(trim(coalesce(p_base_sha,'')));
  v_now timestamptz := clock_timestamp();
begin
  if p_workspace_id is null or p_worktree_id is null or p_coordination_workspace_id is null or p_task_id is null then
    raise exception 'workspace_binding_identity_required';
  end if;
  if coalesce(p_workspace_generation,0) < 1 or coalesce(p_claim_id,0) < 1
     or coalesce(p_agent_generation_epoch,0) < 1 or coalesce(p_lease_generation,0) < 1 then
    raise exception 'workspace_binding_generation_invalid';
  end if;
  if p_lease_expires_at is null or p_lease_expires_at <= v_now then
    raise exception 'workspace_binding_lease_expired';
  end if;
  if v_agent !~ '^agent_[a-z0-9-]{8,64}$' then raise exception 'workspace_binding_agent_invalid'; end if;
  if v_base !~ '^[0-9a-f]{40}$' then raise exception 'workspace_binding_base_sha_invalid'; end if;
  if length(v_branch) not between 3 and 200 or v_branch ~ '(^|/)\.\.(/|$)'
     or v_branch like '%//%' or v_branch ~ '\.lock$' then
    raise exception 'workspace_binding_branch_invalid';
  end if;
  if v_worktree = '' or length(v_worktree) > 4096 then raise exception 'workspace_binding_worktree_invalid'; end if;
  if trim(coalesce(p_point_id,'')) = '' or trim(coalesce(p_repo_id,'')) = ''
     or trim(coalesce(p_repo_root,'')) = '' or trim(coalesce(p_managed_root,'')) = ''
     or trim(coalesce(p_tab_id,'')) = '' or trim(coalesce(p_target_id,'')) = '' then
    raise exception 'workspace_binding_trusted_identity_incomplete';
  end if;

  select * into v_row
    from public.compute_fabric_a2_workspace_binding_h205f22
   where workspace_id = p_workspace_id and retired_at is null
   for update;

  if found then
    if v_row.workspace_generation <> p_workspace_generation
       or v_row.worktree_id <> p_worktree_id
       or v_row.coordination_workspace_id <> p_coordination_workspace_id
       or v_row.task_id <> p_task_id
       or v_row.claim_id <> p_claim_id
       or v_row.point_id <> lower(trim(coalesce(p_point_id,'')))
       or v_row.repo_id <> trim(coalesce(p_repo_id,''))
       or v_row.repo_root <> trim(coalesce(p_repo_root,''))
       or v_row.managed_root <> trim(coalesce(p_managed_root,''))
       or lower(v_row.worktree_path) <> lower(v_worktree)
       or v_row.base_sha <> v_base
       or v_row.branch_name <> v_branch
       or v_row.agent_id <> v_agent
       or v_row.tab_id <> lower(trim(coalesce(p_tab_id,'')))
       or v_row.target_id <> lower(trim(coalesce(p_target_id,'')))
       or v_row.agent_generation_epoch <> p_agent_generation_epoch
       or v_row.lease_generation <> p_lease_generation then
      raise exception 'workspace_binding_exact_identity_conflict';
    end if;

    update public.compute_fabric_a2_workspace_binding_h205f22
       set lease_expires_at = greatest(lease_expires_at,p_lease_expires_at),
           updated_at = v_now
     where binding_id = v_row.binding_id
     returning * into v_row;

    return jsonb_build_object(
      'ok',true,'operation','register','reused',true,'binding',to_jsonb(v_row),
      'automatic_retry_allowed',false,'authority_effect',false
    );
  end if;

  begin
    insert into public.compute_fabric_a2_workspace_binding_h205f22(
      workspace_id,workspace_generation,worktree_id,coordination_workspace_id,
      task_id,claim_id,point_id,claim_class,repo_id,repo_root,managed_root,worktree_path,
      base_sha,branch_name,agent_id,tab_id,target_id,agent_generation_epoch,
      lease_generation,lease_expires_at,state,automatic_retry_allowed,page_data_authority,authority_effect
    ) values (
      p_workspace_id,p_workspace_generation,p_worktree_id,p_coordination_workspace_id,
      p_task_id,p_claim_id,lower(trim(coalesce(p_point_id,''))),'MUTATING',trim(coalesce(p_repo_id,'')),
      trim(coalesce(p_repo_root,'')),trim(coalesce(p_managed_root,'')),v_worktree,
      v_base,v_branch,v_agent,lower(trim(coalesce(p_tab_id,''))),lower(trim(coalesce(p_target_id,''))),
      p_agent_generation_epoch,p_lease_generation,p_lease_expires_at,'RESERVED',false,false,false
    ) returning * into v_row;
  exception when unique_violation then
    -- A concurrent exact register can be treated as idempotent; any different owner/path/task
    -- stays a hard conflict. This is DB idempotency, not permission to retry a browser effect.
    select * into v_row
      from public.compute_fabric_a2_workspace_binding_h205f22
     where retired_at is null
       and (
         agent_id = v_agent
         or branch_name = v_branch
         or lower(worktree_path) = lower(v_worktree)
         or task_id = p_task_id
       )
     order by created_at asc
     limit 1;

    if not found
       or v_row.workspace_id <> p_workspace_id
       or v_row.workspace_generation <> p_workspace_generation
       or v_row.worktree_id <> p_worktree_id
       or v_row.coordination_workspace_id <> p_coordination_workspace_id
       or v_row.task_id <> p_task_id
       or v_row.claim_id <> p_claim_id
       or v_row.point_id <> lower(trim(coalesce(p_point_id,'')))
       or v_row.repo_id <> trim(coalesce(p_repo_id,''))
       or v_row.repo_root <> trim(coalesce(p_repo_root,''))
       or v_row.managed_root <> trim(coalesce(p_managed_root,''))
       or v_row.base_sha <> v_base
       or v_row.branch_name <> v_branch
       or v_row.agent_id <> v_agent
       or lower(v_row.worktree_path) <> lower(v_worktree)
       or v_row.tab_id <> lower(trim(coalesce(p_tab_id,'')))
       or v_row.target_id <> lower(trim(coalesce(p_target_id,'')))
       or v_row.agent_generation_epoch <> p_agent_generation_epoch
       or v_row.lease_generation <> p_lease_generation then
      raise exception 'workspace_binding_active_fence_conflict';
    end if;
  end;

  return jsonb_build_object(
    'ok',true,'operation','register','reused',false,'binding',to_jsonb(v_row),
    'automatic_retry_allowed',false,'authority_effect',false
  );
end;
$$;

create or replace function public.h205f22_a2_workspace_binding_readback_v1(
  p_workspace_id uuid,
  p_task_id uuid,
  p_agent_id text,
  p_lease_generation bigint,
  p_branch_name text,
  p_worktree_path text,
  p_effect_state text,
  p_initial_head_sha text default null,
  p_worktree_realpath text default null,
  p_ambiguity_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.compute_fabric_a2_workspace_binding_h205f22%rowtype;
  v_effect text := upper(trim(coalesce(p_effect_state,'')));
  v_head text := lower(trim(coalesce(p_initial_head_sha,'')));
  v_realpath text := trim(coalesce(p_worktree_realpath,''));
  v_ambiguity text := upper(trim(coalesce(p_ambiguity_code,'')));
  v_now timestamptz := clock_timestamp();
begin
  select * into v_row
    from public.compute_fabric_a2_workspace_binding_h205f22
   where workspace_id = p_workspace_id
     and task_id = p_task_id
     and agent_id = lower(trim(coalesce(p_agent_id,'')))
     and lease_generation = p_lease_generation
     and branch_name = trim(coalesce(p_branch_name,''))
     and lower(worktree_path) = lower(trim(coalesce(p_worktree_path,'')))
     and retired_at is null
   for update;

  if not found then raise exception 'workspace_binding_exact_identity_not_active'; end if;
  if v_row.state = 'FROZEN' then
    return jsonb_build_object('ok',true,'operation','readback','binding',to_jsonb(v_row),'authority_effect',false);
  end if;
  if v_row.state = 'READY' then
    if v_effect = 'PROVEN' and v_head = v_row.base_sha and v_realpath = v_row.worktree_path then
      return jsonb_build_object('ok',true,'operation','readback','binding',to_jsonb(v_row),'authority_effect',false);
    end if;
    raise exception 'workspace_binding_ready_readback_conflict';
  end if;
  if v_row.state <> 'RESERVED' then raise exception 'workspace_binding_readback_state_invalid'; end if;

  if v_effect <> 'PROVEN' then
    update public.compute_fabric_a2_workspace_binding_h205f22
       set state='FROZEN',
           ambiguity_code=coalesce(nullif(v_ambiguity,''),'MATERIALIZATION_EFFECT_AMBIGUOUS'),
           updated_at=v_now
     where binding_id=v_row.binding_id
     returning * into v_row;
  elsif v_row.lease_expires_at <= v_now then
    update public.compute_fabric_a2_workspace_binding_h205f22
       set state='FROZEN',ambiguity_code='LEASE_EXPIRED_BEFORE_READY',updated_at=v_now
     where binding_id=v_row.binding_id
     returning * into v_row;
  elsif v_head !~ '^[0-9a-f]{40}$' then
    update public.compute_fabric_a2_workspace_binding_h205f22
       set state='FROZEN',initial_head_sha=null,ambiguity_code='INITIAL_HEAD_INVALID',updated_at=v_now
     where binding_id=v_row.binding_id
     returning * into v_row;
  elsif v_head <> v_row.base_sha then
    update public.compute_fabric_a2_workspace_binding_h205f22
       set state='FROZEN',initial_head_sha=v_head,ambiguity_code='INITIAL_HEAD_MISMATCH',updated_at=v_now
     where binding_id=v_row.binding_id
     returning * into v_row;
  elsif v_realpath <> v_row.worktree_path then
    update public.compute_fabric_a2_workspace_binding_h205f22
       set state='FROZEN',initial_head_sha=v_head,worktree_realpath=nullif(v_realpath,''),
           ambiguity_code='WORKTREE_REALPATH_MISMATCH',updated_at=v_now
     where binding_id=v_row.binding_id
     returning * into v_row;
  else
    update public.compute_fabric_a2_workspace_binding_h205f22
       set state='READY',initial_head_sha=v_head,last_verified_head_sha=v_head,
           worktree_realpath=v_realpath,ambiguity_code=null,updated_at=v_now
     where binding_id=v_row.binding_id
     returning * into v_row;
  end if;

  return jsonb_build_object(
    'ok',true,'operation','readback','binding',to_jsonb(v_row),
    'automatic_retry_allowed',false,'authority_effect',false
  );
end;
$$;

create or replace function public.h205f22_a2_workspace_binding_retire_v1(
  p_workspace_id uuid,
  p_task_id uuid,
  p_agent_id text,
  p_lease_generation bigint,
  p_branch_name text,
  p_worktree_path text,
  p_final_head_sha text,
  p_durable_reference_count integer,
  p_dirty boolean,
  p_branch_ambiguous boolean,
  p_effect_state text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.compute_fabric_a2_workspace_binding_h205f22%rowtype;
  v_final_head text := lower(trim(coalesce(p_final_head_sha,'')));
  v_effect text := upper(trim(coalesce(p_effect_state,'')));
  v_now timestamptz := clock_timestamp();
begin
  select * into v_row
    from public.compute_fabric_a2_workspace_binding_h205f22
   where workspace_id = p_workspace_id
     and task_id = p_task_id
     and agent_id = lower(trim(coalesce(p_agent_id,'')))
     and lease_generation = p_lease_generation
     and branch_name = trim(coalesce(p_branch_name,''))
     and lower(worktree_path) = lower(trim(coalesce(p_worktree_path,'')))
     and retired_at is null
   for update;

  if not found then raise exception 'workspace_binding_exact_identity_not_active'; end if;
  if v_row.state = 'FROZEN' then raise exception 'workspace_binding_retire_frozen'; end if;
  if v_row.state <> 'READY' then raise exception 'workspace_binding_retire_state_invalid'; end if;
  if coalesce(p_durable_reference_count,-1) <> 0 then raise exception 'workspace_binding_cleanup_referenced'; end if;
  if coalesce(p_dirty,true) then raise exception 'workspace_binding_cleanup_dirty'; end if;
  if coalesce(p_branch_ambiguous,true) then raise exception 'workspace_binding_cleanup_ambiguous'; end if;
  if v_final_head !~ '^[0-9a-f]{40}$' then raise exception 'workspace_binding_final_head_invalid'; end if;

  if v_effect <> 'PROVEN' then
    update public.compute_fabric_a2_workspace_binding_h205f22
       set state='FROZEN',ambiguity_code='RETIREMENT_EFFECT_AMBIGUOUS',
           last_verified_head_sha=v_final_head,updated_at=v_now
     where binding_id=v_row.binding_id
     returning * into v_row;
    return jsonb_build_object(
      'ok',true,'operation','retire','retired',false,'binding',to_jsonb(v_row),
      'automatic_retry_allowed',false,'authority_effect',false
    );
  end if;

  update public.compute_fabric_a2_workspace_binding_h205f22
     set state='RETIRED',last_verified_head_sha=v_final_head,retired_at=v_now,updated_at=v_now
   where binding_id=v_row.binding_id
   returning * into v_row;

  return jsonb_build_object(
    'ok',true,'operation','retire','retired',true,'binding',to_jsonb(v_row),
    'automatic_retry_allowed',false,'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_a2_workspace_binding_register_v1(uuid,bigint,uuid,uuid,uuid,bigint,text,text,text,text,text,text,text,text,text,text,bigint,bigint,timestamptz) from public, anon, authenticated;
revoke all on function public.h205f22_a2_workspace_binding_readback_v1(uuid,uuid,text,bigint,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.h205f22_a2_workspace_binding_retire_v1(uuid,uuid,text,bigint,text,text,text,integer,boolean,boolean,text) from public, anon, authenticated;

grant execute on function public.h205f22_a2_workspace_binding_register_v1(uuid,bigint,uuid,uuid,uuid,bigint,text,text,text,text,text,text,text,text,text,text,bigint,bigint,timestamptz) to service_role;
grant execute on function public.h205f22_a2_workspace_binding_readback_v1(uuid,uuid,text,bigint,text,text,text,text,text,text) to service_role;
grant execute on function public.h205f22_a2_workspace_binding_retire_v1(uuid,uuid,text,bigint,text,text,text,integer,boolean,boolean,text) to service_role;
