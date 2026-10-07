-- Bounded durable ingress: one projected latest batch per stream; Realtime is optional.
alter table public.compute_fabric_a2_browser_cognitive_cursor_h205f22
 add column last_batch jsonb,add column last_broadcast_persisted boolean not null default false;
alter table public.compute_fabric_a2_browser_cognitive_cursor_h205f22
 add constraint cognitive_latest_batch_bound_v1 check(last_batch is null or (
 jsonb_typeof(last_batch)='object' and octet_length(last_batch::text)<=270336
 and last_batch->'authority_effect'='false'::jsonb and last_batch->'control_authority'='false'::jsonb
 and last_batch->'command_leasing'='false'::jsonb));
CREATE OR REPLACE FUNCTION public.h205f22_a2_browser_cognitive_accept_v1(p_workspace_id uuid, p_client_id text, p_device_id text, p_stream_id uuid, p_after_sequence bigint, p_through_sequence bigint, p_events jsonb, p_authority_effect boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_device uuid;
  v_current public.compute_fabric_a2_browser_cognitive_cursor_h205f22%rowtype;
  v_event jsonb;
  v_count integer;
  v_position integer := 0;
  v_key text;
  v_value jsonb;
  v_limit integer;
  v_digest text;
  v_broadcast uuid := gen_random_uuid();
  v_payload jsonb;
  v_topic text;
  v_now timestamptz := clock_timestamp();
  v_broadcasted boolean := false;
begin
  if p_workspace_id is null or p_stream_id is null
     or p_stream_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(p_client_id,'') !~ '^[A-Za-z0-9_-]{1,160}$'
     or coalesce(p_device_id,'') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  then raise exception 'cognitive_accept_identity_invalid' using errcode='22023'; end if;
  v_device := p_device_id::uuid;
  if p_authority_effect is distinct from false then
    raise exception 'cognitive_accept_authority_forbidden' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.compute_fabric_a2_browser_device_h205f22 d
    join public.compute_fabric_a2_browser_supervisor_state_h205f22 s on s.client_id=d.client_id
    where d.device_id=v_device and d.client_id=p_client_id and d.active=true
      and d.revoked_at is null and s.workspace_id=p_workspace_id
  ) then raise exception 'cognitive_accept_device_binding_invalid' using errcode='22023'; end if;
  if p_after_sequence is null or p_through_sequence is null or p_after_sequence < 0
     or p_through_sequence <= p_after_sequence or p_through_sequence > 9007199254740991
  then raise exception 'cognitive_accept_range_invalid' using errcode='22023'; end if;
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'cognitive_accept_events_invalid' using errcode='22023';
  end if;
  v_count := jsonb_array_length(p_events);
  if v_count not between 1 and 128 or p_through_sequence-p_after_sequence <> v_count then
    raise exception 'cognitive_accept_event_count_invalid' using errcode='22023';
  end if;
  if octet_length(p_events::text) > 262144 then
    raise exception 'cognitive_accept_events_too_large' using errcode='22023';
  end if;

  -- Bound the full validation to 128 projected events. Interior events must not
  -- smuggle raw data or authority flags past an envelope-only boundary check.
  for v_event in select value from jsonb_array_elements(p_events) loop
    v_position := v_position+1;
    if jsonb_typeof(v_event) is distinct from 'object'
       or v_event->>'schema' is distinct from 'metaengine.browser.cognitive-delta.v1'
       or v_event->>'stream_id' is distinct from p_stream_id::text
       or coalesce(v_event->>'sequence','') !~ '^[0-9]{1,16}$'
       or jsonb_typeof(v_event->'sequence') is distinct from 'number'
       or v_event->>'priority' not in ('P0','P1','P2','P3')
       or v_event->>'priority' is null
       or v_event->>'source' not in ('PROCESS','SEMANTIC','METRICS','SYSTEM')
       or v_event->>'source' is null
    then raise exception 'cognitive_accept_event_schema_invalid' using errcode='22023'; end if;
    if (v_event->>'sequence')::bigint <> p_after_sequence+v_position then
      raise exception 'cognitive_accept_event_sequence_invalid' using errcode='22023';
    end if;
    foreach v_key in array array['raw_payload_exposed','page_text_exposed','input_values_exposed',
      'control_authority','command_leasing','authority_effect'] loop
      if v_event->v_key is distinct from 'false'::jsonb then
        raise exception 'cognitive_accept_event_authority_invalid' using errcode='22023';
      end if;
    end loop;
    if exists (select 1 from jsonb_object_keys(v_event) k where k <> all(array[
      'schema','stream_id','sequence','priority','recorded_at','source_sequence','source','type',
      'semantic_method','observed_at','tab_id','target_id','web_contents_id','os_pid','process_type',
      'reason','service_name','name','raw_payload_exposed','page_text_exposed','input_values_exposed',
      'control_authority','command_leasing','authority_effect'])) then
      raise exception 'cognitive_accept_unprojected_event_field' using errcode='22023';
    end if;
    foreach v_key in array array['type','recorded_at','observed_at','semantic_method','tab_id',
      'target_id','process_type','reason','service_name','name'] loop
      v_value := v_event->v_key;
      v_limit := case when v_key in ('recorded_at','observed_at') then 64
        when v_key='type' or v_key='tab_id' then 96 when v_key='process_type' then 80 else 160 end;
      if v_key='type' and (jsonb_typeof(v_value) is distinct from 'string'
        or length(v_event->>v_key)=0) then
        raise exception 'cognitive_accept_event_type_invalid' using errcode='22023';
      end if;
      if v_value is not null and v_value <> 'null'::jsonb
        and (jsonb_typeof(v_value)<>'string' or length(v_event->>v_key)>v_limit) then
        raise exception 'cognitive_accept_event_text_invalid' using errcode='22023';
      end if;
    end loop;
    foreach v_key in array array['web_contents_id','os_pid','source_sequence'] loop
      v_value := v_event->v_key;
      if v_value is not null and v_value <> 'null'::jsonb then
        if jsonb_typeof(v_value)<>'number' or coalesce(v_event->>v_key,'') !~ '^[0-9]{1,16}$' then
          raise exception 'cognitive_accept_event_integer_invalid' using errcode='22023';
        end if;
        if (v_event->>v_key)::bigint > 9007199254740991
           or (v_key<>'source_sequence' and (v_event->>v_key)::bigint=0) then
          raise exception 'cognitive_accept_event_integer_invalid' using errcode='22023';
        end if;
      end if;
    end loop;
  end loop;

  v_digest := encode(extensions.digest(convert_to(p_events::text,'UTF8'),'sha256'),'hex');
  insert into public.compute_fabric_a2_browser_cognitive_cursor_h205f22
    (workspace_id,client_id,device_id,stream_id)
  values(p_workspace_id,p_client_id,v_device,p_stream_id)
  on conflict(workspace_id,client_id,device_id,stream_id) do nothing;
  select * into strict v_current
    from public.compute_fabric_a2_browser_cognitive_cursor_h205f22
    where workspace_id=p_workspace_id and client_id=p_client_id
      and device_id=v_device and stream_id=p_stream_id for update;

  if p_through_sequence <= v_current.accepted_through_sequence then
    if p_through_sequence=v_current.accepted_through_sequence
      and (p_after_sequence is distinct from v_current.last_after_sequence
        or v_digest is distinct from v_current.last_batch_sha256) then
      raise exception 'cognitive_accept_replay_payload_conflict' using errcode='22023';
    end if;
    return jsonb_build_object('accepted',true,'reason','DUPLICATE_ALREADY_ACCEPTED',
      'stream_id',p_stream_id,'accepted_through_sequence',p_through_sequence,
      'durable_cursor_through_sequence',v_current.accepted_through_sequence,
      'event_count',v_count,'broadcasted',false,'duplicate',true,
      'delivery_mode','DURABLE_LATEST_BATCH',
      'full_state_fallback_required',not v_current.last_broadcast_persisted,
      'full_state_resync_required',false,'delivery_is_authority',false,
      'control_authority',false,'command_leasing',false,'authority_effect',false);
  end if;
  if p_after_sequence <> v_current.accepted_through_sequence then
    return jsonb_build_object('accepted',false,'reason','CURSOR_GAP_OR_OVERLAP',
      'stream_id',p_stream_id,'expected_after_sequence',v_current.accepted_through_sequence,
      'full_state_resync_required',true,'delivery_is_authority',false,
      'control_authority',false,'command_leasing',false,'authority_effect',false);
  end if;

  v_topic := 'metaengine-cognitive:'||p_workspace_id::text||':'||p_client_id;
  v_payload := jsonb_build_object('id',v_broadcast,
    'schema','metaengine.browser.cognitive-delta-broadcast.v1',
    'workspace_id',p_workspace_id,'client_id',p_client_id,'stream_id',p_stream_id,
    'after_sequence',p_after_sequence,'through_sequence',p_through_sequence,
    'event_count',v_count,'events',p_events,'delivery_is_authority',false,
    'control_authority',false,'command_leasing',false,'authority_effect',false);
  -- Realtime is an optional wake accelerator. Persist the validated latest batch
  -- and cursor atomically; an ACK never asserts delivery to a subscriber.
  update public.compute_fabric_a2_browser_cognitive_cursor_h205f22
    set accepted_through_sequence=p_through_sequence,
      accepted_batches=accepted_batches+1,accepted_events=accepted_events+v_count,
      last_after_sequence=p_after_sequence,last_batch_sha256=v_digest,
      last_broadcast_id=v_broadcast,last_seen_at=v_now,
      last_batch=v_payload,last_broadcast_persisted=false
    where workspace_id=p_workspace_id and client_id=p_client_id
      and device_id=v_device and stream_id=p_stream_id;
  begin
    perform realtime.send(v_payload,'COGNITIVE_DELTA',v_topic,true);
    select exists(select 1 from realtime.messages where payload->>'id'=v_broadcast::text
      and topic=v_topic and event='COGNITIVE_DELTA' and private=true
      and extension='broadcast' and payload=v_payload) into v_broadcasted;
  exception when others then
    v_broadcasted := false;
  end;
  if v_broadcasted then
    update public.compute_fabric_a2_browser_cognitive_cursor_h205f22
      set last_broadcast_persisted=true
      where workspace_id=p_workspace_id and client_id=p_client_id
        and device_id=v_device and stream_id=p_stream_id;
  end if;
  return jsonb_build_object('accepted',true,'reason','ACCEPTED','stream_id',p_stream_id,
    'accepted_through_sequence',p_through_sequence,'durable_cursor_through_sequence',p_through_sequence,
    'event_count',v_count,'broadcasted',v_broadcasted,'broadcast_id',v_broadcast,'duplicate',false,
    'delivery_mode',case when v_broadcasted then 'REALTIME_AND_DURABLE_LATEST_BATCH' else 'DURABLE_LATEST_BATCH' end,
    'full_state_fallback_required',not v_broadcasted,
    'full_state_resync_required',false,'delivery_is_authority',false,
    'control_authority',false,'command_leasing',false,'authority_effect',false);
end;
$function$;
notify pgrst,'reload schema';
