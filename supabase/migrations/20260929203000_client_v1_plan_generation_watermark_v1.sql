-- Client V1 C4.2 plan-generation watermark repair.
-- Preserve the highest durable generation even when no ACTIVE plan exists.
-- This keeps optimistic CAS fencing monotonic after a plan is retired/superseded.
--
-- No scheduler, task-content, Browser or release authority is added.

create or replace function public.meta_orchestrator_plan_snapshot_v1(
  p_workspace_id uuid,
  p_roadmap_id text
) returns jsonb
language sql
security definer
set search_path = pg_catalog, destruktion_meta, public, pg_temp
as $$
  with scoped as (
    select p.*
      from destruktion_meta.meta_orchestrator_plan_state_h205f22 p
     where p.workspace_id = p_workspace_id
       and p.roadmap_id = lower(trim(p_roadmap_id))
  ),
  watermark as (
    select coalesce(max(plan_generation), 0)::bigint as plan_generation
      from scoped
  ),
  active as (
    select p.*
      from scoped p
     where p.state = 'ACTIVE'
     order by p.plan_generation desc
     limit 1
  )
  select coalesce(
    (
      select jsonb_build_object(
        'schema','metaengine.meta-orchestrator.plan-state.v1',
        'found',true,
        'workspace_id',p.workspace_id,
        'roadmap_id',p.roadmap_id,
        'plan_generation',p.plan_generation,
        'alignment_epoch',p.alignment_epoch,
        'baseline_sha',p.baseline_sha,
        'plan_sha256',p.plan_sha256,
        'plan_spec',p.plan_spec,
        'state',p.state,
        'automatic_retry_allowed',false,
        'task_content_authority',false,
        'scheduler_authority',false,
        'browser_authority',false,
        'release_authority',false,
        'authority_effect',false
      )
        from active p
    ),
    (
      select jsonb_build_object(
        'schema','metaengine.meta-orchestrator.plan-state.v1',
        'found',false,
        'workspace_id',p_workspace_id,
        'roadmap_id',lower(trim(p_roadmap_id)),
        'plan_generation',w.plan_generation,
        'automatic_retry_allowed',false,
        'task_content_authority',false,
        'scheduler_authority',false,
        'browser_authority',false,
        'release_authority',false,
        'authority_effect',false
      )
        from watermark w
    )
  );
$$;

revoke all on function public.meta_orchestrator_plan_snapshot_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.meta_orchestrator_plan_snapshot_v1(uuid,text) to service_role;
