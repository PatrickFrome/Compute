-- METAENGINE Meta-Orchestrator leader-fenced atomic frontier admission v2.
-- Branch-local migration only. Do not apply to production from this audit task.
-- Holds the controller lease row while the existing v1 all-or-none frontier transaction runs.

create or replace function public.meta_orchestrator_frontier_admit_v2(
  p_workspace_id uuid,
  p_roadmap_id text,
  p_plan_generation bigint,
  p_point_ids text[],
  p_holder_client_id text,
  p_leader_epoch bigint
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare
  v_roadmap_id text := lower(trim(coalesce(p_roadmap_id,'')));
  v_client_id text := trim(coalesce(p_holder_client_id,''));
  v_lease destruktion_meta.meta_orchestrator_controller_lease_h205f22%rowtype;
  v_result jsonb;
begin
  if p_workspace_id is null
     or v_roadmap_id !~ '^[a-z0-9][a-z0-9._:-]{2,159}$'
     or v_client_id !~ '^[A-Za-z0-9._:@/-]{3,160}$'
     or coalesce(p_leader_epoch,0) < 1 then
    raise exception 'meta_frontier_leader_binding_invalid' using errcode = '22023';
  end if;

  select * into v_lease
    from destruktion_meta.meta_orchestrator_controller_lease_h205f22
   where workspace_id = p_workspace_id and roadmap_id = v_roadmap_id
   for update;

  if not found
     or v_lease.state <> 'ACTIVE'
     or v_lease.holder_client_id <> v_client_id
     or v_lease.leader_epoch <> p_leader_epoch
     or v_lease.expires_at is null
     or v_lease.expires_at <= clock_timestamp() + interval '2 seconds' then
    raise exception 'meta_frontier_leader_fenced';
  end if;

  v_result := public.meta_orchestrator_frontier_admit_v1(
    p_workspace_id,
    v_roadmap_id,
    p_plan_generation,
    p_point_ids
  );

  if v_result->>'schema' <> 'metaengine.meta-orchestrator.frontier-admission.v1'
     or coalesce((v_result->>'atomic_transaction')::boolean,false) <> true
     or coalesce((v_result->>'authority_effect')::boolean,true) <> false then
    raise exception 'meta_frontier_v2_readback_invalid';
  end if;

  return v_result || jsonb_build_object(
    'schema','metaengine.meta-orchestrator.frontier-admission.v2',
    'leader_epoch',p_leader_epoch,
    'leader_fenced',false,
    'controller_lease_expires_at',v_lease.expires_at,
    'automatic_retry_allowed',false,
    'scheduler_authority',false,
    'browser_authority',false,
    'release_authority',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.meta_orchestrator_frontier_admit_v2(uuid,text,bigint,text[],text,bigint) from public, anon, authenticated;
grant execute on function public.meta_orchestrator_frontier_admit_v2(uuid,text,bigint,text[],text,bigint) to service_role;
