-- ─────────────────────────────────────────────────────────────────────────────
-- ME2 H6 SQL-контур (R52, план electron-rebuild §D8/D9) — МИГРАЦИЯ ДЛЯ ОПЕРАТОРА.
--
-- Протокол (PGRST205, устоявшийся): DDL на проекте применяется ТОЛЬКО оператором
-- (service-role mgmt 401 — честное ограничение, не обходится). Демон при
-- ME2_SQL_MIRROR=1 и отсутствии таблицы держит состояние WARMUP и перепробует
-- не чаще ME2_SQL_MIRROR_PROBE_MS (по умолчанию 10 мин) — без retry-штормов.
-- После применения этой миграции контур сам перейдёт WARMUP → LIVE.
--
-- Истина данных: локальная SQLite (hash-chain). Таблица ниже — ДОПОЛНИТЕЛЬНОЕ
-- зеркало (read-модель для UI/федерации с гейтом RLS), не источник истины.
-- Идемпотентность доставки: PK (seq) + Prefer: resolution=ignore-duplicates.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.me2_event_mirror_h205f22 (
  seq         bigint primary key,              -- = events.id в локальной SQLite (монотонный курсор)
  ts          timestamptz not null,            -- время события у источника
  type        text not null,                   -- тип события шины (например TASK_DONE)
  actor       text not null default 'daemon',
  subject     text,
  payload     jsonb not null default '{}'::jsonb,
  prev_hash   text not null default '',
  hash        text not null,                   -- hash-chain: независимая верификация зеркала
  daemon_version text not null default '',
  mirrored_at timestamptz not null default now()
);

-- Чтение — только аутентифицированным (RLS; сервис-роль пишет, UI/аноним не читают без политики).
alter table public.me2_event_mirror_h205f22 enable row level security;

-- Индексы read-модели: лента по времени, фильтр по типу, поиск по субъекту.
create index if not exists me2_event_mirror_ts_idx   on public.me2_event_mirror_h205f22 (ts desc);
create index if not exists me2_event_mirror_type_idx on public.me2_event_mirror_h205f22 (type, seq desc);
create index if not exists me2_event_mirror_subj_idx on public.me2_event_mirror_h205f22 (subject) where subject is not null;
