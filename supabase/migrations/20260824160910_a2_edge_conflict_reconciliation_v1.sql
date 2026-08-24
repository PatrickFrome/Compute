create or replace function public.h205f22_a2_reconcile_workspace_conflicts_v2(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta,public
as $$
declare
  pair record;
  c record;
  w destruktion_meta.compute_fabric_a2_workspace_h205f22%rowtype;
  f jsonb;
  d jsonb;
  duel_key text;
  duel_id uuid;
  g_kind text;
  m_kind text;
  g_hash text;
  m_hash text;
  resolution_hash text;
  dispute_count integer;
  requested boolean;
  opened_count integer:=0;
  resolved_count integer:=0;
  duel_count integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,205023));
  select * into w from destruktion_meta.compute_fabric_a2_workspace_h205f22 where workspace_id=p_workspace_id;
  if not found then raise exception 'a2_workspace_not_found'; end if;

  for pair in
    with latest as (
      select distinct on (semantic_point,agent)
        semantic_point,agent,event_hash,commit_seq,
        nullif(btrim(coalesce(payload->'proposed_action'->>'kind','')),'') action_kind
      from destruktion_meta.compute_fabric_a2_agent_event_h205f22
      where workspace_id=p_workspace_id
        and event_type in ('ACTION_PROPOSAL','CLAIM','COUNTERCLAIM')
        and nullif(btrim(coalesce(payload->'proposed_action'->>'kind','')),'') is not null
      order by semantic_point,agent,commit_seq desc
    )
    select g.semantic_point,g.event_hash gpt_hash,m.event_hash glm_hash,g.action_kind gpt_kind,m.action_kind glm_kind
    from latest g join latest m on m.semantic_point=g.semantic_point
    where g.agent='GPT' and m.agent='GLM' and g.action_kind<>m.action_kind
  loop
    perform public.h205f22_a2_open_conflict_v1(
      p_workspace_id,pair.semantic_point,pair.gpt_hash,pair.glm_hash,
      'latest_action_kind_mismatch:'||pair.gpt_kind||'!='||pair.glm_kind,'HIGH'
    );
    opened_count:=opened_count+1;
  end loop;

  for c in
    select sc.*,le.commit_seq left_seq,re.commit_seq right_seq
    from destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22 sc
    join destruktion_meta.compute_fabric_a2_agent_event_h205f22 le on le.event_hash=sc.left_event_hash
    join destruktion_meta.compute_fabric_a2_agent_event_h205f22 re on re.event_hash=sc.right_event_hash
    where sc.workspace_id=p_workspace_id and sc.status in ('OPEN','DIRECT_RESOLUTION','DUEL')
    order by sc.created_at
  loop
    if c.status='DUEL' then
      d:=public.h205f22_duel_read_same_point_v4(c.duel_id);
      if coalesce(d->>'status','')='DECIDED' then
        perform public.h205f22_a2_resolve_conflict_from_duel_v1(c.conflict_id);
        resolved_count:=resolved_count+1;
      end if;
      continue;
    end if;

    select
      max(case when x.agent='GPT' then x.action_kind end),
      max(case when x.agent='GLM' then x.action_kind end),
      max(case when x.agent='GPT' then x.event_hash end),
      max(case when x.agent='GLM' then x.event_hash end)
    into g_kind,m_kind,g_hash,m_hash
    from (
      select distinct on(agent) agent,event_hash,commit_seq,
        nullif(btrim(coalesce(payload->'proposed_action'->>'kind','')),'') action_kind
      from destruktion_meta.compute_fabric_a2_agent_event_h205f22
      where workspace_id=p_workspace_id and semantic_point=c.semantic_point
        and commit_seq>=least(c.left_seq,c.right_seq)
        and event_type in ('ACTION_PROPOSAL','CLAIM','COUNTERCLAIM')
        and nullif(btrim(coalesce(payload->'proposed_action'->>'kind','')),'') is not null
      order by agent,commit_seq desc
    ) x;

    if g_kind is not null and m_kind is not null and g_kind=m_kind then
      select event_hash into resolution_hash
      from destruktion_meta.compute_fabric_a2_agent_event_h205f22
      where workspace_id=p_workspace_id and semantic_point=c.semantic_point
        and event_hash in (g_hash,m_hash)
      order by commit_seq desc limit 1;
      perform public.h205f22_a2_resolve_conflict_v1(c.conflict_id,resolution_hash);
      resolved_count:=resolved_count+1;
      continue;
    end if;

    select count(*)::integer,coalesce(bool_or(event_type='REQUEST_DUEL'),false)
    into dispute_count,requested
    from destruktion_meta.compute_fabric_a2_agent_event_h205f22
    where workspace_id=p_workspace_id and semantic_point=c.semantic_point
      and commit_seq>=least(c.left_seq,c.right_seq)
      and event_type in ('CLAIM','COUNTERCLAIM','CRITIQUE','SYNTHESIS','ACTION_PROPOSAL','REQUEST_DUEL');

    if not requested and dispute_count<6 then continue; end if;
    f:=public.h205f22_a2_read_frontier_v1(p_workspace_id);
    duel_key:='a2-v4::'||p_workspace_id::text||'::'||c.conflict_id::text||'::'||(f->>'frontier_hash');
    d:=public.h205f22_duel_create_same_point_v4(
      duel_key,'A2_REALTIME_MULTI_AGENT_COGNITIVE_BUS',w.base_github_sha,
      jsonb_build_object(
        'mode','A2_CAUSAL_CONFLICT_V2','semantic_point',c.semantic_point,'conflict_id',c.conflict_id,
        'causal_frontier_hash',f->>'frontier_hash','left_event_hash',c.left_event_hash,'right_event_hash',c.right_event_hash,
        'debate_protocol','SAME_POINT_DUEL_V4','authority_rule','DUEL_DECISION_NONAUTHORITY_UNTIL_EXECUTOR_REVALIDATES',
        'canonical',false,'authority_effect',false
      ),
      'SOVEREIGN_ONLY','openai/gpt-5.6-sol','zai/glm-5.3'
    );
    duel_id:=(d->>'duel_id')::uuid;
    perform public.h205f22_a2_attach_duel_v1(c.conflict_id,duel_id);
    perform pg_notify('h205f22_same_point_v4_ready',jsonb_build_object('duel_id',duel_id,'source','a2-edge-reconciler','conflict_id',c.conflict_id)::text);
    duel_count:=duel_count+1;
  end loop;

  return jsonb_build_object(
    'schema','metaengine.compute.a2-conflict-reconciliation.v2','workspace_id',p_workspace_id,
    'opened_or_refreshed',opened_count,'resolved',resolved_count,'duels_opened',duel_count,
    'workspace_mode',(select mode from destruktion_meta.compute_fabric_a2_workspace_h205f22 where workspace_id=p_workspace_id),
    'canonical',false,'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_a2_reconcile_workspace_conflicts_v2(uuid) from public,anon,authenticated,a2_peer_runtime;
grant execute on function public.h205f22_a2_reconcile_workspace_conflicts_v2(uuid) to service_role;

create or replace function public.h205f22_a2_ingress_emit_edge_verified_v1(
  p_event_id uuid,
  p_session_id uuid,
  p_agent_seq bigint,
  p_semantic_point text,
  p_event_type text,
  p_priority smallint,
  p_parent_hashes text[],
  p_payload jsonb,
  p_visibility_proof_id uuid,
  p_model_provenance jsonb,
  p_event_hash text,
  p_signature_base64 text,
  p_signature_key_fingerprint_sha256 text,
  p_ed25519_verified boolean,
  p_edge_verifier_id text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta,extensions,vault,public
as $$
declare
  v_secret text;
  v_signature_sha256 text;
  v_issued timestamptz:=clock_timestamp();
  v_expires timestamptz;
  v_nonce text;
  v_preimage text;
  v_hmac text;
  v_result jsonb;
  v_workspace_id uuid;
begin
  if p_ed25519_verified is distinct from true then raise exception 'a2_edge_ed25519_verification_required'; end if;
  if p_edge_verifier_id<>'A2_EDGE_WEBCRYPTO_ED25519_V1' then raise exception 'a2_edge_verifier_invalid'; end if;
  if p_event_hash is null or p_event_hash !~ '^[0-9a-f]{64}$' then raise exception 'a2_event_hash_invalid'; end if;
  if p_signature_key_fingerprint_sha256 is null or p_signature_key_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'a2_signature_key_fingerprint_invalid'; end if;
  if p_signature_base64 is null or octet_length(decode(p_signature_base64,'base64'))<>64 then raise exception 'a2_ed25519_signature_length_invalid'; end if;

  select s.workspace_id into v_workspace_id from destruktion_meta.compute_fabric_a2_peer_session_h205f22 s
  where s.session_id=p_session_id and s.status='ACTIVE' and s.lease_expires_at>v_issued
    and s.key_fingerprint_sha256=p_signature_key_fingerprint_sha256;
  if not found then raise exception 'a2_ingress_session_not_active_or_lease_expired'; end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name='a2_ingress_hmac_v1' order by created_at desc limit 1;
  if v_secret is null or length(v_secret)<32 then raise exception 'a2_ingress_secret_unavailable'; end if;
  v_signature_sha256:=encode(extensions.digest(decode(p_signature_base64,'base64'),'sha256'),'hex');
  v_expires:=v_issued+interval '60 seconds';
  v_nonce:=encode(extensions.gen_random_bytes(24),'hex');
  v_preimage:=destruktion_meta.compute_fabric_a2_ingress_receipt_preimage_v2(p_event_hash,p_session_id,p_signature_key_fingerprint_sha256,'A2_TRUSTED_ED25519_INGRESS_V2',v_issued,v_expires,v_nonce,v_signature_sha256);
  v_hmac:=encode(extensions.hmac(convert_to(v_preimage,'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex');
  v_result:=public.h205f22_a2_emit_agent_event_v3(p_event_id,p_session_id,p_agent_seq,p_semantic_point,p_event_type,p_priority,p_parent_hashes,p_payload,p_visibility_proof_id,p_model_provenance,p_event_hash,p_signature_base64,p_signature_key_fingerprint_sha256,'A2_TRUSTED_ED25519_INGRESS_V2',v_issued,v_expires,v_nonce,v_hmac);

  if p_event_type in ('ACTION_PROPOSAL','CLAIM','COUNTERCLAIM','CRITIQUE','SYNTHESIS','REQUEST_DUEL') then
    perform public.h205f22_a2_reconcile_workspace_conflicts_v2(v_workspace_id);
  end if;
  return v_result||jsonb_build_object('edge_verifier_id',p_edge_verifier_id,'edge_ed25519_verified',true,'canonical',false,'authority_effect',false);
end $$;

comment on function public.h205f22_a2_reconcile_workspace_conflicts_v2(uuid) is
  'DB-resident non-authority A2 conflict reconciler replacing the privileged direct-DB coordinator hot path for Edge ingress.';
