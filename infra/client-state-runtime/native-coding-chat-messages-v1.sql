-- Additive local upgrade: native messages may address a current project chat actor.
-- Storage in project history does not prove delivery, read acknowledgement or authority.
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
  where f.oid=to_regprocedure('destruktion_meta.native_coding_agent_message_v1(uuid,uuid,text,text)');
 if p.prosrc is null or p.lanname<>'plpgsql' or p.prosecdef is distinct from false or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta, extensions']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('87020b0b3b0fef32a63564720ff8a03faccc41d1cde4231df57ea65ec3749427','ac2995277879f38258350c6fdd17648a6fc4283ef11eff2baf274efe899009ca')
 then raise exception 'native_chat_message_body_requires_review' using errcode='55000';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('destruktion_meta.native_coding_project_peer_v1(uuid,uuid,text)');
 if p.prosrc is null then return;end if;
 if p.lanname<>'plpgsql' or p.prosecdef is distinct from false or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex')<>'fd1f084f6c1d2248db16dc427b5e21e67a8390774f2ca1aa22bd8f97d306da51'
 then raise exception 'native_chat_peer_body_requires_review' using errcode='55000';end if;
end $review$;
create or replace function destruktion_meta.native_coding_project_peer_v1(p_project uuid,p_workspace uuid,p_recipient_agent text)
returns uuid language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$
declare target uuid;count_targets integer;
begin
 if p_project is null or p_workspace is null or coalesce(p_recipient_agent,'') !~ '^agent_[a-z0-9-]{8,64}$' then return null;end if;
 select min(task_id::text)::uuid,count(*) into target,count_targets from (
   select t.task_id from destruktion_meta.project_task_h205f22 pt join destruktion_meta.devos_fleet_task_h205f22 t using(task_id)
   join destruktion_meta.native_coding_operator_permit_h205f22 p on p.permit_id=(t.task_spec#>>'{native_coding,permit_id}')::uuid
   where pt.project_id=p_project and t.workspace_id=p_workspace
     and coalesce(t.lease_agent_id,p.agent_id)=p_recipient_agent and t.state in ('READY','LEASED','RUNNING','RESULT_READY')
     and p.revoked_at is null and (p.permit->>'expires_at')::timestamptz>clock_timestamp()
   union all
   select t.task_id from destruktion_meta.project_task_h205f22 pt join destruktion_meta.devos_fleet_task_h205f22 t using(task_id)
   where pt.project_id=p_project and t.workspace_id=p_workspace
    and not(t.task_spec ? 'native_coding') and t.lease_agent_id=p_recipient_agent
    and (
     (t.state in ('LEASED','RUNNING') and exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 claim
       where claim.task_id=t.task_id and claim.workspace_id=t.workspace_id and claim.state='ACTIVE' and claim.expires_at>clock_timestamp()
        and claim.agent_id=t.lease_agent_id and claim.lease_generation=t.lease_generation
        and claim.tab_id=t.lease_tab_id and claim.target_id=t.lease_target_id and claim.agent_generation_epoch=t.lease_agent_generation_epoch))
     or (t.state='SUSPENDED' and exists(select 1 from destruktion_meta.browser_parent_suspension_h205f22 suspended
       where suspended.task_id=t.task_id and suspended.project_id=p_project and suspended.workspace_id=t.workspace_id
        and suspended.status='SUSPENDED' and suspended.old_lease_generation=t.lease_generation
        and suspended.checkpoint->>'schema'='metaengine.browser.parent-checkpoint.v1'
        and suspended.checkpoint->>'agent_id'=p_recipient_agent
        and (suspended.checkpoint->>'agent_generation_epoch')::bigint=t.lease_agent_generation_epoch
        and exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 prior where prior.claim_id=suspended.old_claim_id
         and prior.task_id=t.task_id and prior.workspace_id=t.workspace_id and prior.agent_id=p_recipient_agent
         and prior.lease_generation=t.lease_generation and prior.state='CLOSED')))
    )
 )peers;
 if count_targets<>1 then return null;end if;
 return target;
end $$;
revoke all on function destruktion_meta.native_coding_project_peer_v1(uuid,uuid,text) from public,anon,authenticated,service_role;
create or replace function destruktion_meta.native_coding_agent_message_v1(p_run uuid,p_request uuid,p_recipient_agent text,p_text text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta,extensions as $$
declare a jsonb; id uuid; target uuid; body jsonb; digest text; intent destruktion_meta.native_coding_agent_intent_h205f22;
 event_seq bigint; event jsonb; response jsonb;
begin
 a:=destruktion_meta.native_coding_agent_context_v1(p_run);id:=(a->>'project_id')::uuid;
 if p_request is null or p_recipient_agent is null or p_recipient_agent !~ '^agent_[a-z0-9-]{8,64}$'
   or p_text is null or length(btrim(p_text))=0 or octet_length(p_text)>8192 then raise exception 'native_agent_message_invalid'; end if;
 body:=jsonb_build_object('target_agent_id',p_recipient_agent,'message',p_text);
 digest:=encode(extensions.digest(convert_to(body::text,'UTF8'),'sha256'),'hex');
 intent:=destruktion_meta.native_coding_agent_intent_begin_v1(a,p_run,p_request,'MESSAGE',body);
 if intent.operation<>'MESSAGE' or intent.body_sha256<>digest or intent.body<>body then raise exception 'native_agent_intent_collision' using errcode='23505'; end if;
 if intent.receipt is not null then return intent.receipt||jsonb_build_object('intent_replayed',true,'semantic_replayed',intent.request_id<>p_request,
   'requested_request_id',p_request,'original_request_id',intent.request_id); end if;
 target:=destruktion_meta.native_coding_project_peer_v1(id,(a#>>'{task,workspace_id}')::uuid,p_recipient_agent);
 if target is null then raise exception 'native_agent_recipient_not_unique' using errcode='55000'; end if;
 event_seq:=destruktion_meta.project_append_h205f22(id,'NATIVE_AGENT_MESSAGE',(a#>>'{task,task_id}')::uuid,(a#>>'{task,lease_generation}')::bigint,
   a#>>'{task,lease_agent_id}',null,'agent_send_message',null,
   body||jsonb_build_object('request_id',p_request,'sender_run_id',p_run,'recipient_task_id',target),
   'UNTRUSTED_NATIVE_AGENT_MESSAGE',null,false,'native-message:'||p_run||':'||p_request);
 select to_jsonb(e) into event from destruktion_meta.project_event_h205f22 e where project_id=id and e.seq=event_seq;
 if octet_length(event::text)>8192 then raise exception 'native_agent_message_event_byte_budget_exceeded'; end if;
 response:=jsonb_build_object('schema','metaengine.native-coding.agent-message.v1','project_id',id,'request_id',p_request,'seq',event_seq,
   'sender_agent_id',a#>>'{task,lease_agent_id}','target_agent_id',p_recipient_agent,'recipient_task_id',target,
   'stored',true,'read_by_recipient_proven',false,'intent_replayed',false,'automatic_retry_allowed',false,'authority_effect',false);
 update destruktion_meta.native_coding_agent_intent_h205f22 set receipt=response,updated_at=clock_timestamp() where run_id=p_run and request_id=p_request;
 return response;
end $$;
