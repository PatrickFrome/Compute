-- Final Browser single-result completion fence.
-- Lease state/holder/expiry are checked before semantic effect evidence so an
-- unleased or foreign caller can never receive a binding-derived authority result.

create or replace function public.h205f22_a2_browser_supervisor_complete_v5(
  p_workspace_id uuid,
  p_command_id uuid,
  p_client_id text,
  p_ok boolean,
  p_receipt jsonb default '{}'::jsonb,
  p_error text default null,
  p_authority_effect boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_row public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_error text := left(coalesce(p_error,'command_failed'),500);
  v_effect boolean;
  v_receipt jsonb := coalesce(p_receipt,'{}'::jsonb);
  v_now timestamptz;
  v_binding_digest text;
  v_bound_effect_actions constant text[] := array[
    'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','TYPED_CLICK'
  ];
begin
  if p_workspace_id is null or p_command_id is null or v_client='' then
    raise exception 'supervisor_result_identity_invalid';
  end if;
  if p_authority_effect is distinct from false then
    raise exception 'supervisor_result_authority_effect_invalid';
  end if;
  if jsonb_typeof(v_receipt)='string' then
    begin
      v_receipt := (v_receipt #>> '{}')::jsonb;
    exception when others then
      raise exception 'supervisor_result_receipt_transport_invalid';
    end;
  end if;
  if jsonb_typeof(v_receipt)<>'object' then
    raise exception 'supervisor_result_receipt_invalid';
  end if;

  select * into v_row
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where workspace_id=p_workspace_id and command_id=p_command_id
   for update;
  if not found then raise exception 'supervisor_command_not_found'; end if;

  -- Authority ordering: prove the current DB lease before consulting any effect
  -- binding. This keeps error/readback semantics independent of caller-supplied or
  -- stale effect evidence.
  v_now := clock_timestamp();
  if v_row.status <> 'LEASED' or v_row.leased_by is distinct from v_client then
    return jsonb_build_object(
      'accepted',false,
      'status',v_row.status,
      'error','supervisor_lease_not_current',
      'authority_effect',false
    );
  end if;
  if v_row.expires_at <= v_now
     or v_row.leased_at is null
     or v_row.leased_at <= v_now - interval '10 minutes' then
    return jsonb_build_object(
      'accepted',false,
      'status','EXPIRED',
      'error','supervisor_lease_expired',
      'authority_effect',false
    );
  end if;

  -- Failure/uncertainty reporting does not need an effect binding. A successful
  -- semantic effect must prove the immutable DB-sealed intent for this exact lease.
  if coalesce(p_ok,false) and v_row.action = any(v_bound_effect_actions) then
    if v_row.effect_binding is null
       or v_row.effect_bound_at is null
       or coalesce(v_row.effect_binding_sha256,'') !~ '^[0-9a-f]{64}$'
       or coalesce(v_row.effect_binding->>'schema','') not in (
         'metaengine.native-supervisor.effect-binding.v1',
         'metaengine.native-supervisor.effect-binding.v2'
       )
       or v_row.idempotency_key is null
       or v_row.effect_binding->>'command_id' is distinct from v_row.command_id::text
       or v_row.effect_binding->>'client_id' is distinct from v_client
       or v_row.effect_binding->>'action' is distinct from v_row.action
       or v_row.effect_binding->>'idempotency_key' is distinct from v_row.idempotency_key
       or v_row.effect_binding->>'tab_id' is distinct from v_row.payload->>'tab_id'
       or coalesce((v_row.effect_binding->>'authority_effect')::boolean,true) is distinct from false
       or coalesce((v_row.effect_binding->>'page_data_authority')::boolean,true) is distinct from false
       or coalesce((v_row.effect_binding->>'automatic_retry_allowed')::boolean,true) is distinct from false then
      return jsonb_build_object(
        'accepted',false,
        'status','UNSEALED_EFFECT',
        'error','supervisor_effect_binding_required',
        'authority_effect',false
      );
    end if;
    v_binding_digest := encode(extensions.digest(v_row.effect_binding::text,'sha256'::text),'hex');
    if v_binding_digest is distinct from v_row.effect_binding_sha256 then
      return jsonb_build_object(
        'accepted',false,
        'status','UNSEALED_EFFECT',
        'error','supervisor_effect_binding_digest_mismatch',
        'authority_effect',false
      );
    end if;
  end if;

  v_effect := coalesce(p_ok,false) and v_row.action in (
    'ARM','DISARM','SET_SUPERVISOR_MODE','SET_MODE','STOP_GENERATION','SCROLL',
    'SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK',
    'NEW_TAB','SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD',
    'FLEET_RECONCILE','FLEET_SET_PROFILE',
    'DOWNLOAD_FILE','DOWNLOAD_CANCEL','SELF_UPDATE_CHECK','SELF_UPDATE_APPLY'
  );

  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status=case when coalesce(p_ok,false) then 'COMPLETED' else 'FAILED' end,
         completed_at=clock_timestamp(),
         receipt=case when coalesce(p_ok,false)
           then jsonb_set(v_receipt,'{authority_effect}',to_jsonb(v_effect),true)
           else null end,
         error=case when coalesce(p_ok,false) then null else v_error end,
         authority_effect=v_effect
   where workspace_id=p_workspace_id and command_id=p_command_id
     and status='LEASED' and leased_by=v_client
     and expires_at>clock_timestamp() and leased_at is not null
     and leased_at>clock_timestamp()-interval '10 minutes'
  returning * into v_row;

  if found then
    return jsonb_build_object(
      'accepted',true,
      'status',v_row.status,
      'authority_effect',v_row.authority_effect
    );
  end if;

  -- The lease can expire between the precheck and completion UPDATE. Re-read only
  -- durable lease state; never retry the physical effect.
  select * into v_row
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where workspace_id=p_workspace_id and command_id=p_command_id;
  if v_row.status='LEASED' and v_row.leased_by=v_client then
    return jsonb_build_object(
      'accepted',false,
      'status','EXPIRED',
      'error','supervisor_lease_expired',
      'authority_effect',false
    );
  end if;
  return jsonb_build_object(
    'accepted',false,
    'status',v_row.status,
    'error','supervisor_lease_not_current',
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_complete_v5(uuid,uuid,text,boolean,jsonb,text,boolean)
  from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_complete_v5(uuid,uuid,text,boolean,jsonb,text,boolean)
  to service_role;

comment on function public.h205f22_a2_browser_supervisor_complete_v5(uuid,uuid,text,boolean,jsonb,text,boolean) is
  'Completes only the exact current non-expired DB lease. Lease authority is proven before semantic binding evidence; successful semantic effects require immutable digest-verified sealed v1/v2 intent and are never automatically retried.';
