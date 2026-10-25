-- Wait for mutable worktree capacity BEFORE allocating a W30 lease. The same
-- allocator and strict browser/native proof gates remain the only admission.
-- Root ownership is acquired atomically with native claim INSERT, before any
-- Host reserve/spawn, and remains fenced through CHECKPOINTED_PENDING_COMMIT.
create function destruktion_meta.native_coding_worktree_admissible_v1(p_workspace uuid,p_task uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,destruktion_meta as $$
declare t destruktion_meta.devos_fleet_task_h205f22; p destruktion_meta.native_coding_operator_permit_h205f22;
 f destruktion_meta.native_coding_worktree_fence_h205f22; j destruktion_meta.native_coding_job_registration_h205f22;
 writer_permit destruktion_meta.native_coding_operator_permit_h205f22;
 root text; subject jsonb;
begin
 select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task and workspace_id=p_workspace;
 select * into p from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=(t.task_spec#>>'{native_coding,permit_id}')::uuid
   and workspace_id=p_workspace and revoked_at is null and (permit->>'expires_at')::timestamptz>clock_timestamp();
 if p.permit_id is null or t.task_id is null or t.role is distinct from p.permit->>'role' then return false; end if;
 root:=p.permit#>>'{worktree,root_identity_sha256}';
 if root is null then return false; end if;
 perform 1 from destruktion_meta.project_run_h205f22 r join destruktion_meta.project_task_h205f22 pt using(project_id)
   where r.project_id=(p.permit->>'project_id')::uuid and pt.task_id=t.task_id and r.workspace_id=p_workspace and r.state='ACTIVE'
     and r.device_id=p.device_id and r.client_id=p.client_id and r.admin_grant_epoch=p.admin_grant_epoch;
 if not found then return false; end if;
 select * into f from destruktion_meta.native_coding_worktree_fence_h205f22 where root_identity_sha256=root;
 if t.role='IMPLEMENTER' then
   if f.root_identity_sha256 is not null then return false; end if;
   -- Also cover a live claim admitted before this additive migration, where
   -- the old Host has not yet committed its RESERVED execution/fence.
   return not exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 c
     join destruktion_meta.devos_fleet_task_h205f22 claimed on claimed.task_id=c.task_id and claimed.lease_generation=c.lease_generation
     join destruktion_meta.native_coding_operator_permit_h205f22 oldp on oldp.permit_id=(claimed.task_spec#>>'{native_coding,permit_id}')::uuid
     where c.state='ACTIVE' and c.expires_at>clock_timestamp() and c.target_id like 'codex-cli:%'
       and oldp.permit#>>'{worktree,root_identity_sha256}'=root);
 elsif t.role='CRITIC' then
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
revoke all on function destruktion_meta.native_coding_worktree_admissible_v1(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function destruktion_meta.native_coding_claim_admission_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
declare p destruktion_meta.native_coding_operator_permit_h205f22; r destruktion_meta.native_coding_provider_registration_h205f22;
  proof jsonb; context jsonb; s jsonb; seen timestamptz; control jsonb; task destruktion_meta.devos_fleet_task_h205f22;
begin
  if new.target_id !~ '^codex-cli:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or new.state<>'ACTIVE' then raise exception 'native_coding_claim_invalid' using errcode='23514'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.workspace_id::text,2382533));
  select * into p from destruktion_meta.native_coding_operator_permit_h205f22
    where workspace_id=new.workspace_id and provider_id=substring(new.target_id from 11)::uuid
      and agent_id=new.agent_id and agent_generation_epoch=new.agent_generation_epoch and revoked_at is null for share;
  if not found then raise exception 'native_coding_scope_unavailable' using errcode='55000'; end if;
  -- Wait before checking freshness, so a blocked root cannot age a previously
  -- validated provider proof into an admitted stale claim.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p.permit#>>'{worktree,root_identity_sha256}',25080000));
  context:=public.native_coding_admission_context_v1(new.workspace_id,p.client_id,p.permit_id);
  select * into r from destruktion_meta.native_coding_provider_registration_h205f22 where permit_id=p.permit_id for share;
  proof:=r.envelope->'payload';
  if coalesce(r.permit_id is null or proof->>'schema'<>'metaengine.codex-cli.transport-proof.v1'
    or proof->>'trust_namespace'<>'LOCAL_OPERATOR_QA' or proof->>'state'<>'READY'
    or r.envelope->>'algorithm'<>'ES256' or r.envelope->>'issuer_key_fingerprint_sha256'<>p.permit->>'device_key_fingerprint_sha256'
    or proof->>'target_id'<>new.target_id or proof->>'agent_id'<>new.agent_id or proof->>'role'<>new.role
    or (proof->>'agent_generation_epoch')::bigint<>new.agent_generation_epoch
    or new.tab_id<>'native-coding:'||p.provider_id::text
    or (proof->>'expires_at')::timestamptz<=clock_timestamp()
    or (proof->>'proven_at')::timestamptz<clock_timestamp()-interval '60 seconds'
    or (proof->>'proven_at')::timestamptz>clock_timestamp()+interval '5 seconds'
    or (proof->>'expires_at')::timestamptz>(proof->>'proven_at')::timestamptz+interval '60 seconds'
    or (proof->>'expires_at')::timestamptz>(p.permit->>'expires_at')::timestamptz
    or (proof-'schema'-'state'-'physical_slot_budget'-'target_id'-'issuer'-'audience'-'provider'-'host_process'-'sandbox'-'proven_at'-'expires_at'-'automatic_retry_allowed'-'production_qualified'-'authority_effect')
      is distinct from (p.permit-'schema'-'physical_slot_budget'-'issued_at'-'expires_at'-'revoked'-'storage_evidence_sha256'-'record_sha256')
    or proof->'automatic_retry_allowed' is distinct from 'false'::jsonb
    or proof->'authority_effect' is distinct from 'false'::jsonb or proof->'production_qualified' is distinct from 'false'::jsonb,true) then
    raise exception 'native_coding_provider_unregistered' using errcode='55000'; end if;
  select * into task from destruktion_meta.devos_fleet_task_h205f22 where task_id=new.task_id and workspace_id=new.workspace_id;
  if task.base_sha is distinct from p.permit->'worktree'->>'base_sha'
    or not coalesce(task.task_spec->'native_coding' @> jsonb_build_object('permit_id',p.permit_id,'goal_id',p.permit->>'goal_id',
      'goal_sha256',p.permit->>'goal_sha256','project_id',p.permit->>'project_id'),false) then
    raise exception 'native_coding_task_scope_mismatch' using errcode='55000'; end if;
  select destruktion_meta.devos_normalize_native_supervisor_state_h205f22(state),last_seen_at into s,seen
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 where workspace_id=new.workspace_id and client_id=p.client_id order by last_seen_at desc limit 1;
  if coalesce(s is null or s->>'schema'<>'metaengine.native-browser-supervisor.state.v1' or s->>'client_kind'<>'METAENGINE_BROWSER_ELECTRON_NATIVE'
    or seen<clock_timestamp()-interval '45 seconds' or s->'transport_identity'->>'device_id'<>p.device_id::text
    or s->'transport_identity'->>'profile'<>'A2_DEVICE_HTTP_SIGNATURE_V1'
    or s->'transport_identity'->>'key_fingerprint_sha256'<>p.permit->>'device_key_fingerprint_sha256'
    or s->'supervisor_lifecycle'->'continuous_service'->'enabled' is distinct from 'true'::jsonb
    or s->'supervisor_lifecycle'->'actuation_enabled' is distinct from 'true'::jsonb
    or upper(coalesce(s->'supervisor_lifecycle'->'keepalive'->>'state','UNKNOWN')) in ('WAKE_AMBIGUOUS','ROLLOVER_DEFERRED','ROLLOVER_REQUIRED','ROLLOVER_AMBIGUOUS','RECOVERING'),true) then
    raise exception 'native_coding_continuity_fenced' using errcode='55000'; end if;
  control:=public.devos_environment_state_v1(new.workspace_id);
  if control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb then
    raise exception 'native_coding_environment_fenced' using errcode='55000'; end if;
  if (select count(*) from destruktion_meta.devos_fleet_claim_h205f22 c where c.workspace_id=new.workspace_id and c.state='ACTIVE'
      and c.expires_at>clock_timestamp() and c.target_id like 'codex-cli:%') >= (p.permit->>'physical_slot_budget')::int
    or exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 c where c.workspace_id=new.workspace_id and c.target_id=new.target_id and c.state='ACTIVE' and c.expires_at>clock_timestamp()) then
    raise exception 'native_coding_physical_capacity_fenced' using errcode='55000'; end if;
  -- Serialize physical root admission across workspaces as well as native
  -- claims within one workspace. Readback/proof checks above remain unchanged.
  if not destruktion_meta.native_coding_worktree_admissible_v1(new.workspace_id,new.task_id) then
    raise exception 'native_coding_worktree_capacity_wait' using errcode='P0N01';
  end if;
  if new.role='IMPLEMENTER' then
    -- This fixed claim trigger may run for the API role. It does not expose
    -- the private Host's state_owner-only reserve capability to that role.
    -- The task update and unique root INSERT commit or roll back together.
    begin
      insert into destruktion_meta.native_coding_worktree_fence_h205f22(workspace_id,root_identity_sha256,project_id,writer_task_id,writer_lease_generation)
        values(new.workspace_id,p.permit#>>'{worktree,root_identity_sha256}',(p.permit->>'project_id')::uuid,new.task_id,new.lease_generation)
        on conflict do nothing;
      if not found then raise exception 'native_coding_worktree_capacity_wait' using errcode='P0N01'; end if;
    exception when serialization_failure then
      -- A unique-root race cannot have dispatched anything. Translate only
      -- this bounded INSERT conflict, never retry or swallow other failures.
      raise exception 'native_coding_worktree_capacity_wait' using errcode='P0N01';
    end;
  end if;
  return new;
end $$;

create or replace function public.devos_fleet_lease_v1(
 p_workspace uuid,p_agent text,p_role text,p_tab text,p_target text,p_epoch bigint,p_seconds integer default 900
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','destruktion_meta'
as $$
declare v_task destruktion_meta.devos_fleet_task_h205f22%rowtype; v_claim bigint;
 v_now timestamptz:=clock_timestamp(); v_secs int:=greatest(60,least(3600,coalesce(p_seconds,900)));
begin
 perform public.devos_fleet_reconcile_v1(p_workspace);
 with picked as (
   select task_id from destruktion_meta.devos_fleet_task_h205f22 t
   where workspace_id=p_workspace and state='READY' and role=upper(p_role)
     and ((p_target not like 'codex-cli:%' and not (t.task_spec ? 'native_coding'))
       or (p_target like 'codex-cli:%' and exists (
         select 1 from destruktion_meta.native_coding_operator_permit_h205f22 p
         join destruktion_meta.native_coding_provider_registration_h205f22 r using(permit_id)
         where p.workspace_id=p_workspace and p.provider_id::text=substring(p_target from 11)
           and p.agent_id=lower(p_agent) and p.agent_generation_epoch=p_epoch and p.revoked_at is null
           and (p.permit->>'expires_at')::timestamptz>clock_timestamp()
           and t.base_sha=p.permit->'worktree'->>'base_sha'
           and destruktion_meta.native_coding_worktree_admissible_v1(p_workspace,t.task_id)
           and t.task_spec->'native_coding' @> jsonb_build_object('permit_id',p.permit_id,'goal_id',p.permit->>'goal_id',
             'goal_sha256',p.permit->>'goal_sha256','project_id',p.permit->>'project_id')
       )))
   order by priority desc,created_at,task_id for update skip locked limit 1
 )
 update destruktion_meta.devos_fleet_task_h205f22 t
 set state='LEASED',lease_generation=t.lease_generation+1,lease_agent_id=lower(p_agent),
     lease_tab_id=p_tab,lease_target_id=lower(p_target),lease_agent_generation_epoch=p_epoch,
     lease_expires_at=v_now+make_interval(secs=>v_secs),updated_at=v_now
 from picked p where t.task_id=p.task_id returning t.* into v_task;
 if not found then return jsonb_build_object('leased',false,'agent_id',lower(p_agent),'role',upper(p_role),
   'automatic_retry_allowed',false,'authority_effect',false); end if;
 insert into destruktion_meta.devos_fleet_claim_h205f22(
  task_id,workspace_id,point_id,base_sha,role,claim_class,agent_id,tab_id,target_id,
  agent_generation_epoch,lease_generation,expires_at
 ) values (
  v_task.task_id,v_task.workspace_id,v_task.point_id,v_task.base_sha,v_task.role,v_task.claim_class,
  lower(p_agent),p_tab,lower(p_target),p_epoch,v_task.lease_generation,v_task.lease_expires_at
 ) returning claim_id into v_claim;
 return jsonb_build_object('leased',true,'task_id',v_task.task_id,'claim_id',v_claim,'point_id',v_task.point_id,
  'role',v_task.role,'claim_class',v_task.claim_class,'base_sha',v_task.base_sha,'branch_name',v_task.branch_name,
  'task_spec',v_task.task_spec,'task_spec_sha256',v_task.task_spec_sha256,'lease_generation',v_task.lease_generation,
  'lease_expires_at',v_task.lease_expires_at,'agent_id',lower(p_agent),'tab_id',p_tab,'target_id',lower(p_target),
  'agent_generation_epoch',p_epoch,'automatic_retry_allowed',false,'authority_effect',false);
exception when sqlstate 'P0N01' then
 -- This exception block rolls back the picked task, generation increment,
 -- claim and root acquisition together. It never retries the allocation.
 return jsonb_build_object('leased',false,'agent_id',lower(p_agent),'role',upper(p_role),
   'capacity_wait',true,'wait_reason','NATIVE_WORKTREE_BUSY','lease_outcome','NOT_ALLOCATED',
   'automatic_retry_allowed',false,'authority_effect',false);
end $$;
