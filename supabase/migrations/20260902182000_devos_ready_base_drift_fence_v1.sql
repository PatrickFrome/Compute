-- READY tasks have no Browser/task effect. When the authoritative integration base
-- advances, fence only those pre-effect rows so the scheduler cannot spend capacity
-- on obsolete work. LEASED/RUNNING rows remain untouched because their effect state
-- may already be ambiguous and must be reconciled by their existing lease protocol.
create or replace function destruktion_meta.devos_fence_ready_base_drift_h205f22()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta','public','extensions'
as $function$
declare
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
begin
  if new.authority_key <> 'METAENGINE_DEVOS'
     or new.integration_line <> 'integration/metaengine-development-os-v1'
     or new.baseline_sha !~ '^[0-9a-f]{40}$'
     or new.baseline_sha is not distinct from old.baseline_sha then
    return new;
  end if;

  for v_task in
    update destruktion_meta.devos_fleet_task_h205f22 t
       set state='FENCED',
           error_code='BASE_SHA_DRIFT',
           updated_at=clock_timestamp()
     where t.state='READY'
       and t.base_sha <> new.baseline_sha
    returning t.*
  loop
    perform destruktion_meta.devos_emit_event_h205f22(
      v_task.workspace_id,
      'TASK_FENCED_BASE_DRIFT',
      v_task.task_id,
      v_task.point_id,
      v_task.role,
      null,
      v_task.lease_generation,
      v_task.base_sha,
      jsonb_build_object(
        'authoritative_base_sha',new.baseline_sha,
        'alignment_epoch',new.alignment_epoch,
        'prior_state','READY',
        'physical_effect_attempted',false,
        'automatic_retry_allowed',false,
        'authority_effect',false
      ),
      v_task.idempotency_key || ':base-fence:' || new.alignment_epoch::text
    );
  end loop;
  return new;
end
$function$;

drop trigger if exists devos_fence_ready_base_drift_h205f22
  on destruktion_meta.metaengine_devos_roadmap_authority_h205f22;
create trigger devos_fence_ready_base_drift_h205f22
after update of baseline_sha on destruktion_meta.metaengine_devos_roadmap_authority_h205f22
for each row execute function destruktion_meta.devos_fence_ready_base_drift_h205f22();

do $block$
declare
  v_base text;
  v_epoch bigint;
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
begin
  select baseline_sha,alignment_epoch into v_base,v_epoch
    from destruktion_meta.metaengine_devos_roadmap_authority_h205f22
   where authority_key='METAENGINE_DEVOS'
     and integration_line='integration/metaengine-development-os-v1';

  if v_base ~ '^[0-9a-f]{40}$' then
    for v_task in
      update destruktion_meta.devos_fleet_task_h205f22 t
         set state='FENCED',
             error_code='BASE_SHA_DRIFT',
             updated_at=clock_timestamp()
       where t.state='READY'
         and t.base_sha <> v_base
      returning t.*
    loop
      perform destruktion_meta.devos_emit_event_h205f22(
        v_task.workspace_id,
        'TASK_FENCED_BASE_DRIFT',
        v_task.task_id,
        v_task.point_id,
        v_task.role,
        null,
        v_task.lease_generation,
        v_task.base_sha,
        jsonb_build_object(
          'authoritative_base_sha',v_base,
          'alignment_epoch',v_epoch,
          'prior_state','READY',
          'physical_effect_attempted',false,
          'automatic_retry_allowed',false,
          'authority_effect',false
        ),
        v_task.idempotency_key || ':base-fence:' || v_epoch::text
      );
    end loop;
  end if;
end
$block$;
