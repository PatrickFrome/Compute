begin;
insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(client_id,workspace_id,last_seen_at,state) values('test_native_client','2de9f84b-7c0a-4091-911c-894ff1d6eaf4',clock_timestamp(),'{"client_kind":"METAENGINE_BROWSER_ELECTRON_NATIVE"}');
create temporary table issuer_qualification(name text,passed boolean);
do $q$
declare a text;r jsonb;second jsonb;
begin
 foreach a in array array['CONTROL_CAPABILITIES','TAB_CENSUS','FLEET_STATUS','PROCESS_CENSUS','PROCESS_EVENTS','SEMANTIC_CENSUS','SEMANTIC_EVENTS','CONTROL_LATENCY_STATUS','COMPUTER_STATUS','COMPUTER_OBSERVE'] loop
  r:=public.h205f22_a2_browser_supervisor_issue_native_v1('test_native_client',a,null,'{}',120,'QUALIFICATION','qualification:readonly:'||lower(a));
  if r->>'accepted'<>'true' or r->'authority_effect'<>'false'::jsonb then raise exception 'issuer failed:%',a;end if;
  insert into issuer_qualification values(a,true);
 end loop;
 second:=public.h205f22_a2_browser_supervisor_issue_native_v1('test_native_client','COMPUTER_OBSERVE',null,'{}',120,'QUALIFICATION','qualification:readonly:computer_observe');
 if second->>'replayed'<>'true' or second->>'command_id'<>r->>'command_id' then raise exception 'issuer replay failed';end if;
 insert into issuer_qualification values('idempotent replay',true);
 begin
  perform public.h205f22_a2_browser_supervisor_issue_native_v1('test_native_client','COMPUTER_STATUS',null,'{}',120,'QUALIFICATION','qualification:readonly:computer_observe');raise exception 'collision accepted';
 exception when sqlstate '22023' then
  if sqlerrm<>'native_supervisor_idempotency_collision' then raise;end if;
  insert into issuer_qualification values('collision rejected',true);
 end;
 begin
  perform public.h205f22_a2_browser_supervisor_issue_native_v1('test_native_client','EVAL',null,'{}',120,'QUALIFICATION','qualification:readonly:invalid');raise exception 'eval accepted';
 exception when raise_exception then
  if sqlerrm<>'native_supervisor_action_invalid' then raise;end if;
  insert into issuer_qualification values('arbitrary eval rejected',true);
 end;
 update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=clock_timestamp()-interval '46 seconds' where client_id='test_native_client';
 begin
  perform public.h205f22_a2_browser_supervisor_issue_native_v1('test_native_client','FLEET_STATUS',null,'{}',120,'QUALIFICATION','qualification:readonly:stale');raise exception 'stale accepted';
 exception when raise_exception then
  if sqlerrm<>'native_supervisor_client_stale' then raise;end if;
  insert into issuer_qualification values('stale client rejected',true);
 end;
end;$q$;
select jsonb_build_object('schema','metaengine.native-readonly-issuer.qualification.v1','tests',count(*),'passed',bool_and(passed),'authority_effect',false) as qualification from issuer_qualification;
rollback;
