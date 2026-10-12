-- One project registry/history over the existing DevOS scheduler. No new leases.
create table destruktion_meta.project_run_h205f22 (
  project_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  request_id uuid not null,
  root_task_id uuid not null references destruktion_meta.devos_fleet_task_h205f22(task_id),
  device_id uuid not null,
  client_id text not null,
  admin_grant_epoch bigint not null,
  goal text not null,
  state text not null default 'ACTIVE' check(state in ('ACTIVE','PAUSED','COMPLETED')),
  policy_generation bigint not null default 1,
  max_depth integer default 8 check(max_depth is null or max_depth>=0),
  max_tasks bigint default 256 check(max_tasks is null or max_tasks>=1),
  max_children bigint default 8 check(max_children is null or max_children>=1),
  total_tasks bigint not null default 1,
  last_seq bigint not null default 0,
  last_reconciled_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,request_id), unique(workspace_id,root_task_id)
);
create table destruktion_meta.project_task_h205f22 (
  task_id uuid primary key references destruktion_meta.devos_fleet_task_h205f22(task_id),
  project_id uuid not null references destruktion_meta.project_run_h205f22(project_id),
  task_seq bigint not null,
  root_task_id uuid not null,
  parent_task_id uuid references destruktion_meta.devos_fleet_task_h205f22(task_id),
  depth integer not null check(depth>=0),
  unique(project_id,task_seq)
);
create table destruktion_meta.project_event_h205f22 (
  project_id uuid not null references destruktion_meta.project_run_h205f22(project_id),
  seq bigint not null,
  causal_parent_seq bigint,
  event_type text not null,
  task_id uuid,
  attempt bigint,
  actor text,
  tool text,
  artifact text,
  content jsonb not null,
  source text not null,
  receipt_event_id bigint,
  receipt_reference_verified boolean not null default false,
  verified_evidence boolean not null default false check(verified_evidence=false),
  idempotency_key text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(project_id,seq), unique(project_id,idempotency_key),
  foreign key(project_id,causal_parent_seq) references destruktion_meta.project_event_h205f22(project_id,seq)
);
create table destruktion_meta.project_child_proposal_h205f22 (
  project_id uuid not null references destruktion_meta.project_run_h205f22(project_id),
  request_id uuid not null,
  child_index integer not null,
  request_sha256 text not null,
  parent_task_id uuid not null references destruktion_meta.devos_fleet_task_h205f22(task_id),
  depth integer not null,
  role text not null,
  objective text not null,
  child_task_id uuid references destruktion_meta.devos_fleet_task_h205f22(task_id),
  status text not null check(status in ('BUDGET_WAIT','CAPACITY_WAIT','ADMITTED')),
  wait_reason text,
  created_at timestamptz not null default clock_timestamp(),
  primary key(project_id,request_id,child_index)
);
alter table destruktion_meta.project_run_h205f22 enable row level security;
alter table destruktion_meta.project_task_h205f22 enable row level security;
alter table destruktion_meta.project_event_h205f22 enable row level security;
alter table destruktion_meta.project_child_proposal_h205f22 enable row level security;
revoke all on table destruktion_meta.project_run_h205f22,destruktion_meta.project_task_h205f22,
  destruktion_meta.project_event_h205f22,destruktion_meta.project_child_proposal_h205f22 from public,anon,authenticated,service_role;

create function destruktion_meta.project_device_grant_h205f22(p_device uuid,p_client text,p_epoch bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,pg_temp as $$
declare d public.compute_fabric_a2_browser_device_h205f22%rowtype;
begin
  select * into d from public.compute_fabric_a2_browser_device_h205f22 where device_id=p_device and client_id=p_client for share;
  if not found or d.active is distinct from true or d.revoked_at is not null or d.access_tier is distinct from 'ADMIN'
    or d.admin_revoked_at is not null or d.admin_grant_epoch is distinct from p_epoch
    or (d.admin_scopes @> '["CONTROL_PLANE","DEVOS"]'::jsonb) is distinct from true
    or not exists(select 1 from public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 where token_hash=d.enrollment_pairing_token_hash and active=true)
  then raise exception 'PROJECT_DEVICE_GRANT_REVOKED' using errcode='42501'; end if;
end $$;

create function destruktion_meta.project_authorize_h205f22(p_workspace uuid,p_project uuid,p_device uuid,p_client text,p_epoch bigint)
returns destruktion_meta.project_run_h205f22 language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,pg_temp as $$
declare r destruktion_meta.project_run_h205f22%rowtype;
begin
  perform destruktion_meta.project_device_grant_h205f22(p_device,p_client,p_epoch);
  select * into r from destruktion_meta.project_run_h205f22 where project_id=p_project and workspace_id=p_workspace;
  if not found or r.device_id is distinct from p_device or r.client_id is distinct from p_client or r.admin_grant_epoch is distinct from p_epoch
  then raise exception 'PROJECT_SCOPE_DENIED' using errcode='42501'; end if;
  return r;
end $$;

-- The project row lock is held through COMMIT. A later append cannot commit a
-- higher seq before this transaction; aborted appends roll the counter back.
create function destruktion_meta.project_append_h205f22(p_project uuid,p_type text,p_task uuid,p_attempt bigint,p_actor text,
  p_cause bigint,p_tool text,p_artifact text,p_content jsonb,p_source text,p_receipt bigint,p_receipt_verified boolean,p_key text)
returns bigint language plpgsql security definer set search_path=pg_catalog,destruktion_meta,pg_temp as $$
declare n bigint; e destruktion_meta.project_event_h205f22%rowtype;
begin
  perform 1 from destruktion_meta.project_run_h205f22 where project_id=p_project for update;
  if not found then raise exception 'PROJECT_SCOPE_DENIED'; end if;
  select * into e from destruktion_meta.project_event_h205f22 where project_id=p_project and idempotency_key=p_key;
  if found then
    if e.event_type is distinct from p_type or e.task_id is distinct from p_task or e.attempt is distinct from p_attempt
      or e.actor is distinct from p_actor or e.causal_parent_seq is distinct from p_cause or e.tool is distinct from p_tool
      or e.artifact is distinct from p_artifact or e.content is distinct from p_content or e.receipt_event_id is distinct from p_receipt
    then raise exception 'PROJECT_EVENT_REQUEST_COLLISION' using errcode='23505'; end if;
    return e.seq;
  end if;
  if p_cause is not null and not exists(select 1 from destruktion_meta.project_event_h205f22 where project_id=p_project and seq=p_cause)
  then raise exception 'PROJECT_CAUSAL_PARENT_INVALID' using errcode='22023'; end if;
  update destruktion_meta.project_run_h205f22 set last_seq=last_seq+1 where project_id=p_project returning last_seq into n;
  insert into destruktion_meta.project_event_h205f22(project_id,seq,causal_parent_seq,event_type,task_id,attempt,actor,tool,artifact,
    content,source,receipt_event_id,receipt_reference_verified,idempotency_key)
  values(p_project,n,p_cause,p_type,p_task,p_attempt,p_actor,p_tool,p_artifact,p_content,p_source,p_receipt,p_receipt_verified,p_key);
  return n;
end $$;

create function public.h205f22_project_register_v1(p_workspace_id uuid,p_request_id uuid,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,pg_temp as $$
declare q destruktion_meta.client_v1_goal_request_h205f22%rowtype; t destruktion_meta.devos_fleet_task_h205f22%rowtype;
  r destruktion_meta.project_run_h205f22%rowtype; replay boolean:=false;
begin
  perform destruktion_meta.project_device_grant_h205f22(p_device_id,p_client_id,p_admin_grant_epoch);
  select * into q from destruktion_meta.client_v1_goal_request_h205f22 where workspace_id=p_workspace_id and request_id=p_request_id for share;
  if not found or q.authority_effect is distinct from false then raise exception 'PROJECT_ROOT_GOAL_NOT_FOUND' using errcode='55000'; end if;
  select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=q.task_id and workspace_id=q.workspace_id for share;
  if not found or t.authority_effect is distinct from false or t.base_sha is distinct from q.baseline_sha
    or t.task_spec_sha256 is distinct from q.task_spec_sha256 or coalesce(t.task_spec->>'objective','')=''
  then raise exception 'PROJECT_ROOT_GOAL_DRIFT' using errcode='55000'; end if;
  insert into destruktion_meta.project_run_h205f22(workspace_id,request_id,root_task_id,device_id,client_id,admin_grant_epoch,goal)
    values(p_workspace_id,p_request_id,q.task_id,p_device_id,p_client_id,p_admin_grant_epoch,left(t.task_spec->>'objective',4000))
    on conflict(workspace_id,request_id) do nothing returning * into r;
  if not found then r:=destruktion_meta.project_authorize_h205f22(p_workspace_id,
    (select project_id from destruktion_meta.project_run_h205f22 where workspace_id=p_workspace_id and request_id=p_request_id),p_device_id,p_client_id,p_admin_grant_epoch); replay:=true; end if;
  insert into destruktion_meta.project_task_h205f22(task_id,project_id,task_seq,root_task_id,parent_task_id,depth)
    values(q.task_id,r.project_id,1,q.task_id,null,0) on conflict(task_id) do nothing;
  perform destruktion_meta.project_append_h205f22(r.project_id,'PROJECT_REGISTERED',q.task_id,0,p_client_id,null,null,null,
    jsonb_build_object('request_id',p_request_id,'goal',r.goal),'DATABASE_REGISTRY',null,false,'register:'||p_request_id);
  return jsonb_build_object('schema','metaengine.devos.project-registration.v1','project_id',r.project_id,'root_task_id',r.root_task_id,
    'request_id',r.request_id,'replayed',replay,'automatic_retry_allowed',false,'scheduler_authority',false,'authority_effect',false);
end $$;

create function destruktion_meta.project_task_projection_h205f22(p_project uuid,p_task uuid)
returns jsonb language sql security definer set search_path=pg_catalog,destruktion_meta,pg_temp as $$
  select jsonb_build_object('task_seq',x.task_seq,'task_id',x.task_id,'root_task_id',x.root_task_id,'parent_task_id',x.parent_task_id,'depth',x.depth,
    'state',t.state,'role',t.role,'claim_class',t.claim_class,'base_sha',t.base_sha,'branch_name',t.branch_name,'point_id',t.point_id,
    'coordination_workspace_id',t.workspace_id,'claim_id',c.claim_id,'lease_generation',t.lease_generation,'agent_id',t.lease_agent_id,
    'tab_id',t.lease_tab_id,'target_id',t.lease_target_id,'agent_generation_epoch',t.lease_agent_generation_epoch,'lease_expires_at',t.lease_expires_at,
    'objective',left(t.task_spec->>'objective',4000),'task_spec_sha256',t.task_spec_sha256,
    'project_continuity',jsonb_build_object('schema','metaengine.devos.project-task.v1','project_id',p_project,'root_task_id',x.root_task_id,'parent_task_id',x.parent_task_id,'depth',x.depth,'root_request_id',r.request_id),
    'open_children',(select count(*) from destruktion_meta.project_task_h205f22 y join destruktion_meta.devos_fleet_task_h205f22 z using(task_id) where y.project_id=p_project and y.parent_task_id=t.task_id and z.state<>'COMPLETED'),
    'blocking_children',(select count(*) from destruktion_meta.project_task_h205f22 y join destruktion_meta.devos_fleet_task_h205f22 z using(task_id) where y.project_id=p_project and y.parent_task_id=t.task_id and z.state in ('FAILED','BLOCKED','AMBIGUOUS','FENCED')),
    'pending_proposals',(select count(*) from destruktion_meta.project_child_proposal_h205f22 y where y.project_id=p_project and y.parent_task_id=t.task_id and y.child_task_id is null))
  from destruktion_meta.project_task_h205f22 x join destruktion_meta.devos_fleet_task_h205f22 t using(task_id) join destruktion_meta.project_run_h205f22 r using(project_id)
  left join lateral (select claim_id from destruktion_meta.devos_fleet_claim_h205f22 where task_id=t.task_id and lease_generation=t.lease_generation and state='ACTIVE' and expires_at>clock_timestamp() order by claim_id desc limit 1) c on true
  where x.project_id=p_project and x.task_id=p_task
$$;

create function public.h205f22_project_snapshot_v1(p_workspace_id uuid,p_project_id uuid,p_task_id uuid,p_task_after_seq bigint,p_limit integer,
  p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,pg_temp as $$
declare r destruktion_meta.project_run_h205f22%rowtype; id uuid:=p_project_id; rows jsonb; proposals jsonb; n bigint; children jsonb; selected uuid; computed_state text; pending bigint;
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
  computed_state:=case when exists(select 1 from destruktion_meta.project_task_h205f22 x join destruktion_meta.devos_fleet_task_h205f22 t using(task_id) where x.project_id=id and t.state in ('FAILED','BLOCKED','AMBIGUOUS','FENCED')) then 'BLOCKED'
    when pending=0 and not exists(select 1 from destruktion_meta.project_task_h205f22 x join destruktion_meta.devos_fleet_task_h205f22 t using(task_id) where x.project_id=id and t.state<>'COMPLETED') and destruktion_meta.project_completion_ready_h205f22(r.root_task_id) is true then 'COMPLETED'
    when pending>0 or exists(select 1 from destruktion_meta.project_task_h205f22 x join destruktion_meta.devos_fleet_task_h205f22 t using(task_id) where x.project_id=id and x.parent_task_id is not null and t.state<>'COMPLETED') then 'WAITING_CHILDREN' else 'ACTIVE' end;
  return jsonb_build_object('schema','metaengine.devos.project-snapshot.v1','found',true,'project_id',id,'coordination_workspace_id',r.workspace_id,'request_id',r.request_id,'root_task_id',r.root_task_id,
    'state',computed_state,'goal',r.goal,'last_seq',r.last_seq,'total_tasks',r.total_tasks,'policy',jsonb_build_object('generation',r.policy_generation,'max_depth',r.max_depth,'max_tasks',r.max_tasks,'max_children',r.max_children),
    'selected_task',destruktion_meta.project_task_projection_h205f22(id,selected),'immediate_children',children,'children_truncated',(select count(*)>128 from destruktion_meta.project_task_h205f22 where project_id=id and parent_task_id=selected),
    'proposals_truncated',(select count(*)>128 from destruktion_meta.project_child_proposal_h205f22 where project_id=id and parent_task_id=selected),'pending_proposals',pending,
    'tasks',rows,'proposals',proposals,'task_cursor',jsonb_build_object('after_seq',p_task_after_seq,'next_seq',n,'has_more',n<r.total_tasks),
    'filesystem_paths_exposed',false,'automatic_retry_allowed',false,'scheduler_authority',false,'authority_effect',false);
end $$;

create function public.h205f22_project_history_v1(p_workspace_id uuid,p_project_id uuid,p_after_seq bigint,p_through_seq bigint,p_limit integer,
  p_task_id uuid,p_attempt bigint,p_event_type text,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,pg_temp as $$
declare r destruktion_meta.project_run_h205f22%rowtype; rows jsonb; hi bigint; n bigint; more boolean;
begin
  r:=destruktion_meta.project_authorize_h205f22(p_workspace_id,p_project_id,p_device_id,p_client_id,p_admin_grant_epoch);
  hi:=coalesce(p_through_seq,r.last_seq);
  if coalesce(p_after_seq,-1)<0 or hi<p_after_seq or hi>r.last_seq or p_limit is null or p_limit not between 1 and 128
    or (p_attempt is not null and p_attempt<0) or (p_event_type is not null and p_event_type !~ '^[A-Z][A-Z0-9_]{0,95}$')
  then raise exception 'PROJECT_HISTORY_REQUEST_INVALID' using errcode='22023'; end if;
  if p_task_id is not null and not exists(select 1 from destruktion_meta.project_task_h205f22 where project_id=p_project_id and task_id=p_task_id)
  then raise exception 'PROJECT_HISTORY_SCOPE_DENIED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(v)-'idempotency_key' order by v.seq),'[]'),coalesce(max(v.seq),p_after_seq) into rows,n from (
    select * from destruktion_meta.project_event_h205f22 where project_id=p_project_id and seq>p_after_seq and seq<=hi
      and (p_task_id is null or task_id=p_task_id) and (p_attempt is null or attempt=p_attempt) and (p_event_type is null or event_type=p_event_type)
    order by seq limit p_limit) v;
  select exists(select 1 from destruktion_meta.project_event_h205f22 where project_id=p_project_id and seq>n and seq<=hi
    and (p_task_id is null or task_id=p_task_id) and (p_attempt is null or attempt=p_attempt) and (p_event_type is null or event_type=p_event_type)) into more;
  if not more then n:=hi; end if;
  return jsonb_build_object('schema','metaengine.devos.project-history.v1','project_id',p_project_id,'root_task_id',r.root_task_id,'entries',rows,
    'cursor',jsonb_build_object('after_seq',p_after_seq,'through_seq',hi,'next_seq',n,'has_more',more,'commit_ordered',true),
    'content_is_authority',false,'automatic_retry_allowed',false,'scheduler_authority',false,'authority_effect',false);
end $$;

create function destruktion_meta.project_parent_h205f22(p_workspace uuid,p_project uuid,p_task uuid,p_claim bigint,p_generation bigint,p_device uuid,p_client text,p_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,pg_temp as $$
declare t destruktion_meta.devos_fleet_task_h205f22%rowtype; c destruktion_meta.devos_fleet_claim_h205f22%rowtype;
  d public.compute_fabric_a2_browser_device_h205f22%rowtype; s jsonb; a jsonb; proof jsonb; seen timestamptz; r destruktion_meta.project_run_h205f22%rowtype;
begin
  select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task and workspace_id=p_workspace for update;
  if not found or t.state not in ('LEASED','RUNNING') or t.authority_effect is distinct from false then raise exception 'PROJECT_PARENT_NOT_CURRENT'; end if;
  select * into c from destruktion_meta.devos_fleet_claim_h205f22 where claim_id=p_claim for share;
  if not found or c.task_id is distinct from p_task or c.workspace_id is distinct from p_workspace or c.state is distinct from 'ACTIVE'
    or c.expires_at<=clock_timestamp() or c.lease_generation is distinct from p_generation or t.lease_generation is distinct from c.lease_generation
    or t.lease_agent_id is distinct from c.agent_id or t.lease_tab_id is distinct from c.tab_id or t.lease_target_id is distinct from c.target_id
    or t.lease_agent_generation_epoch is distinct from c.agent_generation_epoch or t.lease_expires_at is distinct from c.expires_at
    or t.base_sha is distinct from c.base_sha or t.point_id is distinct from c.point_id or c.authority_effect is distinct from false
  then raise exception 'PROJECT_PARENT_CLAIM_FENCED' using errcode='55000'; end if;
  r:=destruktion_meta.project_authorize_h205f22(p_workspace,p_project,p_device,p_client,p_epoch);
  if r.state<>'ACTIVE' or not exists(select 1 from destruktion_meta.project_task_h205f22 where project_id=p_project and task_id=p_task)
  then raise exception 'PROJECT_PARENT_SCOPE_DENIED' using errcode='42501'; end if;
  select * into d from public.compute_fabric_a2_browser_device_h205f22 where device_id=p_device;
  select destruktion_meta.devos_normalize_native_supervisor_state_h205f22(state),last_seen_at into s,seen
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 where client_id=p_client and workspace_id=p_workspace for share;
  if not found or seen<clock_timestamp()-interval '45 seconds' or seen>clock_timestamp()+interval '5 seconds'
    or s->>'schema' is distinct from 'metaengine.native-browser-supervisor.state.v1'
    or s->>'client_kind' is distinct from 'METAENGINE_BROWSER_ELECTRON_NATIVE'
    or s->'transport_identity'->>'device_id' is distinct from p_device::text
    or s->'transport_identity'->>'profile' is distinct from d.profile
    or s->'transport_identity'->>'key_fingerprint_sha256' is distinct from d.key_fingerprint_sha256
    or s->'transport_identity'->>'access_tier' is distinct from 'ADMIN'
    or (s->'transport_identity'->>'admin_grant_epoch')::bigint is distinct from p_epoch
    or (s->'transport_identity'->>'admin_ready')::boolean is distinct from true
    or s->'fleet'->>'readiness_contract' is distinct from 'TRANSPORT_PROOF_REQUIRED'
    or s->'fleet'->>'schema' is distinct from 'metaengine.browser.fleet-snapshot.v1'
    or jsonb_typeof(s->'fleet'->'agents') is distinct from 'array'
  then raise exception 'PROJECT_PARENT_DEVICE_SNAPSHOT_FENCED' using errcode='55000'; end if;
  if (select count(*) from jsonb_array_elements(s->'fleet'->'agents') v where v->>'agent_id'=c.agent_id)<>1 then raise exception 'PROJECT_PARENT_AGENT_AMBIGUOUS'; end if;
  select v into a from jsonb_array_elements(s->'fleet'->'agents') v where v->>'agent_id'=c.agent_id;
  proof:=a->'transport_proof';
  if a->>'ownership' is distinct from 'FLEET_OWNED' or a->>'lifecycle_state' is distinct from 'ACTIVE'
    or (a->>'authority_effect')::boolean is distinct from false or (a->>'automatic_retry_allowed')::boolean is distinct from false
    or a->>'tab_id' is distinct from c.tab_id or a->>'target_id' is distinct from c.target_id or a->>'role' is distinct from c.role
    or (a->>'generation_epoch')::bigint is distinct from c.agent_generation_epoch
    or proof->>'schema' is distinct from 'metaengine.browser.fleet-transport-proof.v1' or (proof->>'authority_effect')::boolean is distinct from false
    or proof->>'tab_id' is distinct from c.tab_id or proof->>'target_id' is distinct from c.target_id
    or (proof->>'generation_epoch')::bigint is distinct from c.agent_generation_epoch
    or coalesce(proof->>'conversation_url_sha256','') !~ '^[0-9a-f]{64}$'
    or coalesce(proof->>'proven_at','')=''
    or (proof->>'proven_at')::timestamptz>clock_timestamp()+interval '5 seconds'
  then raise exception 'PROJECT_PARENT_AGENT_FENCED' using errcode='55000'; end if;
  return jsonb_build_object('task',to_jsonb(t),'claim',to_jsonb(c));
end $$;

create function public.h205f22_project_spawn_v1(p_workspace_id uuid,p_project_id uuid,p_parent_task_id uuid,p_claim_id bigint,p_lease_generation bigint,
  p_request_id uuid,p_children jsonb,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,extensions,pg_temp as $$
declare auth jsonb; r destruktion_meta.project_run_h205f22%rowtype; parent destruktion_meta.project_task_h205f22%rowtype;
  proposal destruktion_meta.project_child_proposal_h205f22%rowtype; child jsonb; idx integer:=0; digest text; capacity jsonb;
  count_children bigint; result jsonb:='[]'; spec jsonb; enqueued jsonb; id uuid; reason text; replay boolean:=true;
begin
  if p_request_id is null or jsonb_typeof(p_children) is distinct from 'array' or jsonb_array_length(p_children) not between 1 and 8 then raise exception 'PROJECT_SPAWN_REQUEST_INVALID'; end if;
  r:=destruktion_meta.project_authorize_h205f22(p_workspace_id,p_project_id,p_device_id,p_client_id,p_admin_grant_epoch);
  digest:=encode(extensions.digest(convert_to(jsonb_build_object('parent_task_id',p_parent_task_id,'children',p_children)::text,'UTF8'),'sha256'),'hex');
  if exists(select 1 from destruktion_meta.project_child_proposal_h205f22 where project_id=p_project_id and request_id=p_request_id and request_sha256<>digest)
  then raise exception 'PROJECT_SPAWN_REQUEST_COLLISION' using errcode='23505'; end if;
  if (select count(*) from destruktion_meta.project_child_proposal_h205f22 where project_id=p_project_id and request_id=p_request_id and status='ADMITTED')=jsonb_array_length(p_children) then
    select jsonb_agg(jsonb_build_object('child_index',child_index,'task_id',child_task_id,'depth',depth,'role',role,'status',status,'wait_reason',wait_reason) order by child_index) into result from destruktion_meta.project_child_proposal_h205f22 where project_id=p_project_id and request_id=p_request_id;
    return jsonb_build_object('schema','metaengine.devos.project-spawn.v1','project_id',p_project_id,'parent_task_id',p_parent_task_id,'request_id',p_request_id,'replayed',true,'children',result,'proposals_preserved',true,'leases_allocated',false,'automatic_retry_allowed',false,'scheduler_authority',false,'authority_effect',false);
  end if;
  auth:=destruktion_meta.project_parent_h205f22(p_workspace_id,p_project_id,p_parent_task_id,p_claim_id,p_lease_generation,p_device_id,p_client_id,p_admin_grant_epoch);
  select * into r from destruktion_meta.project_run_h205f22 where project_id=p_project_id for update;
  select * into parent from destruktion_meta.project_task_h205f22 where task_id=p_parent_task_id and project_id=p_project_id;
  digest:=encode(extensions.digest(convert_to(jsonb_build_object('parent_task_id',p_parent_task_id,'children',p_children)::text,'UTF8'),'sha256'),'hex');
  if exists(select 1 from destruktion_meta.project_child_proposal_h205f22 where project_id=p_project_id and request_id=p_request_id and request_sha256<>digest)
  then raise exception 'PROJECT_SPAWN_REQUEST_COLLISION' using errcode='23505'; end if;
  for child in select value from jsonb_array_elements(p_children) loop
    if jsonb_typeof(child) is distinct from 'object' or (select count(*) from jsonb_object_keys(child))<>2 or not (child ?& array['objective','role'])
      or jsonb_typeof(child->'objective') is distinct from 'string' or length(btrim(child->>'objective')) not between 1 and 4000
      or child->>'role' not in ('PLANNER','RESEARCHER','IMPLEMENTER','CRITIC','FALSIFIER','SYNTHESIZER','CODER','INTEGRATOR') then raise exception 'PROJECT_CHILD_PROPOSAL_INVALID' using errcode='22023'; end if;
    insert into destruktion_meta.project_child_proposal_h205f22(project_id,request_id,child_index,request_sha256,parent_task_id,depth,role,objective,status)
      values(p_project_id,p_request_id,idx,digest,p_parent_task_id,parent.depth+1,case child->>'role' when 'CODER' then 'IMPLEMENTER' when 'INTEGRATOR' then 'SYNTHESIZER' else child->>'role' end,btrim(child->>'objective'),'BUDGET_WAIT')
      on conflict do nothing returning * into proposal;
    if not found then select * into proposal from destruktion_meta.project_child_proposal_h205f22 where project_id=p_project_id and request_id=p_request_id and child_index=idx;
    else replay:=false; end if;
    if proposal.child_task_id is null then
      reason:=null;
      select count(*) into count_children from destruktion_meta.project_task_h205f22 where project_id=p_project_id and parent_task_id=p_parent_task_id;
      if r.max_depth is not null and proposal.depth>r.max_depth then reason:='DEPTH_BUDGET';
      elsif r.max_tasks is not null and r.total_tasks>=r.max_tasks then reason:='TASK_BUDGET';
      elsif r.max_children is not null and count_children>=r.max_children then reason:='CHILD_BUDGET'; end if;
      -- READY is logical demand for the existing fleet governor. Requiring an
      -- idle agent here would prevent the governor from seeing new role demand.
      -- Only the existing scheduler can allocate a physical lease.
      if reason is not null then
        update destruktion_meta.project_child_proposal_h205f22 set status=case when reason like '%BUDGET' then 'BUDGET_WAIT' else 'CAPACITY_WAIT' end,wait_reason=reason
          where project_id=p_project_id and request_id=p_request_id and child_index=idx returning * into proposal;
        perform destruktion_meta.project_append_h205f22(p_project_id,'CHILD_PROPOSAL_WAIT',p_parent_task_id,p_lease_generation,auth->'claim'->>'agent_id',null,null,null,
          jsonb_build_object('request_id',p_request_id,'child_index',idx,'role',proposal.role,'objective',proposal.objective,'reason',reason),'UNTRUSTED_PROPOSAL',null,false,'wait:'||p_request_id||':'||idx||':'||reason||':'||r.policy_generation);
      else
        spec:=jsonb_build_object('schema','metaengine.devos.project-task-spec.v1','claim_class',case when proposal.role in ('RESEARCHER','CRITIC','FALSIFIER') then 'READ_ONLY' else 'MUTATING' end,
          'objective',proposal.objective,'deliverable',coalesce(auth->'task'->'task_spec'->>'deliverable',r.goal),
          'constraints',coalesce(auth->'task'->'task_spec'->'constraints','[]'::jsonb),'source_branch',auth->'task'->>'branch_name',
          'project_continuity',jsonb_build_object('schema','metaengine.devos.project-task.v1','project_id',p_project_id,'root_task_id',r.root_task_id,'parent_task_id',p_parent_task_id,
            'depth',proposal.depth,'root_request_id',r.request_id,'spawn_request_id',p_request_id,'child_index',idx),
          'automatic_retry_allowed',false,'model_output_authority',false,'scheduler_authority',false,'authority_effect',false);
        enqueued:=public.devos_fleet_enqueue_v1(p_workspace_id,'project.'||replace(p_project_id::text,'-','')||'.'||replace(p_request_id::text,'-','')||'.'||idx,proposal.role,
          auth->'task'->>'base_sha',spec,'project-child:'||p_project_id||':'||p_request_id||':'||idx,
          'work/project-'||replace(p_project_id::text,'-','')||'-'||replace(p_request_id::text,'-','')||'-'||idx,50);
        if (enqueued->>'accepted')::boolean is distinct from true then raise exception 'PROJECT_CHILD_ENQUEUE_REJECTED'; end if;
        id:=(enqueued->>'task_id')::uuid;
        update destruktion_meta.project_run_h205f22 set total_tasks=total_tasks+1 where project_id=p_project_id returning * into r;
        insert into destruktion_meta.project_task_h205f22 values(id,p_project_id,r.total_tasks,r.root_task_id,p_parent_task_id,proposal.depth);
        update destruktion_meta.project_child_proposal_h205f22 set child_task_id=id,status='ADMITTED',wait_reason=null where project_id=p_project_id and request_id=p_request_id and child_index=idx returning * into proposal;
        perform destruktion_meta.project_append_h205f22(p_project_id,'CHILD_TASK_ADMITTED',id,0,auth->'claim'->>'agent_id',null,null,null,
          jsonb_build_object('request_id',p_request_id,'child_index',idx,'parent_task_id',p_parent_task_id,'depth',proposal.depth,'role',proposal.role,'objective',proposal.objective),'DATABASE_ADMISSION',null,false,'child:'||p_request_id||':'||idx);
      end if;
    end if;
    result:=result||jsonb_build_array(jsonb_build_object('child_index',idx,'task_id',proposal.child_task_id,'depth',proposal.depth,'role',proposal.role,'status',proposal.status,'wait_reason',proposal.wait_reason));
    idx:=idx+1;
  end loop;
  return jsonb_build_object('schema','metaengine.devos.project-spawn.v1','project_id',p_project_id,'parent_task_id',p_parent_task_id,'request_id',p_request_id,'replayed',replay,
    'children',result,'proposals_preserved',true,'leases_allocated',false,'automatic_retry_allowed',false,'scheduler_authority',false,'authority_effect',false);
end $$;

create function public.h205f22_project_activity_v1(p_workspace_id uuid,p_project_id uuid,p_task_id uuid,p_claim_id bigint,p_lease_generation bigint,p_request_id uuid,
  p_event_type text,p_causal_parent_seq bigint,p_tool text,p_artifact text,p_content jsonb,p_receipt_event_id bigint,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,pg_temp as $$
declare auth jsonb; verified boolean:=false; seq bigint;
begin
  if p_request_id is null or coalesce(p_event_type,'') !~ '^[A-Z][A-Z0-9_]{0,95}$' or jsonb_typeof(p_content) is distinct from 'object'
    or octet_length(p_content::text)>8192 or length(coalesce(p_tool,''))>160 or length(coalesce(p_artifact,''))>512
  then raise exception 'PROJECT_ACTIVITY_REQUEST_INVALID' using errcode='22023'; end if;
  auth:=destruktion_meta.project_parent_h205f22(p_workspace_id,p_project_id,p_task_id,p_claim_id,p_lease_generation,p_device_id,p_client_id,p_admin_grant_epoch);
  if p_receipt_event_id is not null then
    select exists(select 1 from destruktion_meta.devos_fleet_event_h205f22 where event_id=p_receipt_event_id and workspace_id=p_workspace_id and task_id=p_task_id and lease_generation=p_lease_generation and authority_effect=false) into verified;
    if not verified then raise exception 'PROJECT_RECEIPT_SCOPE_DENIED' using errcode='42501'; end if;
  end if;
  seq:=destruktion_meta.project_append_h205f22(p_project_id,p_event_type,p_task_id,p_lease_generation,auth->'claim'->>'agent_id',p_causal_parent_seq,p_tool,p_artifact,p_content,'UNTRUSTED_ACTIVITY',p_receipt_event_id,verified,'activity:'||p_request_id);
  return jsonb_build_object('schema','metaengine.devos.project-activity.v1','project_id',p_project_id,'request_id',p_request_id,'seq',seq,'receipt_reference_verified',verified,
    'verified_evidence',false,'content_is_authority',false,'automatic_retry_allowed',false,'authority_effect',false);
end $$;

create function public.h205f22_project_policy_v1(p_workspace_id uuid,p_project_id uuid,p_expected_generation bigint,p_max_depth integer,p_max_tasks bigint,p_max_children bigint,
  p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,pg_temp as $$
declare r destruktion_meta.project_run_h205f22%rowtype;
begin
  r:=destruktion_meta.project_authorize_h205f22(p_workspace_id,p_project_id,p_device_id,p_client_id,p_admin_grant_epoch);
  select * into r from destruktion_meta.project_run_h205f22 where project_id=p_project_id for update;
  if r.policy_generation is distinct from p_expected_generation or p_max_depth<0 or p_max_tasks<1 or p_max_children<1 then raise exception 'PROJECT_POLICY_FENCED' using errcode='55000'; end if;
  update destruktion_meta.project_run_h205f22 set policy_generation=policy_generation+1,max_depth=p_max_depth,max_tasks=p_max_tasks,max_children=p_max_children where project_id=p_project_id returning * into r;
  perform destruktion_meta.project_append_h205f22(p_project_id,'PROJECT_POLICY_UPDATED',r.root_task_id,null,p_client_id,null,null,null,
    jsonb_build_object('generation',r.policy_generation,'max_depth',r.max_depth,'max_tasks',r.max_tasks,'max_children',r.max_children),'DATABASE_POLICY',null,false,'policy:'||r.policy_generation);
  return jsonb_build_object('schema','metaengine.devos.project-policy.v1','project_id',p_project_id,'policy',jsonb_build_object('generation',r.policy_generation,'max_depth',r.max_depth,'max_tasks',r.max_tasks,'max_children',r.max_children),'automatic_retry_allowed',false,'authority_effect',false);
end $$;

-- A digest-bound model result is still a claim. Completion requires an
-- independently transported verifier, and all descendants must be terminal.
create function destruktion_meta.project_result_bound_h205f22(p_task uuid,p_disposition text)
returns boolean language sql security definer set search_path=pg_catalog,destruktion_meta,extensions,pg_temp as $$
 select exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 t
   join destruktion_meta.devos_fleet_event_h205f22 e on e.task_id=t.task_id and e.workspace_id=t.workspace_id and e.lease_generation=t.lease_generation and e.event_type='TASK_TRANSPORT_PROVEN' and e.agent_id=t.lease_agent_id and e.base_sha=t.base_sha and e.authority_effect=false
   join destruktion_meta.devos_fleet_event_h205f22 result on result.task_id=t.task_id and result.workspace_id=t.workspace_id and result.lease_generation=t.lease_generation and result.event_type='TASK_RESULT_RESULT_READY' and result.agent_id=t.lease_agent_id and result.base_sha=t.base_sha and result.authority_effect=false
   where t.task_id=p_task and t.state in ('RESULT_READY','COMPLETED') and jsonb_typeof(t.result_summary)='object'
     and t.result_summary_sha256=encode(extensions.digest(convert_to(t.result_summary::text,'UTF8'),'sha256'),'hex') and t.result_sha256=t.result_summary_sha256
     and t.result_summary->>'result_claim_schema'='metaengine.agent-result-claim.v1' and coalesce(t.result_summary->>'result_claim_sha256','')~'^[0-9a-f]{64}$'
     and t.result_summary->>'result_claim_disposition'=p_disposition and t.result_summary->>'model_claim_authority'='false'
     and coalesce(t.result_summary->>'raw_model_claim_included','false')='false' and coalesce(t.result_summary->>'page_content_included','false')='false'
     and e.payload->>'agent_origin_contract'='ZAI_AGENT_SURFACE_CAUSAL_V1' and coalesce(e.payload->>'agent_surface_sha256','')~'^[0-9a-f]{64}$' and coalesce(e.payload->>'prompt_sha256','')~'^[0-9a-f]{64}$'
     and coalesce(e.payload->>'conversation_url_sha256','')~'^[0-9a-f]{64}$' and e.payload->>'conversation_url_sha256'=t.result_summary->>'conversation_url_sha256'
     and e.payload->>'effect_state' in ('PROVEN_GENERATING','PROVEN_NEW_CONVERSATION','PROVEN_CONVERSATION','PROVEN_COMPOSER_CLEARED')
     and result.payload->>'result_sha256'=t.result_sha256 and result.payload->>'result_claim_sha256'=t.result_summary->>'result_claim_sha256'
     and exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 c where c.task_id=t.task_id and c.lease_generation=t.lease_generation and c.agent_id=t.lease_agent_id and c.tab_id=t.lease_tab_id and c.target_id=t.lease_target_id and c.agent_generation_epoch=t.lease_agent_generation_epoch and c.base_sha=t.base_sha and c.state='CLOSED' and c.authority_effect=false))
$$;

create function destruktion_meta.project_completion_ready_h205f22(p_task uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,destruktion_meta,pg_temp as $$
declare t destruktion_meta.devos_fleet_task_h205f22%rowtype; subject destruktion_meta.devos_fleet_task_h205f22%rowtype; project uuid; required text; roles text[];
begin
 select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task;
 select project_id into project from destruktion_meta.project_task_h205f22 where task_id=p_task;
 if not found then return false; end if;
 if exists(with recursive descendants as (select task_id from destruktion_meta.project_task_h205f22 where project_id=project and parent_task_id=p_task union all select x.task_id from destruktion_meta.project_task_h205f22 x join descendants d on x.parent_task_id=d.task_id where x.project_id=project) select 1 from descendants d join destruktion_meta.devos_fleet_task_h205f22 z using(task_id) where z.state<>'COMPLETED')
   or exists(with recursive lineage as (select p_task as task_id union all select x.task_id from destruktion_meta.project_task_h205f22 x join lineage d on x.parent_task_id=d.task_id where x.project_id=project) select 1 from destruktion_meta.project_child_proposal_h205f22 p join lineage d on d.task_id=p.parent_task_id where p.project_id=project and p.child_task_id is null)
 then return false; end if;
 if jsonb_typeof(t.task_spec->'verification_subject')='object' then
   select * into subject from destruktion_meta.devos_fleet_task_h205f22 where task_id=(t.task_spec->'verification_subject'->>'task_id')::uuid;
   return coalesce(t.role in ('CRITIC','FALSIFIER') and destruktion_meta.project_result_bound_h205f22(p_task,'ACCEPT')
     and subject.workspace_id=t.workspace_id and subject.lease_agent_id is distinct from t.lease_agent_id
     and t.task_spec->'verification_subject'->>'result_sha256'=subject.result_summary->>'result_claim_sha256'
     and t.result_summary->>'result_claim_subject_task_id'=subject.task_id::text
     and t.result_summary->>'result_claim_subject_result_sha256'=subject.result_summary->>'result_claim_sha256',false);
 end if;
 if not destruktion_meta.project_result_bound_h205f22(p_task,'READY') then return false; end if;
 roles:=case when upper(coalesce(t.task_spec->>'risk',t.task_spec#>>'{meta_orchestrator,risk}','NORMAL'))='CRITICAL' then array['CRITIC','FALSIFIER'] else array['CRITIC'] end;
 foreach required in array roles loop
   if not exists(select 1 from destruktion_meta.project_task_h205f22 x join destruktion_meta.devos_fleet_task_h205f22 v using(task_id) where x.project_id=project and x.parent_task_id=p_task and v.role=required and v.state='COMPLETED'
     and v.lease_agent_id is distinct from t.lease_agent_id and v.task_spec->'verification_subject'->>'task_id'=t.task_id::text
     and v.task_spec->'verification_subject'->>'result_sha256'=t.result_summary->>'result_claim_sha256' and destruktion_meta.project_result_bound_h205f22(v.task_id,'ACCEPT')) then return false; end if;
 end loop;
 return true;
end $$;

create function destruktion_meta.project_task_completion_guard_h205f22() returns trigger language plpgsql security definer set search_path=pg_catalog,destruktion_meta,pg_temp as $$
declare project uuid;
begin
 select project_id into project from destruktion_meta.project_task_h205f22 where task_id=new.task_id;
 if found and new.state='COMPLETED' and old.state is distinct from 'COMPLETED' then
   perform 1 from destruktion_meta.project_run_h205f22 where project_id=project for update;
   if destruktion_meta.project_completion_ready_h205f22(new.task_id) is distinct from true then raise exception 'PROJECT_COMPLETION_DESCENDANTS_OR_VERIFICATION_PENDING' using errcode='55000'; end if;
 end if;
 return new;
end $$;
create trigger project_task_completion_guard_h205f22 before update of state on destruktion_meta.devos_fleet_task_h205f22 for each row execute function destruktion_meta.project_task_completion_guard_h205f22();

create function public.h205f22_project_reconcile_v1(p_workspace_id uuid,p_project_id uuid,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
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
       'verification_subject',jsonb_build_object('task_id',t.task_id,'result_sha256',t.result_summary->>'result_claim_sha256'),
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

create function destruktion_meta.project_task_state_history_h205f22() returns trigger language plpgsql security definer set search_path=pg_catalog,destruktion_meta,pg_temp as $$
declare id uuid;
begin
  if new.state is not distinct from old.state and new.lease_generation is not distinct from old.lease_generation then return new; end if;
  select project_id into id from destruktion_meta.project_task_h205f22 where task_id=new.task_id;
  if found then perform destruktion_meta.project_append_h205f22(id,'TASK_STATE_CHANGED',new.task_id,new.lease_generation,new.lease_agent_id,null,null,null,
    jsonb_build_object('from_state',old.state,'state',new.state,'result_sha256',new.result_sha256,'error_code',new.error_code),'DATABASE_TASK_STATE',null,false,'task-state:'||gen_random_uuid()); end if;
  return new;
end $$;
create trigger project_task_state_history_h205f22 after update of state,lease_generation on destruktion_meta.devos_fleet_task_h205f22 for each row execute function destruktion_meta.project_task_state_history_h205f22();
create function destruktion_meta.project_fleet_event_history_h205f22() returns trigger language plpgsql security definer set search_path=pg_catalog,destruktion_meta,pg_temp as $$
declare id uuid; content jsonb;
begin
  select project_id into id from destruktion_meta.project_task_h205f22 where task_id=new.task_id;
  if found then
    content:=case when octet_length(new.payload::text)<=8192 then new.payload else jsonb_build_object('payload_omitted',true) end;
    perform destruktion_meta.project_append_h205f22(id,new.event_type,new.task_id,new.lease_generation,new.agent_id,null,null,null,content,'DATABASE_FLEET_EVENT',new.event_id,true,'fleet-event:'||new.event_id);
  end if;
  return new;
end $$;
create trigger project_fleet_event_history_h205f22 after insert on destruktion_meta.devos_fleet_event_h205f22 for each row execute function destruktion_meta.project_fleet_event_history_h205f22();

revoke all on function destruktion_meta.project_device_grant_h205f22(uuid,text,bigint),destruktion_meta.project_authorize_h205f22(uuid,uuid,uuid,text,bigint),
  destruktion_meta.project_task_projection_h205f22(uuid,uuid),
  destruktion_meta.project_result_bound_h205f22(uuid,text),destruktion_meta.project_completion_ready_h205f22(uuid),destruktion_meta.project_task_completion_guard_h205f22(),
  destruktion_meta.project_append_h205f22(uuid,text,uuid,bigint,text,bigint,text,text,jsonb,text,bigint,boolean,text),
  destruktion_meta.project_parent_h205f22(uuid,uuid,uuid,bigint,bigint,uuid,text,bigint),
  destruktion_meta.project_task_state_history_h205f22(),destruktion_meta.project_fleet_event_history_h205f22() from public,anon,authenticated,service_role;
revoke all on function public.h205f22_project_register_v1(uuid,uuid,uuid,text,bigint),public.h205f22_project_snapshot_v1(uuid,uuid,uuid,bigint,integer,uuid,text,bigint),
  public.h205f22_project_reconcile_v1(uuid,uuid,uuid,text,bigint),
  public.h205f22_project_history_v1(uuid,uuid,bigint,bigint,integer,uuid,bigint,text,uuid,text,bigint),
  public.h205f22_project_spawn_v1(uuid,uuid,uuid,bigint,bigint,uuid,jsonb,uuid,text,bigint),
  public.h205f22_project_activity_v1(uuid,uuid,uuid,bigint,bigint,uuid,text,bigint,text,text,jsonb,bigint,uuid,text,bigint),
  public.h205f22_project_policy_v1(uuid,uuid,bigint,integer,bigint,bigint,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.h205f22_project_register_v1(uuid,uuid,uuid,text,bigint),public.h205f22_project_snapshot_v1(uuid,uuid,uuid,bigint,integer,uuid,text,bigint),
  public.h205f22_project_reconcile_v1(uuid,uuid,uuid,text,bigint),
  public.h205f22_project_history_v1(uuid,uuid,bigint,bigint,integer,uuid,bigint,text,uuid,text,bigint),
  public.h205f22_project_spawn_v1(uuid,uuid,uuid,bigint,bigint,uuid,jsonb,uuid,text,bigint),
  public.h205f22_project_activity_v1(uuid,uuid,uuid,bigint,bigint,uuid,text,bigint,text,text,jsonb,bigint,uuid,text,bigint),
  public.h205f22_project_policy_v1(uuid,uuid,bigint,integer,bigint,bigint,uuid,text,bigint) to service_role;
notify pgrst,'reload schema';
