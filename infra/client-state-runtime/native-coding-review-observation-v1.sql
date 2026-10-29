-- Additive local upgrade: report bound native CRITIC rejections without releasing custody.
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('destruktion_meta.native_coding_review_rejection_v1(uuid,uuid)');
 if p.prosrc is null then return;end if;
 if p.prosrc is null or p.lanname<>'sql' or p.prosecdef is distinct from true or p.provolatile<>'s'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('49a57c236580ab528ab978b61f495b336b3e2b2086bfded08dbb6426a6e783a0')
 then raise exception 'native_review_native_coding_review_rejection_v1_requires_review' using errcode='55000';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('public.h205f22_project_snapshot_v1(uuid,uuid,uuid,bigint,integer,uuid,text,bigint)');

 if p.prosrc is null or p.lanname<>'plpgsql' or p.prosecdef is distinct from true or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta, pg_temp']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('bdbb0c2c3cf3e1a17d6d6eec1d261aa505bcc48cb1695e6294c5cea44374cad1','f13408a7cc4598b54048ddb732e10e38cde2e65cb99bb23de5ff695102fe8427')
 then raise exception 'native_review_h205f22_project_snapshot_v1_requires_review' using errcode='55000';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('destruktion_meta.browser_parent_suspension_projection_v1(uuid)');

 if p.prosrc is null or p.lanname<>'plpgsql' or p.prosecdef is distinct from true or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('1066fabc38868ce5502f37f660d90e9273c55cbbaec58a799e5f9dabc5d55f37','794ff6dc42a594888bf83bdad385692a6629be76c4d4bf0b098105b5393ef208','429d2c62ac3d0bc9115563ee3dad54ed1caf0d17b7b7ecf777767332f0c35807')
 then raise exception 'native_review_browser_parent_suspension_projection_v1_requires_review' using errcode='55000';end if;
end $review$;
create or replace function destruktion_meta.native_coding_review_rejection_v1(p_project uuid,p_task uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,destruktion_meta as $$
 with recursive lineage(task_id) as (
  select task_id from destruktion_meta.project_task_h205f22 where project_id=p_project and task_id=p_task
  union select child.task_id from destruktion_meta.project_task_h205f22 child join lineage parent on child.parent_task_id=parent.task_id where child.project_id=p_project
 )
 select jsonb_build_object('schema','metaengine.native-coding.review-rejection.v1','project_id',p_project,'verdict','REJECT',
   'automatic_retry_allowed',false,'authority_effect',false,'writer_task_id',w.task_id,'writer_lease_generation',w.lease_generation,
   'critic_task_id',c.task_id,'critic_lease_generation',c.lease_generation,'result_sha256',wj.result_receipt->>'result_sha256')
 from destruktion_meta.project_run_h205f22 r
 join destruktion_meta.project_task_h205f22 wp on wp.project_id=r.project_id
 join destruktion_meta.devos_fleet_task_h205f22 w on w.task_id=wp.task_id
 join destruktion_meta.native_coding_job_registration_h205f22 wj on wj.task_id=w.task_id and wj.lease_generation=w.lease_generation
 join destruktion_meta.native_coding_worktree_fence_h205f22 f on f.writer_task_id=w.task_id and f.writer_lease_generation=w.lease_generation and f.state='HELD'
 join destruktion_meta.project_task_h205f22 cp on cp.project_id=r.project_id and cp.parent_task_id=w.task_id
 join destruktion_meta.devos_fleet_task_h205f22 c on c.task_id=cp.task_id
 join destruktion_meta.native_coding_job_registration_h205f22 cj on cj.task_id=c.task_id and cj.lease_generation=c.lease_generation
 where r.project_id=p_project and r.state in ('ACTIVE','PAUSED') and wp.task_id in(select task_id from lineage) and w.role='IMPLEMENTER' and c.role='CRITIC'
 and w.state='RESULT_READY' and c.state='RESULT_READY'
 and destruktion_meta.native_coding_project_result_bound_v1(w.task_id) and destruktion_meta.native_coding_project_result_bound_v1(c.task_id)
 and wj.result_receipt#>>'{result,outcome}'='DONE' and cj.result_receipt#>>'{result,outcome}'='DONE' and cj.result_receipt#>>'{result,verdict}'='REJECT'
 and cj.result_receipt->>'agent_id'<>wj.result_receipt->>'agent_id'
 and cj.job_envelope#>>'{payload,worker_process,process_incarnation_id}'<>wj.job_envelope#>>'{payload,worker_process,process_incarnation_id}'
 and c.task_spec#>'{native_coding,verification_subject}'=jsonb_build_object('run_id',wj.run_id,'result_sha256',wj.result_receipt->>'result_sha256',
   'git_artifact_sha256',wj.result_receipt#>>'{git_after,artifact_sha256}','source_head',wj.result_receipt#>>'{git_after,head}')
 and cj.result_receipt->>'subject_run_id'=wj.run_id::text and cj.result_receipt->>'subject_result_sha256'=wj.result_receipt->>'result_sha256'
 and cj.result_receipt#>>'{result,subject_result_sha256}'=wj.result_receipt->>'result_sha256'
 and cj.result_receipt->>'subject_git_artifact_sha256'=wj.result_receipt#>>'{git_after,artifact_sha256}'
 and cj.result_receipt->>'subject_source_head'=wj.result_receipt#>>'{git_after,head}'
 and cj.result_receipt#>'{git_before}'->>'artifact_sha256'=wj.result_receipt#>>'{git_after,artifact_sha256}'
 and cj.result_receipt#>'{git_after}'->>'artifact_sha256'=wj.result_receipt#>>'{git_after,artifact_sha256}'
 and cj.result_receipt#>>'{git_before,head}'=wj.result_receipt#>>'{git_after,head}' and cj.result_receipt#>>'{git_after,head}'=wj.result_receipt#>>'{git_after,head}'
 and not exists(select 1 from destruktion_meta.native_coding_checkpoint_h205f22 k where k.writer_task_id=w.task_id and k.writer_lease_generation=w.lease_generation)
 order by wp.task_seq,w.task_id,c.task_id limit 1
$$;
revoke all on function destruktion_meta.native_coding_review_rejection_v1(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function public.h205f22_project_snapshot_v1(p_workspace_id uuid,p_project_id uuid,p_task_id uuid,p_task_after_seq bigint,p_limit integer,
  p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,pg_temp as $$
declare r destruktion_meta.project_run_h205f22%rowtype; id uuid:=p_project_id; rows jsonb; proposals jsonb; n bigint; children jsonb; selected uuid; computed_state text; pending bigint;review_rejection jsonb;
begin
  perform destruktion_meta.project_device_grant_h205f22(p_device_id,p_client_id,p_admin_grant_epoch);
  if (p_project_id is null)=(p_task_id is null) or p_limit is null or p_limit not between 1 and 128 or coalesce(p_task_after_seq,-1)<0 then raise exception 'PROJECT_SNAPSHOT_REQUEST_INVALID' using errcode='22023'; end if;
  if id is null then
    select x.project_id into id from destruktion_meta.project_task_h205f22 x join destruktion_meta.devos_fleet_task_h205f22 t using(task_id) where x.task_id=p_task_id and t.workspace_id=p_workspace_id;
    if not found then return jsonb_build_object('schema','metaengine.devos.project-snapshot.v1','found',false,'task_id',p_task_id,'automatic_retry_allowed',false,'authority_effect',false); end if;
  end if;
  r:=destruktion_meta.project_authorize_h205f22(p_workspace_id,id,p_device_id,p_client_id,p_admin_grant_epoch);
  selected:=coalesce(p_task_id,r.root_task_id);
  select coalesce(jsonb_agg(v.row order by v.task_seq),'[]'),coalesce(max(v.task_seq),p_task_after_seq) into rows,n from (
    select x.task_seq,jsonb_build_object('task_seq',x.task_seq,'task_id',x.task_id,'root_task_id',x.root_task_id,'parent_task_id',x.parent_task_id,'depth',x.depth,
      'state',t.state,'role',t.role,'claim_class',t.claim_class,'base_sha',t.base_sha,'branch_name',t.branch_name,'point_id',t.point_id,
      'coordination_workspace_id',t.workspace_id,'claim_id',c.claim_id,'lease_generation',t.lease_generation,'agent_id',t.lease_agent_id,
      'lease_expires_at',t.lease_expires_at,'objective',left(t.task_spec->>'objective',4000),'task_spec_sha256',t.task_spec_sha256,
      'project_continuity',jsonb_build_object('schema','metaengine.devos.project-task.v1','project_id',id,'root_task_id',x.root_task_id,'parent_task_id',x.parent_task_id,'depth',x.depth,'root_request_id',r.request_id)) as row
    from destruktion_meta.project_task_h205f22 x join destruktion_meta.devos_fleet_task_h205f22 t using(task_id)
    left join lateral (select claim_id from destruktion_meta.devos_fleet_claim_h205f22 where task_id=t.task_id and lease_generation=t.lease_generation and state='ACTIVE' and expires_at>clock_timestamp() order by claim_id desc limit 1) c on true
    where x.project_id=id and x.task_seq>p_task_after_seq order by x.task_seq limit p_limit) v;
  select coalesce(jsonb_agg(to_jsonb(v) order by v.created_at,v.request_id,v.child_index),'[]') into proposals from (
    select request_id,child_index,parent_task_id,depth,role,objective,child_task_id,status,wait_reason,created_at
    from destruktion_meta.project_child_proposal_h205f22 where project_id=id and parent_task_id=selected order by created_at desc,request_id,child_index limit 128) v;
  select coalesce(jsonb_agg(v.row order by v.task_seq),'[]') into children from (select x.task_seq,destruktion_meta.project_task_projection_h205f22(id,x.task_id) as row from destruktion_meta.project_task_h205f22 x where x.project_id=id and x.parent_task_id=selected order by task_seq limit 128) v;
  select count(*) into pending from destruktion_meta.project_child_proposal_h205f22 where project_id=id and child_task_id is null;
  review_rejection:=destruktion_meta.native_coding_review_rejection_v1(id,selected);
  computed_state:=case when review_rejection is not null then 'BLOCKED' when exists(select 1 from destruktion_meta.project_task_h205f22 x join destruktion_meta.devos_fleet_task_h205f22 t using(task_id) where x.project_id=id and t.state in ('FAILED','BLOCKED','AMBIGUOUS','FENCED')) then 'BLOCKED'
    when pending=0 and not exists(select 1 from destruktion_meta.project_task_h205f22 x join destruktion_meta.devos_fleet_task_h205f22 t using(task_id) where x.project_id=id and t.state<>'COMPLETED') and destruktion_meta.project_completion_ready_h205f22(r.root_task_id) is true then 'COMPLETED'
    when pending>0 or exists(select 1 from destruktion_meta.project_task_h205f22 x join destruktion_meta.devos_fleet_task_h205f22 t using(task_id) where x.project_id=id and x.parent_task_id is not null and t.state<>'COMPLETED') then 'WAITING_CHILDREN' else 'ACTIVE' end;
  return jsonb_build_object('schema','metaengine.devos.project-snapshot.v1','found',true,'project_id',id,'coordination_workspace_id',r.workspace_id,'request_id',r.request_id,'root_task_id',r.root_task_id,
    'state',computed_state,'goal',r.goal,'last_seq',r.last_seq,'total_tasks',r.total_tasks,'policy',jsonb_build_object('generation',r.policy_generation,'max_depth',r.max_depth,'max_tasks',r.max_tasks,'max_children',r.max_children),
    'selected_task',destruktion_meta.project_task_projection_h205f22(id,selected),'immediate_children',children,'children_truncated',(select count(*)>128 from destruktion_meta.project_task_h205f22 where project_id=id and parent_task_id=selected),
    'proposals_truncated',(select count(*)>128 from destruktion_meta.project_child_proposal_h205f22 where project_id=id and parent_task_id=selected),'pending_proposals',pending,
    'native_review_rejection',review_rejection,'tasks',rows,'proposals',proposals,'task_cursor',jsonb_build_object('after_seq',p_task_after_seq,'next_seq',n,'has_more',n<r.total_tasks),
    'filesystem_paths_exposed',false,'automatic_retry_allowed',false,'scheduler_authority',false,'authority_effect',false);
end $$;
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
