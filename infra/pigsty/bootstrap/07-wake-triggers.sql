-- ============================================================================
-- METAENGINE reconstruction 2026-09-21 (часть 3) — POSTGRES_NOTIFY wake.
-- Триггеры glm_pulse_* — облачные артефакты ВНЕ каталога миграций
-- (см. docs/push-wake-edge-deploy-runbook.md: "The database side is verified
-- LIVE": функция glm_browser_pulse_notify_v1 есть в миграции 20260906093000,
-- а вот привязка триггеров выполнялась ad-hoc в облаке).
-- Канал: glm_browser_pulse; парсер edge принимает {tbl,client,...} legacy-конверт.
-- ВАЖНО: применять ПОСЛЕ пересозданий командных таблиц (миграции дропают триггеры).
-- ============================================================================

drop trigger if exists glm_pulse_command on public.compute_fabric_a2_browser_supervisor_command_h205f22;
create trigger glm_pulse_command
after insert or update on public.compute_fabric_a2_browser_supervisor_command_h205f22
for each row execute function public.glm_browser_pulse_notify_v1();

-- state/mesh-привязки (контракт функции: attached to supervisor state and mesh)
drop trigger if exists glm_pulse_state on public.compute_fabric_a2_browser_supervisor_state_h205f22;
create trigger glm_pulse_state
after insert or update on public.compute_fabric_a2_browser_supervisor_state_h205f22
for each row execute function public.glm_browser_pulse_notify_v1();
