\set ON_ERROR_STOP on

begin;

-- Ephemeral verifier fixture only. This mirrors the exact live lease columns read
-- from the authoritative Supabase catalog, but never connects to or mutates production.
do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if;
end
$$;

create schema destruktion_meta;

create table public.compute_fabric_a2_supervisor_actuation_lease_h205f22 (
  lease_id uuid not null,
  workspace_id uuid not null,
  target_client_id text not null,
  holder_supervisor_instance_id text not null,
  effect_scope text not null,
  effect_key text not null,
  status text not null,
  command_id uuid,
  acquired_at timestamptz not null,
  expires_at timestamptz not null,
  released_at timestamptz,
  release_reason text,
  authority_effect boolean not null
);

-- A deterministic trusted-boundary stub lets the smoke drive first-read versus
-- post-lock readback independently. Any state mutation below belongs only to the
-- test fixture; the migration under test remains read-only.
create table public.c5_test_control_state (
  singleton boolean primary key default true check(singleton),
  call_count integer not null default 0,
  first_response jsonb not null,
  second_response jsonb not null
);

create or replace function public.c5_test_control_response(
  p_client_id text,
  p_generation bigint default 3,
  p_conversation text default repeat('a',64),
  p_proof_age_seconds integer default 0
) returns jsonb
language sql
volatile
as $$
  select jsonb_build_object(
    'schema','metaengine.devos.control-supervisor-snapshot.v1',
    'state','FRESH_CONTROL',
    'workspace_id','11111111-1111-1111-1111-111111111111',
    'client_id',p_client_id,
    'last_seen_at',clock_timestamp(),
    'fresh',true,
    'supervisor_state',jsonb_build_object(
      'schema','metaengine.native-browser-supervisor.state.v1',
      'fleet',jsonb_build_object(
        'schema','metaengine.browser.fleet-snapshot.v1',
        'readiness_contract','TRANSPORT_PROOF_REQUIRED',
        'agents',jsonb_build_array(jsonb_build_object(
          'agent_id','agent_12345678',
          'ownership','FLEET_OWNED',
          'lifecycle_state','ACTIVE',
          'authority_effect',false,
          'automatic_retry_allowed',false,
          'tab_id','tab-7',
          'target_id','webcontents:7',
          'generation_epoch',p_generation,
          'transport_proof',jsonb_build_object(
            'schema','metaengine.browser.fleet-transport-proof.v1',
            'authority_effect',false,
            'tab_id','tab-7',
            'target_id','webcontents:7',
            'generation_epoch',p_generation,
            'conversation_url_sha256',p_conversation,
            'proven_at',clock_timestamp() - make_interval(secs=>p_proof_age_seconds)
          )
        ))
      )
    ),
    'authority_effect',false
  );
$$;

create or replace function public.devos_control_supervisor_snapshot_v1(
  p_workspace uuid,
  p_client text default null,
  p_fresh_seconds integer default 45
) returns jsonb
language plpgsql
volatile
as $$
declare
  v_count integer;
  v_first jsonb;
  v_second jsonb;
begin
  update public.c5_test_control_state
     set call_count=call_count+1
   where singleton=true
  returning call_count,first_response,second_response into v_count,v_first,v_second;
  if not found then raise exception 'c5_test_control_state_missing'; end if;
  return case when v_count=1 then v_first else v_second end;
end
$$;

insert into public.c5_test_control_state(singleton,first_response,second_response)
values(true,public.c5_test_control_response('native-client-1'),public.c5_test_control_response('native-client-1'));

insert into public.compute_fabric_a2_supervisor_actuation_lease_h205f22(
  lease_id,workspace_id,target_client_id,holder_supervisor_instance_id,effect_scope,effect_key,status,
  command_id,acquired_at,expires_at,released_at,release_reason,authority_effect
) values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'native-client-1','supervisor-1','BROWSER_CLIENT_ACTUATION',
  'fleet.transport-promotion:agent_12345678','ACTIVE',null,
  clock_timestamp()-interval '1 minute',clock_timestamp()+interval '5 minutes',null,null,false
);

\ir ../../../supabase/migrations/20260902004500_c5_transport_promotion_lease_verifier_v2.sql

create or replace function pg_temp.c5_reset(
  p_first jsonb default public.c5_test_control_response('native-client-1'),
  p_second jsonb default public.c5_test_control_response('native-client-1')
) returns void
language sql
volatile
as $$
  update public.c5_test_control_state
     set call_count=0,first_response=p_first,second_response=p_second
   where singleton=true;
$$;

-- Positive exact-binding proof. Also prove that a valid verifier result grants no
-- scheduler, Browser-effect, lease-creation, or retry authority.
do $$
declare r jsonb;
begin
  perform pg_temp.c5_reset();
  select public.h205f22_verify_browser_transport_promotion_lease_v2(
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    'agent_12345678','supervisor-1','tab-7','webcontents:7',3,repeat('a',64)
  ) into r;
  if r->>'valid'<>'true' or r->>'reason' is not null then raise exception 'positive_verification_failed:%',r; end if;
  if r->>'same_promotion_lock'<>'true' or r->>'post_lock_control_reread'<>'true' then raise exception 'serialization_proof_missing:%',r; end if;
  if r->>'creates_lease'<>'false' or r->>'invokes_scheduler'<>'false' or r->>'browser_effect'<>'false'
     or r->>'automatic_retry_allowed'<>'false' or r->>'authority_effect'<>'false' then
    raise exception 'authority_escalation:%',r;
  end if;
end
$$;

-- Expired lease fails closed.
do $$
declare r jsonb;
begin
  update public.compute_fabric_a2_supervisor_actuation_lease_h205f22 set expires_at=clock_timestamp()-interval '1 second';
  perform pg_temp.c5_reset();
  select public.h205f22_verify_browser_transport_promotion_lease_v2(
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    'agent_12345678','supervisor-1','tab-7','webcontents:7',3,repeat('a',64)
  ) into r;
  if r->>'valid'<>'false' or r->>'reason'<>'LEASE_EXPIRED' or r->>'automatic_retry_allowed'<>'false' then
    raise exception 'expired_lease_not_rejected:%',r;
  end if;
  update public.compute_fabric_a2_supervisor_actuation_lease_h205f22 set expires_at=clock_timestamp()+interval '5 minutes';
end
$$;

-- Holder identity drift fails closed.
do $$
declare r jsonb;
begin
  perform pg_temp.c5_reset();
  select public.h205f22_verify_browser_transport_promotion_lease_v2(
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    'agent_12345678','supervisor-stale','tab-7','webcontents:7',3,repeat('a',64)
  ) into r;
  if r->>'valid'<>'false' or r->>'reason'<>'HOLDER_MISMATCH' then raise exception 'holder_drift_not_rejected:%',r; end if;
end
$$;

-- Lease target cannot drift away from the authoritative current CONTROL client.
do $$
declare r jsonb;
begin
  update public.compute_fabric_a2_supervisor_actuation_lease_h205f22 set target_client_id='native-client-stale';
  perform pg_temp.c5_reset();
  select public.h205f22_verify_browser_transport_promotion_lease_v2(
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    'agent_12345678','supervisor-1','tab-7','webcontents:7',3,repeat('a',64)
  ) into r;
  if r->>'valid'<>'false' or r->>'reason'<>'TARGET_CLIENT_MISMATCH' then raise exception 'client_drift_not_rejected:%',r; end if;
  update public.compute_fabric_a2_supervisor_actuation_lease_h205f22 set target_client_id='native-client-1';
end
$$;

-- Exact agent generation is fenced.
do $$
declare r jsonb;
begin
  perform pg_temp.c5_reset();
  select public.h205f22_verify_browser_transport_promotion_lease_v2(
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    'agent_12345678','supervisor-1','tab-7','webcontents:7',4,repeat('a',64)
  ) into r;
  if r->>'valid'<>'false' or r->>'reason'<>'AGENT_BINDING_MISMATCH' then raise exception 'generation_drift_not_rejected:%',r; end if;
end
$$;

-- Conversation provenance is part of transport proof identity.
do $$
declare r jsonb;
begin
  perform pg_temp.c5_reset();
  select public.h205f22_verify_browser_transport_promotion_lease_v2(
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    'agent_12345678','supervisor-1','tab-7','webcontents:7',3,repeat('b',64)
  ) into r;
  if r->>'valid'<>'false' or r->>'reason'<>'TRANSPORT_PROOF_MISMATCH' then raise exception 'conversation_drift_not_rejected:%',r; end if;
end
$$;

-- A transport proof older than the CONTROL freshness window cannot be promoted.
do $$
declare r jsonb; stale jsonb;
begin
  stale:=public.c5_test_control_response('native-client-1',3,repeat('a',64),60);
  perform pg_temp.c5_reset(stale,stale);
  select public.h205f22_verify_browser_transport_promotion_lease_v2(
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    'agent_12345678','supervisor-1','tab-7','webcontents:7',3,repeat('a',64)
  ) into r;
  if r->>'valid'<>'false' or r->>'reason'<>'TRANSPORT_PROOF_STALE' then raise exception 'stale_transport_proof_not_rejected:%',r; end if;
end
$$;

-- First read may be healthy while the post-lock authoritative reread is stale.
-- This must fail before any lease can be blessed.
do $$
declare r jsonb; stale jsonb;
begin
  stale:=jsonb_build_object(
    'schema','metaengine.devos.control-supervisor-snapshot.v1','state','STALE',
    'client_id','native-client-1','fresh',false,'authority_effect',false
  );
  perform pg_temp.c5_reset(public.c5_test_control_response('native-client-1'),stale);
  select public.h205f22_verify_browser_transport_promotion_lease_v2(
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    'agent_12345678','supervisor-1','tab-7','webcontents:7',3,repeat('a',64)
  ) into r;
  if r->>'valid'<>'false' or r->>'reason'<>'CONTROL_SNAPSHOT_MISSING_AFTER_LOCK' then
    raise exception 'post_lock_control_drift_not_rejected:%',r;
  end if;
end
$$;

-- Caller privilege boundary: only service_role may execute the verifier.
do $$
declare sig text:='public.h205f22_verify_browser_transport_promotion_lease_v2(uuid,uuid,text,text,text,text,bigint,text)';
begin
  if has_function_privilege('anon',sig,'EXECUTE') then raise exception 'anon_execute_leak'; end if;
  if has_function_privilege('authenticated',sig,'EXECUTE') then raise exception 'authenticated_execute_leak'; end if;
  if not has_function_privilege('service_role',sig,'EXECUTE') then raise exception 'service_role_execute_missing'; end if;
end
$$;

-- Static authority oracle over the compiled function body. Advisory locking and
-- reads are allowed; DML/task scheduling/claim creation are not.
do $$
declare d text;
begin
  select pg_get_functiondef('public.h205f22_verify_browser_transport_promotion_lease_v2(uuid,uuid,text,text,text,text,bigint,text)'::regprocedure) into d;
  if position('pg_advisory_xact_lock' in d)=0 then raise exception 'promotion_lock_missing'; end if;
  if position('devos_control_supervisor_snapshot_v1' in d)=0 then raise exception 'control_reread_missing'; end if;
  if d ~* '\m(insert|update|delete|merge|truncate)\M' then raise exception 'verifier_contains_dml'; end if;
  if d ~* 'devos_fleet_reconcile|devos_fleet_claim|devos_fleet_lease|browser_effect_execute' then raise exception 'verifier_contains_authority_call'; end if;
end
$$;

select 'c5_transport_promotion_lease_verifier_v2_smoke=PASS' as verdict;
rollback;
