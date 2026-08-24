-- METAENGINE H205F22 DUEL SUBMIT PAIR IDEMPOTENT V3
-- Makes one-durable-tick Workflow retries safe after a committed pair write.
-- If the requested tick is already current, caller-supplied replay payload is ignored
-- and the exact persisted GPT/GLM/tick receipt is returned.

create or replace function public.h205f22_duel_submit_pair_v3(
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
set search_path='pg_catalog','destruktion_meta','extensions'
as $$
declare
  d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype;
  t destruktion_meta.compute_fabric_duel_tick_h205f22%rowtype;
  g jsonb;
  l jsonb;
  tk jsonb;
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

  if p_tick_no=d.current_tick then
    select * into t
    from destruktion_meta.compute_fabric_duel_tick_h205f22
    where duel_id=p_duel_id and tick_no=p_tick_no;
    if not found then raise exception 'duel_replay_tick_missing'; end if;
    if t.input_checkpoint_sha256 is distinct from p_seen_checkpoint_sha256 then
      raise exception 'duel_replay_input_checkpoint_mismatch';
    end if;
    if t.output_checkpoint_sha256 is distinct from d.current_checkpoint_sha256 then
      raise exception 'duel_replay_output_checkpoint_mismatch';
    end if;

    select jsonb_build_object(
      'event_id',e.event_id,'tick_no',e.tick_no,'actor',e.actor,'step_type',e.step_type,
      'payload',e.payload,'payload_sha256',e.payload_sha256,
      'parent_checkpoint_sha256',e.parent_checkpoint_sha256,'event_sha256',e.event_sha256,
      'created_at',e.created_at)
    into g
    from destruktion_meta.compute_fabric_duel_event_h205f22 e
    where e.duel_id=p_duel_id and e.event_sha256=t.gpt_event_sha256;

    select jsonb_build_object(
      'event_id',e.event_id,'tick_no',e.tick_no,'actor',e.actor,'step_type',e.step_type,
      'payload',e.payload,'payload_sha256',e.payload_sha256,
      'parent_checkpoint_sha256',e.parent_checkpoint_sha256,'event_sha256',e.event_sha256,
      'created_at',e.created_at)
    into l
    from destruktion_meta.compute_fabric_duel_event_h205f22 e
    where e.duel_id=p_duel_id and e.event_sha256=t.glm_event_sha256;

    tk:=jsonb_build_object(
      'tick_no',t.tick_no,'input_checkpoint_sha256',t.input_checkpoint_sha256,
      'gpt_event_sha256',t.gpt_event_sha256,'glm_event_sha256',t.glm_event_sha256,
      'output_checkpoint_sha256',t.output_checkpoint_sha256,'created_at',t.created_at);

    if g is null or l is null then raise exception 'duel_replay_pair_readback_missing'; end if;

    return jsonb_build_object(
      'schema','metaengine.compute.duel-microstep-pair.h205f22.v3',
      'duel_id',p_duel_id,'tick_no',p_tick_no,
      'input_checkpoint_sha256',t.input_checkpoint_sha256,
      'gpt_event_sha256',t.gpt_event_sha256,'glm_event_sha256',t.glm_event_sha256,
      'output_checkpoint_sha256',t.output_checkpoint_sha256,
      'persisted_readback',true,'replayed',true,
      'gpt_event',g,'glm_event',l,'tick',tk,
      'canonical',false,'authority_effect',false);
  end if;

  if p_tick_no<>d.current_tick+1 then
    raise exception 'duel_tick_mismatch expected % got %',d.current_tick+1,p_tick_no;
  end if;

  return public.h205f22_duel_submit_pair_v2(
    p_duel_id,p_worker,p_lease_generation,p_tick_no,p_seen_checkpoint_sha256,
    p_gpt_step_type,p_gpt_payload,p_glm_step_type,p_glm_payload);
end
$$;

revoke all on function public.h205f22_duel_submit_pair_v3(uuid,text,bigint,bigint,text,text,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.h205f22_duel_submit_pair_v3(uuid,text,bigint,bigint,text,text,jsonb,text,jsonb) to service_role;
