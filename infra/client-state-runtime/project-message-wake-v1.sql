-- Reviewed message-driven parent wake, under existing suspension and claim authority.
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('destruktion_meta.project_pending_message_seqs_v1(uuid,uuid,text)');
 if p.prosrc is null then return;end if;
 if p.lanname<>'sql' or p.prosecdef is distinct from true or p.provolatile<>'s'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in ('ef33a3217a0e955657639d5faf9303d82a3b1f06036109d6a277f6cbc651727d')
 then raise exception 'PROJECT_MESSAGE_WAKE_BODY_REQUIRES_REVIEW';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('destruktion_meta.project_task_projection_h205f22(uuid,uuid)');
 if p.prosrc is null then raise exception 'PROJECT_MESSAGE_WAKE_PREDECESSOR_MISSING';end if;
 if p.lanname<>'sql' or p.prosecdef is distinct from true or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, destruktion_meta, pg_temp']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in ('2d38e3d3b8fdf3dc371d4bd37be4de8ecd9246aed6a77081cb2eb97e17f9d1c7','2b6b33193fb9f38e5227c376a71ae64e5e186fc8ae86b12b53540f3c932007bb','79990f7019da3cbf6639e567c87650a5d20bd69d9bd471a33a536843e4a6c1a9')
 then raise exception 'PROJECT_MESSAGE_WAKE_BODY_REQUIRES_REVIEW';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('destruktion_meta.browser_parent_suspension_projection_v1(uuid)');
 if p.prosrc is null then raise exception 'PROJECT_MESSAGE_WAKE_PREDECESSOR_MISSING';end if;
 if p.lanname<>'plpgsql' or p.prosecdef is distinct from true or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in ('794ff6dc42a594888bf83bdad385692a6629be76c4d4bf0b098105b5393ef208','1066fabc38868ce5502f37f660d90e9273c55cbbaec58a799e5f9dabc5d55f37','3b19104d465f5a2c160b00b6458691608c9ba4c65db80525747ec53655d153f5')
 then raise exception 'PROJECT_MESSAGE_WAKE_BODY_REQUIRES_REVIEW';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('public.h205f22_project_resume_browser_v1(uuid,uuid,jsonb,uuid,text,bigint)');
 if p.prosrc is null then raise exception 'PROJECT_MESSAGE_WAKE_PREDECESSOR_MISSING';end if;
 if p.lanname<>'plpgsql' or p.prosecdef is distinct from true or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in ('4f04bbeb696a3d2fb922d7bc107b5a330c16b19390095cfea34c80e8efbdba48','19a93462a7f686f06ec8f9d6a79239a723329328ce52b18f97559dc558a6aa28')
 then raise exception 'PROJECT_MESSAGE_WAKE_BODY_REQUIRES_REVIEW';end if;
end $review$;
create index if not exists project_message_recipient_v1_idx on destruktion_meta.project_event_h205f22(project_id,(content->>'recipient_task_id'),seq);
do $index$
declare i record;
begin
 select x.*,pg_get_expr(x.indexprs,x.indrelid) as expression,a.amname into i from pg_index x
 join pg_class c on c.oid=x.indexrelid join pg_am a on a.oid=c.relam
 where x.indexrelid=to_regclass('destruktion_meta.project_message_recipient_v1_idx');
 if i.indexrelid is null or i.indrelid<>'destruktion_meta.project_event_h205f22'::regclass or not i.indisvalid or not i.indisready
   or i.indisunique or i.indnatts<>3 or i.indkey::text<>'1 0 2' or i.indpred is not null or i.amname<>'btree'
   or i.expression is distinct from '(content ->> ''recipient_task_id''::text)'
 then raise exception 'PROJECT_MESSAGE_WAKE_INDEX_REQUIRES_REVIEW';end if;
end $index$;
create or replace function destruktion_meta.project_pending_message_seqs_v1(p_project uuid,p_task uuid,p_agent text)
returns jsonb language sql stable security definer set search_path=pg_catalog,destruktion_meta as $$
 select coalesce(jsonb_agg(m.seq order by m.seq),'[]'::jsonb) from (
  select e.seq from destruktion_meta.project_event_h205f22 e
  where e.project_id=p_project and e.content->>'recipient_task_id'=p_task::text and e.content->>'target_agent_id'=p_agent
   and ((e.event_type='NATIVE_AGENT_MESSAGE' and e.source='UNTRUSTED_NATIVE_AGENT_MESSAGE')
    or (e.event_type='BROWSER_AGENT_MESSAGE' and e.source='UNTRUSTED_BROWSER_AGENT_MESSAGE'))
   and exists(select 1 from destruktion_meta.project_task_h205f22 t where t.project_id=p_project and t.task_id=p_task)
   and not exists(select 1 from destruktion_meta.project_event_h205f22 ack where ack.project_id=e.project_id
     and ack.idempotency_key='message-ack:'||e.seq||':'||p_task and ack.event_type='PROJECT_MESSAGE_ACKNOWLEDGED'
     and ack.source='AUTHENTICATED_RECIPIENT_ACK' and ack.task_id=p_task and ack.actor=p_agent
     and ack.content->>'message_seq'=e.seq::text)
  order by e.seq limit 16
 )m
$$;
revoke all on function destruktion_meta.project_pending_message_seqs_v1(uuid,uuid,text) from public,anon,authenticated,service_role;
create or replace function destruktion_meta.project_task_projection_h205f22(p_project uuid,p_task uuid)
returns jsonb language sql security definer set search_path=pg_catalog,destruktion_meta,pg_temp as $$
  select jsonb_build_object('task_seq',x.task_seq,'task_id',x.task_id,'root_task_id',x.root_task_id,'parent_task_id',x.parent_task_id,'depth',x.depth,
    'state',t.state,'role',t.role,'claim_class',t.claim_class,'base_sha',t.base_sha,'branch_name',t.branch_name,'point_id',t.point_id,
    'coordination_workspace_id',t.workspace_id,'claim_id',c.claim_id,'lease_generation',t.lease_generation,'agent_id',t.lease_agent_id,
    'tab_id',t.lease_tab_id,'target_id',t.lease_target_id,'agent_generation_epoch',t.lease_agent_generation_epoch,'lease_expires_at',t.lease_expires_at,
    'active_claim_count',(select count(*) from destruktion_meta.devos_fleet_claim_h205f22 held where held.task_id=t.task_id and held.state='ACTIVE'),
    'active_workspace_binding_count',(select count(*) from public.compute_fabric_a2_workspace_binding_h205f22 held where held.task_id=t.task_id and held.retired_at is null),
    'objective',left(t.task_spec->>'objective',4000),'task_spec_sha256',t.task_spec_sha256,
    'project_continuity',jsonb_build_object('schema','metaengine.devos.project-task.v1','project_id',p_project,'root_task_id',x.root_task_id,'parent_task_id',x.parent_task_id,'depth',x.depth,'root_request_id',r.request_id),
    'pending_message_seqs',destruktion_meta.project_pending_message_seqs_v1(p_project,p_task,t.lease_agent_id),
    'open_children',(select count(*) from destruktion_meta.project_task_h205f22 y join destruktion_meta.devos_fleet_task_h205f22 z using(task_id) where y.project_id=p_project and y.parent_task_id=t.task_id and z.state<>'COMPLETED'),
    'blocking_children',(select count(*) from destruktion_meta.project_task_h205f22 y join destruktion_meta.devos_fleet_task_h205f22 z using(task_id) where y.project_id=p_project and y.parent_task_id=t.task_id and z.state in ('FAILED','BLOCKED','AMBIGUOUS','FENCED')),
    'pending_proposals',(select count(*) from destruktion_meta.project_child_proposal_h205f22 y where y.project_id=p_project and y.parent_task_id=t.task_id and y.child_task_id is null))
  from destruktion_meta.project_task_h205f22 x join destruktion_meta.devos_fleet_task_h205f22 t using(task_id) join destruktion_meta.project_run_h205f22 r using(project_id)
  left join lateral (select claim_id from destruktion_meta.devos_fleet_claim_h205f22 where task_id=t.task_id and lease_generation=t.lease_generation and state='ACTIVE' and expires_at>clock_timestamp() order by claim_id desc limit 1) c on true
  where x.project_id=p_project and x.task_id=p_task
$$;
create or replace function destruktion_meta.browser_parent_suspension_projection_v1(p_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare s destruktion_meta.browser_parent_suspension_h205f22; control jsonb; projected text;
begin
  select * into s from destruktion_meta.browser_parent_suspension_h205f22 where suspension_id=p_id;
  if not found then return jsonb_build_object('schema','metaengine.devos.browser-parent-suspension.v1','found',false,'automatic_retry_allowed',false,'authority_effect',false); end if;
  control:=public.devos_environment_state_v1(s.workspace_id);
  projected:=case
    when s.status='RESUMED' then 'RESUMED'
    when control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb
      or control->'owner_stop'='true'::jsonb or control->>'state'='STOPPED' then 'OWNER_STOPPED'
    when control->>'generation_floor' is distinct from s.checkpoint->>'control_generation' then 'GENERATION_FENCED'
    when destruktion_meta.native_coding_review_rejection_v1(s.project_id,s.task_id) is not null then 'BLOCKED_CHILDREN'
    when exists(select 1 from destruktion_meta.project_task_h205f22 pt join destruktion_meta.devos_fleet_task_h205f22 t using(task_id)
      where pt.project_id=s.project_id and pt.parent_task_id=s.task_id and t.state in ('FAILED','BLOCKED','AMBIGUOUS','FENCED')) then 'BLOCKED_CHILDREN'
    when jsonb_array_length(destruktion_meta.project_pending_message_seqs_v1(s.project_id,s.task_id,s.checkpoint->>'agent_id'))>0 then 'READY_FOR_MESSAGE'
    when exists(select 1 from destruktion_meta.project_task_h205f22 pt join destruktion_meta.devos_fleet_task_h205f22 t using(task_id)
      where pt.project_id=s.project_id and pt.parent_task_id=s.task_id and t.state<>'COMPLETED')
      or exists(select 1 from destruktion_meta.project_child_proposal_h205f22 where project_id=s.project_id and parent_task_id=s.task_id and child_task_id is null)
      then 'WAITING_CHILDREN'
    else 'READY_TO_RESUME' end;
  return jsonb_build_object('schema','metaengine.devos.browser-parent-suspension.v1','found',true,
    'suspension_id',s.suspension_id,'seq',s.seq,'project_id',s.project_id,'workspace_id',s.workspace_id,'task_id',s.task_id,
    'old_claim_id',s.old_claim_id,'old_lease_generation',s.old_lease_generation,'checkpoint',s.checkpoint,
    'checkpoint_sha256',s.checkpoint_sha256,'awaited_children',s.awaited_children,'status',s.status,'state',projected,
    'lease',s.resumed_lease,'automatic_retry_allowed',false,'authority_effect',false);
end $$;
create or replace function public.h205f22_project_resume_browser_v1(p_workspace_id uuid,p_suspension_id uuid,p_restoration jsonb,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare s destruktion_meta.browser_parent_suspension_h205f22; r destruktion_meta.project_run_h205f22;
  t destruktion_meta.devos_fleet_task_h205f22; control jsonb; claimid bigint; lease jsonb; observed jsonb; agent jsonb; auth jsonb;
begin
  select * into s from destruktion_meta.browser_parent_suspension_h205f22 where suspension_id=p_suspension_id and workspace_id=p_workspace_id;
  if not found then raise exception 'BROWSER_RESUME_SUSPENSION_MISSING'; end if;
  r:=destruktion_meta.project_authorize_h205f22(p_workspace_id,s.project_id,p_device_id,p_client_id,p_admin_grant_epoch);
  perform pg_advisory_xact_lock(hashtextextended('browser-agent:'||p_workspace_id||':'||lower(s.checkpoint->>'agent_id'),0));
  perform pg_advisory_xact_lock(hashtextextended('browser-parent:'||s.task_id,0));
  select * into s from destruktion_meta.browser_parent_suspension_h205f22 where suspension_id=p_suspension_id for update;
  insert into destruktion_meta.devos_fleet_runtime_control_h205f22(workspace_id) values(p_workspace_id) on conflict do nothing;
  perform 1 from destruktion_meta.devos_fleet_runtime_control_h205f22 where workspace_id=p_workspace_id for share;
  select * into r from destruktion_meta.project_run_h205f22 where project_id=s.project_id for share;
  control:=public.devos_environment_state_v1(p_workspace_id);
  if r.state is distinct from 'ACTIVE' or control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb
    or control->'owner_stop'='true'::jsonb or control->>'state'='STOPPED' or control->>'generation_floor' is distinct from s.checkpoint->>'control_generation'
    then raise exception 'BROWSER_RESUME_OWNER_FENCED'; end if;
  if s.status='RESUMED' then
    if not exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 task
      join destruktion_meta.devos_fleet_claim_h205f22 claim on claim.task_id=task.task_id and claim.claim_id=(s.resumed_lease->>'claim_id')::bigint
      where task.task_id=s.task_id and task.state='RUNNING' and task.lease_generation=(s.resumed_lease->>'lease_generation')::bigint
      and claim.state='ACTIVE' and claim.lease_generation=task.lease_generation and claim.expires_at>clock_timestamp())
      then raise exception 'BROWSER_RESUME_RECEIPT_STALE'; end if;
    if s.restoration is distinct from p_restoration then raise exception 'BROWSER_RESUME_COLLISION' using errcode='23505'; end if;
    return destruktion_meta.browser_parent_suspension_projection_v1(s.suspension_id)||jsonb_build_object('replayed',true);
  end if;
  perform 1 from destruktion_meta.project_task_h205f22 pt join destruktion_meta.devos_fleet_task_h205f22 child using(task_id)
    where pt.project_id=s.project_id and pt.parent_task_id=s.task_id for share of child;
  if coalesce((destruktion_meta.browser_parent_suspension_projection_v1(s.suspension_id)->>'state') in ('READY_TO_RESUME','READY_FOR_MESSAGE'),false) is distinct from true
    then raise exception 'BROWSER_RESUME_DEPENDENCIES_PENDING'; end if;
  select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=s.task_id and workspace_id=p_workspace_id for update;
  if not found or t.state is distinct from 'SUSPENDED' or t.lease_generation is distinct from s.old_lease_generation
    or t.claim_class is distinct from 'READ_ONLY' or t.task_spec ? 'native_coding'
    or exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 where task_id=t.task_id and state='ACTIVE')
    or exists(select 1 from public.compute_fabric_a2_workspace_binding_h205f22 where task_id=t.task_id and retired_at is null)
    then raise exception 'BROWSER_RESUME_TASK_FENCED'; end if;
  if coalesce(jsonb_typeof(p_restoration) is distinct from 'object'
    or p_restoration->>'schema' is distinct from 'metaengine.devos.browser-parent-restoration.v1'
    or not(p_restoration ?& array['schema','checkpoint_sha256','conversation_url','conversation_url_sha256','transcript_floor','transcript_total_chars',
      'transcript_sha256','agent_surface_sha256','observed_at','agent_id','tab_id','target_id','agent_generation_epoch','control_generation'])
    or (select count(*) from jsonb_object_keys(p_restoration))<>14
    or p_restoration->>'checkpoint_sha256' is distinct from s.checkpoint_sha256
    or p_restoration->>'agent_id' is distinct from s.checkpoint->>'agent_id'
    or p_restoration->>'conversation_url' is distinct from s.checkpoint->>'conversation_url'
    or p_restoration->>'conversation_url_sha256' is distinct from s.checkpoint->>'conversation_url_sha256'
    or p_restoration->'transcript_floor' is distinct from s.checkpoint->'transcript_floor'
    or p_restoration->'transcript_total_chars' is distinct from s.checkpoint->'transcript_total_chars'
    or p_restoration->>'agent_surface_sha256' is distinct from s.checkpoint->>'agent_surface_sha256'
    or p_restoration->>'transcript_sha256' is distinct from s.checkpoint->>'transcript_sha256'
    or p_restoration->>'control_generation' is distinct from control->>'generation_floor'
    or p_restoration->>'tab_id' !~ '^tab_[0-9a-f-]{36}$' or p_restoration->>'target_id' !~ '^webcontents:[1-9][0-9]*$'
    or (p_restoration->>'agent_generation_epoch')::bigint<=(s.checkpoint->>'agent_generation_epoch')::bigint
    or (p_restoration->>'observed_at')::timestamptz not between clock_timestamp()-interval '30 seconds' and clock_timestamp()+interval '5 seconds',true)
    then raise exception 'BROWSER_RESUME_RESTORATION_INVALID'; end if;
  -- Same logical identity may have no other active W30 claim. Retained UNKNOWN
  -- work is not made idle merely by checkpointing another task.
  if exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 where workspace_id=p_workspace_id
    and agent_id=t.lease_agent_id and state='ACTIVE') then raise exception 'BROWSER_RESUME_AGENT_BUSY'; end if;
  if destruktion_meta.browser_parent_reservation_v1(p_workspace_id,t.lease_agent_id) is distinct from
    jsonb_build_object('schema','metaengine.browser.parent-restoration-reservation.v1','suspension_id',s.suspension_id,'task_id',s.task_id,
      'checkpoint_sha256',s.checkpoint_sha256,'authority_effect',false,'automatic_retry_allowed',false)
    then raise exception 'BROWSER_RESUME_RESERVATION_REQUIRED'; end if;
  -- INSERT still executes the existing browser claim-admission trigger against
  -- the fresh signed fleet snapshot; this is not a transport admission bypass.
  update destruktion_meta.devos_fleet_task_h205f22 set state='LEASED',lease_generation=lease_generation+1,
    lease_tab_id=p_restoration->>'tab_id',lease_target_id=p_restoration->>'target_id',
    lease_agent_generation_epoch=(p_restoration->>'agent_generation_epoch')::bigint,
    lease_expires_at=clock_timestamp()+interval '900 seconds',updated_at=clock_timestamp()
    where task_id=s.task_id returning * into t;
  insert into destruktion_meta.devos_fleet_claim_h205f22(task_id,workspace_id,point_id,base_sha,role,claim_class,agent_id,tab_id,target_id,agent_generation_epoch,lease_generation,expires_at)
    values(t.task_id,t.workspace_id,t.point_id,t.base_sha,t.role,t.claim_class,t.lease_agent_id,t.lease_tab_id,t.lease_target_id,t.lease_agent_generation_epoch,t.lease_generation,t.lease_expires_at)
    returning claim_id into claimid;
  auth:=destruktion_meta.project_parent_h205f22(p_workspace_id,s.project_id,t.task_id,claimid,t.lease_generation,p_device_id,p_client_id,p_admin_grant_epoch);
  select destruktion_meta.devos_normalize_native_supervisor_state_h205f22(state) into observed
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 where workspace_id=p_workspace_id and client_id=p_client_id;
  select value into agent from jsonb_array_elements(observed#>'{fleet,agents}') where value->>'agent_id'=t.lease_agent_id;
  if agent#>>'{transport_proof,conversation_url_sha256}' is distinct from s.checkpoint->>'conversation_url_sha256'
    or agent#>>'{transport_proof,agent_surface_sha256}' is distinct from s.checkpoint->>'agent_surface_sha256'
    then raise exception 'BROWSER_RESUME_CONVERSATION_FENCED'; end if;
  update destruktion_meta.devos_fleet_task_h205f22 set state='RUNNING' where task_id=t.task_id;
  perform destruktion_meta.devos_emit_event_h205f22(t.workspace_id,'TASK_TRANSPORT_PROVEN',t.task_id,t.point_id,t.role,t.lease_agent_id,t.lease_generation,t.base_sha,
    jsonb_build_object('conversation_url_sha256',s.checkpoint->>'conversation_url_sha256','agent_surface_sha256',agent#>>'{transport_proof,agent_surface_sha256}',
      'effect_state','RESTORED_WITHOUT_SEND','suspension_id',s.suspension_id,'checkpoint_sha256',s.checkpoint_sha256,'physical_send_replayed',false),
    'browser-resume:'||s.suspension_id);
  lease:=jsonb_build_object('leased',true,'state','RUNNING','task_id',t.task_id,'claim_id',claimid,'point_id',t.point_id,'role',t.role,
    'claim_class',t.claim_class,'base_sha',t.base_sha,'branch_name',t.branch_name,'task_spec',t.task_spec,'task_spec_sha256',t.task_spec_sha256,
    'lease_generation',t.lease_generation,'lease_expires_at',t.lease_expires_at,'agent_id',t.lease_agent_id,'tab_id',t.lease_tab_id,
    'target_id',t.lease_target_id,'agent_generation_epoch',t.lease_agent_generation_epoch,
    'conversation_url_sha256',s.checkpoint->>'conversation_url_sha256','automatic_retry_allowed',false,'authority_effect',false);
  update destruktion_meta.browser_parent_suspension_h205f22 set status='RESUMED',restoration=p_restoration,resumed_lease=lease,resumed_at=clock_timestamp()
    where suspension_id=s.suspension_id;
  perform destruktion_meta.project_append_h205f22(s.project_id,'BROWSER_PARENT_RESUMED',s.task_id,t.lease_generation,p_client_id,null,null,null,
    jsonb_build_object('suspension_id',s.suspension_id,'checkpoint_sha256',s.checkpoint_sha256,'old_lease_generation',s.old_lease_generation,'physical_send_replayed',false),
    'SIGNED_HOST_OBSERVATION',null,false,'browser-resume:'||s.suspension_id);
  return destruktion_meta.browser_parent_suspension_projection_v1(s.suspension_id)||jsonb_build_object('replayed',false);
end $$;
