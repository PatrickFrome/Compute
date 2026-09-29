-- ─────────────────────────────────────────────────────────────────────────────
-- ME2 R53 (фаза D-исполнение, план §D8/H6) — RLS read-политики для SQL-зеркала.
-- Роль: UI читает зеркало ЧЕРЕЗ RLS-ГЕЙТ — короткоживущий JWT (HS256, ttl 120с)
-- роли `authenticated`, выпущенный daemon'ом из vault'а (SUPABASE_JWT_SECRET, R47).
-- anon-политики НЕТ намеренно: fail-closed (UI даже демонстрирует это в панели
-- «Зеркало SQL» — anon-проба обязана вернуть пусто/401; если строки видны — гейт
-- сломан и панель честно предупреждает).
-- Применение: psql $DATABASE_URL -f 0003-mirror-read-policy.sql (после 0001/0002).
-- Идемпотентно: DO-блоки проверяют pg_policies (PG не умеет CREATE POLICY IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Зеркало событий: SELECT только authenticated
do $$ begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='me2_event_mirror_h205f22'
                   and policyname='me2_event_mirror_read_auth') then
    create policy me2_event_mirror_read_auth on public.me2_event_mirror_h205f22
      for select to authenticated
      using (true);
  end if;
end $$;

-- 2) Реестр RPC (0002) — публичные метаданные классификации: SELECT authenticated.
--    (FREEZE-реестр не содержит секретов, но и не анонсируется анонимам.)
do $$ begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='me2_rpc_registry_h205f22'
                   and policyname='me2_rpc_registry_read_auth') then
    create policy me2_rpc_registry_read_auth on public.me2_rpc_registry_h205f22
      for select to authenticated
      using (true);
  end if;
end $$;

-- 3) Инвентарная сверка политик (видна оператору в psql-выводе)
select schemaname, tablename, policyname, roles
  from pg_policies
 where tablename in ('me2_event_mirror_h205f22','me2_rpc_registry_h205f22');
