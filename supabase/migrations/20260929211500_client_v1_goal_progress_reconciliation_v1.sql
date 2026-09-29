-- Client V1 C4.3 durable goal correlation + progress reconciliation.
--
-- A typed goal effect is identified before HTTP dispatch by a caller-generated
-- request UUID. The UUID is persisted in the SAME transaction as plan activation
-- + canonical DevOS admission, so response loss can be reconciled by readback
-- without repeating the goal effect. Progress reads the exact admitted task even
-- after the semantic plan has been superseded.
--
-- This slice creates no scheduler, lease, agent/tab/target selection, Browser
-- actuation, release authority or automatic effect retry.

create table if not exists destruktion_meta.client_v1_goal_request_h205f22 (
  request_id uuid primary key,
  workspace_id uuid not null,
  roadmap_id text not null,
  request_sha256 text not null,
  plan_generation bigint not null,
  alignment_epoch bigint not null,
  baseline_sha text not null,
  plan_sha256 text not null,
  point_id text not null,
  task_id uuid not null,
  task_spec_sha256 text not null,
  submission_receipt jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  authority_effect boolean not null default false,

  constraint client_v1_goal_request_roadmap_ck check (roadmap_id = 'metaengine-client-v1'),
  constraint client_v1_goal_request_digest_ck check (request_sha256 ~ '^[0-9a-f]{64}$'),
  constraint client_v1_goal_request_generation_ck check (plan_generation > 0),
  constraint client_v1_goal_request_epoch_ck check (alignment_epoch > 0),
  constraint client_v1_goal_request_baseline_ck check (baseline_sha ~ '^[0-9a-f]{40}$'),
  constraint client_v1_goal_request_plan_digest_ck check (plan_sha256 ~ '^[0-9a-f]{64}$'),
  constraint client_v1_goal_request_point_ck check (point_id ~ '^[a-z0-9][a-z0-9._:-]{2,191}$'),
  constraint client_v1_goal_request_task_digest_ck check (task_spec_sha256 ~ '^[0-9a-f]{64}$'),
  constraint client_v1_goal_request_receipt_ck check (
    submission_receipt->>'schema' = 'metaengine.client-v1.goal-submit.v2'
    and submission_receipt->>'authority_effect' = 'false'
    and submission_receipt->>'automatic_retry_allowed' = 'false'
  ),
  constraint client_v1_goal_request_authority_effect_ck check (authority_effect = false),
  unique (workspace_id, task_id)
);

create index if not exists client_v1_goal_request_workspace_created_idx
  on destruktion_meta.client_v1_goal_request_h205f22(workspace_id, created_at desc);

alter table destruktion_meta.client_v1_goal_request_h205f22 enable row level security;
revoke all on table destruktion_meta.client_v1_goal_request_h205f22 from public, anon, authenticated;


create or replace function public.client_v1_goal_submit_v2(
  p_request_id uuid,
  p_workspace_id uuid,
  p_roadmap_id text,
  p_expected_current_generation bigint,
  p_plan jsonb,
  p_point_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, extensions, pg_temp
as $$
declare
  v_roadmap_id text := lower(trim(coalesce(p_roadmap_id,'')));
  v_point_id text := lower(trim(coalesce(p_point_id,'')));
  v_request_sha256 text;
  v_existing destruktion_meta.client_v1_goal_request_h205f22%rowtype;
  v_submission jsonb;
  v_receipt jsonb;
  v_activation jsonb;
  v_admission jsonb;
begin
  if p_request_id is null then
    raise exception 'client_v1_goal_request_id_required' using errcode='22023';
  end if;
  if p_workspace_id is null then
    raise exception 'client_v1_goal_workspace_required' using errcode='22023';
  end if;
  if v_roadmap_id <> 'metaengine-client-v1' then
    raise exception 'client_v1_goal_roadmap_invalid' using errcode='22023';
  end if;
  if v_point_id !~ '^[a-z0-9][a-z0-9._:-]{2,191}$' then
    raise exception 'client_v1_goal_point_invalid' using errcode='22023';
  end if;
  if coalesce(p_expected_current_generation,-1) < 0 then
    raise exception 'client_v1_goal_expected_generation_invalid' using errcode='22023';
  end if;
  if jsonb_typeof(p_plan) <> 'object'
     or p_plan->>'schema' <> 'metaengine.meta-orchestrator.plan.v1'
     or p_plan->>'roadmap_id' <> v_roadmap_id
     or p_plan->>'authority_effect' <> 'false'
     or p_plan->>'automatic_retry_allowed' <> 'false' then
    raise exception 'client_v1_goal_plan_invalid' using errcode='22023';
  end if;

  v_request_sha256 := encode(extensions.digest(
    convert_to(jsonb_build_object(
      'workspace_id',p_workspace_id,
      'roadmap_id',v_roadmap_id,
      'expected_current_generation',p_expected_current_generation,
      'plan',p_plan,
      'point_id',v_point_id
    )::text,'UTF8'),
    'sha256'
  ),'hex');

  -- Exactly one transaction may own this user-intent identifier. This is not a
  -- scheduler lock; it only makes transport replay a readback of the original
  -- goal effect instead of a second plan activation.
  perform pg_advisory_xact_lock(hashtextextended('client-v1-goal:' || p_request_id::text, 0));

  select * into v_existing
    from destruktion_meta.client_v1_goal_request_h205f22
   where request_id = p_request_id
   limit 1;

  if found then
    if v_existing.workspace_id <> p_workspace_id
       or v_existing.roadmap_id <> v_roadmap_id
       or v_existing.request_sha256 <> v_request_sha256
       or v_existing.point_id <> v_point_id then
      raise exception 'client_v1_goal_request_collision' using errcode='23505';
    end if;
    return v_existing.submission_receipt
      || jsonb_build_object('request_replayed',true,'reconciliation_required',false);
  end if;

  -- Nested SECURITY DEFINER functions execute in this transaction. If the
  -- correlation insert below fails, activation + admission are rolled back too.
  v_submission := public.client_v1_goal_submit_v1(
    p_workspace_id,
    v_roadmap_id,
    p_expected_current_generation,
    p_plan,
    v_point_id
  );
  v_activation := v_submission->'activation';
  v_admission := v_submission->'admission';

  if v_submission->>'schema' <> 'metaengine.client-v1.goal-submit.v1'
     or coalesce((v_submission->>'authority_effect')::boolean,true) <> false
     or coalesce((v_submission->>'automatic_retry_allowed')::boolean,true) <> false
     or coalesce(v_submission->>'task_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(v_activation->>'plan_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_activation->>'baseline_sha','') !~ '^[0-9a-f]{40}$'
     or coalesce(v_admission->>'task_spec_sha256','') !~ '^[0-9a-f]{64}$' then
    raise exception 'client_v1_goal_submission_readback_invalid';
  end if;

  v_receipt := jsonb_build_object(
    'schema','metaengine.client-v1.goal-submit.v2',
    'request_id',p_request_id,
    'request_replayed',false,
    'workspace_id',p_workspace_id,
    'roadmap_id',v_roadmap_id,
    'plan_generation',(v_submission->>'plan_generation')::bigint,
    'point_id',v_point_id,
    'task_id',v_submission->>'task_id',
    'activation',v_activation,
    'admission',v_admission,
    'atomic_plan_and_admission',true,
    'operator_initiated',true,
    'task_payload_returned',false,
    'scheduler_identity_returned',false,
    'reconciliation_required',false,
    'automatic_retry_allowed',false,
    'scheduler_authority',false,
    'browser_authority',false,
    'release_authority',false,
    'authority_effect',false
  );

  insert into destruktion_meta.client_v1_goal_request_h205f22(
    request_id, workspace_id, roadmap_id, request_sha256, plan_generation,
    alignment_epoch, baseline_sha, plan_sha256, point_id, task_id,
    task_spec_sha256, submission_receipt, authority_effect
  ) values (
    p_request_id, p_workspace_id, v_roadmap_id, v_request_sha256,
    (v_submission->>'plan_generation')::bigint,
    (v_activation->>'alignment_epoch')::bigint,
    v_activation->>'baseline_sha',
    v_activation->>'plan_sha256',
    v_point_id,
    (v_submission->>'task_id')::uuid,
    v_admission->>'task_spec_sha256',
    v_receipt,
    false
  );

  return v_receipt;
end;
$$;


create or replace function public.client_v1_goal_progress_v1(
  p_workspace_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare
  v_request destruktion_meta.client_v1_goal_request_h205f22%rowtype;
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_terminal boolean := false;
begin
  if p_workspace_id is null then
    raise exception 'client_v1_goal_progress_workspace_required' using errcode='22023';
  end if;
  if p_request_id is null then
    raise exception 'client_v1_goal_progress_request_id_required' using errcode='22023';
  end if;

  select * into v_request
    from destruktion_meta.client_v1_goal_request_h205f22
   where workspace_id = p_workspace_id
     and request_id = p_request_id
   limit 1;

  if not found then
    return jsonb_build_object(
      'schema','metaengine.client-v1.goal-progress.v1',
      'found',false,
      'request_id',p_request_id,
      'workspace_id',p_workspace_id,
      'task_payload_returned',false,
      'result_summary_returned',false,
      'scheduler_identity_returned',false,
      'automatic_retry_allowed',false,
      'scheduler_authority',false,
      'browser_authority',false,
      'release_authority',false,
      'authority_effect',false
    );
  end if;

  select * into v_task
    from destruktion_meta.devos_fleet_task_h205f22
   where workspace_id = v_request.workspace_id
     and task_id = v_request.task_id
   limit 1;
  if not found then
    raise exception 'client_v1_goal_progress_task_missing';
  end if;

  if v_task.point_id <> v_request.point_id
     or v_task.base_sha <> v_request.baseline_sha
     or v_task.task_spec_sha256 <> v_request.task_spec_sha256
     or lower(coalesce(v_task.task_spec #>> '{meta_orchestrator,roadmap_id}','')) <> v_request.roadmap_id
     or coalesce(v_task.task_spec #>> '{meta_orchestrator,alignment_epoch}','') !~ '^[0-9]+$'
     or (v_task.task_spec #>> '{meta_orchestrator,alignment_epoch}')::bigint <> v_request.alignment_epoch
     or coalesce(v_task.task_spec #>> '{meta_orchestrator,plan_generation}','') !~ '^[0-9]+$'
     or (v_task.task_spec #>> '{meta_orchestrator,plan_generation}')::bigint <> v_request.plan_generation then
    raise exception 'client_v1_goal_progress_binding_drift';
  end if;

  v_terminal := v_task.state in ('COMPLETED','FAILED','AMBIGUOUS','FENCED');

  return jsonb_build_object(
    'schema','metaengine.client-v1.goal-progress.v1',
    'found',true,
    'request_id',v_request.request_id,
    'workspace_id',v_request.workspace_id,
    'roadmap_id',v_request.roadmap_id,
    'plan_generation',v_request.plan_generation,
    'alignment_epoch',v_request.alignment_epoch,
    'baseline_sha',v_request.baseline_sha,
    'plan_sha256',v_request.plan_sha256,
    'point_id',v_request.point_id,
    'task_id',v_request.task_id,
    'task_spec_sha256',v_request.task_spec_sha256,
    'task_state',v_task.state,
    'terminal',v_terminal,
    'lease_generation',v_task.lease_generation,
    'result_checkpoint_id',v_task.result_checkpoint_id,
    'result_summary_sha256',v_task.result_summary_sha256,
    'result_sha256',v_task.result_sha256,
    'error_code',v_task.error_code,
    'created_at',v_task.created_at,
    'updated_at',v_task.updated_at,
    'finished_at',v_task.finished_at,
    'survives_plan_retirement',true,
    'task_payload_returned',false,
    'result_summary_returned',false,
    'scheduler_identity_returned',false,
    'automatic_retry_allowed',false,
    'scheduler_authority',false,
    'browser_authority',false,
    'release_authority',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.client_v1_goal_submit_v2(uuid,uuid,text,bigint,jsonb,text)
  from public, anon, authenticated;
revoke all on function public.client_v1_goal_progress_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.client_v1_goal_submit_v2(uuid,uuid,text,bigint,jsonb,text)
  to service_role;
grant execute on function public.client_v1_goal_progress_v1(uuid,uuid)
  to service_role;

comment on table destruktion_meta.client_v1_goal_request_h205f22 is
  'Zero-authority Client V1 correlation ledger: binds one caller request UUID to one atomic plan/admission effect for response-loss and restart reconciliation.';
comment on function public.client_v1_goal_submit_v2(uuid,uuid,text,bigint,jsonb,text) is
  'Idempotent Client V1 typed goal submission keyed by request UUID; transport replay returns the original receipt and never creates a second plan generation.';
comment on function public.client_v1_goal_progress_v1(uuid,uuid) is
  'Read-only exact task progress for a Client V1 request UUID; survives plan retirement and exposes no task payload, result text or scheduler identity.';
