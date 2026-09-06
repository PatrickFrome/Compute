-- Advisory Realtime wake for Browser command availability.
--
-- DB command rows and leases remain the sole authority. This migration deliberately
-- reuses the existing shared glm_browser_pulse_notify_v1() trigger function instead
-- of installing a second trigger on the command table. Legacy pg_notify behavior is
-- preserved for command, supervisor-state and mesh triggers.

create or replace function public.glm_browser_pulse_notify_v1()
returns trigger
language plpgsql
as $$
declare
  v_client text := null;
  v_target text := null;
  v_supervisor text := null;
  v_cmd text := null;
  v_action text := null;
  v_status text := null;
  v_old_status text := null;
  v_seen text := null;
  v_workspace text := null;
  v_wake_target text := null;
  v_should_wake boolean := false;
begin
  begin v_client := new.client_id::text; exception when others then v_client := null; end;
  begin v_target := new.target_client_id::text; exception when others then v_target := null; end;
  begin v_supervisor := new.supervisor_instance_id::text; exception when others then v_supervisor := null; end;
  begin v_cmd := new.command_id::text; exception when others then v_cmd := null; end;
  begin v_action := new.action; exception when others then v_action := null; end;
  begin v_status := new.status; exception when others then v_status := null; end;
  begin v_seen := to_char(new.last_seen_at, 'HH24:MI:SS'); exception when others then v_seen := null; end;

  begin
    perform pg_notify(
      'glm_browser_pulse',
      json_build_object(
        'tbl', TG_TABLE_NAME,
        'op', TG_OP,
        'client', coalesce(v_client, v_target),
        'supervisor', v_supervisor,
        'cmd', v_cmd,
        'action', v_action,
        'status', v_status,
        'last_seen', v_seen
      )::text
    );
  exception when others then
    null;
  end;

  if TG_TABLE_SCHEMA = 'public'
     and TG_TABLE_NAME = 'compute_fabric_a2_browser_supervisor_command_h205f22' then
    if TG_OP = 'INSERT' then
      v_should_wake := v_status = 'PENDING';
    elsif TG_OP = 'UPDATE' then
      begin v_old_status := old.status; exception when others then v_old_status := null; end;
      v_should_wake := v_status = 'PENDING' and v_old_status is distinct from v_status;
    end if;

    if v_should_wake then
      begin v_workspace := new.workspace_id::text; exception when others then v_workspace := null; end;
      v_wake_target := coalesce(nullif(btrim(v_target), ''), 'all');
      if v_workspace is not null and v_workspace <> '' then
        begin
          perform realtime.send(
            jsonb_build_object(
              'schema', 'metaengine.native-supervisor.command-wake.v1',
              'workspace_id', v_workspace,
              'target_client_id', v_wake_target,
              'command_id', v_cmd,
              'action', v_action,
              'status', v_status,
              'transport_delivery_is_authority', false,
              'authority_effect', false
            ),
            'COMMAND_AVAILABLE',
            format('metaengine-control:%s:%s', v_workspace, v_wake_target),
            true
          );
        exception when others then
          null;
        end;
      end if;
    end if;
  end if;

  return null;
end;
$$;

comment on function public.glm_browser_pulse_notify_v1() is
  'Shared Browser pulse trigger. Preserves legacy pg_notify for command/state/mesh and emits one fail-soft private COMMAND_AVAILABLE Broadcast only when a durable Browser command enters PENDING. Broadcast never grants lease or execution authority.';
