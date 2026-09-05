-- METAENGINE Browser Control Plane Fast Lane V1
--
-- SOURCE-ONLY / DEVELOPMENT-STAGING CONTRACT.
-- Do not apply this file automatically to production. It changes command admission
-- semantics from one mutation per client to one leased mutation per exact effect key.
-- Prove it against replay/load fixtures first, then graduate a separately reviewed
-- Supabase migration/change window.
--
-- Core invariants:
--   * DB lease remains authority; wake/push delivery never is authority.
--   * READ_ONLY commands have zero action-budget cost.
--   * JS and DB action classifiers must remain exact-parity for READ_ONLY actions.
--   * multiple READ_ONLY commands may be leased together.
--   * explicit distinct-tab mutations may be leased concurrently.
--   * same-tab mutations remain one leased effect at a time.
--   * GLOBAL/EMERGENCY mutations are exclusive against every mutation.
--   * no automatic retry follows an ambiguous physical effect.

begin;

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  add column if not exists command_lane text generated always as (
    case
      when action in (
        'POLL','CAPTURE','CAPTURE_VIEW','CONTROL_CAPABILITIES',
        'PROCESS_CENSUS','PROCESS_EVENTS','SEMANTIC_CENSUS','SEMANTIC_EVENTS','CONTROL_LATENCY_STATUS',
        'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES',
        'DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
        'DOWNLOAD_STATUS','SELF_UPDATE_STATUS','GATE_STATUS','TAB_CENSUS','FLEET_STATUS'
      ) then 'READ_ONLY'
      when action='DISARM'
        or (action='SET_SUPERVISOR_MODE' and upper(coalesce(payload->>'mode',''))='OFF')
        then 'EMERGENCY'
      when action in (
        'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK',
        'SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD'
      ) and coalesce(payload->>'tab_id','') ~ '^tab_[0-9A-Fa-f-]{36}$'
        then 'TAB_MUTATION'
      else 'GLOBAL_MUTATION'
    end
  ) stored,
  add column if not exists effect_key text generated always as (
    case
      when action in (
        'POLL','CAPTURE','CAPTURE_VIEW','CONTROL_CAPABILITIES',
        'PROCESS_CENSUS','PROCESS_EVENTS','SEMANTIC_CENSUS','SEMANTIC_EVENTS','CONTROL_LATENCY_STATUS',
        'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES',
        'DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
        'DOWNLOAD_STATUS','SELF_UPDATE_STATUS','GATE_STATUS','TAB_CENSUS','FLEET_STATUS'
      ) then null
      when action='DISARM'
        or (action='SET_SUPERVISOR_MODE' and upper(coalesce(payload->>'mode',''))='OFF')
        then 'global:emergency'
      when action in (
        'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK',
        'SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD'
      ) and coalesce(payload->>'tab_id','') ~ '^tab_[0-9A-Fa-f-]{36}$'
        then 'tab:' || lower(payload->>'tab_id')
      else 'global:control-plane'
    end
  ) stored;

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  drop constraint if exists browser_control_command_lane_v1_ck;
alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  add constraint browser_control_command_lane_v1_ck
  check (command_lane in ('READ_ONLY','TAB_MUTATION','GLOBAL_MUTATION','EMERGENCY'));

-- The old index serializes every mutation for an entire Browser client and includes
-- PENDING rows. That prevents a queue of independent per-tab work from existing.
drop index if exists public.a2_browser_supervisor_one_mutating_inflight_uq;

-- Multiple PENDING effects are queue state, not execution authority. Only LEASED
-- effects require exclusivity. NULL target_client_id is normalized so untargeted
-- commands cannot bypass the fence through PostgreSQL NULL uniqueness semantics.
create unique index if not exists a2_browser_supervisor_one_leased_effect_key_uq
  on public.compute_fabric_a2_browser_supervisor_command_h205f22(
    workspace_id,
    coalesce(target_client_id,'*'),
    effect_key
  )
  where status='LEASED' and command_lane <> 'READ_ONLY';

create index if not exists a2_browser_supervisor_fast_pending_v1_idx
  on public.compute_fabric_a2_browser_supervisor_command_h205f22(
    workspace_id,
    target_client_id,
    status,
    command_lane,
    issued_at,
    command_id
  )
  where status='PENDING';

create or replace function public.h205f22_a2_browser_supervisor_lease_batch_v1(
  p_workspace_id uuid,
  p_client_id text,
  p_supervisor_mode text default 'OFF',
  p_lease_timeout_seconds integer default 120,
  p_max_batch integer default 64,
  p_max_tab_mutations integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_mode text := upper(coalesce(p_supervisor_mode,'OFF'));
  v_now timestamptz := clock_timestamp();
  v_timeout integer := greatest(30, least(600, coalesce(p_lease_timeout_seconds,120)));
  v_batch integer := greatest(1, least(64, coalesce(p_max_batch,64)));
  v_mutations integer := greatest(1, least(16, coalesce(p_max_tab_mutations,8)));
  v_rows jsonb := '[]'::jsonb;
  v_has_leased_mutation boolean := false;
  v_has_leased_exclusive boolean := false;
begin
  if p_workspace_id is null or v_client='' then raise exception 'supervisor_batch_lease_identity_invalid'; end if;
  if v_mode not in ('OFF','MONITOR','CONTROL') then raise exception 'supervisor_batch_lease_mode_invalid'; end if;

  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status='EXPIRED', completed_at=v_now, error='command_expired_before_lease'
   where workspace_id=p_workspace_id and status='PENDING' and expires_at<=v_now;

  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status='EXPIRED', completed_at=v_now, error='lease_timeout_no_retry'
   where workspace_id=p_workspace_id and status='LEASED'
     and (expires_at<=v_now or leased_at is null or leased_at<=v_now-make_interval(secs=>v_timeout));

  select exists(
    select 1 from public.compute_fabric_a2_browser_supervisor_command_h205f22
     where workspace_id=p_workspace_id
       and (target_client_id is null or target_client_id=v_client)
       and status='LEASED' and command_lane<>'READ_ONLY'
  ), exists(
    select 1 from public.compute_fabric_a2_browser_supervisor_command_h205f22
     where workspace_id=p_workspace_id
       and (target_client_id is null or target_client_id=v_client)
       and status='LEASED' and command_lane in ('GLOBAL_MUTATION','EMERGENCY')
  ) into v_has_leased_mutation, v_has_leased_exclusive;

  with eligible as (
    select c.*,
      case c.command_lane
        when 'EMERGENCY' then 0
        when 'READ_ONLY' then 10
        when 'GLOBAL_MUTATION' then 15
        when 'TAB_MUTATION' then 20
        else 99
      end as lane_priority,
      row_number() over (partition by c.effect_key order by c.issued_at,c.command_id) as effect_rank
    from public.compute_fabric_a2_browser_supervisor_command_h205f22 c
    where c.workspace_id=p_workspace_id
      and c.status='PENDING'
      and c.expires_at>v_now
      and (c.target_client_id is null or c.target_client_id=v_client)
      and (
        v_mode='CONTROL'
        or c.command_lane='READ_ONLY'
        or c.command_lane='EMERGENCY'
      )
  ), first_mutation as (
    select e.command_id,e.command_lane,e.issued_at
      from eligible e
     where e.command_lane<>'READ_ONLY'
     order by e.lane_priority,e.issued_at,e.command_id
     limit 1
  ), reads as (
    select e.command_id
      from eligible e
     where e.command_lane='READ_ONLY'
     order by e.issued_at,e.command_id
     limit v_batch
  ), mutation_candidates as (
    select e.command_id
      from eligible e
      cross join lateral (select * from first_mutation limit 1) f
     where not v_has_leased_exclusive
       and (
         (f.command_lane in ('GLOBAL_MUTATION','EMERGENCY')
           and not v_has_leased_mutation
           and e.command_id=f.command_id)
         or
         (f.command_lane='TAB_MUTATION'
           and e.command_lane='TAB_MUTATION'
           and e.effect_rank=1
           and not exists (
             select 1 from public.compute_fabric_a2_browser_supervisor_command_h205f22 leased
              where leased.workspace_id=p_workspace_id
                and (leased.target_client_id is null or leased.target_client_id=v_client)
                and leased.status='LEASED'
                and leased.effect_key=e.effect_key
           )
           and not exists (
             select 1 from first_mutation barrier
              where barrier.command_lane in ('GLOBAL_MUTATION','EMERGENCY')
                and e.issued_at>barrier.issued_at
           ))
       )
     order by e.issued_at,e.command_id
     limit v_mutations
  ), picked as (
    select command_id from reads
    union
    select command_id from mutation_candidates
    limit v_batch
  ), locked as (
    select c.command_id
      from public.compute_fabric_a2_browser_supervisor_command_h205f22 c
      join picked p using(command_id)
     where c.status='PENDING'
     order by c.issued_at,c.command_id
     for update of c skip locked
  ), leased as (
    update public.compute_fabric_a2_browser_supervisor_command_h205f22 c
       set status='LEASED', leased_by=v_client, leased_at=v_now
      from locked l
     where c.command_id=l.command_id and c.status='PENDING'
     returning c.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'command_id',command_id,
    'idempotency_key',idempotency_key,
    'action',action,
    'platform',platform,
    'payload',payload,
    'issued_at',issued_at,
    'expires_at',expires_at,
    'issued_by',issued_by,
    'command_lane',command_lane,
    'effect_key',effect_key,
    'authority_effect',false
  ) order by issued_at,command_id),'[]'::jsonb)
  into v_rows from leased;

  return jsonb_build_object(
    'schema','metaengine.native-supervisor.command-batch.v1',
    'commands',v_rows,
    'leased_count',jsonb_array_length(v_rows),
    'max_batch',v_batch,
    'max_tab_mutations',v_mutations,
    'transport_delivery_is_authority',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end;
$$;

create or replace function public.h205f22_a2_browser_supervisor_complete_batch_v1(
  p_workspace_id uuid,
  p_client_id text,
  p_results jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_item jsonb;
  v_command_id uuid;
  v_ok boolean;
  v_receipt jsonb;
  v_error text;
  v_row public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_out jsonb := '[]'::jsonb;
  v_outcome text;
begin
  if p_workspace_id is null or v_client='' then raise exception 'supervisor_batch_complete_identity_invalid'; end if;
  if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>64 then raise exception 'supervisor_batch_complete_results_invalid'; end if;

  for v_item in select value from jsonb_array_elements(p_results)
  loop
    begin
      v_command_id := (v_item->>'command_id')::uuid;
    exception when others then
      raise exception 'supervisor_batch_complete_command_id_invalid';
    end;
    v_ok := coalesce((v_item->>'ok')::boolean,false);
    v_receipt := coalesce(v_item->'receipt','{}'::jsonb);
    v_error := left(coalesce(v_item->>'error','command_failed'),500);
    if jsonb_typeof(v_receipt)<>'object' then raise exception 'supervisor_batch_complete_receipt_invalid'; end if;

    select * into v_row
      from public.compute_fabric_a2_browser_supervisor_command_h205f22
     where workspace_id=p_workspace_id and command_id=v_command_id
     for update;
    if not found then
      v_out := v_out || jsonb_build_array(jsonb_build_object('command_id',v_command_id,'accepted',false,'status','NOT_FOUND','authority_effect',false));
      continue;
    end if;
    if v_row.status<>'LEASED' or v_row.leased_by is distinct from v_client then
      v_out := v_out || jsonb_build_array(jsonb_build_object('command_id',v_command_id,'accepted',false,'status',v_row.status,'error','supervisor_lease_not_current','authority_effect',false));
      continue;
    end if;

    v_outcome := upper(coalesce(v_receipt->>'effect_outcome',''));
    if v_row.command_lane<>'READ_ONLY' and v_ok and v_outcome<>'CONFIRMED' then
      v_ok := false;
      v_error := case when v_outcome='' then 'postcondition_readback_required' else 'postcondition_not_confirmed:'||left(v_outcome,80) end;
    end if;

    update public.compute_fabric_a2_browser_supervisor_command_h205f22
       set status=case when v_ok then 'COMPLETED' else 'FAILED' end,
           completed_at=clock_timestamp(),
           receipt=case when v_ok then jsonb_set(v_receipt,'{authority_effect}',to_jsonb(v_row.command_lane<>'READ_ONLY'),true) else v_receipt end,
           error=case when v_ok then null else v_error end,
           authority_effect=v_ok and v_row.command_lane<>'READ_ONLY'
     where command_id=v_command_id;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'command_id',v_command_id,
      'accepted',true,
      'status',case when v_ok then 'COMPLETED' else 'FAILED' end,
      'effect_outcome',nullif(v_outcome,''),
      'authority_effect',v_ok and v_row.command_lane<>'READ_ONLY'
    ));
  end loop;

  return jsonb_build_object(
    'schema','metaengine.native-supervisor.command-batch-completion.v1',
    'results',v_out,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_lease_batch_v1(uuid,text,text,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.h205f22_a2_browser_supervisor_complete_batch_v1(uuid,text,jsonb) from public, anon, authenticated;
-- Grant only to the trusted Edge/runtime caller in the separately reviewed live migration.
-- grant execute on function public.h205f22_a2_browser_supervisor_lease_batch_v1(uuid,text,text,integer,integer,integer) to service_role;
-- grant execute on function public.h205f22_a2_browser_supervisor_complete_batch_v1(uuid,text,jsonb) to service_role;

-- Staging proofs required before promotion:
-- 1. 64 read-only commands lease in one transaction and cost zero action budget.
-- 2. distinct explicit tab effect keys can be LEASED together; same key cannot.
-- 3. GLOBAL/EMERGENCY lease only when no mutation is already LEASED.
-- 4. multiple PENDING same-tab commands queue safely and lease one at a time.
-- 5. READ_ONLY can complete without effect_outcome; mutation cannot complete without CONFIRMED readback.
-- 6. dropped/duplicated wakeups cannot grant authority or duplicate a physical effect.
-- 7. replay by idempotency key preserves one logical command identity.
-- 8. JS/DB read-only classifier parity includes process + semantic census/events and latency telemetry.
-- 9. old single-command endpoints remain compatible during the strangler cutover.

rollback;