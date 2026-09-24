-- R23: миграция evidence-плоскости ME2 для восстановленного Supabase-проекта
-- (xpeibufgzjknrhbhpffp). Запустить в SQL Editor дашборда.
-- Контракт: mini-services/me2-daemon/evidence.ts → pushBatch()
--   путь 1 (предпочтительный): POST /rest/v1/rpc/me2_ingest_evidence_v1  {p_events: [...]}
--   путь 2 (fallback):        POST /rest/v1/me2_evidence  (массив событий как строки)
-- Событие = {seq, ts, type, agent_id, task_id, data, prev_hash, hash}
-- (hash-chain из store.ts emit(); data — строка JSON).

create table if not exists public.me2_evidence (
  seq        bigint primary key,
  ts         timestamptz not null default now(),
  type       text        not null,
  agent_id   text,
  task_id    text,
  data       jsonb,
  prev_hash  text,
  hash       text,
  ingested_at timestamptz not null default now()
);

create index if not exists me2_evidence_type_ts on public.me2_evidence (type, ts desc);

create or replace function public.me2_ingest_evidence_v1(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e jsonb;
  v_inserted int := 0;
  v_skipped  int := 0;
begin
  if p_events is null then
    return jsonb_build_object('inserted', 0, 'skipped', 0, 'error', 'p_events_required');
  end if;
  for e in select * from jsonb_array_elements(p_events)
  loop
    begin
      insert into public.me2_evidence (seq, ts, type, agent_id, task_id, data, prev_hash, hash)
      values (
        (e->>'seq')::bigint,
        coalesce(nullif(e->>'ts','')::timestamptz, now()),
        coalesce(e->>'type', 'UNKNOWN'),
        nullif(e->>'agent_id', ''),
        nullif(e->>'task_id', ''),
        (case when jsonb_typeof(e->'data') = 'object' then e->'data' else nullif(e->>'data','')::jsonb end),
        e->>'prev_hash',
        e->>'hash'
      )
      on conflict (seq) do nothing;
      if found then v_inserted := v_inserted + 1; else v_skipped := v_skipped + 1; end if;
    exception when others then
      v_skipped := v_skipped + 1; -- битая строка не роняет батч (hash-chain восстановим по seq)
    end;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
end $$;

-- evidence.ts шлёт с ключом service (sb_secret) — RLS, но с политиками для service_role
alter table public.me2_evidence enable row level security;
drop policy if exists me2_evidence_service_all on public.me2_evidence;
create policy me2_evidence_service_all on public.me2_evidence
  for all to service_role using (true) with check (true);

grant select, insert, update on public.me2_evidence to service_role;
grant execute on function public.me2_ingest_evidence_v1(jsonb) to service_role;

-- после применения: evidence-plane ME2 оживёт сам (backoff-цикл догонит pending-очередь).
-- Проверка: GET /evidence на :3041 → mode:LIVE, метод rpc; SELECT count(*) FROM me2_evidence растёт.
