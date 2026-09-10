-- DevOS Base Compatibility V2, conservative rollout step.
-- Existing/null policies remain EXACT. Only explicitly opted ADVISORY tasks with
-- task_spec.base_policy = 'LATEST' are rebound when the authoritative baseline moves.

begin;

create or replace function destruktion_meta.devos_fence_ready_base_drift_h205f22()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'destruktion_meta', 'public', 'extensions'
as $$
declare
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_rebound boolean;
begin
  if new.authority_key <> 'METAENGINE_DEVOS'
     or new.integration_line <> 'integration/metaengine-development-os-v1'
     or new.baseline_sha !~ '^[0-9a-f]{40}$'
     or new.baseline_sha is not distinct from old.baseline_sha then
    return new;
  end if;

  for v_task in
    select t.*
      from destruktion_meta.devos_fleet_task_h205f22 t
     where t.state = 'READY'
       and t.base_sha <> new.baseline_sha
     order by t.created_at, t.task_id
     for update
  loop
    v_rebound := v_task.claim_class = 'ADVISORY'
      and upper(coalesce(v_task.task_spec ->> 'base_policy', 'EXACT')) = 'LATEST';

    if v_rebound then
      update destruktion_meta.devos_fleet_task_h205f22
         set base_sha = new.baseline_sha,
             updated_at = clock_timestamp()
       where task_id = v_task.task_id
         and state = 'READY'
         and base_sha = v_task.base_sha;

      if found then
        perform destruktion_meta.devos_emit_event_h205f22(
          v_task.workspace_id,
          'TASK_REVALIDATED_BASE_DRIFT',
          v_task.task_id,
          v_task.point_id,
          v_task.role,
          null,
          v_task.lease_generation,
          new.baseline_sha,
          jsonb_build_object(
            'base_policy', 'LATEST',
            'prior_base_sha', v_task.base_sha,
            'authoritative_base_sha', new.baseline_sha,
            'alignment_epoch', new.alignment_epoch,
            'claim_class', v_task.claim_class,
            'physical_effect_attempted', false,
            'automatic_retry_allowed', false,
            'authority_effect', false
          ),
          v_task.idempotency_key || ':base-revalidate:' || new.alignment_epoch::text
        );
      end if;
    else
      update destruktion_meta.devos_fleet_task_h205f22
         set state = 'FENCED',
             error_code = 'BASE_SHA_DRIFT',
             updated_at = clock_timestamp()
       where task_id = v_task.task_id
         and state = 'READY'
         and base_sha = v_task.base_sha;

      if found then
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
            'base_policy', upper(coalesce(v_task.task_spec ->> 'base_policy', 'EXACT')),
            'authoritative_base_sha', new.baseline_sha,
            'alignment_epoch', new.alignment_epoch,
            'prior_state', 'READY',
            'physical_effect_attempted', false,
            'automatic_retry_allowed', false,
            'authority_effect', false
          ),
          v_task.idempotency_key || ':base-fence:' || new.alignment_epoch::text
        );
      end if;
    end if;
  end loop;
  return new;
end
$$;

commit;
