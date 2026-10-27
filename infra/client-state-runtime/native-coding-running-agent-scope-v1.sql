-- Additive local upgrade: active CRITIC authorization is not new-slot admission.
-- Preserve all protected witness, scope and exact independent-writer checks.
-- Historical migrations and fresh-claim capacity gates remain unchanged.
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
  where f.oid=to_regprocedure('destruktion_meta.native_coding_agent_context_v1(uuid)');

 if p.prosrc is null or p.lanname<>'plpgsql' or p.prosecdef is distinct from false or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('bf3797803ec6bd017b90b3949c68a049a1f0a9cb5a8bb914b1f709c3b5065f41','0e3f7e55354e8eb42cbe4f801cd2e77fe5f918485d4c6d565f1f15fd7124787d')
 then raise exception 'native_running_agent_native_coding_agent_context_v1_requires_review' using errcode='55000';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
  where f.oid=to_regprocedure('destruktion_meta.native_coding_running_critic_admissible_v1(uuid,uuid)');
 if p.prosrc is null then return;end if;
 if p.prosrc is null or p.lanname<>'plpgsql' or p.prosecdef is distinct from false or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('11f18b66dcbc0a4c61cd896145d3f76d88d539f277957e022dcb6db77319e491')
 then raise exception 'native_running_agent_native_coding_running_critic_admissible_v1_requires_review' using errcode='55000';end if;
end $review$;
create or replace function destruktion_meta.native_coding_running_critic_admissible_v1(p_workspace uuid,p_task uuid)
returns boolean language plpgsql volatile security invoker set search_path=pg_catalog,destruktion_meta as $$
declare t destruktion_meta.devos_fleet_task_h205f22; p destruktion_meta.native_coding_operator_permit_h205f22;
 f destruktion_meta.native_coding_worktree_fence_h205f22; j destruktion_meta.native_coding_job_registration_h205f22;
 writer_permit destruktion_meta.native_coding_operator_permit_h205f22;
 root text; subject jsonb;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_agent_state_owner_required' using errcode='42501';end if;
 select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task and workspace_id=p_workspace;
 select * into p from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=(t.task_spec#>>'{native_coding,permit_id}')::uuid
   and workspace_id=p_workspace and revoked_at is null and (permit->>'expires_at')::timestamptz>clock_timestamp();
 if p.permit_id is null or t.task_id is null or t.role is distinct from p.permit->>'role' then return false; end if;
 if t.role is distinct from 'CRITIC' then return false;end if;
 -- Authorization of this already-held run still requires the current protected
 -- service witness. It never asks for a second free slot or a second lease.
 declare r destruktion_meta.native_coding_service_heartbeat_h205f22;
  d public.compute_fabric_a2_browser_device_h205f22;v jsonb;control jsonb;provider jsonb;
 begin
 select * into r from destruktion_meta.native_coding_service_heartbeat_h205f22 where workspace_id=p.workspace_id and device_id=p.device_id and client_id=p.client_id;
 if not found or r.expires_at<=clock_timestamp() or r.proven_at>clock_timestamp()+interval '5 seconds' or r.admin_grant_epoch<>p.admin_grant_epoch then return false;end if;
 v:=r.body->'input';
 select * into d from public.compute_fabric_a2_browser_device_h205f22 where device_id=p.device_id and client_id=p.client_id and active and revoked_at is null
  and access_tier='ADMIN' and admin_revoked_at is null and admin_grant_epoch=p.admin_grant_epoch and profile='A2_DEVICE_HTTP_SIGNATURE_V1'
  and key_fingerprint_sha256=p.permit->>'device_key_fingerprint_sha256' and admin_scopes @> '["CONTROL_PLANE","DEVOS"]'::jsonb;
 if not found or not exists(select 1 from public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 where token_hash=d.enrollment_pairing_token_hash and active)
 then return false;end if;
 control:=public.devos_environment_state_v1(p.workspace_id);
 if coalesce(control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb
  or control->'owner_stop' is not distinct from 'true'::jsonb or coalesce(control->>'state','')='STOPPED'
  or (v#>>'{control,runtime_control_generation}')::bigint is distinct from (control->>'generation_floor')::bigint,true) then return false;end if;
 select a.value into provider from jsonb_array_elements(v->'providers') a where a.value->>'permit_id'=p.permit_id::text;
 if provider is null or p.permit->'artifact' is distinct from v->'artifact' or p.permit->'postgres' is distinct from v->'postgres'
  or (p.permit->>'expires_at')::timestamptz<=clock_timestamp()
  or not exists(select 1 from destruktion_meta.native_coding_provider_registration_h205f22 pr where pr.permit_id=p.permit_id
    and pr.envelope_sha256=provider->>'envelope_sha256' and (pr.envelope#>>'{payload,expires_at}')::timestamptz>clock_timestamp()
    and pr.envelope#>'{payload,host_process}'=v->'host_process') then return false;end if;
 if not exists(select 1 from destruktion_meta.project_run_h205f22 pr where pr.project_id=(p.permit->>'project_id')::uuid and pr.workspace_id=p.workspace_id
   and pr.device_id=p.device_id and pr.client_id=p.client_id and pr.admin_grant_epoch=p.admin_grant_epoch and pr.state='ACTIVE') then return false;end if;
  if not exists(select 1 from destruktion_meta.native_coding_job_registration_h205f22 active_job
    where active_job.task_id=t.task_id and active_job.lease_generation=t.lease_generation
      and active_job.permit_id=p.permit_id and active_job.job_envelope#>'{payload,host_process}'=v->'host_process') then return false;end if;
 end;
 root:=p.permit#>>'{worktree,root_identity_sha256}';
 if root is null then return false; end if;
 perform 1 from destruktion_meta.project_run_h205f22 r join destruktion_meta.project_task_h205f22 pt using(project_id)
   where r.project_id=(p.permit->>'project_id')::uuid and pt.task_id=t.task_id and r.workspace_id=p_workspace and r.state='ACTIVE'
     and r.device_id=p.device_id and r.client_id=p.client_id and r.admin_grant_epoch=p.admin_grant_epoch;
 if not found then return false; end if;
 select * into f from destruktion_meta.native_coding_worktree_fence_h205f22 where root_identity_sha256=root;
 if t.role='CRITIC' then
   subject:=t.task_spec#>'{native_coding,verification_subject}';
   if f.state is distinct from 'HELD' or f.workspace_id is distinct from p_workspace or f.project_id is distinct from (p.permit->>'project_id')::uuid then return false; end if;
   select * into j from destruktion_meta.native_coding_job_registration_h205f22 where task_id=f.writer_task_id and lease_generation=f.writer_lease_generation;
   select * into writer_permit from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=j.permit_id;
   return coalesce(destruktion_meta.native_coding_project_result_bound_v1(f.writer_task_id)
     and writer_permit.workspace_id=p.workspace_id and writer_permit.device_id=p.device_id and writer_permit.client_id=p.client_id
     and writer_permit.admin_grant_epoch=p.admin_grant_epoch and writer_permit.permit->>'goal_id'=p.permit->>'goal_id'
     and writer_permit.permit->>'goal_sha256'=p.permit->>'goal_sha256' and writer_permit.permit->>'owner_epoch'=p.permit->>'owner_epoch'
     and writer_permit.permit->'artifact'=p.permit->'artifact'
     and subject=jsonb_build_object('run_id',j.run_id,'result_sha256',j.result_receipt->>'result_sha256',
       'git_artifact_sha256',j.result_receipt#>>'{git_after,artifact_sha256}','source_head',j.result_receipt#>>'{git_after,head}')
     and j.result_receipt->>'role'='IMPLEMENTER' and j.result_receipt#>>'{result,outcome}'='DONE'
     and j.result_receipt->>'agent_id'<>p.agent_id and t.base_sha=subject->>'source_head',false);
 end if;
 return false;
end $$;
create or replace function destruktion_meta.native_coding_agent_context_v1(p_run uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$
declare j destruktion_meta.native_coding_job_registration_h205f22; t destruktion_meta.devos_fleet_task_h205f22;
 c destruktion_meta.devos_fleet_claim_h205f22; e destruktion_meta.native_coding_execution_h205f22;
 p destruktion_meta.native_coding_operator_permit_h205f22; f destruktion_meta.native_coding_worktree_fence_h205f22;
 r destruktion_meta.project_run_h205f22; context jsonb; control jsonb;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_agent_state_owner_required' using errcode='42501'; end if;
 select * into j from destruktion_meta.native_coding_job_registration_h205f22 where run_id=p_run;
 select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=j.task_id and lease_generation=j.lease_generation;
 select * into e from destruktion_meta.native_coding_execution_h205f22 where task_id=j.task_id and lease_generation=j.lease_generation;
 select * into p from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=j.permit_id and revoked_at is null;
 select * into c from destruktion_meta.devos_fleet_claim_h205f22 where task_id=j.task_id and lease_generation=j.lease_generation and state='ACTIVE';
 if j.run_id is null or t.state is distinct from 'RUNNING' or e.state is distinct from 'ATTEMPTED' or j.result_receipt is not null
   or c.claim_id is null or c.expires_at<=clock_timestamp() or t.lease_expires_at<=clock_timestamp()
   or c.agent_id is distinct from t.lease_agent_id or c.target_id is distinct from t.lease_target_id or c.tab_id is distinct from t.lease_tab_id
   or c.agent_generation_epoch is distinct from t.lease_agent_generation_epoch or c.workspace_id is distinct from t.workspace_id
   or c.base_sha is distinct from t.base_sha or c.expires_at is distinct from t.lease_expires_at
   or p.permit_id is null or p.workspace_id is distinct from t.workspace_id or p.agent_id is distinct from t.lease_agent_id
   or t.lease_target_id is distinct from 'codex-cli:'||p.provider_id::text or t.role is distinct from p.permit->>'role'
   or t.task_spec#>>'{native_coding,permit_id}' is distinct from p.permit_id::text
   or t.task_spec#>>'{native_coding,project_id}' is distinct from p.permit->>'project_id'
   or t.task_spec#>>'{native_coding,goal_id}' is distinct from p.permit->>'goal_id'
   or t.task_spec#>>'{native_coding,goal_sha256}' is distinct from p.permit->>'goal_sha256'
   or e.agent_id is distinct from t.lease_agent_id or e.target_id is distinct from t.lease_target_id
   or e.host_incarnation is distinct from j.job_envelope#>>'{payload,host_process,process_incarnation_id}'
   or j.job_envelope#>>'{payload,run_id}' is distinct from p_run::text
   or j.job_envelope#>>'{payload,agent_id}' is distinct from t.lease_agent_id
   or j.job_envelope#>>'{payload,role}' is distinct from t.role
 then raise exception 'native_agent_run_not_current' using errcode='55000'; end if;
 context:=public.native_coding_admission_context_v1(t.workspace_id,p.client_id,p.permit_id);
 r:=destruktion_meta.project_authorize_h205f22(t.workspace_id,(p.permit->>'project_id')::uuid,p.device_id,p.client_id,p.admin_grant_epoch);
 if r.state<>'ACTIVE' or not exists(select 1 from destruktion_meta.project_task_h205f22 where task_id=t.task_id and project_id=r.project_id)
 then raise exception 'native_agent_project_fenced' using errcode='55000'; end if;
 select * into f from destruktion_meta.native_coding_worktree_fence_h205f22 where root_identity_sha256=p.permit#>>'{worktree,root_identity_sha256}';
 if f.state is distinct from 'HELD' or f.workspace_id is distinct from t.workspace_id or f.project_id is distinct from r.project_id
   or (t.role='IMPLEMENTER' and (f.writer_task_id is distinct from t.task_id or f.writer_lease_generation is distinct from t.lease_generation))
   or (t.role='CRITIC' and not destruktion_meta.native_coding_running_critic_admissible_v1(t.workspace_id,t.task_id))
 then raise exception 'native_agent_worktree_fenced' using errcode='55000'; end if;
 control:=public.devos_environment_state_v1(t.workspace_id);
 if control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb
 then raise exception 'native_agent_owner_stopped' using errcode='55000'; end if;
 return jsonb_build_object('run_id',p_run,'task',to_jsonb(t),'claim',to_jsonb(c),'permit',p.permit,
   'project_id',r.project_id,'device_id',p.device_id,'client_id',p.client_id,'admin_grant_epoch',p.admin_grant_epoch);
end $$;
revoke all on function destruktion_meta.native_coding_running_critic_admissible_v1(uuid,uuid),
 destruktion_meta.native_coding_agent_context_v1(uuid) from public,anon,authenticated,service_role;
