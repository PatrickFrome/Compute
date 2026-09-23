-- ─────────────────────────────────────────────────────────────────────
-- ME2 evidence-plane migration (M5) — выполнить в Supabase SQL Editor
-- Проект: xpeibufgzjknrhbhpffp (METAENGINE_H205F22_RECOVERY)
-- После запуска daemon-модуль evidence.ts перейдёт DEGRADED → LIVE
-- и дольёт накопленный outbox (эндпоинт /evidence покажет method).
-- ─────────────────────────────────────────────────────────────────────

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
create policy "service_role_full_access"
  on public.me2_evidence for all to service_role using (true) with check (true);

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
