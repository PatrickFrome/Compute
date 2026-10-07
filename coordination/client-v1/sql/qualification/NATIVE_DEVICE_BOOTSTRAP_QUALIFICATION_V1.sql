begin;
create temporary table native_bootstrap_qualification(name text,passed boolean);
create function pg_temp.test_bootstrap() returns jsonb language sql as $$
select public.devos_fleet_transport_promotion_lease_v2('2de9f84b-7c0a-4091-911c-894ff1d6eaf4','bootstrap_client',
 '719bf900-9e50-44ec-b13b-fd998f33ba95','agent_12345678','tab_dfa1fcc6-dbdb-4140-8b64-3fdd16160977','webcontents:2',28,45)$$;
create function pg_temp.reject_bootstrap(expected text) returns void language plpgsql as $$
begin
 begin perform pg_temp.test_bootstrap();raise exception 'unexpected lease';
 exception when sqlstate '22023' then if sqlerrm<>expected then raise;end if;end;
 insert into native_bootstrap_qualification values(expected,true);
end$$;
insert into public.compute_fabric_a2_browser_device_h205f22
 (device_id,client_id,active,access_tier,admin_scopes,admin_grant_epoch,key_fingerprint_sha256)
 values('719bf900-9e50-44ec-b13b-fd998f33ba95','bootstrap_client',true,'ADMIN','["FLEET","DEVOS"]',1,repeat('a',64));
insert into destruktion_meta.devos_fleet_runtime_control_h205f22 values('2de9f84b-7c0a-4091-911c-894ff1d6eaf4',28,true,true);
insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(client_id,workspace_id,last_seen_at,armed,supervisor_mode,state)
 values('bootstrap_client','2de9f84b-7c0a-4091-911c-894ff1d6eaf4',clock_timestamp(),true,'CONTROL',
 jsonb_build_object('client_kind','METAENGINE_BROWSER_ELECTRON_NATIVE',
 'transport_identity',jsonb_build_object('device_id','719bf900-9e50-44ec-b13b-fd998f33ba95','admin_grant_epoch',1,'key_fingerprint_sha256',repeat('a',64)),
 'supervisor_mesh',jsonb_build_object('mesh',jsonb_build_object('schema','metaengine.supervisor-mesh.state.v1','supervisors','[]'::jsonb)),
 'fleet',jsonb_build_object('schema','metaengine.browser.fleet-snapshot.v1','readiness_contract','TRANSPORT_PROOF_REQUIRED','agents',
 jsonb_build_array(jsonb_build_object('agent_id','agent_12345678','ownership','FLEET_OWNED','lifecycle_state','BOUND_UNVERIFIED',
 'transport_proof',null,'authority_effect',false,'automatic_retry_allowed',false,
 'tab_id','tab_dfa1fcc6-dbdb-4140-8b64-3fdd16160977','target_id','webcontents:2','generation_epoch',28)))));
do $q$
declare original jsonb;r jsonb;r2 jsonb;key text;change jsonb;
begin
 select state into original from public.compute_fabric_a2_browser_supervisor_state_h205f22 where client_id='bootstrap_client';
 update public.compute_fabric_a2_browser_device_h205f22 set active=false where client_id='bootstrap_client';
 perform pg_temp.reject_bootstrap('native_bootstrap_device_authority_invalid');
 update public.compute_fabric_a2_browser_device_h205f22 set active=true,revoked_at=clock_timestamp() where client_id='bootstrap_client';
 perform pg_temp.reject_bootstrap('native_bootstrap_device_authority_invalid');
 update public.compute_fabric_a2_browser_device_h205f22 set revoked_at=null,access_tier='CLIENT' where client_id='bootstrap_client';
 perform pg_temp.reject_bootstrap('native_bootstrap_device_authority_invalid');
 update public.compute_fabric_a2_browser_device_h205f22 set access_tier='ADMIN',admin_revoked_at=clock_timestamp() where client_id='bootstrap_client';
 perform pg_temp.reject_bootstrap('native_bootstrap_device_authority_invalid');
 update public.compute_fabric_a2_browser_device_h205f22 set admin_revoked_at=null,admin_scopes='["FLEET"]' where client_id='bootstrap_client';
 perform pg_temp.reject_bootstrap('native_bootstrap_device_authority_invalid');
 update public.compute_fabric_a2_browser_device_h205f22 set admin_scopes='["FLEET","DEVOS"]',admin_grant_epoch=2 where client_id='bootstrap_client';
 perform pg_temp.reject_bootstrap('native_bootstrap_runtime_identity_drift');
 update public.compute_fabric_a2_browser_device_h205f22 set admin_grant_epoch=1 where client_id='bootstrap_client';
 update destruktion_meta.devos_fleet_runtime_control_h205f22 set refill_enabled=false;
 perform pg_temp.reject_bootstrap('native_bootstrap_admission_fenced');
 update destruktion_meta.devos_fleet_runtime_control_h205f22 set refill_enabled=true,supervisor_admission_enabled=false;
 perform pg_temp.reject_bootstrap('native_bootstrap_admission_fenced');
 update destruktion_meta.devos_fleet_runtime_control_h205f22 set supervisor_admission_enabled=true,generation_floor=29;
 perform pg_temp.reject_bootstrap('native_bootstrap_admission_fenced');
 update destruktion_meta.devos_fleet_runtime_control_h205f22 set generation_floor=28;
 update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=clock_timestamp()-interval '46 seconds' where client_id='bootstrap_client';
 perform pg_temp.reject_bootstrap('native_bootstrap_runtime_fenced');
 update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=clock_timestamp(),armed=false where client_id='bootstrap_client';
 perform pg_temp.reject_bootstrap('native_bootstrap_runtime_fenced');
 update public.compute_fabric_a2_browser_supervisor_state_h205f22 set armed=true,supervisor_mode='MONITOR' where client_id='bootstrap_client';
 perform pg_temp.reject_bootstrap('native_bootstrap_runtime_fenced');
 update public.compute_fabric_a2_browser_supervisor_state_h205f22 set supervisor_mode='CONTROL',state=original-'supervisor_mesh' where client_id='bootstrap_client';
 perform pg_temp.reject_bootstrap('native_bootstrap_mesh_invalid');
 for key,change in select * from (values('tab_id','"tab_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"'::jsonb),
 ('target_id','"webcontents:3"'::jsonb),('generation_epoch','29'::jsonb),('ownership','"USER"'::jsonb),
 ('lifecycle_state','"ACTIVE"'::jsonb),('transport_proof','{}'::jsonb),('authority_effect','true'::jsonb),
 ('automatic_retry_allowed','true'::jsonb)) changes(k,v) loop
  update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=jsonb_set(original,array['fleet','agents','0',key],change) where client_id='bootstrap_client';
  perform pg_temp.reject_bootstrap('native_bootstrap_agent_binding_drift');
 end loop;
 update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=jsonb_set(original,'{supervisor_mesh,mesh,supervisors}','[{"status":"AMBIGUOUS_INCARNATION"}]') where client_id='bootstrap_client';
 if pg_temp.test_bootstrap()->>'legacy_mesh_route'<>'true' then raise exception 'mesh path bypassed';end if;
 insert into native_bootstrap_qualification values('existing mesh delegates to legacy path',true);
 update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=original where client_id='bootstrap_client';
 r:=pg_temp.test_bootstrap();r2:=pg_temp.test_bootstrap();
 if r->>'leased'<>'true' or r->>'holder_kind'<>'NATIVE_DEVICE_BOOTSTRAP' or r2->>'duplicate'<>'true'
  or r->>'lease_id'<>r2->>'lease_id' or r->>'scheduler_authority'<>'false' then raise exception 'exact bootstrap failed';end if;
 insert into native_bootstrap_qualification values('exact device bootstrap and duplicate readback',true);
 update public.compute_fabric_a2_native_bootstrap_binding_h205f22 set target_id='webcontents:3';
 perform pg_temp.reject_bootstrap('native_bootstrap_lease_binding_drift');
 update public.compute_fabric_a2_native_bootstrap_binding_h205f22 set target_id='webcontents:2';
 update public.compute_fabric_a2_supervisor_actuation_lease_h205f22 set holder_supervisor_instance_id='sup_existing';
 if pg_temp.test_bootstrap()->>'reason'<>'CLIENT_ACTUATION_LEASE_BUSY' then raise exception 'shared lease exclusivity failed';end if;
 insert into native_bootstrap_qualification values('existing client actuator excludes native bootstrap',true);
 update public.compute_fabric_a2_supervisor_actuation_lease_h205f22 set expires_at=clock_timestamp()-interval '1 second';
 r2:=pg_temp.test_bootstrap();
 if r->>'lease_id'=r2->>'lease_id' or r2->>'leased'<>'true' then raise exception 'expiry failed';end if;
 insert into native_bootstrap_qualification values('expired lease replaced atomically',true);
 if has_function_privilege('anon','public.devos_fleet_transport_promotion_lease_v2(uuid,text,uuid,text,text,text,bigint,integer)','execute')
  or has_function_privilege('authenticated','public.devos_fleet_transport_promotion_lease_v2(uuid,text,uuid,text,text,text,bigint,integer)','execute') then raise exception 'public execute leak';end if;
 if not (select relrowsecurity from pg_class where oid='public.compute_fabric_a2_native_bootstrap_binding_h205f22'::regclass) then raise exception 'binding RLS missing';end if;
 insert into native_bootstrap_qualification values('RLS and public RPC denied',true);
end $q$;
select jsonb_build_object('schema','metaengine.native-device-bootstrap.qualification.v1','tests',count(*),'passed',bool_and(passed),'authority_effect',false) as qualification from native_bootstrap_qualification;
rollback;
