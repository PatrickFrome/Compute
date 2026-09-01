\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

create table public.compute_fabric_a2_browser_supervisor_state_h205f22 (
  client_id text, workspace_id uuid, last_seen_at timestamptz, extension_version text,
  operator_runtime text, supervisor_mode text, armed boolean, operator_mode text,
  ordering_policy text, last_command_id uuid, last_command_status text, state jsonb,
  authority_effect boolean
);
create table public.compute_fabric_a2_browser_device_h205f22 (
  device_id uuid primary key, client_id text, profile text, public_jwk jsonb,
  key_fingerprint_sha256 text, enrollment_pairing_token_hash text, active boolean,
  enrolled_at timestamptz, last_used_at timestamptz, revoked_at timestamptz
);
create or replace function public.h205f22_compute_unified_successor_acceptance_v1(uuid,bigint,text,bigint,text)
returns jsonb language sql stable as $$ select jsonb_build_object('accepted',true,'authority_effect',false) $$;

\ir ../../../supabase/migrations/20260901085000_compute_unified_successor_readback_v1.sql

DO $$
DECLARE
  w uuid := '00000000-0000-0000-0000-000000000152';
  cid text := 'successor-client';
  proc text := 'proc-successor';
  sha text := 'a23b647220c6bdeaa4340f804575dc2009e434cb';
  r jsonb;
BEGIN
  insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(client_id,workspace_id,last_seen_at,supervisor_mode,armed,state,authority_effect)
  values(cid,w,statement_timestamp(),'CONTROL',true,jsonb_build_object('perception',jsonb_build_object('process_incarnation_id',proc,'text_excerpt','sensitive page text'),'private_url','https://private.invalid/secret'),true);
  insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,active,enrolled_at)
  values('00000000-0000-0000-0000-000000000001',cid,true,statement_timestamp());

  r := public.h205f22_compute_unified_successor_readback_v1(w,1,cid,proc,13,sha,interval '2 minutes');
  if not (r->>'verified')::boolean or r->>'reason' <> 'SUCCESSOR_READBACK_VERIFIED' then raise exception 'valid readback rejected: %',r; end if;
  if (r->>'restart_authorized')::boolean or (r->>'authority_effect')::boolean then raise exception 'readback leaked authority: %',r; end if;
  if r::text like '%sensitive page text%' or r::text like '%private.invalid%' then raise exception 'raw page state leaked: %',r; end if;

  update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=statement_timestamp()-interval '3 minutes';
  r := public.h205f22_compute_unified_successor_readback_v1(w,1,cid,proc,13,sha,interval '2 minutes');
  if (r->>'verified')::boolean or r->>'reason' <> 'SUCCESSOR_HEARTBEAT_NOT_FRESH' then raise exception 'stale heartbeat accepted: %',r; end if;

  update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=statement_timestamp(), state=jsonb_build_object('process_incarnation_id','wrong-proc');
  r := public.h205f22_compute_unified_successor_readback_v1(w,1,cid,proc,13,sha,interval '2 minutes');
  if (r->>'verified')::boolean or r->>'reason' <> 'SUCCESSOR_PROCESS_INCARNATION_MISMATCH' then raise exception 'wrong incarnation accepted: %',r; end if;

  update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=jsonb_build_object('process_incarnation_id',proc);
  update public.compute_fabric_a2_browser_device_h205f22 set revoked_at=statement_timestamp(), active=false;
  r := public.h205f22_compute_unified_successor_readback_v1(w,1,cid,proc,13,sha,interval '2 minutes');
  if (r->>'verified')::boolean or r->>'reason' <> 'SUCCESSOR_ENROLLMENT_NOT_ACTIVE' then raise exception 'revoked enrollment accepted: %',r; end if;

  r := public.h205f22_compute_unified_successor_readback_v1(w,1,cid,proc,13,sha,interval '11 minutes');
  if (r->>'verified')::boolean or r->>'reason' <> 'HEARTBEAT_AGE_BOUND_INVALID' then raise exception 'unbounded freshness accepted: %',r; end if;
END $$;

DO $$ BEGIN
  if has_function_privilege('anon','public.h205f22_compute_unified_successor_readback_v1(uuid,bigint,text,text,bigint,text,interval)','EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_compute_unified_successor_readback_v1(uuid,bigint,text,text,bigint,text,interval)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_compute_unified_successor_readback_v1(uuid,bigint,text,text,bigint,text,interval)','EXECUTE') then raise exception 'service role execute missing'; end if;
END $$;
