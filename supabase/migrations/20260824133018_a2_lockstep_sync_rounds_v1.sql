-- A2 lockstep collaboration rounds.
-- Both exact-model peers compute one bounded microstep from the same immutable
-- base frontier. The next round cannot open until both signed results commit.

create table if not exists destruktion_meta.compute_fabric_a2_sync_round_h205f22 (
  round_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references destruktion_meta.compute_fabric_a2_workspace_h205f22(workspace_id) on delete cascade,
  round_seq bigint not null check (round_seq > 0),
  deliberation_phase text not null check (deliberation_phase in ('PROPOSE','CHALLENGE','DECIDE')),
  semantic_point text not null,
  base_commit_seq bigint not null check (base_commit_seq >= 0),
  base_gpt_seq bigint not null check (base_gpt_seq >= 0),
  base_glm_seq bigint not null check (base_glm_seq >= 0),
  base_frontier_hash text not null check (base_frontier_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'OPEN' check (status in ('OPEN','SEALED','ABANDONED')),
  gpt_session_id uuid references destruktion_meta.compute_fabric_a2_peer_session_h205f22(session_id),
  glm_session_id uuid references destruktion_meta.compute_fabric_a2_peer_session_h205f22(session_id),
  gpt_event_id uuid references destruktion_meta.compute_fabric_a2_agent_event_h205f22(event_id),
  glm_event_id uuid references destruktion_meta.compute_fabric_a2_agent_event_h205f22(event_id),
  gpt_event_hash text check (gpt_event_hash is null or gpt_event_hash ~ '^[0-9a-f]{64}$'),
  glm_event_hash text check (glm_event_hash is null or glm_event_hash ~ '^[0-9a-f]{64}$'),
  opened_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  expires_at timestamptz,
  sealed_at timestamptz,
  sealed_commit_seq bigint,
  sealed_frontier_hash text check (sealed_frontier_hash is null or sealed_frontier_hash ~ '^[0-9a-f]{64}$'),
  abandoned_at timestamptz,
  abandon_reason text,
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  unique(workspace_id,round_seq),
  check (status<>'SEALED' or (gpt_event_id is not null and glm_event_id is not null and sealed_at is not null)),
  check (status<>'ABANDONED' or abandoned_at is not null)
);

create unique index if not exists compute_fabric_a2_sync_round_one_open_idx
  on destruktion_meta.compute_fabric_a2_sync_round_h205f22(workspace_id)
  where status='OPEN';
create index if not exists compute_fabric_a2_sync_round_workspace_recent_idx
  on destruktion_meta.compute_fabric_a2_sync_round_h205f22(workspace_id,round_seq desc);
create index if not exists compute_fabric_a2_sync_round_gpt_session_idx
  on destruktion_meta.compute_fabric_a2_sync_round_h205f22(gpt_session_id)
  where gpt_session_id is not null;
create index if not exists compute_fabric_a2_sync_round_glm_session_idx
  on destruktion_meta.compute_fabric_a2_sync_round_h205f22(glm_session_id)
  where glm_session_id is not null;

alter table destruktion_meta.compute_fabric_a2_sync_round_h205f22 enable row level security;
revoke all on destruktion_meta.compute_fabric_a2_sync_round_h205f22 from public,anon,authenticated,service_role,a2_peer_runtime;

drop trigger if exists trg_a2_guard_sync_round on destruktion_meta.compute_fabric_a2_sync_round_h205f22;
create trigger trg_a2_guard_sync_round
before insert or update or delete on destruktion_meta.compute_fabric_a2_sync_round_h205f22
for each row execute function destruktion_meta.compute_fabric_a2_guard_write_h205f22();

create or replace function public.h205f22_a2_join_sync_round_v1(
  p_session_id uuid,
  p_ttl_seconds integer default 45
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta,extensions
as $$
declare
  s destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype;
  w destruktion_meta.compute_fabric_a2_workspace_h205f22%rowtype;
  r destruktion_meta.compute_fabric_a2_sync_round_h205f22%rowtype;
  f jsonb;
  prior_seen bigint;
  mandatory text[];
  next_round_seq bigint;
  sealed_round_count bigint;
  next_phase text;
  ttl integer:=least(greatest(coalesce(p_ttl_seconds,45),10),300);
begin
  select * into s from destruktion_meta.compute_fabric_a2_peer_session_h205f22
  where session_id=p_session_id and status='ACTIVE';
  if not found then raise exception 'a2_session_not_active'; end if;
  perform pg_advisory_xact_lock(hashtextextended(s.workspace_id::text,205022));
  select * into w from destruktion_meta.compute_fabric_a2_workspace_h205f22
  where workspace_id=s.workspace_id for update;
  if not found then raise exception 'a2_workspace_not_found'; end if;
  if w.mode<>'COLLABORATE' then raise exception 'a2_sync_round_workspace_not_collaborating:%',w.mode; end if;

  select * into r from destruktion_meta.compute_fabric_a2_sync_round_h205f22
  where workspace_id=s.workspace_id and status='OPEN'
  order by round_seq desc limit 1 for update;
  if found and ((r.expires_at is not null and r.expires_at<=clock_timestamp())
    or (r.expires_at is null and r.opened_at<=clock_timestamp()-make_interval(secs=>ttl))) then
    perform set_config('metaengine.a2_rpc','on',true);
    update destruktion_meta.compute_fabric_a2_sync_round_h205f22
    set status='ABANDONED',abandoned_at=clock_timestamp(),abandon_reason='ROUND_TIMEOUT'
    where round_id=r.round_id;
    r:=null;
  end if;

  if r.round_id is null then
    f:=public.h205f22_a2_read_frontier_v1(s.workspace_id);
    select coalesce(max(round_seq)+1,1) into next_round_seq
    from destruktion_meta.compute_fabric_a2_sync_round_h205f22 where workspace_id=s.workspace_id;
    select count(*) into sealed_round_count from destruktion_meta.compute_fabric_a2_sync_round_h205f22
    where workspace_id=s.workspace_id and status='SEALED';
    next_phase:=case mod(sealed_round_count,3) when 0 then 'PROPOSE' when 1 then 'CHALLENGE' else 'DECIDE' end;
    perform set_config('metaengine.a2_rpc','on',true);
    insert into destruktion_meta.compute_fabric_a2_sync_round_h205f22(
      workspace_id,round_seq,deliberation_phase,semantic_point,base_commit_seq,base_gpt_seq,base_glm_seq,base_frontier_hash
    ) values(
      s.workspace_id,
      next_round_seq,next_phase,
      w.semantic_point,
      (f->>'head_commit_seq')::bigint,
      (f->>'gpt_seq')::bigint,
      (f->>'glm_seq')::bigint,
      f->>'frontier_hash'
    ) returning * into r;
  end if;

  perform set_config('metaengine.a2_rpc','on',true);
  if s.agent='GPT' then
    if r.gpt_session_id is not null and r.gpt_session_id<>s.session_id then raise exception 'a2_sync_round_gpt_slot_owned'; end if;
    update destruktion_meta.compute_fabric_a2_sync_round_h205f22
    set gpt_session_id=s.session_id where round_id=r.round_id returning * into r;
  else
    if r.glm_session_id is not null and r.glm_session_id<>s.session_id then raise exception 'a2_sync_round_glm_slot_owned'; end if;
    update destruktion_meta.compute_fabric_a2_sync_round_h205f22
    set glm_session_id=s.session_id where round_id=r.round_id returning * into r;
  end if;
  if r.gpt_session_id is not null and r.glm_session_id is not null and r.started_at is null then
    update destruktion_meta.compute_fabric_a2_sync_round_h205f22
    set started_at=clock_timestamp(),expires_at=clock_timestamp()+make_interval(secs=>ttl)
    where round_id=r.round_id returning * into r;
  end if;

  select coalesce(max(v.seen_commit_seq),0) into prior_seen
  from destruktion_meta.compute_fabric_a2_visibility_proof_h205f22 v
  where v.workspace_id=s.workspace_id and v.agent=s.agent and v.accepted_event_id is not null;
  select coalesce(array_agg(e.event_hash order by e.event_hash),'{}'::text[]) into mandatory
  from destruktion_meta.compute_fabric_a2_agent_event_h205f22 e
  where e.workspace_id=s.workspace_id and e.agent<>s.agent and e.priority<=1
    and e.commit_seq>prior_seen and e.commit_seq<=r.base_commit_seq;

  return jsonb_build_object(
    'schema','metaengine.compute.a2-sync-round.v1','round_id',r.round_id,'round_seq',r.round_seq,'deliberation_phase',r.deliberation_phase,
    'workspace_id',r.workspace_id,'semantic_point',r.semantic_point,'status',r.status,
    'base_commit_seq',r.base_commit_seq,'base_gpt_seq',r.base_gpt_seq,'base_glm_seq',r.base_glm_seq,
    'base_frontier_hash',r.base_frontier_hash,'gpt_session_id',r.gpt_session_id,'glm_session_id',r.glm_session_id,
    'gpt_event_id',r.gpt_event_id,'glm_event_id',r.glm_event_id,'gpt_event_hash',r.gpt_event_hash,'glm_event_hash',r.glm_event_hash,
    'participants_ready',(r.gpt_session_id is not null and r.glm_session_id is not null),
    'mandatory_peer_event_hashes',to_jsonb(mandatory),'started_at',r.started_at,'expires_at',r.expires_at,
    'canonical',false,'authority_effect',false
  );
end $$;

create or replace function public.h205f22_a2_abandon_sync_round_v1(
  p_session_id uuid,
  p_round_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta
as $$
declare
  s destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype;
  r destruktion_meta.compute_fabric_a2_sync_round_h205f22%rowtype;
  reason text:=upper(coalesce(nullif(btrim(p_reason),''),'MODEL_INTERRUPTED'));
begin
  if reason not in ('ROUND_TIMEOUT','LATE_MANDATORY_EVENT','MODEL_INTERRUPTED','MODEL_ERROR','MODE_CHANGED','SESSION_REPLACED') then
    raise exception 'a2_sync_round_abandon_reason_invalid';
  end if;
  select * into s from destruktion_meta.compute_fabric_a2_peer_session_h205f22
  where session_id=p_session_id and status='ACTIVE';
  if not found then raise exception 'a2_session_not_active'; end if;
  perform pg_advisory_xact_lock(hashtextextended(s.workspace_id::text,205022));
  select * into r from destruktion_meta.compute_fabric_a2_sync_round_h205f22
  where round_id=p_round_id and workspace_id=s.workspace_id for update;
  if not found then raise exception 'a2_sync_round_not_found'; end if;
  if s.session_id is distinct from r.gpt_session_id and s.session_id is distinct from r.glm_session_id then
    raise exception 'a2_sync_round_not_participant';
  end if;
  if r.status='OPEN' then
    perform set_config('metaengine.a2_rpc','on',true);
    update destruktion_meta.compute_fabric_a2_sync_round_h205f22
    set status='ABANDONED',abandoned_at=clock_timestamp(),abandon_reason=reason
    where round_id=r.round_id returning * into r;
  end if;
  return jsonb_build_object('schema','metaengine.compute.a2-sync-round.v1','round_id',r.round_id,
    'round_seq',r.round_seq,'deliberation_phase',r.deliberation_phase,'status',r.status,'abandon_reason',r.abandon_reason,
    'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_a2_read_sync_state_v1(p_workspace_id uuid)
returns jsonb
language sql
security definer
set search_path=pg_catalog,destruktion_meta
as $$
  select jsonb_build_object(
    'schema','metaengine.compute.a2-sync-state.v1','workspace_id',p_workspace_id,
    'current_round',(
      select to_jsonb(r) from (
        select round_id,round_seq,deliberation_phase,semantic_point,base_commit_seq,base_gpt_seq,base_glm_seq,base_frontier_hash,
          status,gpt_session_id,glm_session_id,gpt_event_id,glm_event_id,gpt_event_hash,glm_event_hash,
          opened_at,started_at,expires_at,sealed_at,sealed_commit_seq,sealed_frontier_hash,abandoned_at,abandon_reason,
          canonical,authority_effect
        from destruktion_meta.compute_fabric_a2_sync_round_h205f22
        where workspace_id=p_workspace_id order by round_seq desc limit 1
      ) r
    ),
    'recent_rounds',coalesce((
      select jsonb_agg(to_jsonb(r) order by r.round_seq desc) from (
        select round_id,round_seq,deliberation_phase,base_commit_seq,base_frontier_hash,status,gpt_event_hash,glm_event_hash,
          opened_at,started_at,expires_at,sealed_at,sealed_commit_seq,sealed_frontier_hash,abandon_reason
        from destruktion_meta.compute_fabric_a2_sync_round_h205f22
        where workspace_id=p_workspace_id order by round_seq desc limit 20
      ) r
    ),'[]'::jsonb),
    'canonical',false,'authority_effect',false
  )
$$;

create or replace function public.h205f22_a2_emit_agent_event_v1(
  p_event_id uuid,p_session_id uuid,p_agent_seq bigint,p_semantic_point text,
  p_event_type text,p_priority smallint,p_parent_hashes text[],p_payload jsonb,
  p_visibility_proof_id uuid,p_model_provenance jsonb,p_event_hash text,
  p_signature_base64 text,p_signature_key_fingerprint_sha256 text,p_signature_verified boolean
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta,extensions
as $$
declare
  s destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype;
  prep jsonb;
  e destruktion_meta.compute_fabric_a2_agent_event_h205f22%rowtype;
  v destruktion_meta.compute_fabric_a2_visibility_proof_h205f22%rowtype;
  r destruktion_meta.compute_fabric_a2_sync_round_h205f22%rowtype;
  model_authored boolean;
  sig_bytes bytea;
  allowed boolean;
  reported text;
  requested text;
  workspace_mode text;
  v_round_id uuid;
  v_round_seq bigint;
  prior_seen bigint;
  expected_mandatory text[];
  sealed_frontier jsonb;
  addressed_peer_hash text;
begin
  if p_signature_verified is distinct from true then raise exception 'a2_signature_not_verified_by_ingress'; end if;
  allowed:=p_event_type in ('PLAN','HYPOTHESIS','CLAIM','COUNTERCLAIM','QUESTION','EVIDENCE','ASSUMPTION','FALSIFIER','CRITIQUE','AGREEMENT','SYNTHESIS','ACTION_PROPOSAL','REQUEST_DUEL','MODEL_STARTED','MODEL_COMPLETED','MODEL_INTERRUPTED','PEER_EVENT_APPLIED','TOOL_CALL','TOOL_RESULT','TOOL_ERROR','FILE_READ','PATCH_CREATED','TEST_STARTED','TEST_RESULT','AUTHORITY_READ','AUTHORITY_DRIFT','BACKPRESSURE','CATCH_UP_STARTED','CATCH_UP_COMPLETED','CHECKPOINT','ERROR','DUEL_OPENED','DUEL_DECIDED');
  if not allowed then raise exception 'a2_event_type_invalid:%',p_event_type; end if;
  model_authored:=p_event_type in ('PLAN','HYPOTHESIS','CLAIM','COUNTERCLAIM','QUESTION','EVIDENCE','ASSUMPTION','FALSIFIER','CRITIQUE','AGREEMENT','SYNTHESIS','ACTION_PROPOSAL','REQUEST_DUEL');

  select * into s from destruktion_meta.compute_fabric_a2_peer_session_h205f22 where session_id=p_session_id and status='ACTIVE';
  if not found then raise exception 'a2_session_not_active'; end if;
  perform pg_advisory_xact_lock(hashtextextended(s.workspace_id::text,205022));
  select mode into workspace_mode from destruktion_meta.compute_fabric_a2_workspace_h205f22 where workspace_id=s.workspace_id;
  if workspace_mode is null then raise exception 'a2_workspace_not_found'; end if;
  if model_authored and workspace_mode<>'COLLABORATE' then raise exception 'a2_model_event_workspace_not_collaborating:%',workspace_mode; end if;

  if p_signature_key_fingerprint_sha256<>s.key_fingerprint_sha256 then raise exception 'a2_signature_key_mismatch'; end if;
  requested:=coalesce(p_model_provenance->>'requested_model','');
  reported:=coalesce(p_model_provenance->>'reported_model','');
  if requested<>'' and requested<>s.requested_model then raise exception 'a2_requested_model_provenance_mismatch'; end if;
  if reported<>'' and reported<>s.requested_model then raise exception 'a2_reported_model_provenance_mismatch'; end if;
  begin sig_bytes:=decode(p_signature_base64,'base64'); exception when others then raise exception 'a2_signature_base64_invalid'; end;
  if octet_length(sig_bytes)<>64 then raise exception 'a2_ed25519_signature_length_invalid'; end if;

  prep:=public.h205f22_a2_prepare_event_v1(p_event_id,p_session_id,p_agent_seq,p_semantic_point,p_event_type,p_priority,p_parent_hashes,p_payload,p_visibility_proof_id,p_model_provenance);
  if prep->>'event_hash'<>p_event_hash then raise exception 'a2_event_hash_mismatch'; end if;
  if model_authored and p_visibility_proof_id is null then raise exception 'a2_model_event_visibility_proof_required'; end if;
  if model_authored then
    begin v_round_id:=(p_payload->>'sync_round_id')::uuid; v_round_seq:=(p_payload->>'sync_round_seq')::bigint;
    exception when others then raise exception 'a2_model_event_sync_round_required'; end;
    select * into r from destruktion_meta.compute_fabric_a2_sync_round_h205f22 sr
    where sr.round_id=v_round_id and sr.workspace_id=s.workspace_id for update;
    if not found then raise exception 'a2_sync_round_not_found'; end if;
    if r.status<>'OPEN' then raise exception 'a2_sync_round_not_open:%',r.status; end if;
    if r.round_seq<>v_round_seq or r.semantic_point<>p_semantic_point then raise exception 'a2_sync_round_binding_mismatch'; end if;
    if r.gpt_session_id is null or r.glm_session_id is null then raise exception 'a2_sync_round_participants_not_ready'; end if;
    if r.expires_at is null or r.expires_at<=clock_timestamp() then raise exception 'a2_sync_round_expired'; end if;
    if p_priority<>2 then raise exception 'a2_sync_round_model_priority_must_be_p2'; end if;
    if r.deliberation_phase='PROPOSE' and p_event_type not in ('PLAN','HYPOTHESIS','CLAIM','EVIDENCE','ASSUMPTION','ACTION_PROPOSAL') then
      raise exception 'a2_deliberation_phase_event_invalid:PROPOSE:%',p_event_type;
    elsif r.deliberation_phase='CHALLENGE' and p_event_type not in ('COUNTERCLAIM','QUESTION','EVIDENCE','FALSIFIER','CRITIQUE','REQUEST_DUEL') then
      raise exception 'a2_deliberation_phase_event_invalid:CHALLENGE:%',p_event_type;
    elsif r.deliberation_phase='DECIDE' and p_event_type not in ('ACTION_PROPOSAL','REQUEST_DUEL') then
      raise exception 'a2_deliberation_phase_event_invalid:DECIDE:%',p_event_type;
    end if;
    if r.deliberation_phase='CHALLENGE' then
      addressed_peer_hash:=nullif(btrim(coalesce(p_payload->>'peer_event_hash_addressed','')),'');
      if addressed_peer_hash is null or not exists(
        select 1 from destruktion_meta.compute_fabric_a2_agent_event_h205f22 challenged
        where challenged.workspace_id=s.workspace_id and challenged.agent<>s.agent
          and challenged.event_hash=addressed_peer_hash and challenged.commit_seq<=r.base_commit_seq
          and challenged.event_type in ('PLAN','HYPOTHESIS','CLAIM','COUNTERCLAIM','QUESTION','EVIDENCE','ASSUMPTION','FALSIFIER','CRITIQUE','AGREEMENT','SYNTHESIS','ACTION_PROPOSAL','REQUEST_DUEL')
      ) then raise exception 'a2_challenge_peer_event_binding_invalid'; end if;
    end if;
    if r.deliberation_phase='DECIDE' and p_event_type='ACTION_PROPOSAL'
      and nullif(btrim(coalesce(p_payload->'proposed_action'->>'kind','')),'') is null then
      raise exception 'a2_decide_action_kind_required';
    end if;
    if (s.agent='GPT' and (r.gpt_session_id<>s.session_id or r.gpt_event_id is not null))
      or (s.agent='GLM' and (r.glm_session_id<>s.session_id or r.glm_event_id is not null)) then
      raise exception 'a2_sync_round_agent_slot_invalid';
    end if;
    select * into v from destruktion_meta.compute_fabric_a2_visibility_proof_h205f22
    where proof_id=p_visibility_proof_id and session_id=p_session_id and accepted_event_id is null for update;
    if not found then raise exception 'a2_visibility_proof_already_used_or_invalid'; end if;
    if v.seen_commit_seq<>r.base_commit_seq or v.seen_gpt_seq<>r.base_gpt_seq or v.seen_glm_seq<>r.base_glm_seq then
      raise exception 'a2_sync_round_visibility_frontier_mismatch';
    end if;
    select coalesce(max(p.seen_commit_seq),0) into prior_seen
    from destruktion_meta.compute_fabric_a2_visibility_proof_h205f22 p
    where p.workspace_id=s.workspace_id and p.agent=s.agent and p.accepted_event_id is not null;
    select coalesce(array_agg(x.event_hash order by x.event_hash),'{}'::text[]) into expected_mandatory
    from destruktion_meta.compute_fabric_a2_agent_event_h205f22 x
    where x.workspace_id=s.workspace_id and x.agent<>s.agent and x.priority<=1
      and x.commit_seq>prior_seen and x.commit_seq<=r.base_commit_seq;
    if v.mandatory_peer_event_hashes<>expected_mandatory then raise exception 'a2_sync_round_mandatory_visibility_mismatch'; end if;
    if exists(select 1 from destruktion_meta.compute_fabric_a2_agent_event_h205f22 x
      where x.workspace_id=s.workspace_id and x.agent<>s.agent and x.priority<=1 and x.commit_seq>r.base_commit_seq) then
      raise exception 'a2_model_event_stale_frontier';
    end if;
  end if;

  perform set_config('metaengine.a2_rpc','on',true);
  insert into destruktion_meta.compute_fabric_a2_agent_event_h205f22(
    event_id,workspace_id,session_id,agent,agent_seq,semantic_point,event_type,priority,parent_hashes,payload,payload_sha256,event_hash,signature_base64,signature_key_fingerprint_sha256,signature_verification_mode,visibility_proof_id,model_provenance
  ) values(
    p_event_id,s.workspace_id,s.session_id,s.agent,p_agent_seq,p_semantic_point,p_event_type,p_priority,coalesce(p_parent_hashes,'{}'::text[]),coalesce(p_payload,'{}'::jsonb),prep->>'payload_sha256',p_event_hash,p_signature_base64,p_signature_key_fingerprint_sha256,'TRUSTED_INGRESS_ED25519_V1',p_visibility_proof_id,coalesce(p_model_provenance,'{}'::jsonb)
  ) returning * into e;
  if model_authored then
    update destruktion_meta.compute_fabric_a2_visibility_proof_h205f22 set accepted_event_id=e.event_id where proof_id=p_visibility_proof_id;
    if s.agent='GPT' then
      update destruktion_meta.compute_fabric_a2_sync_round_h205f22 set gpt_event_id=e.event_id,gpt_event_hash=e.event_hash where round_id=r.round_id returning * into r;
    else
      update destruktion_meta.compute_fabric_a2_sync_round_h205f22 set glm_event_id=e.event_id,glm_event_hash=e.event_hash where round_id=r.round_id returning * into r;
    end if;
    if r.gpt_event_id is not null and r.glm_event_id is not null then
      sealed_frontier:=public.h205f22_a2_read_frontier_v1(s.workspace_id);
      update destruktion_meta.compute_fabric_a2_sync_round_h205f22
      set status='SEALED',sealed_at=clock_timestamp(),sealed_commit_seq=(sealed_frontier->>'head_commit_seq')::bigint,
        sealed_frontier_hash=sealed_frontier->>'frontier_hash'
      where round_id=r.round_id returning * into r;
    end if;
  end if;
  update destruktion_meta.compute_fabric_a2_peer_session_h205f22 set last_seen_at=clock_timestamp() where session_id=p_session_id;
  return jsonb_build_object('schema','metaengine.compute.a2-agent-event.v1','event_id',e.event_id,'commit_seq',e.commit_seq,
    'workspace_id',e.workspace_id,'agent',e.agent,'agent_seq',e.agent_seq,'event_type',e.event_type,'priority',e.priority,
    'event_hash',e.event_hash,'visibility_proof_id',e.visibility_proof_id,'sync_round_id',case when model_authored then r.round_id else null end,
    'sync_round_seq',case when model_authored then r.round_seq else null end,'deliberation_phase',case when model_authored then r.deliberation_phase else null end,'sync_round_status',case when model_authored then r.status else null end,
    'canonical',false,'authority_effect',false);
end $$;

revoke all on function public.h205f22_a2_join_sync_round_v1(uuid,integer) from public,anon,authenticated;
revoke all on function public.h205f22_a2_abandon_sync_round_v1(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.h205f22_a2_read_sync_state_v1(uuid) from public,anon,authenticated;
grant execute on function public.h205f22_a2_join_sync_round_v1(uuid,integer) to service_role,a2_peer_runtime;
grant execute on function public.h205f22_a2_abandon_sync_round_v1(uuid,uuid,text) to service_role,a2_peer_runtime;
grant execute on function public.h205f22_a2_read_sync_state_v1(uuid) to service_role,a2_peer_runtime;

comment on table destruktion_meta.compute_fabric_a2_sync_round_h205f22 is
  'Non-authority two-peer bulk-synchronous A2 rounds; one exact-model result per peer from one immutable base frontier.';
