-- W1 persistent host witness v1
-- Noncanonical evidence surface. This migration does not mark W1 VERIFIED.

begin;

-- Provider-neutral recipe for a genuine persistent Linux VM/bare-metal host.
do $$
declare
  v_plan jsonb := jsonb_build_array(
    jsonb_build_object('step','host_bootstrap','require','systemd + unified cgroup v2 + dedicated non-root worker'),
    jsonb_build_object('step','h1_h13_full_probe','require','linux-h1-h13-v1 full probe and negative canaries PASS'),
    jsonb_build_object('step','heartbeat_window','require','at least 3 accepted witness-bearing heartbeat receipts over the configured minimum DB-observed window'),
    jsonb_build_object('step','identity_continuity','require','exactly one witness_id_sha256 and one machine_id_sha256 across the proof window'),
    jsonb_build_object('step','reboot_continuity','require','same witness and machine identity observed across at least two distinct boot_id_sha256 values'),
    jsonb_build_object('step','dedicated_safety_verification','require','nonexpired LINUX_HOST_SAFETY verification distinct from observation producer')
  );
  v_expected jsonb := jsonb_build_object(
    'schema','metaengine.compute.w1-persistent-host-recipe.h205f22.v1',
    'backend_kind','SELF_HOSTED_VM',
    'persistence_mode','NATIVE_PERSISTENT',
    'authority_effect',false,
    'persistent_worker_proof_rule','DB_RECOMPUTED_SAME_WITNESS_AND_MACHINE_ACROSS_REAL_REBOOT',
    'same_host_window_without_reboot','CANDIDATE_ONLY',
    'required_health_schema','metaengine.compute.native-linux-worker-health.h205f22.v2',
    'required_witness_schema','metaengine.compute.w1-persistence-witness.h205f22.v1',
    'required_policy_key','linux-h1-h13-v1',
    'inbound_remote_shell_required',false,
    'github_self_hosted_runner_required',false,
    'cloudflare_container_eligible_for_authority',false
  );
  v_sha text;
begin
  v_sha := encode(extensions.digest(convert_to(jsonb_build_object('command_plan',v_plan,'expected_evidence',v_expected)::text,'UTF8'),'sha256'),'hex');

  insert into destruktion_meta.compute_fabric_linux_worker_probe_recipe_h205f22(
    recipe_key,backend_kind,host_probe_schema,safety_evidence_schema,
    command_plan,expected_evidence,recipe_sha256,enabled,canonical,authority_effect
  ) values(
    'native-linux-self-hosted-vm-v1','SELF_HOSTED_VM',
    'metaengine.compute.worker-host-probe.h205f22.v2',
    'metaengine.compute.linux-worker-safety-evidence.h205f22.v2',
    v_plan,v_expected,v_sha,true,false,false
  )
  on conflict (recipe_key) do update set
    backend_kind=excluded.backend_kind,
    host_probe_schema=excluded.host_probe_schema,
    safety_evidence_schema=excluded.safety_evidence_schema,
    command_plan=excluded.command_plan,
    expected_evidence=excluded.expected_evidence,
    recipe_sha256=excluded.recipe_sha256,
    enabled=true,
    canonical=false,
    authority_effect=false,
    updated_at=clock_timestamp();
end $$;

create or replace function destruktion_meta.compute_fabric_w1_persistence_evidence_h205f22(
  p_worker_id text,
  p_min_window_seconds integer default 600
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, destruktion_meta
as $$
declare
  v_receipts bigint := 0;
  v_first_at timestamptz;
  v_last_at timestamptz;
  v_window_seconds numeric := 0;
  v_witness_ids bigint := 0;
  v_machine_ids bigint := 0;
  v_boot_ids bigint := 0;
  v_latest_health jsonb := '{}'::jsonb;
  v_latest_witness jsonb := '{}'::jsonb;
  v_latest_local_window boolean := false;
  v_latest_observations bigint := 0;
  v_identity_stable boolean := false;
  v_linux_nonroot boolean := false;
  v_reboot_observed boolean := false;
  v_persistent_proof boolean := false;
  v_proof_grade text := 'INSUFFICIENT_EVIDENCE';
  v_enrollment_id uuid;
  v_safety jsonb;
  v_safety_eligible boolean := false;
  v_host_evidence_ready boolean := false;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9._:-]{3,160}$' then
    raise exception 'invalid_worker_id' using errcode='22023';
  end if;
  if p_min_window_seconds < 60 or p_min_window_seconds > 86400 then
    raise exception 'persistence_window_out_of_bounds' using errcode='22023';
  end if;

  with witness_receipts as (
    select h.heartbeat_id,h.observed_at,h.health,
           h.health->'persistence_witness' as witness
    from destruktion_meta.compute_fabric_worker_heartbeat_receipt_h205f22 h
    where h.worker_id=p_worker_id
      and h.accepted
      and h.health->>'schema'='metaengine.compute.native-linux-worker-health.h205f22.v2'
      and jsonb_typeof(h.health->'persistence_witness')='object'
      and h.health#>>'{persistence_witness,schema}'='metaengine.compute.w1-persistence-witness.h205f22.v1'
  )
  select count(*),min(observed_at),max(observed_at),
         count(distinct witness->>'witness_id_sha256') filter (where witness->>'witness_id_sha256' ~ '^[0-9a-f]{64}$'),
         count(distinct witness->>'machine_id_sha256') filter (where witness->>'machine_id_sha256' ~ '^[0-9a-f]{64}$'),
         count(distinct witness->>'boot_id_sha256') filter (where witness->>'boot_id_sha256' ~ '^[0-9a-f]{64}$')
    into v_receipts,v_first_at,v_last_at,v_witness_ids,v_machine_ids,v_boot_ids
  from witness_receipts;

  select h.health,h.health->'persistence_witness'
    into v_latest_health,v_latest_witness
  from destruktion_meta.compute_fabric_worker_heartbeat_receipt_h205f22 h
  where h.worker_id=p_worker_id
    and h.accepted
    and h.health->>'schema'='metaengine.compute.native-linux-worker-health.h205f22.v2'
    and h.health#>>'{persistence_witness,schema}'='metaengine.compute.w1-persistence-witness.h205f22.v1'
  order by h.observed_at desc,h.heartbeat_id desc
  limit 1;

  if v_first_at is not null and v_last_at is not null then
    v_window_seconds := greatest(0,extract(epoch from (v_last_at-v_first_at)));
  end if;

  v_latest_local_window := case
    when jsonb_typeof(v_latest_witness->'local_persistence_window_satisfied')='boolean'
      then (v_latest_witness->>'local_persistence_window_satisfied')::boolean
    else false end;
  v_latest_observations := case
    when coalesce(v_latest_witness->>'observations','') ~ '^[0-9]+$'
      then (v_latest_witness->>'observations')::bigint
    else 0 end;

  v_identity_stable := v_receipts >= 3 and v_witness_ids=1 and v_machine_ids=1;
  v_reboot_observed := v_boot_ids >= 2;
  v_linux_nonroot := v_latest_health->>'os'='linux'
    and coalesce(v_latest_health->>'euid','') ~ '^[0-9]+$'
    and (v_latest_health->>'euid')::bigint <> 0;

  v_persistent_proof :=
    v_identity_stable
    and v_window_seconds >= p_min_window_seconds
    and v_latest_local_window
    and v_latest_observations >= 3
    and v_linux_nonroot
    and v_reboot_observed;

  if v_persistent_proof then
    v_proof_grade := 'PERSISTENT_ACROSS_REBOOT';
  elsif v_identity_stable
        and v_window_seconds >= p_min_window_seconds
        and v_latest_local_window
        and v_latest_observations >= 3
        and v_linux_nonroot then
    v_proof_grade := 'PERSISTENT_SAME_HOST_WINDOW_CANDIDATE';
  elsif v_receipts > 0 then
    v_proof_grade := 'WITNESS_HISTORY_INSUFFICIENT';
  end if;

  select e.enrollment_id into v_enrollment_id
  from destruktion_meta.compute_fabric_worker_enrollment_h205f22 e
  where e.worker_id=p_worker_id;

  if v_enrollment_id is not null then
    v_safety := destruktion_meta.compute_fabric_linux_worker_safety_status_h205f22(v_enrollment_id,clock_timestamp());
    v_safety_eligible := case
      when jsonb_typeof(v_safety->'eligible')='boolean' then (v_safety->>'eligible')::boolean
      else false end;
  else
    v_safety := jsonb_build_object('required',true,'eligible',false,'reason','WORKER_ENROLLMENT_REQUIRED','authority_effect',false);
  end if;

  v_host_evidence_ready := v_persistent_proof and v_safety_eligible;

  return jsonb_build_object(
    'schema','metaengine.compute.w1-persistence-evidence.h205f22.v1',
    'worker_id',p_worker_id,
    'persistent_worker_proof',v_persistent_proof,
    'proof_grade',v_proof_grade,
    'host_evidence_ready',v_host_evidence_ready,
    'accepted_witness_receipts',v_receipts,
    'first_observed_at',v_first_at,
    'last_observed_at',v_last_at,
    'db_observed_window_seconds',round(v_window_seconds,3),
    'minimum_window_seconds',p_min_window_seconds,
    'distinct_witness_ids',v_witness_ids,
    'distinct_machine_ids',v_machine_ids,
    'distinct_boot_ids',v_boot_ids,
    'identity_stable',v_identity_stable,
    'reboot_observed',v_reboot_observed,
    'latest_local_persistence_window_satisfied',v_latest_local_window,
    'latest_witness_observations',v_latest_observations,
    'latest_linux_nonroot',v_linux_nonroot,
    'safety_verification',v_safety,
    'safety_verification_required',true,
    'canonical',false,
    'authority_effect',false,
    'nonclaims',jsonb_build_array(
      'DOES_NOT_VERIFY_W1',
      'DOES_NOT_ADMIT_WORKER_BY_ITSELF',
      'SAME_HOST_WINDOW_WITHOUT_REBOOT_IS_NOT_PERSISTENT_WORKER_PROOF'
    )
  );
end $$;

revoke all on function destruktion_meta.compute_fabric_w1_persistence_evidence_h205f22(text,integer) from public;
revoke all on function destruktion_meta.compute_fabric_w1_persistence_evidence_h205f22(text,integer) from anon;
revoke all on function destruktion_meta.compute_fabric_w1_persistence_evidence_h205f22(text,integer) from authenticated;
grant execute on function destruktion_meta.compute_fabric_w1_persistence_evidence_h205f22(text,integer) to service_role;

commit;
