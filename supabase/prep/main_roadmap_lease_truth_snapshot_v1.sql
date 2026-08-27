-- PREP / READ-ONLY SNAPSHOT. No DDL, DML, provider, Edge, or authority effect.
-- Capture roadmap, durable Level-2 -> Level-1 mapping, and raw lease rows at one
-- PostgreSQL statement timestamp so TTL decisions share one observation instant.
with
obs as (
  select statement_timestamp() as observed_at
),
l2 as (
  select destruktion_meta.compute_fabric_roadmap_status_h205f22() as value
),
align as (
  select destruktion_meta.compute_fabric_roadmap_alignment_status_h205f22() as value
),
sup as (
  select destruktion_meta.compute_fabric_supervisor_snapshot_h205f22_v2() as value
),
mappings as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'milestone_key', milestone_key,
        'canonical_milestone_key', canonical_milestone_key,
        'mapping_kind', mapping_kind
      )
      order by milestone_key
    ),
    '[]'::jsonb
  ) as value
  from destruktion_meta.compute_fabric_level2_canonical_mapping_h205f22
  where roadmap_id = 'compute-fabric-roadmap-v1'
),
claims as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'claim_id', claim_id,
        'milestone_key', milestone_key,
        'holder_id', holder_id,
        'state', state,
        'heartbeat_at', heartbeat_at,
        'expires_at', expires_at
      )
      order by claim_id
    ),
    '[]'::jsonb
  ) as value
  from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22
  where roadmap_id = 'compute-fabric-roadmap-v1'
    and state = 'ACTIVE'
),
directives as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'directive_id', directive_id,
        'milestone_key', milestone_key,
        'directive_kind', directive_kind,
        'target_holder_id', target_holder_id,
        'status', status,
        'created_at', created_at,
        'expires_at', expires_at
      )
      order by directive_id
    ),
    '[]'::jsonb
  ) as value
  from destruktion_meta.compute_fabric_supervisor_directive_h205f22
  where roadmap_id = 'compute-fabric-roadmap-v1'
    and status = 'ACTIVE'
)
select jsonb_build_object(
  'schema', 'metaengine.compute.main-roadmap-lease-truth-snapshot.h205f22.v1',
  'observed_at', (select observed_at from obs),
  'roadmap_id', 'compute-fabric-roadmap-v1',
  'roadmap_status', (select value from l2),
  'alignment_status', (select value from align),
  'supervisor_snapshot', (select value from sup),
  'level2_mapping', (select value from mappings),
  'active_claim_rows', (select value from claims),
  'active_directive_rows', (select value from directives)
) as snapshot;
