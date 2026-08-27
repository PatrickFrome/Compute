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
  select * into v_row
    from public.compute_fabric_a2_chat_bridge_remote_command_h205f22
   where command_id=p_command_id
   for update;
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
           completed_at=v_now,
           result_reported_at=v_now,
           result_status=left(coalesce(p_result_status,'FAILED_CLOSED'),120),
           clicked_send_button=coalesce(p_clicked_send_button,false),
           target_url_sha256=p_target_url_sha256,
           error_sha256=p_error_sha256,
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
    when 'DISPATCHED' then 10 when 'ACTUATED' then 20 when 'REQUEST_OBSERVED' then 30
    when 'RESPONSE_STARTED' then 40 when 'NETWORK_COMPLETED' then 50 when 'NETWORK_ERROR_HOLD' then 50
    when 'RELEASED' then 60 when 'ABORTED_BEFORE_ACTUATION' then 60 else 0 end;
  v_new_rank := case p_event
    when 'DISPATCHED' then 10 when 'ACTUATED' then 20 when 'REQUEST_OBSERVED' then 30
    when 'RESPONSE_STARTED' then 40 when 'NETWORK_COMPLETED' then 50 when 'NETWORK_ERROR_HOLD' then 50
    when 'RELEASED' then 60 when 'ABORTED_BEFORE_ACTUATION' then 60 else 0 end;

  if v_row.progress_status in ('RELEASED','ABORTED_BEFORE_ACTUATION') and p_event<>v_row.progress_status then
    return pg_catalog.jsonb_build_object('accepted',false,'reason','PROGRESS_TERMINAL','progress_status',v_row.progress_status);
  end if;
  if v_new_rank < v_old_rank then
    return pg_catalog.jsonb_build_object('accepted',false,'reason','PROGRESS_REGRESSION','progress_status',v_row.progress_status);
  end if;

  v_busy_until := case
    when p_event in ('DISPATCHED','ACTUATED','REQUEST_OBSERVED','RESPONSE_STARTED','NETWORK_ERROR_HOLD') then v_now + interval '1 hour'
    when p_event='NETWORK_COMPLETED' then v_now + interval '30 seconds'
    when p_event in ('RELEASED','ABORTED_BEFORE_ACTUATION') then v_now
    else v_row.busy_until end;

  update public.compute_fabric_a2_chat_bridge_remote_command_h205f22
     set progress_status=p_event,
         progress_at=v_now,
         busy_until=case
           when p_event in ('RELEASED','ABORTED_BEFORE_ACTUATION') then v_busy_until
           when busy_until is null then v_busy_until
           else greatest(busy_until,v_busy_until) end,
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
