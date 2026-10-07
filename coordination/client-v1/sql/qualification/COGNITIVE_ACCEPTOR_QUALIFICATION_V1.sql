-- Meaningful transaction, privacy, replay, RLS and durable fallback qualification.
begin;
insert into public.compute_fabric_a2_browser_device_h205f22 values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','test_cognitive_client',true,null);
insert into public.compute_fabric_a2_browser_supervisor_state_h205f22 values('test_cognitive_client','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
create temporary table qualification_results(name text,passed boolean);
create function pg_temp.cognitive_event(s uuid,n bigint) returns jsonb language sql as $f$
 select jsonb_build_object('schema','metaengine.browser.cognitive-delta.v1','stream_id',s,'sequence',n,
 'priority','P1','source','SYSTEM','type','QUALIFICATION','raw_payload_exposed',false,'page_text_exposed',false,
 'input_values_exposed',false,'control_authority',false,'command_leasing',false,'authority_effect',false);
$f$;
create function pg_temp.assert_pass(name text,ok boolean) returns void language plpgsql as $f$
begin
 if ok is distinct from true then raise exception 'qualification_failed:%',name;end if;
 insert into qualification_results values(name,true);
end;$f$;
do $q$
declare
 w constant uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 d constant text:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 c constant text:='test_cognitive_client';
 s constant uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 other constant uuid:='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 events jsonb:=jsonb_build_array(pg_temp.cognitive_event(s,1),pg_temp.cognitive_event(s,2),pg_temp.cognitive_event(s,3));
 bad jsonb;r jsonb;before_count bigint;reason text;test_name text;
begin
 r:=public.h205f22_a2_browser_cognitive_accept_v1(w,c,d,s,0,3,events,false);
 perform pg_temp.assert_pass('contiguous SYSTEM batch accepted',r->>'accepted'='true' and r->>'broadcasted'='true');
 perform pg_temp.assert_pass('private broadcast uses preserved payload correlation',exists(select 1 from realtime.messages where payload->>'id'=r->>'broadcast_id' and private=true and payload->'events'=events));
 perform pg_temp.assert_pass('durable exact batch and counters',exists(select 1 from public.compute_fabric_a2_browser_cognitive_cursor_h205f22 where stream_id=s and accepted_through_sequence=3 and accepted_batches=1 and accepted_events=3 and last_batch->'events'=events));
 perform pg_temp.assert_pass('ACK never confers authority',r->'authority_effect'='false'::jsonb and r->'control_authority'='false'::jsonb and r->'command_leasing'='false'::jsonb);
 before_count:=(select count(*) from realtime.messages);
 r:=public.h205f22_a2_browser_cognitive_accept_v1(w,c,d,s,0,3,events,false);
 perform pg_temp.assert_pass('ACK loss replay has no repeated broadcast',r->>'accepted'='true' and r->>'duplicate'='true' and r->>'broadcasted'='false' and (select count(*) from realtime.messages)=before_count);
 begin
  bad:=jsonb_set(events,'{1,type}','"ALTERED_REPLAY"');
  perform public.h205f22_a2_browser_cognitive_accept_v1(w,c,d,s,0,3,bad,false);raise exception 'conflicting replay accepted';
 exception when sqlstate '22023' then perform pg_temp.assert_pass('changed replay rejected',sqlerrm='cognitive_accept_replay_payload_conflict');end;
 r:=public.h205f22_a2_browser_cognitive_accept_v1(w,c,d,s,4,5,jsonb_build_array(pg_temp.cognitive_event(s,5)),false);
 perform pg_temp.assert_pass('gap never advances cursor',r->>'accepted'='false' and r->>'reason'='CURSOR_GAP_OR_OVERLAP' and (select count(*) from realtime.messages)=before_count);
 r:=public.h205f22_a2_browser_cognitive_accept_v1(w,c,d,s,2,4,jsonb_build_array(pg_temp.cognitive_event(s,3),pg_temp.cognitive_event(s,4)),false);
 perform pg_temp.assert_pass('overlap never advances cursor',r->>'accepted'='false' and (select count(*) from realtime.messages)=before_count);
 for test_name,bad,reason in select * from(values
 ('interior authority',jsonb_set(events,'{1,authority_effect}','true'),'cognitive_accept_event_authority_invalid'),
 ('interior raw exposure',jsonb_set(events,'{1,raw_payload_exposed}','true'),'cognitive_accept_event_authority_invalid'),
 ('missing interior fence',jsonb_set(events,'{1}',(events->1)-'command_leasing'),'cognitive_accept_event_authority_invalid'),
 ('interior raw page',jsonb_set(events,'{1,raw_page}','"PRIVATE_TEXT"'),'cognitive_accept_unprojected_event_field'),
 ('interior sequence gap',jsonb_set(events,'{1,sequence}','9'),'cognitive_accept_event_sequence_invalid'),
 ('string sequence',jsonb_set(events,'{1,sequence}','"2"'),'cognitive_accept_event_schema_invalid'),
 ('unknown source',jsonb_set(events,'{1,source}','"REMOTE_PROMPT"'),'cognitive_accept_event_schema_invalid'),
 ('oversized type',jsonb_set(events,'{1,type}',to_jsonb(repeat('x',97))),'cognitive_accept_event_text_invalid'),
 ('unsafe integer',jsonb_set(events,'{1,os_pid}','9007199254740992'),'cognitive_accept_event_integer_invalid'),
 ('missing type',jsonb_set(events,'{1}',(events->1)-'type'),'cognitive_accept_event_type_invalid'),
 ('wrong stream',jsonb_set(events,'{1,stream_id}',to_jsonb(other::text)),'cognitive_accept_event_schema_invalid'),
 ('empty events','[]'::jsonb,'cognitive_accept_event_count_invalid'),
 ('nonarray events','{}'::jsonb,'cognitive_accept_events_invalid'),
 ('oversized body',jsonb_set(events,'{1,name}',to_jsonb(repeat('x',262145))),'cognitive_accept_events_too_large')
 ) cases(name,events,error) loop
  begin
   perform public.h205f22_a2_browser_cognitive_accept_v1(w,c,d,s,0,3,bad,false);raise exception 'negative case accepted:%',test_name;
  exception when sqlstate '22023' then perform pg_temp.assert_pass(test_name,sqlerrm=reason);end;
 end loop;
 begin
  perform public.h205f22_a2_browser_cognitive_accept_v1(w,c,d,other,0,1,jsonb_build_array(pg_temp.cognitive_event(other,1)),true);raise exception 'authority accepted';
 exception when sqlstate '22023' then perform pg_temp.assert_pass('batch authority forbidden',sqlerrm='cognitive_accept_authority_forbidden');end;
 begin
  perform public.h205f22_a2_browser_cognitive_accept_v1(w,c,other::text,s,0,3,events,false);raise exception 'wrong device accepted';
 exception when sqlstate '22023' then perform pg_temp.assert_pass('wrong device rejected',sqlerrm='cognitive_accept_device_binding_invalid');end;
 begin
  perform public.h205f22_a2_browser_cognitive_accept_v1(other,c,d,s,0,3,events,false);raise exception 'wrong workspace accepted';
 exception when sqlstate '22023' then perform pg_temp.assert_pass('wrong workspace rejected',sqlerrm='cognitive_accept_device_binding_invalid');end;
 update public.compute_fabric_a2_browser_device_h205f22 set revoked_at=clock_timestamp();
 begin
  perform public.h205f22_a2_browser_cognitive_accept_v1(w,c,d,s,0,3,events,false);raise exception 'revoked device accepted';
 exception when sqlstate '22023' then perform pg_temp.assert_pass('revoked device rejected',sqlerrm='cognitive_accept_device_binding_invalid');end;
 update public.compute_fabric_a2_browser_device_h205f22 set revoked_at=null;
 perform set_config('test.drop_broadcast','true',true);
 r:=public.h205f22_a2_browser_cognitive_accept_v1(w,c,d,other,0,1,jsonb_build_array(pg_temp.cognitive_event(other,1)),false);
 perform pg_temp.assert_pass('swallowed failure yields honest durable fallback',r->>'accepted'='true' and r->>'broadcasted'='false' and r->>'delivery_mode'='DURABLE_LATEST_BATCH' and r->'full_state_fallback_required'='true'::jsonb);
 perform pg_temp.assert_pass('fallback ACK requires exact durable evidence',exists(select 1 from public.compute_fabric_a2_browser_cognitive_cursor_h205f22 where stream_id=other and accepted_through_sequence=1 and last_batch->'events'=jsonb_build_array(pg_temp.cognitive_event(other,1)) and not last_broadcast_persisted));
 perform set_config('test.drop_broadcast','false',true);
 r:=public.h205f22_a2_browser_cognitive_accept_v1(w,c,d,other,0,1,jsonb_build_array(pg_temp.cognitive_event(other,1)),false);
 perform pg_temp.assert_pass('fallback replay never rebroadcasts',r->>'accepted'='true' and r->>'duplicate'='true' and r->>'broadcasted'='false' and r->'full_state_fallback_required'='true'::jsonb);
 r:=public.h205f22_a2_browser_cognitive_accept_v1(w,c,d,other,1,2,jsonb_build_array(pg_temp.cognitive_event(other,2)),false);
 perform pg_temp.assert_pass('next batch resumes Realtime',r->>'broadcasted'='true' and r->'full_state_fallback_required'='false'::jsonb);
 perform pg_temp.assert_pass('storage retains one bounded latest batch',exists(select 1 from public.compute_fabric_a2_browser_cognitive_cursor_h205f22 where stream_id=other and accepted_through_sequence=2 and jsonb_array_length(last_batch->'events')=1 and last_batch->>'after_sequence'='1' and last_broadcast_persisted));
 perform pg_temp.assert_pass('frontend cannot execute acceptor',not has_function_privilege('anon','public.h205f22_a2_browser_cognitive_accept_v1(uuid,text,text,uuid,bigint,bigint,jsonb,boolean)','EXECUTE') and not has_function_privilege('authenticated','public.h205f22_a2_browser_cognitive_accept_v1(uuid,text,text,uuid,bigint,bigint,jsonb,boolean)','EXECUTE'));
 perform pg_temp.assert_pass('service can execute acceptor',has_function_privilege('service_role','public.h205f22_a2_browser_cognitive_accept_v1(uuid,text,text,uuid,bigint,bigint,jsonb,boolean)','EXECUTE'));
 perform pg_temp.assert_pass('cursor RLS enabled',(select relrowsecurity from pg_class where oid='public.compute_fabric_a2_browser_cognitive_cursor_h205f22'::regclass));
 perform pg_temp.assert_pass('frontend cannot read cursor',not has_table_privilege('anon','public.compute_fabric_a2_browser_cognitive_cursor_h205f22','SELECT') and not has_table_privilege('authenticated','public.compute_fabric_a2_browser_cognitive_cursor_h205f22','SELECT'));
end;$q$;
set local role service_role;
select public.h205f22_a2_browser_cognitive_accept_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','test_cognitive_client','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',0,1,
 '[{"schema":"metaengine.browser.cognitive-delta.v1","stream_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","sequence":1,"priority":"P1","source":"SYSTEM","type":"SERVICE_ROLE_PROBE","raw_payload_exposed":false,"page_text_exposed":false,"input_values_exposed":false,"control_authority":false,"command_leasing":false,"authority_effect":false}]',false);
reset role;
select pg_temp.assert_pass('invoker under actual service role',exists(select 1 from public.compute_fabric_a2_browser_cognitive_cursor_h205f22 where stream_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' and accepted_through_sequence=1));
select jsonb_build_object('schema','metaengine.cognitive-acceptor.qualification.v1','tests',count(*),'passed',bool_and(passed),'authority_effect',false) as qualification from qualification_results;
rollback;
