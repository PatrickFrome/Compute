-- METAENGINE DevOS precise ChatGPT service backpressure v2.
--
-- Safety contract:
-- * Browser/UI evidence may only DENY a lease; it never grants scheduler authority.
-- * New Browser builds use the typed service_throttle projection first.
-- * Legacy Browser compatibility is bounded to a fresh exact native perception frame.
-- * Quoted throttle text elsewhere in Browser state is never inspected.
-- * Existing ACTIVE transport proof, mutation claim fencing and SKIP LOCKED scheduler
--   admission remain unchanged below this negative gate.

create or replace function destruktion_meta.devos_chatgpt_rate_limit_backpressure_v2(
  p_browser_state jsonb,
  p_state_seen_at timestamptz,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, destruktion_meta
as $function$
declare
  v_root jsonb := '{}'::jsonb;
  v_typed jsonb := null;
  v_typed_schema text := null;
  v_typed_state text := null;
  v_perception jsonb := null;
  v_targets jsonb := '[]'::jsonb;
  v_text text := '';
  v_url text := '';
  v_captured_at timestamptz := null;
  v_has_ack boolean := false;
  v_has_composer boolean := false;
  v_headline boolean := false;
  v_context boolean := false;
begin
  begin
    if jsonb_typeof(p_browser_state) = 'object' then
      v_root := p_browser_state;
    elsif jsonb_typeof(p_browser_state) = 'string' then
      v_root := (p_browser_state #>> '{}')::jsonb;
      if jsonb_typeof(v_root) <> 'object' then
        v_root := '{}'::jsonb;
      end if;
    end if;
  exception when others then
    v_root := '{}'::jsonb;
  end;

  v_typed := v_root #> '{supervisor_lifecycle,service_throttle}';
  if jsonb_typeof(v_typed) = 'object' then
    v_typed_schema := v_typed ->> 'schema';
    v_typed_state := upper(coalesce(v_typed ->> 'state', ''));
    if v_typed_schema = 'metaengine.chatgpt-service-throttle.v1'
       and v_typed_state = 'THROTTLED' then
      return jsonb_build_object(
        'blocked', true,
        'reason', 'CHATGPT_RATE_LIMIT_BACKPRESSURE',
        'source', 'TYPED_SERVICE_THROTTLE_V1',
        'page_signal_authority', false,
        'automatic_retry_allowed', false,
        'authority_effect', false
      );
    end if;
  end if;

  -- The state row itself is already required fresh by the lease function. Legacy
  -- fallback additionally requires the embedded native perception to be fresh.
  v_perception := v_root -> 'perception';
  if jsonb_typeof(v_perception) = 'object'
     and v_perception ->> 'schema' = 'metaengine.native-browser.perception.v1'
     and coalesce(p_state_seen_at, '-infinity'::timestamptz) >= p_now - interval '20 seconds'
     and coalesce(p_state_seen_at, 'infinity'::timestamptz) <= p_now + interval '5 seconds'
  then
    begin
      v_captured_at := (v_perception ->> 'captured_at')::timestamptz;
    exception when others then
      v_captured_at := null;
    end;

    if v_captured_at is not null
       and v_captured_at >= p_now - interval '20 seconds'
       and v_captured_at <= p_now + interval '5 seconds'
    then
      v_url := coalesce(v_perception ->> 'url', '');
      v_text := left(coalesce(v_perception ->> 'text_excerpt', ''), 16000);
      if jsonb_typeof(v_perception -> 'semantic_targets') = 'array' then
        v_targets := v_perception -> 'semantic_targets';
      end if;

      select exists (
        select 1
          from jsonb_array_elements(v_targets) target
         where lower(coalesce(target ->> 'role', '')) = 'button'
           and lower(btrim(coalesce(target ->> 'name', ''))) in ('понятно', 'got it', 'ok', 'okay')
      ) into v_has_ack;

      select exists (
        select 1
          from jsonb_array_elements(v_targets) target
         where lower(coalesce(target ->> 'role', '')) = 'textbox'
      ) into v_has_composer;

      v_headline := lower(v_text) ~ '(слишком[[:space:]]+много[[:space:]]+запросов|too[[:space:]]+many[[:space:]]+requests|requests?[[:space:]]+too[[:space:]]+frequently)';
      v_context := lower(v_text) ~ '(доступ[[:space:]]+к[[:space:]]+вашим[[:space:]]+диалогам[[:space:]]+временно[[:space:]]+ограничен|подождите[[:space:]]+несколько[[:space:]]+минут|temporarily[[:space:]]+(limited|restricted)|wait[[:space:]]+(a[[:space:]]+few|several)[[:space:]]+minutes)';

      if v_url ~* '^https://(www\.)?chatgpt\.com(/.*)?$'
         and v_headline
         and v_context
         and (v_has_ack or not v_has_composer)
      then
        return jsonb_build_object(
          'blocked', true,
          'reason', 'CHATGPT_RATE_LIMIT_BACKPRESSURE',
          'source', 'LEGACY_FRESH_PERCEPTION_V1',
          'page_signal_authority', false,
          'automatic_retry_allowed', false,
          'authority_effect', false
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'blocked', false,
    'reason', case
      when v_typed_schema = 'metaengine.chatgpt-service-throttle.v1'
       and v_typed_state = 'AVAILABLE'
      then 'TYPED_SERVICE_AVAILABLE'
      else 'NO_PRECISE_RATE_LIMIT_EVIDENCE'
    end,
    'source', case
      when v_typed_schema = 'metaengine.chatgpt-service-throttle.v1'
       and v_typed_state = 'AVAILABLE'
      then 'TYPED_SERVICE_THROTTLE_V1'
      else null
    end,
    'page_signal_authority', false,
    'automatic_retry_allowed', false,
    'authority_effect', false
  );
end
$function$;

revoke all on function destruktion_meta.devos_chatgpt_rate_limit_backpressure_v2(jsonb,timestamptz,timestamptz) from public;

create or replace function public.devos_fleet_lease_v1(
  p_workspace uuid,
  p_agent text,
  p_role text,
  p_tab text,
  p_target text,
  p_epoch bigint,
  p_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta
as $function$
declare
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_claim bigint;
  v_secs int := greatest(60, least(3600, coalesce(p_seconds, 900)));
  v_now timestamptz := clock_timestamp();
  v_age_boost int := 0;
  v_effective_priority int := 0;
  v_browser_state jsonb := null;
  v_browser_seen_at timestamptz := null;
  v_backpressure jsonb := '{}'::jsonb;
begin
  select s.state, s.last_seen_at
    into v_browser_state, v_browser_seen_at
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
   where s.workspace_id = p_workspace
     and s.last_seen_at > v_now - interval '20 seconds'
     and s.supervisor_mode = 'CONTROL'
     and s.armed = true
   order by s.last_seen_at desc
   limit 1;

  v_backpressure := destruktion_meta.devos_chatgpt_rate_limit_backpressure_v2(
    v_browser_state,
    v_browser_seen_at,
    v_now
  );

  if coalesce((v_backpressure ->> 'blocked')::boolean, false) then
    return jsonb_build_object(
      'leased', false,
      'agent_id', lower(p_agent),
      'role', upper(p_role),
      'reason', 'CHATGPT_RATE_LIMIT_BACKPRESSURE',
      'backpressure', true,
      'backpressure_source', v_backpressure ->> 'source',
      'retry_after_ms', 60000,
      'scheduler_policy', 'priority_plus_bounded_age_v1',
      'page_signal_authority', false,
      'automatic_retry_allowed', false,
      'authority_effect', false
    );
  end if;

  update destruktion_meta.devos_fleet_task_h205f22
     set state = 'AMBIGUOUS',
         error_code = 'LEASE_EXPIRED_EFFECT_UNKNOWN',
         updated_at = v_now
   where workspace_id = p_workspace
     and state in ('LEASED','RUNNING')
     and lease_expires_at <= v_now;

  update destruktion_meta.devos_fleet_claim_h205f22
     set state = 'EXPIRED',
         updated_at = v_now
   where workspace_id = p_workspace
     and state = 'ACTIVE'
     and expires_at <= v_now;

  with picked as (
    select t.task_id
      from destruktion_meta.devos_fleet_task_h205f22 t
     where t.workspace_id = p_workspace
       and t.state = 'READY'
       and t.role = upper(p_role)
       and not exists (
         select 1
           from destruktion_meta.devos_fleet_claim_h205f22 c
          where c.workspace_id = p_workspace
            and c.agent_id = lower(p_agent)
            and c.state = 'ACTIVE'
       )
       and (
         t.claim_class <> 'MUTATING'
         or not exists (
           select 1
             from destruktion_meta.devos_fleet_claim_h205f22 c
            where c.workspace_id = t.workspace_id
              and c.point_id = t.point_id
              and c.base_sha = t.base_sha
              and c.claim_class = 'MUTATING'
              and c.state = 'ACTIVE'
         )
       )
     order by
       (
         t.priority
         + least(
             24,
             greatest(
               0,
               floor(extract(epoch from (v_now - t.created_at)) / 900.0)::int
             )
           )
       ) desc,
       t.priority desc,
       t.created_at,
       t.task_id
     for update skip locked
     limit 1
  )
  update destruktion_meta.devos_fleet_task_h205f22 t
     set state = 'LEASED',
         lease_generation = t.lease_generation + 1,
         lease_agent_id = lower(p_agent),
         lease_tab_id = p_tab,
         lease_target_id = lower(p_target),
         lease_agent_generation_epoch = p_epoch,
         lease_expires_at = v_now + make_interval(secs => v_secs),
         updated_at = v_now
    from picked p
   where t.task_id = p.task_id
  returning t.* into v_task;

  if not found then
    return jsonb_build_object(
      'leased', false,
      'agent_id', lower(p_agent),
      'role', upper(p_role),
      'scheduler_policy', 'priority_plus_bounded_age_v1',
      'automatic_retry_allowed', false,
      'authority_effect', false
    );
  end if;

  v_age_boost := least(
    24,
    greatest(
      0,
      floor(extract(epoch from (v_now - v_task.created_at)) / 900.0)::int
    )
  );
  v_effective_priority := v_task.priority + v_age_boost;

  insert into destruktion_meta.devos_fleet_claim_h205f22(
    task_id,
    workspace_id,
    point_id,
    base_sha,
    role,
    claim_class,
    agent_id,
    tab_id,
    target_id,
    agent_generation_epoch,
    lease_generation,
    expires_at
  ) values (
    v_task.task_id,
    v_task.workspace_id,
    v_task.point_id,
    v_task.base_sha,
    v_task.role,
    v_task.claim_class,
    lower(p_agent),
    p_tab,
    lower(p_target),
    p_epoch,
    v_task.lease_generation,
    v_task.lease_expires_at
  )
  returning claim_id into v_claim;

  perform destruktion_meta.devos_emit_event_h205f22(
    v_task.workspace_id,
    'TASK_LEASED',
    v_task.task_id,
    v_task.point_id,
    v_task.role,
    lower(p_agent),
    v_task.lease_generation,
    v_task.base_sha,
    jsonb_build_object(
      'claim_id', v_claim,
      'tab_id', p_tab,
      'target_id', lower(p_target),
      'agent_generation_epoch', p_epoch,
      'lease_expires_at', v_task.lease_expires_at,
      'raw_priority', v_task.priority,
      'age_boost', v_age_boost,
      'effective_priority', v_effective_priority,
      'scheduler_policy', 'priority_plus_bounded_age_v1',
      'automatic_retry_allowed', false,
      'authority_effect', false
    ),
    v_task.idempotency_key || ':lease:' || v_task.lease_generation
  );

  return jsonb_build_object(
    'leased', true,
    'task_id', v_task.task_id,
    'claim_id', v_claim,
    'point_id', v_task.point_id,
    'role', v_task.role,
    'claim_class', v_task.claim_class,
    'base_sha', v_task.base_sha,
    'branch_name', v_task.branch_name,
    'task_spec', v_task.task_spec,
    'task_spec_sha256', v_task.task_spec_sha256,
    'lease_generation', v_task.lease_generation,
    'lease_expires_at', v_task.lease_expires_at,
    'agent_id', lower(p_agent),
    'tab_id', p_tab,
    'target_id', lower(p_target),
    'agent_generation_epoch', p_epoch,
    'raw_priority', v_task.priority,
    'age_boost', v_age_boost,
    'effective_priority', v_effective_priority,
    'scheduler_policy', 'priority_plus_bounded_age_v1',
    'automatic_retry_allowed', false,
    'authority_effect', false
  );
end
$function$;

revoke all on function public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer) from public;
grant execute on function public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer) to service_role;
