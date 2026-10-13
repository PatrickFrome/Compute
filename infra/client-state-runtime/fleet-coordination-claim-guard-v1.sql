-- W5/P3: own-PostgreSQL transactional claim admission fence.
-- Source-only migration; NEVER apply to an installed Owner/Guardian/live database
-- without disposable PG17 E2E and independent promotion gates.
-- Reuses the current devos_fleet_lease_v1 -> existing claim INSERT.
-- Does not create another task owner, scheduler, queue or effect channel.
--
-- Opt-in task_spec shape:
-- "fleet_coordination_v1":{"version":1,"role":"IMPLEMENTER|RESEARCHER|CRITIC",
-- "resource":"BROWSER|COMPUTE|HOST","slots":1|2,
-- "dependencies":["<task uuid>", ... max 16]}
-- Immutable conservative budgets per workspace: 16 total claims; role 8/4/4;
-- resource BROWSER 12, COMPUTE 8, HOST 2. All other active claims consume
-- one shared BROWSER slot; P3 task admission is fail closed.
create or replace function destruktion_meta.fleet_coordination_claim_gate_v1()
returns trigger
language plpgsql security definer
set search_path to 'pg_catalog','destruktion_meta','pg_temp'
as $function$
declare
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_dep destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_active record;
  v_spec jsonb;
  v_dependencies jsonb;
  v_dependency text;
  v_count integer := 0;
  v_role_used integer := 0;
  v_resource_used integer := 0;
  v_resource text;
  v_cost integer;
  v_total_limit integer := 16;
  v_role_limit integer;
  v_resource_limit integer;
  v_project uuid;
  v_dependency_project uuid;
begin
  if new.workspace_id is null or new.task_id is null
     or new.authority_effect is distinct from false then
    raise exception 'fleet_coordination_claim_identity_invalid' using errcode='55000';
  end if;
  -- Lock ALL claim creations, including legacy tasks, so P3 budgets see an
  -- ordered committed claim history even under concurrent lease RPCs.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('metaengine.fleet-claims:' || new.workspace_id::text, 0));
  select * into v_task from destruktion_meta.devos_fleet_task_h205f22
   where task_id=new.task_id and workspace_id=new.workspace_id;
  if not found then
    raise exception 'fleet_coordination_task_not_found' using errcode='55000';
  end if;
  v_spec:=v_task.task_spec->'fleet_coordination_v1';
  if v_spec is null then return new; end if; -- retain legacy admission behavior
  if jsonb_typeof(v_spec) is distinct from 'object'
    or v_spec->>'version' is distinct from '1'
    or upper(coalesce(v_spec->>'role','')) is distinct from v_task.role
    or v_task.role not in ('IMPLEMENTER','RESEARCHER','CRITIC')
    or upper(coalesce(v_spec->>'resource','')) not in ('BROWSER','COMPUTE','HOST')
    or coalesce(v_spec->>'slots','') not in ('1','2')
    or new.lease_generation is distinct from v_task.lease_generation
    or new.agent_id is distinct from v_task.lease_agent_id
  then raise exception 'fleet_coordination_graph_identity_invalid' using errcode='55000'; end if;
  v_resource:=upper(v_spec->>'resource');
  v_cost:=(v_spec->>'slots')::integer;
  v_dependencies:=v_spec->'dependencies';
  if jsonb_typeof(v_dependencies) is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_dependencies)>16 then
    raise exception 'fleet_coordination_dependencies_invalid' using errcode='55000';
  end if;
  -- The database, not the browser or a model, proves each dependency; P3
  -- project registry gives immutable project identity and verifier binding.
  select project_id into v_project
    from destruktion_meta.project_task_h205f22 where task_id=new.task_id;
  if not found then
    raise exception 'fleet_coordination_project_unknown' using errcode='55000';
  end if;
  for v_dependency in select jsonb_array_elements_text(v_dependencies) loop
    if v_dependency !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or v_dependency = new.task_id::text then
      raise exception 'fleet_coordination_dependency_identity_invalid' using errcode='55000';
    end if;
    if (select count(*) from jsonb_array_elements_text(v_dependencies) d where d=v_dependency)<>1 then
      raise exception 'fleet_coordination_duplicate_dependency' using errcode='55000';
    end if;
    select * into v_dep from destruktion_meta.devos_fleet_task_h205f22
      where task_id=v_dependency::uuid and workspace_id=new.workspace_id;
    select project_id into v_dependency_project
      from destruktion_meta.project_task_h205f22 where task_id=v_dependency::uuid;
    if not found or v_dependency_project is distinct from v_project
      or v_dep.state is distinct from 'COMPLETED'
      or v_dep.authority_effect is distinct from false
      or coalesce(v_dep.result_sha256,'') !~* '^[0-9a-f]{64}$'
      or destruktion_meta.project_completion_ready_h205f22(v_dependency::uuid) is distinct from true
    then raise exception 'fleet_coordination_dependency_not_verified' using errcode='55000'; end if;
    if v_task.role='CRITIC' and v_dep.lease_agent_id is not distinct from new.agent_id then
      raise exception 'fleet_coordination_critic_not_independent' using errcode='55000';
    end if;
  end loop;
  -- A valid dep cannot be in a cycle: project completion/independent verifier
  -- cannot be proven for a dependency loop. Self and duplicate edges rejected.
  -- Duplicate active task claims also abort the source lease transaction.
  if exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 c
       where c.workspace_id=new.workspace_id and c.task_id=new.task_id
         and c.state='ACTIVE' and c.expires_at>clock_timestamp()) then
    raise exception 'fleet_coordination_duplicate_live_claim' using errcode='55000';
  end if;
  v_role_limit:=case v_task.role when 'IMPLEMENTER' then 8 when 'RESEARCHER' then 4 else 4 end;
  v_resource_limit:=case v_resource when 'BROWSER' then 12 when 'COMPUTE' then 8 else 2 end;
  for v_active in select t.role, t.task_spec from destruktion_meta.devos_fleet_claim_h205f22 c
    join destruktion_meta.devos_fleet_task_h205f22 t on t.task_id=c.task_id
    where c.workspace_id=new.workspace_id and c.state='ACTIVE' and c.expires_at>clock_timestamp()
  loop
    v_count:=v_count+1;
    if v_active.role=v_task.role then v_role_used:=v_role_used+1; end if;
    if coalesce(upper(v_active.task_spec#>>'{fleet_coordination_v1,resource}'),'BROWSER')=v_resource then
      v_resource_used:=v_resource_used+
        case when v_active.task_spec#>>'{fleet_coordination_v1,slots}' in ('1','2')
          then (v_active.task_spec#>>'{fleet_coordination_v1,slots}')::integer else 1 end;
    end if;
  end loop;
  if v_count>=v_total_limit or v_role_used>=v_role_limit
     or v_resource_used+v_cost>v_resource_limit then
    raise exception 'fleet_coordination_slots_exhausted' using errcode='55000';
  end if;
  return new;
end
$function$;
revoke all on function destruktion_meta.fleet_coordination_claim_gate_v1()
  from public, anon, authenticated, service_role;
-- An existing trusted devos lease RPC is the only entrypoint; trigger is
-- attached to its existing claim table, never exposed as a new mutation RPC.
create trigger zz_fleet_coordination_claim_gate_v1
  before insert on destruktion_meta.devos_fleet_claim_h205f22
  for each row execute function destruktion_meta.fleet_coordination_claim_gate_v1();
