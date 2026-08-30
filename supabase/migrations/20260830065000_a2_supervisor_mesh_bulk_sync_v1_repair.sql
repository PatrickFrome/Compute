-- Repair qualified pgcrypto access under the deliberately narrow SECURITY DEFINER search_path.

create or replace function public.h205f22_a2_supervisor_mesh_sync_v1(
  p_client_id text,
  p_mesh jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace constant uuid := '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid;
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_runtime jsonb := coalesce(p_mesh,'{}'::jsonb);
  v_mesh jsonb;
  v_preferred text;
  v_row jsonb;
  v_id text;
  v_hash text;
  v_status text;
  v_tab text;
  v_priority integer;
  v_count integer := 0;
begin
  if length(v_client) < 1 then raise exception 'supervisor_mesh_sync_client_invalid'; end if;
  if jsonb_typeof(v_runtime) <> 'object' then raise exception 'supervisor_mesh_sync_runtime_invalid'; end if;
  if v_runtime->>'schema' <> 'metaengine.supervisor-mesh-runtime.v1' then raise exception 'supervisor_mesh_sync_runtime_schema_invalid'; end if;
  if coalesce((v_runtime->>'authority_effect')::boolean,false) <> false then raise exception 'supervisor_mesh_sync_authority_effect_invalid'; end if;

  v_mesh := v_runtime->'mesh';
  if jsonb_typeof(v_mesh) <> 'object' or v_mesh->>'schema' <> 'metaengine.supervisor-mesh.state.v1' then
    raise exception 'supervisor_mesh_sync_mesh_schema_invalid';
  end if;
  if jsonb_typeof(v_mesh->'supervisors') <> 'array' or jsonb_array_length(v_mesh->'supervisors') > 16 then
    raise exception 'supervisor_mesh_sync_supervisors_invalid';
  end if;
  v_preferred := nullif(lower(trim(coalesce(v_mesh->>'preferred_supervisor_id',''))),'');

  for v_row in select value from jsonb_array_elements(v_mesh->'supervisors')
  loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'supervisor_mesh_sync_entry_invalid'; end if;
    v_id := lower(trim(coalesce(v_row->>'supervisor_id','')));
    v_hash := lower(trim(coalesce(v_row->>'conversation_url_sha256','')));
    v_status := upper(trim(coalesce(v_row->>'status','LOST')));
    v_tab := nullif(left(trim(coalesce(v_row->>'tab_id','')),160),'');

    if v_id !~ '^sup_[a-f0-9]{24}$' then raise exception 'supervisor_mesh_sync_instance_id_invalid'; end if;
    if v_hash !~ '^[a-f0-9]{64}$' then raise exception 'supervisor_mesh_sync_conversation_hash_invalid'; end if;
    if v_id <> 'sup_' || substr(v_hash,1,24) then raise exception 'supervisor_mesh_sync_identity_binding_invalid'; end if;
    if v_status not in ('ACTIVE','PAUSED','LOST','AMBIGUOUS_INCARNATION') then raise exception 'supervisor_mesh_sync_status_invalid'; end if;
    if v_tab is not null and length(v_tab) < 4 then raise exception 'supervisor_mesh_sync_tab_id_invalid'; end if;
    if coalesce((v_row->>'authority_effect')::boolean,false) <> false then raise exception 'supervisor_mesh_sync_entry_authority_effect_invalid'; end if;

    if v_status in ('LOST','AMBIGUOUS_INCARNATION') then v_tab := null; end if;
    v_priority := case when v_id = v_preferred then 50 else 100 end;

    insert into public.compute_fabric_a2_supervisor_mesh_instance_h205f22(
      workspace_id, supervisor_instance_id, conversation_url_sha256, tab_id, status,
      priority, capabilities, registered_at, last_seen_at, retired_at, authority_effect
    ) values (
      v_workspace, v_id, v_hash, v_tab, v_status, v_priority,
      jsonb_build_object(
        'chatgpt_supervisor',true,
        'native_browser_discovered',true,
        'shared_actuation_lease',true,
        'client_id_sha256',encode(extensions.digest(v_client::text,'sha256'::text),'hex')
      ),
      clock_timestamp(), clock_timestamp(), null, false
    )
    on conflict (workspace_id, supervisor_instance_id) do update set
      conversation_url_sha256 = excluded.conversation_url_sha256,
      tab_id = excluded.tab_id,
      status = excluded.status,
      priority = excluded.priority,
      capabilities = excluded.capabilities,
      last_seen_at = clock_timestamp(),
      retired_at = null,
      authority_effect = false;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'schema','metaengine.supervisor-mesh.sync.v1',
    'client_id_sha256',encode(extensions.digest(v_client::text,'sha256'::text),'hex'),
    'preferred_supervisor_id',v_preferred,
    'supervisor_count',v_count,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_a2_supervisor_mesh_sync_v1(text,jsonb) from public;

comment on function public.h205f22_a2_supervisor_mesh_sync_v1(text,jsonb)
is 'Zero-authority bulk sync for a signed native Browser supervisor mesh heartbeat. pgcrypto is schema-qualified because the function uses a narrow SECURITY DEFINER search_path.';
