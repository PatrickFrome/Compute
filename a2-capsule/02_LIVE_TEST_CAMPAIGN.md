# 02 — ПЛАН МАСШТАБНЫХ LIVE-ТЕСТОВ ВСЕХ МЕХАНИЗМОВ (T1–T12)

Составлен 2026-09-20/21 для установленной сборки `v0.7.0-dev.35532004761.1` (target 6bf173c7). Выполняется после выбора пути подключения (см. 00 §4: A — edge перед Pigsty; B — локальный режим; C — self-hosted Supabase). Часть тестов требует участия оператора (его машина с браузером), часть — только БД/edge, часть — только песочницу.

Обозначения: [B] — нужен локальный путь браузера (loopback/локальный supervisor), [A/C] — нужен remote-контур (edge+БД), [OP] — действия оператора руками, [SB] — песочница.

## T1. Окружение [SB]
- Pigsty: `PGPASSWORD=postgres psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -Atc "select now(); select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema');"` (ожидалось 272 до сброса; после восстановления — от 250)
- Если кластер мёртв: восстановление по `infra/pigsty/bootstrap/` (01 rootless pg17 → 02 расширения → 03 restore из dump оператора) + `smoke.sh` 13/13
- Cron: `select jobname, state from cron.job;` + свежие `cron.job_run_details`
- Publication: `select * from pg_publication;` (supabase_realtime), `show wal_level;` (logical)

## T2. Обнаружение live-браузера [OP][A/C]
- [OP] Запуск браузера. Проверка версии: About/логи — должно быть `0.7.0-dev.35532004761.1` (git_sha 6bf173c7)
- [OP] Содержимое `~/.a2/supervisor-loopback.json` (после старта): URL + token (не публиковать токен открыто)
- [A/C] В БД: свежие heartbeats/registrations в таблицах compute_fabric_* (device/supervisor): `select * from <supervisor_state_table> order by updated_at desc limit 5;` (имена таблиц см. schema-ddl.sql из бэкапа; ключевые: compute_fabric_a2_browser_*)
- Проверка, что браузер на dev-канале видит DEV_HINT (версия совпадает с последней)

## T3. Supervisor-контур [B][OP]
- Loopback RPC: POST /rpc `supervisor.health` → живой ответ; `supervisor.snapshot` → состояние (fleet generations, mesh epoch, compute state, loopback_rpc метаданные, work_graph)
- Lifecycle: наблюдать rollover-цикл (RLS_ROLLOVER_* в снимке); ROLLOVER_DEFERRED → авто-релиз ≤15 мин (`ROLLOVER_DEFERRED_AUTO_RELEASE`)
- Restarts: перезапуск браузера → supervisor восстанавливается, вкладки/флот восстанавливаются, сессия переживает рестарт

## T4. Fleet-контур [B][OP]
- Снимок: количество вкладок/агентов, потолки (A2_FLEET_TAB_CEILING=28, A2_MAX_TABS=48 по умолчанию), ростер 16+сводка по ролям
- Census: вкладки появляются/уходят, budgets 4..16 масштабируются с флотом
- Elastic: нагрузить (открыть много вкладок/задач) → флот растёт; снять → retire ≤8/цикл с reliability-порядком (Outcome River)
- Coordination: тесная координация — общие очереди задач, absence дублирования назначений

## T5. Command fabric (issue → lease → execute → receipt → readback) [A/C]
- Через БД/RPC: issue-batch v2 (мини-команда, напр. NOOP/проба) → lease (16 параллельных) → browser исполняет → receipt записан → readback подтверждает
- Проверить идемпотентность effect_key, отсутствие двойного исполнения
- Terminal broadcast/outbox события возникают

## T6. Память (collaboration memory plane) [B]
- Прогнать DevOS-задачу до терминального исхода → эпизод материализован (`episode_materialized`, progress_revision=lease_gen+1)
- Вторая задача: в её промпте виден блок TEAM MEMORY (≤1400 токенов; ретривал 5 эпизодов/900 токенов; lease-детерминированный кэш)
- Повторный терминальный исход той же задачи НЕ дублирует эпизод (terminal_task_immutable)
- В БД (если [A/C]): таблицы памяти plane содержат свежие эпизоды

## T7. DevOS / work_graph / RSI / cognitive delta [B]
- work_graph рендерится в Mission Control (objectives→tasks→agents→effects)
- DevOS superstep/promotion-роуты отвечают
- RSI: skill lifecycle — оператор-гейт (graduation-цепочка); кнопки RSI в UI пишут в реальный контур (не console) — проверить артефакт/событие
- Cognitive delta bus: SYSTEM-события (fleet lifecycle, supervisor command, artifact recorded, compute health) в systemDeltaTail; IPC `metaengine:shell:system-deltas` доставляет в шелл

## T8. Emergency-транспорт [A/C]
- Миграция 20260921000000 применена (EMERGENCY lane, effect_key global:emergency, lease_emergency_v1, грант service_role)
- Edge wait-роут (`emergency_wait_route:true` в health) принимает DEVELOPER_EMERGENCY_UPDATE
- Тест: положить emergency-команду → браузер (свежая вкладка) принимает и исполняет; lease не конфликтует с обычным

## T9. Self-update / Guardian / watchdog [OP][A/C]
- dev.yml + verified-self-update-manifest.json в релизе валидны (sha256)
- [OP] Установленный браузер получил автообновление до текущего DEV_HINT (или совпадает)
- Guardian-бинарники в ассетах; watchdog-JSON (`browser_*_update_watchdog.json` — прежние отчёты в reports/)
- Тест N→N+1 уже физически верифицирован CI (self-update-fast-e2e); live-проверка: дождаться следующего пуша в рельсу или DEV_HINT-обновления

## T10. UI (включая Mission Control) [OP]
- Mission Control — экран по умолчанию: счётчики, дерево целей/задач/агентов, живые эффекты из когнитивной шины, артефакты с DevOS evidence-открывашкой
- Workspace observation: DOM-снимки вкладок (observation routes)
- Omnibus/консоль quantum-shell (если в сборке): подсказки, статус механизмов
- Тёмная тема/адаптивность/скорость; скриншоты от оператора для каждого экрана
- Loopback RPC доступен из UI/девтулов браузера (тот же fenced executor)

## T11. Realtime wake (POSTGRES_NOTIFY) [A/C]
- pg_notify в нужный канал (postgres-command-wake / realtime-command-wake) → браузер просыпается без polling-задержки
- Проверить: BOUNDED_DB_POLL → POSTGRES_NOTIFY путь после edge-deploy HEAD по runbook (reference-from-rail/docs_push-wake-edge-deploy-runbook.md)

## T12. Сводный отчёт [SB]
- Все находки → worklog (Task ID: LIVE-TEST-CAMPAIGN-001...)
- Классификация: PASS / FAIL / BLOCKED (с указанием, что блокирует: cloud мёртв / нужен VPS / нужен оператор)
- Отчёт оператору: что живо, что требует инфраструктуры, что сломано — с патчами в ветку и PR по необходимости

## Известные блокеры заранее (чтобы не искать ложные баги)
- Remote-механики (T5, T8, T11, heartbeat в БД) НЕ работают против мёртвого облака — это НЕ баг браузера; нужен вариант A или C
- Edge-деплой = оператор-действие по дизайну (management API 401 — норма)
- RSI graduation и authority-эффекты — оператор-гейты (zero-authority архитектура), «декоративность» тут НЕ диагноз
