-- METAENGINE R1 STEP09B fresh-project canary v1.
-- Structural/ACL verification plus fail-closed negative call only.
-- No valid provider projection is synthesized here; no R2/R3 claim can be produced.

do $struct$
declare
  v_oid oid;
  v_def text;
  v_search_path text[];
begin
  select p.oid,pg_catalog.pg_get_functiondef(p.oid),p.proconfig
  into v_oid,v_def,v_search_path
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='destruktion_meta'
    and p.proname='compute_ingest_r2_projection_h205f22'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)='p_projection jsonb, p_authority_gate jsonb';

  if v_oid is null then raise exception 'r1_step09b_canary_function_missing'; end if;
  if exists(select 1 from pg_catalog.pg_proc where oid=v_oid and prosecdef) then
    raise exception 'r1_step09b_canary_security_definer_forbidden';
  end if;
  if v_search_path is null or not ('search_path=""' = any(v_search_path)) then
    raise exception 'r1_step09b_canary_search_path_invalid:%',v_search_path;
  end if;
  if pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE') then
    raise exception 'r1_step09b_canary_execute_exposed';
  end if;
  if not pg_catalog.has_function_privilege('postgres',v_oid,'EXECUTE') then
    raise exception 'r1_step09b_canary_postgres_execute_missing';
  end if;
  if position('pg_advisory_xact_lock' in lower(v_def))=0
     or position('clock_timestamp()' in lower(v_def))=0
     or position('database_transaction_validated'',true' in lower(v_def))=0 then
    raise exception 'r1_step09b_canary_contract_marker_missing';
  end if;
end;
$struct$;

do $negative$
begin
  begin
    perform destruktion_meta.compute_ingest_r2_projection_h205f22('{}'::jsonb,'{}'::jsonb);
    raise exception 'r1_step09b_canary_invalid_payload_accepted';
  exception
    when sqlstate '22023' then null;
  end;
end;
$negative$;

select jsonb_build_object(
  'status','PASS',
  'mode','STRUCTURAL_AND_NEGATIVE_ONLY',
  'database_write_performed',false,
  'persisted_durability_evidence',false,
  'r2_production_claim',false,
  'r3_production_claim',false,
  'canonical_roadmap_r2_promoted',false
) as r1_step09b_canary;
