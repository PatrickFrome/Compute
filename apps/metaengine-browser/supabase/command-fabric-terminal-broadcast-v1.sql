-- METAENGINE Command Fabric v2 terminal hint source contract.
-- Rollback-only and deliberately outside supabase/migrations. Realtime delivery is
-- advisory; consumers must perform an authoritative DB read after every hint.

begin;

create or replace function public.h205f22_a2_browser_supervisor_terminal_broadcast_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, realtime, pg_temp
as $$
declare
  v_target text;
  v_topic text;
  v_event jsonb;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status not in ('COMPLETED','FAILED','EXPIRED','CANCELLED') then
    return new;
  end if;
  if old.status = new.status then
    return new;
  end if;
  if old.status in ('COMPLETED','FAILED','EXPIRED','CANCELLED') then
    -- Terminal state must not silently transition to another terminal status.
    return new;
  end if;

  v_target := coalesce(nullif(trim(new.target_client_id), ''), 'all');
  v_topic := 'metaengine-control:' || new.workspace_id::text || ':' || v_target;
  v_event := jsonb_build_object(
    'schema', 'metaengine.command-terminal-hint.v1',
    'workspace_id', new.workspace_id,
    'target_client_id', new.target_client_id,
    'command_id', new.command_id,
    'status', new.status,
    'completed_at', new.completed_at,
    'effect_binding_sha256', new.effect_binding_sha256,
    'receipt_version', new.receipt_version,
    'authority_effect', false
  );

  perform realtime.send(
    v_event,
    'COMMAND_TERMINAL',
    v_topic,
    true
  );
  return new;
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_terminal_broadcast_v1() from public;
revoke all on function public.h205f22_a2_browser_supervisor_terminal_broadcast_v1() from anon;
revoke all on function public.h205f22_a2_browser_supervisor_terminal_broadcast_v1() from authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_terminal_broadcast_v1() to service_role;

create trigger h205f22_a2_browser_supervisor_terminal_broadcast_v1
  after update of status on public.compute_fabric_a2_browser_supervisor_command_h205f22
  for each row
  when (
    new.status in ('COMPLETED','FAILED','EXPIRED','CANCELLED')
    and old.status is distinct from new.status
  )
  execute function public.h205f22_a2_browser_supervisor_terminal_broadcast_v1();

rollback;
