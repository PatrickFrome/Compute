-- METAENGINE Browser Final V2: ARM + CONTROL are permanent runtime invariants.
-- Reject authority-lowering commands before they can become queue rows. This
-- applies to native issuance, mesh issuance and any future direct table writer.

create or replace function public.h205f22_a2_browser_supervisor_always_on_control_guard_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_action text := upper(trim(coalesce(new.action, '')));
  v_mode text := upper(trim(coalesce(new.payload->>'mode', '')));
begin
  if v_action = 'DISARM' then
    raise exception using
      errcode = '23514',
      message = 'native_supervisor_always_on_control_required',
      detail = 'DISARM is forbidden by the Final V2 always-on authority contract',
      constraint = 'a2_browser_supervisor_always_on_control_v1';
  end if;

  if v_action = 'SET_SUPERVISOR_MODE' and v_mode <> 'CONTROL' then
    raise exception using
      errcode = '23514',
      message = 'native_supervisor_always_on_control_required',
      detail = format('SET_SUPERVISOR_MODE=%s is forbidden; CONTROL is permanent', coalesce(nullif(v_mode, ''), '<EMPTY>')),
      constraint = 'a2_browser_supervisor_always_on_control_v1';
  end if;

  if v_action = 'SET_MODE' and v_mode not in ('CONTROL', 'GATE_SEND') then
    raise exception using
      errcode = '23514',
      message = 'native_supervisor_always_on_control_required',
      detail = format('legacy SET_MODE=%s is forbidden; only CONTROL/GATE_SEND remain compatible aliases', coalesce(nullif(v_mode, ''), '<EMPTY>')),
      constraint = 'a2_browser_supervisor_always_on_control_v1';
  end if;

  return new;
end;
$function$;

revoke all on function public.h205f22_a2_browser_supervisor_always_on_control_guard_v1() from public;

-- There were no PENDING/LEASED lowering commands at migration preparation time.
-- The trigger deliberately does not rewrite historical terminal evidence.
drop trigger if exists a2_browser_supervisor_always_on_control_v1
  on public.compute_fabric_a2_browser_supervisor_command_h205f22;

create trigger a2_browser_supervisor_always_on_control_v1
before insert or update of action, payload
on public.compute_fabric_a2_browser_supervisor_command_h205f22
for each row
execute function public.h205f22_a2_browser_supervisor_always_on_control_guard_v1();

comment on function public.h205f22_a2_browser_supervisor_always_on_control_guard_v1() is
  'Final V2 admission guard: forbids DISARM, OFF/MONITOR supervisor mode and legacy OBSERVE before queue insertion.';
