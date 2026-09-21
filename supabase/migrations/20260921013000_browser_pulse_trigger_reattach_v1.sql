-- ============================================================================
-- R2 closure (ops audit 2026-09-21): canonical re-attachment of the
-- glm_browser_pulse wake triggers.
--
-- History: the shared trigger function public.glm_browser_pulse_notify_v1()
-- is canonical since 20260906093000 (updated by
-- 20260906163500_browser_command_realtime_wake_single_trigger_v1), but the
-- TRIGGER attachments were performed ad-hoc in the cloud (see
-- docs/push-wake-edge-deploy-runbook.md: "The database side is verified
-- LIVE"). Any migration or operator action that recreates the command /
-- supervisor-state / mesh tables silently dropped the wake channel, leaving
-- bounded DB-poll as the only wake path (R2 in the 2026-09-21 ops audit).
--
-- This migration is idempotent (drop-if-exists + create) and self-contained
-- (re-publishes the canonical function body first), so it can be re-run
-- after ANY table recreation to restore the immediate wake channel.
--
-- Contract (docs/push-wake-edge-deploy-runbook.md):
--   glm_pulse_command AFTER INSERT+UPDATE on
--     public.compute_fabric_a2_browser_supervisor_command_h205f22
--   glm_pulse_state  AFTER INSERT+UPDATE on
--     public.compute_fabric_a2_browser_supervisor_state_h205f22
--   glm_pulse_mesh   AFTER INSERT+UPDATE on
--     public.compute_fabric_a2_supervisor_mesh_instance_h205f22
-- Channel: pg_notify('glm_browser_pulse', ...) with legacy envelope
--   {tbl,client,...} accepted by the edge hub's parseWakePayload.
-- DB command rows and leases remain the sole authority: pg_notify and the
-- realtime broadcast NEVER grant lease or execution authority.
-- ============================================================================

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

-- Idempotent re-attachment (R2): safe to re-run after any table recreation.
drop trigger if exists glm_pulse_command on public.compute_fabric_a2_browser_supervisor_command_h205f22;
create trigger glm_pulse_command
after insert or update on public.compute_fabric_a2_browser_supervisor_command_h205f22
for each row execute function public.glm_browser_pulse_notify_v1();

drop trigger if exists glm_pulse_state on public.compute_fabric_a2_browser_supervisor_state_h205f22;
create trigger glm_pulse_state
after insert or update on public.compute_fabric_a2_browser_supervisor_state_h205f22
for each row execute function public.glm_browser_pulse_notify_v1();

drop trigger if exists glm_pulse_mesh on public.compute_fabric_a2_supervisor_mesh_instance_h205f22;
create trigger glm_pulse_mesh
after insert or update on public.compute_fabric_a2_supervisor_mesh_instance_h205f22
for each row execute function public.glm_browser_pulse_notify_v1();
