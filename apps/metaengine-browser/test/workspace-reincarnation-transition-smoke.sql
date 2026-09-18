\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema destruktion_meta;

create table public.compute_fabric_a2_workspace_binding_h205f22 (
  binding_id uuid primary key,
  workspace_id uuid not null,
  workspace_generation bigint not null,
  coordination_workspace_id uuid not null,
  task_id uuid not null,
  claim_id bigint not null,
  point_id text not null,
  base_sha text not null,
  branch_name text not null,
  agent_id text not null,
  tab_id text not null,
  target_id text not null,
  agent_generation_epoch bigint not null,
  lease_generation bigint not null,
  lease_expires_at timestamptz not null,
  state text not null,
  ambiguity_code text,
  dirty_hold boolean not null default false,
  automatic_retry_allowed boolean not null default false,
  last_verified_head_sha text not null,
  authority_effect boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);

create table destruktion_meta.devos_fleet_claim_h205f22 (
  claim_id bigint primary key,
  task_id uuid not null,
  workspace_id uuid not null,
  point_id text not null,
  base_sha text not null,
  claim_class text not null,
  agent_id text not null,
  tab_id text not null,
  target_id text not null,
  agent_generation_epoch bigint not null,
  lease_generation bigint not null,
  state text not null,
  expires_at timestamptz not null,
  authority_effect boolean not null default false
);

create table destruktion_meta.devos_fleet_task_h205f22 (
  task_id uuid primary key,
  workspace_id uuid not null,
  point_id text not null,
  claim_class text not null,
  base_sha text not null,
  branch_name text,
  state text not null,
  lease_generation bigint not null,
  lease_agent_id text,
  lease_tab_id text,
  lease_target_id text,
  lease_agent_generation_epoch bigint,
  lease_expires_at timestamptz,
  authority_effect boolean not null default false
);

create table public.compute_fabric_a2_browser_supervisor_state_h205f22 (
  client_id text not null,
  workspace_id uuid not null,
  last_seen_at timestamptz not null,
  state jsonb not null,
  authority_effect boolean not null default false
);

insert into public.compute_fabric_a2_workspace_binding_h205f22(
  binding_id,workspace_id,workspace_generation,coordination_workspace_id,task_id,claim_id,point_id,
  base_sha,branch_name,agent_id,tab_id,target_id,agent_generation_epoch,lease_generation,lease_expires_at,
  state,ambiguity_code,dirty_hold,automatic_retry_allowed,last_verified_head_sha,authority_effect
) values (
  '66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',4,
  '33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',41,'c5',
  repeat('b',40),'work/example','agent_12345678','tab_44444444-4444-4444-8444-444444444444','webcontents:9',
  3,4,'2099-01-01T00:00:00Z','READY',null,false,false,repeat('a',40),false
);

insert into destruktion_meta.devos_fleet_claim_h205f22 values (
  52,'22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','c5',repeat('b',40),
  'MUTATING','agent_12345678','tab_55555555-5555-4555-8555-555555555555','webcontents:10',4,5,'ACTIVE','2099-01-01T00:00:00Z',false
);

insert into destruktion_meta.devos_fleet_task_h205f22 values (
  '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','c5','MUTATING',repeat('b',40),
  'work/example','LEASED',5,'agent_12345678','tab_55555555-5555-4555-8555-555555555555','webcontents:10',4,'2099-01-01T00:00:00Z',false
);

insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(client_id,workspace_id,last_seen_at,state,authority_effect)
select 'client_test','33333333-3333-4333-8333-333333333333',clock_timestamp(),jsonb_build_object(
  'schema','metaengine.native-browser-supervisor.state.v1',
  'fleet',jsonb_build_object(
    'schema','metaengine.browser.fleet-snapshot.v1',
    'readiness_contract','TRANSPORT_PROOF_REQUIRED',
    'agents',jsonb_build_array(jsonb_build_object(
      'agent_id','agent_12345678','ownership','FLEET_OWNED','lifecycle_state','ACTIVE',
      'authority_effect',false,'automatic_retry_allowed',false,
      'tab_id','tab_55555555-5555-4555-8555-555555555555','target_id','webcontents:10','generation_epoch',4,
      'transport_proof',jsonb_build_object(
        'schema','metaengine.browser.fleet-transport-proof.v1','authority_effect',false,
        'tab_id','tab_55555555-5555-4555-8555-555555555555','target_id','webcontents:10','generation_epoch',4,
        'conversation_url_sha256',repeat('c',64),'proven_at',clock_timestamp()::text
      )
    ))
  )
),false;

\ir ../../../supabase/migrations/20260902103000_a2_workspace_reincarnation_transition_v1.sql
\ir ../../../supabase/migrations/20260902111500_a2_workspace_reincarnation_exact_replay_v2.sql

do $$
declare v jsonb;
begin
  v := public.h205f22_a2_workspace_reincarnation_transition_v1(
    '77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',
    4,41,'tab_44444444-4444-4444-8444-444444444444','webcontents:9',3,4,
    52,'tab_55555555-5555-4555-8555-555555555555','webcontents:10',4,5,repeat('a',40)
  );
  if v->>'transition_already_performed' <> 'false' or v->>'workspace_generation' <> '5' then
    raise exception 'positive_transition_failed:%',v;
  end if;
  if (select count(*) from public.compute_fabric_a2_workspace_reincarnation_receipt_h205f22) <> 1 then
    raise exception 'receipt_count_invalid';
  end if;
  if not exists (
    select 1 from public.compute_fabric_a2_workspace_binding_h205f22
     where binding_id='66666666-6666-4666-8666-666666666666'
       and workspace_generation=5 and claim_id=52 and target_id='webcontents:10'
       and agent_generation_epoch=4 and lease_generation=5
  ) then raise exception 'binding_not_transitioned_exactly'; end if;
end $$;

do $$
declare v jsonb;
begin
  v := public.h205f22_a2_workspace_reincarnation_transition_v1(
    '77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',
    4,41,'tab_44444444-4444-4444-8444-444444444444','webcontents:9',3,4,
    52,'tab_55555555-5555-4555-8555-555555555555','webcontents:10',4,5,repeat('a',40)
  );
  if v->>'transition_already_performed' <> 'true' or v->>'reconciled_from_durable_receipt' <> 'true' then
    raise exception 'exact_replay_not_reconciled:%',v;
  end if;
end $$;

do $$
begin
  begin
    perform public.h205f22_a2_workspace_reincarnation_transition_v1(
      '77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',
      4,41,'tab_44444444-4444-4444-8444-444444444444','webcontents:9',3,4,
      52,'tab_55555555-5555-4555-8555-555555555555','webcontents:11',4,5,repeat('a',40)
    );
    raise exception 'drifted_transition_id_was_accepted';
  exception when unique_violation then
    if position('workspace_reincarnation_transition_id_collision' in sqlerrm)=0 then raise; end if;
  end;
end $$;

do $$
begin
  begin
    perform public.h205f22_a2_workspace_reincarnation_transition_v1(
      '88888888-8888-4888-8888-888888888888','66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',
      4,41,'tab_44444444-4444-4444-8444-444444444444','webcontents:9',3,4,
      52,'tab_55555555-5555-4555-8555-555555555555','webcontents:10',4,5,repeat('a',40)
    );
    raise exception 'stale_predecessor_cas_was_accepted';
  exception when serialization_failure then
    if position('workspace_reincarnation_predecessor_cas_miss' in sqlerrm)=0 then raise; end if;
  end;
end $$;

insert into destruktion_meta.devos_fleet_claim_h205f22 values (
  53,'22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','c5',repeat('b',40),
  'MUTATING','agent_12345678','tab_66666666-6666-4666-8666-666666666667','webcontents:12',5,6,'ACTIVE','2099-01-01T00:00:00Z',false
);
update destruktion_meta.devos_fleet_task_h205f22
   set lease_generation=6,lease_tab_id='tab_66666666-6666-4666-8666-666666666667',lease_target_id='webcontents:11',
       lease_agent_generation_epoch=5,lease_expires_at='2099-01-01T00:00:00Z';
update public.compute_fabric_a2_browser_supervisor_state_h205f22
   set last_seen_at=clock_timestamp(), state=jsonb_build_object(
     'schema','metaengine.native-browser-supervisor.state.v1',
     'fleet',jsonb_build_object('schema','metaengine.browser.fleet-snapshot.v1','readiness_contract','TRANSPORT_PROOF_REQUIRED','agents',jsonb_build_array(jsonb_build_object(
       'agent_id','agent_12345678','ownership','FLEET_OWNED','lifecycle_state','ACTIVE','authority_effect',false,'automatic_retry_allowed',false,
       'tab_id','tab_66666666-6666-4666-8666-666666666667','target_id','webcontents:11','generation_epoch',5,
       'transport_proof',jsonb_build_object('schema','metaengine.browser.fleet-transport-proof.v1','authority_effect',false,
         'tab_id','tab_66666666-6666-4666-8666-666666666667','target_id','webcontents:11','generation_epoch',5,
         'conversation_url_sha256',repeat('d',64),'proven_at',clock_timestamp()::text)
     )))
   );

do $$
begin
  begin
    perform public.h205f22_a2_workspace_reincarnation_transition_v1(
      '99999999-9999-4999-8999-999999999999','66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',
      5,52,'tab_55555555-5555-4555-8555-555555555555','webcontents:10',4,5,
      53,'tab_66666666-6666-4666-8666-666666666667','webcontents:11',5,6,repeat('a',40)
    );
    raise exception 'claim_target_drift_was_accepted';
  exception when object_not_in_prerequisite_state then
    if position('workspace_reincarnation_successor_claim_fenced' in sqlerrm)=0 then raise; end if;
  end;
end $$;

update destruktion_meta.devos_fleet_claim_h205f22 set target_id='webcontents:11' where claim_id=53;
update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=clock_timestamp()-interval '2 minutes';

do $$
begin
  begin
    perform public.h205f22_a2_workspace_reincarnation_transition_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',
      5,52,'tab_55555555-5555-4555-8555-555555555555','webcontents:10',4,5,
      53,'tab_66666666-6666-4666-8666-666666666667','webcontents:11',5,6,repeat('a',40)
    );
    raise exception 'stale_supervisor_was_accepted';
  exception when object_not_in_prerequisite_state then
    if position('workspace_reincarnation_supervisor_stale' in sqlerrm)=0 then raise; end if;
  end;
end $$;

select 'workspace_reincarnation_transition_smoke=PASS' as result;
