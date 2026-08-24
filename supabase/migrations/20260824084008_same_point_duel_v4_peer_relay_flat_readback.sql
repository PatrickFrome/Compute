-- METAENGINE H205F22 SAME_POINT_DUEL_V4 PEER RELAY FLAT READBACK
-- Exposes stable top-level causal identifiers for independent agent clients.

create or replace function public.h205f22_duel_read_peer_relay_v4(p_duel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','destruktion_meta','extensions'
as $$
declare
  d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype;
  base jsonb;
  pending text[];
  pending_wave text;
  relay_state text;
  has_decision boolean;
begin
  select * into d from destruktion_meta.compute_fabric_duel_session_h205f22 where duel_id=p_duel_id;
  if not found then
    return jsonb_build_object('schema','metaengine.compute.same-point-peer-relay.h205f22.v1','found',false,'canonical',false,'authority_effect',false);
  end if;
  if coalesce((d.subject->>'peer_relay')::boolean,false) is not true
     or d.subject->>'debate_protocol' <> 'SAME_POINT_DUEL_V4' then
    raise exception 'not_peer_relay_v4';
  end if;

  base := public.h205f22_duel_read_same_point_v4(p_duel_id);
  pending_wave := case when d.current_tick=0 then 'PROPOSE' when d.current_tick=1 then 'REBUT' else null end;
  if pending_wave is not null then
    select array_agg(actor order by actor) into pending
    from destruktion_meta.compute_fabric_duel_peer_submission_h205f22
    where duel_id=p_duel_id and wave=pending_wave;
  end if;
  select exists(select 1 from destruktion_meta.compute_fabric_duel_decision_h205f22 where duel_id=p_duel_id) into has_decision;

  relay_state := case
    when has_decision then 'DECIDED'
    when d.current_tick=0 and coalesce(array_length(pending,1),0)=0 then 'ARMED_WAIT'
    when d.current_tick=0 then 'WAITING_PROPOSE_PEER'
    when d.current_tick=1 and coalesce(array_length(pending,1),0)=0 then 'WAITING_REBUT_START'
    when d.current_tick=1 then 'WAITING_REBUT_PEER'
    else 'ADVANCED'
  end;

  return base || jsonb_build_object(
    'schema','metaengine.compute.same-point-peer-relay.h205f22.v1',
    'found',true,
    'duel_id',d.duel_id,
    'duel_key',d.duel_key,
    'status',d.status,
    'current_tick',d.current_tick,
    'current_checkpoint_sha256',d.current_checkpoint_sha256,
    'base_github_sha',d.base_github_sha,
    'semantic_checkpoint_id',d.semantic_checkpoint_id,
    'semantic_payload_root_sha256',d.semantic_payload_root_sha256,
    'peer_relay',true,
    'relay_state',relay_state,
    'pending_wave',pending_wave,
    'pending_actors',coalesce(to_jsonb(pending),'[]'::jsonb),
    'pending_payloads_exposed',false,
    'canonical',false,
    'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_duel_read_peer_relay_v4(uuid) from public,anon,authenticated;
grant execute on function public.h205f22_duel_read_peer_relay_v4(uuid) to service_role;
