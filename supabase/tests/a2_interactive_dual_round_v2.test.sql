-- A2 Interactive Connector dual-round contract. No persisted canary fixtures.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_catalog, public, destruktion_meta, extensions;

select plan(20);

select ok(to_regclass('destruktion_meta.compute_fabric_a2_interactive_round_h205f22') is not null,
  'private interactive dual-round ledger exists');
select is(has_table_privilege('anon','destruktion_meta.compute_fabric_a2_interactive_round_h205f22','select'),false,
  'anon cannot read dual rounds directly');
select is(has_table_privilege('authenticated','destruktion_meta.compute_fabric_a2_interactive_round_h205f22','select'),false,
  'authenticated cannot read dual rounds directly');
select is(has_table_privilege('service_role','destruktion_meta.compute_fabric_a2_interactive_round_h205f22','select'),false,
  'service role must use guarded RPCs');
select ok(to_regprocedure('public.h205f22_a2_interactive_round_open_v1(uuid,text,text,bigint,text)') is not null,
  'round-open RPC exists');
select ok(to_regprocedure('public.h205f22_a2_interactive_round_commit_v1(uuid,text,text)') is not null,
  'commit RPC exists');
select ok(to_regprocedure('public.h205f22_a2_interactive_round_reveal_v1(uuid,text,jsonb,text)') is not null,
  'reveal RPC exists');
select ok(to_regprocedure('public.h205f22_a2_interactive_round_challenge_v1(uuid,text,text,jsonb)') is not null,
  'challenge RPC exists');
select ok(to_regprocedure('public.h205f22_a2_interactive_round_decide_v1(uuid,text,jsonb)') is not null,
  'decision RPC exists');
select ok(to_regprocedure('public.h205f22_a2_interactive_round_read_v1(uuid)') is not null,
  'round readback RPC exists');
select ok(to_regprocedure('public.h205f22_a2_interactive_round_adopt_legacy_reveal_v1(uuid,text,text,text)') is not null,
  'neutral verified legacy-adoption RPC exists');
select ok(to_regprocedure('public.h205f22_a2_interactive_round_direct_resolution_v1(uuid,text,jsonb)') is not null,
  'bounded direct-resolution RPC exists');
select ok((select pg_get_functiondef('public.h205f22_a2_interactive_round_reveal_v1(uuid,text,jsonb,text)'::regprocedure) like '%a2_interactive_round_reveal_closed%'),
  'reveal is fenced until both commitments exist');
select ok((select pg_get_functiondef('public.h205f22_a2_interactive_round_challenge_v1(uuid,text,text,jsonb)'::regprocedure) like '%challenge_target_mismatch%'),
  'challenge must target exact peer reveal hash');
select ok((select pg_get_functiondef('public.h205f22_a2_interactive_round_decide_v1(uuid,text,jsonb)'::regprocedure) like '%state=''DISPUTED''%'),
  'divergent action digests become DISPUTED rather than unilateral execution');
select ok((select pg_get_functiondef('public.h205f22_a2_interactive_round_read_v1(uuid)'::regprocedure) like '%reveal_visible%'),
  'readback hides proposal payloads until both reveals exist');
select ok((select pg_get_functiondef('public.h205f22_a2_interactive_round_adopt_legacy_reveal_v1(uuid,text,text,text)'::regprocedure) like '%legacy_commitment_mismatch%'),
  'legacy adoption independently verifies the original peer commitment');
select ok((select pg_get_functiondef('public.h205f22_a2_interactive_round_direct_resolution_v1(uuid,text,jsonb)'::regprocedure) like '%resolution_exhausted%'),
  'direct resolution is bounded to one proposal per peer');
select ok((select pg_get_functiondef('public.h205f22_a2_interactive_round_direct_resolution_v1(uuid,text,jsonb)'::regprocedure) like '%gpt_resolution_action_sha256=r.glm_resolution_action_sha256%'),
  'matching resolution action digests converge deterministically');
select ok((select pg_get_functiondef('public.h205f22_a2_interactive_round_direct_resolution_v1(uuid,text,jsonb)'::regprocedure) like '%set resolution_exhausted=true%'),
  'second divergence exhausts direct resolution for duel escalation');

select * from finish();
rollback;
