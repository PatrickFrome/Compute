-- Reviewed addressed-message acknowledgements. Acknowledged is not processed or task completion.
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
 where f.oid=to_regprocedure('destruktion_meta.project_message_ack_v1(uuid,uuid,text,bigint,bigint)');
 if p.prosrc is null then return;end if;
 if p.lanname<>'plpgsql' or p.prosecdef is distinct from false or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in ('311a8e260f4b3c28a04253e3c4628d339e5939f375ca6c8955d2116102a8a9d3')
 then raise exception 'PROJECT_MESSAGE_ACK_BODY_REQUIRES_REVIEW';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
 where f.oid=to_regprocedure('public.h205f22_project_message_ack_v1(uuid,uuid,uuid,bigint,bigint,bigint,uuid,text,bigint)');
 if p.prosrc is null then return;end if;
 if p.lanname<>'plpgsql' or p.prosecdef is distinct from true or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in ('3e689d8d8a701f6e4da0a91ae1801e9840fd608d397d86d41803e977cc9ae561')
 then raise exception 'PROJECT_MESSAGE_ACK_BODY_REQUIRES_REVIEW';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
 where f.oid=to_regprocedure('destruktion_meta.native_coding_agent_message_ack_v1(uuid,uuid,bigint)');
 if p.prosrc is null then return;end if;
 if p.lanname<>'plpgsql' or p.prosecdef is distinct from false or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in ('ad0cde0734999489372122d2c3294f455a136282b1a9fb147231dd01821eaf05')
 then raise exception 'PROJECT_MESSAGE_ACK_BODY_REQUIRES_REVIEW';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
 where f.oid=to_regprocedure('destruktion_meta.native_coding_agent_intent_immutable_v1()');
 if p.prosrc is null then return;end if;
 if p.lanname<>'plpgsql' or p.prosecdef is distinct from false or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in ('46d2d065cbdec40177da2bebedacad0897d2ce6f9ee3f22cdc8f00f742957626','96dc3ee621277f527260161de1f660627ec10e43f27ab3d8b1cb9d8ba9d60cff')
 then raise exception 'PROJECT_MESSAGE_ACK_BODY_REQUIRES_REVIEW';end if;
end $review$;
do $constraint$
declare c record; n integer;
begin
 select count(*) into n from pg_constraint where conrelid='destruktion_meta.native_coding_agent_intent_h205f22'::regclass and contype='c' and pg_get_constraintdef(oid) like '%operation%';
 if n<>1 then raise exception 'PROJECT_MESSAGE_ACK_CONSTRAINT_REQUIRES_REVIEW';end if;
 select conname,pg_get_constraintdef(oid) as definition into c from pg_constraint where conrelid='destruktion_meta.native_coding_agent_intent_h205f22'::regclass and contype='c' and pg_get_constraintdef(oid) like '%operation%';
 if c.definition='CHECK ((operation = ANY (ARRAY[''MESSAGE''::text, ''SPAWN''::text, ''ACK''::text])))' then return;end if;
 if c.definition<>'CHECK ((operation = ANY (ARRAY[''MESSAGE''::text, ''SPAWN''::text])))' then raise exception 'PROJECT_MESSAGE_ACK_CONSTRAINT_REQUIRES_REVIEW';end if;
 execute format('alter table destruktion_meta.native_coding_agent_intent_h205f22 drop constraint %I',c.conname);
 execute format('alter table destruktion_meta.native_coding_agent_intent_h205f22 add constraint %I check(operation in (''MESSAGE'',''SPAWN'',''ACK''))',c.conname);
end $constraint$;

create or replace function destruktion_meta.project_message_ack_v1(p_project uuid,p_task uuid,p_agent text,p_generation bigint,p_message_seq bigint)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$
declare original destruktion_meta.project_event_h205f22; prior destruktion_meta.project_event_h205f22; n bigint; event_key text; replay boolean:=false;
begin
 if p_message_seq is null or p_message_seq<1 or p_generation is null or p_generation<1 then raise exception 'PROJECT_MESSAGE_ACK_INVALID';end if;
 perform 1 from destruktion_meta.project_run_h205f22 where project_id=p_project and state='ACTIVE' for update;
 if not found then raise exception 'PROJECT_MESSAGE_ACK_PROJECT_FENCED';end if;
 select * into original from destruktion_meta.project_event_h205f22 where project_id=p_project and seq=p_message_seq;
 if not found or not((original.event_type='NATIVE_AGENT_MESSAGE' and original.source='UNTRUSTED_NATIVE_AGENT_MESSAGE')
   or (original.event_type='BROWSER_AGENT_MESSAGE' and original.source='UNTRUSTED_BROWSER_AGENT_MESSAGE'))
   or original.content->>'recipient_task_id' is distinct from p_task::text
   or original.content->>'target_agent_id' is distinct from p_agent
 then raise exception 'PROJECT_MESSAGE_ACK_RECIPIENT_DENIED' using errcode='42501';end if;
 event_key:='message-ack:'||p_message_seq||':'||p_task;
 select * into prior from destruktion_meta.project_event_h205f22 where project_id=p_project and idempotency_key=event_key;
 if found then
  if prior.event_type<>'PROJECT_MESSAGE_ACKNOWLEDGED' or prior.source<>'AUTHENTICATED_RECIPIENT_ACK'
   or prior.task_id<>p_task or prior.actor<>p_agent or prior.content->>'message_seq' is distinct from p_message_seq::text
  then raise exception 'PROJECT_MESSAGE_ACK_COLLISION';end if;
  n:=prior.seq;replay:=true;
 else
  n:=destruktion_meta.project_append_h205f22(p_project,'PROJECT_MESSAGE_ACKNOWLEDGED',p_task,p_generation,p_agent,p_message_seq,
    'PROJECT_ACK_MESSAGE',null,jsonb_build_object('message_seq',p_message_seq,'recipient_task_id',p_task,'recipient_agent_id',p_agent,
    'recipient_acknowledged',true,'processing_verified',false),'AUTHENTICATED_RECIPIENT_ACK',null,false,event_key);
 end if;
 return jsonb_build_object('schema','metaengine.devos.project-message-ack.v1','project_id',p_project,'message_seq',p_message_seq,
  'ack_seq',n,'recipient_task_id',p_task,'recipient_agent_id',p_agent,'recipient_acknowledged',true,'processing_verified',false,
  'replayed',replay,'automatic_retry_allowed',false,'authority_effect',false);
end $$;
revoke all on function destruktion_meta.project_message_ack_v1(uuid,uuid,text,bigint,bigint) from public,anon,authenticated,service_role;

create or replace function public.h205f22_project_message_ack_v1(p_workspace_id uuid,p_project_id uuid,p_task_id uuid,p_claim_id bigint,
 p_lease_generation bigint,p_message_seq bigint,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare auth jsonb;
begin
 auth:=destruktion_meta.project_parent_h205f22(p_workspace_id,p_project_id,p_task_id,p_claim_id,p_lease_generation,p_device_id,p_client_id,p_admin_grant_epoch);
 return destruktion_meta.project_message_ack_v1(p_project_id,p_task_id,auth#>>'{claim,agent_id}',p_lease_generation,p_message_seq);
end $$;
revoke all on function public.h205f22_project_message_ack_v1(uuid,uuid,uuid,bigint,bigint,bigint,uuid,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.h205f22_project_message_ack_v1(uuid,uuid,uuid,bigint,bigint,bigint,uuid,text,bigint) to service_role;

create or replace function destruktion_meta.native_coding_agent_message_ack_v1(p_run uuid,p_request uuid,p_message_seq bigint)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$
declare a jsonb; intent destruktion_meta.native_coding_agent_intent_h205f22; response jsonb;
begin
 a:=destruktion_meta.native_coding_agent_context_v1(p_run);
 if p_request is null or p_message_seq is null or p_message_seq<1 then raise exception 'PROJECT_MESSAGE_ACK_INVALID';end if;
 intent:=destruktion_meta.native_coding_agent_intent_begin_v1(a,p_run,p_request,'ACK',jsonb_build_object('message_seq',p_message_seq));
 if intent.receipt is not null then return intent.receipt||jsonb_build_object('intent_replayed',true,'requested_request_id',p_request,'original_request_id',intent.request_id);end if;
 response:=destruktion_meta.project_message_ack_v1((a->>'project_id')::uuid,(a#>>'{task,task_id}')::uuid,a#>>'{task,lease_agent_id}',
   (a#>>'{task,lease_generation}')::bigint,p_message_seq)||jsonb_build_object('request_id',intent.request_id,'intent_replayed',false);
 update destruktion_meta.native_coding_agent_intent_h205f22 set receipt=response,updated_at=clock_timestamp() where run_id=p_run and request_id=intent.request_id;
 return response;
end $$;
revoke all on function destruktion_meta.native_coding_agent_message_ack_v1(uuid,uuid,bigint) from public,anon,authenticated,service_role;

create or replace function destruktion_meta.native_coding_agent_intent_immutable_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-'receipt'-'updated_at') is distinct from (to_jsonb(old)-'receipt'-'updated_at')
   or (old.operation in ('MESSAGE','ACK') and old.receipt is not null and new.receipt is distinct from old.receipt)
 then raise exception 'native_agent_intent_immutable' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function destruktion_meta.native_coding_agent_intent_immutable_v1() from public,anon,authenticated,service_role;
