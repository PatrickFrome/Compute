-- W1 provider reboot correlation v2
-- Noncanonical evidence surface. This migration tightens persistent-host proof and does not mark W1 VERIFIED.

begin;

create table if not exists destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22 (
  reboot_receipt_id uuid primary key default gen_random_uuid(),
  worker_id text not null references destruktion_meta.compute_fabric_worker_enrollment_h205f22(worker_id) on update cascade on delete restrict,
  provider_kind text not null check (provider_kind in ('AWS_EC2','DIGITALOCEAN','HETZNER_CLOUD','GENERIC_CLOUD')),
  provider_instance_id text not null check (provider_instance_id ~ '^[A-Za-z0-9._:/-]{1,200}$'),
  action_kind text not null default 'REBOOT' check (action_kind='REBOOT'),
  action_id text not null check (action_id ~ '^[A-Za-z0-9._:/-]{1,240}$'),
  requested_at timestamptz not null,
  completed_at timestamptz not null,
  identity_attestation_kind text not null default 'NONE'
    check (identity_attestation_kind in ('NONE','PROVIDER_METADATA','SIGNED_PROVIDER_IDENTITY')),
  identity_attestation_verified boolean not null default false,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence)='object' and octet_length(evidence::text) <= 262144),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  accepted boolean not null default true,
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp(),
  check (completed_at >= requested_at),
  check (not identity_attestation_verified or identity_attestation_kind='SIGNED_PROVIDER_IDENTITY'),
  unique(provider_kind,provider_instance_id,action_id)
);

create index if not exists compute_fabric_worker_reboot_receipt_h205f22_worker_time_idx
  on destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22(worker_id,completed_at desc,requested_at desc);

alter table destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22 enable row level security;
revoke all on table destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22 from public;
revoke all on table destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22 from anon;
revoke all on table destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22 from authenticated;
grant select,insert on table destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22 to service_role;

create or replace function destruktion_meta.compute_fabric_w1_reboot_receipt_immutable_h205f22()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, destruktion_meta
as $$
begin
  raise exception 'w1_reboot_receipt_is_append_only' using errcode='55000';
end $$;

revoke all on function destruktion_meta.compute_fabric_w1_reboot_receipt_immutable_h205f22() from public;
revoke all on function destruktion_meta.compute_fabric_w1_reboot_receipt_immutable_h205f22() from anon;
revoke all on function destruktion_meta.compute_fabric_w1_reboot_receipt_immutable_h205f22() from authenticated;

drop trigger if exists compute_fabric_w1_reboot_receipt_immutable_h205f22
  on destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22;
create trigger compute_fabric_w1_reboot_receipt_immutable_h205f22
before update or delete on destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22
for each row execute function destruktion_meta.compute_fabric_w1_reboot_receipt_immutable_h205f22();

create or replace function destruktion_meta.compute_fabric_record_worker_reboot_receipt_h205f22(
  p_worker_id text,
  p_provider_kind text,
  p_provider_instance_id text,
  p_action_id text,
  p_requested_at timestamptz,
  p_completed_at timestamptz,
  p_evidence jsonb default '{}'::jsonb,
  p_identity_attestation_kind text default 'NONE',
  p_identity_attestation_verified boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta
as $$
declare
  v_receipt_id uuid;
  v_sha text;
  v_duplicate boolean := false;
  v_existing_sha text;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9._:-]{3,160}$' then
    raise exception 'invalid_worker_id' using errcode='22023';
  end if;
  if p_provider_kind not in ('AWS_EC2','DIGITALOCEAN','HETZNER_CLOUD','GENERIC_CLOUD') then
    raise exception 'invalid_provider_kind' using errcode='22023';
  end if;
  if p_provider_instance_id is null or p_provider_instance_id !~ '^[A-Za-z0-9._:/-]{1,200}$' then
    raise exception 'invalid_provider_instance_id' using errcode='22023';
  end if;
  if p_action_id is null or p_action_id !~ '^[A-Za-z0-9._:/-]{1,240}$' then
    raise exception 'invalid_action_id' using errcode='22023';
  end if;
  if p_requested_at is null or p_completed_at is null or p_completed_at < p_requested_at then
    raise exception 'invalid_reboot_action_window' using errcode='22023';
  end if;
  if p_completed_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'future_reboot_receipt_forbidden' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_evidence,'{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_evidence,'{}'::jsonb)::text) > 262144 then
    raise exception 'invalid_reboot_evidence' using errcode='22023';
  end if;
  if p_identity_attestation_kind not in ('NONE','PROVIDER_METADATA','SIGNED_PROVIDER_IDENTITY') then
    raise exception 'invalid_identity_attestation_kind' using errcode='22023';
  end if;
  if p_identity_attestation_verified and p_identity_attestation_kind <> 'SIGNED_PROVIDER_IDENTITY' then
    raise exception 'verified_attestation_requires_signed_provider_identity' using errcode='22023';
  end if;
  if not exists (
    select 1 from destruktion_meta.compute_fabric_worker_enrollment_h205f22 e where e.worker_id=p_worker_id
  ) then
    raise exception 'worker_enrollment_required' using errcode='23503';
  end if;

  v_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'worker_id',p_worker_id,
    'provider_kind',p_provider_kind,
    'provider_instance_id',p_provider_instance_id,
    'action_kind','REBOOT',
    'action_id',p_action_id,
    'requested_at',p_requested_at,
    'completed_at',p_completed_at,
    'identity_attestation_kind',p_identity_attestation_kind,
    'identity_attestation_verified',p_identity_attestation_verified,
    'evidence',coalesce(p_evidence,'{}'::jsonb)
  )::text,'UTF8'),'sha256'),'hex');

  insert into destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22(
    worker_id,provider_kind,provider_instance_id,action_kind,action_id,
    requested_at,completed_at,identity_attestation_kind,identity_attestation_verified,
    evidence,evidence_sha256,accepted,canonical,authority_effect
  ) values (
    p_worker_id,p_provider_kind,p_provider_instance_id,'REBOOT',p_action_id,
    p_requested_at,p_completed_at,p_identity_attestation_kind,p_identity_attestation_verified,
    coalesce(p_evidence,'{}'::jsonb),v_sha,true,false,false
  )
  on conflict (provider_kind,provider_instance_id,action_id) do nothing
  returning reboot_receipt_id into v_receipt_id;

  if v_receipt_id is null then
    v_duplicate := true;
    select r.reboot_receipt_id,r.evidence_sha256
      into v_receipt_id,v_existing_sha
    from destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22 r
    where r.provider_kind=p_provider_kind
      and r.provider_instance_id=p_provider_instance_id
      and r.action_id=p_action_id;
    if v_existing_sha is distinct from v_sha then
      raise exception 'reboot_receipt_idempotency_conflict' using errcode='23505';
    end if;
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute.w1-provider-reboot-receipt.h205f22.v1',
    'reboot_receipt_id',v_receipt_id,
    'worker_id',p_worker_id,
    'provider_kind',p_provider_kind,
    'provider_instance_id',p_provider_instance_id,
    'action_id',p_action_id,
    'requested_at',p_requested_at,
    'completed_at',p_completed_at,
    'identity_attestation_kind',p_identity_attestation_kind,
    'identity_attestation_verified',p_identity_attestation_verified,
    'evidence_sha256',v_sha,
    'duplicate',v_duplicate,
    'accepted',true,
    'canonical',false,
    'authority_effect',false
  );
end $$;

revoke all on function destruktion_meta.compute_fabric_record_worker_reboot_receipt_h205f22(text,text,text,text,timestamptz,timestamptz,jsonb,text,boolean) from public;
revoke all on function destruktion_meta.compute_fabric_record_worker_reboot_receipt_h205f22(text,text,text,text,timestamptz,timestamptz,jsonb,text,boolean) from anon;
revoke all on function destruktion_meta.compute_fabric_record_worker_reboot_receipt_h205f22(text,text,text,text,timestamptz,timestamptz,jsonb,text,boolean) from authenticated;
grant execute on function destruktion_meta.compute_fabric_record_worker_reboot_receipt_h205f22(text,text,text,text,timestamptz,timestamptz,jsonb,text,boolean) to service_role;

-- Preserve the original heartbeat-only verifier as a named subordinate signal.
do $$
begin
  if to_regprocedure('destruktion_meta.compute_fabric_w1_persistence_heartbeat_evidence_h205f22(text,integer)') is null then
    execute 'alter function destruktion_meta.compute_fabric_w1_persistence_evidence_h205f22(text,integer) rename to compute_fabric_w1_persistence_heartbeat_evidence_h205f22';
  end if;
end $$;

revoke all on function destruktion_meta.compute_fabric_w1_persistence_heartbeat_evidence_h205f22(text,integer) from public;
revoke all on function destruktion_meta.compute_fabric_w1_persistence_heartbeat_evidence_h205f22(text,integer) from anon;
revoke all on function destruktion_meta.compute_fabric_w1_persistence_heartbeat_evidence_h205f22(text,integer) from authenticated;
grant execute on function destruktion_meta.compute_fabric_w1_persistence_heartbeat_evidence_h205f22(text,integer) to service_role;

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
  v_base jsonb;
  v_heartbeat_reboot_proof boolean := false;
  v_base_host_ready boolean := false;
  v_provider_reboot_correlated boolean := false;
  v_provider_action_receipts bigint := 0;
  v_matched_reboot_receipt_id uuid;
  v_matched_provider_kind text;
  v_matched_provider_instance_id text;
  v_matched_action_id text;
  v_matched_attestation_kind text;
  v_matched_attestation_verified boolean := false;
  v_new_proof boolean := false;
  v_new_host_ready boolean := false;
  v_grade text;
begin
  v_base := destruktion_meta.compute_fabric_w1_persistence_heartbeat_evidence_h205f22(p_worker_id,p_min_window_seconds);

  v_heartbeat_reboot_proof := case
    when jsonb_typeof(v_base->'persistent_worker_proof')='boolean' then (v_base->>'persistent_worker_proof')::boolean
    else false end;
  v_base_host_ready := case
    when jsonb_typeof(v_base->'host_evidence_ready')='boolean' then (v_base->>'host_evidence_ready')::boolean
    else false end;

  select count(*) into v_provider_action_receipts
  from destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22 r
  where r.worker_id=p_worker_id and r.accepted and r.action_kind='REBOOT';

  select r.reboot_receipt_id,r.provider_kind,r.provider_instance_id,r.action_id,
         r.identity_attestation_kind,r.identity_attestation_verified
    into v_matched_reboot_receipt_id,v_matched_provider_kind,v_matched_provider_instance_id,
         v_matched_action_id,v_matched_attestation_kind,v_matched_attestation_verified
  from destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22 r
  join lateral (
    select h.observed_at,h.health->'persistence_witness' as witness
    from destruktion_meta.compute_fabric_worker_heartbeat_receipt_h205f22 h
    where h.worker_id=p_worker_id
      and h.accepted
      and h.observed_at <= r.requested_at
      and h.health->>'schema'='metaengine.compute.native-linux-worker-health.h205f22.v2'
      and h.health#>>'{persistence_witness,schema}'='metaengine.compute.w1-persistence-witness.h205f22.v1'
    order by h.observed_at desc,h.heartbeat_id desc
    limit 1
  ) pre on true
  join lateral (
    select h.observed_at,h.health->'persistence_witness' as witness
    from destruktion_meta.compute_fabric_worker_heartbeat_receipt_h205f22 h
    where h.worker_id=p_worker_id
      and h.accepted
      and h.observed_at >= r.completed_at
      and h.health->>'schema'='metaengine.compute.native-linux-worker-health.h205f22.v2'
      and h.health#>>'{persistence_witness,schema}'='metaengine.compute.w1-persistence-witness.h205f22.v1'
    order by h.observed_at asc,h.heartbeat_id asc
    limit 1
  ) post on true
  where r.worker_id=p_worker_id
    and r.accepted
    and r.action_kind='REBOOT'
    and pre.witness->>'witness_id_sha256' ~ '^[0-9a-f]{64}$'
    and pre.witness->>'machine_id_sha256' ~ '^[0-9a-f]{64}$'
    and pre.witness->>'boot_id_sha256' ~ '^[0-9a-f]{64}$'
    and post.witness->>'witness_id_sha256' = pre.witness->>'witness_id_sha256'
    and post.witness->>'machine_id_sha256' = pre.witness->>'machine_id_sha256'
    and post.witness->>'boot_id_sha256' ~ '^[0-9a-f]{64}$'
    and post.witness->>'boot_id_sha256' <> pre.witness->>'boot_id_sha256'
  order by r.completed_at desc,r.created_at desc
  limit 1;

  v_provider_reboot_correlated := v_matched_reboot_receipt_id is not null;
  v_new_proof := v_heartbeat_reboot_proof and v_provider_reboot_correlated;
  v_new_host_ready := v_base_host_ready and v_provider_reboot_correlated;

  if v_new_proof then
    v_grade := 'PERSISTENT_ACROSS_PROVIDER_REBOOT';
  elsif v_heartbeat_reboot_proof then
    v_grade := 'REBOOT_WITNESS_UNCORRELATED';
  else
    v_grade := coalesce(v_base->>'proof_grade','INSUFFICIENT_EVIDENCE');
  end if;

  return v_base || jsonb_build_object(
    'schema','metaengine.compute.w1-persistence-evidence.h205f22.v2',
    'persistent_worker_proof',v_new_proof,
    'proof_grade',v_grade,
    'host_evidence_ready',v_new_host_ready,
    'heartbeat_reboot_witness',v_heartbeat_reboot_proof,
    'provider_reboot_correlation_required',true,
    'provider_reboot_correlated',v_provider_reboot_correlated,
    'provider_action_receipts',v_provider_action_receipts,
    'matched_reboot_receipt_id',v_matched_reboot_receipt_id,
    'matched_provider_kind',v_matched_provider_kind,
    'matched_provider_instance_id',v_matched_provider_instance_id,
    'matched_action_id',v_matched_action_id,
    'matched_identity_attestation_kind',v_matched_attestation_kind,
    'matched_identity_attestation_verified',coalesce(v_matched_attestation_verified,false),
    'canonical',false,
    'authority_effect',false,
    'nonclaims',coalesce(v_base->'nonclaims','[]'::jsonb) || jsonb_build_array(
      'WORKER_HEARTBEATS_CANNOT_SELF_ASSERT_PROVIDER_REBOOT',
      'PROVIDER_ACTION_RECEIPT_DOES_NOT_VERIFY_W1_BY_ITSELF',
      'SIGNED_PROVIDER_IDENTITY_IS_OPTIONAL_AMPLIFIER_NOT_CURRENT_BASELINE'
    )
  );
end $$;

revoke all on function destruktion_meta.compute_fabric_w1_persistence_evidence_h205f22(text,integer) from public;
revoke all on function destruktion_meta.compute_fabric_w1_persistence_evidence_h205f22(text,integer) from anon;
revoke all on function destruktion_meta.compute_fabric_w1_persistence_evidence_h205f22(text,integer) from authenticated;
grant execute on function destruktion_meta.compute_fabric_w1_persistence_evidence_h205f22(text,integer) to service_role;

update destruktion_meta.compute_fabric_linux_worker_probe_recipe_h205f22
set expected_evidence = expected_evidence || jsonb_build_object(
      'schema','metaengine.compute.w1-persistent-host-recipe.h205f22.v2',
      'persistent_worker_proof_rule','DB_RECOMPUTED_SAME_WITNESS_AND_MACHINE_ACROSS_PROVIDER_CORRELATED_REBOOT',
      'provider_reboot_receipt_required',true,
      'signed_provider_identity','OPTIONAL_AMPLIFIER'
    ),
    command_plan = command_plan || jsonb_build_array(
      jsonb_build_object('step','provider_reboot_receipt','require','independent controller/provider API reboot action receipt temporally correlated between pre/post heartbeat boot IDs')
    ),
    recipe_sha256 = encode(extensions.digest(convert_to(jsonb_build_object(
      'command_plan',command_plan || jsonb_build_array(jsonb_build_object('step','provider_reboot_receipt','require','independent controller/provider API reboot action receipt temporally correlated between pre/post heartbeat boot IDs')),
      'expected_evidence',expected_evidence || jsonb_build_object(
        'schema','metaengine.compute.w1-persistent-host-recipe.h205f22.v2',
        'persistent_worker_proof_rule','DB_RECOMPUTED_SAME_WITNESS_AND_MACHINE_ACROSS_PROVIDER_CORRELATED_REBOOT',
        'provider_reboot_receipt_required',true,
        'signed_provider_identity','OPTIONAL_AMPLIFIER'
      )
    )::text,'UTF8'),'sha256'),'hex'),
    updated_at=clock_timestamp()
where recipe_key='native-linux-self-hosted-vm-v1';

commit;
