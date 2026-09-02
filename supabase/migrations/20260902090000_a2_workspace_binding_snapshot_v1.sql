-- METAENGINE Browser Typed Workspaces V1: read-only durable Workspace Binding projection.
-- Branch-local migration only. Do not apply to production from this development task.
--
-- This projection deliberately excludes repo_root, managed_root, worktree_path and
-- worktree_realpath. Browser chrome needs typed identity/fencing evidence, not host
-- filesystem topology. It has no scheduler, Browser actuation, retry or mutation authority.

create or replace function public.h205f22_a2_workspace_binding_snapshot_v1(
  p_coordination_workspace_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_coordination_workspace_id is null then
    raise exception 'workspace_binding_snapshot_workspace_required';
  end if;

  select coalesce(jsonb_agg(row_json order by updated_at desc, workspace_id, workspace_generation), '[]'::jsonb)
    into v_rows
    from (
      select
        b.updated_at,
        b.workspace_id,
        b.workspace_generation,
        jsonb_build_object(
          'workspace_id', b.workspace_id,
          'workspace_generation', b.workspace_generation,
          'coordination_workspace_id', b.coordination_workspace_id,
          'task_id', b.task_id,
          'claim_id', b.claim_id,
          'point_id', b.point_id,
          'repo_id', b.repo_id,
          'base_sha', b.base_sha,
          'branch_name', b.branch_name,
          'agent_id', b.agent_id,
          'tab_id', b.tab_id,
          'target_id', b.target_id,
          'agent_generation_epoch', b.agent_generation_epoch,
          'lease_generation', b.lease_generation,
          'lease_expires_at', b.lease_expires_at,
          'lease_current', b.lease_expires_at > v_now,
          'state', b.state,
          'last_verified_head_sha', b.last_verified_head_sha,
          'ambiguity_code', b.ambiguity_code,
          'dirty_hold', b.dirty_hold,
          'updated_at', b.updated_at,
          'automatic_retry_allowed', false,
          'scheduler_authority', false,
          'browser_actuation_authority', false,
          'page_data_authority', false,
          'authority_effect', false
        ) as row_json
      from public.compute_fabric_a2_workspace_binding_h205f22 b
      where b.coordination_workspace_id = p_coordination_workspace_id
        and b.retired_at is null
      order by b.updated_at desc, b.workspace_id, b.workspace_generation
      limit 64
    ) q;

  return jsonb_build_object(
    'schema', 'metaengine.devos.workspace-binding-snapshot.v1',
    'state', 'AVAILABLE',
    'coordination_workspace_id', p_coordination_workspace_id,
    'observed_at', v_now,
    'bindings', v_rows,
    'bounded_rows', 64,
    'filesystem_paths_exposed', false,
    'scheduler_authority', false,
    'browser_actuation_authority', false,
    'automatic_retry_allowed', false,
    'authority_effect', false
  );
end;
$$;

revoke all on function public.h205f22_a2_workspace_binding_snapshot_v1(uuid) from public, anon, authenticated;
grant execute on function public.h205f22_a2_workspace_binding_snapshot_v1(uuid) to service_role;
