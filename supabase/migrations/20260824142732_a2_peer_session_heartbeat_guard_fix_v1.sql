create or replace function public.h205f22_a2_heartbeat_peer_session_v1(p_session_id uuid, p_ttl_seconds integer default 90)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','destruktion_meta'
as $fn$
declare
  s destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype;
  ttl integer:=least(greatest(coalesce(p_ttl_seconds,90),30),300);
  now_ts timestamptz:=clock_timestamp();
begin
  perform set_config('metaengine.a2_rpc','on',true);
  update destruktion_meta.compute_fabric_a2_peer_session_h205f22
  set last_seen_at=now_ts,
      lease_expires_at=now_ts+make_interval(secs=>ttl)
  where session_id=p_session_id
    and status='ACTIVE'
    and lease_expires_at>now_ts
  returning * into s;
  if not found then raise exception 'a2_session_lease_expired'; end if;
  return jsonb_build_object('schema','metaengine.compute.a2-session-heartbeat.v1','session_id',s.session_id,'workspace_id',s.workspace_id,'agent',s.agent,'capability_epoch',s.capability_epoch,'lease_expires_at',s.lease_expires_at,'canonical',false,'authority_effect',false);
end
$fn$;
revoke all on function public.h205f22_a2_heartbeat_peer_session_v1(uuid,integer) from public, anon, authenticated;
grant execute on function public.h205f22_a2_heartbeat_peer_session_v1(uuid,integer) to service_role, a2_peer_runtime;