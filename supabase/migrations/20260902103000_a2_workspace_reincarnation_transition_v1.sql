-- METAENGINE Workspace Reincarnation transition v1.
-- Source-only migration. Do not deploy from this PR.
--
-- Converts one already materialized READY Workspace binding from a dead Browser incarnation
-- to a separately scheduler-leased + C5-transport-proven successor. The row is updated in
-- place so active agent/branch/worktree/task uniqueness fences are never released.
-- No URL/title/page/model content participates in authority.

create table public.compute_fabric_a2_workspace_reincarnation_receipt_h205f22 (
  transition_id uuid primary key,
  binding_id uuid not null,
  workspace_id uuid not null,
  task_id uuid not null,
  predecessor_claim_id bigint not null,
  successor_claim_id bigint not null,
  predecessor_workspace_generation bigint not null,
  successor_workspace_generation bigint not null,
  predecessor_tab_id text not null,
  successor_tab_id text not null,
  predecessor_target_id text not null,
  successor_target_id text not null,
  predecessor_agent_generation_epoch bigint not null,
  successor_agent_generation_epoch bigint not null,
  predecessor_lease_generation bigint not null,
  successor_lease_generation bigint not null,
  base_sha text not null,
  verified_head_sha text not null,
  branch_name text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  automatic_retry_allowed boolean not null default false,
  page_data_authority boolean not null default false,
  authority_effect boolean not null default false,
  constraint a2_workspace_reincarnation_generation_ck check (
    predecessor_workspace_generation > 0
    and successor_workspace_generation = predecessor_workspace_generation + 1
    and successor_agent_generation_epoch > predecessor_agent_generation_epoch
    and successor_lease_generation > predecessor_lease_generation
  ),
  constraint a2_workspace_reincarnation_claim_ck check (
    predecessor_claim_id > 0 and successor_claim_id > 0 and successor_claim_id <> predecessor_claim_id
  ),
  constraint a2_workspace_reincarnation_tab_ck check (successor_tab_id <> predecessor_tab_id),
  constraint a2_workspace_reincarnation_target_ck check (lower(successor_target_id) <> lower(predecessor_target_id)),
  constraint a2_workspace_reincarnation_sha_ck check (
    base_sha ~ '^[0-9a-f]{40}$' and verified_head_sha ~ '^[0-9a-f]{40}$'
  ),
  constraint a2_workspace_reincarnation_retry_ck check (automatic_retry_allowed = false),
  constraint a2_workspace_reincarnation_page_authority_ck check (page_data_authority = false),
  constraint a2_workspace_reincarnation_authority_ck check (authority_effect = false),
  constraint a2_workspace_reincarnation_once_uq unique (
    binding_id, predecessor_workspace_generation, successor_workspace_generation
  )
);

alter table public.compute_fabric_a2_workspace_reincarnation_receipt_h205f22 enable row level security;
revoke all on table public.compute_fabric_a2_workspace_reincarnation_receipt_h205f22 from public, anon, authenticated;

create or replace function public.h205f22_a2_workspace_reincarnation_transition_v1(
  p_transition_id uuid,
  p_binding_id uuid,
  p_workspace_id uuid,
  p_expected_workspace_generation bigint,
  p_expected_claim_id bigint,
  p_expected_tab_id text,
  p_expected_target_id text,
  p_expected_agent_generation_epoch bigint,
  p_expected_lease_generation bigint,
  p_successor_claim_id bigint,
  p_successor_tab_id text,
  p_successor_target_id text,
  p_successor_agent_generation_epoch bigint,
  p_successor_lease_generation bigint,
  p_verified_head_sha text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public.compute_fabric_a2_workspace_binding_h205f22%rowtype;
  v_claim destruktion_meta.devos_fleet_claim_h205f22%rowtype;
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_existing public.compute_fabric_a2_workspace_reincarnation_receipt_h205f22%rowtype;
  v_supervisor jsonb;
  v_supervisor_seen timestamptz;
  v_agent jsonb;
  v_proof jsonb;
  v_proven_at timestamptz;
  v_expected_tab text := lower(trim(coalesce(p_expected_tab_id,'')));
  v_expected_target text := lower(trim(coalesce(p_expected_target_id,'')));
  v_successor_tab text := lower(trim(coalesce(p_successor_tab_id,'')));
  v_successor_target text := lower(trim(coalesce(p_successor_target_id,'')));
  v_verified_head text := lower(trim(coalesce(p_verified_head_sha,'')));
begin
  if p_transition_id is null or p_binding_id is null or p_workspace_id is null then
    raise exception 'workspace_reincarnation_identity_required' using errcode = '22023';
  end if;

  select * into v_existing
    from public.compute_fabric_a2_workspace_reincarnation_receipt_h205f22
   where transition_id = p_transition_id;
  if found then
    if v_existing.binding_id <> p_binding_id or v_existing.workspace_id <> p_workspace_id then
      raise exception 'workspace_reincarnation_transition_id_collision' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'schema','metaengine.devos.workspace-reincarnation-transition.v1',
      'transition_id',v_existing.transition_id,
      'binding_id',v_existing.binding_id,
      'workspace_id',v_existing.workspace_id,
      'workspace_generation',v_existing.successor_workspace_generation,
      'claim_id',v_existing.successor_claim_id,
      'tab_id',v_existing.successor_tab_id,
      'target_id',v_existing.successor_target_id,
      'agent_generation_epoch',v_existing.successor_agent_generation_epoch,
      'lease_generation',v_existing.successor_lease_generation,
      'transition_already_performed',true,
      'reconciled_from_durable_receipt',true,
      'automatic_retry_allowed',false,
      'authority_effect',false
    );
  end if;

  select * into v_row
    from public.compute_fabric_a2_workspace_binding_h205f22
   where binding_id = p_binding_id
     and workspace_id = p_workspace_id
   for update;
  if not found then raise exception 'workspace_reincarnation_binding_missing' using errcode = '55000'; end if;

  if v_row.state <> 'READY' or v_row.ambiguity_code is not null or v_row.dirty_hold
     or v_row.automatic_retry_allowed <> false or v_row.authority_effect <> false then
    raise exception 'workspace_reincarnation_predecessor_not_clean_ready' using errcode = '55000';
  end if;

  if v_row.workspace_generation <> p_expected_workspace_generation
     or v_row.claim_id <> p_expected_claim_id
     or lower(v_row.tab_id) <> v_expected_tab
     or lower(v_row.target_id) <> v_expected_target
     or v_row.agent_generation_epoch <> p_expected_agent_generation_epoch
     or v_row.lease_generation <> p_expected_lease_generation then
    raise exception 'workspace_reincarnation_predecessor_cas_miss' using errcode = '40001';
  end if;

  if coalesce(p_successor_claim_id,0) < 1 or p_successor_claim_id = v_row.claim_id
     or coalesce(p_successor_agent_generation_epoch,0) <= v_row.agent_generation_epoch
     or coalesce(p_successor_lease_generation,0) <= v_row.lease_generation
     or v_successor_tab = '' or v_successor_tab = lower(v_row.tab_id)
     or v_successor_target = '' or v_successor_target = lower(v_row.target_id)
     or v_verified_head !~ '^[0-9a-f]{40}$'
     or v_verified_head <> v_row.last_verified_head_sha then
    raise exception 'workspace_reincarnation_successor_candidate_invalid' using errcode = '22023';
  end if;

  select * into v_claim
    from destruktion_meta.devos_fleet_claim_h205f22
   where claim_id = p_successor_claim_id
   for share;
  if not found or v_claim.state <> 'ACTIVE' or v_claim.claim_class <> 'MUTATING'
     or v_claim.authority_effect <> false or v_claim.expires_at <= v_now
     or v_claim.workspace_id <> v_row.coordination_workspace_id
     or v_claim.task_id <> v_row.task_id or v_claim.point_id <> v_row.point_id
     or v_claim.base_sha <> v_row.base_sha or v_claim.agent_id <> v_row.agent_id
     or lower(v_claim.tab_id) <> v_successor_tab or lower(v_claim.target_id) <> v_successor_target
     or v_claim.agent_generation_epoch <> p_successor_agent_generation_epoch
     or v_claim.lease_generation <> p_successor_lease_generation then
    raise exception 'workspace_reincarnation_successor_claim_fenced' using errcode = '55000';
  end if;

  select * into v_task
    from destruktion_meta.devos_fleet_task_h205f22
   where task_id = v_row.task_id
   for share;
  if not found or v_task.state not in ('LEASED','RUNNING') or v_task.claim_class <> 'MUTATING'
     or v_task.authority_effect <> false or v_task.workspace_id <> v_row.coordination_workspace_id
     or v_task.point_id <> v_row.point_id or v_task.base_sha <> v_row.base_sha
     or trim(coalesce(v_task.branch_name,'')) <> v_row.branch_name
     or v_task.lease_agent_id <> v_row.agent_id
     or lower(v_task.lease_tab_id) <> v_successor_tab or lower(v_task.lease_target_id) <> v_successor_target
     or v_task.lease_agent_generation_epoch <> p_successor_agent_generation_epoch
     or v_task.lease_generation <> p_successor_lease_generation
     or v_task.lease_expires_at <> v_claim.expires_at or v_task.lease_expires_at <= v_now then
    raise exception 'workspace_reincarnation_scheduler_readback_fenced' using errcode = '55000';
  end if;

  -- Post-lock physical-incarnation revalidation. Reuse the existing 45s watchdog horizon.
  select s.state, s.last_seen_at into v_supervisor, v_supervisor_seen
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
   where s.workspace_id = v_row.coordination_workspace_id
     and s.authority_effect = false
     and s.state->>'schema' = 'metaengine.native-browser-supervisor.state.v1'
     and s.state->'fleet'->>'schema' = 'metaengine.browser.fleet-snapshot.v1'
     and s.state->'fleet'->>'readiness_contract' = 'TRANSPORT_PROOF_REQUIRED'
   order by s.last_seen_at desc
   limit 1;
  if not found or v_supervisor_seen < v_now - interval '45 seconds' then
    raise exception 'workspace_reincarnation_supervisor_stale' using errcode = '55000';
  end if;

  select a.value into v_agent
    from jsonb_array_elements(v_supervisor->'fleet'->'agents') a(value)
   where lower(a.value->>'agent_id') = lower(v_row.agent_id)
   limit 1;
  if not found or v_agent->>'ownership' <> 'FLEET_OWNED' or v_agent->>'lifecycle_state' <> 'ACTIVE'
     or coalesce((v_agent->>'authority_effect')::boolean,true) <> false
     or coalesce((v_agent->>'automatic_retry_allowed')::boolean,true) <> false
     or lower(v_agent->>'tab_id') <> v_successor_tab
     or lower(v_agent->>'target_id') <> v_successor_target
     or coalesce((v_agent->>'generation_epoch')::bigint,0) <> p_successor_agent_generation_epoch then
    raise exception 'workspace_reincarnation_fleet_incarnation_fenced' using errcode = '55000';
  end if;

  v_proof := v_agent->'transport_proof';
  if jsonb_typeof(v_proof) <> 'object' or v_proof->>'schema' <> 'metaengine.browser.fleet-transport-proof.v1'
     or coalesce((v_proof->>'authority_effect')::boolean,true) <> false
     or lower(v_proof->>'tab_id') <> v_successor_tab or lower(v_proof->>'target_id') <> v_successor_target
     or coalesce((v_proof->>'generation_epoch')::bigint,0) <> p_successor_agent_generation_epoch
     or coalesce(v_proof->>'conversation_url_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_proof->>'proven_at','') = '' then
    raise exception 'workspace_reincarnation_transport_proof_fenced' using errcode = '55000';
  end if;
  begin v_proven_at := (v_proof->>'proven_at')::timestamptz;
  exception when others then raise exception 'workspace_reincarnation_transport_proof_time_invalid' using errcode = '22007'; end;
  if v_proven_at > v_supervisor_seen + interval '5 seconds' then
    raise exception 'workspace_reincarnation_transport_proof_time_in_future' using errcode = '55000';
  end if;

  update public.compute_fabric_a2_workspace_binding_h205f22
     set workspace_generation = workspace_generation + 1,
         claim_id = v_claim.claim_id,
         tab_id = v_claim.tab_id,
         target_id = v_claim.target_id,
         agent_generation_epoch = v_claim.agent_generation_epoch,
         lease_generation = v_claim.lease_generation,
         lease_expires_at = v_claim.expires_at,
         last_verified_head_sha = v_verified_head,
         updated_at = v_now
   where binding_id = p_binding_id
     and workspace_id = p_workspace_id
     and workspace_generation = p_expected_workspace_generation
     and claim_id = p_expected_claim_id
     and lower(tab_id) = v_expected_tab
     and lower(target_id) = v_expected_target
     and agent_generation_epoch = p_expected_agent_generation_epoch
     and lease_generation = p_expected_lease_generation
     and state = 'READY'
     and ambiguity_code is null
     and dirty_hold = false
     and automatic_retry_allowed = false
     and authority_effect = false;
  if not found then raise exception 'workspace_reincarnation_commit_cas_miss' using errcode = '40001'; end if;

  insert into public.compute_fabric_a2_workspace_reincarnation_receipt_h205f22(
    transition_id,binding_id,workspace_id,task_id,predecessor_claim_id,successor_claim_id,
    predecessor_workspace_generation,successor_workspace_generation,predecessor_tab_id,successor_tab_id,
    predecessor_target_id,successor_target_id,predecessor_agent_generation_epoch,successor_agent_generation_epoch,
    predecessor_lease_generation,successor_lease_generation,base_sha,verified_head_sha,branch_name
  ) values (
    p_transition_id,v_row.binding_id,v_row.workspace_id,v_row.task_id,v_row.claim_id,v_claim.claim_id,
    v_row.workspace_generation,v_row.workspace_generation+1,v_row.tab_id,v_claim.tab_id,v_row.target_id,v_claim.target_id,
    v_row.agent_generation_epoch,v_claim.agent_generation_epoch,v_row.lease_generation,v_claim.lease_generation,
    v_row.base_sha,v_verified_head,v_row.branch_name
  );

  return jsonb_build_object(
    'schema','metaengine.devos.workspace-reincarnation-transition.v1',
    'transition_id',p_transition_id,'binding_id',v_row.binding_id,'workspace_id',v_row.workspace_id,
    'workspace_generation',v_row.workspace_generation+1,'claim_id',v_claim.claim_id,
    'tab_id',v_claim.tab_id,'target_id',v_claim.target_id,
    'agent_generation_epoch',v_claim.agent_generation_epoch,'lease_generation',v_claim.lease_generation,
    'transition_already_performed',false,'reconciled_from_durable_receipt',false,
    'automatic_retry_allowed',false,'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_a2_workspace_reincarnation_transition_v1(uuid,uuid,uuid,bigint,bigint,text,text,bigint,bigint,bigint,text,text,bigint,bigint,text) from public, anon, authenticated;
grant execute on function public.h205f22_a2_workspace_reincarnation_transition_v1(uuid,uuid,uuid,bigint,bigint,text,text,bigint,bigint,bigint,text,text,bigint,bigint,text) to service_role;

create or replace function public.h205f22_a2_workspace_reincarnation_receipt_v1(p_transition_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select jsonb_build_object(
      'schema','metaengine.devos.workspace-reincarnation-receipt.v1',
      'transition_id',r.transition_id,'binding_id',r.binding_id,'workspace_id',r.workspace_id,'task_id',r.task_id,
      'predecessor_workspace_generation',r.predecessor_workspace_generation,
      'successor_workspace_generation',r.successor_workspace_generation,
      'successor_claim_id',r.successor_claim_id,'successor_tab_id',r.successor_tab_id,
      'successor_target_id',r.successor_target_id,'successor_agent_generation_epoch',r.successor_agent_generation_epoch,
      'successor_lease_generation',r.successor_lease_generation,'occurred_at',r.occurred_at,
      'automatic_retry_allowed',false,'authority_effect',false
    ) from public.compute_fabric_a2_workspace_reincarnation_receipt_h205f22 r
      where r.transition_id = p_transition_id
  ), jsonb_build_object(
    'schema','metaengine.devos.workspace-reincarnation-receipt.v1','transition_id',p_transition_id,
    'found',false,'automatic_retry_allowed',false,'authority_effect',false
  ));
$$;

revoke all on function public.h205f22_a2_workspace_reincarnation_receipt_v1(uuid) from public, anon, authenticated;
grant execute on function public.h205f22_a2_workspace_reincarnation_receipt_v1(uuid) to service_role;
