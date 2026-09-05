-- Keep continuous DevOS lanes aligned to the current authoritative integration baseline.
-- Old advisory/result rows remain durable evidence but must not block a new baseline.
-- An already leased/running MUTATING maintenance episode remains a hard fence until
-- its exact lease reaches a terminal/ambiguous boundary; this migration never
-- replays or supersedes that physical-effect authority.

do $do$
declare
  v_oid oid;
  v_def text;
  v_old text;
  v_new text;
begin
  select p.oid
    into v_oid
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='destruktion_meta'
     and p.proname='devos_meta_refill_h205f22'
   limit 1;
  if v_oid is null then raise exception 'DEVOS_META_REFILL_MISSING'; end if;

  v_def := pg_get_functiondef(v_oid);
  v_old := $old$where t.task_spec->>'meta_lane'=v_lane.lane and t.state in('READY','LEASED','RUNNING','RESULT_READY','BLOCKED')$old$;
  v_new := $new$where t.task_spec->>'meta_lane'=v_lane.lane and t.state in('READY','LEASED','RUNNING','RESULT_READY','BLOCKED') and t.base_sha=v_base$new$;
  if position(v_old in v_def)=0 then
    if position(v_new in v_def)=0 then raise exception 'DEVOS_META_REFILL_PREDICATE_DRIFT'; end if;
  else
    execute replace(v_def,v_old,v_new);
  end if;

  select p.oid
    into v_oid
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='destruktion_meta'
     and p.proname='devos_maintenance_refill_h205f22'
   limit 1;
  if v_oid is null then raise exception 'DEVOS_MAINTENANCE_REFILL_MISSING'; end if;

  v_def := pg_get_functiondef(v_oid);
  v_old := $old$where t.task_spec->>'maintenance_lane'=v_lane.lane and t.state in('READY','LEASED','RUNNING','RESULT_READY','BLOCKED')$old$;
  v_new := $new$where t.task_spec->>'maintenance_lane'=v_lane.lane and t.state in('READY','LEASED','RUNNING','RESULT_READY','BLOCKED') and (t.base_sha=v_base or (t.claim_class='MUTATING' and t.state in('LEASED','RUNNING')))$new$;
  if position(v_old in v_def)=0 then
    if position(v_new in v_def)=0 then raise exception 'DEVOS_MAINTENANCE_REFILL_PREDICATE_DRIFT'; end if;
  else
    execute replace(v_def,v_old,v_new);
  end if;
end $do$;

comment on function destruktion_meta.devos_meta_refill_h205f22() is
  'Continuous bounded meta refill: only the current METAENGINE_DEVOS baseline blocks a new generation; stale evidence stays durable and non-authoritative.';
comment on function destruktion_meta.devos_maintenance_refill_h205f22() is
  'Continuous bounded maintenance refill: current baseline blocks normally; stale leased/running MUTATING work remains fenced until terminal, while stale advisory/evidence rows cannot stall new generations.';
