-- METAENGINE owner override for the shared supervisor mesh actuation lease.
-- Default remains one mutating Browser effect at a time. When the project owner
-- explicitly disables supervisor.shared_actuation_lease (or wildcard *), the
-- mesh issue path delegates directly to the typed native issue contract.

create or replace function public.h205f22_a2_browser_supervisor_issue_mesh_v2(
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
  v_lease_disabled boolean := public.h205f22_a2_owner_gate_disabled_v1(v_workspace,'supervisor.shared_actuation_lease');
  v_existing public.compute_fabric_a2_supervisor_actuation_lease_h205f22%rowtype;
  v_lease_id uuid;
  v_issued jsonb;
  v_command_id uuid;
begin
  select exists(
    select 1 from public.compute_fabric_a2_supervisor_mesh_instance_h205f22 s
     where s.workspace_id=v_workspace
       and s.supervisor_instance_id=v_supervisor
       and s.status='ACTIVE'
       and s.last_seen_at>=clock_timestamp()-interval '120 seconds'
  ) into v_read_only;
  if not v_read_only then raise exception 'supervisor_mesh_instance_not_live'; end if;

  v_read_only := v_action in (
    'POLL','CAPTURE','CAPTURE_VIEW','GATE_STATUS',
    'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
    'DOWNLOAD_STATUS','SELF_UPDATE_STATUS'
  );

  if v_read_only or v_lease_disabled or v_action in ('GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL') then
    v_issued := public.h205f22_a2_browser_supervisor_issue_native_v2(
      v_client,v_action,p_platform,coalesce(p_payload,'{}'::jsonb),v_ttl,
      left('SUPERVISOR_MESH:'||v_supervisor,160),nullif(v_key,'')
    );
    return v_issued || jsonb_build_object(
      'supervisor_instance_id',v_supervisor,
      'mesh_actuation_lease',null,
      'shared_actuation_lease_disabled_by_owner',v_lease_disabled,
      'authority_effect',false
    );
  end if;

  if length(v_key)<16 or length(v_key)>160 or v_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'supervisor_mesh_mutation_requires_stable_idempotency_key';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text||':'||v_client,0));

  update public.compute_fabric_a2_supervisor_actuation_lease_h205f22 l
     set status='RELEASED',released_at=clock_timestamp(),release_reason='COMMAND_TERMINAL'
   where l.workspace_id=v_workspace and l.target_client_id=v_client and l.status='ACTIVE'
     and l.command_id is not null
     and exists (
       select 1 from public.compute_fabric_a2_browser_supervisor_command_h205f22 c
        where c.command_id=l.command_id and c.status in ('COMPLETED','FAILED','EXPIRED','CANCELLED')
     );

  update public.compute_fabric_a2_supervisor_actuation_lease_h205f22
     set status='EXPIRED',released_at=clock_timestamp(),release_reason='LEASE_TTL_EXPIRED'
   where workspace_id=v_workspace and target_client_id=v_client and status='ACTIVE'
     and expires_at<=clock_timestamp();

  select * into v_existing
    from public.compute_fabric_a2_supervisor_actuation_lease_h205f22
   where workspace_id=v_workspace and target_client_id=v_client and status='ACTIVE'
   order by acquired_at desc limit 1;
  if found then
    return jsonb_build_object(
      'accepted',false,'reason','MESH_ACTUATION_LEASE_HELD','lease_id',v_existing.lease_id,
      'holder_supervisor_instance_id',v_existing.holder_supervisor_instance_id,
      'command_id',v_existing.command_id,'expires_at',v_existing.expires_at,
      'shared_actuation_lease_disabled_by_owner',false,'authority_effect',false
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
    v_issued := public.h205f22_a2_browser_supervisor_issue_native_v2(
      v_client,v_action,p_platform,coalesce(p_payload,'{}'::jsonb),v_ttl,
      left('SUPERVISOR_MESH:'||v_supervisor,160),v_key
    );
    v_command_id := nullif(v_issued->>'command_id','')::uuid;
    update public.compute_fabric_a2_supervisor_actuation_lease_h205f22
       set command_id=v_command_id where lease_id=v_lease_id;
    return v_issued || jsonb_build_object(
      'supervisor_instance_id',v_supervisor,
      'mesh_actuation_lease',jsonb_build_object(
        'lease_id',v_lease_id,'effect_scope','BROWSER_CLIENT_ACTUATION','effect_key',v_key,
        'expires_at',clock_timestamp()+make_interval(secs=>v_ttl+30)
      ),
      'shared_actuation_lease_disabled_by_owner',false,
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

revoke all on function public.h205f22_a2_browser_supervisor_issue_mesh_v2(text,text,text,text,jsonb,integer,text) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_issue_mesh_v2(text,text,text,text,jsonb,integer,text) to service_role;

comment on function public.h205f22_a2_browser_supervisor_issue_mesh_v2(text,text,text,text,jsonb,integer,text)
is 'Supervisor mesh issue v2. Default shared actuation lease remains enforced; owner wildcard or supervisor.shared_actuation_lease override routes through the typed native contract without the mesh lease.';
