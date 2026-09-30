-- Harden installed-Electron qualification with a one-run random correlation
-- hash. GitHub OIDC remains the authority gate; this hash prevents another
-- unauthenticated enrollment request from racing the exact workflow request.

create or replace function public.client_v1_installed_qualification_approve_v1(
  p_run_id text,
  p_run_attempt integer,
  p_source_head text,
  p_qualification_nonce_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_request public.compute_fabric_a2_browser_device_enrollment_request_h205f22%rowtype;
  v_count integer := 0;
  v_approval jsonb;
begin
  if p_run_id is null
     or p_run_id !~ '^[0-9]{1,20}$'
     or p_run_attempt is null
     or p_run_attempt < 1
     or p_run_attempt > 999999
     or p_source_head is null
     or lower(p_source_head) !~ '^[0-9a-f]{40}$'
     or p_qualification_nonce_sha256 is null
     or lower(p_qualification_nonce_sha256) !~ '^[0-9a-f]{64}$'
  then
    return jsonb_build_object(
      'schema','metaengine.client-v1.installed-qualification-approval.v1',
      'accepted',false,
      'reason','CORRELATION_INVALID',
      'authority_effect',false
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('METAENGINE_CLIENT_V1_INSTALLED_QUALIFICATION_V2'),
    pg_catalog.hashtext(
      p_run_id || ':' || p_run_attempt::text || ':' ||
      lower(p_source_head) || ':' || lower(p_qualification_nonce_sha256)
    )
  );

  select count(*)::integer
    into v_count
    from public.compute_fabric_a2_browser_device_enrollment_request_h205f22 r
   where r.status in ('PENDING','APPROVED')
     and r.expires_at > v_now
     and r.requested_at >= v_now - interval '15 minutes'
     and r.metadata->>'qualification_kind' = 'INSTALLED_ELECTRON'
     and r.metadata->>'client_kind' = 'METAENGINE_BROWSER_ELECTRON_NATIVE'
     and r.metadata->>'qualification_run_id' = p_run_id
     and coalesce(r.metadata->>'qualification_run_attempt','') = p_run_attempt::text
     and lower(coalesce(r.metadata->>'source_head','')) = lower(p_source_head)
     and lower(coalesce(r.metadata->>'qualification_nonce_sha256','')) =
         lower(p_qualification_nonce_sha256);

  if v_count = 0 then
    return jsonb_build_object(
      'schema','metaengine.client-v1.installed-qualification-approval.v1',
      'accepted',false,
      'reason','QUALIFICATION_REQUEST_NOT_FOUND',
      'run_id',p_run_id,
      'run_attempt',p_run_attempt,
      'source_head',lower(p_source_head),
      'nonce_bound',true,
      'authority_effect',false
    );
  end if;

  if v_count <> 1 then
    return jsonb_build_object(
      'schema','metaengine.client-v1.installed-qualification-approval.v1',
      'accepted',false,
      'reason','QUALIFICATION_REQUEST_AMBIGUOUS',
      'matching_requests',v_count,
      'nonce_bound',true,
      'authority_effect',false
    );
  end if;

  select *
    into v_request
    from public.compute_fabric_a2_browser_device_enrollment_request_h205f22 r
   where r.status in ('PENDING','APPROVED')
     and r.expires_at > v_now
     and r.requested_at >= v_now - interval '15 minutes'
     and r.metadata->>'qualification_kind' = 'INSTALLED_ELECTRON'
     and r.metadata->>'client_kind' = 'METAENGINE_BROWSER_ELECTRON_NATIVE'
     and r.metadata->>'qualification_run_id' = p_run_id
     and coalesce(r.metadata->>'qualification_run_attempt','') = p_run_attempt::text
     and lower(coalesce(r.metadata->>'source_head','')) = lower(p_source_head)
     and lower(coalesce(r.metadata->>'qualification_nonce_sha256','')) =
         lower(p_qualification_nonce_sha256)
   order by r.requested_at desc
   limit 1
   for update;

  v_approval := public.h205f22_a2_browser_device_enrollment_approve_v1(v_request.request_id);

  if coalesce((v_approval->>'accepted')::boolean,false) is not true then
    return jsonb_build_object(
      'schema','metaengine.client-v1.installed-qualification-approval.v1',
      'accepted',false,
      'reason','ENROLLMENT_APPROVAL_REJECTED',
      'request_id',v_request.request_id,
      'approval',v_approval,
      'nonce_bound',true,
      'authority_effect',false
    );
  end if;

  return jsonb_build_object(
    'schema','metaengine.client-v1.installed-qualification-approval.v1',
    'accepted',true,
    'reason','EXACT_GITHUB_OIDC_AND_NONCE_CORRELATED_REQUEST_APPROVED',
    'request_id',v_request.request_id,
    'client_id',v_request.client_id,
    'run_id',p_run_id,
    'run_attempt',p_run_attempt,
    'source_head',lower(p_source_head),
    'qualification_kind','INSTALLED_ELECTRON',
    'nonce_bound',true,
    'approval',v_approval,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.client_v1_installed_qualification_approve_v1(text,integer,text,text)
  from public, anon, authenticated;
grant execute on function public.client_v1_installed_qualification_approve_v1(text,integer,text,text)
  to service_role;

revoke all on function public.client_v1_installed_qualification_approve_v1(text,integer,text)
  from public, anon, authenticated, service_role;
drop function if exists public.client_v1_installed_qualification_approve_v1(text,integer,text);

comment on function public.client_v1_installed_qualification_approve_v1(text,integer,text,text) is
  'Backend-only GitHub-OIDC installed Electron qualification approval additionally bound to a one-run random correlation hash.';
