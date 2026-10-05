-- Execute only inside a transaction followed by ROLLBACK; no production checkpoint survives.
do $canary$
declare
  v_id text := encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  v_hash text;
  v_tests integer := 0;
begin
  perform set_config('lock_timeout','3s',true);
  insert into destruktion_meta.metaengine_audit_checkpoint_v1(
    checkpoint_id,project_ref,source_parent_sha,evidence_state,payload)
    values(v_id,'jhriwwsryeqsvvvufkok',repeat('a',40),'PARTIAL','{"kind":"SYNTHETIC_ROLLBACK_CANARY"}'::jsonb)
    returning payload_sha256 into v_hash;
  if v_hash is distinct from encode(extensions.digest('{"kind": "SYNTHETIC_ROLLBACK_CANARY"}','sha256'),'hex') then
    raise exception 'checkpoint_canary_generated_hash_mismatch';
  end if;
  v_tests := v_tests+1;
  begin
    update destruktion_meta.metaengine_audit_checkpoint_v1 set evidence_state='LIVE_DB_ONLY' where checkpoint_id=v_id;
    raise exception 'checkpoint_canary_update_allowed';
  exception when raise_exception then
    if sqlerrm<>'audit_checkpoint_is_append_only' then raise; end if;
    v_tests := v_tests+1;
  end;
  begin
    delete from destruktion_meta.metaengine_audit_checkpoint_v1 where checkpoint_id=v_id;
    raise exception 'checkpoint_canary_delete_allowed';
  exception when raise_exception then
    if sqlerrm<>'audit_checkpoint_is_append_only' then raise; end if;
    v_tests := v_tests+1;
  end;
  begin
    truncate destruktion_meta.metaengine_audit_checkpoint_v1;
    raise exception 'checkpoint_canary_truncate_allowed';
  exception when raise_exception then
    if sqlerrm<>'audit_checkpoint_is_append_only' then raise; end if;
    v_tests := v_tests+1;
  end;
  begin
    insert into destruktion_meta.metaengine_audit_checkpoint_v1(checkpoint_id,project_ref,source_parent_sha,evidence_state,payload)
      values(v_id,'jhriwwsryeqsvvvufkok',repeat('a',40),'PARTIAL','{}'::jsonb);
    raise exception 'checkpoint_canary_overwrite_allowed';
  exception when unique_violation then v_tests := v_tests+1;
  end;
  if not exists(select 1 from destruktion_meta.metaengine_audit_checkpoint_v1
    where checkpoint_id=v_id and evidence_state='PARTIAL' and not canonical_checkpoint and not authority_effect
      and scope='OPERATIONAL_AUDIT_ONLY' and payload_sha256=v_hash) then
    raise exception 'checkpoint_canary_mutated_state';
  end if;
  v_tests := v_tests+1;
  if v_tests<>6 then raise exception 'checkpoint_canary_count_mismatch:%',v_tests; end if;
end;
$canary$;
