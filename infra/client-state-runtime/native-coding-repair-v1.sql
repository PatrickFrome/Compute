-- Reviewed rejected-result repair: immutable lineage, retained dirty custody, existing project allocator.
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('destruktion_meta.native_coding_project_reconcile_writer_v1(uuid,text)');
 if p.prosrc is null or p.lanname<>'plpgsql' or p.prosecdef is distinct from true or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('ec3584e4bdd7d4d1269253fef3f50c2410349f6ac437e16041b02e3b001c8160','02870dec25faf08c7cddd4d1d5c4a256f1ae26e4c224179c477fbe9593d7be09')
 then raise exception 'native_coding_repair_critic_admission_requires_review';end if;
end $review$;
-- Reviewed predecessor/current bodies; never overwrite an unknown authority function.
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('destruktion_meta.native_coding_review_rejection_v1(uuid,uuid)');

 if p.prosrc is null or p.lanname<>'sql' or p.prosecdef is distinct from true or p.provolatile<>'s'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('49a57c236580ab528ab978b61f495b336b3e2b2086bfded08dbb6426a6e783a0','d2987eec5253557393a6278925da77abece451251aaf411730610ef8dfc3f635')
 then raise exception 'native_coding_repair_predecessor_requires_review:destruktion_meta.native_coding_review_rejection_v1(uuid,uuid)' using errcode='55000';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('destruktion_meta.project_task_projection_h205f22(uuid,uuid)');

 if p.prosrc is null or p.lanname<>'sql' or p.prosecdef is distinct from true or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, destruktion_meta, pg_temp']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('2d38e3d3b8fdf3dc371d4bd37be4de8ecd9246aed6a77081cb2eb97e17f9d1c7','79990f7019da3cbf6639e567c87650a5d20bd69d9bd471a33a536843e4a6c1a9')
 then raise exception 'native_coding_repair_predecessor_requires_review:destruktion_meta.project_task_projection_h205f22(uuid,uuid)' using errcode='55000';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('destruktion_meta.browser_parent_suspension_projection_v1(uuid)');

 if p.prosrc is null or p.lanname<>'plpgsql' or p.prosecdef is distinct from true or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('794ff6dc42a594888bf83bdad385692a6629be76c4d4bf0b098105b5393ef208','3b19104d465f5a2c160b00b6458691608c9ba4c65db80525747ec53655d153f5')
 then raise exception 'native_coding_repair_predecessor_requires_review:destruktion_meta.browser_parent_suspension_projection_v1(uuid)' using errcode='55000';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('public.h205f22_project_snapshot_v1(uuid,uuid,uuid,bigint,integer,uuid,text,bigint)');

 if p.prosrc is null or p.lanname<>'plpgsql' or p.prosecdef is distinct from true or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta, pg_temp']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('bdbb0c2c3cf3e1a17d6d6eec1d261aa505bcc48cb1695e6294c5cea44374cad1','55b91c1935bf14b1dad3b02468a93827ae8fab4f12036b05c68f72bc20441aa0')
 then raise exception 'native_coding_repair_predecessor_requires_review:public.h205f22_project_snapshot_v1(uuid,uuid,uuid,bigint,integer,uuid,text,bigint)' using errcode='55000';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('destruktion_meta.project_completion_ready_h205f22(uuid)');

 if p.prosrc is null or p.lanname<>'plpgsql' or p.prosecdef is distinct from true or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, destruktion_meta, pg_temp']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('9c8d213d5e55c8f08d0b0452f7e6621470243a59c0bd0b5b56aa0bc3c0feb2de','36f038b2b7883ca20e6bc93fc501c73ef3a1e273f033b58417ec61410ad13888')
 then raise exception 'native_coding_repair_predecessor_requires_review:destruktion_meta.project_completion_ready_h205f22(uuid)' using errcode='55000';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('public.h205f22_project_reconcile_v1(uuid,uuid,uuid,text,bigint)');

 if p.prosrc is null or p.lanname<>'plpgsql' or p.prosecdef is distinct from true or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta, pg_temp']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('37498f27e7a6dc107fa95705d9b0f4386337eca78ddccf784cb9246dcbf587b6','253550d86522264c079a1cef24c147fe8e1a808dcd7c495c58f057ddb8b3ae22')
 then raise exception 'native_coding_repair_predecessor_requires_review:public.h205f22_project_reconcile_v1(uuid,uuid,uuid,text,bigint)' using errcode='55000';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('destruktion_meta.native_coding_review_rejection_raw_v1(uuid,uuid)');
 if p.prosrc is null then return;end if;
 if p.prosrc is null or p.lanname<>'sql' or p.prosecdef is distinct from true or p.provolatile<>'s'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('37bd57e7257c1b02acf8d9ce193eef5da80dc72fce7812aab0422fe13a89fd01')
 then raise exception 'native_coding_repair_predecessor_requires_review:destruktion_meta.native_coding_review_rejection_raw_v1(uuid,uuid)' using errcode='55000';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('destruktion_meta.native_coding_repair_obligation_v1(uuid)');
 if p.prosrc is null then return;end if;
 if p.prosrc is null or p.lanname<>'plpgsql' or p.prosecdef is distinct from true or p.provolatile<>'s'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('17123d7ba2a0baa6d7d9333e88a27e4c10775d6c529bf9719259cbf757681ca3')
 then raise exception 'native_coding_repair_predecessor_requires_review:destruktion_meta.native_coding_repair_obligation_v1(uuid)' using errcode='55000';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('destruktion_meta.native_coding_project_repair_v1(uuid,text)');
 if p.prosrc is null then return;end if;
 if p.prosrc is null or p.lanname<>'plpgsql' or p.prosecdef is distinct from true or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('d043339226c3f1ddc6e5fa0b5e8cd88d51006636279b469fdf0d0ba0a358b2dc')
 then raise exception 'native_coding_repair_predecessor_requires_review:destruktion_meta.native_coding_project_repair_v1(uuid,text)' using errcode='55000';end if;
end $review$;
-- Additive repair lineage. Rejected evidence and physical custody are never rewritten.
create or replace function destruktion_meta.native_coding_review_rejection_raw_v1(p_project uuid,p_task uuid)
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
 where r.project_id=p_project and wp.task_id in(select task_id from lineage) and w.role='IMPLEMENTER' and c.role='CRITIC'
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

do $existing_relation$
begin
 if to_regclass('destruktion_meta.native_coding_repair_h205f22') is not null and not exists(
  select 1 from pg_class where oid=to_regclass('destruktion_meta.native_coding_repair_h205f22') and relrowsecurity and not relforcerowsecurity)
 then raise exception 'native_coding_repair_relation_requires_review';end if;
end $existing_relation$;
create table if not exists destruktion_meta.native_coding_repair_h205f22(
 project_id uuid not null references destruktion_meta.project_run_h205f22(project_id),
 writer_task_id uuid primary key references destruktion_meta.devos_fleet_task_h205f22(task_id),
 writer_lease_generation bigint not null check(writer_lease_generation>0),
 critic_task_id uuid not null unique references destruktion_meta.devos_fleet_task_h205f22(task_id),
 critic_lease_generation bigint not null check(critic_lease_generation>0),
 writer_receipt_sha256 text not null check(writer_receipt_sha256~'^[a-f0-9]{64}$'),
 critic_receipt_sha256 text not null check(critic_receipt_sha256~'^[a-f0-9]{64}$'),
 replacement_task_id uuid not null unique references destruktion_meta.devos_fleet_task_h205f22(task_id),
 created_at timestamptz not null default clock_timestamp(),
 check(writer_task_id<>critic_task_id and replacement_task_id not in(writer_task_id,critic_task_id))
);
-- Attest a preexisting relation instead of silently adopting a foreign shape.
create temporary table metaengine_repair_reference(
 project_id uuid not null,
 writer_task_id uuid primary key,
 writer_lease_generation bigint not null check(writer_lease_generation>0),
 critic_task_id uuid not null unique,
 critic_lease_generation bigint not null check(critic_lease_generation>0),
 writer_receipt_sha256 text not null check(writer_receipt_sha256~'^[a-f0-9]{64}$'),
 critic_receipt_sha256 text not null check(critic_receipt_sha256~'^[a-f0-9]{64}$'),
 replacement_task_id uuid not null unique,
 created_at timestamptz not null default clock_timestamp(),
 check(writer_task_id<>critic_task_id and replacement_task_id not in(writer_task_id,critic_task_id))
) on commit drop;
do $relation$
declare expected jsonb;actual jsonb;
begin
 if not exists(select 1 from pg_class where oid='destruktion_meta.native_coding_repair_h205f22'::regclass
  and relkind='r' and relpersistence='p' and pg_get_userbyid(relowner)=current_user)
  or exists(select 1 from pg_policy where polrelid='destruktion_meta.native_coding_repair_h205f22'::regclass)
 then raise exception 'native_coding_repair_relation_requires_review';end if;
 select jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attnotnull,coalesce(pg_get_expr(d.adbin,d.adrelid),'')) order by a.attnum)
 into expected from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where a.attrelid='pg_temp.metaengine_repair_reference'::regclass and a.attnum>0 and not a.attisdropped;
 select jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attnotnull,coalesce(pg_get_expr(d.adbin,d.adrelid),'')) order by a.attnum)
 into actual from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where a.attrelid='destruktion_meta.native_coding_repair_h205f22'::regclass and a.attnum>0 and not a.attisdropped;
 if actual is distinct from expected then raise exception 'native_coding_repair_columns_require_review';end if;
 select jsonb_agg(pg_get_constraintdef(oid) order by pg_get_constraintdef(oid)) into expected from pg_constraint
 where conrelid='pg_temp.metaengine_repair_reference'::regclass and contype<>'f';
 select jsonb_agg(pg_get_constraintdef(oid) order by pg_get_constraintdef(oid)) into actual from pg_constraint
 where conrelid='destruktion_meta.native_coding_repair_h205f22'::regclass and contype<>'f';
 if actual is distinct from expected then raise exception 'native_coding_repair_constraints_require_review';end if;
 select jsonb_agg(jsonb_build_array(a.attname,c.confrelid,ca.attname,c.confupdtype,c.confdeltype,c.confmatchtype,c.condeferrable,c.condeferred,c.convalidated) order by a.attname)
 into actual from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
 join pg_attribute ca on ca.attrelid=c.confrelid and ca.attnum=c.confkey[1]
 where c.conrelid='destruktion_meta.native_coding_repair_h205f22'::regclass and c.contype='f' and cardinality(c.conkey)=1 and cardinality(c.confkey)=1;
 select jsonb_agg(jsonb_build_array(col,rel::regclass::oid,target,'a','a','s',false,false,true) order by col) into expected
 from (values('project_id','destruktion_meta.project_run_h205f22','project_id'),('writer_task_id','destruktion_meta.devos_fleet_task_h205f22','task_id'),
  ('critic_task_id','destruktion_meta.devos_fleet_task_h205f22','task_id'),('replacement_task_id','destruktion_meta.devos_fleet_task_h205f22','task_id')) refs(col,rel,target);
 if actual is distinct from expected or (select count(*) from pg_constraint where conrelid='destruktion_meta.native_coding_repair_h205f22'::regclass and contype='f')<>4
 then raise exception 'native_coding_repair_foreign_keys_require_review';end if;
end $relation$;
alter table destruktion_meta.native_coding_repair_h205f22 enable row level security;

revoke all on destruktion_meta.native_coding_repair_h205f22 from public,anon,authenticated,service_role;

do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('destruktion_meta.native_coding_repair_edge_valid_v1(destruktion_meta.native_coding_repair_h205f22)');
 if p.prosrc is null then return;end if;
 if p.lanname<>'plpgsql' or p.prosecdef is distinct from true or p.provolatile<>'s'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex')<>'c4138b039fa34e8b0fa0c62c61bb9bda5ddd7b1ee3782a669e149c2a5f445ae1'
 then raise exception 'native_coding_repair_helper_requires_review';end if;
end $review$;
create or replace function destruktion_meta.native_coding_repair_edge_valid_v1(edge destruktion_meta.native_coding_repair_h205f22)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,destruktion_meta as $$
declare wp destruktion_meta.project_task_h205f22;cp destruktion_meta.project_task_h205f22;rp destruktion_meta.project_task_h205f22;
 w destruktion_meta.devos_fleet_task_h205f22;c destruktion_meta.devos_fleet_task_h205f22;r destruktion_meta.devos_fleet_task_h205f22;
 wj destruktion_meta.native_coding_job_registration_h205f22;cj destruktion_meta.native_coding_job_registration_h205f22;
 original destruktion_meta.native_coding_operator_permit_h205f22;replacement destruktion_meta.native_coding_operator_permit_h205f22;reviewer destruktion_meta.native_coding_operator_permit_h205f22;rejection jsonb;
begin
 -- Fixed primary-key reads avoid inlining a many-way join into every ancestor.
 select * into wp from destruktion_meta.project_task_h205f22 where task_id=edge.writer_task_id;
 select * into cp from destruktion_meta.project_task_h205f22 where task_id=edge.critic_task_id;
 select * into rp from destruktion_meta.project_task_h205f22 where task_id=edge.replacement_task_id;
 select * into w from destruktion_meta.devos_fleet_task_h205f22 where task_id=edge.writer_task_id;
 select * into c from destruktion_meta.devos_fleet_task_h205f22 where task_id=edge.critic_task_id;
 select * into r from destruktion_meta.devos_fleet_task_h205f22 where task_id=edge.replacement_task_id;
 select * into wj from destruktion_meta.native_coding_job_registration_h205f22 where task_id=w.task_id and lease_generation=w.lease_generation;
 select * into cj from destruktion_meta.native_coding_job_registration_h205f22 where task_id=c.task_id and lease_generation=c.lease_generation;
 select * into original from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=wj.permit_id;
 select * into replacement from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=(r.task_spec#>>'{native_coding,permit_id}')::uuid;
 select * into reviewer from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=(r.task_spec#>>'{native_repair,critic_permit_id}')::uuid;
 rejection:=destruktion_meta.native_coding_review_rejection_raw_v1(edge.project_id,edge.writer_task_id);
 return coalesce(wp.project_id=edge.project_id and cp.project_id=edge.project_id and rp.project_id=edge.project_id
  and wp.parent_task_id is not null and rp.parent_task_id=wp.parent_task_id and cp.parent_task_id=wp.task_id
  and wp.task_seq<rp.task_seq and cp.task_seq<rp.task_seq and wp.depth=rp.depth
  and w.role='IMPLEMENTER' and c.role='CRITIC' and r.role='IMPLEMENTER'
  and w.lease_generation=edge.writer_lease_generation and c.lease_generation=edge.critic_lease_generation
  and wj.result_receipt_sha256=edge.writer_receipt_sha256 and cj.result_receipt_sha256=edge.critic_receipt_sha256
  and rejection->>'writer_task_id'=w.task_id::text and rejection->>'critic_task_id'=c.task_id::text
  and rejection->>'writer_lease_generation'=w.lease_generation::text and rejection->>'critic_lease_generation'=c.lease_generation::text
  and r.task_spec->'native_repair'=jsonb_build_object('schema','metaengine.native-coding.repair-lineage.v1',
   'writer_task_id',w.task_id,'writer_lease_generation',w.lease_generation,'critic_task_id',c.task_id,
   'critic_lease_generation',c.lease_generation,'writer_receipt_sha256',wj.result_receipt_sha256,'critic_receipt_sha256',cj.result_receipt_sha256,'critic_permit_id',reviewer.permit_id)
  and reviewer.permit->>'role'='CRITIC' and reviewer.agent_id<>replacement.agent_id and reviewer.provider_id<>replacement.provider_id
  and reviewer.permit->'worktree'=replacement.permit->'worktree' and reviewer.permit->>'project_id'=edge.project_id::text
  and reviewer.permit->>'goal_id'=replacement.permit->>'goal_id' and reviewer.permit->>'goal_sha256'=replacement.permit->>'goal_sha256'
  and reviewer.permit->>'owner_epoch'=replacement.permit->>'owner_epoch' and reviewer.permit->>'user_sid'=replacement.permit->>'user_sid'
  and reviewer.permit->'artifact'=replacement.permit->'artifact' and reviewer.permit->'postgres'=replacement.permit->'postgres'
  and reviewer.device_id=replacement.device_id and reviewer.client_id=replacement.client_id
  and reviewer.admin_grant_epoch=replacement.admin_grant_epoch and reviewer.workspace_id=replacement.workspace_id
  and r.task_spec->'objective'=w.task_spec->'objective'
  and r.task_spec->'constraints'=coalesce(w.task_spec->'constraints','[]'::jsonb)
  and coalesce(r.task_spec->'deliverable','null'::jsonb)=coalesce(w.task_spec->'deliverable','null'::jsonb)
  and r.base_sha=w.base_sha and replacement.permit->'artifact'=original.permit->'artifact'
  and replacement.permit->'postgres'=original.permit->'postgres'
  and replacement.permit->>'goal_id'=original.permit->>'goal_id' and replacement.permit->>'goal_sha256'=original.permit->>'goal_sha256'
  and replacement.permit->>'owner_epoch'=original.permit->>'owner_epoch'
  and replacement.permit->>'user_sid'=original.permit->>'user_sid'
  and replacement.device_id=original.device_id and replacement.client_id=original.client_id
  and replacement.admin_grant_epoch=original.admin_grant_epoch and replacement.workspace_id=original.workspace_id
  and replacement.permit->>'project_id'=edge.project_id::text
  and replacement.permit#>>'{worktree,base_sha}'=w.base_sha
  and replacement.permit#>>'{worktree,root_identity_sha256}'<>original.permit#>>'{worktree,root_identity_sha256}',false);
end $$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure('destruktion_meta.native_coding_repair_immutable_v1()');
 if p.prosrc is null then return;end if;
 if p.lanname<>'plpgsql' or p.prosecdef is distinct from false or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex')<>'4e98ae947355f819038c81bd9fddc4b4807b6c8dc4eee242283554d5e4293e05'
 then raise exception 'native_coding_repair_helper_requires_review';end if;
end $review$;
create or replace function destruktion_meta.native_coding_repair_immutable_v1()
returns trigger language plpgsql set search_path=pg_catalog,destruktion_meta as $$
begin
 if tg_op<>'INSERT' then raise exception 'native_coding_repair_immutable' using errcode='55000';end if;
 if destruktion_meta.native_coding_repair_edge_valid_v1(new) is distinct from true
 then raise exception 'native_coding_repair_lineage_invalid' using errcode='23514';end if;
 return new;
end $$;
do $trigger$
declare tr record;
begin
 select * into tr from pg_trigger where tgrelid='destruktion_meta.native_coding_repair_h205f22'::regclass and tgname='native_coding_repair_immutable_trg';
 if not found then
  create trigger native_coding_repair_immutable_trg before insert or update or delete on destruktion_meta.native_coding_repair_h205f22
   for each row execute function destruktion_meta.native_coding_repair_immutable_v1();
 elsif tr.tgfoid<>'destruktion_meta.native_coding_repair_immutable_v1()'::regprocedure or tr.tgtype<>31 or tr.tgenabled<>'O'
  or tr.tgnargs<>0 or tr.tgqual is not null or tr.tgisinternal or tr.tgconstraint<>0
 then raise exception 'native_coding_repair_trigger_requires_review';end if;
end $trigger$;

-- This resolves only the obligation, never the old execution/result state.
create or replace function destruktion_meta.native_coding_repair_obligation_v1(p_task uuid)
returns text language plpgsql stable security definer set search_path=pg_catalog,destruktion_meta as $$
declare edge destruktion_meta.native_coding_repair_h205f22; next_edge destruktion_meta.native_coding_repair_h205f22; target uuid;
begin
 select * into edge from destruktion_meta.native_coding_repair_h205f22 where writer_task_id=p_task or critic_task_id=p_task;
 if not found then return null;end if;
 loop
  if destruktion_meta.native_coding_repair_edge_valid_v1(edge) is distinct from true then return null;end if;
  target:=edge.replacement_task_id;
  select * into next_edge from destruktion_meta.native_coding_repair_h205f22 where writer_task_id=target;
  if not found then exit;end if;
  if next_edge.project_id<>edge.project_id then return null;end if;
  edge:=next_edge;
 end loop;
 if exists(select 1 from destruktion_meta.native_coding_checkpoint_h205f22 k
  join destruktion_meta.native_coding_commit_h205f22 m on m.checkpoint_id=k.checkpoint_id and m.project_id=k.project_id
  join destruktion_meta.devos_fleet_task_h205f22 t on t.task_id=k.writer_task_id
  where k.writer_task_id=target and k.project_id=edge.project_id and t.state='COMPLETED'
   and destruktion_meta.native_coding_project_completion_ready_v1(target)) then return 'RESOLVED';end if;
 return 'PENDING';
end $$;

-- Called only from the existing authenticated task->project-locked sweep.
-- Admission creates logical demand; normal Host/W30/clean-tree preflight still
-- owns physical execution. No old root, permit or receipt is released.
create or replace function destruktion_meta.native_coding_project_repair_v1(p_task uuid,p_client text)
returns integer language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare w destruktion_meta.devos_fleet_task_h205f22; wp destruktion_meta.project_task_h205f22;
 r destruktion_meta.project_run_h205f22; original destruktion_meta.native_coding_operator_permit_h205f22;
 seed destruktion_meta.native_coding_seed_h205f22; cfg destruktion_meta.native_coding_seed_profile_h205f22;
 wj destruktion_meta.native_coding_job_registration_h205f22; cj destruktion_meta.native_coding_job_registration_h205f22;
 replacement destruktion_meta.native_coding_operator_permit_h205f22;reviewer destruktion_meta.native_coding_operator_permit_h205f22; rejected jsonb;control jsonb;spec jsonb;lineage jsonb;enqueued jsonb;child uuid;
begin
 select * into w from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task;
 select * into wp from destruktion_meta.project_task_h205f22 where task_id=p_task;
 select * into r from destruktion_meta.project_run_h205f22 where project_id=wp.project_id;
 if r.state is distinct from 'ACTIVE' or wp.parent_task_id is null or w.role is distinct from 'IMPLEMENTER'
  or exists(select 1 from destruktion_meta.native_coding_repair_h205f22 where writer_task_id=p_task) then return 0;end if;
 rejected:=destruktion_meta.native_coding_review_rejection_raw_v1(r.project_id,p_task);
 if rejected->>'writer_task_id' is distinct from p_task::text then return 0;end if;
 select * into seed from destruktion_meta.native_coding_seed_h205f22 where project_id=r.project_id;
 select * into cfg from destruktion_meta.native_coding_seed_profile_h205f22 where profile_id=seed.profile_id;
 if cfg.profile_sha256 is distinct from seed.profile_sha256 or cfg.revoked_at is not null
  or cfg.profile->>'coordination_mode' is distinct from 'CHAT_LED'
  or (cfg.profile->>'expires_at')::timestamptz<=clock_timestamp()
  or exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 where task_id=wp.parent_task_id and task_spec ? 'native_coding')
 then return 0;end if;
 control:=public.devos_environment_state_v1(r.workspace_id);
 if control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb
  or control->'owner_stop'='true'::jsonb or control->>'state'='STOPPED' then return 0;end if;
 select * into wj from destruktion_meta.native_coding_job_registration_h205f22 where task_id=p_task and lease_generation=w.lease_generation;
 select * into cj from destruktion_meta.native_coding_job_registration_h205f22 where task_id=(rejected->>'critic_task_id')::uuid and lease_generation=(rejected->>'critic_lease_generation')::bigint;
 select * into original from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=wj.permit_id;
 if (r.max_depth is not null and wp.depth>r.max_depth) or (r.max_tasks is not null and r.total_tasks>=r.max_tasks)
  or (r.max_children is not null and (select count(*) from destruktion_meta.project_task_h205f22 where project_id=r.project_id and parent_task_id=wp.parent_task_id)>=r.max_children)
 then return 0;end if;
 with recursive permitted(permit_id) as (
  select value::uuid from jsonb_array_elements_text(seed.permit_ids)
  union select m.next_writer_permit_id from permitted prior
   join destruktion_meta.devos_fleet_task_h205f22 t on t.task_spec#>>'{native_coding,permit_id}'=prior.permit_id::text
   join destruktion_meta.native_coding_checkpoint_h205f22 k on k.writer_task_id=t.task_id and k.project_id=r.project_id
   join destruktion_meta.native_coding_commit_h205f22 m on m.checkpoint_id=k.checkpoint_id and m.project_id=r.project_id
 )
 select p.* into replacement from destruktion_meta.native_coding_operator_permit_h205f22 p
 where p.permit_id in(select permit_id from permitted) and p.workspace_id=original.workspace_id
  and p.client_id=original.client_id and p.device_id=original.device_id and p.admin_grant_epoch=original.admin_grant_epoch
  and p.revoked_at is null and (p.permit->>'expires_at')::timestamptz>clock_timestamp()
  and p.permit->>'role'='IMPLEMENTER' and p.permit->>'project_id'=r.project_id::text
  and p.permit->>'goal_id'=original.permit->>'goal_id' and p.permit->>'goal_sha256'=original.permit->>'goal_sha256'
  and p.permit->>'owner_epoch'=original.permit->>'owner_epoch' and p.permit->>'user_sid'=original.permit->>'user_sid'
  and p.permit->'artifact'=original.permit->'artifact' and p.permit->'postgres'=original.permit->'postgres'
  and p.permit#>>'{worktree,base_sha}'=w.base_sha
  and p.permit#>>'{worktree,root_identity_sha256}'<>original.permit#>>'{worktree,root_identity_sha256}'
  and lower(p.permit#>>'{worktree,path}')<>lower(original.permit#>>'{worktree,path}')
  and not exists(select 1 from destruktion_meta.native_coding_worktree_fence_h205f22 f where f.root_identity_sha256=p.permit#>>'{worktree,root_identity_sha256}')
  and not exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 busy where busy.workspace_id=p.workspace_id
   and busy.state in('READY','LEASED','RUNNING','RESULT_READY') and exists(select 1 from destruktion_meta.native_coding_operator_permit_h205f22 bp
    where bp.permit_id=(busy.task_spec#>>'{native_coding,permit_id}')::uuid and bp.permit#>>'{worktree,root_identity_sha256}'=p.permit#>>'{worktree,root_identity_sha256}'))
  and not exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 active where active.workspace_id=p.workspace_id and active.agent_id=p.agent_id and active.state='ACTIVE')
  and exists(select 1 from destruktion_meta.native_coding_operator_permit_h205f22 c where c.workspace_id=p.workspace_id
   and c.client_id=p.client_id and c.device_id=p.device_id and c.admin_grant_epoch=p.admin_grant_epoch
   and c.revoked_at is null and (c.permit->>'expires_at')::timestamptz>clock_timestamp()
   and c.agent_id<>p.agent_id and c.provider_id<>p.provider_id and c.permit->>'role'='CRITIC'
   and c.permit->>'project_id'=r.project_id::text and c.permit->>'goal_id'=p.permit->>'goal_id' and c.permit->>'goal_sha256'=p.permit->>'goal_sha256'
   and c.permit->>'owner_epoch'=p.permit->>'owner_epoch' and c.permit->>'user_sid'=p.permit->>'user_sid'
   and c.permit->'artifact'=p.permit->'artifact' and c.permit->'postgres'=p.permit->'postgres' and c.permit->'worktree'=p.permit->'worktree'
   and not exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 busy where busy.workspace_id=c.workspace_id
    and busy.task_spec#>>'{native_coding,permit_id}'=c.permit_id::text and busy.state in('READY','LEASED','RUNNING','RESULT_READY'))
   and not exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 active where active.workspace_id=c.workspace_id and active.agent_id=c.agent_id and active.state='ACTIVE'))
 order by p.permit_id limit 1 for share;
 if replacement.permit_id is null then
  perform destruktion_meta.project_append_h205f22(r.project_id,'NATIVE_REPAIR_CAPACITY_WAIT',p_task,w.lease_generation,p_client,null,null,null,
   jsonb_build_object('reason','DISTINCT_SAME_BASE_PROTECTED_PAIR_REQUIRED','writer_task_id',p_task,'critic_task_id',rejected->>'critic_task_id'),
   'DATABASE_ADMISSION',null,false,'native-repair-wait:'||p_task||':'||w.lease_generation);
  return 0;
 end if;
 select c.* into reviewer from destruktion_meta.native_coding_operator_permit_h205f22 c
 where c.workspace_id=replacement.workspace_id and c.client_id=replacement.client_id and c.device_id=replacement.device_id
  and c.admin_grant_epoch=replacement.admin_grant_epoch and c.revoked_at is null and (c.permit->>'expires_at')::timestamptz>clock_timestamp()
  and c.agent_id<>replacement.agent_id and c.provider_id<>replacement.provider_id and c.permit->>'role'='CRITIC'
  and c.permit->>'project_id'=r.project_id::text and c.permit->>'goal_id'=replacement.permit->>'goal_id' and c.permit->>'goal_sha256'=replacement.permit->>'goal_sha256'
  and c.permit->>'owner_epoch'=replacement.permit->>'owner_epoch' and c.permit->>'user_sid'=replacement.permit->>'user_sid'
  and c.permit->'artifact'=replacement.permit->'artifact' and c.permit->'postgres'=replacement.permit->'postgres' and c.permit->'worktree'=replacement.permit->'worktree'
  and not exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 busy where busy.workspace_id=c.workspace_id
   and busy.task_spec#>>'{native_coding,permit_id}'=c.permit_id::text and busy.state in('READY','LEASED','RUNNING','RESULT_READY'))
  and not exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 active where active.workspace_id=c.workspace_id and active.agent_id=c.agent_id and active.state='ACTIVE')
 order by c.permit_id limit 1 for share;
 if reviewer.permit_id is null then return 0;end if;
 lineage:=jsonb_build_object('schema','metaengine.native-coding.repair-lineage.v1','writer_task_id',p_task,'writer_lease_generation',w.lease_generation,
  'critic_task_id',cj.task_id,'critic_lease_generation',cj.lease_generation,'writer_receipt_sha256',wj.result_receipt_sha256,'critic_receipt_sha256',cj.result_receipt_sha256,'critic_permit_id',reviewer.permit_id);
 spec:=jsonb_build_object('schema','metaengine.devos.project-task-spec.v1','claim_class','MUTATING',
  'objective',w.task_spec->>'objective','deliverable',w.task_spec->'deliverable',
  'constraints',coalesce(w.task_spec->'constraints','[]'::jsonb),'native_repair',lineage,
  'native_coding',jsonb_build_object('permit_id',replacement.permit_id,'goal_id',replacement.permit->>'goal_id','goal_sha256',replacement.permit->>'goal_sha256','project_id',r.project_id),
  'project_continuity',jsonb_build_object('schema','metaengine.devos.project-task.v1','project_id',r.project_id,'root_task_id',r.root_task_id,'parent_task_id',wp.parent_task_id,'depth',wp.depth,'root_request_id',r.request_id),
  'automatic_retry_allowed',false,'model_output_authority',false,'scheduler_authority',false,'authority_effect',false);
 enqueued:=public.devos_fleet_enqueue_v1(r.workspace_id,'native.repair.'||replace(p_task::text,'-',''),'IMPLEMENTER',w.base_sha,spec,
  'native-repair:'||p_task||':'||w.lease_generation||':'||cj.result_receipt_sha256,null,100);
 if (enqueued->>'accepted')::boolean is distinct from true then raise exception 'native_coding_repair_enqueue_rejected';end if;
 child:=(enqueued->>'task_id')::uuid;
 update destruktion_meta.project_run_h205f22 set total_tasks=total_tasks+1 where project_id=r.project_id returning * into r;
 insert into destruktion_meta.project_task_h205f22 values(child,r.project_id,r.total_tasks,r.root_task_id,wp.parent_task_id,wp.depth);
 insert into destruktion_meta.native_coding_repair_h205f22(project_id,writer_task_id,writer_lease_generation,critic_task_id,critic_lease_generation,
  writer_receipt_sha256,critic_receipt_sha256,replacement_task_id)
 values(r.project_id,p_task,w.lease_generation,cj.task_id,cj.lease_generation,wj.result_receipt_sha256,cj.result_receipt_sha256,child);
 perform destruktion_meta.project_append_h205f22(r.project_id,'NATIVE_REPAIR_TASK_ADMITTED',child,0,p_client,null,null,null,lineage,
  'DATABASE_ADMISSION',null,false,'native-repair:'||p_task||':'||w.lease_generation);
 return 1;
end $$;
revoke all on function destruktion_meta.native_coding_review_rejection_raw_v1(uuid,uuid),
 destruktion_meta.native_coding_repair_edge_valid_v1(destruktion_meta.native_coding_repair_h205f22),
 destruktion_meta.native_coding_repair_immutable_v1(),destruktion_meta.native_coding_repair_obligation_v1(uuid),
 destruktion_meta.native_coding_project_repair_v1(uuid,text) from public,anon,authenticated,service_role;

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
 and not exists(select 1 from destruktion_meta.native_coding_repair_h205f22 edge where edge.writer_task_id=w.task_id
  and destruktion_meta.native_coding_repair_edge_valid_v1(edge))
 order by wp.task_seq,w.task_id,c.task_id limit 1
$$;
create or replace function destruktion_meta.project_task_projection_h205f22(p_project uuid,p_task uuid)
returns jsonb language sql security definer set search_path=pg_catalog,destruktion_meta,pg_temp as $$
  select jsonb_build_object('task_seq',x.task_seq,'task_id',x.task_id,'root_task_id',x.root_task_id,'parent_task_id',x.parent_task_id,'depth',x.depth,
    'state',t.state,'repair_obligation',destruktion_meta.native_coding_repair_obligation_v1(t.task_id),'role',t.role,'claim_class',t.claim_class,'base_sha',t.base_sha,'branch_name',t.branch_name,'point_id',t.point_id,
    'coordination_workspace_id',t.workspace_id,'claim_id',c.claim_id,'lease_generation',t.lease_generation,'agent_id',t.lease_agent_id,
    'tab_id',t.lease_tab_id,'target_id',t.lease_target_id,'agent_generation_epoch',t.lease_agent_generation_epoch,'lease_expires_at',t.lease_expires_at,
    'active_claim_count',(select count(*) from destruktion_meta.devos_fleet_claim_h205f22 held where held.task_id=t.task_id and held.state='ACTIVE'),
    'active_workspace_binding_count',(select count(*) from public.compute_fabric_a2_workspace_binding_h205f22 held where held.task_id=t.task_id and held.retired_at is null),
    'objective',left(t.task_spec->>'objective',4000),'task_spec_sha256',t.task_spec_sha256,
    'project_continuity',jsonb_build_object('schema','metaengine.devos.project-task.v1','project_id',p_project,'root_task_id',x.root_task_id,'parent_task_id',x.parent_task_id,'depth',x.depth,'root_request_id',r.request_id),
    'pending_message_seqs',destruktion_meta.project_pending_message_seqs_v1(p_project,p_task,t.lease_agent_id),
    'open_children',(select count(*) from destruktion_meta.project_task_h205f22 y join destruktion_meta.devos_fleet_task_h205f22 z using(task_id) where y.project_id=p_project and y.parent_task_id=t.task_id and z.state<>'COMPLETED' and destruktion_meta.native_coding_repair_obligation_v1(z.task_id) is distinct from 'RESOLVED'),
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
      where pt.project_id=s.project_id and pt.parent_task_id=s.task_id and t.state<>'COMPLETED' and destruktion_meta.native_coding_repair_obligation_v1(t.task_id) is distinct from 'RESOLVED')
      or exists(select 1 from destruktion_meta.project_child_proposal_h205f22 where project_id=s.project_id and parent_task_id=s.task_id and child_task_id is null)
      then 'WAITING_CHILDREN'
    else 'READY_TO_RESUME' end;
  return jsonb_build_object('schema','metaengine.devos.browser-parent-suspension.v1','found',true,
    'suspension_id',s.suspension_id,'seq',s.seq,'project_id',s.project_id,'workspace_id',s.workspace_id,'task_id',s.task_id,
    'old_claim_id',s.old_claim_id,'old_lease_generation',s.old_lease_generation,'checkpoint',s.checkpoint,
    'checkpoint_sha256',s.checkpoint_sha256,'awaited_children',s.awaited_children,'status',s.status,'state',projected,
    'lease',s.resumed_lease,'automatic_retry_allowed',false,'authority_effect',false);
end $$;
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
      'state',t.state,'repair_obligation',destruktion_meta.native_coding_repair_obligation_v1(t.task_id),'role',t.role,'claim_class',t.claim_class,'base_sha',t.base_sha,'branch_name',t.branch_name,'point_id',t.point_id,
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
    when pending=0 and not exists(select 1 from destruktion_meta.project_task_h205f22 x join destruktion_meta.devos_fleet_task_h205f22 t using(task_id) where x.project_id=id and t.state<>'COMPLETED' and destruktion_meta.native_coding_repair_obligation_v1(t.task_id) is distinct from 'RESOLVED') and destruktion_meta.project_completion_ready_h205f22(r.root_task_id) is true then 'COMPLETED'
    when pending>0 or exists(select 1 from destruktion_meta.project_task_h205f22 x join destruktion_meta.devos_fleet_task_h205f22 t using(task_id) where x.project_id=id and x.parent_task_id is not null and t.state<>'COMPLETED' and destruktion_meta.native_coding_repair_obligation_v1(t.task_id) is distinct from 'RESOLVED') then 'WAITING_CHILDREN' else 'ACTIVE' end;
  return jsonb_build_object('schema','metaengine.devos.project-snapshot.v1','found',true,'project_id',id,'coordination_workspace_id',r.workspace_id,'request_id',r.request_id,'root_task_id',r.root_task_id,
    'state',computed_state,'goal',r.goal,'last_seq',r.last_seq,'total_tasks',r.total_tasks,'policy',jsonb_build_object('generation',r.policy_generation,'max_depth',r.max_depth,'max_tasks',r.max_tasks,'max_children',r.max_children),
    'selected_task',destruktion_meta.project_task_projection_h205f22(id,selected),'immediate_children',children,'children_truncated',(select count(*)>128 from destruktion_meta.project_task_h205f22 where project_id=id and parent_task_id=selected),
    'proposals_truncated',(select count(*)>128 from destruktion_meta.project_child_proposal_h205f22 where project_id=id and parent_task_id=selected),'pending_proposals',pending,
    'native_review_rejection',review_rejection,'tasks',rows,'proposals',proposals,'task_cursor',jsonb_build_object('after_seq',p_task_after_seq,'next_seq',n,'has_more',n<r.total_tasks),
    'filesystem_paths_exposed',false,'automatic_retry_allowed',false,'scheduler_authority',false,'authority_effect',false);
end $$;
create or replace function destruktion_meta.project_completion_ready_h205f22(p_task uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,destruktion_meta,pg_temp as $$
declare t destruktion_meta.devos_fleet_task_h205f22%rowtype; subject destruktion_meta.devos_fleet_task_h205f22%rowtype; project uuid; required text; roles text[];
begin
 if exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 n where n.task_id=p_task and n.task_spec ? 'native_coding') then
   return destruktion_meta.native_coding_project_completion_ready_v1(p_task);
 end if;
 select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task;
 select project_id into project from destruktion_meta.project_task_h205f22 where task_id=p_task;
 if not found then return false; end if;
 if exists(with recursive descendants as (select task_id from destruktion_meta.project_task_h205f22 where project_id=project and parent_task_id=p_task union all select x.task_id from destruktion_meta.project_task_h205f22 x join descendants d on x.parent_task_id=d.task_id where x.project_id=project) select 1 from descendants d join destruktion_meta.devos_fleet_task_h205f22 z using(task_id) where z.state<>'COMPLETED' and destruktion_meta.native_coding_repair_obligation_v1(z.task_id) is distinct from 'RESOLVED')
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
create or replace function public.h205f22_project_reconcile_v1(p_workspace_id uuid,p_project_id uuid,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,pg_temp as $$
declare r destruktion_meta.project_run_h205f22%rowtype; t destruktion_meta.devos_fleet_task_h205f22%rowtype; x destruktion_meta.project_task_h205f22%rowtype;
 required text; roles text[]; spec jsonb; enqueued jsonb; child uuid; promoted integer:=0; admitted integer:=0; successors integer:=0; target uuid; outcomes jsonb:='[]';
begin
 if p_project_id is null then
   perform destruktion_meta.project_device_grant_h205f22(p_device_id,p_client_id,p_admin_grant_epoch);
   for target in select run.project_id from destruktion_meta.project_run_h205f22 run where run.workspace_id=p_workspace_id and run.device_id=p_device_id and run.client_id=p_client_id and run.admin_grant_epoch=p_admin_grant_epoch and run.state='ACTIVE'
     and (exists(select 1 from destruktion_meta.project_task_h205f22 link join destruktion_meta.devos_fleet_task_h205f22 task using(task_id) where link.project_id=run.project_id and task.state='RESULT_READY') or destruktion_meta.native_coding_commit_candidate_v1(run.project_id) is not null or exists(select 1 from destruktion_meta.native_coding_commit_h205f22 m where m.project_id=run.project_id and m.followup is not null and m.successor_task_id is null))
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
 successors:=destruktion_meta.native_coding_project_reconcile_commit_v1(p_project_id,p_client_id);
 for t in select task.* from destruktion_meta.devos_fleet_task_h205f22 task join destruktion_meta.project_task_h205f22 link using(task_id) where link.project_id=p_project_id and task.state='RESULT_READY' and not exists(select 1 from destruktion_meta.native_coding_repair_h205f22 edge
  where task.task_id in(edge.writer_task_id,edge.critic_task_id) and destruktion_meta.native_coding_repair_edge_valid_v1(edge)) order by link.depth desc,link.task_seq limit 8 loop
   if t.task_spec ? 'native_coding' then
     -- Native acceptance is committed only by the private Host verifier. This
     -- public stage can admit a CRITIC; it cannot write a checkpoint or advance it.
     admitted:=admitted+destruktion_meta.native_coding_project_reconcile_writer_v1(t.task_id,p_client_id);
     successors:=successors+destruktion_meta.native_coding_project_repair_v1(t.task_id,p_client_id);
     continue;
   end if;
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
 return jsonb_build_object('schema','metaengine.devos.project-reconcile.v1','project_id',p_project_id,'promoted_tasks',promoted,'admitted_verifiers',admitted,'admitted_native_successors',successors,'native_commit_pending',destruktion_meta.native_coding_commit_candidate_v1(p_project_id) is not null,'native_commit_candidate',destruktion_meta.native_coding_commit_candidate_v1(p_project_id),'native_checkpoint_pending',destruktion_meta.native_coding_checkpoint_candidate_v1(p_project_id) is not null,'native_checkpoint_candidate',destruktion_meta.native_coding_checkpoint_candidate_v1(p_project_id),'bounded_tasks',8,'automatic_retry_allowed',false,'scheduler_authority',false,'authority_effect',false);
end $$;

create or replace function destruktion_meta.native_coding_project_reconcile_writer_v1(p_task uuid,p_client text)
returns integer language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare t destruktion_meta.devos_fleet_task_h205f22; j destruktion_meta.native_coding_job_registration_h205f22;
 p destruktion_meta.native_coding_operator_permit_h205f22; critic destruktion_meta.native_coding_operator_permit_h205f22;
 r destruktion_meta.project_run_h205f22; x destruktion_meta.project_task_h205f22; spec jsonb; subject jsonb; enqueued jsonb; child uuid;
begin
 select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task;
 if t.role is distinct from 'IMPLEMENTER' or not destruktion_meta.native_coding_project_result_bound_v1(p_task) then return 0; end if;
 select * into j from destruktion_meta.native_coding_job_registration_h205f22 where task_id=p_task and lease_generation=t.lease_generation;
 if j.result_receipt#>>'{result,outcome}' is distinct from 'DONE' then return 0; end if;
 select * into p from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=j.permit_id;
 select * into x from destruktion_meta.project_task_h205f22 where task_id=p_task;
 select * into r from destruktion_meta.project_run_h205f22 where project_id=x.project_id and state='ACTIVE';
 if r.project_id is null or exists(select 1 from destruktion_meta.native_coding_checkpoint_h205f22 where writer_task_id=p_task and writer_lease_generation=t.lease_generation) then return 0; end if;
 perform 1 from destruktion_meta.native_coding_worktree_fence_h205f22 where writer_task_id=p_task and writer_lease_generation=t.lease_generation and state='HELD';
 if not found then return 0; end if;
 subject:=jsonb_build_object('run_id',j.run_id,'result_sha256',j.result_receipt->>'result_sha256',
   'git_artifact_sha256',j.result_receipt#>>'{git_after,artifact_sha256}','source_head',j.result_receipt#>>'{git_after,head}');
 if exists(select 1 from destruktion_meta.project_task_h205f22 cp join destruktion_meta.devos_fleet_task_h205f22 c using(task_id)
   where cp.project_id=r.project_id and cp.parent_task_id=p_task and c.role='CRITIC' and c.task_spec#>'{native_coding,verification_subject}'=subject) then return 0; end if;
 select * into critic from destruktion_meta.native_coding_operator_permit_h205f22 c where c.workspace_id=t.workspace_id and c.revoked_at is null
   and c.client_id=p.client_id and c.device_id=p.device_id and c.admin_grant_epoch=p.admin_grant_epoch and c.agent_id<>p.agent_id and c.provider_id<>p.provider_id
   and c.permit->>'role'='CRITIC' and c.permit->>'project_id'=r.project_id::text
   and c.permit->>'goal_id'=p.permit->>'goal_id' and c.permit->>'goal_sha256'=p.permit->>'goal_sha256' and c.permit->>'owner_epoch'=p.permit->>'owner_epoch'
   and c.permit->>'user_sid'=p.permit->>'user_sid' and c.permit->'artifact'=p.permit->'artifact' and c.permit->'postgres'=p.permit->'postgres'
   and c.permit#>>'{worktree,path}'=p.permit#>>'{worktree,path}' and c.permit#>>'{worktree,root_identity_sha256}'=p.permit#>>'{worktree,root_identity_sha256}'
   and c.permit#>>'{worktree,base_sha}'=j.result_receipt#>>'{git_after,head}' and (c.permit->>'expires_at')::timestamptz>clock_timestamp()
   and (not(t.task_spec ? 'native_repair') or c.permit_id::text=t.task_spec#>>'{native_repair,critic_permit_id}')
   and not exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 busy where busy.workspace_id=c.workspace_id
    and busy.task_spec#>>'{native_coding,permit_id}'=c.permit_id::text and busy.state in('READY','LEASED','RUNNING','RESULT_READY'))
   and not exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 active where active.workspace_id=c.workspace_id and active.agent_id=c.agent_id and active.state='ACTIVE')
   order by c.permit_id limit 1 for share;
 if critic.permit_id is null then return 0; end if;
 spec:=jsonb_build_object('schema','metaengine.devos.project-task-spec.v1','claim_class','READ_ONLY',
   'objective','Independently review the exact native coding artifact for task '||p_task||': '||left(t.task_spec->>'objective',3500),
   'constraints',coalesce(t.task_spec->'constraints','[]'::jsonb),
   'native_coding',jsonb_build_object('permit_id',critic.permit_id,'goal_id',critic.permit->>'goal_id','goal_sha256',critic.permit->>'goal_sha256','project_id',r.project_id,'verification_subject',subject),
   'project_continuity',jsonb_build_object('schema','metaengine.devos.project-task.v1','project_id',r.project_id,'root_task_id',r.root_task_id,'parent_task_id',p_task,'depth',x.depth+1,'root_request_id',r.request_id),
   'automatic_retry_allowed',false,'model_output_authority',false,'scheduler_authority',false,'authority_effect',false);
 enqueued:=public.devos_fleet_enqueue_v1(t.workspace_id,'native.verify.'||replace(p_task::text,'-',''),'CRITIC',subject->>'source_head',spec,
   'native-verify:'||p_task||':'||t.lease_generation||':'||(subject->>'result_sha256'),null,100);
 if (enqueued->>'accepted')::boolean is distinct from true then raise exception 'native_coding_critic_enqueue_rejected'; end if;
 child:=(enqueued->>'task_id')::uuid;
 update destruktion_meta.project_run_h205f22 set total_tasks=total_tasks+1 where project_id=r.project_id returning * into r;
 insert into destruktion_meta.project_task_h205f22 values(child,r.project_id,r.total_tasks,r.root_task_id,p_task,x.depth+1);
 perform destruktion_meta.project_append_h205f22(r.project_id,'NATIVE_CRITIC_TASK_ADMITTED',child,0,p_client,null,null,null,
   jsonb_build_object('writer_task_id',p_task,'writer_lease_generation',t.lease_generation,'verification_subject',subject),
   'DATABASE_ADMISSION',null,false,'native-critic:'||p_task||':'||t.lease_generation);
 return 1;
end $$;
