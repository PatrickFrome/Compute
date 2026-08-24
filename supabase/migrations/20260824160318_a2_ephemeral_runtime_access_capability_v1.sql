create table if not exists destruktion_meta.compute_fabric_a2_runtime_access_token_h205f22 (
  token_sha256 text primary key check (token_sha256 ~ '^[0-9a-f]{64}$'),
  subject text not null,
  github_sha text check (github_sha is null or github_sha ~ '^[0-9a-f]{40}$'),
  scopes text[] not null check (cardinality(scopes)>0),
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  check (expires_at>issued_at)
);

alter table destruktion_meta.compute_fabric_a2_runtime_access_token_h205f22 enable row level security;
revoke all on destruktion_meta.compute_fabric_a2_runtime_access_token_h205f22 from public,anon,authenticated,service_role,a2_peer_runtime;

drop trigger if exists trg_a2_guard_runtime_access_token on destruktion_meta.compute_fabric_a2_runtime_access_token_h205f22;
create trigger trg_a2_guard_runtime_access_token
before insert or update or delete on destruktion_meta.compute_fabric_a2_runtime_access_token_h205f22
for each row execute function destruktion_meta.compute_fabric_a2_guard_write_h205f22();

create or replace function public.h205f22_a2_issue_runtime_access_token_v1(
  p_token_sha256 text,
  p_subject text,
  p_github_sha text,
  p_scopes text[],
  p_ttl_seconds integer default 1800
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta
as $$
declare r destruktion_meta.compute_fabric_a2_runtime_access_token_h205f22%rowtype; ttl integer:=least(greatest(coalesce(p_ttl_seconds,1800),60),3600);
begin
  if p_token_sha256 is null or p_token_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'a2_runtime_token_sha_invalid'; end if;
  if p_subject is null or length(btrim(p_subject))<3 or length(p_subject)>512 then raise exception 'a2_runtime_token_subject_invalid'; end if;
  if p_github_sha is not null and p_github_sha !~ '^[0-9a-f]{40}$' then raise exception 'a2_runtime_token_github_sha_invalid'; end if;
  if p_scopes is null or cardinality(p_scopes)=0 or not (p_scopes <@ array['rpc','emit','stream']::text[]) then raise exception 'a2_runtime_token_scopes_invalid'; end if;
  perform set_config('metaengine.a2_rpc','on',true);
  insert into destruktion_meta.compute_fabric_a2_runtime_access_token_h205f22(token_sha256,subject,github_sha,scopes,expires_at)
  values(lower(p_token_sha256),p_subject,p_github_sha,p_scopes,clock_timestamp()+make_interval(secs=>ttl))
  returning * into r;
  return jsonb_build_object('schema','metaengine.compute.a2-runtime-access-token.v1','token_sha256',r.token_sha256,
    'subject',r.subject,'github_sha',r.github_sha,'scopes',to_jsonb(r.scopes),'issued_at',r.issued_at,'expires_at',r.expires_at,
    'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_a2_validate_runtime_access_token_v1(
  p_token_sha256 text,
  p_required_scope text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta
as $$
declare r destruktion_meta.compute_fabric_a2_runtime_access_token_h205f22%rowtype; accepted boolean:=false;
begin
  if p_token_sha256 is null or p_token_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('schema','metaengine.compute.a2-runtime-access-validation.v1','accepted',false,'reason','TOKEN_INVALID','canonical',false,'authority_effect',false);
  end if;
  if p_required_scope not in ('rpc','emit','stream') then
    return jsonb_build_object('schema','metaengine.compute.a2-runtime-access-validation.v1','accepted',false,'reason','SCOPE_INVALID','canonical',false,'authority_effect',false);
  end if;
  select * into r from destruktion_meta.compute_fabric_a2_runtime_access_token_h205f22
  where token_sha256=lower(p_token_sha256) and revoked_at is null and expires_at>clock_timestamp();
  if found and p_required_scope=any(r.scopes) then accepted:=true; end if;
  return jsonb_build_object('schema','metaengine.compute.a2-runtime-access-validation.v1','accepted',accepted,
    'reason',case when accepted then 'OK' when not found then 'TOKEN_EXPIRED_REVOKED_OR_UNKNOWN' else 'SCOPE_DENIED' end,
    'subject',case when found then r.subject else null end,'github_sha',case when found then r.github_sha else null end,
    'expires_at',case when found then r.expires_at else null end,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_a2_revoke_runtime_access_token_v1(p_token_sha256 text)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta
as $$
declare n integer;
begin
  perform set_config('metaengine.a2_rpc','on',true);
  update destruktion_meta.compute_fabric_a2_runtime_access_token_h205f22 set revoked_at=clock_timestamp()
  where token_sha256=lower(p_token_sha256) and revoked_at is null;
  get diagnostics n=row_count;
  return jsonb_build_object('schema','metaengine.compute.a2-runtime-access-revoke.v1','revoked',n=1,'canonical',false,'authority_effect',false);
end $$;

revoke all on function public.h205f22_a2_issue_runtime_access_token_v1(text,text,text,text[],integer) from public,anon,authenticated,a2_peer_runtime;
revoke all on function public.h205f22_a2_validate_runtime_access_token_v1(text,text) from public,anon,authenticated,a2_peer_runtime;
revoke all on function public.h205f22_a2_revoke_runtime_access_token_v1(text) from public,anon,authenticated,a2_peer_runtime;
grant execute on function public.h205f22_a2_issue_runtime_access_token_v1(text,text,text,text[],integer) to service_role;
grant execute on function public.h205f22_a2_validate_runtime_access_token_v1(text,text) to service_role;
grant execute on function public.h205f22_a2_revoke_runtime_access_token_v1(text) to service_role;

create index if not exists compute_fabric_a2_runtime_access_token_expiry_idx
  on destruktion_meta.compute_fabric_a2_runtime_access_token_h205f22(expires_at) where revoked_at is null;

comment on table destruktion_meta.compute_fabric_a2_runtime_access_token_h205f22 is
  'Hashed short-lived scoped capabilities for A2 Edge ingress; raw tokens are never persisted.';
