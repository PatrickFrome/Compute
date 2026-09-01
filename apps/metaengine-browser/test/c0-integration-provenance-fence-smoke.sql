\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.compute_fabric_a2_browser_supervisor_state_h205f22 (
  workspace_id uuid not null,
  client_id text not null,
  last_seen_at timestamptz not null,
  state jsonb not null default '{}'::jsonb
);
create table public.compute_fabric_a2_supervisor_actuation_lease_h205f22 (
  workspace_id uuid not null,
  status text not null,
  released_at timestamptz,
  expires_at timestamptz
);
create table public.compute_fabric_a2_browser_architecture_checkpoint_h205f22 (
  architecture_version text primary key,
  status text not null,
  git_repository text not null,
  git_branch text not null,
  git_commit text not null,
  document_path text not null default 'coordination/convergence/COMPUTE_UNIFIED_V1.md',
  baseline_parent_commit text not null default repeat('0',40),
  invariants jsonb not null default '{}'::jsonb,
  roadmap jsonb not null default '{}'::jsonb,
  next_milestone text not null,
  created_at timestamptz not null default statement_timestamp(),
  superseded_at timestamptz
);

create table public.test_rollover_envelope_source (
  workspace_id uuid primary key,
  envelope jsonb not null
);

create or replace function public.h205f22_compute_unified_rollover_checkpoint_envelope_v1(p_workspace uuid)
returns jsonb
language sql
stable
as $$ select envelope from public.test_rollover_envelope_source where workspace_id=p_workspace $$;

\ir ../../../supabase/migrations/20260901035500_compute_unified_rollover_checkpoint_writer_v1.sql
\ir ../../../supabase/migrations/20260901050000_compute_unified_rollover_generation_provenance_v1.sql
\ir ../../../supabase/migrations/20260901061000_compute_unified_integration_provenance_fence_v1.sql

DO $$
DECLARE
  w uuid := '00000000-0000-0000-0000-000000000153';
  r1 jsonb;
  r2 jsonb;
BEGIN
  insert into public.compute_fabric_a2_browser_architecture_checkpoint_h205f22 (
    architecture_version,status,git_repository,git_branch,git_commit,next_milestone,created_at
  ) values (
    'METAENGINE_COMPUTE_UNIFIED_V1_TEST_CP1','AUTHORITATIVE','PatrickFrome/Compute',
    'integration/compute-unified-v1','a23b647220c6bdeaa4340f804575dc2009e434cb',
    'C0_SOURCE_OF_TRUTH_CONVERGENCE_V1','2026-09-01T03:00:00Z'
  );

  insert into public.test_rollover_envelope_source values (
    w,
    jsonb_build_object(
      'observed_at','2026-09-01T03:01:00Z',
      'continuity_identity',jsonb_build_object(
        'supervisor_id','METAENGINE_SUPERVISOR',
        'supervisor_epoch',10,
        'process_incarnation_id','proc-source-A'
      ),
      'restart_authorized',false,
      'wake_replay_authorized',false,
      'lease_mutation_authorized',false,
      'authority_effect',false
    )
  );

  r1 := public.h205f22_persist_compute_unified_rollover_checkpoint_v1(w);
  r2 := public.h205f22_persist_compute_unified_rollover_checkpoint_v1(w);

  if r1->>'source_architecture_version' is distinct from 'METAENGINE_COMPUTE_UNIFIED_V1_TEST_CP1' then
    raise exception 'source checkpoint identity not persisted: %', r1;
  end if;
  if r1->>'source_git_branch' is distinct from 'integration/compute-unified-v1' then
    raise exception 'canonical integration branch not persisted: %', r1;
  end if;
  if r1->>'source_git_commit' is distinct from 'a23b647220c6bdeaa4340f804575dc2009e434cb' then
    raise exception 'canonical integration commit not persisted: %', r1;
  end if;
  if (r2->>'persistence_effect')::boolean then
    raise exception 'exact source-bound replay rewrote checkpoint: %', r2;
  end if;
  if not ((select envelope ? 'source_provenance' from public.h205f22_compute_unified_rollover_checkpoints_v1 where checkpoint_id=(r1->>'checkpoint_id')::bigint)) then
    raise exception 'source provenance missing from durable envelope';
  end if;
END $$;

DO $$
DECLARE
  w uuid := '00000000-0000-0000-0000-000000000154';
BEGIN
  insert into public.test_rollover_envelope_source values (
    w,
    jsonb_build_object(
      'observed_at','2026-09-01T03:02:00Z',
      'continuity_identity',jsonb_build_object(
        'supervisor_id','METAENGINE_SUPERVISOR',
        'supervisor_epoch',11,
        'process_incarnation_id','proc-source-B'
      ),
      'restart_authorized',false,'wake_replay_authorized',false,
      'lease_mutation_authorized',false,'authority_effect',false
    )
  );

  update public.compute_fabric_a2_browser_architecture_checkpoint_h205f22
  set git_commit='not-a-commit'
  where architecture_version='METAENGINE_COMPUTE_UNIFIED_V1_TEST_CP1';

  begin
    perform public.h205f22_persist_compute_unified_rollover_checkpoint_v1(w);
    raise exception 'malformed canonical source commit accepted';
  exception when raise_exception then
    if sqlerrm <> 'invalid canonical integration commit' then raise; end if;
  end;
END $$;

DO $$
DECLARE
  w uuid := '00000000-0000-0000-0000-000000000155';
BEGIN
  update public.compute_fabric_a2_browser_architecture_checkpoint_h205f22
  set status='SUPERSEDED'
  where architecture_version='METAENGINE_COMPUTE_UNIFIED_V1_TEST_CP1';

  insert into public.test_rollover_envelope_source values (
    w,
    jsonb_build_object(
      'observed_at','2026-09-01T03:03:00Z',
      'continuity_identity',jsonb_build_object(
        'supervisor_id','METAENGINE_SUPERVISOR',
        'supervisor_epoch',12,
        'process_incarnation_id','proc-source-C'
      ),
      'restart_authorized',false,'wake_replay_authorized',false,
      'lease_mutation_authorized',false,'authority_effect',false
    )
  );

  begin
    perform public.h205f22_persist_compute_unified_rollover_checkpoint_v1(w);
    raise exception 'missing canonical source provenance accepted';
  exception when raise_exception then
    if sqlerrm <> 'canonical integration provenance unavailable' then raise; end if;
  end;
END $$;

DO $$
BEGIN
  if has_function_privilege('anon','public.h205f22_compute_unified_source_provenance_v1()','EXECUTE') then raise exception 'anon source provenance execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_compute_unified_source_provenance_v1()','EXECUTE') then raise exception 'authenticated source provenance execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_compute_unified_source_provenance_v1()','EXECUTE') then raise exception 'service role source provenance execute missing'; end if;
  if has_table_privilege('service_role','public.h205f22_compute_unified_rollover_checkpoints_v1','INSERT') then raise exception 'service role direct checkpoint insert leaked'; end if;
END $$;