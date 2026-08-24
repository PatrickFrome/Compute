-- AOP1 reusable narrow GitHub OIDC -> Cloudflare deploy exchange.
-- This is delivery-plane capability only. It exposes no roadmap/supervisor authority.

begin;

create table if not exists destruktion_meta.compute_fabric_aop_deploy_exchange_h205f22 (
  exchange_id uuid primary key default gen_random_uuid(),
  repository text not null check (repository='PatrickFrome/Compute'),
  repository_id text not null check (repository_id='1341371143'),
  ref text not null check (ref='refs/heads/work/aop1-autonomous-orchestration'),
  workflow_ref text not null check (workflow_ref='PatrickFrome/Compute/.github/workflows/aop1-live-deploy.yml@refs/heads/work/aop1-autonomous-orchestration'),
  sha text not null check (sha ~ '^[0-9a-f]{40}$'),
  event_name text not null check (event_name in ('push','workflow_dispatch')),
  run_id text not null check (run_id ~ '^[0-9]{1,30}$'),
  run_attempt integer not null check (run_attempt between 1 and 100),
  actor_id text check (actor_id is null or actor_id ~ '^[0-9]{1,30}$'),
  subject text not null check (subject='repo:PatrickFrome/Compute:ref:refs/heads/work/aop1-autonomous-orchestration'),
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  unique(repository_id, workflow_ref, run_id, run_attempt)
);

create index if not exists compute_fabric_aop_deploy_exchange_h205f22_issued_idx
  on destruktion_meta.compute_fabric_aop_deploy_exchange_h205f22(issued_at desc);

alter table destruktion_meta.compute_fabric_aop_deploy_exchange_h205f22 enable row level security;
revoke all on table destruktion_meta.compute_fabric_aop_deploy_exchange_h205f22 from public, anon, authenticated;
grant select,insert on table destruktion_meta.compute_fabric_aop_deploy_exchange_h205f22 to service_role;

create or replace function destruktion_meta.compute_fabric_aop_deploy_exchange_immutable_h205f22()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, destruktion_meta
as $$
begin
  raise exception 'aop_deploy_exchange_is_append_only' using errcode='55000';
end $$;
revoke all on function destruktion_meta.compute_fabric_aop_deploy_exchange_immutable_h205f22() from public, anon, authenticated;

drop trigger if exists compute_fabric_aop_deploy_exchange_immutable_h205f22
  on destruktion_meta.compute_fabric_aop_deploy_exchange_h205f22;
create trigger compute_fabric_aop_deploy_exchange_immutable_h205f22
before update or delete on destruktion_meta.compute_fabric_aop_deploy_exchange_h205f22
for each row execute function destruktion_meta.compute_fabric_aop_deploy_exchange_immutable_h205f22();

create or replace function public.h205f22_aop1_issue_narrow_deploy_bundle_v1(
  p_repository text,
  p_repository_id text,
  p_ref text,
  p_workflow_ref text,
  p_sha text,
  p_event_name text,
  p_run_id text,
  p_run_attempt integer,
  p_actor_id text,
  p_subject text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, vault, destruktion_meta
as $$
declare
  v_exchange_id uuid;
  v_token text;
  v_account_id text;
  v_expires_at timestamptz := clock_timestamp() + interval '2 minutes';
begin
  if p_repository is distinct from 'PatrickFrome/Compute' then raise exception 'deploy_repository_forbidden' using errcode='28000'; end if;
  if p_repository_id is distinct from '1341371143' then raise exception 'deploy_repository_id_forbidden' using errcode='28000'; end if;
  if p_ref is distinct from 'refs/heads/work/aop1-autonomous-orchestration' then raise exception 'deploy_ref_forbidden' using errcode='28000'; end if;
  if p_workflow_ref is distinct from 'PatrickFrome/Compute/.github/workflows/aop1-live-deploy.yml@refs/heads/work/aop1-autonomous-orchestration' then raise exception 'deploy_workflow_ref_forbidden' using errcode='28000'; end if;
  if p_subject is distinct from 'repo:PatrickFrome/Compute:ref:refs/heads/work/aop1-autonomous-orchestration' then raise exception 'deploy_subject_forbidden' using errcode='28000'; end if;
  if p_sha is null or p_sha !~ '^[0-9a-f]{40}$' then raise exception 'deploy_sha_invalid' using errcode='22023'; end if;
  if p_event_name not in ('push','workflow_dispatch') then raise exception 'deploy_event_forbidden' using errcode='28000'; end if;
  if p_run_id is null or p_run_id !~ '^[0-9]{1,30}$' then raise exception 'deploy_run_id_invalid' using errcode='22023'; end if;
  if p_run_attempt is null or p_run_attempt < 1 or p_run_attempt > 100 then raise exception 'deploy_run_attempt_invalid' using errcode='22023'; end if;
  if p_actor_id is not null and p_actor_id !~ '^[0-9]{1,30}$' then raise exception 'deploy_actor_id_invalid' using errcode='22023'; end if;

  begin
    insert into destruktion_meta.compute_fabric_aop_deploy_exchange_h205f22(
      repository,repository_id,ref,workflow_ref,sha,event_name,run_id,run_attempt,actor_id,subject,expires_at,canonical,authority_effect
    ) values (
      p_repository,p_repository_id,p_ref,p_workflow_ref,p_sha,p_event_name,p_run_id,p_run_attempt,p_actor_id,p_subject,v_expires_at,false,false
    ) returning exchange_id into v_exchange_id;
  exception when unique_violation then
    raise exception 'deploy_exchange_replay_forbidden' using errcode='55000';
  end;

  select max(decrypted_secret) filter (where name='aop1_cloudflare_api_token'),
         max(decrypted_secret) filter (where name='aop1_cloudflare_account_id')
    into v_token,v_account_id
  from vault.decrypted_secrets
  where name in ('aop1_cloudflare_api_token','aop1_cloudflare_account_id');

  if v_token is null or v_account_id is null then
    raise exception 'narrow_deploy_bundle_incomplete' using errcode='55000';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute.aop1-narrow-deploy-bundle.h205f22.v1',
    'exchange_id',v_exchange_id,
    'expires_at',v_expires_at,
    'cloudflare_api_token',v_token,
    'cloudflare_account_id',v_account_id,
    'authority_effect',false,
    'contains_runtime_secrets',false,
    'contains_supervisor_capability',false,
    'contains_supabase_service_role',false
  );
end $$;

revoke all on function public.h205f22_aop1_issue_narrow_deploy_bundle_v1(text,text,text,text,text,text,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.h205f22_aop1_issue_narrow_deploy_bundle_v1(text,text,text,text,text,text,text,integer,text,text) to service_role;

commit;
