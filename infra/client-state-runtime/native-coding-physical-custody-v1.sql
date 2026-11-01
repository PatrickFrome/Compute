-- Additive-only source. Catalog drift and partial installs require review;
-- replay never repairs a changed physical custody or widens private access.
do $review$
declare expected jsonb:='[{"relname":"native_coding_physical_closure_h205f22","columns":[["kind","text",true,null],["key","text",true,null],["closure","jsonb",true,null],["created_at","timestamp with time zone",true,"clock_timestamp()"]],"constraints":[["native_coding_physical_closure_h205f22_closure_check","CHECK (((jsonb_typeof(closure) = ''object''::text) AND (octet_length((closure)::text) <= 16777216)))","c",true,false,false],["native_coding_physical_closure_h205f22_key_check","CHECK (((length(key) >= 1) AND (length(key) <= 80)))","c",true,false,false],["native_coding_physical_closure_h205f22_kind_check","CHECK ((kind = ANY (ARRAY[''TASK''::text, ''SETUP''::text])))","c",true,false,false],["native_coding_physical_closure_h205f22_pkey","PRIMARY KEY (kind, key)","p",true,false,false]],"indexes":["CREATE UNIQUE INDEX native_coding_physical_closure_h205f22_pkey ON destruktion_meta.native_coding_physical_closure_h205f22 USING btree (kind, key)"]},{"relname":"native_coding_physical_fence_h205f22","columns":[["run_id","uuid",true,null],["host_instance_id","uuid",true,null],["created_at","timestamp with time zone",true,"clock_timestamp()"]],"constraints":[["native_coding_physical_fence_h205f22_pkey","PRIMARY KEY (run_id)","p",true,false,false]],"indexes":["CREATE UNIQUE INDEX native_coding_physical_fence_h205f22_pkey ON destruktion_meta.native_coding_physical_fence_h205f22 USING btree (run_id)"]},{"relname":"native_coding_physical_request_h205f22","columns":[["request_id","uuid",true,null],["request","jsonb",true,null],["terminal","jsonb",false,null],["created_at","timestamp with time zone",true,"clock_timestamp()"],["settled_at","timestamp with time zone",false,null]],"constraints":[["native_coding_physical_request_h205f22_check","CHECK (((terminal IS NULL) = (settled_at IS NULL)))","c",true,false,false],["native_coding_physical_request_h205f22_pkey","PRIMARY KEY (request_id)","p",true,false,false],["native_coding_physical_request_h205f22_request_check","CHECK (((jsonb_typeof(request) = ''object''::text) AND (octet_length((request)::text) <= 524288)))","c",true,false,false],["native_coding_physical_request_h205f22_terminal_check","CHECK (((terminal IS NULL) OR ((jsonb_typeof(terminal) = ''object''::text) AND (octet_length((terminal)::text) <= 262144))))","c",true,false,false]],"indexes":["CREATE UNIQUE INDEX native_coding_physical_request_h205f22_pkey ON destruktion_meta.native_coding_physical_request_h205f22 USING btree (request_id)"]},{"relname":"native_coding_physical_resolution_h205f22","columns":[["device_id","uuid",true,null],["client_id","text",true,null],["admin_grant_epoch","bigint",true,null],["device_key_fingerprint_sha256","text",true,null],["host_instance_id","uuid",true,null],["generation","bigint",true,null],["observed_at","timestamp with time zone",true,null],["postgres_scope_sha256","text",true,null],["kind","text",true,null],["key","text",true,null],["durable_sha256","text",true,null],["proof_sha256","text",true,null]],"constraints":[["native_coding_physical_resol_device_key_fingerprint_sha25_check","CHECK ((device_key_fingerprint_sha256 ~ ''^[a-f0-9]{64}$''::text))","c",true,false,false],["native_coding_physical_resolution_h205f22_client_id_check","CHECK (((length(client_id) >= 1) AND (length(client_id) <= 256)))","c",true,false,false],["native_coding_physical_resolution_h205f22_durable_sha256_check","CHECK ((durable_sha256 ~ ''^[a-f0-9]{64}$''::text))","c",true,false,false],["native_coding_physical_resolution_h205f22_generation_check","CHECK (((generation >= 1) AND (generation <= ''9007199254740991''::bigint)))","c",true,false,false],["native_coding_physical_resolution_h205f22_key_check","CHECK (((length(key) >= 1) AND (length(key) <= 80)))","c",true,false,false],["native_coding_physical_resolution_h205f22_kind_check","CHECK ((kind = ANY (ARRAY[''TASK''::text, ''SETUP''::text])))","c",true,false,false],["native_coding_physical_resolution_h205f22_pkey","PRIMARY KEY (device_id, host_instance_id, generation, observed_at, postgres_scope_sha256, kind, key)","p",true,false,false],["native_coding_physical_resolution_h205f22_proof_sha256_check","CHECK ((proof_sha256 ~ ''^[a-f0-9]{64}$''::text))","c",true,false,false],["native_coding_physical_resolution_h205f_admin_grant_epoch_check","CHECK (((admin_grant_epoch >= 1) AND (admin_grant_epoch <= ''9007199254740991''::bigint)))","c",true,false,false],["native_coding_physical_resolution_h_postgres_scope_sha256_check","CHECK ((postgres_scope_sha256 ~ ''^[a-f0-9]{64}$''::text))","c",true,false,false]],"indexes":["CREATE UNIQUE INDEX native_coding_physical_resolution_h205f22_pkey ON destruktion_meta.native_coding_physical_resolution_h205f22 USING btree (device_id, host_instance_id, generation, observed_at, postgres_scope_sha256, kind, key)"]}]'::jsonb;spec jsonb;f record;t oid;actual jsonb;present integer;tr record;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_physical_migration_owner_required';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-physical-custody-install',303003));
 select count(*) into present from jsonb_array_elements(expected) x where to_regclass('destruktion_meta.'||(x->>'relname')) is not null;
 select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang
  where p.oid=to_regprocedure('destruktion_meta.native_coding_physical_write_guard_v1()');
 if present=0 and f.oid is null then return;end if;
 if present<>jsonb_array_length(expected) or f.oid is null then raise exception 'native_physical_partial_install';end if;
 if f.proowner<>to_regrole('state_owner') or f.prorettype<>to_regtype('trigger') or f.prokind<>'f' or f.proisstrict or f.proleakproof
  or f.proparallel<>'u' or f.prosecdef or f.proretset or f.provolatile<>'v' or f.lanname<>'plpgsql' or f.pronargdefaults<>0 or f.provariadic<>0
  or f.pronargs<>0 or f.proargnames is not null or f.proallargtypes is not null
  or f.proconfig is distinct from array['search_path=pg_catalog, public, destruktion_meta']::text[]
  or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee<>f.proowner)
  or encode(extensions.digest(convert_to(replace(f.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex')<>'8fe7838fdaa213204fe42bec26312ea8fbb6e930f4812425a4206fbc6c974a27'
 then raise exception 'native_physical_function_requires_review';end if;
 for spec in select value from jsonb_array_elements(expected) loop
  t:=to_regclass('destruktion_meta.'||(spec->>'relname'));
  if exists(select 1 from pg_class c where c.oid=t and (c.relkind<>'r' or c.relpersistence<>'p' or c.relispartition
    or not c.relrowsecurity or c.relforcerowsecurity or c.relowner<>to_regrole('state_owner')
    or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner)))
   or exists(select 1 from pg_policy where polrelid=t) or exists(select 1 from pg_rewrite where ev_class=t)
   or exists(select 1 from pg_inherits where inhrelid=t or inhparent=t)
   or exists(select 1 from pg_attribute a where a.attrelid=t and a.attnum>0 and (a.attisdropped or a.attidentity<>'' or a.attgenerated<>''
    or exists(select 1 from aclexplode(a.attacl) acl where acl.grantee<>to_regrole('state_owner'))))
  then raise exception 'native_physical_relation_authority_requires_review:%',spec->>'relname';end if;
  select coalesce(jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum),'[]'::jsonb) into actual
   from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=t and a.attnum>0 and not a.attisdropped;
  if actual is distinct from spec->'columns' then raise exception 'native_physical_columns_require_review:%',spec->>'relname';end if;
  select coalesce(jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid),contype,convalidated,condeferrable,condeferred) order by conname),'[]'::jsonb) into actual from pg_constraint where conrelid=t;
  if actual is distinct from spec->'constraints' then raise exception 'native_physical_constraints_require_review:%',spec->>'relname';end if;
  select coalesce(jsonb_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid::regclass::text),'[]'::jsonb) into actual from pg_index i where i.indrelid=t;
  if actual is distinct from spec->'indexes' or exists(select 1 from pg_index where indrelid=t and (not indisvalid or not indisready or not indislive))
  then raise exception 'native_physical_indexes_require_review:%',spec->>'relname';end if;
  if (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>2 then raise exception 'native_physical_triggers_require_review:%',spec->>'relname';end if;
  for tr in select * from pg_trigger where tgrelid=t and not tgisinternal loop
   if tr.tgname not in ('native_physical_write_guard_v1','native_physical_truncate_guard_v1') or tr.tgfoid<>f.oid
    or tr.tgtype<>(case when tr.tgname='native_physical_write_guard_v1' then 31 else 34 end) or tr.tgenabled<>'O'
    or tr.tgqual is not null or tr.tgnargs<>0 or tr.tgattr<>''::int2vector or tr.tgconstraint<>0 or tr.tgdeferrable
    or tr.tginitdeferred or tr.tgparentid<>0 or tr.tgargs<>''::bytea
   then raise exception 'native_physical_triggers_require_review:%',spec->>'relname';end if;
  end loop;
 end loop;
end $review$;
-- END PHYSICAL CUSTODY REPLAY ATTESTATION
-- Private physical custody, separate from logical execution and readiness.
-- SQL stores original bytes and one-way observations; it is NOT a proof verifier.
-- The existing state_owner Host producer and independent consumer are required.
-- Apply atomically. Exact catalog replay attestation is prepended below.

create table if not exists destruktion_meta.native_coding_physical_request_h205f22(
 request_id uuid primary key,
 request jsonb not null check(jsonb_typeof(request)='object' and octet_length(request::text)<=524288),
 terminal jsonb check(terminal is null or jsonb_typeof(terminal)='object' and octet_length(terminal::text)<=262144),
 created_at timestamptz not null default clock_timestamp(),
 settled_at timestamptz,
 check((terminal is null)=(settled_at is null))
);
create table if not exists destruktion_meta.native_coding_physical_closure_h205f22(
 kind text not null check(kind in ('TASK','SETUP')),
 key text not null check(length(key) between 1 and 80),
 closure jsonb not null check(jsonb_typeof(closure)='object' and octet_length(closure::text)<=16777216),
 created_at timestamptz not null default clock_timestamp(),
 primary key(kind,key)
);
-- A durable run fence forbids late original AGENT dispatch. It grants no work.
create table if not exists destruktion_meta.native_coding_physical_fence_h205f22(
 run_id uuid primary key,
 host_instance_id uuid not null,
 created_at timestamptz not null default clock_timestamp()
);
-- Disposable private observation cache; removing it can only restore HOLD.
-- Original requests, terminal observations, closures and fences are retained.
create table if not exists destruktion_meta.native_coding_physical_resolution_h205f22(
 device_id uuid not null,
 client_id text not null check(length(client_id) between 1 and 256),
 admin_grant_epoch bigint not null check(admin_grant_epoch between 1 and 9007199254740991),
 device_key_fingerprint_sha256 text not null check(device_key_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
 host_instance_id uuid not null,
 generation bigint not null check(generation between 1 and 9007199254740991),
 observed_at timestamptz not null,
 postgres_scope_sha256 text not null check(postgres_scope_sha256 ~ '^[a-f0-9]{64}$'),
 kind text not null check(kind in ('TASK','SETUP')),
 key text not null check(length(key) between 1 and 80),
 durable_sha256 text not null check(durable_sha256 ~ '^[a-f0-9]{64}$'),
 proof_sha256 text not null check(proof_sha256 ~ '^[a-f0-9]{64}$'),
 primary key(device_id,host_instance_id,generation,observed_at,postgres_scope_sha256,kind,key)
);

create or replace function destruktion_meta.native_coding_physical_write_guard_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_physical_state_owner_required' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'serializable' or current_setting('synchronous_commit')<>'on'
  or current_setting('fsync')<>'on' or current_setting('full_page_writes')<>'on'
  or not exists(select 1 from pg_class where oid=tg_relid and relkind='r' and relpersistence='p' and not relispartition)
 then raise exception 'native_physical_durable_transaction_required' using errcode='25000';end if;
 if tg_op='TRUNCATE' then raise exception 'native_physical_history_retained';end if;
 if tg_table_name='native_coding_physical_request_h205f22' then
  if tg_op='DELETE' then raise exception 'native_physical_request_retained';end if;
  if tg_op='INSERT' then
   if new.terminal is not null or new.settled_at is not null then raise exception 'native_physical_initial_terminal_forbidden';end if;
   new.created_at:=clock_timestamp();return new;
  end if;
  if old.terminal is not null or new.terminal is null or new.request_id is distinct from old.request_id
   or new.request is distinct from old.request or new.created_at is distinct from old.created_at
   or new.settled_at is distinct from old.settled_at
  then raise exception 'native_physical_request_immutable';end if;
  new.settled_at:=clock_timestamp();return new;
 elsif tg_table_name='native_coding_physical_resolution_h205f22' then
  if tg_op='UPDATE' then raise exception 'native_physical_resolution_immutable';end if;
  if tg_op='DELETE' then return old;end if;
  return new;
 elsif tg_table_name in ('native_coding_physical_closure_h205f22','native_coding_physical_fence_h205f22') then
  if tg_op<>'INSERT' then raise exception 'native_physical_history_retained';end if;
  new.created_at:=clock_timestamp();return new;
 end if;
 raise exception 'native_physical_guard_relation_unbound';
end $$;
revoke all on function destruktion_meta.native_coding_physical_write_guard_v1() from public,anon,authenticated,service_role;

alter table destruktion_meta.native_coding_physical_request_h205f22 enable row level security;
alter table destruktion_meta.native_coding_physical_closure_h205f22 enable row level security;
alter table destruktion_meta.native_coding_physical_fence_h205f22 enable row level security;
alter table destruktion_meta.native_coding_physical_resolution_h205f22 enable row level security;
revoke all on destruktion_meta.native_coding_physical_request_h205f22,destruktion_meta.native_coding_physical_closure_h205f22,
 destruktion_meta.native_coding_physical_fence_h205f22,destruktion_meta.native_coding_physical_resolution_h205f22 from public,anon,authenticated,service_role;

drop trigger if exists native_physical_write_guard_v1 on destruktion_meta.native_coding_physical_request_h205f22;
create trigger native_physical_write_guard_v1 before insert or update or delete on destruktion_meta.native_coding_physical_request_h205f22
 for each row execute function destruktion_meta.native_coding_physical_write_guard_v1();
drop trigger if exists native_physical_truncate_guard_v1 on destruktion_meta.native_coding_physical_request_h205f22;
create trigger native_physical_truncate_guard_v1 before truncate on destruktion_meta.native_coding_physical_request_h205f22
 for each statement execute function destruktion_meta.native_coding_physical_write_guard_v1();
drop trigger if exists native_physical_write_guard_v1 on destruktion_meta.native_coding_physical_closure_h205f22;
create trigger native_physical_write_guard_v1 before insert or update or delete on destruktion_meta.native_coding_physical_closure_h205f22
 for each row execute function destruktion_meta.native_coding_physical_write_guard_v1();
drop trigger if exists native_physical_truncate_guard_v1 on destruktion_meta.native_coding_physical_closure_h205f22;
create trigger native_physical_truncate_guard_v1 before truncate on destruktion_meta.native_coding_physical_closure_h205f22
 for each statement execute function destruktion_meta.native_coding_physical_write_guard_v1();
drop trigger if exists native_physical_write_guard_v1 on destruktion_meta.native_coding_physical_fence_h205f22;
create trigger native_physical_write_guard_v1 before insert or update or delete on destruktion_meta.native_coding_physical_fence_h205f22
 for each row execute function destruktion_meta.native_coding_physical_write_guard_v1();
drop trigger if exists native_physical_truncate_guard_v1 on destruktion_meta.native_coding_physical_fence_h205f22;
create trigger native_physical_truncate_guard_v1 before truncate on destruktion_meta.native_coding_physical_fence_h205f22
 for each statement execute function destruktion_meta.native_coding_physical_write_guard_v1();
drop trigger if exists native_physical_write_guard_v1 on destruktion_meta.native_coding_physical_resolution_h205f22;
create trigger native_physical_write_guard_v1 before insert or update or delete on destruktion_meta.native_coding_physical_resolution_h205f22
 for each row execute function destruktion_meta.native_coding_physical_write_guard_v1();
drop trigger if exists native_physical_truncate_guard_v1 on destruktion_meta.native_coding_physical_resolution_h205f22;
create trigger native_physical_truncate_guard_v1 before truncate on destruktion_meta.native_coding_physical_resolution_h205f22
 for each statement execute function destruktion_meta.native_coding_physical_write_guard_v1();
