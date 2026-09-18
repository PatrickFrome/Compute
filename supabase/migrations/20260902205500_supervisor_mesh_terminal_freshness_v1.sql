-- METAENGINE supervisor mesh terminal freshness v1.
-- Control-plane only: no Browser/page actuation and no lease acquisition.
-- Preserve historical supervisor identities for lease/evidence FKs while making
-- LOST/AMBIGUOUS freshness terminal instead of refreshing ghosts forever.

create or replace function public.h205f22_a2_supervisor_mesh_heartbeat_v1(
  p_supervisor_instance_id text,
  p_tab_id text default null,
  p_status text default 'ACTIVE'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_workspace constant uuid := '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid;
  v_id text := lower(trim(coalesce(p_supervisor_instance_id,'')));
  v_tab text := nullif(left(trim(coalesce(p_tab_id,'')),160),'');
  v_status text := upper(trim(coalesce(p_status,'ACTIVE')));
begin
  if v_status not in ('ACTIVE','PAUSED','LOST','AMBIGUOUS_INCARNATION') then
    raise exception 'supervisor_mesh_status_invalid';
  end if;

  update public.compute_fabric_a2_supervisor_mesh_instance_h205f22 s
     set tab_id = case when v_status in ('LOST','AMBIGUOUS_INCARNATION') then null else v_tab end,
         status = v_status,
         -- LOST/AMBIGUOUS is terminal observation. Preserve the last live
         -- heartbeat instead of manufacturing freshness on repeated reports.
         last_seen_at = case
           when v_status in ('LOST','AMBIGUOUS_INCARNATION') then s.last_seen_at
           else clock_timestamp()
         end,
         retired_at = case
           when v_status in ('LOST','AMBIGUOUS_INCARNATION') then coalesce(s.retired_at,clock_timestamp())
           else null
         end,
         authority_effect = false
   where s.workspace_id = v_workspace
     and s.supervisor_instance_id = v_id;

  if not found then raise exception 'supervisor_mesh_instance_not_registered'; end if;

  return jsonb_build_object(
    'supervisor_instance_id',v_id,
    'status',v_status,
    'terminal_freshness',v_status in ('LOST','AMBIGUOUS_INCARNATION'),
    'authority_effect',false
  );
end
$function$;

create or replace function public.h205f22_a2_supervisor_mesh_sync_v1(
  p_client_id text,
  p_mesh jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
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

  -- Direct Edge/Postgres adapters may deliver one serialized JSON layer.
  if jsonb_typeof(v_runtime) = 'string' then
    begin
      v_runtime := (v_runtime #>> '{}')::jsonb;
    exception when others then
      raise exception 'supervisor_mesh_sync_runtime_invalid';
    end;
  end if;

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
  if v_preferred is not null and not exists (
    select 1
      from jsonb_array_elements(v_mesh->'supervisors') x
     where lower(trim(coalesce(x->>'supervisor_id',''))) = v_preferred
       and upper(trim(coalesce(x->>'status','LOST'))) in ('ACTIVE','PAUSED')
  ) then
    raise exception 'supervisor_mesh_sync_preferred_not_live';
  end if;

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
      clock_timestamp(),
      clock_timestamp(),
      case when v_status in ('LOST','AMBIGUOUS_INCARNATION') then clock_timestamp() else null end,
      false
    )
    on conflict (workspace_id, supervisor_instance_id) do update set
      conversation_url_sha256 = excluded.conversation_url_sha256,
      tab_id = excluded.tab_id,
      status = excluded.status,
      priority = excluded.priority,
      capabilities = excluded.capabilities,
      -- Repeated terminal sync must not create a fake liveness heartbeat.
      last_seen_at = case
        when excluded.status in ('LOST','AMBIGUOUS_INCARNATION')
          then compute_fabric_a2_supervisor_mesh_instance_h205f22.last_seen_at
        else clock_timestamp()
      end,
      retired_at = case
        when excluded.status in ('LOST','AMBIGUOUS_INCARNATION')
          then coalesce(compute_fabric_a2_supervisor_mesh_instance_h205f22.retired_at,clock_timestamp())
        else null
      end,
      authority_effect = false;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'schema','metaengine.supervisor-mesh.sync.v1',
    'client_id_sha256',encode(extensions.digest(v_client::text,'sha256'::text),'hex'),
    'preferred_supervisor_id',v_preferred,
    'supervisor_count',v_count,
    'terminal_freshness_preserved',true,
    'authority_effect',false
  );
end
$function$;

-- Recovery-only watchdog: expire persisted actuation leases after TTL for every
-- effect scope. This does not issue, replay, or infer success of any effect.
create or replace function destruktion_meta.devos_fleet_watchdog_h205f22()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'destruktion_meta', 'public', 'extensions'
as $function$
declare
  v_result jsonb;
  v_maintenance jsonb;
  v_meta jsonb;
  v_workspace uuid;
  v_supervisor_lost integer := 0;
  v_actuation_expired integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('devos_fleet_watchdog_h205f22',0)) then
    return jsonb_build_object('ok',true,'skipped','LOCK_HELD','authority_effect',false);
  end if;

  if to_regclass('public.compute_fabric_a2_supervisor_actuation_lease_h205f22') is not null then
    update public.compute_fabric_a2_supervisor_actuation_lease_h205f22
       set status='EXPIRED',
           released_at=coalesce(released_at,clock_timestamp()),
           release_reason=coalesce(release_reason,'LEASE_TTL_EXPIRED'),
           authority_effect=false
     where status='ACTIVE'
       and expires_at <= clock_timestamp();
    get diagnostics v_actuation_expired = row_count;
  end if;

  if to_regclass('public.compute_fabric_a2_supervisor_mesh_instance_h205f22') is not null then
    update public.compute_fabric_a2_supervisor_mesh_instance_h205f22
       set status='LOST',
           tab_id=null,
           retired_at=coalesce(retired_at,clock_timestamp()),
           authority_effect=false
     where status='ACTIVE'
       and last_seen_at < clock_timestamp()-interval '45 seconds';
    get diagnostics v_supervisor_lost = row_count;
  end if;

  select workspace_id into v_workspace
    from destruktion_meta.devos_fleet_task_h205f22
   where state in ('LEASED','RUNNING')
   order by updated_at asc
   limit 1;

  if v_workspace is not null then
    v_result := public.devos_fleet_reconcile_v1(v_workspace);
  else
    v_result := jsonb_build_object('ok',true,'expired_count',0,'authority_effect',false);
  end if;

  v_maintenance := destruktion_meta.devos_maintenance_refill_h205f22();
  v_meta := destruktion_meta.devos_meta_refill_h205f22();

  return jsonb_build_object(
    'ok',true,
    'supervisors_lost',v_supervisor_lost,
    'actuation_leases_expired',v_actuation_expired,
    'fleet_reconcile',v_result,
    'maintenance_refill',v_maintenance,
    'meta_refill',v_meta,
    'leases_ready_work',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end
$function$;

-- One-time truthful normalization of already-terminal rows and expired lease state.
-- No effect is retried and no historical row is deleted.
update public.compute_fabric_a2_supervisor_mesh_instance_h205f22
   set retired_at=coalesce(retired_at,clock_timestamp()),
       authority_effect=false
 where status in ('LOST','AMBIGUOUS_INCARNATION');

update public.compute_fabric_a2_supervisor_actuation_lease_h205f22
   set status='EXPIRED',
       released_at=coalesce(released_at,clock_timestamp()),
       release_reason=coalesce(release_reason,'LEASE_TTL_EXPIRED'),
       authority_effect=false
 where status='ACTIVE'
   and expires_at <= clock_timestamp();
