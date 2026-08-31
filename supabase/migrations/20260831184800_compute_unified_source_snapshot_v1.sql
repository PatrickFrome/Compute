create or replace function public.h205f22_compute_unified_source_snapshot_v1(p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roadmap jsonb;
  v_browser jsonb;
  v_mesh jsonb;
  v_leases jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_workspace is null then
    raise exception 'workspace required' using errcode = '22023';
  end if;

  select public.devos_roadmap_contract_v1() into v_roadmap;

  select jsonb_build_object(
    'client_id', s.client_id,
    'last_seen_at', s.last_seen_at,
    'heartbeat_age_ms', greatest(0, floor(extract(epoch from (v_now - s.last_seen_at)) * 1000))::bigint,
    'stale', (v_now - s.last_seen_at) > interval '30 seconds',
    'extension_version', s.extension_version,
    'supervisor_mode', s.supervisor_mode,
    'armed', s.armed,
    'state', s.state,
    'authority_effect', false
  )
  into v_browser
  from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
  where s.workspace_id = p_workspace
  order by s.last_seen_at desc nulls last
  limit 1;

  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'supervisor_instance_id', m.supervisor_instance_id,
      'tab_id', m.tab_id,
      'status', m.status,
      'priority', m.priority,
      'last_seen_at', m.last_seen_at,
      'retired_at', m.retired_at,
      'authority_effect', false
    ) order by m.last_seen_at desc nulls last), '[]'::jsonb),
    'active_count', count(*) filter (where m.status = 'ACTIVE' and m.retired_at is null and v_now - m.last_seen_at <= interval '30 seconds'),
    'stale_or_lost_count', count(*) filter (where m.status <> 'ACTIVE' or m.retired_at is not null or v_now - m.last_seen_at > interval '30 seconds'),
    'authority_effect', false
  )
  into v_mesh
  from public.compute_fabric_a2_supervisor_mesh_instance_h205f22 m
  where m.workspace_id = p_workspace;

  select jsonb_build_object(
    'active_unreleased_count', count(*) filter (
      where l.status = 'ACTIVE'
        and l.released_at is null
        and (l.expires_at is null or l.expires_at > v_now)
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'lease_id', l.lease_id,
      'target_client_id', l.target_client_id,
      'holder_supervisor_instance_id', l.holder_supervisor_instance_id,
      'effect_scope', l.effect_scope,
      'effect_key', l.effect_key,
      'status', l.status,
      'expires_at', l.expires_at,
      'released_at', l.released_at,
      'authority_effect', false
    ) order by l.acquired_at desc), '[]'::jsonb),
    'authority_effect', false
  )
  into v_leases
  from public.compute_fabric_a2_supervisor_actuation_lease_h205f22 l
  where l.workspace_id = p_workspace;

  return jsonb_build_object(
    'schema', 'metaengine.compute-unified.source-snapshot.v1',
    'observed_at', v_now,
    'workspace_id', p_workspace,
    'roadmap_contract', v_roadmap,
    'browser_supervisor', coalesce(v_browser, jsonb_build_object('present', false, 'authority_effect', false)),
    'supervisor_mesh', coalesce(v_mesh, jsonb_build_object('rows', '[]'::jsonb, 'active_count', 0, 'stale_or_lost_count', 0, 'authority_effect', false)),
    'actuation_leases', coalesce(v_leases, jsonb_build_object('rows', '[]'::jsonb, 'active_unreleased_count', 0, 'authority_effect', false)),
    'authority_effect', false
  );
end;
$$;

revoke all on function public.h205f22_compute_unified_source_snapshot_v1(uuid) from public;
revoke all on function public.h205f22_compute_unified_source_snapshot_v1(uuid) from anon;
revoke all on function public.h205f22_compute_unified_source_snapshot_v1(uuid) from authenticated;
grant execute on function public.h205f22_compute_unified_source_snapshot_v1(uuid) to service_role;
