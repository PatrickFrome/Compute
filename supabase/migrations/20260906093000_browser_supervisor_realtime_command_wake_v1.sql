-- Browser supervisor command wake v1
--
-- Keep the existing generic glm_browser_pulse_notify_v1 trigger as the single
-- publisher boundary. Legacy pg_notify remains available for command/state/mesh
-- consumers; Supabase Realtime is a non-authoritative wake hint only for command
-- rows that newly enter PENDING. Durable leasing remains the command authority.

create or replace function public.glm_browser_pulse_notify_v1()
returns trigger
language plpgsql
as $function$
declare
  v_client text;
  v_target text;
  v_supervisor text;
  v_workspace text;
  v_cmd text;
  v_action text;
  v_status text;
  v_old_status text;
  v_last_seen timestamptz;
  v_payload text;
  v_topic text;
  v_should_wake boolean := false;
  v_wake_payload jsonb;
begin
  begin v_client := nullif(to_jsonb(new)->>'client_id',''); exception when others then v_client := null; end;
  begin v_target := nullif(to_jsonb(new)->>'target_client_id',''); exception when others then v_target := null; end;
  begin v_supervisor := nullif(to_jsonb(new)->>'supervisor_client_id',''); exception when others then v_supervisor := null; end;
  begin v_workspace := nullif(to_jsonb(new)->>'workspace_id',''); exception when others then v_workspace := null; end;
  begin v_cmd := coalesce(nullif(to_jsonb(new)->>'command_id',''), nullif(to_jsonb(new)->>'event_id','')); exception when others then v_cmd := null; end;
  begin v_action := nullif(to_jsonb(new)->>'action',''); exception when others then v_action := null; end;
  begin v_status := nullif(to_jsonb(new)->>'status',''); exception when others then v_status := null; end;

  begin
    v_last_seen := coalesce(
      nullif(to_jsonb(new)->>'last_seen','')::timestamptz,
      nullif(to_jsonb(new)->>'heartbeat_at','')::timestamptz
    );
  exception when others then
    v_last_seen := null;
  end;

  v_payload := json_build_object(
    'table', TG_TABLE_NAME,
    'op', TG_OP,
    'client_id', v_client,
    'target_client_id', v_target,
    'supervisor_client_id', v_supervisor,
    'command_id', v_cmd,
    'action', v_action,
    'status', v_status,
    'last_seen', v_last_seen
  )::text;

  -- Preserve the legacy wake channel. A failure here must not affect the durable
  -- write and must not prevent the independent Realtime wake attempt below.
  begin
    perform pg_notify('glm_browser_pulse', v_payload);
  exception when others then
    null;
  end;

  -- glm_browser_pulse_notify_v1 is also attached to supervisor state and mesh
  -- tables. Only the durable command table is allowed to publish command wakes.
  if TG_TABLE_SCHEMA = 'public'
     and TG_TABLE_NAME = 'compute_fabric_a2_browser_supervisor_command_h205f22'
     and v_workspace is not null
     and upper(coalesce(v_status, '')) = 'PENDING' then
    if TG_OP = 'INSERT' then
      v_should_wake := true;
    elsif TG_OP = 'UPDATE' then
      begin
        v_old_status := nullif(to_jsonb(old)->>'status','');
      exception when others then
        v_old_status := null;
      end;
      v_should_wake := coalesce(upper(v_old_status), '') <> 'PENDING';
    end if;
  end if;

  if v_should_wake then
    -- Targeted commands wake only the exact client topic. Truly untargeted
    -- commands use the shared :all topic. Subscribers already join both.
    v_topic := 'metaengine-control:' || v_workspace || ':' || coalesce(v_target, 'all');
    v_wake_payload := jsonb_build_object(
      'schema', 'metaengine.command-available.v1',
      'workspace_id', v_workspace,
      'target_client_id', v_target,
      'command_id', v_cmd,
      'action', v_action,
      'status', 'PENDING'
    );

    -- Broadcast is intentionally lossy and non-authoritative. The command row is
    -- already durable and wait-batch always re-runs the lease query after a wake.
    begin
      perform realtime.send(
        v_wake_payload,
        'COMMAND_AVAILABLE',
        v_topic,
        true
      );
    exception when others then
      null;
    end;
  end if;

  return null;
exception when others then
  return null;
end;
$function$;
