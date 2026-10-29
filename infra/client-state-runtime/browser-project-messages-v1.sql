-- Addressed chat-to-project messages use the existing device, current parent
-- claim, peer resolver and committed event stream. Stored is not read/acted on.
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p
 from pg_proc f join pg_language l on l.oid=f.prolang
 where f.oid=to_regprocedure('public.h205f22_project_message_v1(uuid,uuid,uuid,bigint,bigint,uuid,text,text,uuid,text,bigint)');
 if p.prosrc is null then return;end if;
 if p.lanname<>'plpgsql' or p.prosecdef is distinct from true or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex')<>'2c458f0da4b1b5e82c59849e16adbcec53891822d6b0ba4eb9b29c22c7610832'
 then raise exception 'PROJECT_MESSAGE_BODY_REQUIRES_REVIEW' using errcode='55000';end if;
end $review$;
create or replace function public.h205f22_project_message_v1(p_workspace_id uuid,p_project_id uuid,p_task_id uuid,
 p_claim_id bigint,p_lease_generation bigint,p_request_id uuid,p_recipient_agent text,p_text text,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare auth jsonb; target uuid; n bigint; previous destruktion_meta.project_event_h205f22; replay boolean:=false; event_key text;
begin
 if p_request_id is null or coalesce(p_recipient_agent,'') !~ '^agent_[a-z0-9-]{8,64}$'
  or p_text is null or length(btrim(p_text))=0 or octet_length(p_text)>4096
 then raise exception 'PROJECT_MESSAGE_REQUEST_INVALID' using errcode='22023';end if;
 auth:=destruktion_meta.project_parent_h205f22(p_workspace_id,p_project_id,p_task_id,p_claim_id,p_lease_generation,p_device_id,p_client_id,p_admin_grant_epoch);
 -- Same task -> project lock order as the parent/spawn reconciliation path.
 perform 1 from destruktion_meta.project_run_h205f22 where project_id=p_project_id and state='ACTIVE' for update;
 if not found then raise exception 'PROJECT_PARENT_SCOPE_DENIED' using errcode='42501';end if;
 event_key:='browser-message:'||p_task_id||':'||p_request_id;
 select * into previous from destruktion_meta.project_event_h205f22 where project_id=p_project_id and idempotency_key=event_key;
 if found then
  if previous.event_type<>'BROWSER_AGENT_MESSAGE' or previous.task_id<>p_task_id or previous.attempt<>p_lease_generation
   or previous.actor is distinct from auth#>>'{claim,agent_id}' or previous.source<>'UNTRUSTED_BROWSER_AGENT_MESSAGE'
   or previous.content->>'target_agent_id' is distinct from p_recipient_agent or previous.content->>'message' is distinct from p_text
   or previous.content->>'request_id' is distinct from p_request_id::text
  then raise exception 'PROJECT_MESSAGE_REQUEST_COLLISION' using errcode='23505';end if;
  target:=(previous.content->>'recipient_task_id')::uuid;n:=previous.seq;replay:=true;
 else
  target:=destruktion_meta.native_coding_project_peer_v1(p_project_id,p_workspace_id,p_recipient_agent);
  if target is null then raise exception 'PROJECT_MESSAGE_RECIPIENT_NOT_UNIQUE' using errcode='55000';end if;
  n:=destruktion_meta.project_append_h205f22(p_project_id,'BROWSER_AGENT_MESSAGE',p_task_id,p_lease_generation,
    auth#>>'{claim,agent_id}',null,'PROJECT_MESSAGE',null,
    jsonb_build_object('target_agent_id',p_recipient_agent,'message',p_text,'request_id',p_request_id,'recipient_task_id',target),
    'UNTRUSTED_BROWSER_AGENT_MESSAGE',null,false,event_key);
 end if;
 return jsonb_build_object('schema','metaengine.devos.project-message.v1','project_id',p_project_id,'request_id',p_request_id,
  'sender_task_id',p_task_id,'recipient_task_id',target,'recipient_agent_id',p_recipient_agent,'seq',n,'stored',true,'replayed',replay,
  'read_by_recipient_proven',false,'automatic_retry_allowed',false,'authority_effect',false);
end $$;
revoke all on function public.h205f22_project_message_v1(uuid,uuid,uuid,bigint,bigint,uuid,text,text,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.h205f22_project_message_v1(uuid,uuid,uuid,bigint,bigint,uuid,text,text,uuid,text,bigint) to service_role;
