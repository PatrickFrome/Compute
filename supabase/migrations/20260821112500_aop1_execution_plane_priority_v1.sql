-- AOP1 execution-plane priority v1
-- Operational focus only: does not mutate the sealed roadmap definition or grant authority.
-- W1 implementation is first; Analyst/Supervisor closeout remains ahead of implementers;
-- R1 remains secondary and naturally runs when W1 is waiting on an external event.

create or replace function public.h205f22_aop1_lease_run_v1(
  p_worker text,
  p_role_key text default null,
  p_lease_seconds integer default 180
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta'
as $function$
declare
  v_run destruktion_meta.compute_fabric_aop_run_h205f22%rowtype;
  v_role destruktion_meta.compute_fabric_aop_role_h205f22%rowtype;
  v_status jsonb;
  v_snapshot jsonb;
  v_claim jsonb;
  v_directive jsonb;
begin
  if p_worker is null or char_length(p_worker)<3 then raise exception 'invalid_worker' using errcode='22023'; end if;
  if p_lease_seconds<30 or p_lease_seconds>900 then raise exception 'invalid_lease_seconds' using errcode='22023'; end if;

  perform destruktion_meta.compute_fabric_aop_reconcile_h205f22();

  with picked as (
    select r.run_id
      from destruktion_meta.compute_fabric_aop_run_h205f22 r
      join destruktion_meta.compute_fabric_aop_role_h205f22 ro
        on ro.role_key=r.role_key and ro.enabled
     where (r.state='READY' or (r.state='LEASED' and r.lease_expires_at<clock_timestamp()))
       and r.attempt_count<r.max_attempts
       and (p_role_key is null or r.role_key=p_role_key)
       and (
         ro.role_kind<>'IMPLEMENTER'
         or exists(
           select 1
             from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c
            where c.claim_id=r.claim_id
              and c.state='ACTIVE'
              and c.expires_at>clock_timestamp()
              and c.holder_id='aop1:'||r.role_key
         )
       )
     order by
       case
         when r.role_key='MAINLINE_SUPERVISOR' then 0
         when r.role_key='INTEGRATION_ANALYST' then 1
         when r.role_key='W1_IMPLEMENTER' then 2
         when r.role_key='F1_IMPLEMENTER' then 10
         when r.role_key='R1_IMPLEMENTER' then 20
         when r.role_key='T0_IMPLEMENTER' then 30
         when r.role_key='A1_IMPLEMENTER' then 40
         else 50
       end,
       r.created_at,
       r.run_id
     for update of r skip locked
     limit 1
  )
  update destruktion_meta.compute_fabric_aop_run_h205f22 r
     set state='LEASED',
         lease_owner=p_worker,
         lease_generation=r.lease_generation+1,
         lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
         attempt_count=r.attempt_count+1,
         started_at=coalesce(r.started_at,clock_timestamp()),
         updated_at=clock_timestamp()
    from picked p
   where r.run_id=p.run_id
   returning r.* into v_run;

  if not found then
    return jsonb_build_object(
      'schema','metaengine.compute.aop-lease.h205f22.v2',
      'leased',false,
      'canonical',false,
      'authority_effect',false
    );
  end if;

  select * into v_role
    from destruktion_meta.compute_fabric_aop_role_h205f22
   where role_key=v_run.role_key;

  v_status:=destruktion_meta.compute_fabric_roadmap_status_h205f22();
  v_snapshot:=destruktion_meta.compute_fabric_supervisor_snapshot_h205f22();

  if v_run.claim_id is not null then
    select to_jsonb(c)-'claim_token' into v_claim
      from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c
     where claim_id=v_run.claim_id;
  end if;

  if v_run.directive_id is not null then
    select to_jsonb(d) into v_directive
      from destruktion_meta.compute_fabric_supervisor_directive_h205f22 d
     where directive_id=v_run.directive_id;
  end if;

  perform destruktion_meta.compute_fabric_aop_emit_event_h205f22(
    'RUN_LEASED',v_run.milestone_key,v_run.run_id,v_run.role_key,'AOP',
    jsonb_build_object(
      'worker',p_worker,
      'lease_generation',v_run.lease_generation,
      'attempt_count',v_run.attempt_count,
      'execution_focus','W1_FIRST_CLOSEOUT_ALLOWED_R1_SECONDARY'
    ),
    v_run.idempotency_key||':lease:'||v_run.lease_generation::text,
    v_run.expected_github_sha
  );

  return jsonb_build_object(
    'schema','metaengine.compute.aop-lease.h205f22.v2',
    'leased',true,
    'run_id',v_run.run_id,
    'role_key',v_run.role_key,
    'role_kind',v_role.role_kind,
    'role_config',v_role.config,
    'milestone_key',v_run.milestone_key,
    'mutation_domains',v_role.mutation_domains,
    'executor_profile',v_role.executor_profile,
    'lease_generation',v_run.lease_generation,
    'lease_expires_at',v_run.lease_expires_at,
    'input',v_run.input,
    'expected_github_sha',v_run.expected_github_sha,
    'base_checkpoint_id',v_run.base_checkpoint_id,
    'base_head_drift',v_run.base_checkpoint_id is distinct from v_status#>>'{semantic_head,checkpoint_id}',
    'roadmap_status',v_status,
    'supervisor_snapshot',v_snapshot,
    'claim',v_claim,
    'directive',v_directive,
    'execution_focus','W1_FIRST_CLOSEOUT_ALLOWED_R1_SECONDARY',
    'canonical',false,
    'authority_effect',false
  );
end
$function$;

revoke all on function public.h205f22_aop1_lease_run_v1(text,text,integer) from public,anon,authenticated;
grant execute on function public.h205f22_aop1_lease_run_v1(text,text,integer) to service_role;
