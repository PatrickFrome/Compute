create or replace function destruktion_meta.compute_fabric_a2_reap_stale_sessions_h205f22(p_workspace_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','destruktion_meta'
as $fn$
declare
  candidate record;
  now_ts timestamptz;
  abandoned_count bigint:=0;
  closed_count bigint:=0;
  affected bigint;
begin
  for candidate in
    select session_id,workspace_id,agent
    from destruktion_meta.compute_fabric_a2_peer_session_h205f22
    where status='ACTIVE'
      and lease_expires_at<=clock_timestamp()
      and (p_workspace_id is null or workspace_id=p_workspace_id)
    order by workspace_id,agent,session_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(candidate.workspace_id::text||':'||candidate.agent,205022));
    now_ts:=clock_timestamp();
    perform 1
    from destruktion_meta.compute_fabric_a2_peer_session_h205f22
    where session_id=candidate.session_id and status='ACTIVE' and lease_expires_at<=now_ts
    for update;
    if not found then continue; end if;

    perform set_config('metaengine.a2_rpc','on',true);
    update destruktion_meta.compute_fabric_a2_sync_round_h205f22
    set status='ABANDONED',abandoned_at=now_ts,abandon_reason='SESSION_EXPIRED'
    where status='OPEN'
      and (gpt_session_id=candidate.session_id or glm_session_id=candidate.session_id);
    get diagnostics affected=row_count;
    abandoned_count:=abandoned_count+affected;

    update destruktion_meta.compute_fabric_a2_peer_session_h205f22
    set status='CLOSED',closed_at=coalesce(closed_at,now_ts),last_seen_at=greatest(last_seen_at,now_ts)
    where session_id=candidate.session_id and status='ACTIVE' and lease_expires_at<=now_ts;
    get diagnostics affected=row_count;
    closed_count:=closed_count+affected;
  end loop;

  return jsonb_build_object('schema','metaengine.compute.a2-session-reap.v2','closed_sessions',closed_count,'abandoned_rounds',abandoned_count,'canonical',false,'authority_effect',false);
end
$fn$;
revoke all on function destruktion_meta.compute_fabric_a2_reap_stale_sessions_h205f22(uuid) from public;

create or replace function public.h205f22_a2_heartbeat_peer_session_v1(p_session_id uuid, p_ttl_seconds integer default 90)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','destruktion_meta'
as $fn$
declare
  s destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype;
  ttl integer:=least(greatest(coalesce(p_ttl_seconds,90),30),300);
  now_ts timestamptz;
begin
  select * into s from destruktion_meta.compute_fabric_a2_peer_session_h205f22 where session_id=p_session_id;
  if not found then raise exception 'a2_session_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(s.workspace_id::text||':'||s.agent,205022));
  now_ts:=clock_timestamp();
  perform set_config('metaengine.a2_rpc','on',true);
  update destruktion_meta.compute_fabric_a2_peer_session_h205f22
  set last_seen_at=now_ts,
      lease_expires_at=now_ts+make_interval(secs=>ttl)
  where session_id=p_session_id
    and status='ACTIVE'
  returning * into s;
  if not found then raise exception 'a2_session_lease_lost'; end if;
  return jsonb_build_object('schema','metaengine.compute.a2-session-heartbeat.v2','session_id',s.session_id,'workspace_id',s.workspace_id,'agent',s.agent,'capability_epoch',s.capability_epoch,'lease_expires_at',s.lease_expires_at,'canonical',false,'authority_effect',false);
end
$fn$;
revoke all on function public.h205f22_a2_heartbeat_peer_session_v1(uuid,integer) from public, anon, authenticated;
grant execute on function public.h205f22_a2_heartbeat_peer_session_v1(uuid,integer) to service_role, a2_peer_runtime;

create or replace function public.h205f22_a2_lookup_peer_session_v1(p_workspace_id uuid,p_agent text,p_runtime_id text,p_capability_epoch bigint)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','destruktion_meta'
as $fn$
declare s destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype;
begin
  select * into s
  from destruktion_meta.compute_fabric_a2_peer_session_h205f22
  where workspace_id=p_workspace_id and agent=p_agent and runtime_id=p_runtime_id and capability_epoch=p_capability_epoch and status='ACTIVE';
  if not found then raise exception 'a2_peer_session_not_found'; end if;
  return jsonb_build_object('schema','metaengine.compute.a2-peer-session-lookup.v1','session_id',s.session_id,'workspace_id',s.workspace_id,'agent',s.agent,'runtime_id',s.runtime_id,'capability_epoch',s.capability_epoch,'lease_expires_at',s.lease_expires_at,'canonical',false,'authority_effect',false);
end
$fn$;
revoke all on function public.h205f22_a2_lookup_peer_session_v1(uuid,text,text,bigint) from public, anon, authenticated;
grant execute on function public.h205f22_a2_lookup_peer_session_v1(uuid,text,text,bigint) to service_role, a2_peer_runtime;