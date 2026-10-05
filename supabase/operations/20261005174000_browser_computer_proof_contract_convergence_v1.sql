-- Live-specific convergence, not a replay of historical migration artifacts.
-- Expected pg_proc hashes prevent overwriting concurrent or unknown definitions.
-- The single DO statement makes all changes atomic even without an outer transaction.

do $migration$
declare
  v_name text;
  v_signature text;
  v_expected text;
  v_definition text;
  v_oid oid;
  v_marker text;
  v_patch text;
  v_count integer;
begin
  perform pg_catalog.set_config('lock_timeout','3s',true);
  perform pg_catalog.set_config('statement_timeout','25s',true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('metaengine:computer-proof-convergence:v1',0));
  for v_name,v_signature,v_expected in select * from (values
    ('issue_computer_v1','public.h205f22_a2_browser_supervisor_issue_computer_v1(text,text,jsonb,integer,text,text)','94f0442f7911dd33028354712c9b575c66f101ee8c7667428ea725d513832a2b'),
    ('bind_effect_v1','public.h205f22_a2_browser_supervisor_bind_effect_v1(uuid,uuid,text,jsonb,boolean)','f0b798bb86b6f452b4b7561bd478532adaae73c9000bab0576e999e0410be44f'),
    ('complete_v5','public.h205f22_a2_browser_supervisor_complete_v5(uuid,uuid,text,boolean,jsonb,text,boolean)','81126770bbbedd605da3ed5df0eae1f2334af1b01068c26d2331f224f87d615e'),
    ('complete_v6','public.h205f22_a2_browser_supervisor_complete_v6(uuid,uuid,text,boolean,jsonb,text,boolean)','87a21f2ec06465b52ce4621f72394f6dc191d389106eff7913c9f5c81885caae'),
    ('complete_v7','public.h205f22_a2_browser_supervisor_complete_v7(uuid,uuid,text,boolean,jsonb,text,boolean)','922e4449536854e39c32441342a69e3da3c66f3e02c71de42fb59b2cf6d9a34f'),
    ('complete_batch_v1','public.h205f22_a2_browser_supervisor_complete_batch_v1(uuid,text,jsonb)','0b291d9f4c41b78146d3f0d3fc1a9b0d75e462e4f5dde4d6e88f50d1f0ed4b54')
  ) as expected(name,signature,sha256) loop
    v_oid := pg_catalog.to_regprocedure(v_signature);
    if v_oid is null then raise exception 'proof_convergence_function_missing:%',v_name; end if;
    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    if pg_catalog.encode(extensions.digest(v_definition,'sha256'),'hex') is distinct from v_expected then
      raise exception 'proof_convergence_baseline_drift:%',v_name;
    end if;
    if pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE') then
      raise exception 'proof_convergence_unexpected_public_acl:%',v_name;
    end if;
  end loop;
  if pg_catalog.to_regprocedure('destruktion_meta.computer_target_digest_v1(jsonb)') is not null
     or pg_catalog.to_regprocedure('destruktion_meta.computer_effect_readback_valid_v1(jsonb,jsonb,jsonb,uuid)') is not null
     or pg_catalog.to_regclass('destruktion_meta.metaengine_audit_checkpoint_v1') is not null then
    raise exception 'proof_convergence_preexisting_artifact';
  end if;

  execute $target_definition$
  create function destruktion_meta.computer_target_digest_v1(p_target jsonb)
  returns text language plpgsql immutable set search_path = '' as $function$
  declare
    v_field text;
    v_number numeric;
  begin
    if jsonb_typeof(p_target) is distinct from 'object' then return null; end if;
    foreach v_field in array array['machine_fingerprint_sha256','executable_sha256','window_handle'] loop
      if jsonb_typeof(p_target->v_field) is distinct from 'string' then return null; end if;
    end loop;
    if lower(p_target->>'machine_fingerprint_sha256') !~ '^[0-9a-f]{64}$'
       or lower(p_target->>'executable_sha256') !~ '^[0-9a-f]{64}$'
       or lower(p_target->>'window_handle') !~ '^0x[0-9a-f]+$' then return null; end if;
    foreach v_field in array array['session_id','process_id','process_creation_time_ms','generation'] loop
      if jsonb_typeof(p_target->v_field) is distinct from 'number' then return null; end if;
      v_number := (p_target->>v_field)::numeric;
      if v_number<>trunc(v_number) or v_number>9007199254740991
         or (v_field='session_id' and v_number<0) or (v_field<>'session_id' and v_number<=0) then return null; end if;
    end loop;
    return encode(extensions.digest(array_to_string(array[
      lower(p_target->>'machine_fingerprint_sha256'),(p_target->>'session_id')::bigint::text,
      (p_target->>'process_id')::bigint::text,(p_target->>'process_creation_time_ms')::bigint::text,
      lower(p_target->>'window_handle'),lower(p_target->>'executable_sha256'),(p_target->>'generation')::bigint::text
    ],'|'),'sha256'),'hex');
  exception when numeric_value_out_of_range or invalid_text_representation then return null;
  end;
  $function$
  $target_definition$;

  execute $proof_definition$
  create function destruktion_meta.computer_effect_readback_valid_v1(p_payload jsonb,p_binding jsonb,p_receipt jsonb,p_command_id uuid)
  returns boolean language plpgsql immutable set search_path = '' as $function$
  declare
    v_action text := upper(trim(coalesce(p_payload->>'action','')));
    v_digest text;
    v_kind text;
    v_result jsonb := p_receipt->'result';
  begin
    if p_command_id is null
       or v_action not in ('UIA_FOCUS','UIA_INVOKE','UIA_SET_VALUE','UIA_TOGGLE','UIA_SELECT','UIA_EXPAND_COLLAPSE','UIA_SCROLL','TYPE_TEXT','KEY_PRESS','POINTER_CLICK')
       or jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_binding) is distinct from 'object'
       or jsonb_typeof(p_payload->'agent_id') is distinct from 'string'
       or coalesce(p_payload->>'agent_id','') !~ '^agent_[A-Za-z0-9-]{8,64}$'
       or p_binding->>'schema' is distinct from 'metaengine.native-supervisor.computer-effect-binding.v1'
       or p_binding->>'command_id' is distinct from p_command_id::text
       or p_binding->>'computer_action' is distinct from v_action
       or jsonb_typeof(p_receipt) is distinct from 'object' or jsonb_typeof(v_result) is distinct from 'object'
       or p_receipt->>'schema' is distinct from 'metaengine.computer-effect-receipt.v1'
       or p_receipt->>'command_id' is distinct from p_command_id::text
       or p_receipt->>'action' is distinct from v_action
       or lower(p_receipt->>'agent_id') is distinct from lower(p_payload->>'agent_id')
       or p_receipt->'automatic_retry_allowed' is distinct from 'false'::jsonb
       or p_receipt->'scheduler_authority' is distinct from 'false'::jsonb
       or p_receipt->'page_data_authority' is distinct from 'false'::jsonb then return false; end if;
    v_digest := destruktion_meta.computer_target_digest_v1(p_payload->'target');
    if v_digest is null or p_payload->>'target_identity_sha256' is distinct from v_digest
       or p_binding->>'target_identity_sha256' is distinct from v_digest
       or destruktion_meta.computer_target_digest_v1(p_binding->'target') is distinct from v_digest
       or p_receipt->>'target_identity_sha256' is distinct from v_digest then return false; end if;
    if p_receipt->>'effect_outcome'='NO_EFFECT_PROVEN' then
      return p_receipt->>'outcome' is not distinct from 'NO_EFFECT_PROVEN'
        and p_receipt->'authority_effect' is not distinct from 'false'::jsonb
        and v_result->'effect_started' is not distinct from 'false'::jsonb;
    end if;
    v_kind := case v_action
      when 'UIA_FOCUS' then 'UIA_FOCUS_EXACT'
      when 'UIA_SET_VALUE' then 'UIA_VALUE_EXACT'
      when 'UIA_TOGGLE' then 'UIA_TOGGLE_STATE_CHANGED'
      when 'UIA_SELECT' then 'UIA_SELECTION_EXACT'
      when 'UIA_EXPAND_COLLAPSE' then 'UIA_EXPAND_STATE_EXACT'
      when 'UIA_SCROLL' then 'UIA_SCROLL_PERCENT_CHANGED'
      when 'TYPE_TEXT' then 'UIA_VALUE_EXACT'
      else null end;
    return coalesce(v_kind is not null
      and p_receipt->>'effect_outcome'='CONFIRMED' and p_receipt->>'outcome'='EFFECT_PROVEN'
      and p_receipt->'authority_effect'='true'::jsonb
      and v_result->>'schema'='metaengine.windows-computer-executor.effect.v1'
      and v_result->>'action'=v_action and v_result->'ok'='true'::jsonb
      and v_result->'effect_started'='true'::jsonb and v_result->'readback_proven'='true'::jsonb
      and v_result->>'readback_kind'=v_kind
      and destruktion_meta.computer_target_digest_v1(v_result->'target')=v_digest,false);
  end;
  $function$
  $proof_definition$;
  revoke all on function destruktion_meta.computer_target_digest_v1(jsonb) from public,anon,authenticated;
  revoke all on function destruktion_meta.computer_effect_readback_valid_v1(jsonb,jsonb,jsonb,uuid) from public,anon,authenticated;
  grant execute on function destruktion_meta.computer_target_digest_v1(jsonb) to service_role;
  grant execute on function destruktion_meta.computer_effect_readback_valid_v1(jsonb,jsonb,jsonb,uuid) to service_role;

  foreach v_signature in array array[
    'public.h205f22_a2_browser_supervisor_complete_v5(uuid,uuid,text,boolean,jsonb,text,boolean)',
    'public.h205f22_a2_browser_supervisor_complete_batch_v1(uuid,text,jsonb)'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_signature);
    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    v_marker := 'v_outcome := upper(coalesce(v_receipt->>''effect_outcome'',''''));';
    v_count := (length(v_definition)-length(replace(v_definition,v_marker,'')))/length(v_marker);
    if v_count<>1 then raise exception 'proof_convergence_completion_marker_mismatch'; end if;
    v_patch := v_marker || E'\n    if v_ok and v_row.action=''COMPUTER_ACTION''\n       and destruktion_meta.computer_effect_readback_valid_v1(v_row.payload,v_row.effect_binding,v_receipt,v_row.command_id) is not true then\n      v_ok := false;\n      v_error := ''computer_effect_readback_not_proven'';\n    end if;';
    v_definition := replace(v_definition,v_marker,v_patch);
    v_definition := replace(v_definition,'and not (v_row.action=''COMPUTER_ACTION'' and v_outcome=''NO_EFFECT_PROVEN'')','and v_outcome is distinct from ''NO_EFFECT_PROVEN''');
    if v_signature like '%complete_v5(%' then
      v_definition := replace(v_definition,'v_ok and v_row.action=''COMPUTER_ACTION'' and v_outcome not in','v_ok and v_row.action = any(v_bound_effect_actions) and v_outcome not in');
    end if;
    execute v_definition;
    execute format('alter function %s set search_path = %L',v_oid::regprocedure,'');
  end loop;

  foreach v_signature in array array[
    'public.h205f22_a2_browser_supervisor_complete_v6(uuid,uuid,text,boolean,jsonb,text,boolean)',
    'public.h205f22_a2_browser_supervisor_complete_v7(uuid,uuid,text,boolean,jsonb,text,boolean)'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_signature);
    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    v_marker := 'if not found then raise exception ''supervisor_command_not_found''; end if;';
    v_count := (length(v_definition)-length(replace(v_definition,v_marker,'')))/length(v_marker);
    if v_count<>1 then raise exception 'proof_convergence_version_marker_mismatch'; end if;
    v_patch := v_marker || E'\n  if p_authority_effect is distinct from false then raise exception ''supervisor_result_authority_effect_invalid''; end if;\n  if v_row.action in (''STOP_GENERATION'',''SCROLL'',''SEMANTIC_FOCUS'',''SEMANTIC_TYPE'',''TYPED_CLICK'',''COMPUTER_ACTION'') then\n    return public.h205f22_a2_browser_supervisor_complete_v5(p_workspace_id,p_command_id,p_client_id,p_ok,p_receipt,p_error,p_authority_effect);\n  end if;';
    execute replace(v_definition,v_marker,v_patch);
    execute format('alter function %s set search_path = %L',v_oid::regprocedure,'');
  end loop;

  v_oid := pg_catalog.to_regprocedure('public.h205f22_a2_browser_supervisor_issue_computer_v1(text,text,jsonb,integer,text,text)');
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_marker := 'select * into v_state';
  if (length(v_definition)-length(replace(v_definition,v_marker,'')))/length(v_marker)<>1 then
    raise exception 'proof_convergence_issuer_marker_mismatch';
  end if;
  v_patch := $issuer_patch$
  if v_action='COMPUTER_ACTION' or (v_action='COMPUTER_OBSERVE' and v_subaction in ('UIA_SNAPSHOT','CAPTURE_WINDOW','VERIFY_TARGET')) then
    if destruktion_meta.computer_target_digest_v1(p_payload->'target') is null then
      raise exception 'computer_target_native_identity_invalid';
    end if;
    if p_payload->>'target_identity_sha256' is distinct from destruktion_meta.computer_target_digest_v1(p_payload->'target') then
      raise exception 'computer_target_identity_digest_mismatch';
    end if;
  end if;
  if v_subaction='POINTER_CLICK' and (jsonb_typeof(p_payload#>'{args,visual_fence}') is distinct from 'object'
      or coalesce(p_payload#>>'{args,visual_fence,frame_sha256}','') !~ '^[0-9a-f]{64}$') then
    raise exception 'computer_visual_frame_fence_required';
  end if;
  select * into v_state
  $issuer_patch$;
  v_definition := replace(v_definition,v_marker,v_patch);
  v_marker := E'''UIA_EXPAND_COLLAPSE'',''UIA_SCROLL''\n  ) and coalesce';
  if strpos(v_definition,v_marker)=0 then raise exception 'proof_convergence_v2_attestation_marker_mismatch'; end if;
  v_definition := replace(v_definition,v_marker,E'''UIA_EXPAND_COLLAPSE'',''UIA_SCROLL'',''POINTER_CLICK''\n  ) and coalesce');
  execute v_definition;
  execute format('alter function %s set search_path = %L',v_oid::regprocedure,'');

  create table destruktion_meta.metaengine_audit_checkpoint_v1(
    checkpoint_id text primary key check(checkpoint_id ~ '^[0-9a-f]{64}$'),
    project_ref text not null check(project_ref='jhriwwsryeqsvvvufkok'),
    source_parent_sha text not null check(source_parent_sha ~ '^[0-9a-f]{40}$'),
    evidence_state text not null check(evidence_state in ('LIVE_DB_ONLY','EVIDENCE_READY','PARTIAL')),
    scope text not null default 'OPERATIONAL_AUDIT_ONLY' check(scope='OPERATIONAL_AUDIT_ONLY'),
    canonical_checkpoint boolean not null default false check(canonical_checkpoint=false),
    authority_effect boolean not null default false check(authority_effect=false),
    payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=262144),
    payload_sha256 text generated always as (encode(extensions.digest(payload::text,'sha256'),'hex')) stored,
    created_at timestamptz not null default clock_timestamp()
  );
  alter table destruktion_meta.metaengine_audit_checkpoint_v1 enable row level security;
  revoke all on table destruktion_meta.metaengine_audit_checkpoint_v1 from public,anon,authenticated,service_role;
  grant select,insert on table destruktion_meta.metaengine_audit_checkpoint_v1 to service_role;
  execute $checkpoint_definition$
  create function destruktion_meta.reject_audit_checkpoint_mutation_v1()
  returns trigger language plpgsql set search_path = '' as $function$
  begin raise exception 'audit_checkpoint_is_append_only'; end;
  $function$
  $checkpoint_definition$;
  revoke all on function destruktion_meta.reject_audit_checkpoint_mutation_v1() from public,anon,authenticated;
  create trigger metaengine_audit_checkpoint_immutable before update or delete
    on destruktion_meta.metaengine_audit_checkpoint_v1 for each row
    execute function destruktion_meta.reject_audit_checkpoint_mutation_v1();
  create trigger metaengine_audit_checkpoint_no_truncate before truncate
    on destruktion_meta.metaengine_audit_checkpoint_v1 for each statement
    execute function destruktion_meta.reject_audit_checkpoint_mutation_v1();
end;
$migration$;
