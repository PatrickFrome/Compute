-- Must run inside an explicit transaction that is rolled back by the operator.
-- All inserted commands are uncommitted, synthetic and assigned to an absent client.

do $canary$
declare
  v_target jsonb := jsonb_build_object('schema','metaengine.computer-target-identity.v1',
    'machine_fingerprint_sha256',repeat('a',64),'session_id',1,'process_id',4242,
    'window_handle','0x1234','executable_sha256',repeat('b',64),
    'process_creation_time_ms',1700000000000::bigint,'generation',9);
  v_digest text := '2e80d034612b7b5788a653cea9fca6da1c0dbf0380fccae7ed2621120ef45252';
  v_workspace uuid := gen_random_uuid();
  v_client text := gen_random_uuid()::text;
  v_command uuid := gen_random_uuid();
  v_payload jsonb;
  v_binding jsonb;
  v_receipt jsonb;
  v_bad jsonb;
  v_reply jsonb;
  v_case text;
  v_kind text;
  v_field text;
  v_alias jsonb;
  v_function text;
  v_key text;
  v_result_state text;
  v_result_effect boolean;
  v_tests integer := 0;
begin
  if destruktion_meta.computer_target_digest_v1(v_target) is distinct from v_digest then
    raise exception 'canary_js_postgres_digest_disagrees';
  end if;
  foreach v_field in array array['machine_fingerprint_sha256','session_id','process_id','window_handle','executable_sha256','process_creation_time_ms','generation'] loop
    if destruktion_meta.computer_target_digest_v1(v_target-v_field) is not null then raise exception 'canary_missing_identity_accepted:%',v_field; end if;
    foreach v_alias in array array['null'::jsonb,'false'::jsonb,'[]'::jsonb,'{}'::jsonb] loop
      if destruktion_meta.computer_target_digest_v1(jsonb_set(v_target,array[v_field],v_alias)) is not null then
        raise exception 'canary_identity_alias_accepted:%',v_field;
      end if;
      v_tests := v_tests+1;
    end loop;
    v_tests := v_tests+1;
  end loop;
  foreach v_field in array array['session_id','process_id','process_creation_time_ms','generation'] loop
    if destruktion_meta.computer_target_digest_v1(jsonb_set(v_target,array[v_field],to_jsonb(v_target->>v_field))) is not null then
      raise exception 'canary_numeric_string_identity_accepted:%',v_field;
    end if;
    v_tests := v_tests+1;
  end loop;
  for v_case,v_kind in select * from (values
    ('UIA_FOCUS','UIA_FOCUS_EXACT'),('UIA_SET_VALUE','UIA_VALUE_EXACT'),
    ('UIA_TOGGLE','UIA_TOGGLE_STATE_CHANGED'),('UIA_SELECT','UIA_SELECTION_EXACT'),
    ('UIA_EXPAND_COLLAPSE','UIA_EXPAND_STATE_EXACT'),('UIA_SCROLL','UIA_SCROLL_PERCENT_CHANGED'),('TYPE_TEXT','UIA_VALUE_EXACT')
  ) as kinds(action,kind) loop
    v_payload := jsonb_build_object('action',v_case,'agent_id','agent_audit-canary01','target',v_target,'target_identity_sha256',v_digest);
    v_binding := jsonb_build_object('schema','metaengine.native-supervisor.computer-effect-binding.v1',
      'command_id',v_command::text,'client_id',v_client,'action','COMPUTER_ACTION','computer_action',v_case,
      'agent_id','agent_audit-canary01','target',v_target,'target_identity_sha256',v_digest,
      'idempotency_key','canary:initial:proof','authority_effect',false,'page_data_authority',false,'automatic_retry_allowed',false);
    v_receipt := jsonb_build_object('schema','metaengine.computer-effect-receipt.v1','command_id',v_command::text,
      'agent_id','agent_audit-canary01','action',v_case,'target_identity_sha256',v_digest,
      'outcome','EFFECT_PROVEN','effect_outcome','CONFIRMED','authority_effect',true,
      'automatic_retry_allowed',false,'scheduler_authority',false,'page_data_authority',false,
      'result',jsonb_build_object('schema','metaengine.windows-computer-executor.effect.v1','action',v_case,
        'ok',true,'effect_started',true,'readback_proven',true,'readback_kind',v_kind,'target',v_target));
    if destruktion_meta.computer_effect_readback_valid_v1(v_payload,v_binding,v_receipt,v_command) is not true then
      raise exception 'canary_positive_proof_rejected:%',v_case;
    end if;
    foreach v_bad in array array[
      jsonb_set(v_receipt,'{result,readback_kind}','"DELIVERY_ONLY"'::jsonb),
      jsonb_set(v_receipt,'{result,schema}','"wrong.bridge"'::jsonb),
      jsonb_set(v_receipt,'{result,action}','"WRONG_ACTION"'::jsonb),
      jsonb_set(v_receipt,'{result,target,session_id}','"1"'::jsonb),
      jsonb_set(v_receipt,'{result,target,generation}','10'::jsonb),
      jsonb_set(v_receipt,'{result,effect_started}','false'::jsonb)
    ] loop
      if destruktion_meta.computer_effect_readback_valid_v1(v_payload,v_binding,v_bad,v_command) is not false then
        raise exception 'canary_forged_proof_accepted:%',v_case;
      end if;
      v_tests := v_tests+1;
    end loop;
    v_tests := v_tests+1;
  end loop;
  foreach v_case in array array['UIA_INVOKE','KEY_PRESS','POINTER_CLICK'] loop
    v_bad := jsonb_set(jsonb_set(v_receipt,'{action}',to_jsonb(v_case)),'{result,action}',to_jsonb(v_case));
    if destruktion_meta.computer_effect_readback_valid_v1(jsonb_set(v_payload,'{action}',to_jsonb(v_case)),v_binding||jsonb_build_object('computer_action',v_case),v_bad,v_command) is not false then
      raise exception 'canary_dispatch_only_claimed_proof:%',v_case;
    end if;
    v_tests := v_tests+1;
  end loop;
  v_receipt := v_receipt || jsonb_build_object('outcome','NO_EFFECT_PROVEN','effect_outcome','NO_EFFECT_PROVEN','authority_effect',false,'result',jsonb_build_object('effect_started',false));
  if destruktion_meta.computer_effect_readback_valid_v1(v_payload,v_binding,v_receipt,v_command) is not true then raise exception 'canary_explicit_no_effect_rejected'; end if;
  foreach v_alias in array array['null'::jsonb,'"false"'::jsonb,'true'::jsonb] loop
    if destruktion_meta.computer_effect_readback_valid_v1(v_payload,v_binding,jsonb_set(v_receipt,'{result,effect_started}',v_alias),v_command) is not false then
      raise exception 'canary_unknown_effect_boundary_accepted';
    end if;
    v_tests := v_tests+1;
  end loop;
  if destruktion_meta.computer_effect_readback_valid_v1(v_payload,v_binding,v_receipt||'{"result":{}}'::jsonb,v_command) is not false then raise exception 'canary_missing_effect_boundary_accepted'; end if;
  v_tests := v_tests+2;

  foreach v_function in array array['complete_v5','complete_v6','complete_v7','complete_batch_v1'] loop
    foreach v_case in array array['FORGED','NO_EFFECT','CONFIRMED','NO_BINDING'] loop
      v_command := gen_random_uuid();
      v_key := 'canary:'||v_command::text;
      v_binding := v_binding || jsonb_build_object('command_id',v_command::text,'idempotency_key',v_key);
      v_bad := v_receipt || jsonb_build_object('command_id',v_command::text);
      if v_case<>'NO_EFFECT' then
        v_bad := v_bad || jsonb_build_object('outcome','EFFECT_PROVEN','effect_outcome','CONFIRMED','authority_effect',true,
          'result',jsonb_build_object('schema','metaengine.windows-computer-executor.effect.v1','action',v_payload->>'action',
            'ok',true,'effect_started',true,'readback_proven',true,'readback_kind','UIA_VALUE_EXACT','target',v_target));
      end if;
      if v_case='FORGED' then v_bad := jsonb_set(v_bad,'{result,readback_kind}','"DELIVERY_ONLY"'::jsonb); end if;
      insert into public.compute_fabric_a2_browser_supervisor_command_h205f22(
        command_id,workspace_id,target_client_id,issued_by,action,payload,status,expires_at,leased_by,leased_at,idempotency_key,
        effect_binding,effect_bound_at,effect_binding_sha256
      ) values(v_command,v_workspace,v_client,'SYNTHETIC_ROLLBACK_CANARY','COMPUTER_ACTION',v_payload,'LEASED',
        clock_timestamp()+interval '5 minutes',v_client,clock_timestamp(),v_key,
        case when v_case='NO_BINDING' then null else v_binding end,
        case when v_case='NO_BINDING' then null else clock_timestamp() end,
        case when v_case='NO_BINDING' then null else encode(extensions.digest(v_binding::text,'sha256'),'hex') end);
      if v_function='complete_batch_v1' then
        v_reply := public.h205f22_a2_browser_supervisor_complete_batch_v1(v_workspace,v_client,
          jsonb_build_array(jsonb_build_object('command_id',v_command,'ok',true,'receipt',v_bad)));
      else
        execute format('select public.h205f22_a2_browser_supervisor_%I($1,$2,$3,true,$4,null,false)',v_function)
          into v_reply using v_workspace,v_command,v_client,v_bad;
      end if;
      select status,authority_effect into v_result_state,v_result_effect
        from public.compute_fabric_a2_browser_supervisor_command_h205f22 where command_id=v_command;
      if v_case in ('FORGED','NO_BINDING') and (v_result_state<>'FAILED' or v_result_effect is distinct from false) then
        raise exception 'canary_rpc_invalid_proof_completed:%:%',v_function,v_case;
      elsif v_case='NO_EFFECT' and (v_result_state<>'COMPLETED' or v_result_effect is distinct from false) then
        raise exception 'canary_rpc_no_effect_wrong:%',v_function;
      elsif v_case='CONFIRMED' and (v_result_state<>'COMPLETED' or v_result_effect is distinct from true) then
        raise exception 'canary_rpc_positive_wrong:%',v_function;
      end if;
      if v_function<>'complete_batch_v1' then
        execute format('select public.h205f22_a2_browser_supervisor_%I($1,$2,$3,true,$4,null,false)',v_function)
          into v_reply using v_workspace,v_command,v_client,v_bad;
        if v_reply->'accepted' is distinct from 'false'::jsonb then raise exception 'canary_terminal_attempt_reopened:%',v_function; end if;
        v_tests := v_tests+1;
      end if;
      v_tests := v_tests+1;
    end loop;
  end loop;
  if v_tests<>124 then raise exception 'canary_assertion_count_mismatch:%',v_tests; end if;
end;
$canary$;
select 'SYNTHETIC_DB_TRANSACTION_ROLLBACK' as evidence_kind,124 as assertions, false as physical_effects_executed;
