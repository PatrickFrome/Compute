-- METAENGINE Meta-Orchestrator durable plan generation state v1.
-- Branch-local migration only. Do not apply to production from this convergence task.
--
-- This is not a scheduler, lease owner, Browser authority or release authority.
-- It only gives the semantic plan an atomic durable generation + digest so stale brains
-- cannot replay an old plan after roadmap/alignment changes or concurrent replanning.

create table destruktion_meta.meta_orchestrator_plan_state_h205f22 (
  workspace_id uuid not null,
  roadmap_id text not null,
  plan_generation bigint not null,
  alignment_epoch bigint not null,
  baseline_sha text not null,
  plan_sha256 text not null,
  plan_spec jsonb not null,
  state text not null default 'ACTIVE',
  automatic_retry_allowed boolean not null default false,
  task_content_authority boolean not null default false,
  scheduler_authority boolean not null default false,
  browser_authority boolean not null default false,
  release_authority boolean not null default false,
  authority_effect boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,

  primary key (workspace_id, roadmap_id, plan_generation),
  constraint meta_orchestrator_plan_generation_ck check (plan_generation > 0),
  constraint meta_orchestrator_plan_alignment_ck check (alignment_epoch > 0),
  constraint meta_orchestrator_plan_roadmap_ck check (roadmap_id ~ '^[a-z0-9][a-z0-9._:-]{2,159}$'),
  constraint meta_orchestrator_plan_base_ck check (baseline_sha ~ '^[0-9a-f]{40}$'),
  constraint meta_orchestrator_plan_digest_ck check (plan_sha256 ~ '^[0-9a-f]{64}$'),
  constraint meta_orchestrator_plan_state_ck check (state in ('ACTIVE','SUPERSEDED')),
  constraint meta_orchestrator_plan_retired_ck check ((state = 'SUPERSEDED') = (retired_at is not null)),
  constraint meta_orchestrator_plan_retry_ck check (automatic_retry_allowed = false),
  constraint meta_orchestrator_plan_task_authority_ck check (task_content_authority = false),
  constraint meta_orchestrator_plan_scheduler_authority_ck check (scheduler_authority = false),
  constraint meta_orchestrator_plan_browser_authority_ck check (browser_authority = false),
  constraint meta_orchestrator_plan_release_authority_ck check (release_authority = false),
  constraint meta_orchestrator_plan_authority_effect_ck check (authority_effect = false),
  constraint meta_orchestrator_plan_spec_schema_ck check (plan_spec->>'schema' = 'metaengine.meta-orchestrator.plan.v1'),
  constraint meta_orchestrator_plan_spec_authority_ck check (
    plan_spec->>'task_content_authority' = 'false'
    and plan_spec->>'scheduler_authority' = 'false'
    and plan_spec->>'browser_authority' = 'false'
    and plan_spec->>'release_authority' = 'false'
    and plan_spec->>'authority_effect' = 'false'
  )
);

create unique index meta_orchestrator_plan_one_active_uq
  on destruktion_meta.meta_orchestrator_plan_state_h205f22(workspace_id, roadmap_id)
  where state = 'ACTIVE';

create index meta_orchestrator_plan_latest_idx
  on destruktion_meta.meta_orchestrator_plan_state_h205f22(workspace_id, roadmap_id, plan_generation desc);

alter table destruktion_meta.meta_orchestrator_plan_state_h205f22 enable row level security;
revoke all on table destruktion_meta.meta_orchestrator_plan_state_h205f22 from public, anon, authenticated;

create or replace function public.meta_orchestrator_plan_activate_v1(
  p_workspace_id uuid,
  p_roadmap_id text,
  p_expected_current_generation bigint,
  p_plan jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta, public, extensions, pg_temp
as $$
declare
  v_auth destruktion_meta.metaengine_devos_roadmap_authority_h205f22%rowtype;
  v_current_generation bigint := 0;
  v_next_generation bigint;
  v_plan_sha256 text;
  v_row destruktion_meta.meta_orchestrator_plan_state_h205f22%rowtype;
begin
  if p_workspace_id is null then raise exception 'meta_plan_workspace_required'; end if;
  if lower(trim(coalesce(p_roadmap_id,''))) !~ '^[a-z0-9][a-z0-9._:-]{2,159}$' then
    raise exception 'meta_plan_roadmap_invalid';
  end if;
  if coalesce(p_expected_current_generation,-1) < 0 then raise exception 'meta_plan_expected_generation_invalid'; end if;
  if jsonb_typeof(p_plan) <> 'object' or p_plan->>'schema' <> 'metaengine.meta-orchestrator.plan.v1' then
    raise exception 'meta_plan_schema_invalid';
  end if;
  if p_plan->>'task_content_authority' <> 'false'
     or p_plan->>'scheduler_authority' <> 'false'
     or p_plan->>'browser_authority' <> 'false'
     or p_plan->>'release_authority' <> 'false'
     or p_plan->>'authority_effect' <> 'false' then
    raise exception 'meta_plan_authority_invalid';
  end if;

  -- The durable plan may describe roles/capabilities, but can never contain scheduler-owned
  -- physical identity, lease, claim or workspace fields at any nesting depth.
  if jsonb_path_exists(p_plan, '$.**.agent_id')
     or jsonb_path_exists(p_plan, '$.**.lease_agent_id')
     or jsonb_path_exists(p_plan, '$.**.tab_id')
     or jsonb_path_exists(p_plan, '$.**.lease_tab_id')
     or jsonb_path_exists(p_plan, '$.**.target_id')
     or jsonb_path_exists(p_plan, '$.**.lease_target_id')
     or jsonb_path_exists(p_plan, '$.**.agent_generation_epoch')
     or jsonb_path_exists(p_plan, '$.**.lease_agent_generation_epoch')
     or jsonb_path_exists(p_plan, '$.**.lease_generation')
     or jsonb_path_exists(p_plan, '$.**.lease_expires_at')
     or jsonb_path_exists(p_plan, '$.**.claim_id')
     or jsonb_path_exists(p_plan, '$.**.workspace_id') then
    raise exception 'meta_plan_scheduler_identity_forbidden';
  end if;

  -- One atomic generation allocator per workspace/roadmap. This does not schedule work.
  perform pg_advisory_xact_lock(hashtextextended('meta-orchestrator-plan:' || p_workspace_id::text || ':' || lower(trim(p_roadmap_id)), 0));

  select * into v_auth
    from destruktion_meta.metaengine_devos_roadmap_authority_h205f22
   where roadmap_id = lower(trim(p_roadmap_id))
   order by updated_at desc
   limit 1;
  if not found then raise exception 'meta_plan_roadmap_authority_missing'; end if;

  if p_plan->>'roadmap_id' <> v_auth.roadmap_id
     or p_plan->>'active_milestone_key' <> v_auth.active_milestone_key
     or p_plan->>'integration_line' <> v_auth.integration_line
     or lower(coalesce(p_plan->>'baseline_sha','')) <> v_auth.baseline_sha
     or coalesce(p_plan->>'alignment_epoch','') !~ '^[0-9]+$'
     or (p_plan->>'alignment_epoch')::bigint <> v_auth.alignment_epoch then
    raise exception 'meta_plan_roadmap_authority_drift';
  end if;

  select coalesce(max(plan_generation),0) into v_current_generation
    from destruktion_meta.meta_orchestrator_plan_state_h205f22
   where workspace_id = p_workspace_id
     and roadmap_id = v_auth.roadmap_id;

  if v_current_generation <> p_expected_current_generation then
    raise exception 'meta_plan_generation_fenced';
  end if;
  v_next_generation := v_current_generation + 1;
  if coalesce(p_plan->>'plan_generation','') !~ '^[0-9]+$'
     or (p_plan->>'plan_generation')::bigint <> v_next_generation then
    raise exception 'meta_plan_next_generation_mismatch';
  end if;

  v_plan_sha256 := encode(extensions.digest(convert_to(p_plan::text,'UTF8'),'sha256'),'hex');

  update destruktion_meta.meta_orchestrator_plan_state_h205f22
     set state = 'SUPERSEDED', retired_at = clock_timestamp(), updated_at = clock_timestamp()
   where workspace_id = p_workspace_id
     and roadmap_id = v_auth.roadmap_id
     and state = 'ACTIVE';

  insert into destruktion_meta.meta_orchestrator_plan_state_h205f22(
    workspace_id, roadmap_id, plan_generation, alignment_epoch, baseline_sha,
    plan_sha256, plan_spec, state, automatic_retry_allowed,
    task_content_authority, scheduler_authority, browser_authority, release_authority, authority_effect
  ) values (
    p_workspace_id, v_auth.roadmap_id, v_next_generation, v_auth.alignment_epoch, v_auth.baseline_sha,
    v_plan_sha256, p_plan, 'ACTIVE', false, false, false, false, false, false
  ) returning * into v_row;

  return jsonb_build_object(
    'schema','metaengine.meta-orchestrator.plan-state.v1',
    'workspace_id',v_row.workspace_id,
    'roadmap_id',v_row.roadmap_id,
    'plan_generation',v_row.plan_generation,
    'alignment_epoch',v_row.alignment_epoch,
    'baseline_sha',v_row.baseline_sha,
    'plan_sha256',v_row.plan_sha256,
    'state',v_row.state,
    'automatic_retry_allowed',false,
    'scheduler_authority',false,
    'browser_authority',false,
    'release_authority',false,
    'authority_effect',false
  );
end;
$$;

create or replace function public.meta_orchestrator_plan_snapshot_v1(
  p_workspace_id uuid,
  p_roadmap_id text
) returns jsonb
language sql
security definer
set search_path = pg_catalog, destruktion_meta, public, pg_temp
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'schema','metaengine.meta-orchestrator.plan-state.v1',
        'found',true,
        'workspace_id',p.workspace_id,
        'roadmap_id',p.roadmap_id,
        'plan_generation',p.plan_generation,
        'alignment_epoch',p.alignment_epoch,
        'baseline_sha',p.baseline_sha,
        'plan_sha256',p.plan_sha256,
        'plan_spec',p.plan_spec,
        'state',p.state,
        'automatic_retry_allowed',false,
        'task_content_authority',false,
        'scheduler_authority',false,
        'browser_authority',false,
        'release_authority',false,
        'authority_effect',false
      )
        from destruktion_meta.meta_orchestrator_plan_state_h205f22 p
       where p.workspace_id = p_workspace_id
         and p.roadmap_id = lower(trim(p_roadmap_id))
         and p.state = 'ACTIVE'
       order by p.plan_generation desc
       limit 1
    ),
    jsonb_build_object(
      'schema','metaengine.meta-orchestrator.plan-state.v1',
      'found',false,
      'workspace_id',p_workspace_id,
      'roadmap_id',lower(trim(p_roadmap_id)),
      'plan_generation',0,
      'automatic_retry_allowed',false,
      'scheduler_authority',false,
      'browser_authority',false,
      'release_authority',false,
      'authority_effect',false
    )
  );
$$;

revoke all on function public.meta_orchestrator_plan_activate_v1(uuid,text,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.meta_orchestrator_plan_snapshot_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.meta_orchestrator_plan_activate_v1(uuid,text,bigint,jsonb) to service_role;
grant execute on function public.meta_orchestrator_plan_snapshot_v1(uuid,text) to service_role;
