-- METAENGINE / ME2 evidence plane — canonical promotion (audit fixpack2, 2026-10-18)
--
-- History: this DDL previously existed ONLY as apps/me2-daemon/supabase-migration-me2-evidence.sql,
-- a "run in the Supabase SQL editor" instruction sheet that the daemon's evidence.ts DDL
-- self-heal applies opportunistically at runtime. A fresh project built purely from this
-- migration chain got no evidence surface at all (evidence.ts: ingest RPC me2_ingest_evidence_v1,
-- direct-table fallback, storage mirror — all absent until a daemon booted and self-healed).
-- This migration makes the chain the primary authority; the app-local file remains the
-- self-heal payload and MUST be kept byte-compatible with this file.
--
-- Behavior after this migration: daemon evidence.ts transitions DEGRADED → LIVE and
-- drains the accumulated outbox (GET /evidence shows method).
--
-- Idempotent by design: safe against the live cloud (where the SQL-editor copy already
-- ran) and against fresh projects.

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
revoke all on public.me2_evidence from anon, authenticated;

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
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if current_role <> 'service_role' then
    raise exception 'forbidden';
  end if;
  insert into public.me2_evidence (seq, ts, type, agent_id, task_id, data, prev_hash, hash)
  select
    (e->>'seq')::bigint,
    (e->>'ts')::timestamptz,
    e->>'type',
    nullif(e->>'agent_id',''),
    nullif(e->>'task_id',''),
    (e->>'data'),
    nullif(e->>'prev_hash',''),
    nullif(e->>'hash','')
  from jsonb_array_elements(p_events) as e
  on conflict (seq) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.me2_ingest_evidence_v1(jsonb) to service_role;
revoke execute on function public.me2_ingest_evidence_v1(jsonb) from anon, authenticated;
