-- Atomic qualification: all device/ticket fixtures roll back in a subtransaction.
do $qualification$
declare
  d uuid := gen_random_uuid();
  c text := 'guardian-qualification-' || d::text;
  fp text := repeat('a',64);
  sid text := repeat('b',64);
  t text := repeat('c',64);
  r jsonb;
  cases integer := 0;
begin
  begin
    insert into public.compute_fabric_a2_browser_device_h205f22
      (device_id,client_id,public_jwk,key_fingerprint_sha256,access_tier,admin_scopes,admin_grant_epoch)
    values (d,c,jsonb_build_object('kty','EC','crv','P-256','x',repeat('A',43),'y',repeat('B',43)),fp,
      'ADMIN','["CONTROL_PLANE"]'::jsonb,9);
    r := public.client_v1_guardian_enrollment_ticket_issue_v1(c,d,fp,9,t,90);
    if r->>'accepted' <> 'true' or r->>'plaintext_persisted' <> 'false' then raise exception 'valid_issue_failed'; end if;
    cases := cases+1;
    r := public.client_v1_guardian_enrollment_ticket_consume_v1(t,repeat('d',64),sid);
    if r->>'accepted' <> 'false' then raise exception 'wrong_fingerprint_accepted'; end if;
    cases := cases+1;
    r := public.client_v1_guardian_enrollment_ticket_consume_v1(t,fp,'bad');
    if r->>'reason' <> 'OWNER_SID_PROOF_INVALID' then raise exception 'invalid_sid_accepted'; end if;
    cases := cases+1;
    r := public.client_v1_guardian_enrollment_ticket_consume_v1(t,fp,sid);
    if r->>'accepted' <> 'true' or r->>'device_grant_revalidated' <> 'true' then raise exception 'valid_consume_failed'; end if;
    cases := cases+1;
    r := public.client_v1_guardian_enrollment_ticket_consume_v1(t,fp,sid);
    if r->>'accepted' <> 'false' then raise exception 'ticket_replay_accepted'; end if;
    cases := cases+1;
    t := repeat('d',64);
    perform public.client_v1_guardian_enrollment_ticket_issue_v1(c,d,fp,9,t,90);
    update public.compute_fabric_a2_browser_device_h205f22 set admin_grant_epoch=10 where device_id=d;
    r := public.client_v1_guardian_enrollment_ticket_consume_v1(t,fp,sid);
    if r->>'reason' <> 'DEVICE_GRANT_REVOKED' then raise exception 'epoch_drift_accepted'; end if;
    cases := cases+1;
    update public.compute_fabric_a2_browser_device_h205f22 set admin_grant_epoch=9,admin_scopes='["DIAGNOSTICS"]' where device_id=d;
    r := public.client_v1_guardian_enrollment_ticket_consume_v1(t,fp,sid);
    if r->>'reason' <> 'DEVICE_GRANT_REVOKED' then raise exception 'scope_drift_accepted'; end if;
    cases := cases+1;
    update public.compute_fabric_a2_browser_device_h205f22 set admin_scopes='["CONTROL_PLANE"]',admin_revoked_at=clock_timestamp() where device_id=d;
    r := public.client_v1_guardian_enrollment_ticket_consume_v1(t,fp,sid);
    if r->>'reason' <> 'DEVICE_GRANT_REVOKED' then raise exception 'admin_revocation_accepted'; end if;
    cases := cases+1;
    update public.compute_fabric_a2_browser_device_h205f22 set admin_revoked_at=null,active=false where device_id=d;
    r := public.client_v1_guardian_enrollment_ticket_consume_v1(t,fp,sid);
    if r->>'reason' <> 'DEVICE_GRANT_REVOKED' then raise exception 'inactive_device_accepted'; end if;
    cases := cases+1;
    update public.compute_fabric_a2_browser_device_h205f22 set active=true where device_id=d;
    update public.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22 set issued_at=clock_timestamp()-interval '5 minutes',expires_at=clock_timestamp()-interval '4 minutes' where ticket_sha256=t;
    r := public.client_v1_guardian_enrollment_ticket_consume_v1(t,fp,sid);
    if r->>'reason' <> 'TICKET_NOT_AVAILABLE' then raise exception 'expired_ticket_accepted'; end if;
    cases := cases+1;
    begin
      perform public.client_v1_guardian_enrollment_ticket_issue_v1(c,d,fp,8,repeat('e',64),90);
      raise exception 'wrong_issue_epoch_accepted';
    exception when others then
      if sqlerrm <> 'guardian_enrollment_ticket_admin_grant_invalid' then raise; end if;
    end;
    cases := cases+1;
    begin
      perform public.client_v1_guardian_enrollment_ticket_issue_v1('wrong-client',d,fp,9,repeat('f',64),90);
      raise exception 'wrong_client_accepted';
    exception when others then
      if sqlerrm <> 'guardian_enrollment_ticket_device_not_found' then raise; end if;
    end;
    cases := cases+1;
    if not (select relrowsecurity from pg_class where oid='public.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22'::regclass) then raise exception 'ticket_rls_disabled'; end if;
    cases := cases+1;
    if has_function_privilege('anon','public.client_v1_guardian_enrollment_ticket_consume_v1(text,text,text)','EXECUTE')
      or has_function_privilege('authenticated','public.client_v1_guardian_enrollment_ticket_issue_v1(text,uuid,text,bigint,text,integer)','EXECUTE')
      or has_table_privilege('anon','public.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22','SELECT') then raise exception 'ticket_public_access'; end if;
    cases := cases+1;
    if cases <> 14 then raise exception 'qualification_case_count_wrong'; end if;
    raise exception using errcode='GX001',message='ROLLBACK_GUARDIAN_QUALIFICATION_FIXTURES';
  exception when sqlstate 'GX001' then
    if cases <> 14 then raise exception 'qualification_not_completed'; end if;
  end;
  if exists (select 1 from public.compute_fabric_a2_browser_device_h205f22 where client_id=c) then raise exception 'qualification_device_fixture_not_rolled_back'; end if;
  raise notice 'guardian enrollment SQL qualification: 14/14, fixtures rolled back';
end;
$qualification$;
