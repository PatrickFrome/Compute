-- METAENGINE R1 fresh-project continuity convergence v1.
-- Canonical owner: R1 Continuity Plane Adoption.
-- Materializes contracts only: no persisted-readback evidence, no R2/R3 seal, no canonical promotion.
-- Historical migration IDs are intentionally not replayed because their original ordering assumed pre-existing R1 objects.

select pg_catalog.set_config('lock_timeout','3s',true);
select pg_catalog.set_config('statement_timeout','45s',true);
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('metaengine:r1-continuity:fresh-project-convergence:v1',0));

do $preflight$
declare
  v_existing integer;
begin
  if pg_catalog.to_regnamespace('destruktion_meta') is null then
    raise exception 'r1_continuity_schema_missing';
  end if;
  if pg_catalog.to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'r1_continuity_digest_missing';
  end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='anon')
     or not exists(select 1 from pg_catalog.pg_roles where rolname='authenticated')
     or not exists(select 1 from pg_catalog.pg_roles where rolname='service_role') then
    raise exception 'r1_continuity_required_roles_missing';
  end if;
  select count(*) into v_existing
  from (
    select c.relname::text as name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='destruktion_meta'
      and c.relname like 'compute_continuity_%'
    union all
    select p.proname::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='destruktion_meta'
      and (p.proname like 'compute_continuity_%' or p.proname='compute_restore_quorum_status_h205f22')
  ) q;
  if v_existing <> 0 then
    raise exception 'r1_continuity_preexisting_artifact:%',v_existing;
  end if;
end;
$preflight$;

create table if not exists destruktion_meta.compute_continuity_domain_h205f22 (
  domain_key text primary key,
  provider_kind text not null,
  operator_class text not null,
  failure_domain text not null,
  independence_basis text not null,
  physical_region_independence_claimed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (length(domain_key) between 3 and 160),
  check (length(operator_class) between 2 and 160),
  check (length(failure_domain) between 2 and 160)
);
create table if not exists destruktion_meta.compute_continuity_object_h205f22 (
  object_id uuid primary key default gen_random_uuid(),
  subject_kind text not null check (subject_kind in ('CHECKPOINT','ARTIFACT','BACKUP_SET')),
  subject_id text not null,
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  expected_bytes bigint check (expected_bytes is null or expected_bytes >= 0),
  payload_root_sha256 text check (payload_root_sha256 is null or payload_root_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_checkpoint_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(subject_kind, subject_id, expected_sha256)
);
create table if not exists destruktion_meta.compute_continuity_observation_h205f22 (
  observation_id bigint generated always as identity primary key,
  object_id uuid not null references destruktion_meta.compute_continuity_object_h205f22(object_id),
  domain_key text not null references destruktion_meta.compute_continuity_domain_h205f22(domain_key),
  status text not null check (status in ('VERIFIED','MISMATCH','MISSING','STALE','ERROR')),
  observed_sha256 text check (observed_sha256 is null or observed_sha256 ~ '^[0-9a-f]{64}$'),
  observed_bytes bigint check (observed_bytes is null or observed_bytes >= 0),
  persisted_at timestamptz,
  readback_at timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (readback_at is null or persisted_at is null or readback_at >= persisted_at)
);
create table if not exists destruktion_meta.compute_continuity_repair_h205f22 (
  repair_id uuid primary key default gen_random_uuid(),
  object_id uuid not null references destruktion_meta.compute_continuity_object_h205f22(object_id),
  bad_observation_id bigint not null references destruktion_meta.compute_continuity_observation_h205f22(observation_id),
  replacement_observation_id bigint not null references destruktion_meta.compute_continuity_observation_h205f22(observation_id),
  status text not null check (status = 'VERIFIED_REPLACEMENT'),
  receipt_sha256 text not null check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (bad_observation_id <> replacement_observation_id),
  unique(bad_observation_id, replacement_observation_id)
);
create table if not exists destruktion_meta.compute_continuity_retention_event_h205f22 (
  event_id bigint generated always as identity primary key,
  lease_id uuid not null,
  action text not null check (action in ('ACQUIRE','RELEASE')),
  subject_kind text not null check (subject_kind in ('CHECKPOINT','ARTIFACT','BACKUP_SET')),
  subject_id text not null,
  lease_class text not null,
  valid_until timestamptz,
  release_of_event_id bigint references destruktion_meta.compute_continuity_retention_event_h205f22(event_id),
  reason text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check ((action='ACQUIRE' and release_of_event_id is null) or (action='RELEASE' and release_of_event_id is not null))
);
create table if not exists destruktion_meta.compute_continuity_restore_drill_h205f22 (
  restore_receipt_id uuid primary key default gen_random_uuid(),
  object_id uuid not null references destruktion_meta.compute_continuity_object_h205f22(object_id),
  domain_key text not null references destruktion_meta.compute_continuity_domain_h205f22(domain_key),
  status text not null check (status in ('PASS','FAIL')),
  readback_verified boolean not null default false,
  restored_sha256 text check (restored_sha256 is null or restored_sha256 ~ '^[0-9a-f]{64}$'),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  receipt_sha256 text not null check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (finished_at >= started_at)
);
create table if not exists destruktion_meta.compute_continuity_recovery_graph_node_h205f22 (
  graph_key text not null,
  node_kind text not null,
  node_key text not null,
  node_sha256 text not null check (node_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(graph_key,node_kind,node_key)
);
create table if not exists destruktion_meta.compute_continuity_recovery_graph_snapshot_h205f22 (
  graph_key text primary key,
  base_object_id uuid references destruktion_meta.compute_continuity_object_h205f22(object_id),
  node_count integer not null check (node_count >= 1),
  graph_root_sha256 text not null check (graph_root_sha256 ~ '^[0-9a-f]{64}$'),
  root_line_format text not null default 'TYPE<TAB>KEY<TAB>NODE_SHA256 sorted lexicographically',
  status text not null default 'SEALED' check (status='SEALED'),
  created_at timestamptz not null default now()
);
create table if not exists destruktion_meta.compute_continuity_checkpoint_ledger_h205f22 (
  continuity_checkpoint_id text primary key,
  parent_continuity_checkpoint_id text references destruktion_meta.compute_continuity_checkpoint_ledger_h205f22(continuity_checkpoint_id),
  semantic_head_checkpoint_id text not null,
  milestone_key text not null default 'R1_CONTINUITY_PLANE_ADOPTION',
  state text not null check (state in ('IMPLEMENTED','TESTED','EVIDENCE_READY')),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists destruktion_meta.compute_continuity_persisted_seal_h205f22 (
  seal_id uuid primary key default gen_random_uuid(),
  object_id uuid not null references destruktion_meta.compute_continuity_object_h205f22(object_id),
  seal_kind text not null default 'PERSISTED_READBACK_QUORUM' check (seal_kind='PERSISTED_READBACK_QUORUM'),
  readiness jsonb not null,
  receipt_sha256 text not null check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(object_id,receipt_sha256)
);
create index if not exists compute_continuity_observation_object_domain_idx on destruktion_meta.compute_continuity_observation_h205f22(object_id,domain_key,observation_id desc);
create index if not exists compute_continuity_observation_domain_idx on destruktion_meta.compute_continuity_observation_h205f22(domain_key);
create index if not exists compute_continuity_repair_object_idx on destruktion_meta.compute_continuity_repair_h205f22(object_id);
create index if not exists compute_continuity_repair_replacement_idx on destruktion_meta.compute_continuity_repair_h205f22(replacement_observation_id);
create index if not exists compute_continuity_retention_subject_idx on destruktion_meta.compute_continuity_retention_event_h205f22(subject_kind,subject_id,lease_id,event_id desc);
create index if not exists compute_continuity_retention_release_idx on destruktion_meta.compute_continuity_retention_event_h205f22(release_of_event_id);
create index if not exists compute_continuity_restore_object_domain_idx on destruktion_meta.compute_continuity_restore_drill_h205f22(object_id,domain_key,finished_at desc);
create index if not exists compute_continuity_restore_domain_idx on destruktion_meta.compute_continuity_restore_drill_h205f22(domain_key);
create index if not exists compute_continuity_graph_snapshot_object_idx on destruktion_meta.compute_continuity_recovery_graph_snapshot_h205f22(base_object_id);
create index if not exists compute_continuity_checkpoint_parent_idx on destruktion_meta.compute_continuity_checkpoint_ledger_h205f22(parent_continuity_checkpoint_id);

create or replace function destruktion_meta.compute_continuity_immutable_h205f22()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'H205F22 continuity evidence is append-only: %.% % forbidden',tg_table_schema,tg_table_name,tg_op using errcode='55000';
end;
$$;
create or replace function destruktion_meta.compute_continuity_graph_node_insert_guard_h205f22()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from destruktion_meta.compute_continuity_recovery_graph_snapshot_h205f22 s where s.graph_key=new.graph_key) then raise exception 'recovery graph % is already sealed',new.graph_key using errcode='55000'; end if;
  return new;
end;
$$;
create or replace function destruktion_meta.compute_continuity_observation_insert_guard_h205f22()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_expected_sha text; v_expected_bytes bigint;
begin
  select o.expected_sha256,o.expected_bytes into v_expected_sha,v_expected_bytes from destruktion_meta.compute_continuity_object_h205f22 o where o.object_id=new.object_id;
  if not found then raise exception 'unknown continuity object %',new.object_id using errcode='23503'; end if;
  if new.status='VERIFIED' then
    if new.persisted_at is null or new.readback_at is null then new.status:='ERROR';
    elsif new.observed_sha256 is null then new.status:='MISSING';
    elsif lower(new.observed_sha256)<>v_expected_sha then new.status:='MISMATCH';
    elsif v_expected_bytes is not null and new.observed_bytes is distinct from v_expected_bytes then new.status:='MISMATCH'; end if;
  end if;
  new.observed_sha256:=lower(new.observed_sha256); return new;
end;
$$;
create or replace function destruktion_meta.compute_continuity_repair_insert_guard_h205f22()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_bad destruktion_meta.compute_continuity_observation_h205f22%rowtype; v_new destruktion_meta.compute_continuity_observation_h205f22%rowtype;
begin
  select * into v_bad from destruktion_meta.compute_continuity_observation_h205f22 where observation_id=new.bad_observation_id;
  if not found then raise exception 'bad observation not found' using errcode='23503'; end if;
  select * into v_new from destruktion_meta.compute_continuity_observation_h205f22 where observation_id=new.replacement_observation_id;
  if not found then raise exception 'replacement observation not found' using errcode='23503'; end if;
  if v_bad.object_id<>new.object_id or v_new.object_id<>new.object_id then raise exception 'repair observations must reference repair object' using errcode='23514'; end if;
  if v_bad.status not in ('MISMATCH','MISSING','STALE','ERROR') then raise exception 'bad observation must be non-VERIFIED' using errcode='23514'; end if;
  if v_new.status<>'VERIFIED' or v_new.readback_at is null then raise exception 'replacement must be VERIFIED by persisted readback' using errcode='23514'; end if;
  return new;
end;
$$;
create or replace function destruktion_meta.compute_continuity_retention_insert_guard_h205f22()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_acq destruktion_meta.compute_continuity_retention_event_h205f22%rowtype;
begin
  if new.action='ACQUIRE' then if new.release_of_event_id is not null then raise exception 'ACQUIRE cannot release another event' using errcode='23514'; end if; return new; end if;
  select * into v_acq from destruktion_meta.compute_continuity_retention_event_h205f22 where event_id=new.release_of_event_id;
  if not found or v_acq.action<>'ACQUIRE' then raise exception 'RELEASE must reference an ACQUIRE event' using errcode='23514'; end if;
  if v_acq.lease_id<>new.lease_id or v_acq.subject_kind<>new.subject_kind or v_acq.subject_id<>new.subject_id or v_acq.lease_class<>new.lease_class then raise exception 'RELEASE identity must match acquired lease' using errcode='23514'; end if;
  if exists(select 1 from destruktion_meta.compute_continuity_retention_event_h205f22 r where r.action='RELEASE' and r.release_of_event_id=new.release_of_event_id) then raise exception 'lease acquire event % already released',new.release_of_event_id using errcode='23505'; end if;
  return new;
end;
$$;
create or replace function destruktion_meta.compute_continuity_restore_insert_guard_h205f22()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_expected_sha text;
begin
  select expected_sha256 into v_expected_sha from destruktion_meta.compute_continuity_object_h205f22 where object_id=new.object_id;
  if not found then raise exception 'unknown continuity object %',new.object_id using errcode='23503'; end if;
  if new.status='PASS' and (new.readback_verified is not true or new.restored_sha256 is null or lower(new.restored_sha256)<>v_expected_sha) then new.status:='FAIL'; end if;
  new.restored_sha256:=lower(new.restored_sha256); return new;
end;
$$;
create or replace function destruktion_meta.compute_record_continuity_observation_h205f22(p_object_id uuid,p_domain_key text,p_status text,p_observed_sha256 text,p_observed_bytes bigint,p_persisted_at timestamptz,p_readback_at timestamptz,p_evidence jsonb default '{}'::jsonb)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare v_expected_sha text; v_expected_bytes bigint; v_status text; v_id bigint;
begin
  select o.expected_sha256,o.expected_bytes into v_expected_sha,v_expected_bytes from destruktion_meta.compute_continuity_object_h205f22 o where o.object_id=p_object_id;
  if not found then raise exception 'unknown continuity object %',p_object_id using errcode='23503'; end if;
  perform 1 from destruktion_meta.compute_continuity_domain_h205f22 d where d.domain_key=p_domain_key;
  if not found then raise exception 'unknown continuity domain %',p_domain_key using errcode='23503'; end if;
  v_status:=upper(coalesce(p_status,'ERROR'));
  if v_status not in ('VERIFIED','MISMATCH','MISSING','STALE','ERROR') then raise exception 'invalid continuity observation status %',v_status using errcode='22023'; end if;
  if v_status='VERIFIED' then if p_persisted_at is null or p_readback_at is null then v_status:='ERROR'; elsif p_observed_sha256 is null then v_status:='MISSING'; elsif lower(p_observed_sha256)<>v_expected_sha then v_status:='MISMATCH'; elsif v_expected_bytes is not null and p_observed_bytes is distinct from v_expected_bytes then v_status:='MISMATCH'; end if; end if;
  insert into destruktion_meta.compute_continuity_observation_h205f22(object_id,domain_key,status,observed_sha256,observed_bytes,persisted_at,readback_at,evidence)
  values(p_object_id,p_domain_key,v_status,lower(p_observed_sha256),p_observed_bytes,p_persisted_at,p_readback_at,coalesce(p_evidence,'{}'::jsonb)) returning observation_id into v_id;
  return v_id;
end;
$$;
create or replace function destruktion_meta.compute_continuity_readiness_h205f22(p_object_id uuid,p_effective_at timestamptz default now(),p_max_age interval default interval '7 days')
returns jsonb language sql security invoker set search_path = '' as $$
with latest as (
 select distinct on (o.domain_key) o.domain_key,case when o.status='VERIFIED' and o.readback_at is not null and o.readback_at>=p_effective_at-p_max_age then 'VERIFIED' when o.status='VERIFIED' then 'STALE' else o.status end effective_status
 from destruktion_meta.compute_continuity_observation_h205f22 o where o.object_id=p_object_id order by o.domain_key,coalesce(o.readback_at,o.created_at) desc,o.observation_id desc
),good as (select l.domain_key,d.failure_domain,d.operator_class from latest l join destruktion_meta.compute_continuity_domain_h205f22 d using(domain_key) where l.effective_status='VERIFIED'),
agg as (select count(*)::int verified_domains,count(distinct failure_domain)::int failure_domains,count(distinct operator_class)::int operator_classes from good)
select jsonb_build_object('schema','metaengine.compute.continuity-readiness.h205f22.v1','object_id',p_object_id,'verified_domains',verified_domains,'failure_domains',failure_domains,'operator_classes',operator_classes,'minimum_required',2,'r2_proven',(verified_domains>=2 and failure_domains>=2 and operator_classes>=2),'status',case when verified_domains>=2 and failure_domains>=2 and operator_classes>=2 then 'R2_PROVEN' else 'R2_NOT_PROVEN' end) from agg;
$$;
create or replace function destruktion_meta.compute_continuity_audit_status_h205f22(p_object_id uuid,p_effective_at timestamptz default now(),p_max_age interval default interval '7 days')
returns jsonb language sql security invoker set search_path = '' as $$
with latest as (
 select distinct on (o.domain_key) o.observation_id,o.domain_key,case when o.status='VERIFIED' and o.readback_at is not null and o.readback_at>=p_effective_at-p_max_age then 'VERIFIED' when o.status='VERIFIED' then 'STALE' else o.status end effective_status
 from destruktion_meta.compute_continuity_observation_h205f22 o where o.object_id=p_object_id order by o.domain_key,coalesce(o.readback_at,o.created_at) desc,o.observation_id desc
),counts as (select count(*) filter(where effective_status='VERIFIED')::int verified,count(*) filter(where effective_status='MISMATCH')::int mismatch,count(*) filter(where effective_status='MISSING')::int missing,count(*) filter(where effective_status='STALE')::int stale,count(*) filter(where effective_status='ERROR')::int errors from latest),
unrepaired as (select count(*)::int n from latest l where l.effective_status in ('MISMATCH','MISSING','STALE','ERROR') and not exists(select 1 from destruktion_meta.compute_continuity_repair_h205f22 r where r.bad_observation_id=l.observation_id and r.status='VERIFIED_REPLACEMENT'))
select jsonb_build_object('schema','metaengine.compute.continuity-audit-status.h205f22.v1','object_id',p_object_id,'verified',verified,'mismatch',mismatch,'missing',missing,'stale',stale,'errors',errors,'unrepaired_latest',unrepaired.n,'repair_required',(unrepaired.n>0),'status',case when mismatch+missing+stale+errors=0 and verified>0 then 'PASS' else 'REPAIR_OR_READBACK_REQUIRED' end) from counts cross join unrepaired;
$$;
create or replace function destruktion_meta.compute_record_continuity_repair_h205f22(p_bad_observation_id bigint,p_replacement_observation_id bigint,p_receipt_sha256 text,p_evidence jsonb default '{}'::jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_bad destruktion_meta.compute_continuity_observation_h205f22%rowtype; v_new destruktion_meta.compute_continuity_observation_h205f22%rowtype; v_repair_id uuid;
begin
 select * into v_bad from destruktion_meta.compute_continuity_observation_h205f22 where observation_id=p_bad_observation_id; if not found then raise exception 'bad observation not found' using errcode='23503'; end if;
 select * into v_new from destruktion_meta.compute_continuity_observation_h205f22 where observation_id=p_replacement_observation_id; if not found then raise exception 'replacement observation not found' using errcode='23503'; end if;
 if v_bad.object_id<>v_new.object_id then raise exception 'repair observations must reference the same object' using errcode='23514'; end if;
 if v_bad.status not in ('MISMATCH','MISSING','STALE','ERROR') then raise exception 'bad observation must be non-VERIFIED, got %',v_bad.status using errcode='23514'; end if;
 if v_new.status<>'VERIFIED' or v_new.readback_at is null then raise exception 'replacement must be VERIFIED by persisted readback' using errcode='23514'; end if;
 if p_receipt_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid repair receipt sha256' using errcode='22023'; end if;
 insert into destruktion_meta.compute_continuity_repair_h205f22(object_id,bad_observation_id,replacement_observation_id,status,receipt_sha256,evidence) values(v_bad.object_id,p_bad_observation_id,p_replacement_observation_id,'VERIFIED_REPLACEMENT',p_receipt_sha256,coalesce(p_evidence,'{}'::jsonb)) returning repair_id into v_repair_id; return v_repair_id;
end;
$$;
create or replace function destruktion_meta.compute_continuity_retention_status_h205f22(p_subject_kind text,p_subject_id text,p_effective_at timestamptz default now())
returns jsonb language sql security invoker set search_path = '' as $$
with acquired as (select a.* from destruktion_meta.compute_continuity_retention_event_h205f22 a where a.action='ACQUIRE' and a.subject_kind=p_subject_kind and a.subject_id=p_subject_id),active as (select a.* from acquired a where (a.valid_until is null or a.valid_until>p_effective_at) and not exists(select 1 from destruktion_meta.compute_continuity_retention_event_h205f22 r where r.action='RELEASE' and r.release_of_event_id=a.event_id and r.created_at<=p_effective_at))
select jsonb_build_object('schema','metaengine.compute.retention-status.h205f22.v1','subject_kind',p_subject_kind,'subject_id',p_subject_id,'active_lease_count',(select count(*) from active),'status',case when exists(select 1 from active) then 'PROTECTED' else 'UNPROTECTED' end);
$$;
create or replace function destruktion_meta.compute_continuity_gc_admission_h205f22(p_subject_kind text,p_subject_id text,p_effective_at timestamptz default now())
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_retention jsonb; v_known boolean; v_graph_refs int;
begin
 if p_subject_kind not in ('CHECKPOINT','ARTIFACT','BACKUP_SET') then raise exception 'invalid subject_kind %',p_subject_kind using errcode='22023'; end if;
 select exists(select 1 from destruktion_meta.compute_continuity_object_h205f22 o where o.subject_kind=p_subject_kind and o.subject_id=p_subject_id) into v_known;
 v_retention:=destruktion_meta.compute_continuity_retention_status_h205f22(p_subject_kind,p_subject_id,p_effective_at);
 select count(*)::int into v_graph_refs from destruktion_meta.compute_continuity_recovery_graph_node_h205f22 n join destruktion_meta.compute_continuity_recovery_graph_snapshot_h205f22 s using(graph_key) where n.node_kind=p_subject_kind and n.node_key=p_subject_id;
 return jsonb_build_object('schema','metaengine.compute.continuity-gc-admission.h205f22.v1','subject_kind',p_subject_kind,'subject_id',p_subject_id,'known_object',v_known,'active_retention_leases',(v_retention->>'active_lease_count')::int,'sealed_graph_references',v_graph_refs,'delete_allowed',(v_known and (v_retention->>'status')='UNPROTECTED' and v_graph_refs=0),'status',case when not v_known then 'DELETE_BLOCKED_UNKNOWN_SUBJECT' when (v_retention->>'status')='PROTECTED' then 'DELETE_BLOCKED_RETENTION' when v_graph_refs>0 then 'DELETE_BLOCKED_RECOVERY_GRAPH_REFERENCE' else 'DELETE_ADMISSIBLE' end);
end;
$$;
create or replace function destruktion_meta.compute_restore_quorum_status_h205f22(p_object_id uuid,p_effective_at timestamptz default now(),p_max_age interval default interval '7 days')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_r2 jsonb; v_expected text; v_domains int; v_groups int; v_operators int;
begin
 v_r2:=destruktion_meta.compute_continuity_readiness_h205f22(p_object_id,p_effective_at,p_max_age);
 if coalesce((v_r2->>'r2_proven')::boolean,false) is not true then return jsonb_build_object('schema','metaengine.compute.restore-quorum-status.h205f22.v1','object_id',p_object_id,'r2',v_r2,'r3_proven',false,'status','R3_BLOCKED_R2_NOT_PROVEN'); end if;
 select expected_sha256 into v_expected from destruktion_meta.compute_continuity_object_h205f22 where object_id=p_object_id;
 with latest as (select distinct on (r.domain_key) r.* from destruktion_meta.compute_continuity_restore_drill_h205f22 r where r.object_id=p_object_id and r.finished_at>=p_effective_at-p_max_age order by r.domain_key,r.finished_at desc,r.created_at desc),good as (select l.domain_key,d.failure_domain,d.operator_class from latest l join destruktion_meta.compute_continuity_domain_h205f22 d using(domain_key) where l.status='PASS' and l.readback_verified and l.restored_sha256=v_expected)
 select count(*)::int,count(distinct failure_domain)::int,count(distinct operator_class)::int into v_domains,v_groups,v_operators from good;
 return jsonb_build_object('schema','metaengine.compute.restore-quorum-status.h205f22.v1','object_id',p_object_id,'r2',v_r2,'restore_domains',v_domains,'failure_domains',v_groups,'operator_classes',v_operators,'r3_proven',(v_domains>=2 and v_groups>=2 and v_operators>=2),'status',case when v_domains>=2 and v_groups>=2 and v_operators>=2 then 'R3_PROVEN' else 'R3_NOT_PROVEN' end);
end;
$$;
create or replace function destruktion_meta.compute_finalize_recovery_graph_h205f22(p_graph_key text,p_base_object_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_count int; v_root text;
begin
 if exists(select 1 from destruktion_meta.compute_continuity_recovery_graph_snapshot_h205f22 where graph_key=p_graph_key) then raise exception 'graph % already sealed',p_graph_key using errcode='23505'; end if;
 select count(*)::int,encode(extensions.digest(coalesce(string_agg(node_kind||E'\t'||node_key||E'\t'||node_sha256,E'\n' order by node_kind,node_key),''),'sha256'),'hex') into v_count,v_root from destruktion_meta.compute_continuity_recovery_graph_node_h205f22 where graph_key=p_graph_key;
 if v_count<1 then raise exception 'cannot seal empty recovery graph %',p_graph_key using errcode='23514'; end if;
 insert into destruktion_meta.compute_continuity_recovery_graph_snapshot_h205f22(graph_key,base_object_id,node_count,graph_root_sha256) values(p_graph_key,p_base_object_id,v_count,v_root);
 return jsonb_build_object('schema','metaengine.compute.recovery-graph-snapshot.h205f22.v1','graph_key',p_graph_key,'node_count',v_count,'graph_root_sha256',v_root,'status','SEALED');
end;
$$;
create or replace function destruktion_meta.compute_continuity_persisted_seal_insert_guard_h205f22()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_readiness jsonb;
begin
 v_readiness:=destruktion_meta.compute_continuity_readiness_h205f22(new.object_id,now(),interval '7 days');
 if coalesce((v_readiness->>'r2_proven')::boolean,false) is not true then raise exception 'persisted seal requires real current two-domain readback quorum' using errcode='23514'; end if;
 new.readiness:=v_readiness; return new;
end;
$$;

drop trigger if exists compute_continuity_domain_immutable_h205f22 on destruktion_meta.compute_continuity_domain_h205f22;
create trigger compute_continuity_domain_immutable_h205f22 before update or delete on destruktion_meta.compute_continuity_domain_h205f22 for each row execute function destruktion_meta.compute_continuity_immutable_h205f22();
drop trigger if exists compute_continuity_object_immutable_h205f22 on destruktion_meta.compute_continuity_object_h205f22;
create trigger compute_continuity_object_immutable_h205f22 before update or delete on destruktion_meta.compute_continuity_object_h205f22 for each row execute function destruktion_meta.compute_continuity_immutable_h205f22();
drop trigger if exists compute_continuity_observation_insert_guard_h205f22 on destruktion_meta.compute_continuity_observation_h205f22;
create trigger compute_continuity_observation_insert_guard_h205f22 before insert on destruktion_meta.compute_continuity_observation_h205f22 for each row execute function destruktion_meta.compute_continuity_observation_insert_guard_h205f22();
drop trigger if exists compute_continuity_observation_immutable_h205f22 on destruktion_meta.compute_continuity_observation_h205f22;
create trigger compute_continuity_observation_immutable_h205f22 before update or delete on destruktion_meta.compute_continuity_observation_h205f22 for each row execute function destruktion_meta.compute_continuity_immutable_h205f22();
drop trigger if exists compute_continuity_repair_insert_guard_h205f22 on destruktion_meta.compute_continuity_repair_h205f22;
create trigger compute_continuity_repair_insert_guard_h205f22 before insert on destruktion_meta.compute_continuity_repair_h205f22 for each row execute function destruktion_meta.compute_continuity_repair_insert_guard_h205f22();
drop trigger if exists compute_continuity_repair_immutable_h205f22 on destruktion_meta.compute_continuity_repair_h205f22;
create trigger compute_continuity_repair_immutable_h205f22 before update or delete on destruktion_meta.compute_continuity_repair_h205f22 for each row execute function destruktion_meta.compute_continuity_immutable_h205f22();
drop trigger if exists compute_continuity_retention_insert_guard_h205f22 on destruktion_meta.compute_continuity_retention_event_h205f22;
create trigger compute_continuity_retention_insert_guard_h205f22 before insert on destruktion_meta.compute_continuity_retention_event_h205f22 for each row execute function destruktion_meta.compute_continuity_retention_insert_guard_h205f22();
drop trigger if exists compute_continuity_retention_immutable_h205f22 on destruktion_meta.compute_continuity_retention_event_h205f22;
create trigger compute_continuity_retention_immutable_h205f22 before update or delete on destruktion_meta.compute_continuity_retention_event_h205f22 for each row execute function destruktion_meta.compute_continuity_immutable_h205f22();
drop trigger if exists compute_continuity_restore_insert_guard_h205f22 on destruktion_meta.compute_continuity_restore_drill_h205f22;
create trigger compute_continuity_restore_insert_guard_h205f22 before insert on destruktion_meta.compute_continuity_restore_drill_h205f22 for each row execute function destruktion_meta.compute_continuity_restore_insert_guard_h205f22();
drop trigger if exists compute_continuity_restore_immutable_h205f22 on destruktion_meta.compute_continuity_restore_drill_h205f22;
create trigger compute_continuity_restore_immutable_h205f22 before update or delete on destruktion_meta.compute_continuity_restore_drill_h205f22 for each row execute function destruktion_meta.compute_continuity_immutable_h205f22();
drop trigger if exists compute_continuity_graph_node_insert_guard_h205f22 on destruktion_meta.compute_continuity_recovery_graph_node_h205f22;
create trigger compute_continuity_graph_node_insert_guard_h205f22 before insert on destruktion_meta.compute_continuity_recovery_graph_node_h205f22 for each row execute function destruktion_meta.compute_continuity_graph_node_insert_guard_h205f22();
drop trigger if exists compute_continuity_graph_node_immutable_h205f22 on destruktion_meta.compute_continuity_recovery_graph_node_h205f22;
create trigger compute_continuity_graph_node_immutable_h205f22 before update or delete on destruktion_meta.compute_continuity_recovery_graph_node_h205f22 for each row execute function destruktion_meta.compute_continuity_immutable_h205f22();
drop trigger if exists compute_continuity_graph_snapshot_immutable_h205f22 on destruktion_meta.compute_continuity_recovery_graph_snapshot_h205f22;
create trigger compute_continuity_graph_snapshot_immutable_h205f22 before update or delete on destruktion_meta.compute_continuity_recovery_graph_snapshot_h205f22 for each row execute function destruktion_meta.compute_continuity_immutable_h205f22();
drop trigger if exists compute_continuity_checkpoint_immutable_h205f22 on destruktion_meta.compute_continuity_checkpoint_ledger_h205f22;
create trigger compute_continuity_checkpoint_immutable_h205f22 before update or delete on destruktion_meta.compute_continuity_checkpoint_ledger_h205f22 for each row execute function destruktion_meta.compute_continuity_immutable_h205f22();
drop trigger if exists compute_continuity_persisted_seal_insert_guard_h205f22 on destruktion_meta.compute_continuity_persisted_seal_h205f22;
create trigger compute_continuity_persisted_seal_insert_guard_h205f22 before insert on destruktion_meta.compute_continuity_persisted_seal_h205f22 for each row execute function destruktion_meta.compute_continuity_persisted_seal_insert_guard_h205f22();
drop trigger if exists compute_continuity_persisted_seal_immutable_h205f22 on destruktion_meta.compute_continuity_persisted_seal_h205f22;
create trigger compute_continuity_persisted_seal_immutable_h205f22 before update or delete on destruktion_meta.compute_continuity_persisted_seal_h205f22 for each row execute function destruktion_meta.compute_continuity_immutable_h205f22();

alter table destruktion_meta.compute_continuity_domain_h205f22 enable row level security;
alter table destruktion_meta.compute_continuity_object_h205f22 enable row level security;
alter table destruktion_meta.compute_continuity_observation_h205f22 enable row level security;
alter table destruktion_meta.compute_continuity_repair_h205f22 enable row level security;
alter table destruktion_meta.compute_continuity_retention_event_h205f22 enable row level security;
alter table destruktion_meta.compute_continuity_restore_drill_h205f22 enable row level security;
alter table destruktion_meta.compute_continuity_recovery_graph_node_h205f22 enable row level security;
alter table destruktion_meta.compute_continuity_recovery_graph_snapshot_h205f22 enable row level security;
alter table destruktion_meta.compute_continuity_checkpoint_ledger_h205f22 enable row level security;
alter table destruktion_meta.compute_continuity_persisted_seal_h205f22 enable row level security;
do $$ declare t text; begin
 foreach t in array array['compute_continuity_domain_h205f22','compute_continuity_object_h205f22','compute_continuity_observation_h205f22','compute_continuity_repair_h205f22','compute_continuity_retention_event_h205f22','compute_continuity_restore_drill_h205f22','compute_continuity_recovery_graph_node_h205f22','compute_continuity_recovery_graph_snapshot_h205f22','compute_continuity_checkpoint_ledger_h205f22','compute_continuity_persisted_seal_h205f22'] loop
  execute format('drop policy if exists continuity_internal_deny_h205f22 on destruktion_meta.%I',t);
  execute format('create policy continuity_internal_deny_h205f22 on destruktion_meta.%I for all to anon, authenticated using (false) with check (false)',t);
 end loop;
end $$;
revoke all on table destruktion_meta.compute_continuity_domain_h205f22,destruktion_meta.compute_continuity_object_h205f22,destruktion_meta.compute_continuity_observation_h205f22,destruktion_meta.compute_continuity_repair_h205f22,destruktion_meta.compute_continuity_retention_event_h205f22,destruktion_meta.compute_continuity_restore_drill_h205f22,destruktion_meta.compute_continuity_recovery_graph_node_h205f22,destruktion_meta.compute_continuity_recovery_graph_snapshot_h205f22,destruktion_meta.compute_continuity_checkpoint_ledger_h205f22,destruktion_meta.compute_continuity_persisted_seal_h205f22 from anon,authenticated;
revoke execute on function destruktion_meta.compute_continuity_immutable_h205f22() from public,anon,authenticated;
revoke execute on function destruktion_meta.compute_continuity_graph_node_insert_guard_h205f22() from public,anon,authenticated;
revoke execute on function destruktion_meta.compute_continuity_observation_insert_guard_h205f22() from public,anon,authenticated;
revoke execute on function destruktion_meta.compute_continuity_repair_insert_guard_h205f22() from public,anon,authenticated;
revoke execute on function destruktion_meta.compute_continuity_retention_insert_guard_h205f22() from public,anon,authenticated;
revoke execute on function destruktion_meta.compute_continuity_restore_insert_guard_h205f22() from public,anon,authenticated;
revoke execute on function destruktion_meta.compute_continuity_persisted_seal_insert_guard_h205f22() from public,anon,authenticated;
revoke execute on function destruktion_meta.compute_record_continuity_observation_h205f22(uuid,text,text,text,bigint,timestamptz,timestamptz,jsonb) from public,anon,authenticated;
revoke execute on function destruktion_meta.compute_continuity_readiness_h205f22(uuid,timestamptz,interval) from public,anon,authenticated;
revoke execute on function destruktion_meta.compute_continuity_audit_status_h205f22(uuid,timestamptz,interval) from public,anon,authenticated;
revoke execute on function destruktion_meta.compute_record_continuity_repair_h205f22(bigint,bigint,text,jsonb) from public,anon,authenticated;
revoke execute on function destruktion_meta.compute_continuity_retention_status_h205f22(text,text,timestamptz) from public,anon,authenticated;
revoke execute on function destruktion_meta.compute_continuity_gc_admission_h205f22(text,text,timestamptz) from public,anon,authenticated;
revoke execute on function destruktion_meta.compute_restore_quorum_status_h205f22(uuid,timestamptz,interval) from public,anon,authenticated;
revoke execute on function destruktion_meta.compute_finalize_recovery_graph_h205f22(text,uuid) from public,anon,authenticated;
comment on table destruktion_meta.compute_continuity_observation_h205f22 is 'H205F22 append-only persisted readback observations. VERIFIED is normalized fail-closed against expected hash/bytes; R2 is not implied by schema presence.';
comment on table destruktion_meta.compute_continuity_repair_h205f22 is 'H205F22 immutable repair linkage. Bad observation remains preserved; repair is a separate verified replacement receipt.';
comment on table destruktion_meta.compute_continuity_checkpoint_ledger_h205f22 is 'H205F22 R1 append-only continuity step ledger. This is not the supervisor mainline checkpoint seal.';
comment on table destruktion_meta.compute_continuity_persisted_seal_h205f22 is 'H47C-derived persisted-readback-first continuity seal. It cannot be inserted until two current independent verified readbacks exist; it does not reserve or seal a supervisor mainline checkpoint.';
comment on function destruktion_meta.compute_continuity_gc_admission_h205f22(text,text,timestamptz) is 'H205F22 H45 GC admission guard. Fail-closed for unknown subjects, active retention leases, and references from sealed recovery graphs. It does not execute deletion.';

create index if not exists compute_continuity_observation_object_domain_idx on destruktion_meta.compute_continuity_observation_h205f22(object_id, domain_key, observation_id desc);
comment on table destruktion_meta.compute_continuity_checkpoint_ledger_h205f22 is 'H205F22 R1 append-only continuity step ledger. This is not the supervisor mainline checkpoint seal.';

do $postconditions$
declare
  v_tables integer;
  v_rls integer;
  v_policies integer;
  v_forbidden_table_grants integer;
  v_functions integer;
  v_forbidden_exec integer;
begin
  select count(*) into v_tables
  from information_schema.tables
  where table_schema='destruktion_meta'
    and table_name = any(array['compute_continuity_domain_h205f22','compute_continuity_object_h205f22','compute_continuity_observation_h205f22','compute_continuity_repair_h205f22','compute_continuity_retention_event_h205f22','compute_continuity_restore_drill_h205f22','compute_continuity_recovery_graph_node_h205f22','compute_continuity_recovery_graph_snapshot_h205f22','compute_continuity_checkpoint_ledger_h205f22','compute_continuity_persisted_seal_h205f22']);
  if v_tables <> 10 then raise exception 'r1_continuity_table_count_invalid:%',v_tables; end if;

  select count(*) into v_rls
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='destruktion_meta'
    and c.relname = any(array['compute_continuity_domain_h205f22','compute_continuity_object_h205f22','compute_continuity_observation_h205f22','compute_continuity_repair_h205f22','compute_continuity_retention_event_h205f22','compute_continuity_restore_drill_h205f22','compute_continuity_recovery_graph_node_h205f22','compute_continuity_recovery_graph_snapshot_h205f22','compute_continuity_checkpoint_ledger_h205f22','compute_continuity_persisted_seal_h205f22'])
    and c.relrowsecurity;
  if v_rls <> 10 then raise exception 'r1_continuity_rls_count_invalid:%',v_rls; end if;

  select count(*) into v_policies
  from pg_catalog.pg_policies
  where schemaname='destruktion_meta'
    and tablename = any(array['compute_continuity_domain_h205f22','compute_continuity_object_h205f22','compute_continuity_observation_h205f22','compute_continuity_repair_h205f22','compute_continuity_retention_event_h205f22','compute_continuity_restore_drill_h205f22','compute_continuity_recovery_graph_node_h205f22','compute_continuity_recovery_graph_snapshot_h205f22','compute_continuity_checkpoint_ledger_h205f22','compute_continuity_persisted_seal_h205f22'])
    and policyname='continuity_internal_deny_h205f22';
  if v_policies <> 10 then raise exception 'r1_continuity_policy_count_invalid:%',v_policies; end if;

  select count(*) into v_forbidden_table_grants
  from information_schema.role_table_grants
  where table_schema='destruktion_meta'
    and table_name = any(array['compute_continuity_domain_h205f22','compute_continuity_object_h205f22','compute_continuity_observation_h205f22','compute_continuity_repair_h205f22','compute_continuity_retention_event_h205f22','compute_continuity_restore_drill_h205f22','compute_continuity_recovery_graph_node_h205f22','compute_continuity_recovery_graph_snapshot_h205f22','compute_continuity_checkpoint_ledger_h205f22','compute_continuity_persisted_seal_h205f22'])
    and grantee in ('anon','authenticated');
  if v_forbidden_table_grants <> 0 then raise exception 'r1_continuity_public_table_grant:%',v_forbidden_table_grants; end if;

  select count(*) into v_functions
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='destruktion_meta'
    and p.proname = any(array['compute_continuity_immutable_h205f22','compute_continuity_graph_node_insert_guard_h205f22','compute_continuity_observation_insert_guard_h205f22','compute_continuity_repair_insert_guard_h205f22','compute_continuity_retention_insert_guard_h205f22','compute_continuity_restore_insert_guard_h205f22','compute_record_continuity_observation_h205f22','compute_continuity_readiness_h205f22','compute_continuity_audit_status_h205f22','compute_record_continuity_repair_h205f22','compute_continuity_retention_status_h205f22','compute_continuity_gc_admission_h205f22','compute_restore_quorum_status_h205f22','compute_finalize_recovery_graph_h205f22','compute_continuity_persisted_seal_insert_guard_h205f22']);
  if v_functions <> 15 then raise exception 'r1_continuity_function_count_invalid:%',v_functions; end if;

  select count(*) into v_forbidden_exec
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='destruktion_meta'
    and p.proname = any(array['compute_continuity_immutable_h205f22','compute_continuity_graph_node_insert_guard_h205f22','compute_continuity_observation_insert_guard_h205f22','compute_continuity_repair_insert_guard_h205f22','compute_continuity_retention_insert_guard_h205f22','compute_continuity_restore_insert_guard_h205f22','compute_record_continuity_observation_h205f22','compute_continuity_readiness_h205f22','compute_continuity_audit_status_h205f22','compute_record_continuity_repair_h205f22','compute_continuity_retention_status_h205f22','compute_continuity_gc_admission_h205f22','compute_restore_quorum_status_h205f22','compute_finalize_recovery_graph_h205f22','compute_continuity_persisted_seal_insert_guard_h205f22'])
    and (
      pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
    );
  if v_forbidden_exec <> 0 then raise exception 'r1_continuity_public_function_execute:%',v_forbidden_exec; end if;
end;
$postconditions$;

comment on schema destruktion_meta is 'METAENGINE private control/evidence schema. R1 continuity objects are operational contracts only; schema presence does not prove R2/R3 durability.';
