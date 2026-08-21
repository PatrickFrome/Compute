-- R1_CONTINUITY_PLANE_ADOPTION semantic self-test.
-- All synthetic evidence is rolled back. PASS proves state-machine semantics only, never R2/R3 production durability.

begin;

do $$
declare
  v_obj uuid;
  v_bad bigint;
  v_missing bigint;
  v_no_readback bigint;
  v_stale bigint;
  v_good_a bigint;
  v_good_b bigint;
  v_lease uuid := gen_random_uuid();
  v_acq bigint;
  v_json jsonb;
  v_bad_status text;
  v_restore_status text;
begin
  insert into destruktion_meta.compute_continuity_domain_h205f22(domain_key,provider_kind,operator_class,failure_domain,independence_basis)
  values ('r1-selftest-a','S3_COMPAT','operator-a','failure-domain-a','rollback selftest'),
         ('r1-selftest-b','S3_COMPAT','operator-b','failure-domain-b','rollback selftest');

  insert into destruktion_meta.compute_continuity_object_h205f22(subject_kind,subject_id,expected_sha256,expected_bytes,payload_root_sha256,metadata)
  values('BACKUP_SET','r1-selftest-object',repeat('a',64),123,repeat('b',64),'{"synthetic":true,"rollback":true}')
  returning object_id into v_obj;

  -- H41 corruption/missing/readback fail-close.
  insert into destruktion_meta.compute_continuity_observation_h205f22(object_id,domain_key,status,observed_sha256,observed_bytes,persisted_at,readback_at)
  values(v_obj,'r1-selftest-a','VERIFIED',repeat('c',64),123,now(),now()) returning observation_id into v_bad;
  if (select status from destruktion_meta.compute_continuity_observation_h205f22 where observation_id=v_bad) <> 'MISMATCH' then raise exception 'corruption normalization failed'; end if;

  insert into destruktion_meta.compute_continuity_observation_h205f22(object_id,domain_key,status,observed_sha256,observed_bytes,persisted_at,readback_at)
  values(v_obj,'r1-selftest-a','VERIFIED',null,123,now(),now()) returning observation_id into v_missing;
  if (select status from destruktion_meta.compute_continuity_observation_h205f22 where observation_id=v_missing) <> 'MISSING' then raise exception 'missing normalization failed'; end if;

  insert into destruktion_meta.compute_continuity_observation_h205f22(object_id,domain_key,status,observed_sha256,observed_bytes,persisted_at,readback_at)
  values(v_obj,'r1-selftest-a','VERIFIED',repeat('a',64),123,now(),null) returning observation_id into v_no_readback;
  if (select status from destruktion_meta.compute_continuity_observation_h205f22 where observation_id=v_no_readback) <> 'ERROR' then raise exception 'no-readback normalization failed'; end if;

  insert into destruktion_meta.compute_continuity_observation_h205f22(object_id,domain_key,status,observed_sha256,observed_bytes,persisted_at,readback_at)
  values(v_obj,'r1-selftest-a','VERIFIED',repeat('a',64),123,now()-interval '9 days',now()-interval '9 days') returning observation_id into v_stale;
  v_json := destruktion_meta.compute_continuity_readiness_h205f22(v_obj,now(),interval '7 days');
  if (v_json->>'status') <> 'R2_NOT_PROVEN' then raise exception 'stale observation counted toward R2: %',v_json; end if;

  v_json := destruktion_meta.compute_continuity_audit_status_h205f22(v_obj,now(),interval '7 days');
  if (v_json->>'status') <> 'REPAIR_OR_READBACK_REQUIRED' then raise exception 'audit did not fail-close: %',v_json; end if;

  -- H47C seal cannot exist before two current independent persisted readbacks.
  begin
    insert into destruktion_meta.compute_continuity_persisted_seal_h205f22(object_id,readiness,receipt_sha256)
    values(v_obj,'{}',repeat('1',64));
    raise exception 'seal incorrectly allowed before R2';
  exception when check_violation then null;
  end;

  -- H49 bad mirror remains immutable; replacement is separate verified observation + repair receipt.
  insert into destruktion_meta.compute_continuity_observation_h205f22(object_id,domain_key,status,observed_sha256,observed_bytes,persisted_at,readback_at)
  values(v_obj,'r1-selftest-a','VERIFIED',repeat('a',64),123,now(),now()) returning observation_id into v_good_a;

  perform destruktion_meta.compute_record_continuity_repair_h205f22(v_bad,v_good_a,repeat('2',64),'{"synthetic":true}');
  select status into v_bad_status from destruktion_meta.compute_continuity_observation_h205f22 where observation_id=v_bad;
  if v_bad_status <> 'MISMATCH' then raise exception 'repair mutated bad observation'; end if;

  -- R3 is dependency-gated on R2.
  v_json := destruktion_meta.compute_restore_quorum_status_h205f22(v_obj,now(),interval '7 days');
  if (v_json->>'status') <> 'R3_BLOCKED_R2_NOT_PROVEN' then raise exception 'R3 not blocked by R2: %',v_json; end if;

  -- Second independent current readback proves quorum logic only inside rollback selftest.
  insert into destruktion_meta.compute_continuity_observation_h205f22(object_id,domain_key,status,observed_sha256,observed_bytes,persisted_at,readback_at)
  values(v_obj,'r1-selftest-b','VERIFIED',repeat('a',64),123,now(),now()) returning observation_id into v_good_b;
  v_json := destruktion_meta.compute_continuity_readiness_h205f22(v_obj,now(),interval '7 days');
  if (v_json->>'status') <> 'R2_PROVEN' then raise exception 'synthetic two-domain quorum logic failed: %',v_json; end if;

  insert into destruktion_meta.compute_continuity_persisted_seal_h205f22(object_id,readiness,receipt_sha256,evidence)
  values(v_obj,'{}',repeat('3',64),'{"synthetic":true,"rollback":true}');

  -- H43 wrong restore hash becomes FAIL; latest good readback in two independent domains can satisfy synthetic R3 logic.
  insert into destruktion_meta.compute_continuity_restore_drill_h205f22(object_id,domain_key,status,readback_verified,restored_sha256,started_at,finished_at,receipt_sha256)
  values(v_obj,'r1-selftest-a','PASS',true,repeat('d',64),now()-interval '20 seconds',now()-interval '19 seconds',repeat('4',64));
  select status into v_restore_status from destruktion_meta.compute_continuity_restore_drill_h205f22 where object_id=v_obj order by created_at desc limit 1;
  if v_restore_status <> 'FAIL' then raise exception 'corrupt restore incorrectly PASS'; end if;

  insert into destruktion_meta.compute_continuity_restore_drill_h205f22(object_id,domain_key,status,readback_verified,restored_sha256,started_at,finished_at,receipt_sha256)
  values (v_obj,'r1-selftest-a','PASS',true,repeat('a',64),now()-interval '4 seconds',now()-interval '3 seconds',repeat('5',64)),
         (v_obj,'r1-selftest-b','PASS',true,repeat('a',64),now()-interval '2 seconds',now()-interval '1 second',repeat('6',64));
  v_json := destruktion_meta.compute_restore_quorum_status_h205f22(v_obj,now(),interval '7 days');
  if (v_json->>'status') <> 'R3_PROVEN' then raise exception 'synthetic restore quorum logic failed: %',v_json; end if;

  -- H45 GC fail-close and retention protection.
  v_json := destruktion_meta.compute_continuity_gc_admission_h205f22('BACKUP_SET','unknown-r1-selftest',now());
  if (v_json->>'status') <> 'DELETE_BLOCKED_UNKNOWN_SUBJECT' then raise exception 'unknown subject GC did not fail-close: %',v_json; end if;

  insert into destruktion_meta.compute_continuity_retention_event_h205f22(lease_id,action,subject_kind,subject_id,lease_class,valid_until)
  values(v_lease,'ACQUIRE','BACKUP_SET','r1-selftest-object','RECOVERY_CRITICAL',now()+interval '1 day') returning event_id into v_acq;
  v_json := destruktion_meta.compute_continuity_gc_admission_h205f22('BACKUP_SET','r1-selftest-object',now());
  if (v_json->>'status') <> 'DELETE_BLOCKED_RETENTION' then raise exception 'retention did not block GC: %',v_json; end if;

  begin
    insert into destruktion_meta.compute_continuity_retention_event_h205f22(lease_id,action,subject_kind,subject_id,lease_class,release_of_event_id)
    values(gen_random_uuid(),'RELEASE','BACKUP_SET','wrong-subject','RECOVERY_CRITICAL',v_acq);
    raise exception 'mismatched release incorrectly accepted';
  exception when check_violation then null;
  end;

  -- H46 deterministic recovery graph + post-seal immutability.
  insert into destruktion_meta.compute_continuity_recovery_graph_node_h205f22(graph_key,node_kind,node_key,node_sha256)
  values('r1-selftest-graph','ARTIFACT','b',repeat('b',64)),('r1-selftest-graph','CHECKPOINT','a',repeat('a',64));
  v_json := destruktion_meta.compute_finalize_recovery_graph_h205f22('r1-selftest-graph',v_obj);
  if (v_json->>'status') <> 'SEALED' then raise exception 'recovery graph seal failed: %',v_json; end if;
  begin
    insert into destruktion_meta.compute_continuity_recovery_graph_node_h205f22(graph_key,node_kind,node_key,node_sha256)
    values('r1-selftest-graph','ARTIFACT','c',repeat('c',64));
    raise exception 'post-seal graph mutation incorrectly accepted';
  exception when object_not_in_prerequisite_state then null;
  end;

  -- H48 append-only checkpoint ledger.
  insert into destruktion_meta.compute_continuity_checkpoint_ledger_h205f22(continuity_checkpoint_id,semantic_head_checkpoint_id,state,evidence_sha256,evidence)
  values('r1-selftest-ledger','metaengine-h205f22-recovery-dev-20260821-cp071','TESTED',repeat('7',64),'{"synthetic":true,"rollback":true}');
  begin
    update destruktion_meta.compute_continuity_checkpoint_ledger_h205f22 set state='EVIDENCE_READY' where continuity_checkpoint_id='r1-selftest-ledger';
    raise exception 'append-only ledger update accepted';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    delete from destruktion_meta.compute_continuity_checkpoint_ledger_h205f22 where continuity_checkpoint_id='r1-selftest-ledger';
    raise exception 'append-only ledger delete accepted';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;

rollback;

select jsonb_build_object(
  'status','PASS',
  'mode','SYNTHETIC_ROLLBACK_ONLY',
  'persisted_durability_evidence',false,
  'r2_production_claim',false,
  'r3_production_claim',false
) as r1_semantic_selftest;
