-- H205F22 evidence freshness seal gate v1
-- Security/correctness fix: an EVIDENCE_READY milestone must not be sealable
-- after its claim lease or live/provider evidence has expired.

create or replace function destruktion_meta.compute_fabric_evidence_is_fresh_h205f22(
  p_evidence jsonb,
  p_claim_expires_at timestamptz
) returns boolean
language plpgsql
stable
set search_path='pg_catalog','destruktion_meta'
as $f$
declare
  v_live boolean := false;
  v_expiry_text text;
  v_evidence_expires_at timestamptz;
begin
  if p_claim_expires_at is null or p_claim_expires_at <= now() then
    return false;
  end if;

  begin
    v_live := coalesce((coalesce(p_evidence,'{}'::jsonb)->>'live')::boolean,false);
  exception when others then
    return false;
  end;

  v_expiry_text := nullif(btrim(coalesce(coalesce(p_evidence,'{}'::jsonb)->>'evidence_expires_at','')),'');

  if v_live and v_expiry_text is null then
    return false;
  end if;

  if v_expiry_text is not null then
    begin
      v_evidence_expires_at := v_expiry_text::timestamptz;
    exception when others then
      return false;
    end;

    if v_evidence_expires_at <= now() then
      return false;
    end if;
  end if;

  return true;
end $f$;

create or replace function destruktion_meta.compute_fabric_evidence_freshness_status_h205f22()
returns jsonb
language sql
stable
set search_path='pg_catalog','destruktion_meta'
as $f$
  with current_roadmap as (
    select roadmap_id
    from destruktion_meta.compute_fabric_roadmap_release_h205f22
    where is_current
    order by version desc
    limit 1
  ), stale as (
    select
      c.claim_id,
      c.milestone_key,
      c.holder_id,
      c.expires_at as claim_expires_at,
      nullif(btrim(coalesce(c.evidence->>'evidence_expires_at','')),'') as evidence_expires_at,
      coalesce(c.evidence->>'live','false') as live
    from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c
    join current_roadmap r on r.roadmap_id=c.roadmap_id
    where c.state='EVIDENCE_READY'
      and not destruktion_meta.compute_fabric_evidence_is_fresh_h205f22(c.evidence,c.expires_at)
  )
  select jsonb_build_object(
    'schema','metaengine.compute.evidence-freshness.h205f22.v1',
    'checked_at',now(),
    'stale_count',count(*),
    'stale_evidence_ready_claims',coalesce(
      jsonb_agg(
        jsonb_build_object(
          'claim_id',claim_id,
          'milestone_key',milestone_key,
          'holder_id',holder_id,
          'claim_expires_at',claim_expires_at,
          'evidence_expires_at',evidence_expires_at,
          'live',live
        ) order by claim_id
      ) filter (where claim_id is not null),
      '[]'::jsonb
    )
  )
  from stale
$f$;

create or replace function destruktion_meta.compute_fabric_verify_roadmap_milestone_h205f22(
  p_milestone_key text,
  p_checkpoint_id text,
  p_summary jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
set search_path='pg_catalog','destruktion_meta','extensions'
as $f$
declare
  v_roadmap_id text;
  v_head text;
  v_m destruktion_meta.compute_fabric_roadmap_milestone_h205f22%rowtype;
  v_claim destruktion_meta.compute_fabric_roadmap_work_claim_h205f22%rowtype;
  v_receipt_id bigint;
  v_alignment jsonb;
  v_evidence_expires_at text;
begin
  select roadmap_id into v_roadmap_id
  from destruktion_meta.compute_fabric_roadmap_release_h205f22
  where is_current
  order by version desc
  limit 1;

  select checkpoint_id into v_head
  from destruktion_meta.chat_capsule_checkpoint
  order by created_at desc
  limit 1;

  if v_head is distinct from p_checkpoint_id then
    raise exception 'verification checkpoint must be current semantic head %, got %',v_head,p_checkpoint_id;
  end if;

  v_alignment := destruktion_meta.compute_fabric_roadmap_alignment_status_h205f22();
  if coalesce((v_alignment->>'canonical_integrity')::boolean,false) is not true
     or coalesce((v_alignment->>'level2_definition_integrity')::boolean,false) is not true
     or coalesce((v_alignment->>'drift_detected')::boolean,true) is true then
    raise exception 'canonical roadmap alignment is not sealable: %',v_alignment;
  end if;

  select * into v_m
  from destruktion_meta.compute_fabric_roadmap_milestone_h205f22
  where roadmap_id=v_roadmap_id and milestone_key=p_milestone_key
  for update;

  if not found then
    raise exception 'unknown milestone %',p_milestone_key;
  end if;

  if v_m.status<>'EVIDENCE_READY' then
    raise exception 'milestone % must be EVIDENCE_READY before verification; got %',p_milestone_key,v_m.status;
  end if;

  select * into v_claim
  from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22
  where roadmap_id=v_roadmap_id
    and milestone_key=p_milestone_key
    and state='EVIDENCE_READY'
  order by claim_id desc
  limit 1
  for update;

  if not found then
    raise exception 'milestone % has no EVIDENCE_READY work claim to seal',p_milestone_key;
  end if;

  if not destruktion_meta.compute_fabric_evidence_is_fresh_h205f22(v_claim.evidence,v_claim.expires_at) then
    raise exception 'milestone % evidence is stale or malformed for claim %; revalidate before seal',p_milestone_key,v_claim.claim_id;
  end if;

  v_evidence_expires_at := nullif(btrim(coalesce(v_claim.evidence->>'evidence_expires_at','')),'');

  update destruktion_meta.compute_fabric_roadmap_milestone_h205f22
  set status='VERIFIED',verified_checkpoint_id=p_checkpoint_id,updated_at=now()
  where roadmap_id=v_roadmap_id and milestone_key=p_milestone_key;

  update destruktion_meta.compute_fabric_roadmap_work_claim_h205f22
  set state='MERGED',result_checkpoint_id=p_checkpoint_id
  where claim_id=v_claim.claim_id;

  insert into destruktion_meta.compute_fabric_roadmap_step_receipt_h205f22(
    roadmap_id,milestone_key,step_kind,status,result_checkpoint_id,summary
  ) values(
    v_roadmap_id,
    p_milestone_key,
    'MAINLINE_SEAL',
    'VERIFIED',
    p_checkpoint_id,
    coalesce(p_summary,'{}'::jsonb) || jsonb_build_object(
      'evidence_claim_id',v_claim.claim_id,
      'evidence_freshness_checked_at',now(),
      'evidence_expires_at',v_evidence_expires_at,
      'canonical_digest',v_alignment->>'canonical_digest'
    )
  ) returning receipt_id into v_receipt_id;

  return jsonb_build_object(
    'receipt_id',v_receipt_id,
    'roadmap_id',v_roadmap_id,
    'milestone_key',p_milestone_key,
    'status','VERIFIED',
    'verified_checkpoint_id',p_checkpoint_id,
    'evidence_claim_id',v_claim.claim_id,
    'evidence_freshness_checked',true
  );
end $f$;

create or replace function destruktion_meta.compute_fabric_supervisor_snapshot_h205f22_v2()
returns jsonb
language sql
stable
set search_path='pg_catalog','destruktion_meta','extensions'
as $f$
  select destruktion_meta.compute_fabric_supervisor_snapshot_h205f22()
    || jsonb_build_object(
      'schema','metaengine.compute.fabric-supervisor-snapshot.h205f22.v2',
      'canonical_alignment',destruktion_meta.compute_fabric_roadmap_alignment_status_h205f22(),
      'current_level1_focus',destruktion_meta.compute_fabric_roadmap_alignment_status_h205f22()->'current_canonical_focus',
      'evidence_freshness',destruktion_meta.compute_fabric_evidence_freshness_status_h205f22()
    )
$f$;

-- Repair only the currently observed stale F1 evidence-ready state. The old
-- evidence remains in append-only receipts; the active claim is reopened so
-- the worker must revalidate and finish again before mainline seal.
with stale_f1 as (
  select claim_id,roadmap_id,milestone_key,expires_at
  from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22
  where milestone_key='F1_LIVE_EXTERNAL_FEDERATION'
    and state='EVIDENCE_READY'
    and not destruktion_meta.compute_fabric_evidence_is_fresh_h205f22(evidence,expires_at)
  order by claim_id desc
  limit 1
), reopened as (
  update destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c
  set state=case when c.expires_at>now() then 'ACTIVE' else 'EXPIRED' end
  from stale_f1 s
  where c.claim_id=s.claim_id
  returning c.roadmap_id,c.milestone_key,c.state
)
update destruktion_meta.compute_fabric_roadmap_milestone_h205f22 m
set status=case when r.state='ACTIVE' then 'IN_PROGRESS' else 'PLANNED' end,
    updated_at=now()
from reopened r
where m.roadmap_id=r.roadmap_id and m.milestone_key=r.milestone_key;

revoke all on function destruktion_meta.compute_fabric_evidence_is_fresh_h205f22(jsonb,timestamptz) from public,anon,authenticated;
revoke all on function destruktion_meta.compute_fabric_evidence_freshness_status_h205f22() from public,anon,authenticated;
grant execute on function destruktion_meta.compute_fabric_evidence_is_fresh_h205f22(jsonb,timestamptz) to service_role;
grant execute on function destruktion_meta.compute_fabric_evidence_freshness_status_h205f22() to service_role;
