-- METAENGINE multi-supervisor mesh: additive registry + shared actuation fence.
-- This migration does not replace the existing native Browser command path.
-- It adds a mesh issue RPC and a table-level fence so legacy and mesh callers
-- cannot create two concurrent mutating commands for one Browser client.

create table if not exists public.compute_fabric_a2_supervisor_mesh_instance_h205f22 (
  workspace_id uuid not null,
  supervisor_instance_id text not null,
  conversation_url_sha256 text not null,
  tab_id text,
  status text not null default 'ACTIVE',
  priority integer not null default 100,
  capabilities jsonb not null default '{}'::jsonb,
  registered_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  authority_effect boolean not null default false,
  primary key (workspace_id, supervisor_instance_id),
  unique (workspace_id, conversation_url_sha256),
  constraint a2_supervisor_mesh_instance_id_ck check (supervisor_instance_id ~ '^sup_[a-f0-9]{24}$'),
  constraint a2_supervisor_mesh_conversation_hash_ck check (conversation_url_sha256 ~ '^[a-f0-9]{64}$'),
  constraint a2_supervisor_mesh_status_ck check (status in ('ACTIVE','PAUSED','LOST','RETIRED','AMBIGUOUS_INCARNATION')),
  constraint a2_supervisor_mesh_priority_ck check (priority between 0 and 10000),
  constraint a2_supervisor_mesh_tab_id_ck check (tab_id is null or length(tab_id) between 4 and 160),
  constraint a2_supervisor_mesh_capabilities_ck check (jsonb_typeof(capabilities) = 'object' and octet_length(capabilities::text) <= 16384),
  constraint a2_supervisor_mesh_authority_effect_ck check (authority_effect = false)
);

create table if not exists public.compute_fabric_a2_supervisor_actuation_lease_h205f22 (
  lease_id uuid primary key default pg_catalog.gen_random_uuid(),
  workspace_id uuid not null,
  target_client_id text not null,
  holder_supervisor_instance_id text not null,
  effect_scope text not null default 'BROWSER_CLIENT_ACTUATION',
  effect_key text not null,
  status text not null default 'ACTIVE',
  command_id uuid,
  acquired_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  released_at timestamptz,
  release_reason text,
  authority_effect boolean not null default false,
  constraint a2_supervisor_actuation_lease_holder_fk
    foreign key (workspace_id, holder_supervisor_instance_id)
    references public.compute_fabric_a2_supervisor_mesh_instance_h205f22(workspace_id, supervisor_instance_id),
  constraint a2_supervisor_actuation_lease_command_fk
    foreign key (command_id)
    references public.compute_fabric_a2_browser_supervisor_command_h205f22(command_id),
  constraint a2_supervisor_actuation_lease_status_ck check (status in ('ACTIVE','RELEASED','EXPIRED')),
  constraint a2_supervisor_actuation_lease_scope_ck check (effect_scope = 'BROWSER_CLIENT_ACTUATION'),
  constraint a2_supervisor_actuation_lease_effect_key_ck check (length(effect_key) between 16 and 160 and effect_key ~ '^[A-Za-z0-9._:-]+$'),
  constraint a2_supervisor_actuation_lease_client_ck check (length(target_client_id) between 1 and 160),
  constraint a2_supervisor_actuation_lease_authority_effect_ck check (authority_effect = false)
);

-- Global compatibility fence: even callers that still use the legacy native issue RPC
-- cannot bypass the mesh by creating a second in-flight mutating command.
do $$
begin
  if exists (
    select 1
      from public.compute_fabric_a2_browser_supervisor_command_h205f22
     where status in ('PENDING','LEASED')
       and action not in (
         'POLL','CAPTURE','CAPTURE_VIEW',
         'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
         'DOWNLOAD_STATUS','SELF_UPDATE_STATUS'
       )
     group by workspace_id, target_client_id
    having count(*) > 1
  ) then
    raise exception 'supervisor_mesh_existing_concurrent_mutation_requires_resolution';
  end if;
end;
$$;

create unique index if not exists a2_browser_supervisor_one_mutating_inflight_uq
  on public.compute_fabric_a2_browser_supervisor_command_h205f22(workspace_id, target_client_id)
  where status in ('PENDING','LEASED')
    and action not in (
      'POLL','CAPTURE','CAPTURE_VIEW',
      'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
      'DOWNLOAD_STATUS','SELF_UPDATE_STATUS'
    );

create unique index if not exists a2_supervisor_actuation_one_active_client_uq
  on public.compute_fabric_a2_supervisor_actuation_lease_h205f22(workspace_id, target_client_id)
  where status = 'ACTIVE';

create index if not exists a2_supervisor_actuation_command_idx
  on public.compute_fabric_a2_supervisor_actuation_lease_h205f22(command_id)
  where command_id is not null;

create or replace function public.h205f22_a2_supervisor_mesh_register_v1(
  p_supervisor_instance_id text,
  p_conversation_url_sha256 text,
  p_tab_id text default null,
  p_priority integer default 100,
  p_capabilities jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace constant uuid := '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid;
  v_id text := lower(trim(coalesce(p_supervisor_instance_id,'')));
  v_hash text := lower(trim(coalesce(p_conversation_url_sha256,'')));
  v_tab text := nullif(left(trim(coalesce(p_tab_id,'')),160),'');
  v_priority integer := greatest(0,least(10000,coalesce(p_priority,100)));
begin
  if v_id !~ '^sup_[a-f0-9]{24}$' then raise exception 'supervisor_mesh_instance_id_invalid'; end if;
  if v_hash !~ '^[a-f0-9]{64}$' then raise exception 'supervisor_mesh_conversation_hash_invalid'; end if;
  if p_capabilities is null or jsonb_typeof(p_capabilities) <> 'object' or octet_length(p_capabilities::text) > 16384 then
    raise exception 'supervisor_mesh_capabilities_invalid';
  end if;

  insert into public.compute_fabric_a2_supervisor_mesh_instance_h205f22(
    workspace_id, supervisor_instance_id, conversation_url_sha256, tab_id, status,
    priority, capabilities, registered_at, last_seen_at, retired_at, authority_effect
  ) values (
    v_workspace, v_id, v_hash, v_tab, 'ACTIVE', v_priority, p_capabilities,
    clock_timestamp(), clock_timestamp(), null, false
  )
  on conflict (workspace_id, supervisor_instance_id) do update set
    conversation_url_sha256 = excluded.conversation_url_sha256,
    tab_id = excluded.tab_id,
    status = 'ACTIVE',
    priority = excluded.priority,
    capabilities = excluded.capabilities,
    last_seen_at = clock_timestamp(),
    retired_at = null,
    authority_effect = false;

  return jsonb_build_object(
    'schema','metaengine.supervisor-mesh.registration.v1',
    'supervisor_instance_id',v_id,
    'conversation_url_sha256',v_hash,
    'tab_id',v_tab,
    'status','ACTIVE',
    'authority_effect',false
  );
end;
$$;

create or replace function public.h205f22_a2_supervisor_mesh_heartbeat_v1(
  p_supervisor_instance_id text,
  p_tab_id text default null,
  p_status text default 'ACTIVE'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace constant uuid := '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid;
  v_id text := lower(trim(coalesce(p_supervisor_instance_id,'')));
  v_tab text := nullif(left(trim(coalesce(p_tab_id,'')),160),'');
  v_status text := upper(trim(coalesce(p_status,'ACTIVE')));
begin
  if v_status not in ('ACTIVE','PAUSED','LOST','AMBIGUOUS_INCARNATION') then raise exception 'supervisor_mesh_status_invalid'; end if;
  update public.compute_fabric_a2_supervisor_mesh_instance_h205f22
     set tab_id = case when v_status in ('LOST','AMBIGUOUS_INCARNATION') then null else v_tab end,
         status = v_status,
         last_seen_at = clock_timestamp(),
         authority_effect = false
   where workspace_id = v_workspace and supervisor_instance_id = v_id;
  if not found then raise exception 'supervisor_mesh_instance_not_registered'; end if;
  return jsonb_build_object('supervisor_instance_id',v_id,'status',v_status,'authority_effect',false);
end;
$$;

create or replace function public.h205f22_a2_browser_supervisor_issue_mesh_v1(
  p_supervisor_instance_id text,
  p_client_id text,
  p_action text,
  p_platform text default null,
  p_payload jsonb default '{}'::jsonb,
  p_ttl_seconds integer default 120,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace constant uuid := '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid;
  v_supervisor text := lower(trim(coalesce(p_supervisor_instance_id,'')));
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_action text := upper(trim(coalesce(p_action,'')));
  v_key text := trim(coalesce(p_idempotency_key,''));
  v_ttl integer := greatest(30,least(600,coalesce(p_ttl_seconds,120)));
  v_read_only boolean;
  v_existing public.compute_fabric_a2_supervisor_actuation_lease_h205f22%rowtype;
  v_lease_id uuid;
  v_issued jsonb;
  v_command_id uuid;
begin
  select exists(
    select 1
      from public.compute_fabric_a2_supervisor_mesh_instance_h205f22 s
     where s.workspace_id = v_workspace
       and s.supervisor_instance_id = v_supervisor
       and s.status = 'ACTIVE'
       and s.last_seen_at >= clock_timestamp() - interval '120 seconds'
  ) into v_read_only;
  if not v_read_only then raise exception 'supervisor_mesh_instance_not_live'; end if;

  v_read_only := v_action in (
    'POLL','CAPTURE','CAPTURE_VIEW',
    'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
    'DOWNLOAD_STATUS','SELF_UPDATE_STATUS'
  );

  if v_read_only then
    return public.h205f22_a2_browser_supervisor_issue_native_v1(
      v_client, v_action, p_platform, coalesce(p_payload,'{}'::jsonb), v_ttl,
      left('SUPERVISOR_MESH:'||v_supervisor,160),
      nullif(v_key,'')
    ) || jsonb_build_object(
      'supervisor_instance_id',v_supervisor,
      'mesh_actuation_lease',null,
      'authority_effect',false
    );
  end if;

  if length(v_key) < 16 or length(v_key) > 160 or v_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'supervisor_mesh_mutation_requires_stable_idempotency_key';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text||':'||v_client, 0));

  update public.compute_fabric_a2_supervisor_actuation_lease_h205f22 l
     set status = 'RELEASED',
         released_at = clock_timestamp(),
         release_reason = 'COMMAND_TERMINAL'
   where l.workspace_id = v_workspace
     and l.target_client_id = v_client
     and l.status = 'ACTIVE'
     and l.command_id is not null
     and exists (
       select 1 from public.compute_fabric_a2_browser_supervisor_command_h205f22 c
        where c.command_id = l.command_id and c.status in ('COMPLETED','FAILED','EXPIRED','CANCELLED')
     );

  update public.compute_fabric_a2_supervisor_actuation_lease_h205f22
     set status = 'EXPIRED',
         released_at = clock_timestamp(),
         release_reason = 'LEASE_TTL_EXPIRED'
   where workspace_id = v_workspace
     and target_client_id = v_client
     and status = 'ACTIVE'
     and expires_at <= clock_timestamp();

  select * into v_existing
    from public.compute_fabric_a2_supervisor_actuation_lease_h205f22
   where workspace_id = v_workspace and target_client_id = v_client and status = 'ACTIVE'
   order by acquired_at desc limit 1;
  if found then
    return jsonb_build_object(
      'accepted',false,
      'reason','MESH_ACTUATION_LEASE_HELD',
      'lease_id',v_existing.lease_id,
      'holder_supervisor_instance_id',v_existing.holder_supervisor_instance_id,
      'command_id',v_existing.command_id,
      'expires_at',v_existing.expires_at,
      'authority_effect',false
    );
  end if;

  insert into public.compute_fabric_a2_supervisor_actuation_lease_h205f22(
    workspace_id,target_client_id,holder_supervisor_instance_id,effect_scope,effect_key,status,
    acquired_at,expires_at,authority_effect
  ) values (
    v_workspace,v_client,v_supervisor,'BROWSER_CLIENT_ACTUATION',v_key,'ACTIVE',
    clock_timestamp(),clock_timestamp()+make_interval(secs=>v_ttl+30),false
  ) returning lease_id into v_lease_id;

  begin
    v_issued := public.h205f22_a2_browser_supervisor_issue_native_v1(
      v_client, v_action, p_platform, coalesce(p_payload,'{}'::jsonb), v_ttl,
      left('SUPERVISOR_MESH:'||v_supervisor,160), v_key
    );
    v_command_id := nullif(v_issued->>'command_id','')::uuid;
    update public.compute_fabric_a2_supervisor_actuation_lease_h205f22
       set command_id = v_command_id
     where lease_id = v_lease_id;
    return v_issued || jsonb_build_object(
      'supervisor_instance_id',v_supervisor,
      'mesh_actuation_lease',jsonb_build_object(
        'lease_id',v_lease_id,
        'effect_scope','BROWSER_CLIENT_ACTUATION',
        'effect_key',v_key,
        'expires_at',clock_timestamp()+make_interval(secs=>v_ttl+30)
      ),
      'authority_effect',false
    );
  exception when others then
    update public.compute_fabric_a2_supervisor_actuation_lease_h205f22
       set status='RELEASED',released_at=clock_timestamp(),release_reason='ISSUE_FAILED'
     where lease_id=v_lease_id and status='ACTIVE';
    raise;
  end;
end;
$$;

revoke all on table public.compute_fabric_a2_supervisor_mesh_instance_h205f22 from public;
revoke all on table public.compute_fabric_a2_supervisor_actuation_lease_h205f22 from public;
revoke all on function public.h205f22_a2_supervisor_mesh_register_v1(text,text,text,integer,jsonb) from public;
revoke all on function public.h205f22_a2_supervisor_mesh_heartbeat_v1(text,text,text) from public;
revoke all on function public.h205f22_a2_browser_supervisor_issue_mesh_v1(text,text,text,text,jsonb,integer,text) from public;

comment on index public.a2_browser_supervisor_one_mutating_inflight_uq
is 'Global one-mutating-command fence per Browser client. Applies to legacy and mesh issue paths; read-only observation remains concurrent.';

comment on function public.h205f22_a2_browser_supervisor_issue_mesh_v1(text,text,text,text,jsonb,integer,text)
is 'Multi-supervisor Browser command issue wrapper. Read-only commands bypass actuation lease; mutating commands require one shared per-client lease and stable idempotency key. Table-level fence also blocks legacy bypass. No blind concurrent actuation.';
