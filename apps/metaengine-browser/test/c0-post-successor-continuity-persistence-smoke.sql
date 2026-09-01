\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
\i supabase/migrations/20260901214500_compute_unified_post_successor_continuity_persistence_v1.sql

DO $$ declare p jsonb; r1 jsonb; r2 jsonb; begin
 p:=jsonb_build_object(
  'schema','metaengine.compute-unified.post-successor-continuity-readback.v1','verified',true,
  'reason','POST_SUCCESSOR_CONTINUITY_VERIFIED','workspace_id','11111111-1111-1111-1111-111111111111',
  'successor_client_id','client-new','successor_process_incarnation_id','proc-new','successor_supervisor_epoch',8,
  'expected_source_git_commit',repeat('a',40),'heartbeat_observed_at','2026-09-01T18:00:00Z','enrollment_active',true,
  'automatic_retry_allowed',false,'restart_authorized',false,'wake_replay_authorized',false,
  'lease_mutation_authorized',false,'authority_effect',false);
 r1:=public.h205f22_persist_compute_unified_post_successor_continuity_v1('attempt-1',p);
 if not coalesce((r1->>'persistence_effect')::boolean,false) or coalesce((r1->>'authority_effect')::boolean,true) then raise exception 'first persistence failed/leaked authority: %',r1; end if;
 r2:=public.h205f22_persist_compute_unified_post_successor_continuity_v1('attempt-1',p);
 if coalesce((r2->>'persistence_effect')::boolean,true) then raise exception 'exact replay caused physical rewrite: %',r2; end if;
 begin perform public.h205f22_persist_compute_unified_post_successor_continuity_v1('attempt-1',jsonb_set(p,'{successor_process_incarnation_id}','"proc-drift"')); raise exception 'drift replay accepted'; exception when others then if sqlerrm='drift replay accepted' then raise; end if; end;
 begin perform public.h205f22_persist_compute_unified_post_successor_continuity_v1('attempt-2',jsonb_set(p,'{automatic_retry_allowed}','true')); raise exception 'retry-authorized proof accepted'; exception when others then if sqlerrm='retry-authorized proof accepted' then raise; end if; end;
 begin perform public.h205f22_persist_compute_unified_post_successor_continuity_v1('attempt-3',jsonb_set(p,'{reason}','"SUCCESSOR_HEARTBEAT_STALE"')); raise exception 'unverified reason accepted'; exception when others then if sqlerrm='unverified reason accepted' then raise; end if; end;
end $$;

DO $$ begin
 if has_table_privilege('service_role','public.compute_unified_post_successor_continuity_h205f22','INSERT') then raise exception 'service_role direct insert leaked'; end if;
 if has_function_privilege('anon','public.h205f22_persist_compute_unified_post_successor_continuity_v1(text,jsonb)','EXECUTE') then raise exception 'anon execute leaked'; end if;
 if has_function_privilege('authenticated','public.h205f22_persist_compute_unified_post_successor_continuity_v1(text,jsonb)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
 if not has_function_privilege('service_role','public.h205f22_persist_compute_unified_post_successor_continuity_v1(text,jsonb)','EXECUTE') then raise exception 'service_role execute missing'; end if;
end $$;
