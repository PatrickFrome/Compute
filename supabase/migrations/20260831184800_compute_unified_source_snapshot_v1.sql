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
    'runtime', jsonb_strip_nulls(jsonb_build_object(
      'process_incarnation_id', s.state->>'process_incarnation_id',
      'fleet', jsonb_strip_nulls(jsonb_build_object(
        'counts', s.state#>'{fleet,counts}',
        'readiness_contract', s.state#>>'{fleet,readiness_contract}',
        'capacity_model', s.state#>>'{fleet,policy,capacity_model}',
        'desired_agents', s.state#>'{fleet,policy,desired_agents}',
        'automatic_work_retry', s.state#>'{fleet,policy,automatic_work_retry}',
        'browser_authority', s.state#>'{fleet,policy,browser_authority}'
      )),
      'keepalive', jsonb_strip_nulls(jsonb_build_object(
        'state', s.state#>>'{supervisor_lifecycle,keepalive,state}',
        'cycle_seq', s.state#>'{supervisor_lifecycle,keepalive,cycle_seq}',
        'updated_at', s.state#>>'{supervisor_lifecycle,keepalive,updated_at}',
        'supervisor_id', s.state#>>'{supervisor_lifecycle,keepalive,supervisor_id}',
        'supervisor_epoch', s.state#>'{supervisor_lifecycle,keepalive,supervisor_epoch}',
        'active_wake_id', s.state#>>'{supervisor_lifecycle,keepalive,active_wake,wake_id}',
        'active_wake_reason', s.state#>>'{supervisor_lifecycle,keepalive,active_wake,reason}',
        'pending_wake_id', s.state#>>'{supervisor_lifecycle,keepalive,pending_wake,wake_id}',
        'pending_wake_reason', s.state#>>'{supervisor_lifecycle,keepalive,pending_wake,reason}',
        'queued_wake_count', jsonb_array_length(coalesce(s.state#>'{supervisor_lifecycle,keepalive,queued_wakes}', '[]'::jsonb)),
        'ambiguous_history_count', jsonb_array_length(coalesce(s.state#>'{supervisor_lifecycle,keepalive,ambiguous_history}', '[]'::jsonb))
      )),
      'supervisor_generation', s.state#>>'{supervisor_lifecycle,supervisor_generation}',
      'quiescent', s.state#>'{supervisor_lifecycle,quiescent}',
      'self_update', jsonb_strip_nulls(jsonb_build_object(
        'state', s.state#>>'{self_update,state}',
        'current_version', s.state#>>'{self_update,current_version}',
        'available_version', s.state#>>'{self_update,available_version}',
        'trusted_channel', s.state#>>'{self_update,trusted_channel}',
        'release_resolution', s.state#>>'{self_update,release_resolution}',
        'metadata_verified', s.state#>'{self_update,metadata_verified}',
        'publisher_verified', s.state#>'{self_update,publisher_verified}',
        'restart_gate_safe', s.state#>'{self_update,restart_gate_safe}'
      )),
      'development_plane', jsonb_strip_nulls(jsonb_build_object(
        'state', s.state#>>'{development_plane,state}',
        'version', s.state#>>'{development_plane,version}',
        'arbitrary_eval', s.state#>'{development_plane,arbitrary_eval}',
        'browser_actuation_authority', s.state#>'{development_plane,browser_actuation_authority}',
        'direct_promote_current', s.state#>'{development_plane,direct_promote_current}'
      ))
    )),
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
