-- METAENGINE Browser Control Plane Realtime Wake V1
--
-- SOURCE-ONLY / DEVELOPMENT-STAGING CONTRACT.
-- This file is intentionally rollback-only. It must not be copied into production
-- migrations until the fast-lane replay/load gates and Realtime authorization are
-- reviewed. Broadcast is advisory delivery only; DB command lease remains authority.

begin;

create or replace function public.h205f22_a2_browser_supervisor_command_realtime_wake_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_topic text;
begin
  if new.status <> 'PENDING' then
    return new;
  end if;

  v_topic := 'metaengine-control:' || new.workspace_id::text || ':' ||
    case
      when new.target_client_id is null or btrim(new.target_client_id) = '' then 'all'
      else left(btrim(new.target_client_id), 160)
    end;

  -- Wake payload deliberately contains no command payload, URL, page state, secret,
  -- lease token or actuation capability. The Browser MUST re-read and lease the
  -- durable command after receiving this advisory signal.
  perform realtime.send(
    jsonb_build_object(
      'schema', 'metaengine.native-supervisor.command-wake.v1',
      'command_id', new.command_id,
      'workspace_id', new.workspace_id,
      'issued_at', new.issued_at,
      'transport_delivery_is_authority', false,
      'authority_effect', false
    ),
    'COMMAND_AVAILABLE',
    v_topic,
    true
  );

  return new;
exception when others then
  -- Realtime availability must never make durable command issuance fail. A missed
  -- wake is recoverable by reconnect/recheck; a missing durable command is not.
  return new;
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_command_realtime_wake_v1() from public, anon, authenticated;

drop trigger if exists a2_browser_supervisor_command_realtime_wake_v1
  on public.compute_fabric_a2_browser_supervisor_command_h205f22;
create trigger a2_browser_supervisor_command_realtime_wake_v1
  after insert on public.compute_fabric_a2_browser_supervisor_command_h205f22
  for each row
  when (new.status = 'PENDING')
  execute function public.h205f22_a2_browser_supervisor_command_realtime_wake_v1();

-- Required graduation proofs:
-- 1. command INSERT commits even when realtime.send fails.
-- 2. targeted commands broadcast only to exact client topic; untargeted use :all.
-- 3. wake payload contains no command payload or authority material.
-- 4. dropped, duplicated and reordered broadcasts cannot execute an unleased command.
-- 5. subscribe race is closed by post-subscribe DB re-lease.
-- 6. private-channel authorization is verified before live migration.

rollback;
