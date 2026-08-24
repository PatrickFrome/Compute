create or replace function public.h205f22_a2_acceptance_consume_oidc_jti_v1(
  p_oidc_jti text,
  p_repository_id text,
  p_github_sha text,
  p_github_run_id text,
  p_github_run_attempt integer,
  p_actor_id text,
  p_workflow_ref text,
  p_ref text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta,extensions
as $$
declare
  r destruktion_meta.compute_fabric_a2_acceptance_oidc_exchange_h205f22%rowtype;
begin
  if p_oidc_jti is null or length(p_oidc_jti)<8 or length(p_oidc_jti)>512 then raise exception 'a2_acceptance_oidc_jti_invalid'; end if;
  if p_repository_id is null or p_repository_id !~ '^[0-9]+$' then raise exception 'a2_acceptance_repository_id_invalid'; end if;
  if p_github_sha is null or p_github_sha !~ '^[0-9a-f]{40}$' then raise exception 'a2_acceptance_github_sha_invalid'; end if;
  if p_github_run_id is null or p_github_run_id !~ '^[0-9]+$' then raise exception 'a2_acceptance_run_id_invalid'; end if;
  if p_github_run_attempt is null or p_github_run_attempt<1 then raise exception 'a2_acceptance_run_attempt_invalid'; end if;
  if p_actor_id is null or p_actor_id !~ '^[0-9]+$' then raise exception 'a2_acceptance_actor_id_invalid'; end if;
  if p_workflow_ref is null or length(p_workflow_ref)>1024 then raise exception 'a2_acceptance_workflow_ref_invalid'; end if;
  if p_ref is null or length(p_ref)>512 then raise exception 'a2_acceptance_ref_invalid'; end if;
  perform set_config('metaengine.a2_rpc','on',true);
  begin
    insert into destruktion_meta.compute_fabric_a2_acceptance_oidc_exchange_h205f22(
      oidc_jti,repository_id,github_sha,github_run_id,github_run_attempt,actor_id,workflow_ref,ref
    ) values (
      p_oidc_jti,p_repository_id,p_github_sha,p_github_run_id,p_github_run_attempt,p_actor_id,p_workflow_ref,p_ref
    ) returning * into r;
  exception when unique_violation then
    raise exception 'a2_acceptance_oidc_replay_denied';
  end;
  return jsonb_build_object(
    'schema','metaengine.compute.a2-acceptance-oidc-exchange.h205f22.v1',
    'oidc_jti_sha256',encode(extensions.digest(convert_to(r.oidc_jti,'UTF8'),'sha256'),'hex'),
    'github_sha',r.github_sha,
    'github_run_id',r.github_run_id,
    'github_run_attempt',r.github_run_attempt,
    'consumed_at',r.consumed_at,
    'canonical',false,
    'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_a2_acceptance_consume_oidc_jti_v1(text,text,text,text,integer,text,text,text) from public,anon,authenticated,a2_peer_runtime;
grant execute on function public.h205f22_a2_acceptance_consume_oidc_jti_v1(text,text,text,text,integer,text,text,text) to service_role;
