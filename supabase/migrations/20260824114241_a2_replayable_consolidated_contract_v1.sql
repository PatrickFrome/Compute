-- A2_REALTIME_MULTI_AGENT_COGNITIVE_BUS final replayable contract.
-- Historical live migrations 20260824112049..20260824113730 are represented in-repo
-- by history markers; this migration is the clean-replay source of truth.

create sequence if not exists destruktion_meta.compute_fabric_a2_commit_seq_h205f22 as bigint;

create table if not exists destruktion_meta.compute_fabric_a2_workspace_h205f22 (
  workspace_id uuid primary key default extensions.gen_random_uuid(),
  workspace_key text not null unique,
  semantic_point text not null,
  mode text not null default 'COLLABORATE' check (mode in ('COLLABORATE','DUEL','PAUSED','CLOSED')),
  base_github_sha text not null check (base_github_sha ~ '^[0-9a-f]{40}$'),
  semantic_checkpoint_id text not null,
  semantic_payload_root_sha256 text not null check (semantic_payload_root_sha256 ~ '^[0-9a-f]{64}$'),
  roadmap_definition_sha256 text not null check (roadmap_definition_sha256 ~ '^[0-9a-f]{64}$'),
  created_by text not null,
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists destruktion_meta.compute_fabric_a2_peer_session_h205f22 (
  session_id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references destruktion_meta.compute_fabric_a2_workspace_h205f22(workspace_id) on delete cascade,
  agent text not null check (agent in ('GPT','GLM')),
  runtime_id text not null,
  provider text not null,
  requested_model text not null,
  reported_model text,
  capabilities jsonb not null default '{}'::jsonb,
  capability_epoch bigint not null default 1 check (capability_epoch>0),
  public_key_alg text not null default 'Ed25519' check (public_key_alg='Ed25519'),
  public_key_base64 text not null,
  key_fingerprint_sha256 text not null check (key_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED','CLOSED')),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  started_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  unique(workspace_id,agent,capability_epoch)
);

create table if not exists destruktion_meta.compute_fabric_a2_visibility_proof_h205f22 (
  proof_id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references destruktion_meta.compute_fabric_a2_workspace_h205f22(workspace_id) on delete cascade,
  session_id uuid not null references destruktion_meta.compute_fabric_a2_peer_session_h205f22(session_id) on delete cascade,
  agent text not null check (agent in ('GPT','GLM')),
  seen_commit_seq bigint not null default 0 check (seen_commit_seq>=0),
  seen_gpt_seq bigint not null default 0 check (seen_gpt_seq>=0),
  seen_glm_seq bigint not null default 0 check (seen_glm_seq>=0),
  input_frontier_hash text not null check (input_frontier_hash ~ '^[0-9a-f]{64}$'),
  context_manifest jsonb not null,
  context_manifest_sha256 text not null check (context_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  mandatory_peer_event_hashes text[] not null default '{}',
  accepted_event_id uuid,
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists destruktion_meta.compute_fabric_a2_agent_event_h205f22 (
  event_id uuid primary key,
  commit_seq bigint not null unique default nextval('destruktion_meta.compute_fabric_a2_commit_seq_h205f22'),
  workspace_id uuid not null references destruktion_meta.compute_fabric_a2_workspace_h205f22(workspace_id) on delete cascade,
  session_id uuid not null references destruktion_meta.compute_fabric_a2_peer_session_h205f22(session_id) on delete cascade,
  agent text not null check (agent in ('GPT','GLM')),
  agent_seq bigint not null check (agent_seq>0),
  semantic_point text not null,
  event_type text not null,
  priority smallint not null check (priority between 0 and 3),
  parent_hashes text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  event_hash text not null unique check (event_hash ~ '^[0-9a-f]{64}$'),
  signature_base64 text not null,
  signature_key_fingerprint_sha256 text not null check (signature_key_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  signature_verification_mode text not null check (signature_verification_mode='TRUSTED_INGRESS_ED25519_V1'),
  visibility_proof_id uuid references destruktion_meta.compute_fabric_a2_visibility_proof_h205f22(proof_id),
  model_provenance jsonb not null default '{}'::jsonb,
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,agent,agent_seq)
);

do $$ begin
  if not exists(select 1 from pg_constraint where conname='compute_fabric_a2_visibility_proof_h205f22_accepted_event_id_fkey') then
    alter table destruktion_meta.compute_fabric_a2_visibility_proof_h205f22
      add constraint compute_fabric_a2_visibility_proof_h205f22_accepted_event_id_fkey
      foreign key(accepted_event_id) references destruktion_meta.compute_fabric_a2_agent_event_h205f22(event_id);
  end if;
end $$;

create table if not exists destruktion_meta.compute_fabric_a2_peer_cursor_h205f22 (
  workspace_id uuid not null references destruktion_meta.compute_fabric_a2_workspace_h205f22(workspace_id) on delete cascade,
  session_id uuid not null references destruktion_meta.compute_fabric_a2_peer_session_h205f22(session_id) on delete cascade,
  agent text not null check (agent in ('GPT','GLM')),
  last_received_commit_seq bigint not null default 0 check(last_received_commit_seq>=0),
  last_applied_commit_seq bigint not null default 0 check(last_applied_commit_seq>=0),
  causal_frontier_hash text not null,
  updated_at timestamptz not null default clock_timestamp(),
  canonical boolean not null default false check(canonical=false),
  authority_effect boolean not null default false check(authority_effect=false),
  primary key(workspace_id,session_id)
);

create table if not exists destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22 (
  conflict_id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references destruktion_meta.compute_fabric_a2_workspace_h205f22(workspace_id) on delete cascade,
  semantic_point text not null,
  left_event_hash text not null,
  right_event_hash text not null,
  reason text not null,
  impact text not null check(impact in ('LOW','MEDIUM','HIGH','CRITICAL')),
  status text not null default 'OPEN' check(status in ('OPEN','DIRECT_RESOLUTION','DUEL','RESOLVED','CLOSED')),
  duel_id uuid,
  resolution_event_hash text,
  canonical boolean not null default false check(canonical=false),
  authority_effect boolean not null default false check(authority_effect=false),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,left_event_hash,right_event_hash)
);

create index if not exists compute_fabric_a2_event_workspace_commit_idx on destruktion_meta.compute_fabric_a2_agent_event_h205f22(workspace_id,commit_seq);
create index if not exists compute_fabric_a2_event_workspace_agent_seq_idx on destruktion_meta.compute_fabric_a2_agent_event_h205f22(workspace_id,agent,agent_seq);
create index if not exists compute_fabric_a2_event_semantic_idx on destruktion_meta.compute_fabric_a2_agent_event_h205f22(workspace_id,semantic_point,commit_seq);
create index if not exists compute_fabric_a2_conflict_open_idx on destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22(workspace_id,status,created_at);
create unique index if not exists compute_fabric_a2_one_active_peer_per_agent_idx on destruktion_meta.compute_fabric_a2_peer_session_h205f22(workspace_id,agent) where status='ACTIVE';

create or replace function destruktion_meta.compute_fabric_a2_sha256_jsonb_h205f22(p_value jsonb)
returns text language sql immutable set search_path=pg_catalog,extensions as $$
 select encode(extensions.digest(convert_to(coalesce(p_value,'null'::jsonb)::text,'UTF8'),'sha256'),'hex')
$$;

create or replace function destruktion_meta.compute_fabric_a2_event_hash_h205f22(p_event_id uuid,p_workspace_id uuid,p_session_id uuid,p_agent text,p_agent_seq bigint,p_semantic_point text,p_event_type text,p_priority smallint,p_parent_hashes text[],p_payload_sha256 text,p_visibility_proof_id uuid,p_model_provenance jsonb)
returns text language sql immutable set search_path=pg_catalog,extensions as $$
 select encode(extensions.digest(convert_to(jsonb_build_object('event_id',p_event_id::text,'workspace_id',p_workspace_id::text,'session_id',p_session_id::text,'agent',p_agent,'agent_seq',p_agent_seq,'semantic_point',p_semantic_point,'event_type',p_event_type,'priority',p_priority,'parent_hashes',to_jsonb(coalesce(p_parent_hashes,'{}'::text[])),'payload_sha256',p_payload_sha256,'visibility_proof_id',case when p_visibility_proof_id is null then null else to_jsonb(p_visibility_proof_id::text) end,'model_provenance',coalesce(p_model_provenance,'{}'::jsonb))::text,'UTF8'),'sha256'),'hex')
$$;

create or replace function destruktion_meta.compute_fabric_a2_guard_write_h205f22() returns trigger language plpgsql set search_path=pg_catalog as $$
begin if coalesce(current_setting('metaengine.a2_rpc',true),'')<>'on' then raise exception 'a2_direct_write_denied'; end if; return new; end $$;

create or replace function destruktion_meta.compute_fabric_a2_notify_event_h205f22() returns trigger language plpgsql set search_path=pg_catalog as $$
begin perform pg_notify('h205f22_a2_event',jsonb_build_object('workspace_id',new.workspace_id,'event_id',new.event_id,'commit_seq',new.commit_seq,'agent',new.agent,'event_type',new.event_type,'priority',new.priority,'event_hash',new.event_hash)::text); return new; end $$;

drop trigger if exists trg_a2_guard_workspace on destruktion_meta.compute_fabric_a2_workspace_h205f22;
create trigger trg_a2_guard_workspace before insert or update or delete on destruktion_meta.compute_fabric_a2_workspace_h205f22 for each row execute function destruktion_meta.compute_fabric_a2_guard_write_h205f22();
drop trigger if exists trg_a2_guard_session on destruktion_meta.compute_fabric_a2_peer_session_h205f22;
create trigger trg_a2_guard_session before insert or update or delete on destruktion_meta.compute_fabric_a2_peer_session_h205f22 for each row execute function destruktion_meta.compute_fabric_a2_guard_write_h205f22();
drop trigger if exists trg_a2_guard_proof on destruktion_meta.compute_fabric_a2_visibility_proof_h205f22;
create trigger trg_a2_guard_proof before insert or update or delete on destruktion_meta.compute_fabric_a2_visibility_proof_h205f22 for each row execute function destruktion_meta.compute_fabric_a2_guard_write_h205f22();
drop trigger if exists trg_a2_guard_event on destruktion_meta.compute_fabric_a2_agent_event_h205f22;
create trigger trg_a2_guard_event before insert or update or delete on destruktion_meta.compute_fabric_a2_agent_event_h205f22 for each row execute function destruktion_meta.compute_fabric_a2_guard_write_h205f22();
drop trigger if exists trg_a2_guard_cursor on destruktion_meta.compute_fabric_a2_peer_cursor_h205f22;
create trigger trg_a2_guard_cursor before insert or update or delete on destruktion_meta.compute_fabric_a2_peer_cursor_h205f22 for each row execute function destruktion_meta.compute_fabric_a2_guard_write_h205f22();
drop trigger if exists trg_a2_guard_conflict on destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22;
create trigger trg_a2_guard_conflict before insert or update or delete on destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22 for each row execute function destruktion_meta.compute_fabric_a2_guard_write_h205f22();
drop trigger if exists trg_a2_notify_event on destruktion_meta.compute_fabric_a2_agent_event_h205f22;
create trigger trg_a2_notify_event after insert on destruktion_meta.compute_fabric_a2_agent_event_h205f22 for each row execute function destruktion_meta.compute_fabric_a2_notify_event_h205f22();

create or replace function public.h205f22_a2_open_workspace_v1(p_workspace_key text,p_semantic_point text,p_base_github_sha text,p_semantic_checkpoint_id text,p_semantic_payload_root_sha256 text,p_roadmap_definition_sha256 text,p_created_by text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta,extensions as $$
declare r destruktion_meta.compute_fabric_a2_workspace_h205f22%rowtype;
begin
 if p_workspace_key is null or length(btrim(p_workspace_key))<3 or length(p_workspace_key)>200 then raise exception 'a2_workspace_key_invalid'; end if;
 if p_semantic_point is null or length(btrim(p_semantic_point))<3 or length(p_semantic_point)>240 then raise exception 'a2_semantic_point_invalid'; end if;
 if p_base_github_sha !~ '^[0-9a-f]{40}$' then raise exception 'a2_base_github_sha_invalid'; end if;
 if p_semantic_payload_root_sha256 !~ '^[0-9a-f]{64}$' or p_roadmap_definition_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'a2_authority_hash_invalid'; end if;
 perform set_config('metaengine.a2_rpc','on',true);
 select * into r from destruktion_meta.compute_fabric_a2_workspace_h205f22 where workspace_key=p_workspace_key;
 if found then
   if r.semantic_point<>p_semantic_point or r.base_github_sha<>p_base_github_sha or r.semantic_checkpoint_id<>p_semantic_checkpoint_id or r.semantic_payload_root_sha256<>p_semantic_payload_root_sha256 or r.roadmap_definition_sha256<>p_roadmap_definition_sha256 then raise exception 'a2_workspace_authority_mismatch'; end if;
 else
   insert into destruktion_meta.compute_fabric_a2_workspace_h205f22(workspace_key,semantic_point,base_github_sha,semantic_checkpoint_id,semantic_payload_root_sha256,roadmap_definition_sha256,created_by)
   values(p_workspace_key,p_semantic_point,p_base_github_sha,p_semantic_checkpoint_id,p_semantic_payload_root_sha256,p_roadmap_definition_sha256,p_created_by) returning * into r;
 end if;
 return jsonb_build_object('schema','metaengine.compute.a2-workspace.v1','workspace_id',r.workspace_id,'workspace_key',r.workspace_key,'mode',r.mode,'semantic_point',r.semantic_point,'base_github_sha',r.base_github_sha,'semantic_checkpoint_id',r.semantic_checkpoint_id,'semantic_payload_root_sha256',r.semantic_payload_root_sha256,'roadmap_definition_sha256',r.roadmap_definition_sha256,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_a2_register_peer_session_v1(p_workspace_id uuid,p_agent text,p_runtime_id text,p_provider text,p_requested_model text,p_reported_model text,p_capabilities jsonb,p_capability_epoch bigint,p_public_key_base64 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta,extensions as $$
declare r destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype; key_bytes bytea; fp text; expected_model text;
begin
 if p_agent not in ('GPT','GLM') then raise exception 'a2_agent_invalid'; end if;
 expected_model:=case when p_agent='GPT' then 'openai/gpt-5.6-sol' else 'zai/glm-5.3' end;
 if p_requested_model<>expected_model then raise exception 'a2_exact_model_required:%',expected_model; end if;
 if p_capability_epoch is null or p_capability_epoch<1 then raise exception 'a2_capability_epoch_invalid'; end if;
 begin key_bytes:=decode(p_public_key_base64,'base64'); exception when others then raise exception 'a2_public_key_base64_invalid'; end;
 if octet_length(key_bytes)<>32 then raise exception 'a2_ed25519_public_key_length_invalid'; end if;
 fp:=encode(extensions.digest(key_bytes,'sha256'),'hex');
 perform 1 from destruktion_meta.compute_fabric_a2_workspace_h205f22 where workspace_id=p_workspace_id and mode<>'CLOSED'; if not found then raise exception 'a2_workspace_not_open'; end if;
 perform set_config('metaengine.a2_rpc','on',true);
 insert into destruktion_meta.compute_fabric_a2_peer_session_h205f22(workspace_id,agent,runtime_id,provider,requested_model,reported_model,capabilities,capability_epoch,public_key_base64,key_fingerprint_sha256)
 values(p_workspace_id,p_agent,p_runtime_id,p_provider,p_requested_model,nullif(p_reported_model,''),coalesce(p_capabilities,'{}'::jsonb),p_capability_epoch,p_public_key_base64,fp)
 on conflict(workspace_id,agent,capability_epoch) do update set last_seen_at=clock_timestamp(),reported_model=excluded.reported_model,capabilities=excluded.capabilities
 where destruktion_meta.compute_fabric_a2_peer_session_h205f22.runtime_id=excluded.runtime_id and destruktion_meta.compute_fabric_a2_peer_session_h205f22.key_fingerprint_sha256=excluded.key_fingerprint_sha256 returning * into r;
 if not found then raise exception 'a2_session_epoch_conflict'; end if;
 insert into destruktion_meta.compute_fabric_a2_peer_cursor_h205f22(workspace_id,session_id,agent,causal_frontier_hash) values(p_workspace_id,r.session_id,p_agent,repeat('0',64)) on conflict(workspace_id,session_id) do nothing;
 return jsonb_build_object('schema','metaengine.compute.a2-peer-session.v1','session_id',r.session_id,'workspace_id',r.workspace_id,'agent',r.agent,'runtime_id',r.runtime_id,'requested_model',r.requested_model,'reported_model',r.reported_model,'capability_epoch',r.capability_epoch,'key_fingerprint_sha256',r.key_fingerprint_sha256,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_a2_close_peer_session_v1(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
declare s destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype;
begin perform set_config('metaengine.a2_rpc','on',true); update destruktion_meta.compute_fabric_a2_peer_session_h205f22 set status='CLOSED',closed_at=clock_timestamp(),last_seen_at=clock_timestamp() where session_id=p_session_id and status='ACTIVE' returning * into s; if not found then raise exception 'a2_session_not_active'; end if; return jsonb_build_object('schema','metaengine.compute.a2-peer-session.v1','session_id',s.session_id,'workspace_id',s.workspace_id,'agent',s.agent,'status',s.status,'canonical',false,'authority_effect',false); end $$;

create or replace function public.h205f22_a2_create_visibility_proof_v1(p_session_id uuid,p_seen_commit_seq bigint,p_seen_gpt_seq bigint,p_seen_glm_seq bigint,p_context_manifest jsonb,p_mandatory_peer_event_hashes text[])
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta,extensions as $$
declare s destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype; proof destruktion_meta.compute_fabric_a2_visibility_proof_h205f22%rowtype; max_commit bigint; max_gpt bigint; max_glm bigint; missing_count integer; sorted_hashes text[]; manifest_sha text; frontier_sha text;
begin
 select * into s from destruktion_meta.compute_fabric_a2_peer_session_h205f22 where session_id=p_session_id and status='ACTIVE'; if not found then raise exception 'a2_session_not_active'; end if;
 select coalesce(max(commit_seq),0),coalesce(max(agent_seq) filter(where agent='GPT'),0),coalesce(max(agent_seq) filter(where agent='GLM'),0) into max_commit,max_gpt,max_glm from destruktion_meta.compute_fabric_a2_agent_event_h205f22 where workspace_id=s.workspace_id;
 if p_seen_commit_seq<0 or p_seen_commit_seq>max_commit or p_seen_gpt_seq<0 or p_seen_gpt_seq>max_gpt or p_seen_glm_seq<0 or p_seen_glm_seq>max_glm then raise exception 'a2_visibility_cursor_invalid'; end if;
 select coalesce(array_agg(x order by x),'{}'::text[]) into sorted_hashes from unnest(coalesce(p_mandatory_peer_event_hashes,'{}'::text[])) x;
 select count(*) into missing_count from unnest(sorted_hashes) h where not exists(select 1 from destruktion_meta.compute_fabric_a2_agent_event_h205f22 e where e.workspace_id=s.workspace_id and e.event_hash=h and e.commit_seq<=p_seen_commit_seq);
 if missing_count>0 then raise exception 'a2_visibility_mandatory_event_missing'; end if;
 manifest_sha:=destruktion_meta.compute_fabric_a2_sha256_jsonb_h205f22(coalesce(p_context_manifest,'{}'::jsonb));
 frontier_sha:=destruktion_meta.compute_fabric_a2_sha256_jsonb_h205f22(jsonb_build_object('workspace_id',s.workspace_id::text,'seen_commit_seq',p_seen_commit_seq,'seen_gpt_seq',p_seen_gpt_seq,'seen_glm_seq',p_seen_glm_seq,'mandatory_peer_event_hashes',to_jsonb(sorted_hashes)));
 perform set_config('metaengine.a2_rpc','on',true);
 insert into destruktion_meta.compute_fabric_a2_visibility_proof_h205f22(workspace_id,session_id,agent,seen_commit_seq,seen_gpt_seq,seen_glm_seq,input_frontier_hash,context_manifest,context_manifest_sha256,mandatory_peer_event_hashes)
 values(s.workspace_id,s.session_id,s.agent,p_seen_commit_seq,p_seen_gpt_seq,p_seen_glm_seq,frontier_sha,coalesce(p_context_manifest,'{}'::jsonb),manifest_sha,sorted_hashes) returning * into proof;
 return jsonb_build_object('schema','metaengine.compute.a2-visibility-proof.v1','proof_id',proof.proof_id,'workspace_id',proof.workspace_id,'agent',proof.agent,'seen_commit_seq',proof.seen_commit_seq,'seen_gpt_seq',proof.seen_gpt_seq,'seen_glm_seq',proof.seen_glm_seq,'input_frontier_hash',proof.input_frontier_hash,'context_manifest_sha256',proof.context_manifest_sha256,'mandatory_peer_event_hashes',to_jsonb(proof.mandatory_peer_event_hashes),'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_a2_next_agent_seq_v1(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
declare s destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype; n bigint; begin select * into s from destruktion_meta.compute_fabric_a2_peer_session_h205f22 where session_id=p_session_id and status='ACTIVE'; if not found then raise exception 'a2_session_not_active'; end if; select coalesce(max(agent_seq),0)+1 into n from destruktion_meta.compute_fabric_a2_agent_event_h205f22 where workspace_id=s.workspace_id and agent=s.agent; return jsonb_build_object('schema','metaengine.compute.a2-next-agent-seq.v1','workspace_id',s.workspace_id,'session_id',s.session_id,'agent',s.agent,'next_agent_seq',n,'canonical',false,'authority_effect',false); end $$;

create or replace function public.h205f22_a2_read_frontier_v1(p_workspace_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,destruktion_meta,extensions as $$
with h as (select coalesce(max(commit_seq),0) head_commit_seq,coalesce(max(agent_seq) filter(where agent='GPT'),0) gpt_seq,coalesce(max(agent_seq) filter(where agent='GLM'),0) glm_seq from destruktion_meta.compute_fabric_a2_agent_event_h205f22 where workspace_id=p_workspace_id), gh as (select event_hash from destruktion_meta.compute_fabric_a2_agent_event_h205f22 where workspace_id=p_workspace_id and agent='GPT' order by agent_seq desc limit 1), lh as (select event_hash from destruktion_meta.compute_fabric_a2_agent_event_h205f22 where workspace_id=p_workspace_id and agent='GLM' order by agent_seq desc limit 1) select jsonb_build_object('schema','metaengine.compute.a2-frontier.v1','workspace_id',p_workspace_id,'head_commit_seq',h.head_commit_seq,'gpt_seq',h.gpt_seq,'glm_seq',h.glm_seq,'gpt_hash',(select event_hash from gh),'glm_hash',(select event_hash from lh),'frontier_hash',encode(extensions.digest(convert_to(jsonb_build_object('workspace_id',p_workspace_id::text,'head_commit_seq',h.head_commit_seq,'gpt_seq',h.gpt_seq,'glm_seq',h.glm_seq,'gpt_hash',(select event_hash from gh),'glm_hash',(select event_hash from lh))::text,'UTF8'),'sha256'),'hex'),'canonical',false,'authority_effect',false) from h $$;

create or replace function public.h205f22_a2_prepare_event_v1(p_event_id uuid,p_session_id uuid,p_agent_seq bigint,p_semantic_point text,p_event_type text,p_priority smallint,p_parent_hashes text[],p_payload jsonb,p_visibility_proof_id uuid,p_model_provenance jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta,extensions as $$
declare s destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype; ws destruktion_meta.compute_fabric_a2_workspace_h205f22%rowtype; payload_sha text; event_sha text; next_seq bigint; missing_count integer;
begin
 select * into s from destruktion_meta.compute_fabric_a2_peer_session_h205f22 where session_id=p_session_id and status='ACTIVE'; if not found then raise exception 'a2_session_not_active'; end if;
 select * into ws from destruktion_meta.compute_fabric_a2_workspace_h205f22 where workspace_id=s.workspace_id and mode<>'CLOSED'; if not found then raise exception 'a2_workspace_not_open'; end if;
 if p_semantic_point<>ws.semantic_point then raise exception 'a2_semantic_point_mismatch'; end if; if p_priority<0 or p_priority>3 then raise exception 'a2_priority_invalid'; end if;
 select coalesce(max(agent_seq),0)+1 into next_seq from destruktion_meta.compute_fabric_a2_agent_event_h205f22 where workspace_id=s.workspace_id and agent=s.agent; if p_agent_seq<>next_seq then raise exception 'a2_agent_seq_expected:%',next_seq; end if;
 select count(*) into missing_count from unnest(coalesce(p_parent_hashes,'{}'::text[])) h where not exists(select 1 from destruktion_meta.compute_fabric_a2_agent_event_h205f22 e where e.workspace_id=s.workspace_id and e.event_hash=h); if missing_count>0 then raise exception 'a2_parent_event_missing'; end if;
 if p_visibility_proof_id is not null then perform 1 from destruktion_meta.compute_fabric_a2_visibility_proof_h205f22 where proof_id=p_visibility_proof_id and workspace_id=s.workspace_id and session_id=s.session_id; if not found then raise exception 'a2_visibility_proof_mismatch'; end if; end if;
 payload_sha:=destruktion_meta.compute_fabric_a2_sha256_jsonb_h205f22(coalesce(p_payload,'{}'::jsonb)); event_sha:=destruktion_meta.compute_fabric_a2_event_hash_h205f22(p_event_id,s.workspace_id,s.session_id,s.agent,p_agent_seq,p_semantic_point,p_event_type,p_priority,coalesce(p_parent_hashes,'{}'::text[]),payload_sha,p_visibility_proof_id,coalesce(p_model_provenance,'{}'::jsonb));
 return jsonb_build_object('schema','metaengine.compute.a2-event-preimage.v1','event_id',p_event_id,'workspace_id',s.workspace_id,'session_id',s.session_id,'agent',s.agent,'agent_seq',p_agent_seq,'payload_sha256',payload_sha,'event_hash',event_sha,'key_fingerprint_sha256',s.key_fingerprint_sha256,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_a2_emit_agent_event_v1(p_event_id uuid,p_session_id uuid,p_agent_seq bigint,p_semantic_point text,p_event_type text,p_priority smallint,p_parent_hashes text[],p_payload jsonb,p_visibility_proof_id uuid,p_model_provenance jsonb,p_event_hash text,p_signature_base64 text,p_signature_key_fingerprint_sha256 text,p_signature_verified boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta,extensions as $$
declare s destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype; prep jsonb; e destruktion_meta.compute_fabric_a2_agent_event_h205f22%rowtype; v destruktion_meta.compute_fabric_a2_visibility_proof_h205f22%rowtype; model_authored boolean; sig_bytes bytea; allowed boolean; reported text; requested text;
begin
 if p_signature_verified is distinct from true then raise exception 'a2_signature_not_verified_by_ingress'; end if;
 allowed:=p_event_type in ('PLAN','HYPOTHESIS','CLAIM','COUNTERCLAIM','QUESTION','EVIDENCE','ASSUMPTION','FALSIFIER','CRITIQUE','AGREEMENT','SYNTHESIS','ACTION_PROPOSAL','REQUEST_DUEL','MODEL_STARTED','MODEL_COMPLETED','MODEL_INTERRUPTED','PEER_EVENT_APPLIED','TOOL_CALL','TOOL_RESULT','TOOL_ERROR','FILE_READ','PATCH_CREATED','TEST_STARTED','TEST_RESULT','AUTHORITY_READ','AUTHORITY_DRIFT','BACKPRESSURE','CATCH_UP_STARTED','CATCH_UP_COMPLETED','CHECKPOINT','ERROR','DUEL_OPENED','DUEL_DECIDED'); if not allowed then raise exception 'a2_event_type_invalid:%',p_event_type; end if;
 select * into s from destruktion_meta.compute_fabric_a2_peer_session_h205f22 where session_id=p_session_id and status='ACTIVE'; if not found then raise exception 'a2_session_not_active'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.workspace_id::text,205022));
 if p_signature_key_fingerprint_sha256<>s.key_fingerprint_sha256 then raise exception 'a2_signature_key_mismatch'; end if;
 requested:=coalesce(p_model_provenance->>'requested_model',''); reported:=coalesce(p_model_provenance->>'reported_model',''); if requested<>'' and requested<>s.requested_model then raise exception 'a2_requested_model_provenance_mismatch'; end if; if reported<>'' and reported<>s.requested_model then raise exception 'a2_reported_model_provenance_mismatch'; end if;
 begin sig_bytes:=decode(p_signature_base64,'base64'); exception when others then raise exception 'a2_signature_base64_invalid'; end; if octet_length(sig_bytes)<>64 then raise exception 'a2_ed25519_signature_length_invalid'; end if;
 prep:=public.h205f22_a2_prepare_event_v1(p_event_id,p_session_id,p_agent_seq,p_semantic_point,p_event_type,p_priority,p_parent_hashes,p_payload,p_visibility_proof_id,p_model_provenance); if prep->>'event_hash'<>p_event_hash then raise exception 'a2_event_hash_mismatch'; end if;
 model_authored:=p_event_type in ('PLAN','HYPOTHESIS','CLAIM','COUNTERCLAIM','QUESTION','EVIDENCE','ASSUMPTION','FALSIFIER','CRITIQUE','AGREEMENT','SYNTHESIS','ACTION_PROPOSAL','REQUEST_DUEL'); if model_authored and p_visibility_proof_id is null then raise exception 'a2_model_event_visibility_proof_required'; end if;
 if model_authored then select * into v from destruktion_meta.compute_fabric_a2_visibility_proof_h205f22 where proof_id=p_visibility_proof_id and session_id=p_session_id and accepted_event_id is null for update; if not found then raise exception 'a2_visibility_proof_already_used_or_invalid'; end if; if exists(select 1 from destruktion_meta.compute_fabric_a2_agent_event_h205f22 x where x.workspace_id=s.workspace_id and x.agent<>s.agent and x.priority<=1 and x.commit_seq>v.seen_commit_seq) then raise exception 'a2_model_event_stale_frontier'; end if; end if;
 perform set_config('metaengine.a2_rpc','on',true);
 insert into destruktion_meta.compute_fabric_a2_agent_event_h205f22(event_id,workspace_id,session_id,agent,agent_seq,semantic_point,event_type,priority,parent_hashes,payload,payload_sha256,event_hash,signature_base64,signature_key_fingerprint_sha256,signature_verification_mode,visibility_proof_id,model_provenance) values(p_event_id,s.workspace_id,s.session_id,s.agent,p_agent_seq,p_semantic_point,p_event_type,p_priority,coalesce(p_parent_hashes,'{}'::text[]),coalesce(p_payload,'{}'::jsonb),prep->>'payload_sha256',p_event_hash,p_signature_base64,p_signature_key_fingerprint_sha256,'TRUSTED_INGRESS_ED25519_V1',p_visibility_proof_id,coalesce(p_model_provenance,'{}'::jsonb)) returning * into e;
 if model_authored then update destruktion_meta.compute_fabric_a2_visibility_proof_h205f22 set accepted_event_id=e.event_id where proof_id=p_visibility_proof_id; end if; update destruktion_meta.compute_fabric_a2_peer_session_h205f22 set last_seen_at=clock_timestamp() where session_id=p_session_id;
 return jsonb_build_object('schema','metaengine.compute.a2-agent-event.v1','event_id',e.event_id,'commit_seq',e.commit_seq,'workspace_id',e.workspace_id,'agent',e.agent,'agent_seq',e.agent_seq,'event_type',e.event_type,'priority',e.priority,'event_hash',e.event_hash,'visibility_proof_id',e.visibility_proof_id,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_a2_update_cursor_v1(p_session_id uuid,p_last_received_commit_seq bigint,p_last_applied_commit_seq bigint,p_causal_frontier_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
declare s destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype; begin select * into s from destruktion_meta.compute_fabric_a2_peer_session_h205f22 where session_id=p_session_id and status='ACTIVE'; if not found then raise exception 'a2_session_not_active'; end if; if p_last_received_commit_seq<0 or p_last_applied_commit_seq<0 or p_last_applied_commit_seq>p_last_received_commit_seq then raise exception 'a2_cursor_invalid'; end if; if p_causal_frontier_hash !~ '^[0-9a-f]{64}$' then raise exception 'a2_frontier_hash_invalid'; end if; perform set_config('metaengine.a2_rpc','on',true); insert into destruktion_meta.compute_fabric_a2_peer_cursor_h205f22(workspace_id,session_id,agent,last_received_commit_seq,last_applied_commit_seq,causal_frontier_hash,updated_at) values(s.workspace_id,s.session_id,s.agent,p_last_received_commit_seq,p_last_applied_commit_seq,p_causal_frontier_hash,clock_timestamp()) on conflict(workspace_id,session_id) do update set last_received_commit_seq=greatest(destruktion_meta.compute_fabric_a2_peer_cursor_h205f22.last_received_commit_seq,excluded.last_received_commit_seq),last_applied_commit_seq=greatest(destruktion_meta.compute_fabric_a2_peer_cursor_h205f22.last_applied_commit_seq,excluded.last_applied_commit_seq),causal_frontier_hash=excluded.causal_frontier_hash,updated_at=excluded.updated_at; return jsonb_build_object('schema','metaengine.compute.a2-peer-cursor.v1','session_id',s.session_id,'workspace_id',s.workspace_id,'last_received_commit_seq',p_last_received_commit_seq,'last_applied_commit_seq',p_last_applied_commit_seq,'causal_frontier_hash',p_causal_frontier_hash,'canonical',false,'authority_effect',false); end $$;

create or replace function public.h205f22_a2_read_events_v1(p_workspace_id uuid,p_after_commit_seq bigint default 0,p_limit integer default 200)
returns jsonb language sql security definer set search_path=pg_catalog,destruktion_meta as $$
 select jsonb_build_object('schema','metaengine.compute.a2-events.v1','workspace_id',p_workspace_id,'after_commit_seq',greatest(coalesce(p_after_commit_seq,0),0),'events',coalesce(jsonb_agg(to_jsonb(q) order by q.commit_seq),'[]'::jsonb),'canonical',false,'authority_effect',false) from (select e.event_id,e.commit_seq,e.workspace_id,e.session_id,e.agent,e.agent_seq,e.semantic_point,e.event_type,e.priority,e.parent_hashes,e.payload,e.payload_sha256,e.event_hash,e.signature_base64,e.signature_key_fingerprint_sha256,e.signature_verification_mode,e.visibility_proof_id,e.model_provenance,e.created_at,case when v.proof_id is null then null else jsonb_build_object('proof_id',v.proof_id,'agent',v.agent,'seen_commit_seq',v.seen_commit_seq,'seen_gpt_seq',v.seen_gpt_seq,'seen_glm_seq',v.seen_glm_seq,'input_frontier_hash',v.input_frontier_hash,'context_manifest_sha256',v.context_manifest_sha256,'mandatory_peer_event_hashes',to_jsonb(v.mandatory_peer_event_hashes),'accepted_event_id',v.accepted_event_id,'created_at',v.created_at) end visibility_proof from destruktion_meta.compute_fabric_a2_agent_event_h205f22 e left join destruktion_meta.compute_fabric_a2_visibility_proof_h205f22 v on v.proof_id=e.visibility_proof_id where e.workspace_id=p_workspace_id and e.commit_seq>greatest(coalesce(p_after_commit_seq,0),0) order by e.commit_seq limit least(greatest(coalesce(p_limit,200),1),1000)) q
$$;

create or replace function public.h205f22_a2_read_snapshot_v1(p_workspace_id uuid,p_recent_limit integer default 100)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
declare ws jsonb; peers jsonb; cursors jsonb; conflicts jsonb; events jsonb; head bigint; begin select to_jsonb(w) into ws from (select workspace_id,workspace_key,semantic_point,mode,base_github_sha,semantic_checkpoint_id,semantic_payload_root_sha256,roadmap_definition_sha256,created_by,created_at,updated_at from destruktion_meta.compute_fabric_a2_workspace_h205f22 where workspace_id=p_workspace_id) w; if ws is null then raise exception 'a2_workspace_not_found'; end if; select coalesce(jsonb_agg(to_jsonb(p) order by p.agent,p.capability_epoch),'[]'::jsonb) into peers from (select session_id,agent,runtime_id,provider,requested_model,reported_model,capabilities,capability_epoch,public_key_alg,public_key_base64,key_fingerprint_sha256,status,started_at,last_seen_at,closed_at from destruktion_meta.compute_fabric_a2_peer_session_h205f22 where workspace_id=p_workspace_id) p; select coalesce(jsonb_agg(to_jsonb(c) order by c.agent),'[]'::jsonb) into cursors from (select session_id,agent,last_received_commit_seq,last_applied_commit_seq,causal_frontier_hash,updated_at from destruktion_meta.compute_fabric_a2_peer_cursor_h205f22 where workspace_id=p_workspace_id) c; select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc),'[]'::jsonb) into conflicts from (select conflict_id,semantic_point,left_event_hash,right_event_hash,reason,impact,status,duel_id,resolution_event_hash,created_at,updated_at from destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22 where workspace_id=p_workspace_id order by created_at desc limit 50) c; select coalesce(max(commit_seq),0) into head from destruktion_meta.compute_fabric_a2_agent_event_h205f22 where workspace_id=p_workspace_id; events:=public.h205f22_a2_read_events_v1(p_workspace_id,greatest(head-least(greatest(coalesce(p_recent_limit,100),1),500),0),least(greatest(coalesce(p_recent_limit,100),1),500))->'events'; return jsonb_build_object('schema','metaengine.compute.a2-snapshot.v1','workspace',ws,'head_commit_seq',head,'peers',peers,'cursors',cursors,'conflicts',conflicts,'events',events,'canonical',false,'authority_effect',false); end $$;

create or replace function public.h205f22_a2_read_visibility_proof_v1(p_proof_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,destruktion_meta as $$ select coalesce((select jsonb_build_object('schema','metaengine.compute.a2-visibility-proof.v1','proof_id',v.proof_id,'workspace_id',v.workspace_id,'session_id',v.session_id,'agent',v.agent,'seen_commit_seq',v.seen_commit_seq,'seen_gpt_seq',v.seen_gpt_seq,'seen_glm_seq',v.seen_glm_seq,'input_frontier_hash',v.input_frontier_hash,'context_manifest',v.context_manifest,'context_manifest_sha256',v.context_manifest_sha256,'mandatory_peer_event_hashes',to_jsonb(v.mandatory_peer_event_hashes),'accepted_event_id',v.accepted_event_id,'created_at',v.created_at,'canonical',false,'authority_effect',false) from destruktion_meta.compute_fabric_a2_visibility_proof_h205f22 v where v.proof_id=p_proof_id),jsonb_build_object('schema','metaengine.compute.a2-visibility-proof.v1','found',false,'proof_id',p_proof_id,'canonical',false,'authority_effect',false)) $$;

create or replace function public.h205f22_a2_read_event_ancestry_v1(p_event_id uuid,p_max_depth integer default 32)
returns jsonb language sql security definer set search_path=pg_catalog,destruktion_meta as $$ with recursive anc(event_id,workspace_id,event_hash,parent_hashes,commit_seq,agent,agent_seq,event_type,payload,depth) as (select event_id,workspace_id,event_hash,parent_hashes,commit_seq,agent,agent_seq,event_type,payload,0 from destruktion_meta.compute_fabric_a2_agent_event_h205f22 where event_id=p_event_id union all select p.event_id,p.workspace_id,p.event_hash,p.parent_hashes,p.commit_seq,p.agent,p.agent_seq,p.event_type,p.payload,a.depth+1 from anc a join lateral unnest(a.parent_hashes) h on true join destruktion_meta.compute_fabric_a2_agent_event_h205f22 p on p.workspace_id=a.workspace_id and p.event_hash=h where a.depth<least(greatest(coalesce(p_max_depth,32),1),64)) select jsonb_build_object('schema','metaengine.compute.a2-ancestry.v1','event_id',p_event_id,'ancestry',coalesce(jsonb_agg(to_jsonb(anc) order by depth,commit_seq) filter(where depth>0),'[]'::jsonb),'canonical',false,'authority_effect',false) from anc $$;

create or replace function public.h205f22_a2_open_conflict_v1(p_workspace_id uuid,p_semantic_point text,p_left_event_hash text,p_right_event_hash text,p_reason text,p_impact text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta,extensions as $$
declare c destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22%rowtype; a text; b text; le destruktion_meta.compute_fabric_a2_agent_event_h205f22%rowtype; re destruktion_meta.compute_fabric_a2_agent_event_h205f22%rowtype; begin if p_impact not in ('LOW','MEDIUM','HIGH','CRITICAL') then raise exception 'a2_conflict_impact_invalid'; end if; if p_left_event_hash=p_right_event_hash then raise exception 'a2_conflict_same_event'; end if; a:=least(p_left_event_hash,p_right_event_hash); b:=greatest(p_left_event_hash,p_right_event_hash); select * into le from destruktion_meta.compute_fabric_a2_agent_event_h205f22 where workspace_id=p_workspace_id and event_hash=a; if not found then raise exception 'a2_conflict_left_missing'; end if; select * into re from destruktion_meta.compute_fabric_a2_agent_event_h205f22 where workspace_id=p_workspace_id and event_hash=b; if not found then raise exception 'a2_conflict_right_missing'; end if; if le.agent=re.agent then raise exception 'a2_conflict_requires_distinct_agents'; end if; if le.semantic_point<>p_semantic_point or re.semantic_point<>p_semantic_point then raise exception 'a2_conflict_semantic_point_mismatch'; end if; perform set_config('metaengine.a2_rpc','on',true); insert into destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22(workspace_id,semantic_point,left_event_hash,right_event_hash,reason,impact) values(p_workspace_id,p_semantic_point,a,b,p_reason,p_impact) on conflict(workspace_id,left_event_hash,right_event_hash) do update set updated_at=clock_timestamp() returning * into c; return jsonb_build_object('schema','metaengine.compute.a2-conflict.v1','conflict_id',c.conflict_id,'workspace_id',c.workspace_id,'status',c.status,'impact',c.impact,'left_event_hash',c.left_event_hash,'right_event_hash',c.right_event_hash,'canonical',false,'authority_effect',false); end $$;

create or replace function public.h205f22_a2_attach_duel_v1(p_conflict_id uuid,p_duel_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$ declare c destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22%rowtype; begin perform 1 from destruktion_meta.compute_fabric_duel_session_h205f22 where duel_id=p_duel_id and subject->>'debate_protocol'='SAME_POINT_DUEL_V4'; if not found then raise exception 'a2_duel_not_v4'; end if; perform set_config('metaengine.a2_rpc','on',true); update destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22 set status='DUEL',duel_id=p_duel_id,updated_at=clock_timestamp() where conflict_id=p_conflict_id and status in ('OPEN','DIRECT_RESOLUTION') returning * into c; if not found then raise exception 'a2_conflict_not_attachable'; end if; return jsonb_build_object('schema','metaengine.compute.a2-conflict.v1','conflict_id',c.conflict_id,'status',c.status,'duel_id',c.duel_id,'canonical',false,'authority_effect',false); end $$;

create or replace function public.h205f22_a2_resolve_conflict_v1(p_conflict_id uuid,p_resolution_event_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$ declare c destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22%rowtype; begin select * into c from destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22 where conflict_id=p_conflict_id; if not found then raise exception 'a2_conflict_not_found'; end if; perform 1 from destruktion_meta.compute_fabric_a2_agent_event_h205f22 where workspace_id=c.workspace_id and event_hash=p_resolution_event_hash; if not found then raise exception 'a2_resolution_event_missing'; end if; perform set_config('metaengine.a2_rpc','on',true); update destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22 set status='RESOLVED',resolution_event_hash=p_resolution_event_hash,updated_at=clock_timestamp() where conflict_id=p_conflict_id returning * into c; return jsonb_build_object('schema','metaengine.compute.a2-conflict.v1','conflict_id',c.conflict_id,'status',c.status,'resolution_event_hash',c.resolution_event_hash,'canonical',false,'authority_effect',false); end $$;

revoke all on destruktion_meta.compute_fabric_a2_workspace_h205f22 from anon,authenticated,service_role;
revoke all on destruktion_meta.compute_fabric_a2_peer_session_h205f22 from anon,authenticated,service_role;
revoke all on destruktion_meta.compute_fabric_a2_visibility_proof_h205f22 from anon,authenticated,service_role;
revoke all on destruktion_meta.compute_fabric_a2_agent_event_h205f22 from anon,authenticated,service_role;
revoke all on destruktion_meta.compute_fabric_a2_peer_cursor_h205f22 from anon,authenticated,service_role;
revoke all on destruktion_meta.compute_fabric_a2_semantic_conflict_h205f22 from anon,authenticated,service_role;

do $$ declare sig text; begin
 foreach sig in array array[
 'public.h205f22_a2_open_workspace_v1(text,text,text,text,text,text,text)',
 'public.h205f22_a2_register_peer_session_v1(uuid,text,text,text,text,text,jsonb,bigint,text)',
 'public.h205f22_a2_close_peer_session_v1(uuid)',
 'public.h205f22_a2_create_visibility_proof_v1(uuid,bigint,bigint,bigint,jsonb,text[])',
 'public.h205f22_a2_next_agent_seq_v1(uuid)',
 'public.h205f22_a2_read_frontier_v1(uuid)',
 'public.h205f22_a2_prepare_event_v1(uuid,uuid,bigint,text,text,smallint,text[],jsonb,uuid,jsonb)',
 'public.h205f22_a2_emit_agent_event_v1(uuid,uuid,bigint,text,text,smallint,text[],jsonb,uuid,jsonb,text,text,text,boolean)',
 'public.h205f22_a2_update_cursor_v1(uuid,bigint,bigint,text)',
 'public.h205f22_a2_read_events_v1(uuid,bigint,integer)',
 'public.h205f22_a2_read_snapshot_v1(uuid,integer)',
 'public.h205f22_a2_read_visibility_proof_v1(uuid)',
 'public.h205f22_a2_read_event_ancestry_v1(uuid,integer)',
 'public.h205f22_a2_open_conflict_v1(uuid,text,text,text,text,text)',
 'public.h205f22_a2_attach_duel_v1(uuid,uuid)',
 'public.h205f22_a2_resolve_conflict_v1(uuid,text)'
 ] loop
   execute 'revoke all on function '||sig||' from public,anon,authenticated';
   execute 'grant execute on function '||sig||' to service_role';
 end loop;
end $$;
