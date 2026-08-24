-- METAENGINE H205F22 AOP1 DUEL PERSISTED PAIR READBACK V3
-- Removes one Supabase HTTP read from every post-first microstep while preserving
-- persist-first semantics: the atomic pair writer re-selects the committed GPT,
-- GLM and tick rows from PostgreSQL and returns those persisted projections.

create or replace function public.h205f22_duel_submit_pair_v2(
  p_duel_id uuid,
  p_worker text,
  p_lease_generation bigint,
  p_tick_no bigint,
  p_seen_checkpoint_sha256 text,
  p_gpt_step_type text,
  p_gpt_payload jsonb,
  p_glm_step_type text,
  p_glm_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta','extensions'
as $function$
declare
  d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype;
  g_payload_sha text; l_payload_sha text; g_event_sha text; l_event_sha text; out_sha text;
  g_event_id bigint; l_event_id bigint;
  g_readback jsonb; l_readback jsonb; tick_readback jsonb;
begin
  select * into d
  from destruktion_meta.compute_fabric_duel_session_h205f22
  where duel_id=p_duel_id
  for update;

  if not found or d.protocol_version<>'LOCKSTEP_V2' or d.status<>'RUNNING'
     or d.lease_owner<>p_worker or d.lease_generation<>p_lease_generation
     or d.lease_expires_at<=clock_timestamp() then
    raise exception 'duel_lockstep_lease_fenced';
  end if;
  if p_tick_no<>d.current_tick+1 then raise exception 'duel_tick_mismatch expected % got %',d.current_tick+1,p_tick_no; end if;
  if d.current_tick>=d.max_ticks then raise exception 'duel_max_ticks_reached'; end if;
  if p_seen_checkpoint_sha256 is distinct from d.current_checkpoint_sha256 then raise exception 'duel_checkpoint_stale'; end if;
  if jsonb_typeof(coalesce(p_gpt_payload,'{}'::jsonb))<>'object'
     or jsonb_typeof(coalesce(p_glm_payload,'{}'::jsonb))<>'object' then
    raise exception 'microstep_payload_must_be_object';
  end if;
  if p_gpt_step_type is null or length(trim(p_gpt_step_type))<2
     or p_glm_step_type is null or length(trim(p_glm_step_type))<2 then
    raise exception 'microstep_type_required';
  end if;

  g_payload_sha:=encode(extensions.digest(convert_to(p_gpt_payload::text,'utf8'),'sha256'),'hex');
  l_payload_sha:=encode(extensions.digest(convert_to(p_glm_payload::text,'utf8'),'sha256'),'hex');
  g_event_sha:=encode(extensions.digest(convert_to(concat_ws('|','DUEL_EVENT_V2',p_duel_id::text,p_tick_no::text,'GPT',d.current_checkpoint_sha256,p_gpt_step_type,g_payload_sha),'utf8'),'sha256'),'hex');
  l_event_sha:=encode(extensions.digest(convert_to(concat_ws('|','DUEL_EVENT_V2',p_duel_id::text,p_tick_no::text,'GLM',d.current_checkpoint_sha256,p_glm_step_type,l_payload_sha),'utf8'),'sha256'),'hex');
  out_sha:=encode(extensions.digest(convert_to(concat_ws('|','DUEL_TICK_V2',p_duel_id::text,p_tick_no::text,d.current_checkpoint_sha256,g_event_sha,l_event_sha),'utf8'),'sha256'),'hex');

  insert into destruktion_meta.compute_fabric_duel_event_h205f22(
    duel_id,phase,actor,payload,payload_sha256,tick_no,step_type,parent_checkpoint_sha256,event_sha256
  ) values(
    p_duel_id,'MICROSTEP','GPT',p_gpt_payload,g_payload_sha,p_tick_no,p_gpt_step_type,d.current_checkpoint_sha256,g_event_sha
  ) returning event_id into g_event_id;

  insert into destruktion_meta.compute_fabric_duel_event_h205f22(
    duel_id,phase,actor,payload,payload_sha256,tick_no,step_type,parent_checkpoint_sha256,event_sha256
  ) values(
    p_duel_id,'MICROSTEP','GLM',p_glm_payload,l_payload_sha,p_tick_no,p_glm_step_type,d.current_checkpoint_sha256,l_event_sha
  ) returning event_id into l_event_id;

  insert into destruktion_meta.compute_fabric_duel_tick_h205f22(
    duel_id,tick_no,input_checkpoint_sha256,gpt_event_sha256,glm_event_sha256,output_checkpoint_sha256
  ) values(
    p_duel_id,p_tick_no,d.current_checkpoint_sha256,g_event_sha,l_event_sha,out_sha
  );

  update destruktion_meta.compute_fabric_duel_session_h205f22
  set current_tick=p_tick_no,current_checkpoint_sha256=out_sha,updated_at=clock_timestamp()
  where duel_id=p_duel_id;

  select jsonb_build_object(
    'event_id',e.event_id,'tick_no',e.tick_no,'actor',e.actor,'step_type',e.step_type,
    'payload',e.payload,'payload_sha256',e.payload_sha256,
    'parent_checkpoint_sha256',e.parent_checkpoint_sha256,
    'event_sha256',e.event_sha256,'created_at',e.created_at
  ) into g_readback
  from destruktion_meta.compute_fabric_duel_event_h205f22 e where e.event_id=g_event_id;

  select jsonb_build_object(
    'event_id',e.event_id,'tick_no',e.tick_no,'actor',e.actor,'step_type',e.step_type,
    'payload',e.payload,'payload_sha256',e.payload_sha256,
    'parent_checkpoint_sha256',e.parent_checkpoint_sha256,
    'event_sha256',e.event_sha256,'created_at',e.created_at
  ) into l_readback
  from destruktion_meta.compute_fabric_duel_event_h205f22 e where e.event_id=l_event_id;

  select jsonb_build_object(
    'tick_no',t.tick_no,'input_checkpoint_sha256',t.input_checkpoint_sha256,
    'gpt_event_sha256',t.gpt_event_sha256,'glm_event_sha256',t.glm_event_sha256,
    'output_checkpoint_sha256',t.output_checkpoint_sha256,'created_at',t.created_at
  ) into tick_readback
  from destruktion_meta.compute_fabric_duel_tick_h205f22 t
  where t.duel_id=p_duel_id and t.tick_no=p_tick_no;

  if g_readback is null or l_readback is null or tick_readback is null then
    raise exception 'duel_persisted_pair_readback_missing';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute.duel-microstep-pair.h205f22.v3',
    'duel_id',p_duel_id,'tick_no',p_tick_no,
    'input_checkpoint_sha256',d.current_checkpoint_sha256,
    'gpt_event_id',g_event_id,'gpt_payload_sha256',g_payload_sha,'gpt_event_sha256',g_event_sha,
    'glm_event_id',l_event_id,'glm_payload_sha256',l_payload_sha,'glm_event_sha256',l_event_sha,
    'output_checkpoint_sha256',out_sha,
    'persisted_readback',true,
    'gpt_event',g_readback,'glm_event',l_readback,'tick',tick_readback,
    'canonical',false,'authority_effect',false
  );
end
$function$;

revoke all on function public.h205f22_duel_submit_pair_v2(uuid,text,bigint,bigint,text,text,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.h205f22_duel_submit_pair_v2(uuid,text,bigint,bigint,text,text,jsonb,text,jsonb) to service_role;
