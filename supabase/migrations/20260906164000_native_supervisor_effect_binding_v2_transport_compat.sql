-- Final effect-binding v2 definition: preserve the proven v1 JSON-string transport
-- normalization while accepting strict v2 runtime generation evidence. DB lease
-- remains the sole authority and immutable replay semantics remain unchanged.

create or replace function public.h205f22_a2_browser_supervisor_bind_effect_v1(
  p_workspace_id uuid,
  p_command_id uuid,
  p_client_id text,
  p_binding jsonb,
  p_authority_effect boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_binding jsonb := p_binding;
  v_digest text;
  v_replayed boolean := false;
  v_schema text;
  v_tab_actions constant text[] := array[
    'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','TYPED_CLICK'
  ];
begin
  if p_authority_effect is distinct from false then raise exception 'native_effect_binding_authority_effect_invalid'; end if;
  if v_client = '' then raise exception 'native_effect_binding_client_required'; end if;

  -- Keep compatibility with the already-deployed v1 function, which tolerated a
  -- JSON string containing the binding object. New Edge callers send an object.
  if v_binding is not null and jsonb_typeof(v_binding) = 'string' then
    begin
      v_binding := (v_binding #>> '{}')::jsonb;
    exception when others then
      raise exception 'native_effect_binding_transport_invalid';
    end;
  end if;
  if v_binding is null or jsonb_typeof(v_binding) <> 'object' or octet_length(v_binding::text) > 8192 then
    raise exception 'native_effect_binding_object_invalid';
  end if;

  v_schema := coalesce(v_binding->>'schema','');
  if v_schema not in ('metaengine.native-supervisor.effect-binding.v1','metaengine.native-supervisor.effect-binding.v2') then
    raise exception 'native_effect_binding_schema_invalid';
  end if;
  if coalesce((v_binding->>'authority_effect')::boolean,true) is distinct from false
     or coalesce((v_binding->>'page_data_authority')::boolean,true) is distinct from false
     or coalesce((v_binding->>'automatic_retry_allowed')::boolean,true) is distinct from false then
    raise exception 'native_effect_binding_safety_flags_invalid';
  end if;
  if v_binding->>'command_id' <> p_command_id::text then raise exception 'native_effect_binding_command_mismatch'; end if;
  if v_binding->>'client_id' <> v_client then raise exception 'native_effect_binding_client_mismatch'; end if;
  if coalesce(v_binding->>'process_incarnation_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'native_effect_binding_process_incarnation_invalid';
  end if;
  if coalesce(v_binding->>'tab_id','') !~ '^tab_[0-9a-f-]{36}$' then raise exception 'native_effect_binding_tab_invalid'; end if;
  if coalesce(v_binding->>'target_id','') !~ '^webcontents:[1-9][0-9]*$' then raise exception 'native_effect_binding_target_invalid'; end if;

  if v_schema = 'metaengine.native-supervisor.effect-binding.v2' then
    if coalesce(v_binding->>'runtime_observation_id','') !~ '^obs_[0-9a-f]{32}$' then raise exception 'native_effect_binding_runtime_observation_id_invalid'; end if;
    if coalesce(v_binding->>'web_contents_id','') !~ '^[1-9][0-9]{0,15}$' then raise exception 'native_effect_binding_webcontents_invalid'; end if;
    if coalesce(v_binding->>'renderer_pid','') !~ '^[1-9][0-9]{0,15}$' then raise exception 'native_effect_binding_renderer_pid_invalid'; end if;
    if coalesce(v_binding->>'runtime_target_id','') !~ '^[A-Za-z0-9._:-]{1,192}$' then raise exception 'native_effect_binding_runtime_target_invalid'; end if;
    if coalesce(v_binding->>'attachment_generation','') !~ '^[1-9][0-9]{0,15}$' then raise exception 'native_effect_binding_attachment_generation_invalid'; end if;
    if coalesce(v_binding->>'document_generation','') !~ '^[1-9][0-9]{0,15}$' then raise exception 'native_effect_binding_document_generation_invalid'; end if;
    if coalesce(v_binding->>'binding_generation','') !~ '^[1-9][0-9]{0,15}$' then raise exception 'native_effect_binding_generation_invalid'; end if;
    if coalesce(v_binding->>'document_url_sha256','') !~ '^[0-9a-f]{64}$' then raise exception 'native_effect_binding_document_url_hash_invalid'; end if;
    if v_binding->>'runtime_observation_schema' is distinct from 'metaengine.native-supervisor.effect-runtime-observation.v1' then
      raise exception 'native_effect_binding_runtime_observation_schema_invalid';
    end if;
    if v_binding->>'target_id' is distinct from ('webcontents:' || (v_binding->>'web_contents_id')) then
      raise exception 'native_effect_binding_webcontents_target_mismatch';
    end if;
  end if;

  select * into v_row
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where workspace_id=p_workspace_id and command_id=p_command_id
   for update;
  if not found then raise exception 'native_effect_binding_command_not_found'; end if;
  if v_row.status <> 'LEASED' then raise exception 'native_effect_binding_command_not_leased'; end if;
  if v_row.leased_by is distinct from v_client then raise exception 'native_effect_binding_wrong_lease_holder'; end if;
  if v_row.leased_at is null or v_row.expires_at <= clock_timestamp() then raise exception 'native_effect_binding_lease_expired'; end if;
  if not (v_row.action = any(v_tab_actions)) then raise exception 'native_effect_binding_action_not_tab_effect'; end if;
  if v_row.idempotency_key is null or v_binding->>'idempotency_key' is distinct from v_row.idempotency_key then
    raise exception 'native_effect_binding_idempotency_mismatch';
  end if;
  if v_binding->>'action' is distinct from v_row.action then raise exception 'native_effect_binding_action_mismatch'; end if;
  if v_row.payload->>'tab_id' is null or v_binding->>'tab_id' is distinct from v_row.payload->>'tab_id' then
    raise exception 'native_effect_binding_explicit_tab_mismatch';
  end if;
  if (v_binding->>'command_expires_at')::timestamptz is distinct from v_row.expires_at then
    raise exception 'native_effect_binding_expiry_mismatch';
  end if;

  if v_row.effect_binding is not null then
    if v_row.effect_binding is distinct from v_binding then raise exception 'native_effect_binding_conflict'; end if;
    v_replayed := true;
    return jsonb_build_object(
      'accepted',true,'replayed',true,'command_id',v_row.command_id,
      'effect_binding',v_row.effect_binding,'effect_binding_sha256',v_row.effect_binding_sha256,
      'effect_bound_at',v_row.effect_bound_at,'authority_effect',false
    );
  end if;

  v_digest := encode(extensions.digest(v_binding::text,'sha256'::text),'hex');
  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set effect_binding=v_binding,
         effect_bound_at=clock_timestamp(),
         effect_binding_sha256=v_digest
   where workspace_id=p_workspace_id and command_id=p_command_id;

  return jsonb_build_object(
    'accepted',true,'replayed',v_replayed,'command_id',p_command_id,
    'effect_binding',v_binding,'effect_binding_sha256',v_digest,
    'effect_bound_at',clock_timestamp(),'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_bind_effect_v1(uuid,uuid,text,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_bind_effect_v1(uuid,uuid,text,jsonb,boolean) to service_role;

comment on function public.h205f22_a2_browser_supervisor_bind_effect_v1(uuid,uuid,text,jsonb,boolean) is
  'Durably seals a leased Browser semantic effect. Accepts backward-compatible v1 transport and strict v2 runtime generation evidence; DB lease remains sole authority and ambiguous effects are never retried.';
