-- ─────────────────────────────────────────────────────────────────────────────
-- R56 (фаза D-исполнение, LIVE-блокер #2) — ГРАНТЫ для таблиц зеркала.
--
-- Урок R56: sql/0001..0002 применены pooler-ролью postgres → дефолтные привилегии
-- проекта дали anon/authenticated/service_role только REFERENCES,TRIGGER,TRUNCATE
-- (POSTgREST-проба записи = 403: authenticated-but-forbidden). Явные гранты —
-- канонический путь (не полагаемся на ALTER DEFAULT PRIVILEGES создателя).
--
-- Модель доступа (H6, fail-closed):
--   service_role   — запись+чтение зеркала (bypassrls, канал daemon'а, sb_secret/legacy JWT)
--   authenticated  — чтение (RLS-политики sql/0003: me2_*_read_auth) — UI с GoTrue-токеном
--   anon           — НИЧЕГО (fail-closed; проверяется anon-пробой панели)
-- Идемпотентно: повторный grant безвреден.
-- ─────────────────────────────────────────────────────────────────────────────

grant select, insert, update, delete on public.me2_event_mirror_h205f22 to service_role;
grant select on public.me2_event_mirror_h205f22 to authenticated;

grant select on public.me2_rpc_registry_h205f22 to service_role;
grant select on public.me2_rpc_registry_h205f22 to authenticated;
