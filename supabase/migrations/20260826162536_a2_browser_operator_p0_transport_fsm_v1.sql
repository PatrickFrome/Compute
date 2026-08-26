alter table public.compute_fabric_a2_chat_bridge_remote_command_h205f22
  add column if not exists execution_class text,
  add column if not exists result_reported_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.compute_fabric_a2_chat_bridge_remote_command_h205f22'::regclass
      and conname='compute_fabric_a2_chat_bridge_remote_execution_class_check'
  ) then
    alter table public.compute_fabric_a2_chat_bridge_remote_command_h205f22
      add constraint compute_fabric_a2_chat_bridge_remote_execution_class_check
      check (execution_class is null or execution_class in (
        'SAFE_RETRY_PRE_ACTUATION','AMBIGUOUS_NO_RETRY','ACTUATED','VERIFIED','BLOCKED'
      ));
  end if;
end $$;

create unique index if not exists compute_fabric_a2_chat_bridge_remote_gpt_predecessor_once_idx
  on public.compute_fabric_a2_chat_bridge_remote_command_h205f22(predecessor_command_id)
  where target_platform='CHATGPT'
    and predecessor_command_id is not null
    and (status in ('LEASED','COMPLETED') or execution_class='AMBIGUOUS_NO_RETRY');

create or replace function public.h205f22_a2_chat_bridge_remote_try_lease_v2(
  p_command_id uuid,
  p_idempotency_key text,
  p_target_platform text,
  p_target_agent text,
  p_client_id text,
  p_prompt_sha256 text,
  p_a2_head_message_seq bigint,
  p_a2_peer_payloads_exposed boolean,
  p_duel_id uuid,
  p_dispatch_group_sha256 text,
  p_launch_order smallint,
  p_predecessor_command_id uuid,
  p_ordering_basis text,
  p_lease_timeout_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_predecessor public.compute_fabric_a2_chat_bridge_remote_command_h205f22%rowtype;
  v_existing public.compute_fabric_a2_chat_bridge_remote_command_h205f22%rowtype;
begin
  if p_target_platform not in ('CHATGPT','GLM_ZAI') then raise exception 'bridge_target_platform_invalid'; end if;
  if (p_target_platform='CHATGPT' and p_target_agent<>'GPT') or (p_target_platform='GLM_ZAI' and p_target_agent<>'GLM') then
    raise exception 'bridge_target_agent_invalid';
  end if;
  if p_idempotency_key !~ '^[0-9a-f]{64}$' or p_prompt_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'bridge_hash_invalid'; end if;
  if p_dispatch_group_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'bridge_dispatch_group_invalid'; end if;
  if p_launch_order not in (1,2) then raise exception 'bridge_launch_order_invalid'; end if;
  if p_lease_timeout_seconds < 30 or p_lease_timeout_seconds > 3600 then raise exception 'bridge_lease_timeout_invalid'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('METAENGINE_A2_CHAT_BRIDGE_REMOTE'),
    pg_catalog.hashtext(p_target_platform)
  );

  update public.compute_fabric_a2_chat_bridge_remote_command_h205f22
     set status='FAILED', completed_at=v_now, result_status='LEASE_TIMEOUT_REMOTE_TX',
         execution_class=coalesce(execution_class,'SAFE_RETRY_PRE_ACTUATION'), result_reported_at=v_now
   where target_platform=p_target_platform
     and status='LEASED'
     and (
       (progress_status is null and leased_at < v_now - (p_lease_timeout_seconds * interval '1 second'))
       or (progress_status in ('ABORTED_BEFORE_ACTUATION','RELEASED')
           and progress_at is not null and progress_at < v_now - interval '30 seconds')
       or (progress_status is not null
           and progress_status not in ('ABORTED_BEFORE_ACTUATION','RELEASED')
           and busy_until is not null and busy_until <= v_now)
     );

  select * into v_existing
    from public.compute_fabric_a2_chat_bridge_remote_command_h205f22
   where idempotency_key=p_idempotency_key
   order by created_at desc
   limit 1;
  if found and v_existing.execution_class='AMBIGUOUS_NO_RETRY' then
    return pg_catalog.jsonb_build_object('leased',false,'reason','IDEMPOTENCY_AMBIGUOUS_HOLD','command_id',v_existing.command_id);
  end if;
  if found and v_existing.status='COMPLETED' then
    return pg_catalog.jsonb_build_object('leased',false,'reason','IDEMPOTENCY_COMPLETED','command_id',v_existing.command_id);
  end if;
  if found and v_existing.status='LEASED' then
    return pg_catalog.jsonb_build_object('leased',false,'reason','IDEMPOTENCY_ACTIVE','command_id',v_existing.command_id);
  end if;

  if exists (
    select 1 from public.compute_fabric_a2_chat_bridge_remote_command_h205f22
     where target_platform=p_target_platform and status='LEASED'
  ) then
    return pg_catalog.jsonb_build_object('leased',false,'reason','TARGET_ACTIVE_LEASE');
  end if;

  if p_target_platform='GLM_ZAI' then
    if p_launch_order<>1 or p_predecessor_command_id is not null or p_ordering_basis<>'GLM_FIRST' then
      raise exception 'bridge_glm_first_binding_invalid';
    end if;
  else
    if p_ordering_basis='GLM_COMMAND_ACTUATED' then
      if p_launch_order<>2 or p_predecessor_command_id is null then raise exception 'bridge_gpt_predecessor_missing'; end if;
      select * into v_predecessor
        from public.compute_fabric_a2_chat_bridge_remote_command_h205f22
       where command_id=p_predecessor_command_id
       for update;
      if not found
         or v_predecessor.target_platform<>'GLM_ZAI'
         or v_predecessor.client_id<>p_client_id
         or v_predecessor.progress_status not in ('ACTUATED','REQUEST_OBSERVED','RESPONSE_STARTED','NETWORK_COMPLETED','NETWORK_ERROR_HOLD','RELEASED')
         or v_predecessor.actuated_at is null
         or v_predecessor.actuated_at < v_now - interval '10 minutes' then
        return pg_catalog.jsonb_build_object('leased',false,'reason','GLM_PREDECESSOR_NOT_ACTUATED');
      end if;
      if exists (
        select 1 from public.compute_fabric_a2_chat_bridge_remote_command_h205f22
         where predecessor_command_id=p_predecessor_command_id
           and target_platform='CHATGPT'
           and (status in ('LEASED','COMPLETED') or execution_class='AMBIGUOUS_NO_RETRY')
      ) then
        return pg_catalog.jsonb_build_object('leased',false,'reason','GLM_PREDECESSOR_ALREADY_CONSUMED');
      end if;
    elsif p_ordering_basis='A2_GLM_ALREADY_SUBMITTED' then
      if p_predecessor_command_id is not null then raise exception 'bridge_a2_predecessor_must_be_null'; end if;
    else
      raise exception 'bridge_gpt_ordering_basis_invalid';
    end if;
  end if;

  insert into public.compute_fabric_a2_chat_bridge_remote_command_h205f22(
    command_id,idempotency_key,target_platform,target_agent,client_id,status,created_at,leased_at,
    prompt_sha256,a2_head_message_seq,a2_peer_payloads_exposed,duel_id,authority_effect,
    dispatch_group_sha256,launch_order,predecessor_command_id,ordering_basis
  ) values (
    p_command_id,p_idempotency_key,p_target_platform,p_target_agent,p_client_id,'LEASED',v_now,v_now,
    p_prompt_sha256,p_a2_head_message_seq,coalesce(p_a2_peer_payloads_exposed,false),p_duel_id,false,
    p_dispatch_group_sha256,p_launch_order,p_predecessor_command_id,p_ordering_basis
  );

  return pg_catalog.jsonb_build_object(
    'leased',true,'command_id',p_command_id,'target_platform',p_target_platform,
    'launch_order',p_launch_order,'predecessor_command_id',p_predecessor_command_id,
    'ordering_basis',p_ordering_basis,'authority_effect',false
  );
end;
$$;

create or replace function public.h205f22_a2_chat_bridge_remote_transition_v3(
  p_command_id uuid,
  p_client_id text,
  p_event text,
  p_result_status text default null,
  p_transport_trace_id text default null,
  p_clicked_send_button boolean default null,
  p_target_url_sha256 text default null,
  p_error_sha256 text default null,
  p_execution_class text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_row public.compute_fabric_a2_chat_bridge_remote_command_h205f22%rowtype;
  v_old_rank integer;
  v_new_rank integer;
  v_busy_until timestamptz;
  v_failed boolean;
begin
  select * into v_row from public.compute_fabric_a2_chat_bridge_remote_command_h205f22 where command_id=p_command_id for update;
  if not found then return pg_catalog.jsonb_build_object('accepted',false,'reason','COMMAND_NOT_FOUND'); end if;
  if v_row.client_id is distinct from p_client_id then return pg_catalog.jsonb_build_object('accepted',false,'reason','LEASE_OWNER_MISMATCH'); end if;
  if p_transport_trace_id is not null and p_transport_trace_id !~ '^[0-9a-f]{32}$' then raise exception 'bridge_trace_invalid'; end if;
  if p_target_url_sha256 is not null and p_target_url_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'bridge_target_url_hash_invalid'; end if;
  if p_error_sha256 is not null and p_error_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'bridge_error_hash_invalid'; end if;

  if p_event='RESULT' then
    if p_execution_class not in ('SAFE_RETRY_PRE_ACTUATION','AMBIGUOUS_NO_RETRY','ACTUATED','VERIFIED','BLOCKED') then raise exception 'bridge_execution_class_invalid'; end if;
    v_failed := p_execution_class in ('SAFE_RETRY_PRE_ACTUATION','AMBIGUOUS_NO_RETRY','BLOCKED');
    update public.compute_fabric_a2_chat_bridge_remote_command_h205f22
       set status=case when v_failed then 'FAILED' else 'COMPLETED' end,
           completed_at=v_now, result_reported_at=v_now,
           result_status=left(coalesce(p_result_status,'FAILED_CLOSED'),120),
           clicked_send_button=coalesce(p_clicked_send_button,false),
           target_url_sha256=p_target_url_sha256, error_sha256=p_error_sha256,
           transport_trace_id=coalesce(p_transport_trace_id,transport_trace_id),
           execution_class=p_execution_class,
           actuated_at=case when p_execution_class in ('ACTUATED','VERIFIED') then coalesce(actuated_at,v_now) else actuated_at end,
           progress_status=case when target_platform='GLM_ZAI' and p_execution_class in ('ACTUATED','VERIFIED') and progress_status is null then 'ACTUATED' else progress_status end,
           progress_at=case when target_platform='GLM_ZAI' and p_execution_class in ('ACTUATED','VERIFIED') and progress_status is null then v_now else progress_at end,
           busy_until=case when target_platform='GLM_ZAI' and p_execution_class in ('ACTUATED','VERIFIED') and progress_status is null then v_now + interval '1 hour' else busy_until end
     where command_id=p_command_id;
    select * into v_row from public.compute_fabric_a2_chat_bridge_remote_command_h205f22 where command_id=p_command_id;
    return pg_catalog.jsonb_build_object('accepted',true,'event','RESULT','status',v_row.status,'execution_class',v_row.execution_class,'progress_status',v_row.progress_status,'authority_effect',false);
  end if;

  if v_row.target_platform<>'GLM_ZAI' then return pg_catalog.jsonb_build_object('accepted',false,'reason','PROGRESS_ONLY_SUPPORTED_FOR_GLM'); end if;
  if p_event not in ('DISPATCHED','ACTUATED','REQUEST_OBSERVED','RESPONSE_STARTED','NETWORK_COMPLETED','NETWORK_ERROR_HOLD','RELEASED','ABORTED_BEFORE_ACTUATION') then raise exception 'bridge_progress_event_invalid'; end if;

  v_old_rank := case v_row.progress_status
    when 'DISPATCHED' then 10 when 'ACTUATED' then 20 when 'REQUEST_OBSERVED' then 30 when 'RESPONSE_STARTED' then 40
    when 'NETWORK_COMPLETED' then 50 when 'NETWORK_ERROR_HOLD' then 50 when 'RELEASED' then 60 when 'ABORTED_BEFORE_ACTUATION' then 60 else 0 end;
  v_new_rank := case p_event
    when 'DISPATCHED' then 10 when 'ACTUATED' then 20 when 'REQUEST_OBSERVED' then 30 when 'RESPONSE_STARTED' then 40
    when 'NETWORK_COMPLETED' then 50 when 'NETWORK_ERROR_HOLD' then 50 when 'RELEASED' then 60 when 'ABORTED_BEFORE_ACTUATION' then 60 else 0 end;
  if v_row.progress_status in ('RELEASED','ABORTED_BEFORE_ACTUATION') and p_event<>v_row.progress_status then
    return pg_catalog.jsonb_build_object('accepted',false,'reason','PROGRESS_TERMINAL','progress_status',v_row.progress_status);
  end if;
  if v_new_rank < v_old_rank then return pg_catalog.jsonb_build_object('accepted',false,'reason','PROGRESS_REGRESSION','progress_status',v_row.progress_status); end if;

  v_busy_until := case
    when p_event in ('DISPATCHED','ACTUATED','REQUEST_OBSERVED','RESPONSE_STARTED','NETWORK_ERROR_HOLD') then v_now + interval '1 hour'
    when p_event='NETWORK_COMPLETED' then v_now + interval '30 seconds'
    when p_event in ('RELEASED','ABORTED_BEFORE_ACTUATION') then v_now
    else v_row.busy_until end;

  update public.compute_fabric_a2_chat_bridge_remote_command_h205f22
     set progress_status=p_event, progress_at=v_now,
         busy_until=case when p_event in ('RELEASED','ABORTED_BEFORE_ACTUATION') then v_busy_until when busy_until is null then v_busy_until else pg_catalog.greatest(busy_until,v_busy_until) end,
         transport_trace_id=coalesce(p_transport_trace_id,transport_trace_id),
         actuated_at=case when p_event='ACTUATED' then coalesce(actuated_at,v_now) else actuated_at end,
         response_started_at=case when p_event='RESPONSE_STARTED' then coalesce(response_started_at,v_now) else response_started_at end,
         network_completed_at=case when p_event='NETWORK_COMPLETED' then coalesce(network_completed_at,v_now) else network_completed_at end,
         aborted_at=case when p_event='ABORTED_BEFORE_ACTUATION' then coalesce(aborted_at,v_now) else aborted_at end
   where command_id=p_command_id;

  return pg_catalog.jsonb_build_object('accepted',true,'event',p_event,'progress_status',p_event,'busy_until',v_busy_until,'authority_effect',false);
end;
$$;

revoke all on function public.h205f22_a2_chat_bridge_remote_transition_v3(uuid,text,text,text,text,boolean,text,text,text) from public, anon, authenticated;
grant execute on function public.h205f22_a2_chat_bridge_remote_transition_v3(uuid,text,text,text,text,boolean,text,text,text) to service_role;
revoke all on function public.h205f22_a2_chat_bridge_remote_try_lease_v2(uuid,text,text,text,text,text,bigint,boolean,uuid,text,smallint,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.h205f22_a2_chat_bridge_remote_try_lease_v2(uuid,text,text,text,text,text,bigint,boolean,uuid,text,smallint,uuid,text,integer) to service_role;
