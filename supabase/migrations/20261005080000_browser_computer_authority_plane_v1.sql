-- METAENGINE Computer Authority Plane V1.
--
-- Adds three provider-neutral typed commands to the existing native Browser
-- command fabric. This migration does not create a scheduler, lease loop, retry
-- loop, or an alternate execution path. COMPUTER_ACTION stays a GLOBAL_MUTATION
-- and therefore remains serialized with other global physical effects.
--
-- The dedicated issuer refuses old clients: the target heartbeat must attest a
-- Windows Local Computer Executor V1 before any Computer command is admitted.

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  drop constraint if exists a2_browser_supervisor_command_action_ck;

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  add constraint a2_browser_supervisor_command_action_ck
  check (action = any(array[
    'ARM','DISARM','SET_SUPERVISOR_MODE','SET_MODE',
    'POLL','CAPTURE','CAPTURE_VIEW','CONTROL_CAPABILITIES',
    'PROCESS_CENSUS','PROCESS_EVENTS','SEMANTIC_CENSUS','SEMANTIC_EVENTS','CONTROL_LATENCY_STATUS',
    'TAB_TELEMETRY','SYSTEM_TELEMETRY','READ_TRANSCRIPT',
    'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK','PRESS_KEY',
    'NEW_TAB','SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD',
    'FLEET_RECONCILE','FLEET_SET_PROFILE','FLEET_STATUS','TAB_CENSUS',
    'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
    'DOWNLOAD_STATUS','DOWNLOAD_FILE','DOWNLOAD_CANCEL',
    'SELF_UPDATE_STATUS','SELF_UPDATE_CHECK','SELF_UPDATE_APPLY',
    'DEVELOPER_EMERGENCY_UPDATE',
    'GATE_STATUS','GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL',
    'COMPUTER_STATUS','COMPUTER_OBSERVE','COMPUTER_ACTION'
  ]::text[]));

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  drop column if exists command_lane;
alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  drop column if exists effect_key;

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  add column command_lane text generated always as (
    case
      when action in (
        'POLL','CAPTURE','CAPTURE_VIEW','CONTROL_CAPABILITIES',
        'PROCESS_CENSUS','PROCESS_EVENTS','SEMANTIC_CENSUS','SEMANTIC_EVENTS','CONTROL_LATENCY_STATUS',
        'TAB_TELEMETRY','SYSTEM_TELEMETRY','READ_TRANSCRIPT',
        'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
        'DOWNLOAD_STATUS','SELF_UPDATE_STATUS','GATE_STATUS','TAB_CENSUS','FLEET_STATUS',
        'COMPUTER_STATUS','COMPUTER_OBSERVE'
      ) then 'READ_ONLY'
      when action in ('DISARM','DEVELOPER_EMERGENCY_UPDATE')
        or (action='SET_SUPERVISOR_MODE' and upper(coalesce(payload->>'mode',''))='OFF') then 'EMERGENCY'
      when action in (
        'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK','PRESS_KEY',
        'SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD'
      ) and coalesce(payload->>'tab_id','') ~ '^tab_[0-9A-Fa-f-]{36}$' then 'TAB_MUTATION'
      else 'GLOBAL_MUTATION'
    end
  ) stored;

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  add column effect_key text generated always as (
    case
      when action in (
        'POLL','CAPTURE','CAPTURE_VIEW','CONTROL_CAPABILITIES',
        'PROCESS_CENSUS','PROCESS_EVENTS','SEMANTIC_CENSUS','SEMANTIC_EVENTS','CONTROL_LATENCY_STATUS',
        'TAB_TELEMETRY','SYSTEM_TELEMETRY','READ_TRANSCRIPT',
        'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
        'DOWNLOAD_STATUS','SELF_UPDATE_STATUS','GATE_STATUS','TAB_CENSUS','FLEET_STATUS',
        'COMPUTER_STATUS','COMPUTER_OBSERVE'
      ) then null
      when action in ('DISARM','DEVELOPER_EMERGENCY_UPDATE')
        or (action='SET_SUPERVISOR_MODE' and upper(coalesce(payload->>'mode',''))='OFF') then 'global:emergency'
      when action in (
        'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK','PRESS_KEY',
        'SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD'
      ) and coalesce(payload->>'tab_id','') ~ '^tab_[0-9A-Fa-f-]{36}$' then 'tab:' || lower(payload->>'tab_id')
      else 'global:control-plane'
    end
  ) stored;

create or replace function public.h205f22_a2_browser_supervisor_issue_computer_v1(
  p_client_id text,
  p_action text,
  p_payload jsonb default '{}'::jsonb,
  p_ttl_seconds integer default 120,
  p_issued_by text default 'CHATGPT_SUPERVISOR',
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_workspace constant uuid := '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid;
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_action text := upper(trim(coalesce(p_action,'')));
  v_issued_by text := left(trim(coalesce(p_issued_by,'CHATGPT_SUPERVISOR')),160);
  v_ttl integer := greatest(30,least(600,coalesce(p_ttl_seconds,120)));
  v_command_id uuid := pg_catalog.gen_random_uuid();
  v_key text;
  v_state public.compute_fabric_a2_browser_supervisor_state_h205f22%rowtype;
  v_existing public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_state_json jsonb;
  v_subaction text;
  v_inserted boolean := false;
begin
  if v_client='' then raise exception 'computer_client_required'; end if;
  if v_action not in ('COMPUTER_STATUS','COMPUTER_OBSERVE','COMPUTER_ACTION') then
    raise exception 'computer_command_action_invalid';
  end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>131072 then
    raise exception 'computer_command_payload_invalid';
  end if;

  if v_action='COMPUTER_STATUS' then
    if p_payload <> '{}'::jsonb then raise exception 'computer_status_payload_must_be_empty'; end if;
  else
    v_subaction := upper(trim(coalesce(p_payload->>'action','')));
    if v_action='COMPUTER_OBSERVE' and v_subaction not in ('OBSERVE_WINDOWS','UIA_SNAPSHOT','CAPTURE_DESKTOP','VERIFY_TARGET') then
      raise exception 'computer_observe_action_invalid';
    end if;
    if v_action='COMPUTER_ACTION' and v_subaction not in ('UIA_FOCUS','UIA_INVOKE','TYPE_TEXT','KEY_PRESS','POINTER_CLICK') then
      raise exception 'computer_mutation_action_invalid';
    end if;
  end if;

  if v_action='COMPUTER_ACTION' then
    if coalesce(p_payload->>'agent_id','') !~ '^agent_[A-Za-z0-9-]{8,64}$' then
      raise exception 'computer_agent_id_invalid';
    end if;
    if jsonb_typeof(p_payload->'target') <> 'object' then raise exception 'computer_target_required'; end if;
    if coalesce(p_payload#>>'{target,machine_fingerprint_sha256}','') !~ '^[0-9a-f]{64}$' then raise exception 'computer_machine_fingerprint_invalid'; end if;
    if coalesce(p_payload#>>'{target,executable_sha256}','') !~ '^[0-9a-f]{64}$' then raise exception 'computer_executable_sha256_invalid'; end if;
    if coalesce(p_payload#>>'{target,window_handle}','') !~ '^0x[0-9A-Fa-f]+$' then raise exception 'computer_window_handle_invalid'; end if;
    if coalesce(p_payload#>>'{target,session_id}','') !~ '^[0-9]{1,10}$' then raise exception 'computer_session_id_invalid'; end if;
    if coalesce(p_payload#>>'{target,process_id}','') !~ '^[1-9][0-9]{0,9}$' then raise exception 'computer_process_id_invalid'; end if;
    if coalesce(p_payload#>>'{target,process_creation_time_ms}','') !~ '^[1-9][0-9]{10,16}$' then raise exception 'computer_process_creation_time_invalid'; end if;
    if coalesce(p_payload#>>'{target,generation}','') !~ '^[1-9][0-9]{0,15}$' then raise exception 'computer_generation_invalid'; end if;
    if coalesce(p_payload->>'target_identity_sha256','') !~ '^[0-9a-f]{64}$' then
      raise exception 'computer_target_identity_digest_required';
    end if;
  end if;

  select * into v_state
    from public.compute_fabric_a2_browser_supervisor_state_h205f22
   where client_id=v_client and workspace_id=v_workspace;
  if not found then raise exception 'computer_client_not_seen'; end if;
  if v_state.last_seen_at < clock_timestamp()-interval '45 seconds' then raise exception 'computer_client_stale'; end if;

  v_state_json := v_state.state;
  if jsonb_typeof(v_state_json)='string' then
    begin
      v_state_json := (v_state_json #>> '{}')::jsonb;
    exception when others then
      raise exception 'computer_state_transport_invalid';
    end;
  end if;
  if jsonb_typeof(v_state_json)<>'object' then raise exception 'computer_state_transport_invalid'; end if;
  if coalesce(v_state_json->>'client_kind','') <> 'METAENGINE_BROWSER_ELECTRON_NATIVE' then
    raise exception 'computer_client_kind_invalid';
  end if;
  if coalesce(v_state_json#>>'{computer_authority,schema}','') <> 'metaengine.windows-local-computer-executor.v1'
     or coalesce((v_state_json#>>'{computer_authority,available}')::boolean,false) is not true then
    raise exception 'computer_authority_not_attested';
  end if;

  v_key := coalesce(nullif(trim(p_idempotency_key),''),'computer:'||v_command_id::text);
  if char_length(v_key)<16 or char_length(v_key)>160 or v_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'computer_idempotency_invalid';
  end if;

  insert into public.compute_fabric_a2_browser_supervisor_command_h205f22(
    command_id,workspace_id,target_client_id,issued_by,action,platform,payload,status,
    issued_at,expires_at,authority_effect,idempotency_key
  ) values (
    v_command_id,v_workspace,v_client,v_issued_by,v_action,null,p_payload,'PENDING',
    clock_timestamp(),clock_timestamp()+make_interval(secs=>v_ttl),false,v_key
  )
  on conflict (workspace_id,idempotency_key) where idempotency_key is not null do nothing
  returning * into v_existing;
  v_inserted := found;

  if not v_inserted then
    select * into v_existing
      from public.compute_fabric_a2_browser_supervisor_command_h205f22
     where workspace_id=v_workspace and idempotency_key=v_key;
    if not found then raise exception 'computer_idempotency_readback_missing'; end if;
    if v_existing.target_client_id is distinct from v_client
       or v_existing.action is distinct from v_action
       or v_existing.platform is not null
       or v_existing.payload is distinct from p_payload then
      raise exception 'computer_idempotency_collision' using errcode='22023';
    end if;
  end if;

  return jsonb_build_object(
    'schema','metaengine.computer-command-issue.v1',
    'accepted',true,
    'replayed',not v_inserted,
    'command_id',v_existing.command_id,
    'client_id',v_existing.target_client_id,
    'action',v_existing.action,
    'status',v_existing.status,
    'command_lane',v_existing.command_lane,
    'effect_key',v_existing.effect_key,
    'expires_at',v_existing.expires_at,
    'idempotency_key',v_existing.idempotency_key,
    'command_leasing',false,
    'scheduler_authority',false,
    'execution_authority',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end;
$function$;

revoke all on function public.h205f22_a2_browser_supervisor_issue_computer_v1(text,text,jsonb,integer,text,text)
  from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_issue_computer_v1(text,text,jsonb,integer,text,text)
  to service_role;

comment on function public.h205f22_a2_browser_supervisor_issue_computer_v1(text,text,jsonb,integer,text,text) is
  'Issues typed provider-neutral Computer Authority Plane commands only to a live Browser that attests Windows Local Computer Executor V1. The RPC has no lease, scheduler, retry or execution authority.';


-- 4) Extend the one existing durable effect-intent store. This preserves the
-- same DB lease + effect-intent authority path for both Browser semantic and
-- Computer effects; no second authority table/RPC is introduced.
create or replace function public.h205f22_a2_browser_supervisor_bind_effect_v1(
  p_workspace_id uuid,
  p_command_id uuid,
  p_client_id text,
  p_binding jsonb,
  p_authority_effect boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_binding jsonb := p_binding;
  v_digest text;
  v_replayed boolean := false;
  v_schema text;
  v_tab_actions constant text[] := array[
    'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','TYPED_CLICK'
  ];
begin
  if p_authority_effect is distinct from false then raise exception 'native_effect_binding_authority_effect_invalid'; end if;
  if v_client = '' then raise exception 'native_effect_binding_client_required'; end if;

  if v_binding is not null and jsonb_typeof(v_binding) = 'string' then
    begin
      v_binding := (v_binding #>> '{}')::jsonb;
    exception when others then
      raise exception 'native_effect_binding_transport_invalid';
    end;
  end if;
  if v_binding is null or jsonb_typeof(v_binding) <> 'object' or octet_length(v_binding::text) > 16384 then
    raise exception 'native_effect_binding_object_invalid';
  end if;

  v_schema := coalesce(v_binding->>'schema','');
  if v_schema not in (
    'metaengine.native-supervisor.effect-binding.v1',
    'metaengine.native-supervisor.effect-binding.v2',
    'metaengine.native-supervisor.computer-effect-binding.v1'
  ) then
    raise exception 'native_effect_binding_schema_invalid';
  end if;
  if coalesce((v_binding->>'authority_effect')::boolean,true) is distinct from false
     or coalesce((v_binding->>'page_data_authority')::boolean,true) is distinct from false
     or coalesce((v_binding->>'automatic_retry_allowed')::boolean,true) is distinct from false then
    raise exception 'native_effect_binding_safety_flags_invalid';
  end if;
  if v_binding->>'command_id' <> p_command_id::text then raise exception 'native_effect_binding_command_mismatch'; end if;
  if v_binding->>'client_id' <> v_client then raise exception 'native_effect_binding_client_mismatch'; end if;

  select * into v_row
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where workspace_id=p_workspace_id and command_id=p_command_id
   for update;
  if not found then raise exception 'native_effect_binding_command_not_found'; end if;
  if v_row.status <> 'LEASED' then raise exception 'native_effect_binding_command_not_leased'; end if;
  if v_row.leased_by is distinct from v_client then raise exception 'native_effect_binding_wrong_lease_holder'; end if;
  if v_row.leased_at is null or v_row.expires_at <= clock_timestamp() then raise exception 'native_effect_binding_lease_expired'; end if;
  if v_row.idempotency_key is null or v_binding->>'idempotency_key' is distinct from v_row.idempotency_key then
    raise exception 'native_effect_binding_idempotency_mismatch';
  end if;
  if v_binding->>'action' is distinct from v_row.action then raise exception 'native_effect_binding_action_mismatch'; end if;
  if (v_binding->>'command_expires_at')::timestamptz is distinct from v_row.expires_at then
    raise exception 'native_effect_binding_expiry_mismatch';
  end if;

  if v_schema in (
    'metaengine.native-supervisor.effect-binding.v1',
    'metaengine.native-supervisor.effect-binding.v2'
  ) then
    if not (v_row.action = any(v_tab_actions)) then raise exception 'native_effect_binding_action_not_tab_effect'; end if;
    if coalesce(v_binding->>'process_incarnation_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'native_effect_binding_process_incarnation_invalid';
    end if;
    if coalesce(v_binding->>'tab_id','') !~ '^tab_[0-9a-f-]{36}$' then raise exception 'native_effect_binding_tab_invalid'; end if;
    if coalesce(v_binding->>'target_id','') !~ '^webcontents:[1-9][0-9]*$' then raise exception 'native_effect_binding_target_invalid'; end if;
    if v_row.payload->>'tab_id' is null or v_binding->>'tab_id' is distinct from v_row.payload->>'tab_id' then
      raise exception 'native_effect_binding_explicit_tab_mismatch';
    end if;

    if v_schema = 'metaengine.native-supervisor.effect-binding.v2' then
      if coalesce(v_binding->>'runtime_observation_id','') !~ '^obs_[0-9a-f]{32}$' then raise exception 'native_effect_binding_runtime_observation_id_invalid'; end if;
      if coalesce(v_binding->>'web_contents_id','') !~ '^[1-9][0-9]{0,15}$' then raise exception 'native_effect_binding_webcontents_invalid'; end if;
      if coalesce(v_binding->>'renderer_pid','') !~ '^[1-9][0-9]{0,15}$' then raise exception 'native_effect_binding_renderer_pid_invalid'; end if;
      if coalesce(v_binding->>'runtime_target_id','') !~ '^[A-Za-z0-9._:-]{1,192}$' then raise exception 'native_effect_binding_runtime_target_invalid'; end if;
      if coalesce(v_binding->>'attachment_generation','') !~ '^[1-9][0-9]{0,15}$' then raise exception 'native_effect_binding_attachment_generation_invalid'; end if;
      if coalesce(v_binding->>'document_generation','') !~ '^[1-9][0-9]{0,15}$' then raise exception 'native_effect_binding_document_generation_invalid'; end if;
      if coalesce(v_binding->>'binding_generation','') !~ '^[1-9][0-9]{0,15}$' then raise exception 'native_effect_binding_generation_invalid'; end if;
      if coalesce(v_binding->>'document_url_sha256','') !~ '^[0-9a-f]{64}$' then raise exception 'native_effect_binding_document_url_hash_invalid'; end if;
      if v_binding->>'runtime_observation_schema' is distinct from 'metaengine.native-supervisor.effect-runtime-observation.v1' then
        raise exception 'native_effect_binding_runtime_observation_schema_invalid';
      end if;
      if v_binding->>'target_id' is distinct from ('webcontents:' || (v_binding->>'web_contents_id')) then
        raise exception 'native_effect_binding_webcontents_target_mismatch';
      end if;
    end if;
  else
    if v_row.action is distinct from 'COMPUTER_ACTION' then raise exception 'native_computer_effect_binding_action_mismatch'; end if;
    if coalesce(v_binding->>'agent_id','') !~ '^agent_[a-z0-9-]{8,64}$' then raise exception 'native_computer_effect_binding_agent_invalid'; end if;
    if lower(coalesce(v_binding->>'agent_id','')) is distinct from lower(coalesce(v_row.payload->>'agent_id','')) then
      raise exception 'native_computer_effect_binding_agent_mismatch';
    end if;
    if upper(coalesce(v_binding->>'computer_action','')) is distinct from upper(coalesce(v_row.payload->>'action','')) then
      raise exception 'native_computer_effect_binding_subaction_mismatch';
    end if;
    if coalesce(v_binding->>'target_identity_sha256','') !~ '^[0-9a-f]{64}$' then
      raise exception 'native_computer_effect_binding_target_digest_invalid';
    end if;
    if v_binding->>'target_identity_sha256' is distinct from lower(coalesce(v_row.payload->>'target_identity_sha256','')) then
      raise exception 'native_computer_effect_binding_target_digest_mismatch';
    end if;
    if jsonb_typeof(v_binding->'target') <> 'object' or v_binding->'target' is distinct from v_row.payload->'target' then
      raise exception 'native_computer_effect_binding_target_mismatch';
    end if;
    if coalesce(v_binding#>>'{target,machine_fingerprint_sha256}','') !~ '^[0-9a-f]{64}$'
       or coalesce(v_binding#>>'{target,executable_sha256}','') !~ '^[0-9a-f]{64}$'
       or coalesce(v_binding#>>'{target,window_handle}','') !~ '^0x[0-9a-f]+$'
       or coalesce(v_binding#>>'{target,session_id}','') !~ '^[0-9]{1,10}$'
       or coalesce(v_binding#>>'{target,process_id}','') !~ '^[1-9][0-9]{0,9}$'
       or coalesce(v_binding#>>'{target,process_creation_time_ms}','') !~ '^[1-9][0-9]{10,16}$'
       or coalesce(v_binding#>>'{target,generation}','') !~ '^[1-9][0-9]{0,15}$' then
      raise exception 'native_computer_effect_binding_target_shape_invalid';
    end if;
  end if;

  if v_row.effect_binding is not null then
    if v_row.effect_binding is distinct from v_binding then raise exception 'native_effect_binding_conflict'; end if;
    v_replayed := true;
    return jsonb_build_object(
      'accepted',true,'replayed',true,'command_id',v_row.command_id,
      'effect_binding',v_row.effect_binding,'effect_binding_sha256',v_row.effect_binding_sha256,
      'effect_bound_at',v_row.effect_bound_at,'authority_effect',false
    );
  end if;

  v_digest := encode(extensions.digest(v_binding::text,'sha256'::text),'hex');
  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set effect_binding=v_binding,
         effect_bound_at=clock_timestamp(),
         effect_binding_sha256=v_digest
   where workspace_id=p_workspace_id and command_id=p_command_id;

  return jsonb_build_object(
    'accepted',true,'replayed',v_replayed,'command_id',p_command_id,
    'effect_binding',v_binding,'effect_binding_sha256',v_digest,
    'effect_bound_at',clock_timestamp(),'authority_effect',false
  );
end;
$function$;

-- 5) Single-result completion: Computer effects need the same immutable seal and
-- standard terminal readback. NO_EFFECT_PROVEN is successful command completion
-- but explicitly carries no physical authority effect.
create or replace function public.h205f22_a2_browser_supervisor_complete_v5(
  p_workspace_id uuid,
  p_command_id uuid,
  p_client_id text,
  p_ok boolean,
  p_receipt jsonb default '{}'::jsonb,
  p_error text default null,
  p_authority_effect boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_row public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_error text := left(coalesce(p_error,'command_failed'),500);
  v_effect boolean;
  v_ok boolean := coalesce(p_ok,false);
  v_receipt jsonb := coalesce(p_receipt,'{}'::jsonb);
  v_now timestamptz;
  v_binding_digest text;
  v_outcome text;
  v_bound_effect_actions constant text[] := array[
    'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','TYPED_CLICK','COMPUTER_ACTION'
  ];
begin
  if p_workspace_id is null or p_command_id is null or v_client='' then
    raise exception 'supervisor_result_identity_invalid';
  end if;
  if p_authority_effect is distinct from false then raise exception 'supervisor_result_authority_effect_invalid'; end if;
  if jsonb_typeof(v_receipt)='string' then
    begin v_receipt := (v_receipt #>> '{}')::jsonb;
    exception when others then raise exception 'supervisor_result_receipt_transport_invalid'; end;
  end if;
  if jsonb_typeof(v_receipt)<>'object' then raise exception 'supervisor_result_receipt_invalid'; end if;

  select * into v_row
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where workspace_id=p_workspace_id and command_id=p_command_id
   for update;
  if not found then raise exception 'supervisor_command_not_found'; end if;

  v_now := clock_timestamp();
  if v_row.status <> 'LEASED' or v_row.leased_by is distinct from v_client then
    return jsonb_build_object('accepted',false,'status',v_row.status,'error','supervisor_lease_not_current','authority_effect',false);
  end if;
  if v_row.expires_at <= v_now or v_row.leased_at is null or v_row.leased_at <= v_now - interval '10 minutes' then
    return jsonb_build_object('accepted',false,'status','EXPIRED','error','supervisor_lease_expired','authority_effect',false);
  end if;

  v_outcome := upper(coalesce(v_receipt->>'effect_outcome',''));
  if v_ok and v_row.action='COMPUTER_ACTION' and v_outcome not in ('CONFIRMED','NO_EFFECT_PROVEN') then
    v_ok := false;
    v_error := case when v_outcome='' then 'postcondition_readback_required'
      else 'postcondition_not_confirmed:'||left(v_outcome,80) end;
  end if;

  if v_ok and v_row.action = any(v_bound_effect_actions) then
    if v_row.effect_binding is null
       or v_row.effect_bound_at is null
       or coalesce(v_row.effect_binding_sha256,'') !~ '^[0-9a-f]{64}$'
       or v_row.idempotency_key is null
       or v_row.effect_binding->>'command_id' is distinct from v_row.command_id::text
       or v_row.effect_binding->>'client_id' is distinct from v_client
       or v_row.effect_binding->>'action' is distinct from v_row.action
       or v_row.effect_binding->>'idempotency_key' is distinct from v_row.idempotency_key
       or coalesce((v_row.effect_binding->>'authority_effect')::boolean,true) is distinct from false
       or coalesce((v_row.effect_binding->>'page_data_authority')::boolean,true) is distinct from false
       or coalesce((v_row.effect_binding->>'automatic_retry_allowed')::boolean,true) is distinct from false then
      v_ok := false;
      v_error := 'supervisor_effect_binding_required';
    elsif v_row.action='COMPUTER_ACTION' then
      if v_row.effect_binding->>'schema' is distinct from 'metaengine.native-supervisor.computer-effect-binding.v1'
         or lower(coalesce(v_row.effect_binding->>'agent_id','')) is distinct from lower(coalesce(v_row.payload->>'agent_id',''))
         or upper(coalesce(v_row.effect_binding->>'computer_action','')) is distinct from upper(coalesce(v_row.payload->>'action',''))
         or v_row.effect_binding->>'target_identity_sha256' is distinct from lower(coalesce(v_row.payload->>'target_identity_sha256',''))
         or v_row.effect_binding->'target' is distinct from v_row.payload->'target' then
        v_ok := false;
        v_error := 'supervisor_computer_effect_binding_required';
      end if;
    else
      if coalesce(v_row.effect_binding->>'schema','') not in (
           'metaengine.native-supervisor.effect-binding.v1',
           'metaengine.native-supervisor.effect-binding.v2'
         )
         or v_row.effect_binding->>'tab_id' is distinct from v_row.payload->>'tab_id' then
        v_ok := false;
        v_error := 'supervisor_effect_binding_required';
      end if;
    end if;

    if v_ok then
      v_binding_digest := encode(extensions.digest(v_row.effect_binding::text,'sha256'::text),'hex');
      if v_binding_digest is distinct from v_row.effect_binding_sha256 then
        v_ok := false;
        v_error := 'supervisor_effect_binding_digest_mismatch';
      end if;
    end if;
  end if;

  v_effect := v_ok and v_row.action in (
    'ARM','DISARM','SET_SUPERVISOR_MODE','SET_MODE','STOP_GENERATION','SCROLL',
    'SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK',
    'NEW_TAB','SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD',
    'FLEET_RECONCILE','FLEET_SET_PROFILE',
    'DOWNLOAD_FILE','DOWNLOAD_CANCEL','SELF_UPDATE_CHECK','SELF_UPDATE_APPLY',
    'COMPUTER_ACTION'
  ) and not (v_row.action='COMPUTER_ACTION' and v_outcome='NO_EFFECT_PROVEN');

  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status=case when v_ok then 'COMPLETED' else 'FAILED' end,
         completed_at=clock_timestamp(),
         receipt=case when v_ok
           then jsonb_set(v_receipt,'{authority_effect}',to_jsonb(v_effect),true)
           else v_receipt end,
         error=case when v_ok then null else v_error end,
         authority_effect=v_effect
   where workspace_id=p_workspace_id and command_id=p_command_id
     and status='LEASED' and leased_by=v_client
     and expires_at>clock_timestamp() and leased_at is not null
     and leased_at>clock_timestamp()-interval '10 minutes'
  returning * into v_row;

  if found then
    return jsonb_build_object('accepted',true,'status',v_row.status,'authority_effect',v_row.authority_effect);
  end if;

  select * into v_row
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where workspace_id=p_workspace_id and command_id=p_command_id;
  if v_row.status='LEASED' and v_row.leased_by=v_client then
    return jsonb_build_object('accepted',false,'status','EXPIRED','error','supervisor_lease_expired','authority_effect',false);
  end if;
  return jsonb_build_object('accepted',false,'status',v_row.status,'error','supervisor_lease_not_current','authority_effect',false);
end;
$function$;

-- 6) Batch completion mirrors the exact same binding/readback contract.
create or replace function public.h205f22_a2_browser_supervisor_complete_batch_v1(
  p_workspace_id uuid,
  p_client_id text,
  p_results jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
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
  v_effect boolean;
  v_binding_digest text;
  v_bound_effects constant text[] := array[
    'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','TYPED_CLICK','COMPUTER_ACTION'
  ];
begin
  if p_workspace_id is null or v_client='' then raise exception 'supervisor_batch_complete_identity_invalid'; end if;
  if p_results is null or jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>64 then
    raise exception 'supervisor_batch_complete_results_invalid';
  end if;

  for v_item in select value from jsonb_array_elements(p_results)
  loop
    if jsonb_typeof(v_item)<>'object' then raise exception 'supervisor_batch_complete_item_invalid'; end if;
    begin v_command_id := (v_item->>'command_id')::uuid;
    exception when others then raise exception 'supervisor_batch_complete_command_id_invalid'; end;
    v_ok := coalesce((v_item->>'ok')::boolean,false);
    v_receipt := coalesce(v_item->'receipt','{}'::jsonb);
    if jsonb_typeof(v_receipt)='string' then
      begin v_receipt := (v_receipt #>> '{}')::jsonb;
      exception when others then raise exception 'supervisor_batch_complete_receipt_transport_invalid'; end;
    end if;
    if jsonb_typeof(v_receipt)<>'object' then raise exception 'supervisor_batch_complete_receipt_invalid'; end if;
    v_error := left(coalesce(v_item->>'error','command_failed'),500);

    select * into v_row
      from public.compute_fabric_a2_browser_supervisor_command_h205f22
     where workspace_id=p_workspace_id and command_id=v_command_id
     for update;
    if not found then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'command_id',v_command_id,'accepted',false,'status','NOT_FOUND','authority_effect',false));
      continue;
    end if;
    if v_row.status<>'LEASED' or v_row.leased_by is distinct from v_client then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'command_id',v_command_id,'accepted',false,'status',v_row.status,
        'error','supervisor_lease_not_current','authority_effect',false));
      continue;
    end if;
    if v_row.expires_at<=clock_timestamp() or v_row.leased_at is null
       or v_row.leased_at<=clock_timestamp()-interval '10 minutes' then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'command_id',v_command_id,'accepted',false,'status','EXPIRED',
        'error','supervisor_lease_expired','authority_effect',false));
      continue;
    end if;

    v_outcome := upper(coalesce(v_receipt->>'effect_outcome',''));
    if v_row.command_lane<>'READ_ONLY' and v_ok and v_outcome not in ('CONFIRMED','NO_EFFECT_PROVEN') then
      v_ok := false;
      v_error := case when v_outcome='' then 'postcondition_readback_required'
        else 'postcondition_not_confirmed:'||left(v_outcome,80) end;
    end if;

    if v_ok and v_row.action=any(v_bound_effects) then
      if v_row.effect_binding is null
         or v_row.effect_bound_at is null
         or coalesce(v_row.effect_binding_sha256,'') !~ '^[0-9a-f]{64}$'
         or coalesce((v_row.effect_binding->>'authority_effect')::boolean,true) is distinct from false
         or coalesce((v_row.effect_binding->>'page_data_authority')::boolean,true) is distinct from false
         or coalesce((v_row.effect_binding->>'automatic_retry_allowed')::boolean,true) is distinct from false
         or v_row.effect_binding->>'command_id' is distinct from v_row.command_id::text
         or v_row.effect_binding->>'client_id' is distinct from v_client
         or v_row.effect_binding->>'action' is distinct from v_row.action
         or v_row.effect_binding->>'idempotency_key' is distinct from v_row.idempotency_key then
        v_ok := false;
        v_error := 'sealed_effect_binding_required';
      elsif v_row.action='COMPUTER_ACTION' then
        if v_row.effect_binding->>'schema' is distinct from 'metaengine.native-supervisor.computer-effect-binding.v1'
           or lower(coalesce(v_row.effect_binding->>'agent_id','')) is distinct from lower(coalesce(v_row.payload->>'agent_id',''))
           or upper(coalesce(v_row.effect_binding->>'computer_action','')) is distinct from upper(coalesce(v_row.payload->>'action',''))
           or v_row.effect_binding->>'target_identity_sha256' is distinct from lower(coalesce(v_row.payload->>'target_identity_sha256',''))
           or v_row.effect_binding->'target' is distinct from v_row.payload->'target' then
          v_ok := false;
          v_error := 'sealed_computer_effect_binding_required';
        end if;
      else
        if coalesce(v_row.effect_binding->>'schema','') not in (
          'metaengine.native-supervisor.effect-binding.v1','metaengine.native-supervisor.effect-binding.v2'
        ) or v_row.effect_binding->>'tab_id' is distinct from v_row.payload->>'tab_id' then
          v_ok := false;
          v_error := 'sealed_effect_binding_required';
        end if;
      end if;

      if v_ok then
        v_binding_digest := encode(extensions.digest(v_row.effect_binding::text,'sha256'::text),'hex');
        if v_binding_digest is distinct from v_row.effect_binding_sha256 then
          v_ok := false;
          v_error := 'sealed_effect_binding_digest_mismatch';
        end if;
      end if;
    end if;

    v_effect := v_ok and v_row.command_lane<>'READ_ONLY'
      and not (v_row.action='COMPUTER_ACTION' and v_outcome='NO_EFFECT_PROVEN');

    update public.compute_fabric_a2_browser_supervisor_command_h205f22
       set status=case when v_ok then 'COMPLETED' else 'FAILED' end,
           completed_at=clock_timestamp(),
           receipt=case when v_ok then jsonb_set(v_receipt,'{authority_effect}',to_jsonb(v_effect),true) else v_receipt end,
           error=case when v_ok then null else v_error end,
           authority_effect=v_effect
     where workspace_id=p_workspace_id and command_id=v_command_id
       and status='LEASED' and leased_by=v_client
       and expires_at>clock_timestamp() and leased_at is not null
       and leased_at>clock_timestamp()-interval '10 minutes';
    if not found then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'command_id',v_command_id,'accepted',false,'status','EXPIRED',
        'error','supervisor_lease_expired_during_completion','authority_effect',false));
      continue;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'command_id',v_command_id,'accepted',true,
      'status',case when v_ok then 'COMPLETED' else 'FAILED' end,
      'effect_outcome',nullif(v_outcome,''),'authority_effect',v_effect));
  end loop;

  return jsonb_build_object(
    'schema','metaengine.native-supervisor.command-batch-completion.v1',
    'results',v_out,'authority_effect',false
  );
end;
$function$;

revoke all on function public.h205f22_a2_browser_supervisor_bind_effect_v1(uuid,uuid,text,jsonb,boolean)
  from public,anon,authenticated;
revoke all on function public.h205f22_a2_browser_supervisor_complete_v5(uuid,uuid,text,boolean,jsonb,text,boolean)
  from public,anon,authenticated;
revoke all on function public.h205f22_a2_browser_supervisor_complete_batch_v1(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_bind_effect_v1(uuid,uuid,text,jsonb,boolean) to service_role;
grant execute on function public.h205f22_a2_browser_supervisor_complete_v5(uuid,uuid,text,boolean,jsonb,text,boolean) to service_role;
grant execute on function public.h205f22_a2_browser_supervisor_complete_batch_v1(uuid,text,jsonb) to service_role;


-- 7) Exact runtime capability attestation. The Edge only advertises this source
-- contract when the DB returns the identical envelope.
create or replace function public.devos_runtime_capabilities_v1()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
select jsonb_build_object(
  'schema', 'metaengine.native-browser-supervisor.capabilities.v1',
  'protocol_generation', 2,
  'features', jsonb_build_object(
    'signed_device_auth_v1', true,
    'typed_commands_only_v1', true,
    'devos_cycle_v1', true,
    'devos_ambiguity_reconcile_v2', true,
    'devos_transport_promotion_v1', true,
    'devos_scheduler_capacity_v1', true,
    'meta_orchestrator_superstep_v1', true,
    'meta_orchestrator_controller_lease_v1', true,
    'meta_atomic_frontier_v2', true,
    'post_lock_transport_revalidation_v1', true,
    'computer_authority_plane_v1', true
  ),
  'ambiguity_recovery_classes', jsonb_build_array('PRE_EFFECT_ABORTED', 'EFFECT_PROVEN'),
  'scheduler_source', 'NATIVE_SUPERVISOR_HEARTBEAT',
  'second_scheduler_loop', false,
  'automatic_retry_allowed', false,
  'arbitrary_eval', false,
  'page_model_text_authority', false,
  'authority_effect', false
)
$function$;

revoke all on function public.devos_runtime_capabilities_v1()
  from public, anon, authenticated;
grant execute on function public.devos_runtime_capabilities_v1() to service_role;

comment on function public.devos_runtime_capabilities_v1() is
  'Exact non-authoritative native supervisor runtime capability attestation including Computer Authority Plane V1. Service-role only; grants no scheduler, browser, retry, or effect authority.';
