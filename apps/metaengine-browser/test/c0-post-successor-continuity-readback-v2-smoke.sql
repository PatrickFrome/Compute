\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
\i supabase/migrations/20260901214500_compute_unified_post_successor_continuity_persistence_v1.sql
\i supabase/migrations/20260901225000_compute_unified_post_successor_continuity_readback_v2.sql

DO $$ declare p jsonb; persisted jsonb; readback jsonb; fp text; ws uuid:='11111111-1111-1111-1111-111111111111'; begin
 p:=jsonb_build_object(
  'schema','metaengine.compute-unified.post-successor-continuity-readback.v1','verified',true,
  'reason','POST_SUCCESSOR_CONTINUITY_VERIFIED','workspace_id',ws,
  'successor_client_id','client-new','successor_process_incarnation_id','proc-new','successor_supervisor_epoch',8,
  'expected_source_git_commit',repeat('a',40),'heartbeat_observed_at','2026-09-01T18:00:00Z','enrollment_active',true,
  'automatic_retry_allowed',false,'restart_authorized',false,'wake_replay_authorized',false,
  'lease_mutation_authorized',false,'authority_effect',false);
 persisted:=public.h205f22_persist_compute_unified_post_successor_continuity_v1('attempt-1',p);
 fp:=persisted->>'proof_fingerprint_sha256';
 readback:=public.h205f22_read_compute_unified_post_successor_continuity_v2(ws,'attempt-1',fp);
 if not coalesce((readback->>'verified')::boolean,false)
    or readback->>'reason' is distinct from 'DURABLE_POST_SUCCESSOR_CONTINUITY_VERIFIED'
    or coalesce((readback->>'automatic_retry_allowed')::boolean,true)
    or coalesce((readback->>'authority_effect')::boolean,true) then
   raise exception 'verified durable readback failed/leaked authority: %',readback;
 end if;

 begin
   perform public.h205f22_read_compute_unified_post_successor_continuity_v2(ws,'attempt-1',repeat('b',64));
   raise exception 'wrong fingerprint accepted';
 exception when others then if sqlerrm='wrong fingerprint accepted' then raise; end if; end;

 begin
   update public.compute_unified_post_successor_continuity_h205f22
      set verified_proof=jsonb_set(verified_proof,'{successor_process_incarnation_id}','"proc-tampered"')
    where workspace_id=ws and attempt_id='attempt-1';
   perform public.h205f22_read_compute_unified_post_successor_continuity_v2(ws,'attempt-1',fp);
   raise exception 'tampered durable proof accepted';
 exception when others then if sqlerrm='tampered durable proof accepted' then raise; end if; end;

 begin
   perform public.h205f22_read_compute_unified_post_successor_continuity_v2(ws,'missing-attempt',fp);
   raise exception 'missing proof accepted';
 exception when others then if sqlerrm='missing proof accepted' then raise; end if; end;
end $$;

DO $$ begin
 if has_function_privilege('anon','public.h205f22_read_compute_unified_post_successor_continuity_v2(uuid,text,text)','EXECUTE') then raise exception 'anon execute leaked'; end if;
 if has_function_privilege('authenticated','public.h205f22_read_compute_unified_post_successor_continuity_v2(uuid,text,text)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
 if not has_function_privilege('service_role','public.h205f22_read_compute_unified_post_successor_continuity_v2(uuid,text,text)','EXECUTE') then raise exception 'service_role execute missing'; end if;
end $$;
