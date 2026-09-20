# METAENGINE — ДЕТАЛЬНЫЙ АНАЛИЗ КАПСУЛЫ + РЕПО + БД, ПОДГОТОВКА К РАЗРАБОТКЕ
**Дата:** 2026-09-21. **Task ID:** CAPSULE-ANALYSIS-20260921-002. **Прямой преемник:** CAPSULE-HANDOFF-20260921-001.

---

## 1. ЧТО БЫЛО В АРХИВЕ (инвентаризация)

`metaengine-handoff-main.zip`:
- `00_START_HERE_CAPSULE.md` — капсула передачи контекста (29 КБ): точка старта, карта механизмов, пути подключения live-браузера, состояние данных, git-карта, протокол работы, главная развилка текущего момента.
- `01_CREDENTIALS_AND_ENDPOINTS.md` — все токены/эндпоинты (GitHub admin token жив, проверен).
- `02_LIVE_TEST_CAMPAIGN.md` — план масштабных live-тестов T1–T12 (12 контуров).
- `METAENGINE_HANDOFF_CAPSULE_2026-09-21.tar.gz` — то же содержимое (капсула).
- `worklog-full.md` (777 КБ, 119 записей Task ID с 2026-08-21) — полная история проекта, включая восстановленные вечерние записи 2026-09-20 (3-a…7-c: Pigsty-интеграция, Tier 3, аудит, релиз).
- `worklog-recovered-entries.md` — реконструкция утраченных записей.
- `reference-from-rail/` — эталоны с рельсы: pigsty README/APP-INTEGRATION/RESTORE-REPORT, runbook деплоя edge (POSTGRES_NOTIFY wake).
- `reports/` — OPERATOR_GUIDE, ROADMAP_NEXT (частично устарели, датированы 08-22), browser-отчёты 09-16/09-17.

**Восстановлено в песочнице после сброса:**
- `/home/z/my-project/worklog.md` ← worklog-full.md (119 записей, продолжаем вести).
- `/home/z/my-project/a2-capsule/` — полная капсула локально.
- `/home/z/my-project/.ghtoken` + `/home/z/my-project/.a2-creds-01.md` (0600) — токен/креды.
- `/home/z/my-project/rsi-work/Compute-r` — полная пересборка git-checkout'а (был утрачен).

---

## 2. РЕПОЗИТОРИЙ И ВЕТКИ (анализ 2026-09-21)

**Монорепо:** `PatrickFrome/Compute` (Electron-браузер в `apps/metaengine-browser/`).
**Рельса (релизная истина):** `release/self-update-ambiguity-live-v2` @ `6bf173c71d` = merge #938. Локальный checkout уже на рельсе (HEAD совпадает).
**Всего веток:** 1155 (462 обновлялись за последние 7 дней). Структура по префиксам:
- `work/*` — основная разработка (RSI-конвергенции, browser-механики, DevOS). Большинство — исторические, слиты каскадом.
- `fix/*`, `repair/*` — точечные фиксы (sentinel, self-update, rollover, rate-limit, fleet…).
- `release/*` — релизные теги-ветки (a2-chat-bridge v0.5.x, browser 0.6.6-dev.x).
- `integration/*`, `analysis/*`, `ops/*`, `perf/*`, `scratch/*`, `tmp/*` — служебные/одноразовые.
- **Актуальное ядро (обновлялось 2026-09-20):** `update/browser-dev-channel` (d567da2d, DEV_HINT-канал), рельса, `work/browser-closed-loop-audit-fixes-v1` (#938), `work/t3-delta-bus-mission-control-rpc-v1` (#937), `work/pigsty-db-integration-v1` (#936), `work/browser-fleet-experience-driven-v1` (#935), плюс предшественники (`browser-live-check-observability`, `browser-work-graph-unified`, `browser-shell-quantum-console`, `browser-tier1-closed-loop-wave1`, RSI-хвосты финальной конвергенции).

**Релизы:** свежий `v0.7.0-dev.35532004761.1` (published 2026-09-20T19:33:37Z, target 6bf173c7, 7 ассетов, installer 121 МБ) — УСТАНОВЛЕН у оператора. Мономонотность версий соблюдена. Merge→publish ≈ 12.7 мин.
**CI:** 3320 тестов → 3318 pass / 0 fail / 2 skip на момент релиза; `npm run check` зелёный; Windows-грабли (pathToFileURL в ESM-dynamic-import; chmod-биты только POSIX) уже зашиты в тесты.
**Масштаб кода браузера:** 353 модуля `.mjs` в `src/`, 612 тестовых файлов, `ui/` (app.js/app.css/index.html — Mission Control), edge `supabase/a2-browser-native-supervisor-v1/` (index.ts 305 строк + 25 модулей-роутов).

**Верификация механик рельсы по коду (независимая, не по капсуле):**
- `tab-registry.mjs:15-16` — FLEET_TAB_CEILING=envBoundedInt(A2_FLEET_TAB_CEILING,28,4,64), MAX_TABS=envBoundedInt(A2_MAX_TABS,48,8,128), резерв 20 вкладок оператора. ✓
- `devos-native-task-cycle-core.mjs` — #advanceTaskOutcomeFor в #postCompletionWithReadback (1169/1242), retrieveMemory. ✓
- `supervisor-lifecycle-runtime-core.mjs:1276` — ROLLOVER_DEFERRED_AUTO_RELEASE (15 мин). ✓
- `browser-cognitive-delta-bus.mjs`, `metaengine-mission-control-projection.mjs`, `supervisor-loopback-rpc-server.mjs` — присутствуют, размеры адекватные. ✓
- Edge health рекламирует `emergency_wait_route:true`, `postgres_notify_wake:true`, `cognitive_delta_route:true` и пр. ✓
- `ui/app.js` рендерит mission_control из snapshot v3. ✓

---

## 3. БАЗА ДАННЫХ (анализ + фактическое восстановление в песочнице)

### 3.1 Что известно о смерти/эвакуации
- Облачный Supabase `xpeibufgzjknrhbhpffp` УДАЛЁН (лимиты; DNS мёртв). Полные данные — ТОЛЬКО у оператора (`supabase-backup-20260920.tar.gz` 38 МБ snapshot-consistent + `uploaded.clean.sql` 217 МБ): 264 таблицы манифест, 256/256 точное совпадение, storage 1831/1831, 16 ролей. На момент бэкапа: 311 МБ, 499 функций, 8 pgmq-очередей, 5 cron-задач.
- Pigsty-кластер песочницы умер при сбросе. Инфраструктура — в репо (`infra/pigsty/`, PR #936).

### 3.2 Карта схемы БД (по 103 миграциям репо)
- **public (командная плоскость браузера):** `compute_fabric_a2_browser_device_h205f22`, `_device_nonce_`, `_supervisor_command_` (PENDING→LEASED→COMPLETED/FAILED/EXPIRED/CANCELLED; authority_effect всегда false), `_supervisor_state_` (OFF/MONITOR/CONTROL), `_workspace_binding_`, `_reincarnation_receipt_`, `_chat_bridge_remote_*`.
- **destruktion_meta:** continuity-plane (`compute_continuity_*`), канонический roadmap/майлстоуны/сиды, duels, `devos_fleet_runtime_control`, `meta_orchestrator_*`.
- **Схемы Supabase-стиля:** auth, storage, realtime, vault, pgmq, cron, net, graphql, extensions.
- **Lane-классификация команд** (миграция 20260921000000, аудит-фикс #2): READ_ONLY / TAB_MUTATION / GLOBAL_MUTATION / **EMERGENCY** (DISARM, DEVELOPER_EMERGENCY_UPDATE, SET_SUPERVISOR_MODE(OFF)), effect_key `global:emergency` для emergency-lane; функция `h205f22_a2_browser_supervisor_lease_emergency_v1` (транзакционно-fenced, single-command).

### 3.3 ФАКТИЧЕСКИ РАЗВЁРНУТАЯ ЛОКАЛЬНАЯ БД (новое, сделано в этой сессии)
Развернул rootless PostgreSQL **17.11** на 127.0.0.1:**55432** (postgres/postgres) из Debian-пакетов без root по `infra/pigsty/bootstrap/01`:
- **Собраны расширения из исходников:** pgmq (SQL-extension), pg_net v0.20.5 (потребовался `postgresql-server-dev-17` + `with_llvm=no` — clang-19 отсутствует), supabase_vault (понадобился shared libsodium23 вместо статического -fPIC). pg_cron/wal2json — из apt. **6 расширений активны:** pg_cron, pg_net, pgcrypto(в схеме extensions — как в Supabase), pgmq, plpgsql, supabase_vault.
- **Supabase-совместимый шим:** роли (anon/authenticated/service_role/authenticator/supabase_*_admin), схемы auth/storage/realtime/extensions/net/graphql, стабы auth.uid()/auth.role()/realtime.send, публикация `supabase_realtime`.
- **Миграции: 69/103 применены** (журнал: download/db-migrations-apply-log-20260921.txt). Каталог миграций — пост-хронология облачной БД: 34 файла ссылаются на объекты, созданные вне миграций (ранняя ad-hoc эра). 19 уникальных недостающих объектов (список: download/db-migrations-missing-objects-20260921.txt), главный — **`destruktion_meta.devos_fleet_task_h205f22`** (от него зависят 10 миграций: DevOS-флот-плоскость), а также `devos_fleet_claim`, `compute_fabric_a2_supervisor_actuation_lease_h205f22`, `compute_fabric_roadmap_release`, `worker_probe/reboot_receipt`, `coordination_read_barrier_h205f22()`, `devos_fleet_enqueue_v1()` и др.
- **Командный контур браузера — ПОЛНОСТЬЮ ЖИВ и проверен функционально:**
  - lane-классификация: POLL→READ_ONLY ✓; DEVELOPER_EMERGENCY_UPDATE→**EMERGENCY + effect_key global:emergency** ✓ (аудит-фикс #2 подтверждён на живой локальной БД).
  - `lease_batch_v1` (CONTROL, 10s, max 16/8) → вернул корректный envelope `metaengine.native-supervisor.command-batch.v1`, leased_count=1 ✓.
  - `lease_emergency_v1` → вернул `metaengine.native-supervisor.emergency-lease.v1` с командой, authority flags=false ✓.
  - Wake-триггер `glm_pulse_command` (AFTER INSERT+UPDATE) восстановлен на supervisor_command (функция `glm_browser_pulse_notify_v1` была в миграциях, триггер — облачный артефакт) ✓.
- **smoke.sh: 10/13 PASS.** Три ожидаемых FAIL — исключительно класс «нет данных оператора»: storage.objects 0/1831, user tables 42/250, cron-задач 0/5 (cron-задачи создавались рантаймом). Это закроется восстановлением дампа оператора через `bootstrap/03-restore-supabase-backup.sh`.
- **Крон:** pg_cron с `use_background_workers=on` и `cron.host`=unix-socket — настройки канонические, задач пока нет (создание задач — следующий шаг после восстановления данных/появления supervisor-клиента).

**Вывод по БД:** локальная БД пригодна для разработки и локальной верификации command-fabric (issue→lease→receipt), emergency-транспорта, wake-механики и edge-кода. Для ПОЛНОГО паритета (DevOS fleet-плоскость, roadmap, storage, история) нужен дамп оператора.

---

## 4. ПУТИ ПОДКЛЮЧЕНИЯ LIVE-БРАУЗЕРА (состояние решений)

- **A — HTTP-слой (edge) перед локальной Pigsty:** теперь максимально близко — edge-код в репо, локальная БД с командным контуром уже развёрнута. Требуется: поднять edge (Deno/Supabase CLI локально или на VPS оператора) с `DB_URL=postgres://postgres:postgres@<host>:55432/postgres` (direct, НЕ pooler) и HTTPS-фасадом; затем сменить 3 pinned-константы клиента (сборка с новыми константами = новая релизная труба).
- **B — локальный режим браузера:** доступен оператору сразу (loopback RPC `~/.a2/supervisor-loopback.json`, локальный supervisor, Mission Control).
- **C — self-hosted Supabase на VPS:** 100% совместимость, migrate-кит у оператора.
- Рекомендация капсулы остаётся: начать с B (оператор локально), параллельно готовить A. Локальная БД песочницы — уже репетиция A (та же схема командной плоскости, lease-функции и wake-триггер).

---

## 5. ГОТОВНОСТЬ К РАЗРАБОТКЕ (что я могу делать сразу)

1. **Разработка в монорепо:** checkout рельсы на месте; ветка/PR/CI-труба по governance (merge — оператор-гейт); Windows-грабли учтены.
2. **Локальная верификация БД-механик:** командная плоскость, emergency-lane, wake, lease-контракты — воспроизводимы локально (порт 55432).
3. **Тест-кампания T1–T12:** T1 (окружение) готов на ~70% (без данных оператора); T5/T8/T11 (command fabric, emergency, wake) — верифицируемы на уровне БД/RPC локально; T2-T4, T6, T7, T9, T10 — требуют участия оператора (его Windows-машина) либо полного дампа.
4. **Служебные инструменты:** psql-обёртка `/home/z/.local/bin/psql`, `infra/pigsty/bin/pg-*`, smoke.sh — работают.

---

## 6. РИСКИ / ОТКРЫТЫЕ ВОПРОСЫ

1. **Данные оператора — единственные полные копии.** Без дампа DevOS-плоскость (`devos_fleet_task` и 18 других объектов) отсутствует; альтернатива — реконструировать DDL из edge-роутов/тестов (реальная задача следующего этапа, если оператор не даст дамп).
2. **Песочница неперманентна:** при следующем сбросе пропадут pigsty/checkout. АРТЕФАКТЫ ЗАЩИЩЕНЫ: инфраструктура в GitHub (репо), журналы в download/, worklog обновлён. Скрипт реанимации окружения — см. §5 п.4 + журналы (восстановление ~15 мин).
3. **Сборка расширений:** pg_net при пересборке требует `postgresql-server-dev-17` (apt) и `with_llvm=no`; supabase_vault — shared libsodium23. Паттерны зафиксированы в download/*build*.log.
4. **Edge-деплой — оператор-гейт** (management API 401 — по дизайну).
5. Cloudflare-токены (fabric-плоскость) у оператора, при необходимости запросить.

---

## 7. РЕКОМЕНДОВАННЫЕ СЛЕДУЮЩИЕ ШАГИ (приоритет)

1. **Оператор:** (a) выбрать путь A/B/C; (b) для полного паритета — выложить в чат/песочницу `supabase-backup-20260920.tar.gz` (38 МБ) для восстановления через `infra/pigsty/bootstrap/03`; (c) запустить установленный браузер и прислать содержимое `~/.a2/supervisor-loopback.json` (без токена) + скриншот Mission Control.
2. **Преемник (параллельно, без оператора):** реконструкция отсутствующих 19 облачных объектов по edge-роутам/тестам (начать с `devos_fleet_task_h205f22`, 10 зависимостей); локальная прогонка edge-функции (`a2-browser-native-supervisor-v1`) против локальной БД (T5/T8/T11-репетиция).
3. **Live-тесты T1–T12** по `02_LIVE_TEST_CAMPAIGN.md` после решения оператора.
