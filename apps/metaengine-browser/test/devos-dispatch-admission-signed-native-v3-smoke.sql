\set ON_ERROR_STOP on

create schema if not exists destruktion_meta;
create role service_role;
create role anon;
create role authenticated;

create table public.compute_fabric_a2_browser_supervisor_state_h205f22 (
  client_id text primary key,
  workspace_id uuid not null,
  last_seen_at timestamptz not null,
  state jsonb not null,
  authority_effect boolean not null default false
);

create table public.compute_fabric_a2_browser_device_h205f22 (
  device_id uuid primary key,
  client_id text not null,
  profile text not null,
  public_jwk jsonb not null default '{}'::jsonb,
  key_fingerprint_sha256 text not null,
  enrollment_pairing_token_hash text,
  active boolean not null,
  enrolled_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table destruktion_meta.devos_fleet_claim_h205f22 (
  claim_id bigserial primary key,
  workspace_id uuid not null,
  role text not null,
  agent_id text not null,
  tab_id text not null,
  target_id text not null,
  agent_generation_epoch bigint not null,
  state text not null default 'ACTIVE'
);

\i supabase/migrations/20260902190500_devos_dispatch_admission_runtime_v2.sql
\i supabase/migrations/20260903052200_devos_dispatch_admission_signed_native_v3.sql

create or replace function pg_temp.snapshot(
  p_keepalive text default 'ACTIVE',
  p_string_encoded boolean default false,
  p_generation bigint default 7,
  p_last_seen timestamptz default clock_timestamp(),
  p_client_kind text default 'METAENGINE_BROWSER_ELECTRON_NATIVE',
  p_device_id text default '22222222-2222-4222-8222-222222222222',
  p_fingerprint text default repeat('b',64)
) returns jsonb language plpgsql as $$
declare
  v jsonb := jsonb_build_object(
    'schema','metaengine.native-browser-supervisor.state.v1',
    'client_kind',p_client_kind,
    'transport_identity',jsonb_build_object(
      'profile','A2_DEVICE_HTTP_SIGNATURE_V1',
      'device_id',p_device_id,
      'key_fingerprint_sha256',p_fingerprint
    ),
    'supervisor_lifecycle',jsonb_build_object(
      'schema','metaengine.supervisor-lifecycle-runtime.v3',
      'actuation_enabled',true,
      'continuous_service',jsonb_build_object('enabled',true),
      'keepalive',jsonb_build_object('state',p_keepalive)
    ),
    'fleet',jsonb_build_object(
      'schema','metaengine.browser.fleet-snapshot.v1',
      'readiness_contract','TRANSPORT_PROOF_REQUIRED',
      'agents',jsonb_build_array(jsonb_build_object(
        'agent_id','agent_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        'role','IMPLEMENTER',
        'ownership','FLEET_OWNED',
        'lifecycle_state','ACTIVE',
        'tab_id','tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        'target_id','webcontents:42',
        'generation_epoch',p_generation,
        'automatic_retry_allowed',false,
        'authority_effect',false,
        'transport_proof',jsonb_build_object(
          'schema','metaengine.browser.fleet-transport-proof.v1',
          'tab_id','tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          'target_id','webcontents:42',
          'generation_epoch',p_generation,
          'conversation_url_sha256',repeat('a',64),
          'proven_at',(p_last_seen - interval '1 second')::text,
          'authority_effect',false
        )
      ))
    )
  );
begin
  return case when p_string_encoded then to_jsonb(v::text) else v end;
end $$;

insert into public.compute_fabric_a2_browser_device_h205f22(
  device_id,client_id,profile,key_fingerprint_sha256,active
) values (
  '22222222-2222-4222-8222-222222222222',
  'browser-native',
  'A2_DEVICE_HTTP_SIGNATURE_V1',
  repeat('b',64),
  true
);

-- Counterexample from live H205F22: an obsolete legacy row has outer
-- authority_effect=false, while the fresh signed native heartbeat has true.
insert into public.compute_fabric_a2_browser_supervisor_state_h205f22
values (
  'browser-legacy',
  '11111111-1111-4111-8111-111111111111',
  clock_timestamp()-interval '1 day',
  jsonb_build_object('schema','metaengine.a2-browser-supervisor.state.v7'),
  false
);
insert into public.compute_fabric_a2_browser_supervisor_state_h205f22
values (
  'browser-native',
  '11111111-1111-4111-8111-111111111111',
  clock_timestamp(),
  pg_temp.snapshot('ACTIVE',false),
  true
);

-- The fresh signed native row must win despite its outer row flag.
insert into destruktion_meta.devos_fleet_claim_h205f22(workspace_id,role,agent_id,tab_id,target_id,agent_generation_epoch)
values ('11111111-1111-4111-8111-111111111111','IMPLEMENTER','agent_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','webcontents:42',7);
delete from destruktion_meta.devos_fleet_claim_h205f22;

-- Installed Browser compatibility: JSON string inside jsonb remains accepted.
update public.compute_fabric_a2_browser_supervisor_state_h205f22
set state=pg_temp.snapshot('ACTIVE',true), last_seen_at=clock_timestamp(), authority_effect=true
where client_id='browser-native';
insert into destruktion_meta.devos_fleet_claim_h205f22(workspace_id,role,agent_id,tab_id,target_id,agent_generation_epoch)
values ('11111111-1111-4111-8111-111111111111','IMPLEMENTER','agent_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','webcontents:42',7);
delete from destruktion_meta.devos_fleet_claim_h205f22;

-- Exact degraded continuity denies before claim creation.
update public.compute_fabric_a2_browser_supervisor_state_h205f22
set state=pg_temp.snapshot('ROLLOVER_REQUIRED',true), last_seen_at=clock_timestamp(), authority_effect=true
where client_id='browser-native';
do $$ begin
  begin
    insert into destruktion_meta.devos_fleet_claim_h205f22(workspace_id,role,agent_id,tab_id,target_id,agent_generation_epoch)
    values ('11111111-1111-4111-8111-111111111111','IMPLEMENTER','agent_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','webcontents:42',7);
    raise exception 'expected_rollover_admission_failure';
  exception when sqlstate '55000' then
    if position('devos_dispatch_continuity_degraded:ROLLOVER_REQUIRED' in sqlerrm)=0 then raise; end if;
  end;
end $$;

-- A native-looking heartbeat without an active exact device binding fails closed.
update public.compute_fabric_a2_browser_supervisor_state_h205f22
set state=pg_temp.snapshot('ACTIVE',true), last_seen_at=clock_timestamp(), authority_effect=true
where client_id='browser-native';
update public.compute_fabric_a2_browser_device_h205f22 set active=false where client_id='browser-native';
do $$ begin
  begin
    insert into destruktion_meta.devos_fleet_claim_h205f22(workspace_id,role,agent_id,tab_id,target_id,agent_generation_epoch)
    values ('11111111-1111-4111-8111-111111111111','IMPLEMENTER','agent_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','webcontents:42',7);
    raise exception 'expected_device_binding_failure';
  exception when sqlstate '55000' then
    if position('devos_transport_device_binding_invalid' in sqlerrm)=0 then raise; end if;
  end;
end $$;
update public.compute_fabric_a2_browser_device_h205f22 set active=true where client_id='browser-native';

-- Exact generation drift remains fenced.
update public.compute_fabric_a2_browser_supervisor_state_h205f22
set state=pg_temp.snapshot('ACTIVE',true,8), last_seen_at=clock_timestamp(), authority_effect=true
where client_id='browser-native';
do $$ begin
  begin
    insert into destruktion_meta.devos_fleet_claim_h205f22(workspace_id,role,agent_id,tab_id,target_id,agent_generation_epoch)
    values ('11111111-1111-4111-8111-111111111111','IMPLEMENTER','agent_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','webcontents:42',7);
    raise exception 'expected_generation_admission_failure';
  exception when sqlstate '55000' then
    if position('devos_transport_agent_binding_mismatch' in sqlerrm)=0 then raise; end if;
  end;
end $$;

select case when count(*)=0 then 'PASS' else 'FAIL' end as no_failed_claim_residue
from destruktion_meta.devos_fleet_claim_h205f22;
