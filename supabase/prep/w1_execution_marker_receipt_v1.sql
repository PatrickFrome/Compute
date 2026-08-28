-- W1 execution-marker persistence contract (PREP ONLY; NOT APPLIED LIVE).
-- This file intentionally defines a noncanonical append-only evidence plane.
-- It must not verify W1, admit a worker, seal a checkpoint, or mutate roadmap state.

create table if not exists destruktion_meta.compute_fabric_w1_execution_marker_receipt_h205f22 (
  execution_receipt_id uuid primary key default gen_random_uuid(),
  worker_id text not null references destruktion_meta.compute_fabric_worker_enrollment_h205f22(worker_id)
    on update cascade on delete restrict,
  provider_kind text not null default 'AWS_EC2' check (provider_kind = 'AWS_EC2'),
  provider_instance_id text not null check (provider_instance_id ~ '^i-[0-9a-f]{8}([0-9a-f]{9})?$'),
  provisioning_command_id text not null check (provisioning_command_id ~* '^[0-9a-f-]{36}$'),
  execution_command_id text not null check (execution_command_id ~* '^[0-9a-f-]{36}$'),
  invocation_key_sha256 text not null check (invocation_key_sha256 ~ '^[0-9a-f]{64}$'),
  marker_id uuid not null,
  callback_receipt_id uuid not null,
  execution_payload_sha256 text not null check (execution_payload_sha256 ~ '^[0-9a-f]{64}$'),
  execution_started_at timestamptz not null,
  execution_completed_at timestamptz not null,
  callback_received_at timestamptz not null,
  callback_auth_kind text not null check (callback_auth_kind in ('WORKER_ENROLLMENT_SIGNATURE_V1','SIGNED_PROVIDER_IDENTITY')),
  callback_attestation_verified boolean not null default true check (callback_attestation_verified),
  evidence jsonb not null check (jsonb_typeof(evidence)='object' and octet_length(evidence::text) <= 262144),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  accepted boolean not null default true check (accepted),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp(),
  unique (provider_kind, provider_instance_id, execution_command_id, marker_id),
  check (execution_completed_at >= execution_started_at),
  check (callback_received_at >= execution_started_at - interval '30 seconds'),
  check (callback_received_at <= execution_completed_at + interval '3 minutes')
);

alter table destruktion_meta.compute_fabric_w1_execution_marker_receipt_h205f22 enable row level security;
revoke all on table destruktion_meta.compute_fabric_w1_execution_marker_receipt_h205f22 from public, anon, authenticated;
grant select, insert on table destruktion_meta.compute_fabric_w1_execution_marker_receipt_h205f22 to service_role;

create or replace function destruktion_meta.compute_fabric_w1_execution_marker_immutable_h205f22()
returns trigger
language plpgsql
security invoker
set search_path to 'pg_catalog','destruktion_meta'
as $function$
begin
  raise exception 'w1_execution_marker_receipt_is_append_only' using errcode='55000';
end
$function$;

revoke all on function destruktion_meta.compute_fabric_w1_execution_marker_immutable_h205f22() from public, anon, authenticated;
grant execute on function destruktion_meta.compute_fabric_w1_execution_marker_immutable_h205f22() to service_role;

drop trigger if exists compute_fabric_w1_execution_marker_no_update_h205f22
  on destruktion_meta.compute_fabric_w1_execution_marker_receipt_h205f22;
create trigger compute_fabric_w1_execution_marker_no_update_h205f22
before update on destruktion_meta.compute_fabric_w1_execution_marker_receipt_h205f22
for each row execute function destruktion_meta.compute_fabric_w1_execution_marker_immutable_h205f22();

drop trigger if exists compute_fabric_w1_execution_marker_no_delete_h205f22
  on destruktion_meta.compute_fabric_w1_execution_marker_receipt_h205f22;
create trigger compute_fabric_w1_execution_marker_no_delete_h205f22
before delete on destruktion_meta.compute_fabric_w1_execution_marker_receipt_h205f22
for each row execute function destruktion_meta.compute_fabric_w1_execution_marker_immutable_h205f22();

create or replace function destruktion_meta.compute_fabric_record_w1_execution_marker_h205f22(
  p_worker_id text,
  p_provider_instance_id text,
  p_provisioning_command_id text,
  p_execution_command_id text,
  p_invocation_key_sha256 text,
  p_marker_id uuid,
  p_callback_receipt_id uuid,
  p_execution_payload_sha256 text,
  p_execution_started_at timestamptz,
  p_execution_completed_at timestamptz,
  p_callback_received_at timestamptz,
  p_callback_auth_kind text,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path to 'pg_catalog','destruktion_meta','extensions'
as $function$
declare
  v_receipt_id uuid;
  v_existing_sha text;
  v_sha text;
  v_duplicate boolean := false;
  v_nested jsonb;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9._:-]{3,160}$' then
    raise exception 'invalid_worker_id' using errcode='22023';
  end if;
  if p_provider_instance_id is null or p_provider_instance_id !~ '^i-[0-9a-f]{8}([0-9a-f]{9})?$' then
    raise exception 'invalid_provider_instance_id' using errcode='22023';
  end if;
  if p_provisioning_command_id is null or p_provisioning_command_id !~* '^[0-9a-f-]{36}$'
     or p_execution_command_id is null or p_execution_command_id !~* '^[0-9a-f-]{36}$' then
    raise exception 'invalid_ssm_command_id' using errcode='22023';
  end if;
  if p_invocation_key_sha256 is null or p_invocation_key_sha256 !~ '^[0-9a-f]{64}$'
     or p_execution_payload_sha256 is null or p_execution_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_execution_digest' using errcode='22023';
  end if;
  if p_marker_id is null or p_callback_receipt_id is null then
    raise exception 'marker_and_callback_receipt_required' using errcode='22023';
  end if;
  if p_execution_started_at is null or p_execution_completed_at is null or p_callback_received_at is null
     or p_execution_completed_at < p_execution_started_at then
    raise exception 'invalid_execution_window' using errcode='22023';
  end if;
  if p_callback_received_at < p_execution_started_at - interval '30 seconds'
     or p_callback_received_at > p_execution_completed_at + interval '3 minutes'
     or p_callback_received_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'callback_time_outside_execution_window' using errcode='22023';
  end if;
  if p_callback_auth_kind not in ('WORKER_ENROLLMENT_SIGNATURE_V1','SIGNED_PROVIDER_IDENTITY') then
    raise exception 'invalid_callback_auth_kind' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_evidence,'{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_evidence,'{}'::jsonb)::text) > 262144 then
    raise exception 'invalid_execution_evidence' using errcode='22023';
  end if;
  if p_evidence->>'schema' <> 'metaengine.compute.w1-execution-correlation.h205f22.v1'
     or p_evidence->>'classification' <> 'W1_EXECUTION_MARKER_CORRELATED_CANDIDATE_UNINGESTED' then
    raise exception 'execution_evidence_schema_invalid' using errcode='22023';
  end if;
  if coalesce((p_evidence->>'execution_marker_correlated')::boolean,false) is not true
     or coalesce((p_evidence->>'callback_attestation_verified')::boolean,false) is not true
     or coalesce((p_evidence->>'live_execution_evidence_candidate')::boolean,false) is not true then
    raise exception 'execution_correlation_not_verified' using errcode='22023';
  end if;
  if coalesce((p_evidence->>'database_persistence_verified')::boolean,true) is not false
     or coalesce((p_evidence->>'persistent_worker_proof')::boolean,true) is not false
     or coalesce((p_evidence->>'worker_admitted')::boolean,true) is not false
     or coalesce((p_evidence->>'w1_verified')::boolean,true) is not false
     or coalesce((p_evidence->>'canonical')::boolean,true) is not false
     or coalesce((p_evidence->>'authority_effect')::boolean,true) is not false then
    raise exception 'execution_candidate_authority_boundary_invalid' using errcode='22023';
  end if;

  v_nested := p_evidence->'evidence';
  if jsonb_typeof(v_nested) <> 'object'
     or v_nested->>'worker_id' <> p_worker_id
     or v_nested->>'provider_kind' <> 'AWS_EC2'
     or v_nested->>'provider_instance_id' <> p_provider_instance_id
     or v_nested->>'provisioning_command_id' <> lower(p_provisioning_command_id)
     or v_nested->>'execution_command_id' <> lower(p_execution_command_id)
     or v_nested->>'invocation_key_sha256' <> p_invocation_key_sha256
     or v_nested->>'marker_id' <> p_marker_id::text
     or v_nested->>'callback_receipt_id' <> p_callback_receipt_id::text
     or v_nested->>'execution_payload_sha256' <> p_execution_payload_sha256
     or v_nested->>'callback_auth_kind' <> p_callback_auth_kind then
    raise exception 'execution_candidate_cross_binding_mismatch' using errcode='22023';
  end if;
  if (v_nested->>'execution_started_at')::timestamptz is distinct from p_execution_started_at
     or (v_nested->>'execution_completed_at')::timestamptz is distinct from p_execution_completed_at
     or (v_nested->>'callback_received_at')::timestamptz is distinct from p_callback_received_at then
    raise exception 'execution_candidate_time_binding_mismatch' using errcode='22023';
  end if;
  if not exists (
    select 1 from destruktion_meta.compute_fabric_worker_enrollment_h205f22 e
    where e.worker_id=p_worker_id
  ) then
    raise exception 'worker_enrollment_required' using errcode='23503';
  end if;

  v_sha := encode(extensions.digest(convert_to(p_evidence::text,'UTF8'),'sha256'),'hex');
  insert into destruktion_meta.compute_fabric_w1_execution_marker_receipt_h205f22(
    worker_id,provider_kind,provider_instance_id,provisioning_command_id,execution_command_id,
    invocation_key_sha256,marker_id,callback_receipt_id,execution_payload_sha256,
    execution_started_at,execution_completed_at,callback_received_at,callback_auth_kind,
    callback_attestation_verified,evidence,evidence_sha256,accepted,canonical,authority_effect
  ) values (
    p_worker_id,'AWS_EC2',p_provider_instance_id,lower(p_provisioning_command_id),lower(p_execution_command_id),
    p_invocation_key_sha256,p_marker_id,p_callback_receipt_id,p_execution_payload_sha256,
    p_execution_started_at,p_execution_completed_at,p_callback_received_at,p_callback_auth_kind,
    true,p_evidence,v_sha,true,false,false
  )
  on conflict (provider_kind,provider_instance_id,execution_command_id,marker_id) do nothing
  returning execution_receipt_id into v_receipt_id;

  if v_receipt_id is null then
    v_duplicate := true;
    select r.execution_receipt_id,r.evidence_sha256 into v_receipt_id,v_existing_sha
    from destruktion_meta.compute_fabric_w1_execution_marker_receipt_h205f22 r
    where r.provider_kind='AWS_EC2'
      and r.provider_instance_id=p_provider_instance_id
      and r.execution_command_id=lower(p_execution_command_id)
      and r.marker_id=p_marker_id;
    if v_existing_sha is distinct from v_sha then
      raise exception 'execution_marker_receipt_idempotency_conflict' using errcode='23505';
    end if;
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute.w1-execution-marker-db-write.h205f22.v1',
    'execution_receipt_id',v_receipt_id,
    'worker_id',p_worker_id,
    'provider_instance_id',p_provider_instance_id,
    'execution_command_id',lower(p_execution_command_id),
    'invocation_key_sha256',p_invocation_key_sha256,
    'marker_id',p_marker_id,
    'evidence_sha256',v_sha,
    'duplicate',v_duplicate,
    'accepted',true,
    'database_write_observed',true,
    'database_persistence_readback_verified',false,
    'persistent_worker_proof',false,
    'worker_admitted',false,
    'w1_verified',false,
    'canonical',false,
    'authority_effect',false
  );
end
$function$;

revoke all on function destruktion_meta.compute_fabric_record_w1_execution_marker_h205f22(
  text,text,text,text,text,uuid,uuid,text,timestamptz,timestamptz,timestamptz,text,jsonb
) from public, anon, authenticated;
grant execute on function destruktion_meta.compute_fabric_record_w1_execution_marker_h205f22(
  text,text,text,text,text,uuid,uuid,text,timestamptz,timestamptz,timestamptz,text,jsonb
) to service_role;

create or replace function destruktion_meta.compute_fabric_w1_execution_marker_readback_h205f22(p_execution_receipt_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'pg_catalog','destruktion_meta'
as $function$
declare
  r destruktion_meta.compute_fabric_w1_execution_marker_receipt_h205f22%rowtype;
begin
  select * into r
  from destruktion_meta.compute_fabric_w1_execution_marker_receipt_h205f22 x
  where x.execution_receipt_id=p_execution_receipt_id;
  if not found then
    raise exception 'execution_marker_receipt_not_found' using errcode='22023';
  end if;
  return jsonb_build_object(
    'schema','metaengine.compute.w1-execution-marker-db-readback.h205f22.v1',
    'execution_receipt_id',r.execution_receipt_id,
    'worker_id',r.worker_id,
    'provider_kind',r.provider_kind,
    'provider_instance_id',r.provider_instance_id,
    'execution_command_id',r.execution_command_id,
    'invocation_key_sha256',r.invocation_key_sha256,
    'marker_id',r.marker_id,
    'callback_receipt_id',r.callback_receipt_id,
    'evidence_sha256',r.evidence_sha256,
    'accepted',r.accepted,
    'database_persistence_readback_verified',true,
    'persistent_worker_proof',false,
    'worker_admitted',false,
    'w1_verified',false,
    'canonical',false,
    'authority_effect',false
  );
end
$function$;

revoke all on function destruktion_meta.compute_fabric_w1_execution_marker_readback_h205f22(uuid)
  from public, anon, authenticated;
grant execute on function destruktion_meta.compute_fabric_w1_execution_marker_readback_h205f22(uuid)
  to service_role;
