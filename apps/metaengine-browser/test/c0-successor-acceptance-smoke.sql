\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

create table public.h205f22_compute_unified_rollover_checkpoints_v1 (
  checkpoint_id bigint generated always as identity primary key,
  workspace_id uuid not null,
  observed_at timestamptz not null,
  process_incarnation_id text,
  supervisor_id text not null,
  supervisor_epoch bigint,
  evidence_fingerprint text not null,
  fingerprint_algorithm text,
  source_architecture_version text,
  source_git_branch text,
  source_git_commit text,
  envelope jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,evidence_fingerprint)
);

\ir ../../../supabase/migrations/20260901074500_compute_unified_successor_acceptance_v1.sql

DO $$
DECLARE
  w uuid := '00000000-0000-0000-0000-000000000151';
  cp1 bigint;
  cp2 bigint;
  r jsonb;
  sha text := 'a23b647220c6bdeaa4340f804575dc2009e434cb';
BEGIN
  insert into public.h205f22_compute_unified_rollover_checkpoints_v1(
    workspace_id,observed_at,process_incarnation_id,supervisor_id,supervisor_epoch,
    evidence_fingerprint,fingerprint_algorithm,source_architecture_version,source_git_branch,source_git_commit,envelope
  ) values (
    w,'2026-09-01T07:00:00Z','proc-A','METAENGINE_SUPERVISOR',12,
    repeat('a',64),'sha256','CP-A','integration/compute-unified-v1',sha,
    '{"authority_effect":false,"restart_authorized":false,"wake_replay_authorized":false,"lease_mutation_authorized":false}'::jsonb
  ) returning checkpoint_id into cp1;

  r := public.h205f22_compute_unified_successor_acceptance_v1(w,cp1,'proc-B',13,sha);
  if not (r->>'accepted')::boolean or r->>'reason' <> 'SUCCESSOR_IDENTITY_ACCEPTABLE' then
    raise exception 'valid successor rejected: %',r;
  end if;
  if (r->>'restart_authorized')::boolean or (r->>'authority_effect')::boolean then
    raise exception 'successor acceptance leaked authority: %',r;
  end if;

  r := public.h205f22_compute_unified_successor_acceptance_v1(w,cp1,'proc-B',14,sha);
  if (r->>'accepted')::boolean or r->>'reason' <> 'SUCCESSOR_EPOCH_NOT_EXACT_NEXT' then
    raise exception 'epoch skip accepted: %',r;
  end if;

  r := public.h205f22_compute_unified_successor_acceptance_v1(w,cp1,'proc-A',13,sha);
  if (r->>'accepted')::boolean or r->>'reason' <> 'SUCCESSOR_PROCESS_INCARNATION_NOT_NEW' then
    raise exception 'same process incarnation accepted: %',r;
  end if;

  r := public.h205f22_compute_unified_successor_acceptance_v1(w,cp1,'proc-B',13,repeat('b',40));
  if (r->>'accepted')::boolean or r->>'reason' <> 'SOURCE_COMMIT_MISMATCH' then
    raise exception 'source drift accepted: %',r;
  end if;

  insert into public.h205f22_compute_unified_rollover_checkpoints_v1(
    workspace_id,observed_at,process_incarnation_id,supervisor_id,supervisor_epoch,
    evidence_fingerprint,fingerprint_algorithm,source_architecture_version,source_git_branch,source_git_commit,envelope
  ) values (
    w,'2026-09-01T07:01:00Z','proc-B','METAENGINE_SUPERVISOR',13,
    repeat('b',64),'sha256','CP-A','integration/compute-unified-v1',sha,
    '{"authority_effect":false,"restart_authorized":false,"wake_replay_authorized":false,"lease_mutation_authorized":false}'::jsonb
  ) returning checkpoint_id into cp2;

  r := public.h205f22_compute_unified_successor_acceptance_v1(w,cp1,'proc-C',13,sha);
  if (r->>'accepted')::boolean or r->>'reason' <> 'CHECKPOINT_NOT_LATEST' then
    raise exception 'stale checkpoint accepted: %',r;
  end if;

  update public.h205f22_compute_unified_rollover_checkpoints_v1
  set envelope='{"authority_effect":true,"restart_authorized":false,"wake_replay_authorized":false,"lease_mutation_authorized":false}'::jsonb
  where checkpoint_id=cp2;
  r := public.h205f22_compute_unified_successor_acceptance_v1(w,cp2,'proc-C',14,sha);
  if (r->>'accepted')::boolean or r->>'reason' <> 'AUTHORITY_BEARING_CHECKPOINT_REJECTED' then
    raise exception 'authority-bearing checkpoint accepted: %',r;
  end if;
END $$;

DO $$ BEGIN
  if has_function_privilege('anon','public.h205f22_compute_unified_successor_acceptance_v1(uuid,bigint,text,bigint,text)','EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_compute_unified_successor_acceptance_v1(uuid,bigint,text,bigint,text)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_compute_unified_successor_acceptance_v1(uuid,bigint,text,bigint,text)','EXECUTE') then raise exception 'service role execute missing'; end if;
END $$;
