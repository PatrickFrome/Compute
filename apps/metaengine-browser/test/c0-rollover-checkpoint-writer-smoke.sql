\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

create or replace function public.h205f22_compute_unified_rollover_checkpoint_envelope_v1(p_workspace uuid)
returns jsonb
language sql
stable
as $$
select jsonb_build_object(
  'schema','metaengine.compute-unified.rollover-checkpoint-envelope.v1',
  'workspace_id',p_workspace,
  'observed_at','2026-09-01T00:00:00Z',
  'continuity_identity',jsonb_build_object(
    'client_id','client-1',
    'process_incarnation_id','proc-1',
    'supervisor_id','METAENGINE_SUPERVISOR',
    'supervisor_epoch',14,
    'current_version','0.6.3-test'
  ),
  'decision',jsonb_build_object('state','RECOVERING'),
  'persistence_authorized',false,
  'restart_authorized',false,
  'wake_replay_authorized',false,
  'lease_mutation_authorized',false,
  'authority_effect',false
);
$$;

\i supabase/migrations/20260901035500_compute_unified_rollover_checkpoint_writer_v1.sql

DO $$
DECLARE
  w uuid := '00000000-0000-0000-0000-000000000149';
  r1 jsonb;
  r2 jsonb;
  before_ctid tid;
  after_ctid tid;
  n bigint;
BEGIN
  r1 := public.h205f22_persist_compute_unified_rollover_checkpoint_v1(w);
  select ctid into before_ctid from public.h205f22_compute_unified_rollover_checkpoints_v1 where workspace_id=w;
  r2 := public.h205f22_persist_compute_unified_rollover_checkpoint_v1(w);
  select ctid into after_ctid from public.h205f22_compute_unified_rollover_checkpoints_v1 where workspace_id=w;
  select count(*) into n from public.h205f22_compute_unified_rollover_checkpoints_v1 where workspace_id=w;

  if (r1->>'persistence_effect')::boolean is distinct from true then raise exception 'first write not reported'; end if;
  if (r2->>'persistence_effect')::boolean is distinct from false then raise exception 'replay was not a no-op'; end if;
  if r1->>'checkpoint_id' is distinct from r2->>'checkpoint_id' then raise exception 'idempotent replay changed checkpoint id'; end if;
  if n <> 1 then raise exception 'idempotent replay duplicated checkpoint'; end if;
  if before_ctid is distinct from after_ctid then raise exception 'idempotent replay rewrote tuple'; end if;
  if (r2->>'authority_effect')::boolean then raise exception 'writer returned authority'; end if;
  if (r2->>'restart_authorized')::boolean or (r2->>'wake_replay_authorized')::boolean or (r2->>'lease_mutation_authorized')::boolean then
    raise exception 'writer leaked effect authorization';
  end if;
END $$;

DO $$
BEGIN
  BEGIN
    insert into public.h205f22_compute_unified_rollover_checkpoints_v1(
      workspace_id, observed_at, supervisor_id, evidence_fingerprint, envelope
    ) values (
      '00000000-0000-0000-0000-000000000150', now(), 'METAENGINE_SUPERVISOR', 'bad',
      '{"authority_effect":true,"restart_authorized":false,"wake_replay_authorized":false,"lease_mutation_authorized":false}'::jsonb
    );
    raise exception 'authority-bearing direct row accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

create or replace function public.h205f22_compute_unified_rollover_checkpoint_envelope_v1(p_workspace uuid)
returns jsonb
language sql
stable
as $$
select jsonb_build_object(
  'observed_at','2026-09-01T00:00:01Z',
  'continuity_identity',jsonb_build_object('supervisor_id','METAENGINE_SUPERVISOR'),
  'restart_authorized',true,
  'wake_replay_authorized',false,
  'lease_mutation_authorized',false,
  'authority_effect',false
);
$$;

DO $$
BEGIN
  BEGIN
    perform public.h205f22_persist_compute_unified_rollover_checkpoint_v1('00000000-0000-0000-0000-000000000151');
    raise exception 'restart-authorized envelope accepted';
  EXCEPTION WHEN raise_exception THEN
    if sqlerrm <> 'authority-bearing rollover envelope rejected' then raise; end if;
  END;
END $$;

DO $$
BEGIN
  if has_function_privilege('anon','public.h205f22_persist_compute_unified_rollover_checkpoint_v1(uuid)','EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_persist_compute_unified_rollover_checkpoint_v1(uuid)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_persist_compute_unified_rollover_checkpoint_v1(uuid)','EXECUTE') then raise exception 'service role execute missing'; end if;
  if has_table_privilege('service_role','public.h205f22_compute_unified_rollover_checkpoints_v1','INSERT') then raise exception 'service role direct insert leaked'; end if;
  if has_table_privilege('service_role','public.h205f22_compute_unified_rollover_checkpoints_v1','UPDATE') then raise exception 'service role direct update leaked'; end if;
  if has_table_privilege('service_role','public.h205f22_compute_unified_rollover_checkpoints_v1','DELETE') then raise exception 'service role direct delete leaked'; end if;
END $$;
