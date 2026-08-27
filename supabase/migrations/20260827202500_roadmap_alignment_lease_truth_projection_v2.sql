-- ROADMAP_ALIGNMENT_LEASE_TRUTH_PROJECTION_V2
-- Compatibility-preserving read-path hardening.
-- The legacy implementation is retained for forensic/readback purposes while
-- the canonical function name becomes a lease-aware wrapper.

alter function destruktion_meta.compute_fabric_roadmap_alignment_status_h205f22()
  rename to compute_fabric_roadmap_alignment_status_h205f22_legacy_v1;

create or replace function destruktion_meta.compute_fabric_roadmap_alignment_status_h205f22()
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'pg_catalog', 'destruktion_meta', 'extensions'
as $function$
declare
  v_base jsonb;
  v_l2 jsonb;
  v_roadmap_id text;
  v_observed_at timestamptz := statement_timestamp();
  v_active jsonb := '[]'::jsonb;
  v_stale jsonb := '[]'::jsonb;
  v_spine jsonb := '[]'::jsonb;
  v_focus jsonb := '{}'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_fresh_unmapped boolean := false;
begin
  v_base := destruktion_meta.compute_fabric_roadmap_alignment_status_h205f22_legacy_v1();
  v_l2 := destruktion_meta.compute_fabric_roadmap_status_h205f22();
  v_roadmap_id := v_l2->>'roadmap_id';

  -- Fresh authority is lease truth, not the persisted ACTIVE label alone.
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'claim_id', c.claim_id,
          'milestone_key', c.milestone_key,
          'canonical_milestone_key', x.canonical_milestone_key,
          'mapping_kind', x.mapping_kind,
          'aligned', (x.milestone_key is not null and coalesce((v_base->>'canonical_integrity')::boolean,false)),
          'holder_id', c.holder_id,
          'heartbeat_at', c.heartbeat_at,
          'expires_at', c.expires_at,
          'lease_fence', c.claim_id
        )
        order by c.claim_id
      ),
      '[]'::jsonb
    ),
    coalesce(bool_or(x.milestone_key is null), false)
  into v_active, v_fresh_unmapped
  from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c
  left join destruktion_meta.compute_fabric_level2_canonical_mapping_h205f22 x
    on x.roadmap_id = c.roadmap_id
   and x.milestone_key = c.milestone_key
   and x.canonical_roadmap_key = v_base#>>'{canonical_roadmap,roadmap_key}'
  where c.roadmap_id = v_roadmap_id
    and c.state = 'ACTIVE'
    and c.expires_at > v_observed_at
    and c.heartbeat_at <= v_observed_at
    and c.heartbeat_at < c.expires_at;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'claim_id', c.claim_id,
        'milestone_key', c.milestone_key,
        'holder_id', c.holder_id,
        'heartbeat_at', c.heartbeat_at,
        'expires_at', c.expires_at,
        'persisted_state', c.state,
        'lease_fence', c.claim_id,
        'reason', case
          when c.expires_at <= v_observed_at then 'EXPIRED'
          when c.heartbeat_at > v_observed_at then 'FUTURE_HEARTBEAT'
          when c.heartbeat_at >= c.expires_at then 'INVALID_HEARTBEAT_EXPIRY_ORDER'
          else 'INVALID_ACTIVE_LEASE'
        end
      )
      order by c.claim_id
    ),
    '[]'::jsonb
  ) into v_stale
  from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c
  where c.roadmap_id = v_roadmap_id
    and c.state = 'ACTIVE'
    and not (
      c.expires_at > v_observed_at
      and c.heartbeat_at <= v_observed_at
      and c.heartbeat_at < c.expires_at
    );

  -- Canonical progress is effective progress. A raw IN_PROGRESS milestone is
  -- projected as PLANNED when no fresh lease currently owns that Level-2 work.
  with effective_milestone as (
    select
      m.roadmap_id,
      m.milestone_key,
      case
        when m.status = 'IN_PROGRESS' and not exists (
          select 1
          from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c
          where c.roadmap_id = m.roadmap_id
            and c.milestone_key = m.milestone_key
            and c.state = 'ACTIVE'
            and c.expires_at > v_observed_at
            and c.heartbeat_at <= v_observed_at
            and c.heartbeat_at < c.expires_at
        ) then 'PLANNED'
        else m.status
      end as effective_status
    from destruktion_meta.compute_fabric_roadmap_milestone_h205f22 m
    where m.roadmap_id = v_roadmap_id
  ), s as (
    select
      cm.ordinal,
      cm.canonical_milestone_key,
      cm.title,
      case
        when count(x.milestone_key) = 0 then 'NO_LEVEL2_MAPPING'
        when bool_and(em.effective_status = 'VERIFIED') then 'VERIFIED'
        when bool_or(em.effective_status = 'EVIDENCE_READY') then 'EVIDENCE_READY'
        when bool_or(em.effective_status = 'IN_PROGRESS') then 'IN_PROGRESS'
        when bool_or(em.effective_status = 'VERIFIED') then 'PARTIAL'
        when bool_or(em.effective_status = 'BLOCKED') then 'BLOCKED'
        else 'PLANNED'
      end as state
    from destruktion_meta.compute_fabric_canonical_milestone_h205f22 cm
    left join destruktion_meta.compute_fabric_level2_canonical_mapping_h205f22 x
      on x.canonical_roadmap_key = cm.roadmap_key
     and x.canonical_milestone_key = cm.canonical_milestone_key
     and x.roadmap_id = v_roadmap_id
    left join effective_milestone em
      on em.roadmap_id = x.roadmap_id
     and em.milestone_key = x.milestone_key
    where cm.roadmap_key = v_base#>>'{canonical_roadmap,roadmap_key}'
    group by cm.ordinal, cm.canonical_milestone_key, cm.title
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ordinal', ordinal,
        'canonical_milestone_key', canonical_milestone_key,
        'title', title,
        'progress_state', state
      )
      order by ordinal
    ),
    '[]'::jsonb
  ) into v_spine
  from s;

  with s as (
    select
      (e->>'ordinal')::integer as ordinal,
      e->>'canonical_milestone_key' as canonical_milestone_key,
      e->>'progress_state' as state
    from jsonb_array_elements(v_spine) e
  )
  select jsonb_build_object(
    'foundation', (
      select jsonb_build_object('canonical_milestone_key','R1','progress_state',state)
      from s where canonical_milestone_key='R1'
    ),
    'execution', (
      select jsonb_build_object('canonical_milestone_key',canonical_milestone_key,'progress_state',state)
      from s
      where canonical_milestone_key ~ '^C[0-9]+$'
        and state <> 'VERIFIED'
      order by ordinal
      limit 1
    ),
    'parallel_federation', (
      select jsonb_build_object('canonical_milestone_key','F1+','progress_state',state)
      from s where canonical_milestone_key='F1+'
    )
  ) into v_focus;

  -- Preserve all legacy drift reasons except ACTIVE_CLAIM_UNMAPPED, which is
  -- recomputed from fresh authority only.
  select coalesce(jsonb_agg(to_jsonb(reason) order by reason), '[]'::jsonb)
    into v_reasons
  from (
    select distinct value #>> '{}' as reason
    from jsonb_array_elements(coalesce(v_base->'drift_reasons','[]'::jsonb))
    where value #>> '{}' <> 'ACTIVE_CLAIM_UNMAPPED'
    union all
    select 'ACTIVE_CLAIM_UNMAPPED'
    where v_fresh_unmapped
  ) q;

  return v_base || jsonb_build_object(
    'active_claim_alignment', v_active,
    'critical_spine_status', v_spine,
    'current_canonical_focus', v_focus,
    'drift_reasons', v_reasons,
    'drift_detected', jsonb_array_length(v_reasons) > 0,
    'lease_truth', jsonb_build_object(
      'version', 2,
      'observed_at', v_observed_at,
      'fresh_active_claim_count', jsonb_array_length(v_active),
      'stale_persisted_active_claim_count', jsonb_array_length(v_stale),
      'stale_persisted_active_claims', v_stale,
      'cleanup_required', jsonb_array_length(v_stale) > 0,
      'stale_rows_authority_effect', false,
      'lease_fence_kind', 'CLAIM_ID_MONOTONIC_SEQUENCER'
    )
  );
end
$function$;

revoke all on function destruktion_meta.compute_fabric_roadmap_alignment_status_h205f22() from public;
grant execute on function destruktion_meta.compute_fabric_roadmap_alignment_status_h205f22() to service_role;

-- Preserve the prior ACL on the legacy forensic readback as well.
revoke all on function destruktion_meta.compute_fabric_roadmap_alignment_status_h205f22_legacy_v1() from public;
grant execute on function destruktion_meta.compute_fabric_roadmap_alignment_status_h205f22_legacy_v1() to service_role;
