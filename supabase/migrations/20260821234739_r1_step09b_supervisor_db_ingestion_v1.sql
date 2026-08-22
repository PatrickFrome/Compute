create or replace function destruktion_meta.compute_ingest_r2_projection_h205f22(p_projection jsonb,p_authority_gate jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_effective_at timestamptz := clock_timestamp();
  v_projection_sha text;
  v_gate_sha text;
  v_root_acquired timestamptz;
  v_object jsonb;
  v_domain jsonb;
  v_obs jsonb;
  v_object_id uuid;
  v_existing destruktion_meta.compute_continuity_object_h205f22%rowtype;
  v_existing_domain destruktion_meta.compute_continuity_domain_h205f22%rowtype;
  v_readiness jsonb;
  v_audit jsonb;
  v_evidence jsonb;
  v_obs_id bigint;
  v_readback_at timestamptz;
  v_persisted_at timestamptz;
  v_expected_latest timestamptz;
  v_supplied_latest timestamptz;
  v_domains_inserted int := 0;
  v_domains_reused int := 0;
  v_observations_inserted int := 0;
  v_observations_reused int := 0;
  v_n int;
  v_distinct_domain int;
  v_distinct_operator int;
  v_distinct_failure int;
  v_distinct_provider int;
begin
  if jsonb_typeof(p_projection) <> 'object' or p_projection->>'schema' <> 'metaengine.compute.r1-final-r2-db-ingestion-projection.h205f22.v1' or p_projection->>'classification' <> 'PROPOSED_CONTINUITY_DB_INGESTION_NONAUTHORITATIVE' then
    raise exception 'STEP09B invalid projection identity' using errcode='22023';
  end if;
  v_projection_sha := p_projection->>'projection_sha256';
  if v_projection_sha is null or v_projection_sha !~ '^[0-9a-f]{64}$' then raise exception 'STEP09B invalid projection sha256' using errcode='22023'; end if;
  if coalesce((p_projection->>'canonical')::boolean,true) or coalesce((p_projection->>'authority_effect')::boolean,true) or coalesce((p_projection->>'r2_proven')::boolean,true) or coalesce((p_projection->>'r3_proven')::boolean,true) or coalesce((p_projection->>'persisted_seal_allowed')::boolean,true) then
    raise exception 'STEP09B projection authority boundary invalid' using errcode='23514';
  end if;
  if coalesce((p_projection#>>'{execution,sql_included}')::boolean,true) or coalesce((p_projection#>>'{execution,database_write_performed}')::boolean,true) or coalesce((p_projection#>>'{execution,object_id_must_be_resolved_by_unique_object_identity}')::boolean,false) is not true or coalesce((p_projection#>>'{execution,existing_domain_key_must_exactly_match_or_ingestion_must_fail}')::boolean,false) is not true then
    raise exception 'STEP09B projection execution boundary invalid' using errcode='23514';
  end if;

  if jsonb_typeof(p_authority_gate) <> 'object' or p_authority_gate->>'schema' <> 'metaengine.compute.r1-supervisor-r2-ingestion-authority-gate.h205f22.v1' or p_authority_gate->>'classification' <> 'SUPERVISOR_R2_STEP09B_ELIGIBILITY_NONAUTHORITATIVE' then
    raise exception 'STEP09B invalid authority gate identity' using errcode='22023';
  end if;
  v_gate_sha := p_authority_gate->>'authority_gate_receipt_sha256';
  if v_gate_sha is null or v_gate_sha !~ '^[0-9a-f]{64}$' then raise exception 'STEP09B invalid authority gate receipt sha256' using errcode='22023'; end if;
  if coalesce((p_authority_gate->>'step09b_ingestion_eligible')::boolean,false) is not true then raise exception 'STEP09B authority gate not eligible' using errcode='23514'; end if;
  if coalesce((p_authority_gate->>'database_credential_present')::boolean,true) or coalesce((p_authority_gate->>'database_write_performed')::boolean,true) or coalesce((p_authority_gate->>'provider_credential_present')::boolean,true) or coalesce((p_authority_gate->>'provider_call_performed')::boolean,true) or coalesce((p_authority_gate->>'canonical')::boolean,true) or coalesce((p_authority_gate->>'authority_effect')::boolean,true) or coalesce((p_authority_gate->>'r2_proven')::boolean,true) or coalesce((p_authority_gate->>'r3_proven')::boolean,true) or coalesce((p_authority_gate->>'persisted_seal_allowed')::boolean,true) then
    raise exception 'STEP09B authority gate boundary invalid' using errcode='23514';
  end if;
  if p_authority_gate->>'db_projection_sha256' is distinct from v_projection_sha then raise exception 'STEP09B authority gate projection mismatch' using errcode='23514'; end if;
  if coalesce((p_authority_gate#>>'{gh_attestation_verification,executed_by_this_gate}')::boolean,false) is not true or coalesce((p_authority_gate#>>'{gh_attestation_verification,offline_bundle_used}')::boolean,false) is not true or coalesce((p_authority_gate#>>'{gh_attestation_verification,custom_fresh_trusted_root_used}')::boolean,false) is not true or coalesce((p_authority_gate#>>'{gh_attestation_verification,result_count}')::int,0) <> 1 then
    raise exception 'STEP09B authority gate verification boundary invalid' using errcode='23514';
  end if;
  if coalesce((p_authority_gate#>>'{trusted_root,online_fetch_required}')::boolean,false) is not true then raise exception 'STEP09B fresh trusted root required' using errcode='23514'; end if;
  begin v_root_acquired := (p_authority_gate#>>'{trusted_root,acquired_at}')::timestamptz; exception when others then raise exception 'STEP09B invalid trusted root acquisition time' using errcode='22007'; end;
  if v_root_acquired > v_effective_at or v_root_acquired < v_effective_at - interval '15 minutes' then raise exception 'STEP09B authority gate trusted root context stale' using errcode='23514'; end if;

  if jsonb_typeof(p_projection->'domain_insert_or_exact_match') <> 'array' or jsonb_array_length(p_projection->'domain_insert_or_exact_match') <> 2 or jsonb_typeof(p_projection->'observation_inserts') <> 'array' or jsonb_array_length(p_projection->'observation_inserts') <> 2 or jsonb_typeof(p_projection->'object_insert_or_exact_match') <> 'object' then
    raise exception 'STEP09B current projection requires exactly two domains and observations' using errcode='23514';
  end if;
  select count(*),count(distinct e->>'domain_key'),count(distinct e->>'operator_class'),count(distinct e->>'failure_domain'),count(distinct e->>'provider_kind') into v_n,v_distinct_domain,v_distinct_operator,v_distinct_failure,v_distinct_provider from jsonb_array_elements(p_projection->'domain_insert_or_exact_match') e;
  if v_n<>2 or v_distinct_domain<>2 or v_distinct_operator<>2 or v_distinct_failure<>2 or v_distinct_provider<>2 then raise exception 'STEP09B two-domain independence contract invalid' using errcode='23514'; end if;

  v_object := p_projection->'object_insert_or_exact_match';
  if v_object->>'expected_sha256' is null or v_object->>'expected_sha256' !~ '^[0-9a-f]{64}$' then raise exception 'STEP09B object expected sha256 invalid' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock((('x'||substr(v_object->>'expected_sha256',1,8))::bit(32)::int),(('x'||substr(v_object->>'expected_sha256',9,8))::bit(32)::int));

  for v_domain in select value from jsonb_array_elements(p_projection->'domain_insert_or_exact_match') loop
    insert into destruktion_meta.compute_continuity_domain_h205f22(domain_key,provider_kind,operator_class,failure_domain,independence_basis,physical_region_independence_claimed,metadata)
    values(v_domain->>'domain_key',v_domain->>'provider_kind',v_domain->>'operator_class',v_domain->>'failure_domain',v_domain->>'independence_basis',coalesce((v_domain->>'physical_region_independence_claimed')::boolean,false),coalesce(v_domain->'metadata','{}'::jsonb))
    on conflict (domain_key) do nothing;
    if found then v_domains_inserted:=v_domains_inserted+1; else v_domains_reused:=v_domains_reused+1; end if;
    select * into strict v_existing_domain from destruktion_meta.compute_continuity_domain_h205f22 where domain_key=v_domain->>'domain_key';
    if v_existing_domain.provider_kind is distinct from v_domain->>'provider_kind' or v_existing_domain.operator_class is distinct from v_domain->>'operator_class' or v_existing_domain.failure_domain is distinct from v_domain->>'failure_domain' or v_existing_domain.independence_basis is distinct from v_domain->>'independence_basis' or v_existing_domain.physical_region_independence_claimed is distinct from coalesce((v_domain->>'physical_region_independence_claimed')::boolean,false) or v_existing_domain.metadata is distinct from coalesce(v_domain->'metadata','{}'::jsonb) then
      raise exception 'STEP09B existing domain % does not exactly match projection',v_domain->>'domain_key' using errcode='23514';
    end if;
  end loop;

  insert into destruktion_meta.compute_continuity_object_h205f22(subject_kind,subject_id,expected_sha256,expected_bytes,payload_root_sha256,manifest_checkpoint_id,metadata)
  values(v_object->>'subject_kind',v_object->>'subject_id',lower(v_object->>'expected_sha256'),nullif(v_object->>'expected_bytes','')::bigint,nullif(v_object->>'payload_root_sha256',''),nullif(v_object->>'manifest_checkpoint_id',''),coalesce(v_object->'metadata','{}'::jsonb))
  on conflict (subject_kind,subject_id,expected_sha256) do nothing;
  select * into strict v_existing from destruktion_meta.compute_continuity_object_h205f22 where subject_kind=v_object->>'subject_kind' and subject_id=v_object->>'subject_id' and expected_sha256=lower(v_object->>'expected_sha256');
  v_object_id:=v_existing.object_id;
  if v_existing.expected_bytes is distinct from nullif(v_object->>'expected_bytes','')::bigint or v_existing.payload_root_sha256 is distinct from nullif(v_object->>'payload_root_sha256','') or v_existing.manifest_checkpoint_id is distinct from nullif(v_object->>'manifest_checkpoint_id','') or v_existing.metadata is distinct from coalesce(v_object->'metadata','{}'::jsonb) then
    raise exception 'STEP09B existing object does not exactly match projection' using errcode='23514';
  end if;

  select min((e->>'readback_at')::timestamptz)+interval '7 days' into v_expected_latest from jsonb_array_elements(p_projection->'observation_inserts') e;
  begin v_supplied_latest := (p_projection#>>'{r2_freshness_contract,latest_effective_at_for_both_current_readbacks}')::timestamptz; exception when others then raise exception 'STEP09B invalid projection freshness boundary' using errcode='22007'; end;
  if coalesce((p_projection#>>'{r2_freshness_contract,max_age_seconds}')::int,0)<>604800 or coalesce((p_projection#>>'{r2_freshness_contract,package_does_not_refresh_readback_at}')::boolean,false) is not true or v_supplied_latest is distinct from v_expected_latest then raise exception 'STEP09B projection freshness contract mismatch' using errcode='23514'; end if;
  if v_effective_at > v_expected_latest then raise exception 'STEP09B provider readback evidence stale at database commit' using errcode='23514'; end if;

  for v_obs in select value from jsonb_array_elements(p_projection->'observation_inserts') loop
    if v_obs#>>'{object_selector,subject_kind}' is distinct from v_object->>'subject_kind' or v_obs#>>'{object_selector,subject_id}' is distinct from v_object->>'subject_id' or v_obs#>>'{object_selector,expected_sha256}' is distinct from v_object->>'expected_sha256' then raise exception 'STEP09B observation object selector mismatch' using errcode='23514'; end if;
    if not exists(select 1 from jsonb_array_elements(p_projection->'domain_insert_or_exact_match') d where d->>'domain_key'=v_obs->>'domain_key') then raise exception 'STEP09B observation domain not projected' using errcode='23514'; end if;
    if v_obs->>'status' <> 'VERIFIED' or lower(v_obs->>'observed_sha256') is distinct from lower(v_object->>'expected_sha256') or nullif(v_obs->>'observed_bytes','')::bigint is distinct from nullif(v_object->>'expected_bytes','')::bigint then raise exception 'STEP09B observation content identity mismatch' using errcode='23514'; end if;
    begin v_persisted_at := (v_obs->>'persisted_at')::timestamptz; v_readback_at := (v_obs->>'readback_at')::timestamptz; exception when others then raise exception 'STEP09B invalid observation timestamps' using errcode='22007'; end;
    if v_persisted_at is null or v_readback_at is null or v_readback_at < v_persisted_at or v_readback_at > v_effective_at or v_readback_at < v_effective_at-interval '7 days' then raise exception 'STEP09B observation timestamp/freshness invalid' using errcode='23514'; end if;
    v_evidence := coalesce(v_obs->'evidence','{}'::jsonb) || jsonb_build_object('step09b',jsonb_build_object('schema','metaengine.compute.r1-step09b-observation-binding.h205f22.v1','projection_sha256',v_projection_sha,'authority_gate_receipt_sha256',v_gate_sha,'package_sha256',p_authority_gate->>'package_sha256','source_head_sha',p_authority_gate->>'source_head_sha','trusted_root_context_sha256',p_authority_gate#>>'{trusted_root,context_sha256}'));
    select observation_id into v_obs_id from destruktion_meta.compute_continuity_observation_h205f22 where object_id=v_object_id and domain_key=v_obs->>'domain_key' and readback_at=v_readback_at and status='VERIFIED' and observed_sha256=lower(v_obs->>'observed_sha256') and observed_bytes is not distinct from nullif(v_obs->>'observed_bytes','')::bigint and persisted_at is not distinct from v_persisted_at and evidence=v_evidence order by observation_id limit 1;
    if found then
      v_observations_reused:=v_observations_reused+1;
    else
      if exists(select 1 from destruktion_meta.compute_continuity_observation_h205f22 where object_id=v_object_id and domain_key=v_obs->>'domain_key' and readback_at=v_readback_at) then raise exception 'STEP09B conflicting observation already exists for domain/readback identity' using errcode='23514'; end if;
      v_obs_id:=destruktion_meta.compute_record_continuity_observation_h205f22(v_object_id,v_obs->>'domain_key','VERIFIED',lower(v_obs->>'observed_sha256'),nullif(v_obs->>'observed_bytes','')::bigint,v_persisted_at,v_readback_at,v_evidence);
      if (select status from destruktion_meta.compute_continuity_observation_h205f22 where observation_id=v_obs_id) <> 'VERIFIED' then raise exception 'STEP09B inserted observation normalized away from VERIFIED' using errcode='23514'; end if;
      v_observations_inserted:=v_observations_inserted+1;
    end if;
  end loop;

  v_readiness:=destruktion_meta.compute_continuity_readiness_h205f22(v_object_id,v_effective_at,interval '7 days');
  if coalesce((v_readiness->>'r2_proven')::boolean,false) is not true then raise exception 'STEP09B database-derived two-domain readiness not proven' using errcode='23514'; end if;
  v_audit:=destruktion_meta.compute_continuity_audit_status_h205f22(v_object_id,v_effective_at,interval '7 days');
  if v_audit->>'status' <> 'PASS' then raise exception 'STEP09B database continuity audit not PASS' using errcode='23514'; end if;

  return jsonb_build_object('schema','metaengine.compute.r1-step09b-db-ingestion-result.h205f22.v1','classification','DATABASE_DERIVED_TWO_DOMAIN_READBACK_QUORUM','projection_sha256',v_projection_sha,'authority_gate_receipt_sha256',v_gate_sha,'object_id',v_object_id,'domains_inserted',v_domains_inserted,'domains_reused',v_domains_reused,'observations_inserted',v_observations_inserted,'observations_reused',v_observations_reused,'effective_at',v_effective_at,'continuity_readiness',v_readiness,'continuity_audit',v_audit,'database_write_performed',true,'continuity_readiness_r2_proven',true,'canonical_roadmap_r2_promoted',false,'r3_proven',false,'persisted_seal_created',false,'required_next','SUPERVISOR_AUDIT_R1_AND_DECIDE_R1_SEAL_THEN_CANONICAL_R2_PROMOTION_SEPARATELY');
end;
$$;
revoke all on function destruktion_meta.compute_ingest_r2_projection_h205f22(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function destruktion_meta.compute_ingest_r2_projection_h205f22(jsonb,jsonb) to postgres;
comment on function destruktion_meta.compute_ingest_r2_projection_h205f22(jsonb,jsonb) is 'H205F22 STEP09B postgres-only append-only ingestion of a STEP08 two-domain projection bound to a STEP09A authority-gate receipt. Rechecks trusted-root/readback freshness at DB commit, exact-matches immutable rows, serializes same-object ingestion, derives R2 from live continuity tables, and never creates a persisted seal or roadmap promotion.';
