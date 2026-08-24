create or replace function public.h205f22_duel_list_peer_relay_pending_v4(p_limit integer default 8)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','destruktion_meta','extensions'
as $$
declare
  items jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 32 then
    raise exception 'peer_relay_pending_limit_out_of_range';
  end if;

  select coalesce(jsonb_agg(q.context order by q.created_at), '[]'::jsonb)
  into items
  from (
    select d.created_at,
      jsonb_build_object(
        'duel_id',d.duel_id,
        'duel_key',d.duel_key,
        'milestone_key',d.milestone_key,
        'base_github_sha',d.base_github_sha,
        'semantic_checkpoint_id',d.semantic_checkpoint_id,
        'semantic_payload_root_sha256',d.semantic_payload_root_sha256,
        'subject',d.subject,
        'peer_identities',d.subject->'peer_identities',
        'relay',public.h205f22_duel_read_peer_relay_v4(d.duel_id),
        'canonical',false,
        'authority_effect',false
      ) as context
    from destruktion_meta.compute_fabric_duel_session_h205f22 d
    where coalesce((d.subject->>'peer_relay')::boolean,false) is true
      and d.subject->>'debate_protocol'='SAME_POINT_DUEL_V4'
      and d.current_tick in (0,1)
      and d.status='BLOCKED'
      and not exists (select 1 from destruktion_meta.compute_fabric_duel_decision_h205f22 x where x.duel_id=d.duel_id)
      and (
        select count(*) from destruktion_meta.compute_fabric_duel_peer_submission_h205f22 s
        where s.duel_id=d.duel_id
          and s.wave=(case when d.current_tick=0 then 'PROPOSE' else 'REBUT' end)
      ) < 2
    order by d.created_at
    limit p_limit
  ) q;

  return jsonb_build_object(
    'schema','metaengine.compute.same-point-peer-relay-autonomous-context.h205f22.v1',
    'items',items,
    'pending_payload_visibility','HIDDEN_UNTIL_ATOMIC_PAIR',
    'canonical',false,
    'authority_effect',false
  );
end
$$;

revoke all on function public.h205f22_duel_list_peer_relay_pending_v4(integer) from public, anon, authenticated;
grant execute on function public.h205f22_duel_list_peer_relay_pending_v4(integer) to service_role;
