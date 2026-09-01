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

DO $$
DECLARE
  w uuid := '00000000-0000-0000-0000-000000000150';
  snap jsonb;
BEGIN
  insert into public.compute_fabric_a2_browser_supervisor_state_h205f22 values (
    w, 'browser-1', statement_timestamp(),
    jsonb_build_object(
      'perception', jsonb_build_object(
        'process_incarnation_id','proc-perception-150',
        'text_excerpt','sensitive page text',
        'url','https://private.example'
      ),
      'process_incarnation_id','legacy-proc-should-not-win',
      'supervisor_lifecycle',jsonb_build_object(
        'supervisor_generation','IDLE','quiescent',false,
        'keepalive',jsonb_build_object(
          'state','ACTIVE','supervisor_id','METAENGINE_SUPERVISOR','supervisor_epoch',5,
          'active_wake',jsonb_build_object('wake_id','wake-active'),
          'queued_wakes','[]'::jsonb
        )
      ),
      'self_update',jsonb_build_object('state','CURRENT','current_version','0.6.3','trusted_channel','dev','restart_gate_safe',false)
    )
  );

  snap := public.h205f22_compute_unified_rollover_read_v1(w);
  if snap#>>'{browser_supervisor,runtime,process_incarnation_id}' is distinct from 'proc-perception-150' then
    raise exception 'live process incarnation not recovered from trusted perception metadata: %', snap;
  end if;
  if snap::text like '%sensitive page text%' or snap::text like '%private.example%' then
    raise exception 'page-derived payload leaked through rollover read: %', snap;
  end if;
END $$;

DO $$
DECLARE
  w uuid := '00000000-0000-0000-0000-000000000151';
  r1 jsonb;
  r2 jsonb;
BEGIN
  insert into public.test_rollover_envelope_source values (
    w,
    jsonb_build_object(
      'observed_at','2026-09-01T02:00:00Z',
      'continuity_identity',jsonb_build_object(
        'supervisor_id','METAENGINE_SUPERVISOR',
        'supervisor_epoch',8,
        'process_incarnation_id','proc-A'
      ),
      'restart_authorized',false,'wake_replay_authorized',false,
      'lease_mutation_authorized',false,'authority_effect',false
    )
  );

  r1 := public.h205f22_persist_compute_unified_rollover_checkpoint_v1(w);
  r2 := public.h205f22_persist_compute_unified_rollover_checkpoint_v1(w);

  if r1->>'fingerprint_algorithm' is distinct from 'sha256' then raise exception 'sha256 marker missing'; end if;
  if length(r1->>'evidence_fingerprint') <> 64 or (r1->>'evidence_fingerprint') !~ '^[0-9a-f]{64}$' then
    raise exception 'checkpoint fingerprint is not sha256: %', r1;
  end if;
  if (r2->>'persistence_effect')::boolean then raise exception 'exact replay rewrote checkpoint'; end if;

  update public.test_rollover_envelope_source
  set envelope = jsonb_set(envelope,'{continuity_identity,supervisor_epoch}','7'::jsonb)
  where workspace_id=w;
  begin
    perform public.h205f22_persist_compute_unified_rollover_checkpoint_v1(w);
    raise exception 'stale supervisor generation accepted';
  exception when raise_exception then
    if sqlerrm <> 'stale supervisor generation rejected' then raise; end if;
  end;

  update public.test_rollover_envelope_source
  set envelope = jsonb_set(jsonb_set(envelope,'{continuity_identity,supervisor_epoch}','8'::jsonb),'{continuity_identity,process_incarnation_id}','"proc-B"'::jsonb)
  where workspace_id=w;
  begin
    perform public.h205f22_persist_compute_unified_rollover_checkpoint_v1(w);
    raise exception 'same-generation incarnation drift accepted';
  exception when raise_exception then
    if sqlerrm <> 'same-generation process incarnation drift rejected' then raise; end if;
  end;
END $$;

DO $$
DECLARE
  w uuid := '00000000-0000-0000-0000-000000000152';
BEGIN
  insert into public.test_rollover_envelope_source values (
    w,
    jsonb_build_object(
      'observed_at','2026-09-01T02:00:00Z',
      'continuity_identity',jsonb_build_object('supervisor_id','METAENGINE_SUPERVISOR','supervisor_epoch',9),
      'restart_authorized',false,'wake_replay_authorized',false,'lease_mutation_authorized',false,'authority_effect',false
    )
  );
  begin
    perform public.h205f22_persist_compute_unified_rollover_checkpoint_v1(w);
    raise exception 'missing process incarnation accepted';
  exception when raise_exception then
    if sqlerrm <> 'missing process incarnation fence' then raise; end if;
  end;
END $$;

DO $$
BEGIN
  if has_function_privilege('anon','public.h205f22_persist_compute_unified_rollover_checkpoint_v1(uuid)','EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_persist_compute_unified_rollover_checkpoint_v1(uuid)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_persist_compute_unified_rollover_checkpoint_v1(uuid)','EXECUTE') then raise exception 'service role execute missing'; end if;
  if has_table_privilege('service_role','public.h205f22_compute_unified_rollover_checkpoints_v1','INSERT') then raise exception 'service role direct insert leaked'; end if;
END $$;
