create sequence if not exists destruktion_meta.compute_fabric_a2_interactive_seq_h205f22;

create table if not exists destruktion_meta.compute_fabric_a2_interactive_message_h205f22 (
  message_id uuid primary key default gen_random_uuid(),
  message_seq bigint not null unique default nextval('destruktion_meta.compute_fabric_a2_interactive_seq_h205f22'),
  workspace_id uuid not null references destruktion_meta.compute_fabric_a2_workspace_h205f22(workspace_id) on delete cascade,
  agent text not null check (agent in ('GPT','GLM')),
  model_claim text not null,
  semantic_point text not null,
  message_type text not null check (message_type in ('PLAN','HYPOTHESIS','CLAIM','COUNTERCLAIM','QUESTION','EVIDENCE','ASSUMPTION','FALSIFIER','CRITIQUE','AGREEMENT','SYNTHESIS','ACTION_PROPOSAL','REQUEST_DUEL','TOOL_CALL','TOOL_RESULT','TOOL_ERROR','FILE_READ','PATCH_CREATED','TEST_STARTED','TEST_RESULT','AUTHORITY_READ','AUTHORITY_DRIFT','MODEL_INTERRUPTED','CHECKPOINT','ERROR','STATUS')),
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  parent_message_hashes text[] not null default '{}'::text[],
  parent_event_hashes text[] not null default '{}'::text[],
  seen_peer_through_seq bigint not null default 0 check (seen_peer_through_seq >= 0),
  seen_peer_hashes text[] not null default '{}'::text[],
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  message_hash text not null unique check (message_hash ~ '^[0-9a-f]{64}$'),
  source_kind text not null default 'CONNECTED_CHAT' check (source_kind='CONNECTED_CHAT'),
  identity_assurance text not null default 'SERVICE_ROLE_CONNECTOR_ASSERTED' check (identity_assurance='SERVICE_ROLE_CONNECTOR_ASSERTED'),
  visibility_assurance text not null default 'CONNECTOR_READBACK_ASSERTED' check (visibility_assurance='CONNECTOR_READBACK_ASSERTED'),
  eligible_for_exact_acceptance boolean not null default false check (eligible_for_exact_acceptance=false),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists compute_fabric_a2_interactive_message_workspace_seq_idx on destruktion_meta.compute_fabric_a2_interactive_message_h205f22(workspace_id,message_seq);
create index if not exists compute_fabric_a2_interactive_message_workspace_agent_seq_idx on destruktion_meta.compute_fabric_a2_interactive_message_h205f22(workspace_id,agent,message_seq);

alter table destruktion_meta.compute_fabric_a2_interactive_message_h205f22 enable row level security;
revoke all on destruktion_meta.compute_fabric_a2_interactive_message_h205f22 from public, anon, authenticated, service_role;
revoke all on sequence destruktion_meta.compute_fabric_a2_interactive_seq_h205f22 from public, anon, authenticated, service_role;

create or replace function destruktion_meta.compute_fabric_a2_interactive_direct_write_guard_h205f22() returns trigger language plpgsql security definer set search_path='pg_catalog','destruktion_meta' as $$
begin
  if current_setting('metaengine.a2_connector_rpc',true) is distinct from 'on' then raise exception 'a2_interactive_direct_write_denied'; end if;
  return new;
end $$;

drop trigger if exists compute_fabric_a2_interactive_direct_write_guard_h205f22 on destruktion_meta.compute_fabric_a2_interactive_message_h205f22;
create trigger compute_fabric_a2_interactive_direct_write_guard_h205f22 before insert or update or delete on destruktion_meta.compute_fabric_a2_interactive_message_h205f22 for each row execute function destruktion_meta.compute_fabric_a2_interactive_direct_write_guard_h205f22();

create or replace function public.h205f22_a2_interactive_submit_v1(p_workspace_id uuid,p_agent text,p_semantic_point text,p_message_type text,p_payload jsonb,p_parent_message_hashes text[] default '{}'::text[],p_parent_event_hashes text[] default '{}'::text[],p_seen_peer_through_seq bigint default 0,p_seen_peer_hashes text[] default '{}'::text[]) returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta','extensions' as $$
declare w destruktion_meta.compute_fabric_a2_workspace_h205f22%rowtype; model text; peer text; payload_sha text; msg_hash text; msg_id uuid:=gen_random_uuid(); msg_seq bigint; max_peer_seq bigint:=0; h text;
begin
  if p_agent not in ('GPT','GLM') then raise exception 'a2_interactive_agent_invalid'; end if;
  if p_message_type not in ('PLAN','HYPOTHESIS','CLAIM','COUNTERCLAIM','QUESTION','EVIDENCE','ASSUMPTION','FALSIFIER','CRITIQUE','AGREEMENT','SYNTHESIS','ACTION_PROPOSAL','REQUEST_DUEL','TOOL_CALL','TOOL_RESULT','TOOL_ERROR','FILE_READ','PATCH_CREATED','TEST_STARTED','TEST_RESULT','AUTHORITY_READ','AUTHORITY_DRIFT','MODEL_INTERRUPTED','CHECKPOINT','ERROR','STATUS') then raise exception 'a2_interactive_message_type_invalid'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'a2_interactive_payload_invalid'; end if;
  if p_seen_peer_through_seq is null or p_seen_peer_through_seq<0 then raise exception 'a2_interactive_seen_peer_seq_invalid'; end if;
  select * into w from destruktion_meta.compute_fabric_a2_workspace_h205f22 where workspace_id=p_workspace_id and mode<>'CLOSED';
  if not found then raise exception 'a2_interactive_workspace_not_open'; end if;
  if nullif(p_semantic_point,'') is null or p_semantic_point<>w.semantic_point then raise exception 'a2_interactive_semantic_point_mismatch'; end if;
  model:=case when p_agent='GPT' then 'openai/gpt-5.6-sol' else 'zai/glm-5.3' end; peer:=case when p_agent='GPT' then 'GLM' else 'GPT' end;
  foreach h in array coalesce(p_parent_message_hashes,'{}'::text[]) loop perform 1 from destruktion_meta.compute_fabric_a2_interactive_message_h205f22 where workspace_id=p_workspace_id and message_hash=h; if not found then raise exception 'a2_interactive_parent_message_missing:%',h; end if; end loop;
  foreach h in array coalesce(p_parent_event_hashes,'{}'::text[]) loop perform 1 from destruktion_meta.compute_fabric_a2_agent_event_h205f22 where workspace_id=p_workspace_id and event_hash=h; if not found then raise exception 'a2_interactive_parent_event_missing:%',h; end if; end loop;
  foreach h in array coalesce(p_seen_peer_hashes,'{}'::text[]) loop perform 1 from destruktion_meta.compute_fabric_a2_interactive_message_h205f22 where workspace_id=p_workspace_id and agent=peer and message_hash=h and message_seq<=p_seen_peer_through_seq; if not found then raise exception 'a2_interactive_seen_peer_hash_invalid:%',h; end if; end loop;
  select coalesce(max(message_seq),0) into max_peer_seq from destruktion_meta.compute_fabric_a2_interactive_message_h205f22 where workspace_id=p_workspace_id and agent=peer;
  if p_seen_peer_through_seq>max_peer_seq then raise exception 'a2_interactive_seen_peer_seq_ahead'; end if;
  payload_sha:=encode(extensions.digest(convert_to(p_payload::text,'UTF8'),'sha256'),'hex'); msg_seq:=nextval('destruktion_meta.compute_fabric_a2_interactive_seq_h205f22');
  msg_hash:=encode(extensions.digest(convert_to('A2_INTERACTIVE_V1\n'||p_workspace_id::text||'\n'||msg_seq::text||'\n'||p_agent||'\n'||model||'\n'||p_semantic_point||'\n'||p_message_type||'\n'||coalesce(array_to_string(p_parent_message_hashes,','),'')||'\n'||coalesce(array_to_string(p_parent_event_hashes,','),'')||'\n'||p_seen_peer_through_seq::text||'\n'||coalesce(array_to_string(p_seen_peer_hashes,','),'')||'\n'||payload_sha,'UTF8'),'sha256'),'hex');
  perform set_config('metaengine.a2_connector_rpc','on',true);
  insert into destruktion_meta.compute_fabric_a2_interactive_message_h205f22(message_id,message_seq,workspace_id,agent,model_claim,semantic_point,message_type,payload,parent_message_hashes,parent_event_hashes,seen_peer_through_seq,seen_peer_hashes,payload_sha256,message_hash) values(msg_id,msg_seq,p_workspace_id,p_agent,model,p_semantic_point,p_message_type,p_payload,coalesce(p_parent_message_hashes,'{}'::text[]),coalesce(p_parent_event_hashes,'{}'::text[]),p_seen_peer_through_seq,coalesce(p_seen_peer_hashes,'{}'::text[]),payload_sha,msg_hash);
  perform pg_notify('h205f22_a2_interactive',jsonb_build_object('workspace_id',p_workspace_id,'message_seq',msg_seq,'agent',p_agent,'message_hash',msg_hash)::text);
  return jsonb_build_object('schema','metaengine.compute.a2-interactive-message.v1','message_id',msg_id,'message_seq',msg_seq,'workspace_id',p_workspace_id,'agent',p_agent,'model_claim',model,'semantic_point',p_semantic_point,'message_type',p_message_type,'payload_sha256',payload_sha,'message_hash',msg_hash,'seen_peer_through_seq',p_seen_peer_through_seq,'identity_assurance','SERVICE_ROLE_CONNECTOR_ASSERTED','visibility_assurance','CONNECTOR_READBACK_ASSERTED','eligible_for_exact_acceptance',false,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_a2_interactive_read_v1(p_workspace_id uuid,p_after_seq bigint default 0,p_limit integer default 200) returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta' as $$
declare out_json jsonb;
begin
  if p_after_seq<0 then raise exception 'a2_interactive_after_seq_invalid'; end if; if p_limit<1 or p_limit>1000 then raise exception 'a2_interactive_limit_invalid'; end if;
  perform 1 from destruktion_meta.compute_fabric_a2_workspace_h205f22 where workspace_id=p_workspace_id; if not found then raise exception 'a2_interactive_workspace_not_found'; end if;
  select jsonb_build_object('schema','metaengine.compute.a2-interactive-read.v1','workspace_id',p_workspace_id,'head_message_seq',coalesce((select max(message_seq) from destruktion_meta.compute_fabric_a2_interactive_message_h205f22 where workspace_id=p_workspace_id),0),'messages',coalesce(jsonb_agg(to_jsonb(x) order by x.message_seq),'[]'::jsonb),'canonical',false,'authority_effect',false) into out_json from (select message_id,message_seq,agent,model_claim,semantic_point,message_type,payload,parent_message_hashes,parent_event_hashes,seen_peer_through_seq,seen_peer_hashes,payload_sha256,message_hash,source_kind,identity_assurance,visibility_assurance,eligible_for_exact_acceptance,canonical,authority_effect,created_at from destruktion_meta.compute_fabric_a2_interactive_message_h205f22 where workspace_id=p_workspace_id and message_seq>p_after_seq order by message_seq asc limit p_limit) x;
  return coalesce(out_json,jsonb_build_object('schema','metaengine.compute.a2-interactive-read.v1','workspace_id',p_workspace_id,'head_message_seq',0,'messages','[]'::jsonb,'canonical',false,'authority_effect',false));
end $$;

revoke all on function public.h205f22_a2_interactive_submit_v1(uuid,text,text,text,jsonb,text[],text[],bigint,text[]) from public,anon,authenticated;
revoke all on function public.h205f22_a2_interactive_read_v1(uuid,bigint,integer) from public,anon,authenticated;
grant execute on function public.h205f22_a2_interactive_submit_v1(uuid,text,text,text,jsonb,text[],text[],bigint,text[]) to service_role;
grant execute on function public.h205f22_a2_interactive_read_v1(uuid,bigint,integer) to service_role;
