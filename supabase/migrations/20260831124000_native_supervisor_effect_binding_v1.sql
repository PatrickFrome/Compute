-- Native Supervisor C1 convergence: durable exact binding before tab effects.
-- The existing command lease remains the only authority source. This migration only
-- records immutable pre-effect intent evidence while that exact lease is live.

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  add column if not exists effect_binding jsonb,
  add column if not exists effect_bound_at timestamptz,
  add column if not exists effect_binding_sha256 text;

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  drop constraint if exists a2_browser_supervisor_effect_binding_shape_ck;
alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  add constraint a2_browser_supervisor_effect_binding_shape_ck check (
    (effect_binding is null and effect_bound_at is null and effect_binding_sha256 is null)
    or
    (effect_binding is not null and effect_bound_at is not null
      and effect_binding_sha256 ~ '^[0-9a-f]{64}$'
      and jsonb_typeof(effect_binding) = 'object'
      and effect_binding @> '{"authority_effect":false,"page_data_authority":false,"automatic_retry_allowed":false}'::jsonb)
  );

create index if not exists a2_browser_supervisor_effect_bound_idx
  on public.compute_fabric_a2_browser_supervisor_command_h205f22(workspace_id, effect_bound_at)
  where effect_bound_at is not null;

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
  v_digest text;
  v_replayed boolean := false;
  v_tab_actions constant text[] := array[
    'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','TYPED_CLICK',
    'SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD'
  ];
begin
  if p_authority_effect is distinct from false then raise exception 'native_effect_binding_authority_effect_invalid'; end if;
  if v_client = '' then raise exception 'native_effect_binding_client_required'; end if;
  if p_binding is null or jsonb_typeof(p_binding) <> 'object' or octet_length(p_binding::text) > 8192 then
    raise exception 'native_effect_binding_object_invalid';
  end if;
  if p_binding->>'schema' <> 'metaengine.native-supervisor.effect-binding.v1' then raise exception 'native_effect_binding_schema_invalid'; end if;
  if coalesce((p_binding->>'authority_effect')::boolean,true) is distinct from false
     or coalesce((p_binding->>'page_data_authority')::boolean,true) is distinct from false
     or coalesce((p_binding->>'automatic_retry_allowed')::boolean,true) is distinct from false then
    raise exception 'native_effect_binding_safety_flags_invalid';
  end if;
  if p_binding->>'command_id' <> p_command_id::text then raise exception 'native_effect_binding_command_mismatch'; end if;
  if p_binding->>'client_id' <> v_client then raise exception 'native_effect_binding_client_mismatch'; end if;
  if coalesce(p_binding->>'process_incarnation_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'native_effect_binding_process_incarnation_invalid';
  end if;
  if coalesce(p_binding->>'tab_id','') !~ '^tab_[0-9a-f-]{36}$' then raise exception 'native_effect_binding_tab_invalid'; end if;
  if coalesce(p_binding->>'target_id','') !~ '^webcontents:[1-9][0-9]*$' then raise exception 'native_effect_binding_target_invalid'; end if;

  select * into v_row
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where workspace_id=p_workspace_id and command_id=p_command_id
   for update;
  if not found then raise exception 'native_effect_binding_command_not_found'; end if;
  if v_row.status <> 'LEASED' then raise exception 'native_effect_binding_command_not_leased'; end if;
  if v_row.leased_by is distinct from v_client then raise exception 'native_effect_binding_wrong_lease_holder'; end if;
  if v_row.leased_at is null or v_row.expires_at <= clock_timestamp() then raise exception 'native_effect_binding_lease_expired'; end if;
  if not (v_row.action = any(v_tab_actions)) then raise exception 'native_effect_binding_action_not_tab_effect'; end if;
  if v_row.idempotency_key is null or p_binding->>'idempotency_key' is distinct from v_row.idempotency_key then
    raise exception 'native_effect_binding_idempotency_mismatch';
  end if;
  if p_binding->>'action' is distinct from v_row.action then raise exception 'native_effect_binding_action_mismatch'; end if;
  if v_row.payload->>'tab_id' is null or p_binding->>'tab_id' is distinct from v_row.payload->>'tab_id' then
    raise exception 'native_effect_binding_explicit_tab_mismatch';
  end if;
  if (p_binding->>'command_expires_at')::timestamptz is distinct from v_row.expires_at then
    raise exception 'native_effect_binding_expiry_mismatch';
  end if;

  if v_row.effect_binding is not null then
    if v_row.effect_binding is distinct from p_binding then raise exception 'native_effect_binding_conflict'; end if;
    v_replayed := true;
    return jsonb_build_object(
      'accepted',true,'replayed',true,'command_id',v_row.command_id,
      'effect_binding',v_row.effect_binding,'effect_binding_sha256',v_row.effect_binding_sha256,
      'effect_bound_at',v_row.effect_bound_at,'authority_effect',false
    );
  end if;

  v_digest := encode(extensions.digest(p_binding::text,'sha256'::text),'hex');
  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set effect_binding=p_binding,
         effect_bound_at=clock_timestamp(),
         effect_binding_sha256=v_digest
   where command_id=p_command_id;

  return jsonb_build_object(
    'accepted',true,'replayed',v_replayed,'command_id',p_command_id,
    'effect_binding',p_binding,'effect_binding_sha256',v_digest,
    'effect_bound_at',clock_timestamp(),'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_bind_effect_v1(uuid,uuid,text,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_bind_effect_v1(uuid,uuid,text,jsonb,boolean) to service_role;

comment on function public.h205f22_a2_browser_supervisor_bind_effect_v1(uuid,uuid,text,jsonb,boolean) is
  'Durably seals exact Browser process/tab/WebContents binding for an already-leased typed command. Evidence only; never mints authority and never retries an ambiguous effect.';
