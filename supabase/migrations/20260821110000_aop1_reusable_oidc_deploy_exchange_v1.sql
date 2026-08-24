create table if not exists destruktion_meta.compute_fabric_aop_deploy_exchange_receipt_h205f22(
  receipt_id bigint generated always as identity primary key,
  oidc_jti_sha256 text not null unique check (oidc_jti_sha256 ~ '^[0-9a-f]{64}$'),
  repository_id text not null check (repository_id ~ '^[0-9]+$'),
  github_sha text not null check (github_sha ~ '^[0-9a-f]{40}$'),
  github_run_id text not null check (github_run_id ~ '^[0-9]+$'),
  github_run_attempt integer not null check (github_run_attempt between 1 and 1000),
  actor_id text not null check (actor_id ~ '^[0-9]+$'),
  workflow_ref text not null,
  ref text not null,
  issued_at timestamptz not null default clock_timestamp(),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false)
);
alter table destruktion_meta.compute_fabric_aop_deploy_exchange_receipt_h205f22 enable row level security;
revoke all on destruktion_meta.compute_fabric_aop_deploy_exchange_receipt_h205f22 from public,anon,authenticated;
grant select,insert on destruktion_meta.compute_fabric_aop_deploy_exchange_receipt_h205f22 to service_role;

create or replace function destruktion_meta.compute_fabric_aop_deploy_exchange_append_only_h205f22()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $$
begin
  raise exception 'aop_deploy_exchange_receipt_is_append_only' using errcode='55000';
end $$;

drop trigger if exists compute_fabric_aop_deploy_exchange_append_only_trg on destruktion_meta.compute_fabric_aop_deploy_exchange_receipt_h205f22;
create trigger compute_fabric_aop_deploy_exchange_append_only_trg
before update or delete on destruktion_meta.compute_fabric_aop_deploy_exchange_receipt_h205f22
for each row execute function destruktion_meta.compute_fabric_aop_deploy_exchange_append_only_h205f22();

create or replace function public.h205f22_aop1_issue_deploy_bundle_v1(
  p_oidc_jti text,
  p_repository_id text,
  p_github_sha text,
  p_github_run_id text,
  p_github_run_attempt integer,
  p_actor_id text,
  p_workflow_ref text,
  p_ref text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta','vault','extensions'
as $$
declare
  v_jti_sha text;
  v_account text;
  v_token text;
begin
  if p_oidc_jti is null or char_length(p_oidc_jti)<8 or char_length(p_oidc_jti)>512 then raise exception 'invalid_oidc_jti' using errcode='22023'; end if;
  if p_repository_id <> '1341371143' then raise exception 'repository_id_forbidden' using errcode='42501'; end if;
  if p_github_sha is null or p_github_sha !~ '^[0-9a-f]{40}$' then raise exception 'invalid_github_sha' using errcode='22023'; end if;
  if p_github_run_id is null or p_github_run_id !~ '^[0-9]+$' then raise exception 'invalid_github_run_id' using errcode='22023'; end if;
  if p_github_run_attempt is null or p_github_run_attempt<1 or p_github_run_attempt>1000 then raise exception 'invalid_github_run_attempt' using errcode='22023'; end if;
  if p_actor_id is null or p_actor_id !~ '^[0-9]+$' then raise exception 'invalid_actor_id' using errcode='22023'; end if;
  if p_workflow_ref <> 'PatrickFrome/Compute/.github/workflows/aop1-live-deploy.yml@refs/heads/work/aop1-autonomous-orchestration' then raise exception 'workflow_ref_forbidden' using errcode='42501'; end if;
  if p_ref <> 'refs/heads/work/aop1-autonomous-orchestration' then raise exception 'ref_forbidden' using errcode='42501'; end if;
  v_jti_sha:=encode(extensions.digest(convert_to(p_oidc_jti,'UTF8'),'sha256'),'hex');
  insert into destruktion_meta.compute_fabric_aop_deploy_exchange_receipt_h205f22(oidc_jti_sha256,repository_id,github_sha,github_run_id,github_run_attempt,actor_id,workflow_ref,ref)
  values(v_jti_sha,p_repository_id,p_github_sha,p_github_run_id,p_github_run_attempt,p_actor_id,p_workflow_ref,p_ref);
  select decrypted_secret into v_account from vault.decrypted_secrets where name='aop1_cloudflare_account_id';
  select decrypted_secret into v_token from vault.decrypted_secrets where name='aop1_cloudflare_api_token';
  if v_account is null or v_account !~ '^[0-9a-f]{32}$' then raise exception 'cloudflare_account_id_unavailable' using errcode='55000'; end if;
  if v_token is null or char_length(v_token)<20 then raise exception 'cloudflare_deploy_token_unavailable' using errcode='55000'; end if;
  return jsonb_build_object(
    'schema','metaengine.compute.aop1-deploy-bundle.h205f22.v1',
    'oidc_exchange_one_time',true,
    'github_sha',p_github_sha,
    'github_run_id',p_github_run_id,
    'bundle',jsonb_build_object('cloudflare_account_id',v_account,'cloudflare_api_token',v_token),
    'canonical',false,
    'authority_effect',false
  );
exception when unique_violation then
  raise exception 'oidc_exchange_replay_denied' using errcode='55000';
end $$;

revoke all on function public.h205f22_aop1_issue_deploy_bundle_v1(text,text,text,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.h205f22_aop1_issue_deploy_bundle_v1(text,text,text,text,integer,text,text,text) to service_role;