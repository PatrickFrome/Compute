create table if not exists destruktion_meta.compute_fabric_a2_interactive_round_h205f22 (
  round_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references destruktion_meta.compute_fabric_a2_workspace_h205f22(workspace_id),
  semantic_point text not null,
  protocol text not null default 'A2_INTERACTIVE_DUAL_ROUND_V1' check (protocol='A2_INTERACTIVE_DUAL_ROUND_V1'),
  start_snapshot_sha256 text not null check (start_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  base_message_seq bigint not null check (base_message_seq >= 0),
  base_message_hash text not null check (base_message_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'COMMIT_OPEN' check (state in ('COMMIT_OPEN','REVEAL_OPEN','CHALLENGE_OPEN','DECIDE_OPEN','DECIDED','DISPUTED','ABANDONED')),
  gpt_commitment_sha256 text check (gpt_commitment_sha256 is null or gpt_commitment_sha256 ~ '^[0-9a-f]{64}$'),
  glm_commitment_sha256 text check (glm_commitment_sha256 is null or glm_commitment_sha256 ~ '^[0-9a-f]{64}$'),
  gpt_reveal_payload jsonb,
  glm_reveal_payload jsonb,
  gpt_reveal_nonce text,
  glm_reveal_nonce text,
  gpt_reveal_sha256 text check (gpt_reveal_sha256 is null or gpt_reveal_sha256 ~ '^[0-9a-f]{64}$'),
  glm_reveal_sha256 text check (glm_reveal_sha256 is null or glm_reveal_sha256 ~ '^[0-9a-f]{64}$'),
  gpt_challenge_payload jsonb,
  glm_challenge_payload jsonb,
  gpt_challenge_target_sha256 text check (gpt_challenge_target_sha256 is null or gpt_challenge_target_sha256 ~ '^[0-9a-f]{64}$'),
  glm_challenge_target_sha256 text check (glm_challenge_target_sha256 is null or glm_challenge_target_sha256 ~ '^[0-9a-f]{64}$'),
  gpt_decision_payload jsonb,
  glm_decision_payload jsonb,
  gpt_action_sha256 text check (gpt_action_sha256 is null or gpt_action_sha256 ~ '^[0-9a-f]{64}$'),
  glm_action_sha256 text check (glm_action_sha256 is null or glm_action_sha256 ~ '^[0-9a-f]{64}$'),
  decided_action_sha256 text check (decided_action_sha256 is null or decided_action_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false)
);

create unique index if not exists compute_fabric_a2_interactive_round_one_active_h205f22
on destruktion_meta.compute_fabric_a2_interactive_round_h205f22(workspace_id)
where state in ('COMMIT_OPEN','REVEAL_OPEN','CHALLENGE_OPEN','DECIDE_OPEN');
create index if not exists compute_fabric_a2_interactive_round_workspace_created_h205f22
on destruktion_meta.compute_fabric_a2_interactive_round_h205f22(workspace_id, created_at desc);

create or replace function destruktion_meta.compute_fabric_a2_interactive_round_direct_write_guard_h205f22()
returns trigger language plpgsql security definer
set search_path='pg_catalog','destruktion_meta'
as $$
begin
  if current_setting('metaengine.a2_interactive_round_rpc', true) is distinct from 'on' then raise exception 'a2_interactive_round_direct_write_denied'; end if;
  if tg_op='DELETE' then raise exception 'a2_interactive_round_delete_denied'; end if;
  new.canonical:=false; new.authority_effect:=false; new.updated_at:=clock_timestamp(); return new;
end $$;
drop trigger if exists compute_fabric_a2_interactive_round_direct_write_guard_h205f22 on destruktion_meta.compute_fabric_a2_interactive_round_h205f22;
create trigger compute_fabric_a2_interactive_round_direct_write_guard_h205f22 before insert or update or delete on destruktion_meta.compute_fabric_a2_interactive_round_h205f22 for each row execute function destruktion_meta.compute_fabric_a2_interactive_round_direct_write_guard_h205f22();

create or replace function public.h205f22_a2_interactive_commitment_v1(p_payload jsonb,p_nonce text)
returns text language sql immutable security definer set search_path='pg_catalog','extensions' as $$
 select encode(extensions.digest(convert_to(coalesce(p_payload,'{}'::jsonb)::text||E'\n'||coalesce(p_nonce,''),'UTF8'),'sha256'),'hex')
$$;

create or replace function public.h205f22_a2_interactive_round_open_v1(p_workspace_id uuid,p_semantic_point text,p_start_snapshot_sha256 text,p_base_message_seq bigint,p_base_message_hash text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta','extensions' as $$
declare r destruktion_meta.compute_fabric_a2_interactive_round_h205f22%rowtype;
begin
 if p_start_snapshot_sha256 !~ '^[0-9a-f]{64}$' or p_base_message_hash !~ '^[0-9a-f]{64}$' then raise exception 'a2_interactive_round_hash_invalid'; end if;
 if p_base_message_seq<1 then raise exception 'a2_interactive_round_base_seq_invalid'; end if;
 perform 1 from destruktion_meta.compute_fabric_a2_workspace_h205f22 where workspace_id=p_workspace_id and mode<>'CLOSED'; if not found then raise exception 'a2_interactive_workspace_not_open'; end if;
 perform 1 from destruktion_meta.compute_fabric_a2_interactive_message_h205f22 where workspace_id=p_workspace_id and message_seq=p_base_message_seq and message_hash=p_base_message_hash; if not found then raise exception 'a2_interactive_round_base_message_mismatch'; end if;
 perform set_config('metaengine.a2_interactive_round_rpc','on',true);
 insert into destruktion_meta.compute_fabric_a2_interactive_round_h205f22(workspace_id,semantic_point,start_snapshot_sha256,base_message_seq,base_message_hash) values(p_workspace_id,p_semantic_point,p_start_snapshot_sha256,p_base_message_seq,p_base_message_hash) returning * into r;
 return jsonb_build_object('schema','metaengine.compute.a2-interactive-dual-round.v1','round_id',r.round_id,'state',r.state,'workspace_id',r.workspace_id,'semantic_point',r.semantic_point,'start_snapshot_sha256',r.start_snapshot_sha256,'base_message_seq',r.base_message_seq,'base_message_hash',r.base_message_hash,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_a2_interactive_round_commit_v1(p_round_id uuid,p_agent text,p_commitment_sha256 text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta' as $$
declare r destruktion_meta.compute_fabric_a2_interactive_round_h205f22%rowtype;
begin
 if p_agent not in ('GPT','GLM') then raise exception 'a2_interactive_round_agent_invalid'; end if; if p_commitment_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'a2_interactive_round_commitment_invalid'; end if;
 select * into r from destruktion_meta.compute_fabric_a2_interactive_round_h205f22 where round_id=p_round_id for update; if not found then raise exception 'a2_interactive_round_not_found'; end if; if r.state<>'COMMIT_OPEN' then raise exception 'a2_interactive_round_commit_closed:%',r.state; end if;
 if p_agent='GPT' and r.gpt_commitment_sha256 is not null and r.gpt_commitment_sha256<>p_commitment_sha256 then raise exception 'a2_interactive_round_gpt_commitment_conflict'; end if; if p_agent='GLM' and r.glm_commitment_sha256 is not null and r.glm_commitment_sha256<>p_commitment_sha256 then raise exception 'a2_interactive_round_glm_commitment_conflict'; end if;
 perform set_config('metaengine.a2_interactive_round_rpc','on',true);
 update destruktion_meta.compute_fabric_a2_interactive_round_h205f22 set gpt_commitment_sha256=case when p_agent='GPT' then p_commitment_sha256 else gpt_commitment_sha256 end,glm_commitment_sha256=case when p_agent='GLM' then p_commitment_sha256 else glm_commitment_sha256 end where round_id=p_round_id returning * into r;
 if r.gpt_commitment_sha256 is not null and r.glm_commitment_sha256 is not null then update destruktion_meta.compute_fabric_a2_interactive_round_h205f22 set state='REVEAL_OPEN' where round_id=p_round_id returning * into r; end if;
 return jsonb_build_object('schema','metaengine.compute.a2-interactive-dual-round.v1','round_id',r.round_id,'state',r.state,'gpt_committed',r.gpt_commitment_sha256 is not null,'glm_committed',r.glm_commitment_sha256 is not null,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_a2_interactive_round_reveal_v1(p_round_id uuid,p_agent text,p_payload jsonb,p_nonce text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta','extensions' as $$
declare r destruktion_meta.compute_fabric_a2_interactive_round_h205f22%rowtype; c text; reveal_sha text;
begin
 if p_agent not in ('GPT','GLM') then raise exception 'a2_interactive_round_agent_invalid'; end if; if p_payload is null or jsonb_typeof(p_payload)<>'object' or nullif(p_nonce,'') is null then raise exception 'a2_interactive_round_reveal_invalid'; end if;
 select * into r from destruktion_meta.compute_fabric_a2_interactive_round_h205f22 where round_id=p_round_id for update; if not found then raise exception 'a2_interactive_round_not_found'; end if; if r.state<>'REVEAL_OPEN' then raise exception 'a2_interactive_round_reveal_closed:%',r.state; end if;
 c:=encode(extensions.digest(convert_to(p_payload::text||E'\n'||p_nonce,'UTF8'),'sha256'),'hex'); if p_agent='GPT' and c is distinct from r.gpt_commitment_sha256 then raise exception 'a2_interactive_round_gpt_reveal_commitment_mismatch'; end if; if p_agent='GLM' and c is distinct from r.glm_commitment_sha256 then raise exception 'a2_interactive_round_glm_reveal_commitment_mismatch'; end if;
 reveal_sha:=encode(extensions.digest(convert_to(p_payload::text,'UTF8'),'sha256'),'hex'); perform set_config('metaengine.a2_interactive_round_rpc','on',true);
 update destruktion_meta.compute_fabric_a2_interactive_round_h205f22 set gpt_reveal_payload=case when p_agent='GPT' then p_payload else gpt_reveal_payload end,glm_reveal_payload=case when p_agent='GLM' then p_payload else glm_reveal_payload end,gpt_reveal_nonce=case when p_agent='GPT' then p_nonce else gpt_reveal_nonce end,glm_reveal_nonce=case when p_agent='GLM' then p_nonce else glm_reveal_nonce end,gpt_reveal_sha256=case when p_agent='GPT' then reveal_sha else gpt_reveal_sha256 end,glm_reveal_sha256=case when p_agent='GLM' then reveal_sha else glm_reveal_sha256 end where round_id=p_round_id returning * into r;
 if r.gpt_reveal_payload is not null and r.glm_reveal_payload is not null then update destruktion_meta.compute_fabric_a2_interactive_round_h205f22 set state='CHALLENGE_OPEN' where round_id=p_round_id returning * into r; end if;
 return jsonb_build_object('schema','metaengine.compute.a2-interactive-dual-round.v1','round_id',r.round_id,'state',r.state,'gpt_revealed',r.gpt_reveal_payload is not null,'glm_revealed',r.glm_reveal_payload is not null,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_a2_interactive_round_challenge_v1(p_round_id uuid,p_agent text,p_target_reveal_sha256 text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta' as $$
declare r destruktion_meta.compute_fabric_a2_interactive_round_h205f22%rowtype;
begin
 if p_agent not in ('GPT','GLM') then raise exception 'a2_interactive_round_agent_invalid'; end if; if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'a2_interactive_round_challenge_invalid'; end if;
 select * into r from destruktion_meta.compute_fabric_a2_interactive_round_h205f22 where round_id=p_round_id for update; if not found then raise exception 'a2_interactive_round_not_found'; end if; if r.state<>'CHALLENGE_OPEN' then raise exception 'a2_interactive_round_challenge_closed:%',r.state; end if;
 if p_agent='GPT' and p_target_reveal_sha256 is distinct from r.glm_reveal_sha256 then raise exception 'a2_interactive_round_gpt_challenge_target_mismatch'; end if; if p_agent='GLM' and p_target_reveal_sha256 is distinct from r.gpt_reveal_sha256 then raise exception 'a2_interactive_round_glm_challenge_target_mismatch'; end if;
 perform set_config('metaengine.a2_interactive_round_rpc','on',true); update destruktion_meta.compute_fabric_a2_interactive_round_h205f22 set gpt_challenge_payload=case when p_agent='GPT' then p_payload else gpt_challenge_payload end,glm_challenge_payload=case when p_agent='GLM' then p_payload else glm_challenge_payload end,gpt_challenge_target_sha256=case when p_agent='GPT' then p_target_reveal_sha256 else gpt_challenge_target_sha256 end,glm_challenge_target_sha256=case when p_agent='GLM' then p_target_reveal_sha256 else glm_challenge_target_sha256 end where round_id=p_round_id returning * into r;
 if r.gpt_challenge_payload is not null and r.glm_challenge_payload is not null then update destruktion_meta.compute_fabric_a2_interactive_round_h205f22 set state='DECIDE_OPEN' where round_id=p_round_id returning * into r; end if;
 return jsonb_build_object('schema','metaengine.compute.a2-interactive-dual-round.v1','round_id',r.round_id,'state',r.state,'gpt_challenged',r.gpt_challenge_payload is not null,'glm_challenged',r.glm_challenge_payload is not null,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_a2_interactive_round_decide_v1(p_round_id uuid,p_agent text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta','extensions' as $$
declare r destruktion_meta.compute_fabric_a2_interactive_round_h205f22%rowtype; action_sha text;
begin
 if p_agent not in ('GPT','GLM') then raise exception 'a2_interactive_round_agent_invalid'; end if; if p_payload is null or jsonb_typeof(p_payload)<>'object' or not (p_payload?'action') then raise exception 'a2_interactive_round_decision_invalid'; end if;
 select * into r from destruktion_meta.compute_fabric_a2_interactive_round_h205f22 where round_id=p_round_id for update; if not found then raise exception 'a2_interactive_round_not_found'; end if; if r.state<>'DECIDE_OPEN' then raise exception 'a2_interactive_round_decide_closed:%',r.state; end if;
 action_sha:=encode(extensions.digest(convert_to((p_payload->'action')::text,'UTF8'),'sha256'),'hex'); perform set_config('metaengine.a2_interactive_round_rpc','on',true);
 update destruktion_meta.compute_fabric_a2_interactive_round_h205f22 set gpt_decision_payload=case when p_agent='GPT' then p_payload else gpt_decision_payload end,glm_decision_payload=case when p_agent='GLM' then p_payload else glm_decision_payload end,gpt_action_sha256=case when p_agent='GPT' then action_sha else gpt_action_sha256 end,glm_action_sha256=case when p_agent='GLM' then action_sha else glm_action_sha256 end where round_id=p_round_id returning * into r;
 if r.gpt_decision_payload is not null and r.glm_decision_payload is not null then if r.gpt_action_sha256=r.glm_action_sha256 then update destruktion_meta.compute_fabric_a2_interactive_round_h205f22 set state='DECIDED',decided_action_sha256=r.gpt_action_sha256 where round_id=p_round_id returning * into r; else update destruktion_meta.compute_fabric_a2_interactive_round_h205f22 set state='DISPUTED' where round_id=p_round_id returning * into r; end if; end if;
 return jsonb_build_object('schema','metaengine.compute.a2-interactive-dual-round.v1','round_id',r.round_id,'state',r.state,'gpt_decided',r.gpt_decision_payload is not null,'glm_decided',r.glm_decision_payload is not null,'decided_action_sha256',r.decided_action_sha256,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_a2_interactive_round_read_v1(p_round_id uuid)
returns jsonb language plpgsql stable security definer set search_path='pg_catalog','destruktion_meta' as $$
declare r destruktion_meta.compute_fabric_a2_interactive_round_h205f22%rowtype; reveal_visible boolean;
begin
 select * into r from destruktion_meta.compute_fabric_a2_interactive_round_h205f22 where round_id=p_round_id; if not found then raise exception 'a2_interactive_round_not_found'; end if; reveal_visible:=r.state in ('CHALLENGE_OPEN','DECIDE_OPEN','DECIDED','DISPUTED','ABANDONED');
 return jsonb_build_object('schema','metaengine.compute.a2-interactive-dual-round.v1','round_id',r.round_id,'workspace_id',r.workspace_id,'semantic_point',r.semantic_point,'start_snapshot_sha256',r.start_snapshot_sha256,'base_message_seq',r.base_message_seq,'base_message_hash',r.base_message_hash,'state',r.state,'gpt_commitment_sha256',r.gpt_commitment_sha256,'glm_commitment_sha256',r.glm_commitment_sha256,'gpt_reveal_sha256',case when reveal_visible then r.gpt_reveal_sha256 else null end,'glm_reveal_sha256',case when reveal_visible then r.glm_reveal_sha256 else null end,'gpt_reveal_payload',case when reveal_visible then r.gpt_reveal_payload else null end,'glm_reveal_payload',case when reveal_visible then r.glm_reveal_payload else null end,'gpt_challenge_target_sha256',r.gpt_challenge_target_sha256,'glm_challenge_target_sha256',r.glm_challenge_target_sha256,'gpt_challenge_payload',r.gpt_challenge_payload,'glm_challenge_payload',r.glm_challenge_payload,'gpt_decision_payload',r.gpt_decision_payload,'glm_decision_payload',r.glm_decision_payload,'gpt_action_sha256',r.gpt_action_sha256,'glm_action_sha256',r.glm_action_sha256,'decided_action_sha256',r.decided_action_sha256,'canonical',false,'authority_effect',false,'created_at',r.created_at,'updated_at',r.updated_at);
end $$;

revoke all on destruktion_meta.compute_fabric_a2_interactive_round_h205f22 from public,anon,authenticated,service_role;
revoke all on function public.h205f22_a2_interactive_commitment_v1(jsonb,text) from public,anon,authenticated;
revoke all on function public.h205f22_a2_interactive_round_open_v1(uuid,text,text,bigint,text) from public,anon,authenticated;
revoke all on function public.h205f22_a2_interactive_round_commit_v1(uuid,text,text) from public,anon,authenticated;
revoke all on function public.h205f22_a2_interactive_round_reveal_v1(uuid,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.h205f22_a2_interactive_round_challenge_v1(uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.h205f22_a2_interactive_round_decide_v1(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.h205f22_a2_interactive_round_read_v1(uuid) from public,anon,authenticated;
grant execute on function public.h205f22_a2_interactive_commitment_v1(jsonb,text) to service_role;
grant execute on function public.h205f22_a2_interactive_round_open_v1(uuid,text,text,bigint,text) to service_role;
grant execute on function public.h205f22_a2_interactive_round_commit_v1(uuid,text,text) to service_role;
grant execute on function public.h205f22_a2_interactive_round_reveal_v1(uuid,text,jsonb,text) to service_role;
grant execute on function public.h205f22_a2_interactive_round_challenge_v1(uuid,text,text,jsonb) to service_role;
grant execute on function public.h205f22_a2_interactive_round_decide_v1(uuid,text,jsonb) to service_role;
grant execute on function public.h205f22_a2_interactive_round_read_v1(uuid) to service_role;
