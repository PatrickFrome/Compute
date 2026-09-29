-- Client V1 C4 fresh-project Meta-Orchestrator substrate.
-- This migration ports only the durable semantic plan/admission membrane needed
-- by the typed product goal path. It creates no second scheduler, Browser
-- actuator, polling loop, legacy ME2 mirror, or automatic retry plane.

create schema if not exists destruktion_meta;

create table if not exists destruktion_meta.metaengine_devos_roadmap_authority_h205f22 (
  authority_key text primary key,
  roadmap_id text not null unique,
  active_milestone_key text not null,
  integration_line text not null,
  baseline_sha text not null,
  alignment_epoch bigint not null,
  updated_at timestamptz not null default clock_timestamp(),
  authority_effect boolean not null default false,
  constraint client_v1_roadmap_authority_key_ck check (authority_key ~ '^[A-Z][A-Z0-9_]{2,159}$'),
  constraint client_v1_roadmap_id_ck check (roadmap_id ~ '^[a-z0-9][a-z0-9._:-]{2,159}$'),
  constraint client_v1_roadmap_milestone_ck check (char_length(active_milestone_key) between 1 and 160),
  constraint client_v1_roadmap_line_ck check (char_length(integration_line) between 1 and 240),
  constraint client_v1_roadmap_sha_ck check (baseline_sha ~ '^[0-9a-f]{40}$'),
  constraint client_v1_roadmap_epoch_ck check (alignment_epoch > 0),
  constraint client_v1_roadmap_authority_effect_ck check (authority_effect = false)
);

alter table destruktion_meta.metaengine_devos_roadmap_authority_h205f22 enable row level security;
revoke all on table destruktion_meta.metaengine_devos_roadmap_authority_h205f22
  from public, anon, authenticated;

comment on table destruktion_meta.metaengine_devos_roadmap_authority_h205f22 is
  'Fresh Client V1 semantic roadmap authority compatibility substrate. It binds plan content only and grants no scheduler, Browser, release, or retry authority.';


-- METAENGINE Meta-Orchestrator durable plan generation state v1.
-- Branch-local migration only. Do not apply to production from this convergence task.
--
-- This is not a scheduler, lease owner, Browser authority or release authority.
-- It only gives the semantic plan an atomic durable generation + digest so stale brains
-- cannot replay an old plan after roadmap/alignment changes or concurrent replanning.

create table if not exists destruktion_meta.meta_orchestrator_plan_state_h205f22 (
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


-- METAENGINE Meta-Orchestrator authoritative provider projection v1.
-- Branch-local migration only. Do not apply to production from this convergence task.
--
-- This function is a read-only projection membrane for the existing native supervisor.
-- It exposes only roadmap identity, active durable plan state, Meta routing metadata,
-- bounded roadmap receipt metadata, and fail-closed capacity. It never schedules work,
-- leases a task, exposes worker result text, or grants Browser/release authority.

create or replace function public.meta_orchestrator_authoritative_inputs_v1(
  p_workspace_id uuid,
  p_roadmap_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta, public, pg_temp
as $$
declare
  v_roadmap_id text := lower(trim(coalesce(p_roadmap_id,'')));
  v_auth destruktion_meta.metaengine_devos_roadmap_authority_h205f22%rowtype;
  v_plan jsonb;
  v_tasks jsonb := '[]'::jsonb;
  v_generation bigint := 0;
begin
  if p_workspace_id is null then raise exception 'meta_inputs_workspace_required'; end if;
  if v_roadmap_id !~ '^[a-z0-9][a-z0-9._:-]{2,159}$' then
    raise exception 'meta_inputs_roadmap_invalid';
  end if;

  select * into v_auth
    from destruktion_meta.metaengine_devos_roadmap_authority_h205f22
   where roadmap_id = v_roadmap_id
   order by updated_at desc
   limit 1;
  if not found then raise exception 'meta_inputs_roadmap_authority_missing'; end if;

  v_plan := public.meta_orchestrator_plan_snapshot_v1(p_workspace_id, v_roadmap_id);
  if coalesce((v_plan->>'found')::boolean,false) then
    v_generation := coalesce((v_plan->>'plan_generation')::bigint,0);
  end if;

  if v_generation > 0 then
    select coalesce(jsonb_agg(row_value order by updated_at, task_id), '[]'::jsonb)
      into v_tasks
      from (
        select
          t.updated_at,
          t.task_id,
          jsonb_build_object(
            'task_id', t.task_id,
            'point_id', t.point_id,
            'role', t.role,
            'base_sha', t.base_sha,
            'state', t.state,
            'lease_generation', t.lease_generation,
            'updated_at', t.updated_at,
            'authority_effect', t.authority_effect,
            'task_spec', jsonb_build_object(
              'meta_orchestrator', jsonb_build_object(
                'roadmap_id', t.task_spec #>> '{meta_orchestrator,roadmap_id}',
                'alignment_epoch', t.task_spec #>> '{meta_orchestrator,alignment_epoch}',
                'plan_generation', t.task_spec #>> '{meta_orchestrator,plan_generation}',
                'parent_plan_point', t.task_spec #>> '{meta_orchestrator,parent_plan_point}',
                'parent_point_id', t.task_spec #>> '{meta_orchestrator,parent_point_id}'
              )
            )
          ) as row_value
        from destruktion_meta.devos_fleet_task_h205f22 t
        where t.workspace_id = p_workspace_id
          and jsonb_typeof(t.task_spec->'meta_orchestrator') = 'object'
          and lower(coalesce(t.task_spec #>> '{meta_orchestrator,roadmap_id}','')) = v_roadmap_id
          and coalesce(t.task_spec #>> '{meta_orchestrator,alignment_epoch}','') ~ '^[0-9]+$'
          and (t.task_spec #>> '{meta_orchestrator,alignment_epoch}')::bigint = v_auth.alignment_epoch
          and coalesce(t.task_spec #>> '{meta_orchestrator,plan_generation}','') ~ '^[0-9]+$'
          and (t.task_spec #>> '{meta_orchestrator,plan_generation}')::bigint = v_generation
        order by t.updated_at desc, t.task_id
        limit 512
      ) q;
  end if;

  -- Fresh Client V1 projects intentionally do not import the legacy roadmap
  -- receipt history table. The product-control membrane exposes an empty
  -- bounded receipt projection until a new Client V1 evidence consumer needs
  -- a purpose-built receipt source.


  return jsonb_build_object(
    'schema','metaengine.meta-orchestrator.authoritative-inputs.v1',
    'workspace_id',p_workspace_id,
    'roadmap_id',v_auth.roadmap_id,
    'roadmap_authority',jsonb_build_object(
      'authority_key',v_auth.authority_key,
      'roadmap_id',v_auth.roadmap_id,
      'active_milestone_key',v_auth.active_milestone_key,
      'integration_line',v_auth.integration_line,
      'baseline_sha',v_auth.baseline_sha,
      'alignment_epoch',v_auth.alignment_epoch,
      'updated_at',v_auth.updated_at
    ),
    'plan_state',v_plan,
    'tasks',v_tasks,
    'roadmap_receipts','[]'::jsonb,
    -- Current DevOS snapshot does not expose a scheduler-owned slot count. Do not infer
    -- capacity from Browser/worker telemetry here; fail closed until an authoritative
    -- capacity projection exists in the single scheduler control plane.
    'capacity',jsonb_build_object(
      'source','UNSPECIFIED_FAIL_CLOSED',
      'available_slots',0,
      'authority_effect',false
    ),
    'task_meta_projection_only',true,
    'task_payload_exposed',false,
    'result_summary_exposed',false,
    'scheduler_identity_exposed',false,
    'receipt_summary_exposed',false,
    'receipt_evidence_exposed',false,
    'automatic_retry_allowed',false,
    'task_content_authority',false,
    'scheduler_authority',false,
    'browser_authority',false,
    'release_authority',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.meta_orchestrator_authoritative_inputs_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.meta_orchestrator_authoritative_inputs_v1(uuid,text) to service_role;


-- METAENGINE Meta-Orchestrator durable task admission v1.
-- Branch-local migration only. Do not apply to production from this convergence task.
--
-- The Meta brain never supplies privileged task content here. It names only an exact
-- ACTIVE durable plan generation and point. This RPC rereads roadmap + plan authority,
-- reconstructs the canonical task from the stored plan node, then reuses the one existing
-- devos_fleet_enqueue_v1 scheduler ingress. It does not lease, claim, dispatch or actuate Browser UI.

create or replace function public.meta_orchestrator_task_admit_v1(
  p_workspace_id uuid,
  p_roadmap_id text,
  p_plan_generation bigint,
  p_point_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta, public, pg_temp
as $$
declare
  v_roadmap_id text := lower(trim(coalesce(p_roadmap_id,'')));
  v_point_id text := lower(trim(coalesce(p_point_id,'')));
  v_parent_point text;
  v_variant text := 'PRIMARY';
  v_plan destruktion_meta.meta_orchestrator_plan_state_h205f22%rowtype;
  v_auth destruktion_meta.metaengine_devos_roadmap_authority_h205f22%rowtype;
  v_node jsonb;
  v_role text;
  v_risk text;
  v_objective text;
  v_priority integer;
  v_source_branch text;
  v_target_branch text;
  v_deliverable text;
  v_constraints jsonb;
  v_task_spec jsonb;
  v_key text;
  v_enqueue jsonb;
begin
  if p_workspace_id is null then raise exception 'meta_admit_workspace_required' using errcode = '22023'; end if;
  if v_roadmap_id !~ '^[a-z0-9][a-z0-9._:-]{2,159}$' then raise exception 'meta_admit_roadmap_invalid' using errcode = '22023'; end if;
  if coalesce(p_plan_generation,0) < 1 then raise exception 'meta_admit_plan_generation_invalid' using errcode = '22023'; end if;
  if v_point_id !~ '^[a-z0-9][a-z0-9._:-]{2,191}$' then raise exception 'meta_admit_point_invalid' using errcode = '22023'; end if;

  -- Serialize admission for one semantic point. The downstream enqueue also has a stable
  -- idempotency key, so crash/restart can read back a duplicate without creating two tasks.
  perform pg_advisory_xact_lock(hashtextextended(
    'meta-task-admit:' || p_workspace_id::text || ':' || v_roadmap_id || ':' || p_plan_generation::text || ':' || v_point_id,
    0
  ));

  select * into v_auth
    from destruktion_meta.metaengine_devos_roadmap_authority_h205f22
   where roadmap_id = v_roadmap_id
   order by updated_at desc
   limit 1;
  if not found then raise exception 'meta_admit_roadmap_authority_missing'; end if;

  select * into v_plan
    from destruktion_meta.meta_orchestrator_plan_state_h205f22
   where workspace_id = p_workspace_id
     and roadmap_id = v_roadmap_id
     and plan_generation = p_plan_generation
     and state = 'ACTIVE'
   limit 1;
  if not found then raise exception 'meta_admit_active_plan_missing'; end if;

  if v_plan.alignment_epoch <> v_auth.alignment_epoch
     or v_plan.baseline_sha <> v_auth.baseline_sha
     or v_plan.plan_spec->>'roadmap_id' <> v_auth.roadmap_id
     or v_plan.plan_spec->>'active_milestone_key' <> v_auth.active_milestone_key
     or v_plan.plan_spec->>'integration_line' <> v_auth.integration_line then
    raise exception 'meta_admit_plan_authority_drift';
  end if;

  -- Companion points are deterministic derivatives of one parent node and its risk.
  if right(v_point_id,7) = '.critic' then
    v_variant := 'CRITIC';
    v_parent_point := left(v_point_id,length(v_point_id)-7);
  elsif right(v_point_id,10) = '.falsifier' then
    v_variant := 'FALSIFIER';
    v_parent_point := left(v_point_id,length(v_point_id)-10);
  else
    v_parent_point := v_point_id;
  end if;

  select n.value into v_node
    from jsonb_array_elements(coalesce(v_plan.plan_spec->'nodes','[]'::jsonb)) as n(value)
   where lower(coalesce(n.value->>'point_id','')) = v_parent_point
   limit 1;
  if not found then raise exception 'meta_admit_plan_point_missing'; end if;

  if coalesce(v_node->>'point_id','') <> v_parent_point
     or lower(coalesce(v_node->>'base_sha','')) <> v_auth.baseline_sha
     or coalesce(v_node->>'objective','') = ''
     or coalesce(v_node->>'role','') !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception 'meta_admit_plan_node_invalid';
  end if;

  v_risk := upper(coalesce(v_node->>'risk','NORMAL'));
  if v_variant = 'CRITIC' and v_risk not in ('HIGH','CRITICAL') then raise exception 'meta_admit_critic_not_required'; end if;
  if v_variant = 'FALSIFIER' and v_risk <> 'CRITICAL' then raise exception 'meta_admit_falsifier_not_required'; end if;

  v_role := case when v_variant = 'PRIMARY' then upper(v_node->>'role') else v_variant end;
  v_objective := case
    when v_variant = 'PRIMARY' then v_node->>'objective'
    else v_variant || ' independently evaluate ' || v_parent_point || ': ' || (v_node->>'objective')
  end;
  v_priority := coalesce((v_node->>'priority')::integer,50) - case when v_variant = 'PRIMARY' then 0 else 1 end;
  v_source_branch := left(coalesce(v_node->>'source_branch',''),240);
  v_target_branch := case when v_variant = 'PRIMARY' then left(coalesce(v_node->>'target_branch',''),240) else '' end;
  v_deliverable := left(coalesce(v_node->>'deliverable',''),4000);
  v_constraints := case when jsonb_typeof(v_node->'constraints')='array' then v_node->'constraints' else '[]'::jsonb end;
  v_constraints := v_constraints || jsonb_build_array(
    'Use the existing DevOS scheduler; do not allocate leases or choose agent/tab/target identity.',
    'Do not blindly retry ambiguous effects.'
  );

  v_task_spec := jsonb_build_object(
    'schema','metaengine.devos.meta-task-spec.v1',
    'objective',v_objective,
    'constraints',v_constraints,
    'deliverable',v_deliverable,
    'source_branch',v_source_branch,
    'target_branch',v_target_branch,
    'required_capabilities',case when jsonb_typeof(v_node->'required_capabilities')='array' then v_node->'required_capabilities' else '[]'::jsonb end,
    'evidence_contract',case when jsonb_typeof(v_node->'evidence_contract')='object' then v_node->'evidence_contract' else jsonb_build_object('required','[]'::jsonb,'min_verified',0) end,
    'meta_orchestrator',jsonb_build_object(
      'roadmap_id',v_auth.roadmap_id,
      'alignment_epoch',v_auth.alignment_epoch,
      'plan_generation',v_plan.plan_generation,
      'parent_plan_point',v_parent_point,
      'parent_point_id',case when v_variant='PRIMARY' then null else v_parent_point end
    ),
    'automatic_retry_allowed',false,
    'page_data_authority',false,
    'model_output_authority',false,
    'task_content_authority',false,
    'scheduler_authority',false,
    'browser_authority',false,
    'release_authority',false,
    'authority_effect',false
  );

  if jsonb_path_exists(v_task_spec,'$.**.agent_id')
     or jsonb_path_exists(v_task_spec,'$.**.tab_id')
     or jsonb_path_exists(v_task_spec,'$.**.target_id')
     or jsonb_path_exists(v_task_spec,'$.**.lease_generation')
     or jsonb_path_exists(v_task_spec,'$.**.claim_id') then
    raise exception 'meta_admit_scheduler_identity_forbidden';
  end if;

  v_key := 'meta:' || v_auth.roadmap_id || ':' || v_auth.alignment_epoch::text || ':' || v_plan.plan_generation::text || ':' || v_point_id;
  v_enqueue := public.devos_fleet_enqueue_v1(
    p_workspace_id,
    v_point_id,
    v_role,
    v_auth.baseline_sha,
    v_task_spec,
    v_key,
    nullif(v_target_branch,''),
    v_priority
  );

  return jsonb_build_object(
    'schema','metaengine.meta-orchestrator.task-admission.v1',
    'workspace_id',p_workspace_id,
    'roadmap_id',v_auth.roadmap_id,
    'alignment_epoch',v_auth.alignment_epoch,
    'plan_generation',v_plan.plan_generation,
    'point_id',v_point_id,
    'parent_plan_point',v_parent_point,
    'variant',v_variant,
    'task_id',v_enqueue->>'task_id',
    'duplicate',coalesce((v_enqueue->>'duplicate')::boolean,false),
    'task_spec_sha256',v_enqueue->>'task_spec_sha256',
    'task_payload_returned',false,
    'scheduler_identity_returned',false,
    'automatic_retry_allowed',false,
    'task_content_authority',false,
    'scheduler_authority',false,
    'browser_authority',false,
    'release_authority',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.meta_orchestrator_task_admit_v1(uuid,text,bigint,text) from public, anon, authenticated;
grant execute on function public.meta_orchestrator_task_admit_v1(uuid,text,bigint,text) to service_role;


-- METAENGINE Meta-Orchestrator atomic frontier admission v1.
-- Branch-local migration only. Do not apply to production from this audit task.
--
-- A Meta superstep may require a safety group (primary + critic/falsifier). Admitting those
-- points one HTTP request at a time can leave a partial group after process/network failure.
-- This RPC materializes the complete semantic frontier in one Postgres transaction while
-- reusing the existing canonical meta_orchestrator_task_admit_v1 -> devos_fleet_enqueue_v1
-- ingress for every point. It allocates no lease, agent, tab, target, workspace or Browser
-- authority and starts no scheduler/poller.

create or replace function public.meta_orchestrator_frontier_admit_v1(
  p_workspace_id uuid,
  p_roadmap_id text,
  p_plan_generation bigint,
  p_point_ids text[]
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare
  v_roadmap_id text := lower(trim(coalesce(p_roadmap_id,'')));
  v_point_raw text;
  v_point text;
  v_seen text[] := array[]::text[];
  v_one jsonb;
  v_results jsonb := '[]'::jsonb;
  v_count integer := coalesce(array_length(p_point_ids,1),0);
begin
  if p_workspace_id is null then
    raise exception 'meta_frontier_workspace_required' using errcode = '22023';
  end if;
  if v_roadmap_id !~ '^[a-z0-9][a-z0-9._:-]{2,159}$' then
    raise exception 'meta_frontier_roadmap_invalid' using errcode = '22023';
  end if;
  if coalesce(p_plan_generation,0) < 1 then
    raise exception 'meta_frontier_plan_generation_invalid' using errcode = '22023';
  end if;
  if v_count < 1 or v_count > 8 then
    raise exception 'meta_frontier_size_invalid' using errcode = '22023';
  end if;

  -- Serialize one plan-generation frontier. Nested task-admission locks keep individual points
  -- idempotent as well. Any exception below aborts this entire transaction, so the caller can
  -- never observe a newly-created partial safety group from this invocation.
  perform pg_advisory_xact_lock(hashtextextended(
    'meta-frontier-admit:' || p_workspace_id::text || ':' || v_roadmap_id || ':' || p_plan_generation::text,
    0
  ));

  foreach v_point_raw in array p_point_ids
  loop
    v_point := lower(trim(coalesce(v_point_raw,'')));
    if v_point !~ '^[a-z0-9][a-z0-9._:-]{2,191}$' then
      raise exception 'meta_frontier_point_invalid' using errcode = '22023';
    end if;
    if v_point = any(v_seen) then
      raise exception 'meta_frontier_duplicate_point' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen,v_point);

    v_one := public.meta_orchestrator_task_admit_v1(
      p_workspace_id,
      v_roadmap_id,
      p_plan_generation,
      v_point
    );

    if v_one->>'schema' <> 'metaengine.meta-orchestrator.task-admission.v1'
       or coalesce(v_one->>'task_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce((v_one->>'authority_effect')::boolean,true) <> false
       or coalesce((v_one->>'scheduler_authority')::boolean,true) <> false
       or coalesce((v_one->>'browser_authority')::boolean,true) <> false then
      raise exception 'meta_frontier_task_admission_readback_invalid';
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'point_id',v_point,
      'task_id',v_one->>'task_id',
      'duplicate',coalesce((v_one->>'duplicate')::boolean,false),
      'task_spec_sha256',v_one->>'task_spec_sha256',
      'authority_effect',false
    ));
  end loop;

  return jsonb_build_object(
    'schema','metaengine.meta-orchestrator.frontier-admission.v1',
    'workspace_id',p_workspace_id,
    'roadmap_id',v_roadmap_id,
    'plan_generation',p_plan_generation,
    'point_count',v_count,
    'points',v_results,
    'atomic_transaction',true,
    'all_or_none_new_admission',true,
    'task_payload_returned',false,
    'scheduler_identity_returned',false,
    'second_scheduler_loop',false,
    'automatic_retry_allowed',false,
    'task_content_authority',false,
    'scheduler_authority',false,
    'browser_authority',false,
    'release_authority',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.meta_orchestrator_frontier_admit_v1(uuid,text,bigint,text[]) from public, anon, authenticated;
grant execute on function public.meta_orchestrator_frontier_admit_v1(uuid,text,bigint,text[]) to service_role;


-- METAENGINE DevOS scheduler capacity projection v1.
-- Branch-local migration only. Do not apply to production from this convergence task.
--
-- This is a read-only projection inside the single existing DevOS scheduler boundary.
-- It deliberately mirrors the transport-admission membrane: only fresh FLEET_OWNED
-- ACTIVE Browser incarnations with exact transport proof are capacity, and ACTIVE
-- DevOS claims consume that capacity. No Browser/model/worker text becomes authority.

create or replace function public.devos_fleet_capacity_snapshot_v1(p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare
  v_supervisor_state jsonb;
  v_agents jsonb;
  v_agent jsonb;
  v_proof jsonb;
  v_last_seen timestamptz;
  v_proven_at timestamptz;
  v_agent_id text;
  v_role text;
  v_seen text[] := array[]::text[];
  v_available integer := 0;
  v_by_role jsonb := '{}'::jsonb;
begin
  if p_workspace is null then
    raise exception 'devos_capacity_workspace_required' using errcode = '22023';
  end if;

  select s.state, s.last_seen_at
    into v_supervisor_state, v_last_seen
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
   where s.workspace_id = p_workspace
     and s.authority_effect = false
     and s.state->>'schema' = 'metaengine.native-browser-supervisor.state.v1'
     and s.state->'fleet'->>'schema' = 'metaengine.browser.fleet-snapshot.v1'
     and s.state->'fleet'->>'readiness_contract' = 'TRANSPORT_PROOF_REQUIRED'
   order by s.last_seen_at desc
   limit 1;

  if not found then
    return jsonb_build_object(
      'schema','metaengine.devos.scheduler-capacity.v1',
      'workspace_id',p_workspace,
      'state','NO_SNAPSHOT',
      'source','DEVOS_SCHEDULER_SNAPSHOT',
      'available_slots',0,
      'by_role','{}'::jsonb,
      'freshness_horizon_seconds',45,
      'transport_admission','ACTIVE_EXACT_PROOF_V1',
      'scheduler_source','NATIVE_SUPERVISOR_HEARTBEAT',
      'scheduler_policy','IDLE_ROLE_FAIR_SHARE_V1',
      'automatic_retry_allowed',false,
      'authority_effect',false
    );
  end if;

  if v_last_seen < clock_timestamp() - interval '45 seconds' then
    return jsonb_build_object(
      'schema','metaengine.devos.scheduler-capacity.v1',
      'workspace_id',p_workspace,
      'state','STALE_FAIL_CLOSED',
      'source','DEVOS_SCHEDULER_SNAPSHOT',
      'available_slots',0,
      'by_role','{}'::jsonb,
      'observed_at',v_last_seen,
      'freshness_horizon_seconds',45,
      'transport_admission','ACTIVE_EXACT_PROOF_V1',
      'scheduler_source','NATIVE_SUPERVISOR_HEARTBEAT',
      'scheduler_policy','IDLE_ROLE_FAIR_SHARE_V1',
      'automatic_retry_allowed',false,
      'authority_effect',false
    );
  end if;

  v_agents := v_supervisor_state->'fleet'->'agents';
  if jsonb_typeof(v_agents) <> 'array' or jsonb_array_length(v_agents) > 64 then
    return jsonb_build_object(
      'schema','metaengine.devos.scheduler-capacity.v1',
      'workspace_id',p_workspace,
      'state','INVALID_FLEET_FAIL_CLOSED',
      'source','DEVOS_SCHEDULER_SNAPSHOT',
      'available_slots',0,
      'by_role','{}'::jsonb,
      'observed_at',v_last_seen,
      'freshness_horizon_seconds',45,
      'transport_admission','ACTIVE_EXACT_PROOF_V1',
      'scheduler_source','NATIVE_SUPERVISOR_HEARTBEAT',
      'scheduler_policy','IDLE_ROLE_FAIR_SHARE_V1',
      'automatic_retry_allowed',false,
      'authority_effect',false
    );
  end if;

  for v_agent in select value from jsonb_array_elements(v_agents)
  loop
    v_agent_id := lower(coalesce(v_agent->>'agent_id',''));
    v_role := upper(coalesce(v_agent->>'role',''));

    if v_agent_id !~ '^agent_[a-z0-9-]{8,64}$'
       or v_role !~ '^[A-Z][A-Z0-9_]{1,63}$'
       or v_agent_id = any(v_seen)
       or v_agent->>'ownership' <> 'FLEET_OWNED'
       or v_agent->>'lifecycle_state' <> 'ACTIVE'
       or v_agent->>'authority_effect' <> 'false'
       or v_agent->>'automatic_retry_allowed' <> 'false'
       or coalesce(v_agent->>'tab_id','') = ''
       or lower(coalesce(v_agent->>'target_id','')) !~ '^webcontents:[1-9][0-9]*$'
       or coalesce(v_agent->>'generation_epoch','') !~ '^[1-9][0-9]*$' then
      continue;
    end if;

    v_proof := v_agent->'transport_proof';
    if jsonb_typeof(v_proof) <> 'object'
       or v_proof->>'schema' <> 'metaengine.browser.fleet-transport-proof.v1'
       or v_proof->>'authority_effect' <> 'false'
       or v_proof->>'tab_id' <> v_agent->>'tab_id'
       or lower(coalesce(v_proof->>'target_id','')) <> lower(v_agent->>'target_id')
       or coalesce(v_proof->>'generation_epoch','') <> v_agent->>'generation_epoch'
       or lower(coalesce(v_proof->>'conversation_url_sha256','')) !~ '^[0-9a-f]{64}$'
       or coalesce(v_proof->>'proven_at','') = '' then
      continue;
    end if;

    begin
      v_proven_at := (v_proof->>'proven_at')::timestamptz;
    exception when others then
      continue;
    end;
    if v_proven_at > v_last_seen + interval '5 seconds' then
      continue;
    end if;

    if exists (
      select 1
        from destruktion_meta.devos_fleet_claim_h205f22 c
       where c.workspace_id = p_workspace
         and c.agent_id = v_agent_id
         and c.state = 'ACTIVE'
         and c.expires_at > clock_timestamp()
    ) then
      continue;
    end if;

    v_seen := array_append(v_seen, v_agent_id);
    v_available := v_available + 1;
    v_by_role := jsonb_set(
      v_by_role,
      array[v_role],
      to_jsonb(coalesce((v_by_role->>v_role)::integer,0) + 1),
      true
    );
  end loop;

  return jsonb_build_object(
    'schema','metaengine.devos.scheduler-capacity.v1',
    'workspace_id',p_workspace,
    'state','FRESH',
    'source','DEVOS_SCHEDULER_SNAPSHOT',
    'available_slots',v_available,
    'by_role',v_by_role,
    'observed_at',v_last_seen,
    'freshness_horizon_seconds',45,
    'transport_admission','ACTIVE_EXACT_PROOF_V1',
    'scheduler_source','NATIVE_SUPERVISOR_HEARTBEAT',
    'scheduler_policy','IDLE_ROLE_FAIR_SHARE_V1',
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.devos_fleet_capacity_snapshot_v1(uuid) from public, anon, authenticated;
grant execute on function public.devos_fleet_capacity_snapshot_v1(uuid) to service_role;

