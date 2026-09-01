\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

create table public.compute_fabric_a2_browser_supervisor_state_h205f22(
 client_id text primary key, workspace_id uuid not null, last_seen_at timestamptz not null,
 supervisor_mode text not null, armed boolean not null, state jsonb not null default '{}'::jsonb
);
create table public.compute_fabric_a2_browser_device_h205f22(
 device_id uuid primary key, client_id text not null, active boolean not null, revoked_at timestamptz
);
create table public.compute_fabric_a2_browser_architecture_checkpoint_h205f22(
 architecture_version text primary key,status text not null,git_branch text not null,git_commit text not null,created_at timestamptz not null default now()
);

create or replace function public.h205f22_compute_unified_verified_restart_successor_continuity_v1(
 p_workspace_id uuid,p_attempt_id text,p_effect_key text,p_receipt_fingerprint_sha256 text,p_checkpoint_id bigint,p_successor_process_incarnation_id text,p_successor_epoch bigint,p_expected_source_git_commit text
) returns jsonb language plpgsql stable as $$ begin
 if p_attempt_id='bad' then return jsonb_build_object('continuity_accepted',false,'automatic_retry_allowed',false,'authority_effect',false); end if;
 return jsonb_build_object('continuity_accepted',true,'automatic_retry_allowed',false,'restart_authorized',false,'wake_replay_authorized',false,'lease_mutation_authorized',false,'authority_effect',false);
end $$;

\i supabase/migrations/20260901190000_compute_unified_post_successor_continuity_readback_v1.sql

insert into public.compute_fabric_a2_browser_supervisor_state_h205f22 values(
 'client-new','11111111-1111-1111-1111-111111111111',clock_timestamp(),'CONTROL',true,
 jsonb_build_object('process_incarnation_id','proc-new','supervisor_lifecycle',jsonb_build_object(
   'keepalive',jsonb_build_object('supervisor_id','METAENGINE_SUPERVISOR','state','ACTIVE','supervisor_epoch',8),
   'supervisor_generation','IDLE'))
);
insert into public.compute_fabric_a2_browser_device_h205f22 values('22222222-2222-2222-2222-222222222222','client-new',true,null);
insert into public.compute_fabric_a2_browser_architecture_checkpoint_h205f22 values('CP','AUTHORITATIVE','integration/compute-unified-v1',repeat('a',40),clock_timestamp());

DO $$ declare w uuid:='11111111-1111-1111-1111-111111111111'; r jsonb; begin
 r:=public.h205f22_compute_unified_post_successor_continuity_readback_v1(w,'ok','restart:ok',repeat('1',64),42,'client-new','proc-new',8,repeat('a',40),interval '120 seconds');
 if not coalesce((r->>'verified')::boolean,false) or r->>'reason' is distinct from 'POST_SUCCESSOR_CONTINUITY_VERIFIED' or coalesce((r->>'automatic_retry_allowed')::boolean,true) or coalesce((r->>'authority_effect')::boolean,true) then raise exception 'valid readback rejected/leaked authority: %',r; end if;

 update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=clock_timestamp()-interval '5 minutes' where client_id='client-new';
 r:=public.h205f22_compute_unified_post_successor_continuity_readback_v1(w,'ok','restart:ok',repeat('1',64),42,'client-new','proc-new',8,repeat('a',40),interval '120 seconds');
 if coalesce((r->>'verified')::boolean,true) or r->>'reason' is distinct from 'SUCCESSOR_HEARTBEAT_STALE' then raise exception 'stale heartbeat accepted: %',r; end if;
 update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=clock_timestamp() where client_id='client-new';

 r:=public.h205f22_compute_unified_post_successor_continuity_readback_v1(w,'ok','restart:ok',repeat('1',64),42,'client-new','proc-drift',8,repeat('a',40),interval '120 seconds');
 if coalesce((r->>'verified')::boolean,true) or r->>'reason' is distinct from 'SUCCESSOR_PROCESS_MISMATCH' then raise exception 'process drift accepted: %',r; end if;

 update public.compute_fabric_a2_browser_device_h205f22 set active=false where client_id='client-new';
 r:=public.h205f22_compute_unified_post_successor_continuity_readback_v1(w,'ok','restart:ok',repeat('1',64),42,'client-new','proc-new',8,repeat('a',40),interval '120 seconds');
 if coalesce((r->>'verified')::boolean,true) or r->>'reason' is distinct from 'SUCCESSOR_ENROLLMENT_NOT_ACTIVE' then raise exception 'inactive enrollment accepted: %',r; end if;
 update public.compute_fabric_a2_browser_device_h205f22 set active=true where client_id='client-new';

 update public.compute_fabric_a2_browser_architecture_checkpoint_h205f22 set git_commit=repeat('b',40) where architecture_version='CP';
 r:=public.h205f22_compute_unified_post_successor_continuity_readback_v1(w,'ok','restart:ok',repeat('1',64),42,'client-new','proc-new',8,repeat('a',40),interval '120 seconds');
 if coalesce((r->>'verified')::boolean,true) or r->>'reason' is distinct from 'INTEGRATION_HEAD_MISMATCH' then raise exception 'integration drift accepted: %',r; end if;

 r:=public.h205f22_compute_unified_post_successor_continuity_readback_v1(w,'bad','restart:bad',repeat('2',64),42,'client-new','proc-new',8,repeat('a',40),interval '120 seconds');
 if coalesce((r->>'verified')::boolean,true) or r->>'reason' is distinct from 'SUCCESSOR_CONTINUITY_NOT_ACCEPTED' then raise exception 'rejected continuity crossed boundary: %',r; end if;
end $$;

DO $$ begin
 if has_function_privilege('anon','public.h205f22_compute_unified_post_successor_continuity_readback_v1(uuid,text,text,text,bigint,text,text,bigint,text,interval)','EXECUTE') then raise exception 'anon execute leaked'; end if;
 if has_function_privilege('authenticated','public.h205f22_compute_unified_post_successor_continuity_readback_v1(uuid,text,text,text,bigint,text,text,bigint,text,interval)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
 if not has_function_privilege('service_role','public.h205f22_compute_unified_post_successor_continuity_readback_v1(uuid,text,text,text,bigint,text,text,bigint,text,interval)','EXECUTE') then raise exception 'service_role execute missing'; end if;
end $$;
