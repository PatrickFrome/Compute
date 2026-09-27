begin;

create or replace function public.devos_recovery_debt_pressure_v1(p_workspace uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, destruktion_meta
as $function$
with ambiguous as (
  select t.task_id, t.lease_generation, t.updated_at
  from destruktion_meta.devos_fleet_task_h205f22 t
  where t.workspace_id = p_workspace
    and t.state = 'AMBIGUOUS'
), classified as (
  select
    a.task_id,
    a.lease_generation,
    a.updated_at,
    exists (
      select 1
      from destruktion_meta.devos_fleet_event_h205f22 e
      where e.workspace_id = p_workspace
        and e.task_id = a.task_id
        and e.lease_generation = a.lease_generation
        and e.event_type = 'TASK_TRANSPORT_PROVEN'
        and coalesce(e.payload->>'prompt_sha256','') ~ '^[0-9a-f]{64}$'
        and coalesce(e.payload->>'conversation_url_sha256','') ~ '^[0-9a-f]{64}$'
        and coalesce(e.payload->>'effect_state','') in (
          'PROVEN_GENERATING',
          'PROVEN_NEW_CONVERSATION',
          'PROVEN_CONVERSATION'
        )
    ) as effect_proven
  from ambiguous a
), summary as (
  select
    count(*)::bigint as ambiguous_total,
    count(*) filter (where effect_proven)::bigint as effect_proven_count,
    count(*) filter (where not effect_proven)::bigint as effect_unknown_count,
    count(*) filter (
      where not effect_proven
        and updated_at >= now() - interval '15 minutes'
    )::bigint as effect_unknown_last_15m,
    count(*) filter (
      where not effect_proven
        and updated_at >= now() - interval '60 minutes'
    )::bigint as effect_unknown_last_60m,
    coalesce(
      floor(extract(epoch from (now() - min(updated_at) filter (where not effect_proven))))::bigint,
      0::bigint
    ) as oldest_effect_unknown_age_seconds
  from classified
)
select jsonb_build_object(
  'schema', 'metaengine.devos.recovery-debt-pressure.v1',
  'workspace_id', p_workspace,
  'observed_at', now(),
  'state', case when summary.effect_unknown_count = 0 then 'CLEAR' else 'EFFECT_UNKNOWN_PRESENT' end,
  'ambiguous_total', summary.ambiguous_total,
  'effect_proven_count', summary.effect_proven_count,
  'effect_unknown_count', summary.effect_unknown_count,
  'effect_unknown_last_15m', summary.effect_unknown_last_15m,
  'effect_unknown_last_60m', summary.effect_unknown_last_60m,
  'oldest_effect_unknown_age_seconds', greatest(0::bigint, summary.oldest_effect_unknown_age_seconds),
  'task_content_returned', false,
  'physical_effect_replayed', false,
  'automatic_retry_allowed', false,
  'scheduler_authority', false,
  'browser_authority', false,
  'release_authority', false,
  'authority_effect', false
)
from summary
$function$;

revoke all on function public.devos_recovery_debt_pressure_v1(uuid) from public, anon, authenticated;
grant execute on function public.devos_recovery_debt_pressure_v1(uuid) to service_role;

comment on function public.devos_recovery_debt_pressure_v1(uuid) is
'Read-only recovery-debt age/arrival observability. Exact durable transport proof classification; no task content, retry, scheduler, browser, release, or effect authority.';

commit;
