alter table destruktion_meta.compute_fabric_linux_worker_backend_binding_h205f22
  drop constraint if exists compute_fabric_linux_worker_backend_binding_h205f22_check1;

alter table destruktion_meta.compute_fabric_linux_worker_backend_binding_h205f22
  add constraint compute_fabric_linux_worker_backend_binding_h205f22_check1
  check (
    backend_kind <> 'VERCEL_SANDBOX'
    or (
      provider_team_id is not null
      and provider_project_id is not null
      and backend_instance_name is not null
      and runtime = 'node24'
      and persistence_mode = 'EPHEMERAL'
      and cost_mode = any(array['BYO_PROVIDER'::text,'PAID_OPTIONAL'::text])
      and network_policy = any(array['DENY_ALL_INITIAL'::text,'CUSTOM_ALLOWLIST'::text])
    )
  );

create or replace function destruktion_meta.compute_fabric_validate_linux_worker_backend_binding_h205f22()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta'
as $function$
declare
  v_e destruktion_meta.compute_fabric_worker_enrollment_h205f22%rowtype;
begin
  select * into v_e
  from destruktion_meta.compute_fabric_worker_enrollment_h205f22
  where enrollment_id = new.enrollment_id
  for share;

  if not found then
    raise exception 'Linux worker backend enrollment not found';
  end if;

  if new.worker_id is distinct from v_e.worker_id then
    raise exception 'Linux worker backend worker_id mismatch';
  end if;

  if new.backend_kind='VERCEL_SANDBOX' then
    if v_e.node_class_id <> 'sandbox' then
      raise exception 'Vercel Sandbox backend requires sandbox node class';
    end if;
    if new.persistence_mode <> 'EPHEMERAL' then
      raise exception 'Vercel Sandbox is ephemeral; snapshots do not make the worker persistent';
    end if;
  end if;

  if new.persistence_mode='NATIVE_PERSISTENT'
     and new.backend_kind not in ('NATIVE_LINUX','SELF_HOSTED_VM') then
    raise exception 'NATIVE_PERSISTENT requires a native Linux or self-hosted VM backend';
  end if;

  if new.execution_state in ('LIVE_SESSION_OBSERVED','PROBED') then
    if new.live_session_id is null or new.live_session_observed_at is null then
      raise exception 'live backend evidence requires session id and observation time';
    end if;
    if new.backend_kind='VERCEL_SANDBOX' and new.live_session_id !~ '^sbx_[A-Za-z0-9]+$' then
      raise exception 'Vercel Sandbox live session id invalid';
    end if;
    if new.live_session_observed_at > clock_timestamp()+interval '5 minutes' then
      raise exception 'backend observation from future';
    end if;
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$function$;

revoke execute on function destruktion_meta.compute_fabric_validate_linux_worker_backend_binding_h205f22() from public, anon, authenticated;

update destruktion_meta.compute_fabric_linux_worker_probe_recipe_h205f22
set enabled=false,
    updated_at=clock_timestamp()
where recipe_key='vercel-sandbox-firecracker-v1';

do $block$
declare
  v_plan jsonb := jsonb_build_array(
    jsonb_build_object('step','session_metadata','collect',jsonb_build_array('sandbox session id','project id','team id','runtime','vcpus','memory','timeout','network policy','persistence classification')),
    jsonb_build_object('step','host_probe_v2','commands',jsonb_build_array('uname -s','uname -m','getconf _NPROCESSORS_ONLN','read /proc/meminfo','git --version','node --version','id -u')),
    jsonb_build_object('step','network_negative_canary','require','deny-all blocks public egress before any allowlist is installed'),
    jsonb_build_object('step','filesystem','require','workspace is /vercel/sandbox and no host mounts are configured'),
    jsonb_build_object('step','lifecycle','require','explicit stop/timeout terminates session; snapshot persistence is image/filesystem continuity only'),
    jsonb_build_object('step','persistence_truth','require','classify worker substrate EPHEMERAL; never promote snapshot continuity to persistent-worker evidence'),
    jsonb_build_object('step','safety_observation','schema','metaengine.compute.linux-worker-safety-evidence.h205f22.v2'),
    jsonb_build_object('step','dedicated_verification','require','LINUX_HOST_SAFETY verification receipt distinct from observation caller')
  );
  v_expected jsonb;
  v_digest text;
begin
  v_expected := jsonb_build_object(
    'schema','metaengine.compute.linux-worker-probe-recipe.h205f22.v2',
    'backend_kind','VERCEL_SANDBOX',
    'authority_effect',false,
    'persistence_classification','EPHEMERAL',
    'snapshot_semantics','PERSISTENT_IMAGE_OR_FILESYSTEM_STATE_ONLY_NOT_PERSISTENT_WORKER',
    'sandbox',jsonb_build_object(
      'runtime','node24',
      'workspace','/vercel/sandbox',
      'persistent_worker',false,
      'execution_user','dedicated non-root user created inside sandbox',
      'network_policy','deny-all',
      'resource_floor',jsonb_build_object('vcpus',1,'memory_bytes',536870912),
      'session_timeout_max_seconds',1800
    ),
    'steps',v_plan
  );
  v_digest := encode(extensions.digest(convert_to(v_expected::text,'UTF8'),'sha256'),'hex');

  insert into destruktion_meta.compute_fabric_linux_worker_probe_recipe_h205f22(
    recipe_key,backend_kind,host_probe_schema,safety_evidence_schema,command_plan,expected_evidence,recipe_sha256,enabled,canonical,authority_effect
  ) values (
    'vercel-sandbox-firecracker-ephemeral-v2','VERCEL_SANDBOX','metaengine.compute.worker-host-probe.h205f22.v2','metaengine.compute.linux-worker-safety-evidence.h205f22.v2',
    v_plan,v_expected,v_digest,true,false,false
  )
  on conflict (recipe_key) do update set
    command_plan=excluded.command_plan,
    expected_evidence=excluded.expected_evidence,
    recipe_sha256=excluded.recipe_sha256,
    enabled=true,
    updated_at=clock_timestamp();
end;
$block$;
