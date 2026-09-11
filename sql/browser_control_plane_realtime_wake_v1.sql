-- METAENGINE Browser Control Plane Realtime Wake V1
--
-- SOURCE CONTRACT / ROLLBACK PROOF.
-- Realtime Broadcast is advisory delivery only. The durable command row and DB
-- lease remain the sole execution authority. The existing shared
-- glm_browser_pulse_notify_v1 trigger boundary is intentionally reused so command
-- issuance has one publisher boundary rather than a second command-only trigger.

begin;

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
  -- Preserve the legacy generic pulse projection for all three canonical tables.
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

  -- Broadcast only from the canonical command trigger. The same function is also
  -- attached to state and mesh tables, so direct access to command-only columns
  -- must remain inside this table gate.
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
          -- Broadcast availability must never invalidate the durable command write
          -- or the legacy pg_notify pulse. wait-batch always performs a DB re-lease.
          null;
        end;
      end if;
    end if;
  end if;

  return null;
end;
$$;

-- This source proof deliberately declares no additional trigger. Existing canonical triggers remain:
--   glm_pulse_command -> command table
--   glm_pulse_state   -> state table
--   glm_pulse_mesh    -> mesh table
-- and all continue to call glm_browser_pulse_notify_v1().

rollback;
