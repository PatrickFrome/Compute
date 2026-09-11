-- METAENGINE Browser self-update observability helper.
-- Branch-local only until separately reviewed/promoted.
-- Read-only projection: no command issuance, no browser authority, no production promotion.

create or replace function public.h205f22_a2_browser_self_update_observe_v1(p_client_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with live as (
    select
      s.client_id,
      s.extension_version,
      s.last_seen_at,
      s.supervisor_mode,
      s.armed,
      s.state ->> 'shell_version' as shell_version
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
    where s.workspace_id = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid
      and s.client_id = left(trim(coalesce(p_client_id, '')), 160)
    order by s.last_seen_at desc
    limit 1
  ), latest_status as (
    select
      c.command_id,
      c.completed_at,
      c.status,
      c.authority_effect,
      c.receipt -> 'result' as self_update
    from public.compute_fabric_a2_browser_supervisor_command_h205f22 c
    where c.workspace_id = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid
      and c.target_client_id = left(trim(coalesce(p_client_id, '')), 160)
      and c.action = 'SELF_UPDATE_STATUS'
      and c.status = 'COMPLETED'
    order by c.completed_at desc nulls last, c.issued_at desc
    limit 1
  )
  select jsonb_build_object(
    'schema', 'metaengine.browser.self-update-observer.v1',
    'client_id', live.client_id,
    'extension_version', live.extension_version,
    'shell_version', live.shell_version,
    'last_seen_at', live.last_seen_at,
    'supervisor_mode', live.supervisor_mode,
    'armed', live.armed,
    'status_command_id', latest_status.command_id,
    'status_completed_at', latest_status.completed_at,
    'status_authority_effect', coalesce(latest_status.authority_effect, false),
    'self_update', latest_status.self_update,
    'authority_effect', false
  )
  from live
  left join latest_status on true;
$$;

revoke all on function public.h205f22_a2_browser_self_update_observe_v1(text) from public;
comment on function public.h205f22_a2_browser_self_update_observe_v1(text)
is 'Read-only latest Browser self-update observation from live state plus completed SELF_UPDATE_STATUS receipt; authority_effect=false.';
