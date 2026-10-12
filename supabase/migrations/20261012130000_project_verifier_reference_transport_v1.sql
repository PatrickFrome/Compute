-- Additive verifier reference transport. Existing task/lease authority stays in reconcile_v1.
-- The marker makes local migration admission version-specific even though the original
-- reconcile function already exists. This does not grant new effect authority.
create or replace function public.h205f22_project_reconcile_v1(p_workspace_id uuid,p_project_id uuid,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,pg_temp as $$
declare r destruktion_meta.project_run_h205f22%rowtype; t destruktion_meta.devos_fleet_task_h205f22%rowtype; x destruktion_meta.project_task_h205f22%rowtype;
 required text; roles text[]; spec jsonb; enqueued jsonb; child uuid; promoted integer:=0; admitted integer:=0; target uuid; outcomes jsonb:='[]';
begin
 if p_project_id is null then
   perform destruktion_meta.project_device_grant_h205f22(p_device_id,p_client_id,p_admin_grant_epoch);
   for target in select run.project_id from destruktion_meta.project_run_h205f22 run where run.workspace_id=p_workspace_id and run.device_id=p_device_id and run.client_id=p_client_id and run.admin_grant_epoch=p_admin_grant_epoch and run.state='ACTIVE'
     and exists(select 1 from destruktion_meta.project_task_h205f22 link join destruktion_meta.devos_fleet_task_h205f22 task using(task_id) where link.project_id=run.project_id and task.state='RESULT_READY')
     order by run.last_reconciled_at nulls first,run.created_at,run.project_id limit 4 loop
     outcomes:=outcomes||jsonb_build_array(public.h205f22_project_reconcile_v1(p_workspace_id,target,p_device_id,p_client_id,p_admin_grant_epoch));
   end loop;
   return jsonb_build_object('schema','metaengine.devos.project-reconcile.v1','project_id',null,'projects',outcomes,'bounded_projects',4,'automatic_retry_allowed',false,'scheduler_authority',false,'authority_effect',false);
 end if;
 r:=destruktion_meta.project_authorize_h205f22(p_workspace_id,p_project_id,p_device_id,p_client_id,p_admin_grant_epoch);
 -- Task -> project is the same lock order as DevOS updates/triggers/spawn.
 -- Lock existing rows before the project lock, so no later row acquisition can
 -- deadlock a concurrent completion holding its task and awaiting this project.
 perform task.task_id from destruktion_meta.devos_fleet_task_h205f22 task join destruktion_meta.project_task_h205f22 link using(task_id) where link.project_id=p_project_id order by task.task_id for update of task;
 select * into r from destruktion_meta.project_run_h205f22 where project_id=p_project_id for update;
 update destruktion_meta.project_run_h205f22 set last_reconciled_at=clock_timestamp() where project_id=p_project_id;
 for t in select task.* from destruktion_meta.devos_fleet_task_h205f22 task join destruktion_meta.project_task_h205f22 link using(task_id) where link.project_id=p_project_id and task.state='RESULT_READY' order by link.depth desc,link.task_seq limit 8 loop
   if destruktion_meta.project_completion_ready_h205f22(t.task_id) then
     update destruktion_meta.devos_fleet_task_h205f22 set state='COMPLETED',finished_at=clock_timestamp(),updated_at=clock_timestamp() where task_id=t.task_id; promoted:=promoted+1; continue;
   end if;
   if t.task_spec ? 'verification_subject' or not destruktion_meta.project_result_bound_h205f22(t.task_id,'READY') then continue; end if;
   select * into x from destruktion_meta.project_task_h205f22 where task_id=t.task_id;
   roles:=case when upper(coalesce(t.task_spec->>'risk',t.task_spec#>>'{meta_orchestrator,risk}','NORMAL'))='CRITICAL' then array['CRITIC','FALSIFIER'] else array['CRITIC'] end;
   foreach required in array roles loop
     if exists(select 1 from destruktion_meta.project_task_h205f22 y join destruktion_meta.devos_fleet_task_h205f22 v using(task_id) where y.project_id=p_project_id and y.parent_task_id=t.task_id and v.role=required and v.task_spec->'verification_subject'->>'task_id'=t.task_id::text and v.task_spec->'verification_subject'->>'result_sha256'=t.result_summary->>'result_claim_sha256') then continue; end if;
     -- Verifiers become READY demand for the existing governor, with no lease
     -- allocated here and no model-proposal budget suppressing safety work.
     spec:=jsonb_build_object('schema','metaengine.devos.project-task-spec.v1','claim_class','READ_ONLY','objective',required||' independently verify result for '||t.task_id||': '||left(t.task_spec->>'objective',3500),
       'verification_subject',jsonb_build_object('task_id',t.task_id,'result_sha256',t.result_summary->>'result_claim_sha256',
         'deliverable_refs',coalesce(t.result_summary->'result_claim_deliverable_refs','[]'::jsonb),
         'evidence_refs',coalesce(t.result_summary->'result_claim_evidence_refs','[]'::jsonb)),
       'project_continuity',jsonb_build_object('schema','metaengine.devos.project-task.v1','project_id',p_project_id,'root_task_id',r.root_task_id,'parent_task_id',t.task_id,'depth',x.depth+1,'root_request_id',r.request_id),
       'automatic_retry_allowed',false,'model_output_authority',false,'scheduler_authority',false,'authority_effect',false);
     enqueued:=public.devos_fleet_enqueue_v1(p_workspace_id,'project.verify.'||replace(t.task_id::text,'-','')||'.'||lower(required),required,t.base_sha,spec,'project-verify:'||t.task_id||':'||t.lease_generation||':'||required||':'||(t.result_summary->>'result_claim_sha256'),null,100);
     child:=(enqueued->>'task_id')::uuid;
     update destruktion_meta.project_run_h205f22 set total_tasks=total_tasks+1 where project_id=p_project_id returning * into r;
     insert into destruktion_meta.project_task_h205f22 values(child,p_project_id,r.total_tasks,r.root_task_id,t.task_id,x.depth+1);
     perform destruktion_meta.project_append_h205f22(p_project_id,'VERIFIER_TASK_ADMITTED',child,0,p_client_id,null,null,null,jsonb_build_object('subject_task_id',t.task_id,'subject_result_sha256',t.result_summary->>'result_claim_sha256','role',required),'DATABASE_ADMISSION',null,false,'verify:'||child); admitted:=admitted+1;
   end loop;
 end loop;
 return jsonb_build_object('schema','metaengine.devos.project-reconcile.v1','project_id',p_project_id,'promoted_tasks',promoted,'admitted_verifiers',admitted,'bounded_tasks',8,'automatic_retry_allowed',false,'scheduler_authority',false,'authority_effect',false);
end $$;

create function destruktion_meta.project_verifier_reference_transport_h205f22()
returns boolean language sql security invoker set search_path=pg_catalog,pg_temp as $$ select true $$;
revoke all on function destruktion_meta.project_verifier_reference_transport_h205f22() from public;
