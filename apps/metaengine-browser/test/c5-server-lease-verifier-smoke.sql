create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create table public.compute_fabric_a2_supervisor_actuation_lease_h205f22 (
  lease_id uuid primary key,
  workspace_id uuid,
  target_client_id text not null,
  holder_supervisor_instance_id text not null,
  effect_scope text not null,
  effect_key text not null,
  status text not null,
  command_id uuid,
  acquired_at timestamptz not null,
  expires_at timestamptz,
  released_at timestamptz,
  release_reason text,
  authority_effect boolean not null default true
);

\i supabase/migrations/20260831165000_c5_server_lease_verifier_v1.sql

insert into public.compute_fabric_a2_supervisor_actuation_lease_h205f22
(lease_id,target_client_id,holder_supervisor_instance_id,effect_scope,effect_key,status,acquired_at,expires_at,authority_effect)
values
('00000000-0000-4000-8000-000000000001','client_exact','METAENGINE_SUPERVISOR','BROWSER_CLIENT_ACTUATION','fleet.transport-promotion:agent_exact','ACTIVE',clock_timestamp(),clock_timestamp()+interval '10 minutes',true),
('00000000-0000-4000-8000-000000000002','client_exact','METAENGINE_SUPERVISOR','BROWSER_CLIENT_ACTUATION','fleet.transport-promotion:agent_exact','ACTIVE',clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '10 minutes',true),
('00000000-0000-4000-8000-000000000003','client_exact','METAENGINE_SUPERVISOR','BROWSER_CLIENT_ACTUATION','fleet.transport-promotion:agent_exact','ACTIVE',clock_timestamp(),clock_timestamp()+interval '10 minutes',true);
update public.compute_fabric_a2_supervisor_actuation_lease_h205f22 set released_at=clock_timestamp() where lease_id='00000000-0000-4000-8000-000000000003';

DO $$
declare j jsonb;
begin
  j := public.h205f22_verify_browser_transport_promotion_lease_v1('00000000-0000-4000-8000-000000000001','agent_exact','METAENGINE_SUPERVISOR','client_exact');
  if (j->>'valid')::boolean is distinct from true or (j->>'not_expired')::boolean is distinct from true then raise exception 'valid lease rejected: %', j; end if;
  if j->>'authority_effect' <> 'false' then raise exception 'verifier granted authority'; end if;

  j := public.h205f22_verify_browser_transport_promotion_lease_v1('00000000-0000-4000-8000-000000000002','agent_exact','METAENGINE_SUPERVISOR','client_exact');
  if (j->>'valid')::boolean is distinct from false or j->>'reason' <> 'LEASE_EXPIRED' then raise exception 'expired lease accepted: %', j; end if;

  j := public.h205f22_verify_browser_transport_promotion_lease_v1('00000000-0000-4000-8000-000000000003','agent_exact','METAENGINE_SUPERVISOR','client_exact');
  if (j->>'valid')::boolean is distinct from false or j->>'reason' <> 'LEASE_RELEASED' then raise exception 'released lease accepted: %', j; end if;

  j := public.h205f22_verify_browser_transport_promotion_lease_v1('00000000-0000-4000-8000-000000000001','agent_other','METAENGINE_SUPERVISOR','client_exact');
  if (j->>'valid')::boolean is distinct from false or j->>'reason' <> 'EFFECT_KEY_MISMATCH' then raise exception 'agent mismatch accepted: %', j; end if;

  j := public.h205f22_verify_browser_transport_promotion_lease_v1('00000000-0000-4000-8000-000000000001','agent_exact','OTHER_SUPERVISOR','client_exact');
  if (j->>'valid')::boolean is distinct from false or j->>'reason' <> 'HOLDER_MISMATCH' then raise exception 'holder mismatch accepted: %', j; end if;

  j := public.h205f22_verify_browser_transport_promotion_lease_v1('00000000-0000-4000-8000-000000000001','agent_exact','METAENGINE_SUPERVISOR','client_other');
  if (j->>'valid')::boolean is distinct from false or j->>'reason' <> 'TARGET_MISMATCH' then raise exception 'target mismatch accepted: %', j; end if;

  if has_function_privilege('anon','public.h205f22_verify_browser_transport_promotion_lease_v1(uuid,text,text,text)','EXECUTE') then raise exception 'anon execute unexpectedly granted'; end if;
  if has_function_privilege('authenticated','public.h205f22_verify_browser_transport_promotion_lease_v1(uuid,text,text,text)','EXECUTE') then raise exception 'authenticated execute unexpectedly granted'; end if;
  if not has_function_privilege('service_role','public.h205f22_verify_browser_transport_promotion_lease_v1(uuid,text,text,text)','EXECUTE') then raise exception 'service_role execute missing'; end if;
end $$;
