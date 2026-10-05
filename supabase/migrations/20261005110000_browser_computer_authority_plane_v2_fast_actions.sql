-- METAENGINE Computer Authority Plane V2 fast UIA surface.
--
-- Extends the dedicated Computer issuer only. The existing DB lease scheduler,
-- effect-intent seal, completion functions and top-level COMPUTER_* command
-- actions remain unchanged. V2-only subactions require an exact V2 executor
-- attestation from the target Browser heartbeat.

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
    if v_action='COMPUTER_OBSERVE' and v_subaction not in ('OBSERVE_WINDOWS','OBSERVE_DISPLAYS','FOREGROUND_STATUS','UIA_SNAPSHOT','CAPTURE_DESKTOP','CAPTURE_WINDOW','VERIFY_TARGET') then
      raise exception 'computer_observe_action_invalid';
    end if;
    if v_action='COMPUTER_ACTION' and v_subaction not in ('UIA_FOCUS','UIA_INVOKE','UIA_SET_VALUE','UIA_TOGGLE','UIA_SELECT','UIA_EXPAND_COLLAPSE','UIA_SCROLL','TYPE_TEXT','KEY_PRESS','POINTER_CLICK') then
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

  if v_subaction in (
    'OBSERVE_DISPLAYS','FOREGROUND_STATUS','CAPTURE_WINDOW',
    'UIA_SET_VALUE','UIA_TOGGLE','UIA_SELECT','UIA_EXPAND_COLLAPSE','UIA_SCROLL'
  ) and coalesce(v_state_json#>>'{computer_authority,version}','') <> '2.0.0' then
    raise exception 'computer_authority_v2_not_attested';
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
  'Issues typed provider-neutral Computer Authority Plane V1/V2 commands only to a live Browser attesting the compatible local executor version. V2 UIA/display primitives require executor version 2.0.0. No scheduler, lease, retry or execution authority is granted by this RPC.';
