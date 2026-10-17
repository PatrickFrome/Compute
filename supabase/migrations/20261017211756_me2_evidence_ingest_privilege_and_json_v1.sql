-- Forward-compatible repair for existing legacy evidence installs.
-- Generated with Supabase CLI; includes idempotent DDL because its UTC timestamp
-- precedes the future-dated canonical promotion. Both orders preserve the repair.
-- No hosted migration or production promotion is authorized by this file.
create table if not exists public.me2_evidence (
  seq          bigint primary key,
  ts           timestamptz not null,
  type         text not null,
  agent_id     text,
  task_id      text,
  data         jsonb,
  prev_hash    text,
  hash         text,
  ingested_at  timestamptz not null default now()
);

-- service_role пишет, никто не читает напрямую (evidence читается RPC-ами позже)
grant insert on public.me2_evidence to service_role;
-- The trusted local mirror reads an existing row to reject a conflicting
-- sequence. Public roles remain denied below.
grant select on public.me2_evidence to service_role;
revoke all on public.me2_evidence from public, anon, authenticated;

alter table public.me2_evidence enable row level security;
-- policies have no IF NOT EXISTS: guard explicitly so re-runs against the live cloud survive
do $guard$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'me2_evidence'
       and policyname = 'service_role_full_access'
  ) then
    create policy "service_role_full_access"
      on public.me2_evidence for all to service_role using (true) with check (true);
  else
    raise notice 'policy me2_evidence/service_role_full_access already present; skipping';
  end if;
end
$guard$;

create index if not exists idx_me2_evidence_type on public.me2_evidence(type, ts desc);
create index if not exists idx_me2_evidence_task on public.me2_evidence(task_id) where task_id is not null;

-- Опционально: batch-RPC (daemon пробует его первым; тело совпадает с строками таблицы)
create or replace function public.me2_ingest_evidence_v1(p_events jsonb)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  n integer := 0;
  e jsonb;
  seq_v bigint;
  ts_v timestamptz;
  type_v text;
  agent_v text;
  task_v text;
  data_v jsonb;
  prev_v text;
  hash_v text;
  existing public.me2_evidence%rowtype;
begin
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'evidence_events_array_required' using errcode = '22023';
  end if;
  if current_user <> 'service_role' then
    raise exception 'forbidden';
  end if;
  for e in select value from jsonb_array_elements(p_events) loop
    seq_v := (e->>'seq')::bigint;
    ts_v := (e->>'ts')::timestamptz;
    type_v := e->>'type';
    agent_v := nullif(e->>'agent_id','');
    task_v := nullif(e->>'task_id','');
    prev_v := nullif(e->>'prev_hash','');
    hash_v := nullif(e->>'hash','');
    -- The daemon's SQLite event row stores data as an encoded JSON string;
    -- accept that wire shape and native JSON objects without double encoding.
    if jsonb_typeof(e->'data') = 'string' then
      data_v := (e->>'data')::jsonb;
    else
      data_v := e->'data';
    end if;
    select * into existing from public.me2_evidence where seq = seq_v;
    if found then
      if existing.ts is distinct from ts_v
         or existing.type is distinct from type_v
         or existing.agent_id is distinct from agent_v
         or existing.task_id is distinct from task_v
         or existing.data is distinct from data_v
         or existing.prev_hash is distinct from prev_v
         or existing.hash is distinct from hash_v then
        raise exception 'evidence_seq_conflict:%', seq_v using errcode = '23505';
      end if;
    else
      insert into public.me2_evidence (seq, ts, type, agent_id, task_id, data, prev_hash, hash)
      values (seq_v, ts_v, type_v, agent_v, task_v, data_v, prev_v, hash_v);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

grant execute on function public.me2_ingest_evidence_v1(jsonb) to service_role;
revoke all on function public.me2_ingest_evidence_v1(jsonb) from public, anon, authenticated;
