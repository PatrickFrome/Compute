-- Atomic qualification: every fixture (including positive leases) rolls back.
-- Any failed assertion aborts the deployment transaction, retaining prior DDL.
do $qualification$
declare
 w uuid:=gen_random_uuid(); w2 uuid:=gen_random_uuid();
 client text:='authority-qualification-'||gen_random_uuid()::text;
 client2 text:='authority-qualification-'||gen_random_uuid()::text;
 process text:='process_qualification';
 r jsonb; task uuid; cases integer:=0; fixture_rolled_back boolean:=false;
begin
 begin
  r:=public.devos_environment_state_v1(w);
  if r->>'state'<>'UNAVAILABLE' or r->'generation_floor'<>'null'::jsonb
    or r->'authority_present'<>'false'::jsonb then raise exception 'Q_missing_authority_projection'; end if;
  cases:=cases+1;
  r:=public.devos_fleet_lease_v1(w,'agent','IMPLEMENTER','tab','target',28,60);
  if r->>'reason'<>'WORKSPACE_AUTHORITY_MISSING' then raise exception 'Q_missing_authority_lease'; end if;
  cases:=cases+1;
  begin
   perform public.devos_environment_resume_v1(w,28); raise exception 'Q_missing_authority_resume_allowed';
  exception when sqlstate '22023' then
   if sqlerrm<>'devos_environment_authority_missing' then raise; end if;
  end; cases:=cases+1;
  insert into public.compute_fabric_a2_browser_device_h205f22(client_id,public_jwk,key_fingerprint_sha256,admin_scopes)
   values(client,jsonb_build_object('kty','EC','crv','P-256','x',repeat('A',43),'y',repeat('B',43)),
     repeat('a',64),'["DEVOS","RECOVERY"]'::jsonb);
  insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(client_id,workspace_id,state)
   values(client,w,jsonb_build_object('supervisor_lifecycle',jsonb_build_object('keepalive',jsonb_build_object(
     'admission_generation_floor',28,'process_incarnation_id',process))));
  begin
   perform public.devos_environment_bootstrap_v1(w,client,27,process); raise exception 'Q_lower_floor_allowed';
  exception when sqlstate '22023' then
   if sqlerrm<>'devos_environment_bootstrap_generation_mismatch' then raise; end if;
  end; cases:=cases+1;
  begin
   perform public.devos_environment_bootstrap_v1(w,client,28,'other'); raise exception 'Q_other_process_allowed';
  exception when sqlstate '22023' then
   if sqlerrm<>'devos_environment_bootstrap_witness_mismatch' then raise; end if;
  end; cases:=cases+1;
  update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=clock_timestamp()-interval '91 seconds' where client_id=client;
  begin
   perform public.devos_environment_bootstrap_v1(w,client,28,process); raise exception 'Q_stale_witness_allowed';
  exception when sqlstate '22023' then
   if sqlerrm<>'devos_environment_bootstrap_witness_stale' then raise; end if;
  end; cases:=cases+1;
  update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=clock_timestamp()+interval '10 seconds' where client_id=client;
  begin
   perform public.devos_environment_bootstrap_v1(w,client,28,process); raise exception 'Q_future_witness_allowed';
  exception when sqlstate '22023' then
   if sqlerrm<>'devos_environment_bootstrap_witness_stale' then raise; end if;
  end; cases:=cases+1;
  update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=clock_timestamp() where client_id=client;
  update public.compute_fabric_a2_browser_device_h205f22 set active=false where client_id=client;
  begin
   perform public.devos_environment_bootstrap_v1(w,client,28,process); raise exception 'Q_inactive_device_allowed';
  exception when sqlstate '42501' then
   if sqlerrm<>'devos_environment_bootstrap_admin_required' then raise; end if;
  end; cases:=cases+1;
  update public.compute_fabric_a2_browser_device_h205f22 set active=true,admin_scopes='["DEVOS"]'::jsonb where client_id=client;
  begin
   perform public.devos_environment_bootstrap_v1(w,client,28,process); raise exception 'Q_missing_scope_allowed';
  exception when sqlstate '42501' then
   if sqlerrm<>'devos_environment_bootstrap_admin_required' then raise; end if;
  end; cases:=cases+1;
  update public.compute_fabric_a2_browser_device_h205f22 set admin_scopes='["DEVOS","RECOVERY"]'::jsonb where client_id=client;
  insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(client_id,workspace_id,state,last_seen_at)
   values(client2,w,'{"supervisor_lifecycle":{"keepalive":{"admission_generation_floor":29}}}'::jsonb,clock_timestamp()-interval '1 day');
  begin
   perform public.devos_environment_bootstrap_v1(w,client,28,process); raise exception 'Q_newer_durable_profile_ignored';
  exception when sqlstate '22023' then
   if sqlerrm<>'devos_environment_bootstrap_newer_profile_floor' then raise; end if;
  end; cases:=cases+1;
  delete from public.compute_fabric_a2_browser_supervisor_state_h205f22 where client_id=client2;
  r:=public.devos_environment_bootstrap_v1(w,client,28,process);
  if r->'created'<>'true'::jsonb or r->>'state'<>'CLOSED' or r->>'generation_floor'<>'28'
    or r->'supervisor_admission_enabled'<>'false'::jsonb then raise exception 'Q_bootstrap_not_closed'; end if;
  cases:=cases+1;
  r:=public.devos_environment_bootstrap_v1(w,client,28,process);
  if r->'created'<>'false'::jsonb or (select count(*) from destruktion_meta.devos_fleet_event_h205f22 where workspace_id=w)<>1 then
    raise exception 'Q_bootstrap_not_idempotent'; end if;
  cases:=cases+1;
  r:=public.devos_fleet_lease_v1(w,'agent','IMPLEMENTER','tab','target',28,60);
  if r->>'reason'<>'CONTINUOUS_SERVICE_ADMISSION_FENCED' then raise exception 'Q_closed_lease_allowed'; end if;
  cases:=cases+1;
  begin
   perform public.devos_environment_resume_v1(w,27); raise exception 'Q_stale_resume_allowed';
  exception when sqlstate '22023' then
   if sqlerrm<>'devos_environment_resume_generation_mismatch' then raise; end if;
  end; cases:=cases+1;
  r:=public.devos_environment_resume_v1(w,28);
  if r->>'state'<>'OPEN' or r->>'generation_floor'<>'28' then raise exception 'Q_exact_resume_failed'; end if;
  cases:=cases+1;
  perform public.devos_environment_resume_v1(w,28);
  if (select count(*) from destruktion_meta.devos_fleet_event_h205f22 where workspace_id=w)<>2 then raise exception 'Q_resume_not_idempotent'; end if;
  cases:=cases+1;
  insert into destruktion_meta.devos_fleet_task_h205f22(workspace_id,point_id,role,base_sha,task_spec_sha256,idempotency_key)
   values(w,'AUTHORITY_QUALIFICATION','IMPLEMENTER',repeat('a',40),repeat('b',64),client) returning task_id into task;
  r:=public.devos_fleet_lease_v1(w,'agent','IMPLEMENTER','tab','target',27,60);
  if r->>'reason'<>'AGENT_GENERATION_FENCED' or (select state from destruktion_meta.devos_fleet_task_h205f22 where task_id=task)<>'READY' then
    raise exception 'Q_old_generation_leased'; end if;
  cases:=cases+1;
  r:=public.devos_fleet_lease_v1(w,'agent','IMPLEMENTER','tab','target',28,60);
  if r->'leased'<>'true'::jsonb or r->>'task_id'<>task::text then raise exception 'Q_positive_lease_failed'; end if;
  cases:=cases+1;
  -- A second absent workspace witnesses each active-execution blocker.
  update public.compute_fabric_a2_browser_supervisor_state_h205f22 set workspace_id=w2 where client_id=client;
  update destruktion_meta.devos_fleet_claim_h205f22 set workspace_id=w2 where task_id=task;
  begin
   perform public.devos_environment_bootstrap_v1(w2,client,28,process); raise exception 'Q_active_claim_allowed';
  exception when sqlstate '55000' then
   if sqlerrm<>'devos_environment_bootstrap_live_execution' then raise; end if;
  end; cases:=cases+1;
  update destruktion_meta.devos_fleet_claim_h205f22 set state='CLOSED' where task_id=task;
  update destruktion_meta.devos_fleet_task_h205f22 set workspace_id=w2 where task_id=task;
  begin
   perform public.devos_environment_bootstrap_v1(w2,client,28,process); raise exception 'Q_active_task_allowed';
  exception when sqlstate '55000' then
   if sqlerrm<>'devos_environment_bootstrap_live_execution' then raise; end if;
  end; cases:=cases+1;
  update destruktion_meta.devos_fleet_task_h205f22 set state='FENCED' where task_id=task;
  insert into public.compute_fabric_a2_supervisor_actuation_lease_h205f22(workspace_id,target_client_id,holder_supervisor_instance_id,effect_scope,effect_key,status,expires_at)
   values(w2,client,'qualification','TEST','test','ACTIVE',clock_timestamp()+interval '1 minute');
  begin
   perform public.devos_environment_bootstrap_v1(w2,client,28,process); raise exception 'Q_active_effect_lease_allowed';
  exception when sqlstate '55000' then
   if sqlerrm<>'devos_environment_bootstrap_live_execution' then raise; end if;
  end; cases:=cases+1;
  if has_function_privilege('anon','public.devos_environment_bootstrap_v1(uuid,text,bigint,text)','EXECUTE')
    or has_function_privilege('authenticated','public.devos_environment_resume_v1(uuid,bigint)','EXECUTE')
    or not has_function_privilege('service_role','public.devos_environment_bootstrap_v1(uuid,text,bigint,text)','EXECUTE') then
    raise exception 'Q_function_privilege_exposure'; end if;
  cases:=cases+1;
  raise exception 'qualification_fixture_rollback' using errcode='PZ001';
 exception when sqlstate 'PZ001' then
  if sqlerrm<>'qualification_fixture_rollback' then raise; end if;
  fixture_rolled_back:=true;
 end;
 if not fixture_rolled_back or cases<>22 or exists(select 1 from destruktion_meta.devos_fleet_runtime_control_h205f22 where workspace_id in (w,w2))
   or exists(select 1 from public.compute_fabric_a2_browser_supervisor_state_h205f22 where client_id in (client,client2)) then
   raise exception 'Q_fixture_rollback_failed: % cases',cases;
 end if;
 raise notice 'WORKSPACE_AUTHORITY_RECOVERY: 22/22 PASS; all fixtures rolled back';
end $qualification$;
