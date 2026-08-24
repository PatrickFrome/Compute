alter table destruktion_meta.compute_fabric_duel_autonomous_peer_relay_h205f22
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists lease_generation bigint not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_error text;

create index if not exists compute_fabric_duel_autonomous_peer_relay_lease_h205f22_idx
  on destruktion_meta.compute_fabric_duel_autonomous_peer_relay_h205f22(lease_expires_at, registered_at);

create or replace function public.h205f22_duel_lease_autonomous_peer_relay_v4(
  p_worker text,
  p_lease_seconds integer default 180
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','destruktion_meta','extensions'
as $$
declare
  v_duel_id uuid;
  v_generation bigint;
  d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype;
  a destruktion_meta.compute_fabric_duel_autonomous_peer_relay_h205f22%rowtype;
  head jsonb;
  head_checkpoint text;
  head_root text;
begin
  if p_worker is null or length(trim(p_worker)) < 3 or length(p_worker) > 160 then raise exception 'autonomous_peer_worker_invalid'; end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then raise exception 'autonomous_peer_lease_seconds_out_of_range'; end if;

  head := destruktion_meta.compute_fabric_roadmap_status_h205f22()->'semantic_head';
  head_checkpoint := head->>'checkpoint_id';
  head_root := head->>'payload_root_sha256';
  if head_checkpoint is null or head_root is null then raise exception 'semantic_head_unavailable'; end if;

  select ar.duel_id into v_duel_id
  from destruktion_meta.compute_fabric_duel_autonomous_peer_relay_h205f22 ar
  join destruktion_meta.compute_fabric_duel_session_h205f22 ds using(duel_id)
  where coalesce((ds.subject->>'peer_relay')::boolean,false) is true
    and ds.subject->>'debate_protocol'='SAME_POINT_DUEL_V4'
    and ds.subject->'peer_identities'->>'GPT'='chatgpt:gpt-5.6-sol'
    and ds.subject->'peer_identities'->>'GLM'='glm:5.3'
    and ds.semantic_checkpoint_id=head_checkpoint
    and ds.semantic_payload_root_sha256=head_root
    and ds.current_tick in (0,1)
    and ds.status='BLOCKED'
    and not exists (select 1 from destruktion_meta.compute_fabric_duel_decision_h205f22 x where x.duel_id=ds.duel_id)
    and (
      select count(*) from destruktion_meta.compute_fabric_duel_peer_submission_h205f22 s
      where s.duel_id=ds.duel_id
        and s.wave=(case when ds.current_tick=0 then 'PROPOSE' else 'REBUT' end)
    ) < 2
    and (ar.lease_expires_at is null or ar.lease_expires_at < clock_timestamp() or ar.lease_owner=trim(p_worker))
  order by ds.created_at
  for update of ar skip locked
  limit 1;

  if v_duel_id is null then
    return jsonb_build_object('schema','metaengine.compute.same-point-peer-relay-autonomous-lease.h205f22.v1','leased',false,'canonical',false,'authority_effect',false);
  end if;

  update destruktion_meta.compute_fabric_duel_autonomous_peer_relay_h205f22
  set lease_owner=trim(p_worker),
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
      lease_generation=lease_generation+1,
      last_attempt_at=clock_timestamp(),
      last_error=null
  where duel_id=v_duel_id
  returning lease_generation into v_generation;

  select * into d from destruktion_meta.compute_fabric_duel_session_h205f22 where duel_id=v_duel_id;
  select * into a from destruktion_meta.compute_fabric_duel_autonomous_peer_relay_h205f22 where duel_id=v_duel_id;

  return jsonb_build_object(
    'schema','metaengine.compute.same-point-peer-relay-autonomous-lease.h205f22.v1',
    'leased',true,
    'duel_id',d.duel_id,
    'duel_key',d.duel_key,
    'milestone_key',d.milestone_key,
    'base_github_sha',d.base_github_sha,
    'semantic_checkpoint_id',d.semantic_checkpoint_id,
    'semantic_payload_root_sha256',d.semantic_payload_root_sha256,
    'subject',d.subject,
    'peer_identities',d.subject->'peer_identities',
    'relay',public.h205f22_duel_read_peer_relay_v4(d.duel_id),
    'lease_owner',a.lease_owner,
    'lease_generation',v_generation,
    'lease_expires_at',a.lease_expires_at,
    'registered_by',a.registered_by,
    'registered_at',a.registered_at,
    'pending_payload_visibility','HIDDEN_UNTIL_ATOMIC_PAIR',
    'canonical',false,
    'authority_effect',false
  );
end
$$;

create or replace function public.h205f22_duel_release_autonomous_peer_relay_v4(
  p_duel_id uuid,
  p_worker text,
  p_lease_generation bigint,
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','destruktion_meta','extensions'
as $$
declare
  n integer;
begin
  if p_duel_id is null or p_worker is null or p_lease_generation is null then raise exception 'autonomous_peer_release_identity_required'; end if;
  update destruktion_meta.compute_fabric_duel_autonomous_peer_relay_h205f22
  set lease_owner=null,
      lease_expires_at=null,
      last_error=case when p_error is null then null else left(p_error,1000) end
  where duel_id=p_duel_id
    and lease_owner=trim(p_worker)
    and lease_generation=p_lease_generation;
  get diagnostics n=row_count;
  return jsonb_build_object(
    'schema','metaengine.compute.same-point-peer-relay-autonomous-release.h205f22.v1',
    'released',n=1,
    'duel_id',p_duel_id,
    'lease_generation',p_lease_generation,
    'canonical',false,
    'authority_effect',false
  );
end
$$;

revoke all on function public.h205f22_duel_lease_autonomous_peer_relay_v4(text,integer) from public, anon, authenticated;
revoke all on function public.h205f22_duel_release_autonomous_peer_relay_v4(uuid,text,bigint,text) from public, anon, authenticated;
grant execute on function public.h205f22_duel_lease_autonomous_peer_relay_v4(text,integer) to service_role;
grant execute on function public.h205f22_duel_release_autonomous_peer_relay_v4(uuid,text,bigint,text) to service_role;
