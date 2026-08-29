select set_config('metaengine.a2_rpc','on',true);

alter table destruktion_meta.compute_fabric_a2_peer_session_h205f22
  add column if not exists lease_expires_at timestamptz;

update destruktion_meta.compute_fabric_a2_peer_session_h205f22
set lease_expires_at = coalesce(lease_expires_at, last_seen_at + interval '90 seconds')
where lease_expires_at is null;

alter table destruktion_meta.compute_fabric_a2_peer_session_h205f22
  alter column lease_expires_at set default (clock_timestamp() + interval '90 seconds'),
  alter column lease_expires_at set not null;

create index if not exists compute_fabric_a2_active_session_lease_idx
  on destruktion_meta.compute_fabric_a2_peer_session_h205f22(workspace_id,agent,lease_expires_at)
  where status='ACTIVE';

create or replace function destruktion_meta.compute_fabric_a2_assert_live_session_h205f22(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path='pg_catalog','destruktion_meta'
as $fn$
begin
  perform 1
  from destruktion_meta.compute_fabric_a2_peer_session_h205f22
  where session_id=p_session_id
    and status='ACTIVE'
    and lease_expires_at>clock_timestamp();
  if not found then
    raise exception 'a2_session_lease_expired';
  end if;
end
$fn$;
revoke all on function destruktion_meta.compute_fabric_a2_assert_live_session_h205f22(uuid) from public;

create or replace function destruktion_meta.compute_fabric_a2_session_lease_guard_h205f22()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','destruktion_meta'
as $fn$
begin
  perform destruktion_meta.compute_fabric_a2_assert_live_session_h205f22(new.session_id);
  return new;
end
$fn$;
revoke all on function destruktion_meta.compute_fabric_a2_session_lease_guard_h205f22() from public;

drop trigger if exists compute_fabric_a2_agent_event_session_lease_guard on destruktion_meta.compute_fabric_a2_agent_event_h205f22;
create trigger compute_fabric_a2_agent_event_session_lease_guard
before insert on destruktion_meta.compute_fabric_a2_agent_event_h205f22
for each row execute function destruktion_meta.compute_fabric_a2_session_lease_guard_h205f22();

drop trigger if exists compute_fabric_a2_visibility_session_lease_guard on destruktion_meta.compute_fabric_a2_visibility_proof_h205f22;
create trigger compute_fabric_a2_visibility_session_lease_guard
before insert on destruktion_meta.compute_fabric_a2_visibility_proof_h205f22
for each row execute function destruktion_meta.compute_fabric_a2_session_lease_guard_h205f22();

drop trigger if exists compute_fabric_a2_cursor_session_lease_guard on destruktion_meta.compute_fabric_a2_peer_cursor_h205f22;
create trigger compute_fabric_a2_cursor_session_lease_guard
before insert or update on destruktion_meta.compute_fabric_a2_peer_cursor_h205f22
for each row execute function destruktion_meta.compute_fabric_a2_session_lease_guard_h205f22();

create or replace function destruktion_meta.compute_fabric_a2_sync_round_session_lease_guard_h205f22()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','destruktion_meta'
as $fn$
begin
  if new.status='OPEN' then
    if new.gpt_session_id is not null then
      perform destruktion_meta.compute_fabric_a2_assert_live_session_h205f22(new.gpt_session_id);
    end if;
    if new.glm_session_id is not null then
      perform destruktion_meta.compute_fabric_a2_assert_live_session_h205f22(new.glm_session_id);
    end if;
  end if;
  return new;
end
$fn$;
revoke all on function destruktion_meta.compute_fabric_a2_sync_round_session_lease_guard_h205f22() from public;

drop trigger if exists compute_fabric_a2_sync_round_session_lease_guard on destruktion_meta.compute_fabric_a2_sync_round_h205f22;
create trigger compute_fabric_a2_sync_round_session_lease_guard
before insert or update on destruktion_meta.compute_fabric_a2_sync_round_h205f22
for each row execute function destruktion_meta.compute_fabric_a2_sync_round_session_lease_guard_h205f22();

create or replace function destruktion_meta.compute_fabric_a2_reap_stale_sessions_h205f22(p_workspace_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','destruktion_meta'
as $fn$
declare
  now_ts timestamptz:=clock_timestamp();
  stale_ids uuid[];
  abandoned_count bigint:=0;
  closed_count bigint:=0;
begin
  select coalesce(array_agg(session_id),'{}'::uuid[]) into stale_ids
  from destruktion_meta.compute_fabric_a2_peer_session_h205f22
  where status='ACTIVE'
    and lease_expires_at<=now_ts
    and (p_workspace_id is null or workspace_id=p_workspace_id);

  if cardinality(stale_ids)=0 then
    return jsonb_build_object('schema','metaengine.compute.a2-session-reap.v1','closed_sessions',0,'abandoned_rounds',0,'canonical',false,'authority_effect',false);
  end if;

  perform set_config('metaengine.a2_rpc','on',true);
  update destruktion_meta.compute_fabric_a2_sync_round_h205f22
  set status='ABANDONED',abandoned_at=now_ts,abandon_reason='SESSION_EXPIRED'
  where status='OPEN'
    and (gpt_session_id=any(stale_ids) or glm_session_id=any(stale_ids));
  get diagnostics abandoned_count=row_count;

  update destruktion_meta.compute_fabric_a2_peer_session_h205f22
  set status='CLOSED',closed_at=coalesce(closed_at,now_ts),last_seen_at=greatest(last_seen_at,now_ts)
  where session_id=any(stale_ids) and status='ACTIVE';
  get diagnostics closed_count=row_count;

  return jsonb_build_object('schema','metaengine.compute.a2-session-reap.v1','closed_sessions',closed_count,'abandoned_rounds',abandoned_count,'canonical',false,'authority_effect',false);
end
$fn$;
revoke all on function destruktion_meta.compute_fabric_a2_reap_stale_sessions_h205f22(uuid) from public;

create or replace function public.h205f22_a2_reap_stale_sessions_v1(p_workspace_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','destruktion_meta'
as $fn$
begin
  return destruktion_meta.compute_fabric_a2_reap_stale_sessions_h205f22(p_workspace_id);
end
$fn$;
revoke all on function public.h205f22_a2_reap_stale_sessions_v1(uuid) from public, anon, authenticated, a2_peer_runtime;
grant execute on function public.h205f22_a2_reap_stale_sessions_v1(uuid) to service_role;

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

create or replace function public.h205f22_a2_register_peer_session_v1(p_workspace_id uuid, p_agent text, p_runtime_id text, p_provider text, p_requested_model text, p_reported_model text, p_capabilities jsonb, p_capability_epoch bigint, p_public_key_base64 text)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','destruktion_meta','extensions'
as $fn$
declare
  r destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype;
  existing destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype;
  key_bytes bytea;
  fp text;
  expected_model text;
  max_epoch bigint;
  now_ts timestamptz:=clock_timestamp();
begin
  if p_agent not in ('GPT','GLM') then raise exception 'a2_agent_invalid'; end if;
  expected_model:=case when p_agent='GPT' then 'openai/gpt-5.6-sol' else 'zai/glm-5.3' end;
  if p_requested_model<>expected_model then raise exception 'a2_exact_model_required:%',expected_model; end if;
  if p_capability_epoch is null or p_capability_epoch<1 then raise exception 'a2_capability_epoch_invalid'; end if;
  begin key_bytes:=decode(p_public_key_base64,'base64'); exception when others then raise exception 'a2_public_key_base64_invalid'; end;
  if octet_length(key_bytes)<>32 then raise exception 'a2_ed25519_public_key_length_invalid'; end if;
  fp:=encode(extensions.digest(key_bytes,'sha256'),'hex');

  perform 1 from destruktion_meta.compute_fabric_a2_workspace_h205f22 where workspace_id=p_workspace_id and mode<>'CLOSED';
  if not found then raise exception 'a2_workspace_not_open'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||p_agent,205022));
  perform destruktion_meta.compute_fabric_a2_reap_stale_sessions_h205f22(p_workspace_id);

  select * into existing
  from destruktion_meta.compute_fabric_a2_peer_session_h205f22
  where workspace_id=p_workspace_id and agent=p_agent and capability_epoch=p_capability_epoch
  for update;
  if found then
    if existing.status='ACTIVE'
       and existing.lease_expires_at>now_ts
       and existing.runtime_id=p_runtime_id
       and existing.key_fingerprint_sha256=fp then
      perform set_config('metaengine.a2_rpc','on',true);
      update destruktion_meta.compute_fabric_a2_peer_session_h205f22
      set last_seen_at=now_ts,
          lease_expires_at=now_ts+interval '90 seconds',
          reported_model=nullif(p_reported_model,''),
          capabilities=coalesce(p_capabilities,'{}'::jsonb)
      where session_id=existing.session_id
      returning * into r;
      return jsonb_build_object('schema','metaengine.compute.a2-peer-session.v2','session_id',r.session_id,'workspace_id',r.workspace_id,'agent',r.agent,'runtime_id',r.runtime_id,'requested_model',r.requested_model,'reported_model',r.reported_model,'capability_epoch',r.capability_epoch,'key_fingerprint_sha256',r.key_fingerprint_sha256,'lease_expires_at',r.lease_expires_at,'canonical',false,'authority_effect',false);
    end if;
    raise exception 'a2_session_epoch_conflict';
  end if;

  select max(capability_epoch) into max_epoch
  from destruktion_meta.compute_fabric_a2_peer_session_h205f22
  where workspace_id=p_workspace_id and agent=p_agent;
  if max_epoch is not null and p_capability_epoch<=max_epoch then raise exception 'a2_capability_epoch_not_monotonic'; end if;

  perform 1 from destruktion_meta.compute_fabric_a2_peer_session_h205f22
  where workspace_id=p_workspace_id and agent=p_agent and status='ACTIVE' and lease_expires_at>now_ts;
  if found then raise exception 'a2_active_peer_lease_exists'; end if;

  perform set_config('metaengine.a2_rpc','on',true);
  insert into destruktion_meta.compute_fabric_a2_peer_session_h205f22(workspace_id,agent,runtime_id,provider,requested_model,reported_model,capabilities,capability_epoch,public_key_base64,key_fingerprint_sha256,last_seen_at,lease_expires_at)
  values(p_workspace_id,p_agent,p_runtime_id,p_provider,p_requested_model,nullif(p_reported_model,''),coalesce(p_capabilities,'{}'::jsonb),p_capability_epoch,p_public_key_base64,fp,now_ts,now_ts+interval '90 seconds')
  returning * into r;

  insert into destruktion_meta.compute_fabric_a2_peer_cursor_h205f22(workspace_id,session_id,agent,causal_frontier_hash)
  values(p_workspace_id,r.session_id,p_agent,repeat('0',64));

  return jsonb_build_object('schema','metaengine.compute.a2-peer-session.v2','session_id',r.session_id,'workspace_id',r.workspace_id,'agent',r.agent,'runtime_id',r.runtime_id,'requested_model',r.requested_model,'reported_model',r.reported_model,'capability_epoch',r.capability_epoch,'key_fingerprint_sha256',r.key_fingerprint_sha256,'lease_expires_at',r.lease_expires_at,'canonical',false,'authority_effect',false);
end
$fn$;

revoke all on function public.h205f22_a2_register_peer_session_v1(uuid,text,text,text,text,text,jsonb,bigint,text) from public, anon, authenticated;
grant execute on function public.h205f22_a2_register_peer_session_v1(uuid,text,text,text,text,text,jsonb,bigint,text) to service_role, a2_peer_runtime;