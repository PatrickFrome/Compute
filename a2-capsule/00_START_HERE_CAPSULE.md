# METAENGINE — КАПСУЛА ПОЛНОЙ ПЕРЕДАЧИ КОНТЕКСТА
**Дата запечатывания:** 2026-09-21 (UTC). **Отправитель:** GLM/Super Z (сессия web-f5276603). **Получатель:** преемник в новом чате.

Ты — продолжатель работы над проектом METAENGINE browser. Эта капсула — твоя полная стартовая память. Прочитай этот файл целиком, затем `01_CREDENTIALS_AND_ENDPOINTS.md`, затем `02_LIVE_TEST_CAMPAIGN.md`. Полная история всех сессий (с 2026-08-21) — в `worklog-full.md` (181 КБ, ~120 записей Task ID). Эталонные документы релизной рельсы — в `reference-from-rail/`.

**Язык общения с оператором:** русский. Оператор = пользователь, владелец всего: репозитория, токенов, инфраструктуры, установленного браузера.

---

## 1. ТОЧКА СТАРТА — что происходит прямо сейчас (КРИТИЧЕСКИЙ РАЗДЕЛ)

**Задача оператора на текущий момент (его последние слова):**
> «Установил, подключись к live браузеру и запусти масштабные тесты абсолютно всех механизмов, включая ui»

**Факты состояния на момент запечатывания:**

1. **Оператор УЖЕ УСТАНОВИЛ** свежайшую сборку `v0.7.0-dev.35532004761.1` (инсталлятор ~121 МБ, Windows x64, опубликован 2026-09-20T19:33:37Z, target = merge #938). Это самая полная сборка за историю проекта: в ней вся программа Closed Production Loop (T1+T2+T3) + Pigsty DB integration (#936/#937) + закрытие 6 аудиторских находок (#938).
2. **Облачный Supabase ПРОЕКТ УДАЛЁН.** Реф `xpeibufgzjknrhbhpffp`: DNS `xpeibufgzjknrhbhpffp.supabase.co` НЕ резолвится (проверено 2026-09-20 ~19:46 UTC: REST/edge = 000, DNS-FAIL; pooler aws-0-us-east-2 = «tenant not found»). Причина: лимиты Supabase исчерпаны, проект эвакуирован (lossless-бэкап был сделан и передан оператору ДО удаления — см. §5).
3. **Следствие:** установленный браузер со своими pinned-URL на `*.supabase.co` (remote edge `/functions/v1/a2-browser-native-supervisor-v1`, REST, auth) физически НЕ МОЖЕТ достучаться до мёртвого облака. Remote-путь (chat→edge→DB-lease) не работает до развёртывания нового HTTP-слоя. **Локальные пути браузера живы без облака:** native supervisor, loopback RPC (`~/.a2/supervisor-loopback.json`), локальный fleet, DevOS-цикл, Mission Control UI, cognitive delta bus (IPC), память (локальная плоскость).
4. **Песочница AI была частично сброшена между сессиями** (см. §6): pigsty-кластер и дампы БД в песочнице УМЕРЛИ; выжили worklog, download/-отчёты, scripts/, git-checkout (но на старой ветке). Данные БД теперь существуют ТОЛЬКО у оператора (архив `supabase-backup-20260920.tar.gz` 38 МБ, выданный ему 2026-09-20, + его оригинальный backup `uploaded.clean.sql` 217 МБ).

**Твои первые шаги (в порядке):**
1. Прочитать `01_CREDENTIALS_AND_ENDPOINTS.md` (GitHub-токен + всё остальное).
2. Оживить рабочее место: `git -C /home/z/my-project/rsi-work/Compute-r fetch origin && git checkout release/self-update-ambiguity-live-v2 && git pull` (checkout застрял на старой ветке `work/browser-shell-quantum-console-v1` @ 5f44aa89, БЕЗ infra/pigsty).
3. Выяснить у оператора, какой путь подключения live-браузера он хочет (см. §4: A — HTTP-шлюз перед Pigsty, B — локальный режим, C — VPS self-hosted Supabase). Для «масштабных тестов всех механизмов включая UI» быстрее всего начать с B (локальные пути) + A для remote-механик (command fabric lease, heartbeat в БД, emergency wait-роут, realtime wake).
4. Запустить тест-кампанию по `02_LIVE_TEST_CAMPAIGN.md` (12 контуров, T1–T12).
5. КАЖДЫЙ свой шаг фиксировать в `/home/z/my-project/worklog.md` (формат записей ниже в §8).

---

## 2. ПРОЕКТ — ЧТО ЭТО ВООБЩЕ ТАКОЕ

**METAENGINE browser** — Electron-приложение в монорепо `PatrickFrome/Compute`, путь `apps/metaengine-browser/`. Цель (формулировка оператора): браузер = платформа для **бесконечного autonomous agent swarm**: неограниченный флот агентов с тесной координацией/обзором/управлением, вечно работающие и самоперезапускающиеся супервизоры, память, brain, RSI, self-update, полный контроль. **Ни один механизм не должен быть декоративным.** Система должна вечно, автономно, без остановки разрабатывать поставленные задачи, обмениваться данными, самообновляться и улучшать собственное окружение.

Ключевые принципы, выстраданные за всю историю:
- **Zero-authority fencing:** браузер НИКОГДА не исполняет команды authority-уровня (запись на диск ОС, убийство процессов ОС и т.п.) без оператор-гейтов. Это НЕ баг, это архитектура.
- **Closed Production Loop:** каждый механизм обязан иметь полный контур «команда → исполнение → чекпойнт/квитанция → наблюдаемость → влияние на следующий цикл». Декоративность = преступление против проекта.
- **Supabase-совместимость протоколов** (PostgREST-стиль RPC, pgmq-очереди, realtime publication) — БД-слой отвязан от вендора (для этого Pigsty).

---

## 3. ЧТО РЕАЛИЗОВАНО И СЛИТО В РЕЛЬСУ (полная карта механизмов)

Рельса: **`release/self-update-ambiguity-live-v2` @ `6bf173c71dc3026b02171085d956625ef9526378`** (HEAD = merge #938).

### Программа Closed Production Loop (все 11 разрывов закрыты)
- **T1 ①②③** — supervisor/mesh continuity (earlier PRs, см. worklog).
- **T2 ④⑤⑥⑦** — production loop части (PR #935 и ранее): **⑨ fleet по reliability** — Outcome River → grace + reliability-ordered retirement (T3-9, merge #935).
- **T3 ⑧** когнитивная дельта-шина (PR #937): `BrowserCognitiveDeltaBus`, SYSTEM-события (`publishFleetAgentLifecycle`, `publishSupervisorCommand`, `publishArtifactRecorded`, `publishComputeBridgeHealth`), сессионный ring(64) + `systemDeltaTail` + IPC `metaengine:shell:system-deltas`; publishers встроюлены в `main.mjs` (FLEET_RECONCILE diff, обёртка executeNativeSupervisorCommand OK/FAILED+duration, currentComputeHealth transitions) и в артефакт-рекордер native-supervisor-client.
- **T3 ⑩** Mission Control (PR #937): `metaengine-mission-control-projection.mjs` (objectives→tasks→agents→effects + artifacts/attention/epochs; fails-closed; zero-authority); shell snapshot v3 + `mission_control`; `ui/app.js` — Mission Control = ЭКРАН ПО УМОЛЧАНИЮ.
- **T3 ⑪** supervisor loopback RPC (PR #937): `supervisor-loopback-rpc-server.mjs` — loopback-only HTTP POST `/rpc`, сессионный 256-bit bearer (timing-safe), манифест `~/.a2/supervisor-loopback.json` (0600); методы `supervisor.health` / `supervisor.snapshot` (READ_ONLY) и `supervisor.command` (тот же fenced executor; authority_effect passthrough). Chat→edge→DB-lease остаётся remote fallback.

### Аудит 2026-09-20 (PR #938) — 6 находок, все закрыты кодом+тестами
1. **Память (была мертва)** → теперь: `devos-native-task-cycle-core.mjs` — `#advanceTaskOutcomeFor` вызывается в `#postCompletionWithReadback` на КАЖДЫЙ терминальный исход (never-throw, идемпотентно по lease_generation); `#memoryBlockFor` — ретривал (5 эпизодов/900 токенов, lease-детерминированный кэш) → блок TEAM MEMORY ≤1400 токенов в `renderDevosTaskPrompt`; `native-supervisor-client.mjs:578-579` биндит `plane.advanceTaskOutcome`/`retrieveCollaborationMemory`; `browser-realtime-process-plane.mjs:281-346` — DevOS state → коллаборационный статус (RESULT_READY→COMPLETED), `progress_revision=lease_gen+1`, `episode_materialized`, идемпотентность `terminal_task_immutable`. **КОНТУР ПАМЯТИ ЗАМКНУТ.**
2. **Emergency-транспорт (не был подключён)** → миграция `20260921000000` (EMERGENCY lane + effect_key `global:emergency` + `lease_emergency_v1`), edge `wait-emergency` смонтирован (index.ts:259 конструирует `createEmergencyCommandRoutes`, :282 монтирует после device-auth; health рекламирует `emergency_wait_route:true`). Была применена к живому Pigsty и верифицирована (до смерти песочницы).
3. **ROLLOVER_DEFERRED вечный тупик** → `supervisor-lifecycle-runtime-core.mjs:25/1271-1276`: авто-релиз через 15 мин (`requestRollover(autoRelease)` на свежей вкладке, action `ROLLOVER_DEFERRED_AUTO_RELEASE`).
4. **Флот заперт константами** → `tab-registry.mjs:15-16`: `FLEET_TAB_CEILING=envBoundedInt(A2_FLEET_TAB_CEILING,28,4,64)`, `MAX_TABS=envBoundedInt(A2_MAX_TABS,48,8,128)`; ростер 16+сводка по ролям; бюджеты 4..16 масштабируются; edge lease 16; retire 8/цикл.
5. **work_graph не рендерился** → Mission Control проекция+рендер; RSI-вывод в UI (не только console).
6. **Edge не принимал SYSTEM-дельты** → SOURCES + SYSTEM (T3-8 latent P1).

**Сознательно НЕ фикссировалось (не ищи тут багов):** RSI skill-lifecycle активация — оператор-управляемая (zero-authority, цепочка сертификатов graduation); DB-акцептор cognitive-дельт — rollback-only (live-путь = full-state fallback); активация objective — оператор-гейт по дизайну; контрактные модули (browser-fabric-*, observation-cohorts) — библиотеки контрактов, не runtime.

### Pigsty DB integration (PR #936, MERGED)
- `infra/pigsty/` в репо: README (архитектура+эксплуатация), `conf/{pigsty-tuning.conf,pg_hba.conf}`, `bin/{pg-start,pg-stop,pg-restart,pg-status,env.sh}`, `bootstrap/01-bootstrap-rootless-pg17.sh` (rootless PG 17.11 из debs), `02-build-extensions.sh` (pgmq/pg_net/supabase_vault), `03-restore-supabase-backup.sh` (dump|sql + live-learned пост-фиксы), `04-verify-restore.py` (манифест-дифф), `smoke.sh` (13 проверок), `APP-INTEGRATION.md`, `RESTORE-REPORT-20260920.md`.
- Live-learned фиксы, зашитые в bootstrap: `cron.use_background_workers=on` (иначе pg_cron не коннектится: localhost→::1), `cron.host`=unix-socket dir, `wal_level=logical`, pgmq≥1.5 ACL-ребиндинг (переименованные сигнатуры), publication `supabase_realtime`.
- Параметры кластера (какой был): rootless, порт **55432**, база `postgres`, superuser `postgres`/пароль `postgres`, 250–272 таблицы (все схемы Supabase: auth, storage, realtime, vault, pgmq, cron, graphql, net, destruktion_meta, supabase_migrations, extensions), 289 МБ.
- Крон-задачи (были живы): supervisor-sweep (10s), fleet-watchdog (30s), attestation (1m), cat-trust (1m), baseline-sync (2m).

### Self-update контур (давно работает, физически верифицирован)
- Канал dev: `DEV_HINT` в `update/browser-dev-channel` (в БД) → браузер сам обновляется. Версия-мономонотность соблюдалась (35525784133 → 35532004761).
- `fast-autorelease` (Actions) публикует релиз при пуше в рельсу: 7 ассетов (installer.exe ~121MB, .blockmap, dev.yml, verified-self-update-manifest.json, guardian-native-staging-manifest.json, METAENGINEBrowserGuardian.exe, METAENGINEBrowserGuardianConfigure.exe).
- `self-update-fast-e2e` — ФИЗИЧЕСКАЯ N→N+1 верификация self-update на Windows-раннере.
- `release-evidence-gate` — сбор дайджестов sha256.

---

## 4. ПУТИ LIVE-ПОДКЛЮЧЕНИЯ УСТАНОВЛЕННОГО БРАУЗЕРА (КЛЮЧ К ТЕКУЩЕЙ ЗАДАЧЕ)

Установленный браузер имеет 3 pinned-URL-константы (файлы в `apps/metaengine-browser/src/`):
- `native-supervisor-endpoints.mjs` — remote edge базовый URL
- `native-supervisor-client-base.mjs` — REST-база
- `self-update-signed-heartbeat.mjs` — heartbeat-эндпоинт

Все смотрели на `xpeibufgzjknrhbhpffp.supabase.co` — **мёртв**. Варианты:

**Вариант A — HTTP-слой перед Pigsty (правильный полный путь).** Поднять edge-стек из репо (`supabase/functions/a2-browser-native-supervisor-v1/` + вспомогательные) так, чтобы его `DB_URL` смотрел на Pigsty: `postgres://postgres:postgres@<host>:55432/postgres` (direct, НЕ pooler). Тогда remote-механики (heartbeat в БД, command fabric lease, emergency wait, realtime POSTGRES_NOTIFY wake) оживают целиком. Где жить: VPS оператора / Codespace / любой хост с HTTPS. Прошлый runbook деплоя: `docs/push-wake-edge-deploy-runbook.md` (копия в `reference-from-rail/`). Важно из прошлого опыта: `DB_URL` обязательно direct 5432/55432, не pooler 6543 — иначе pg_notify-подписки ломаются.

**Вариант B — локальный режим (быстрый старт тестов).** Браузер без облака: supervisor loopback RPC (`~/.a2/supervisor-loopback.json` после старта — там URL+token), локальный native supervisor, DevOS-цикл, fleet, Mission Control UI, память, delta bus. Тесты UI и большинства механизмов возможны сразу на машине оператора. Ограничение: remote command fabric / DB-lease / cross-device coordination недоступны.

**Вариант C — VPS + self-hosted Supabase (docker).** 100% протокольная совместимость, ноль изменений кода. Миграционный кит был в `supabase-backup-20260920/migrate/` (00-RECOMMENDATION.md, 01-restore-db.sh, 02-upload-storage.py, 03-app-config.patch.md, 04-deploy-edge.sh, 05-verify.py) — теперь только в архиве у оператора. Архив содержит full dump (snapshot-consistent, 264 таблицы манифест) + storage 1831/1831 объектов + roles.sql + schema-ddl.sql.

**Рекомендация для «масштабных тестов прямо сейчас»:** начать с B (оператор локально запускает, ты тестируешь через его отчёты/скриншоты + через БД если поднимет Pigsty рядом), параллельно готовить A/C для полного контура. Точки входа тестов — в `02_LIVE_TEST_CAMPAIGN.md`.

---

## 5. СОСТОЯНИЕ ДАННЫХ (что где лежит)

| Что | Где | Состояние |
|---|---|---|
| Репозиторий (истина) | github.com/PatrickFrome/Compute, рельса `release/self-update-ambiguity-live-v2` @ `6bf173c7` | ЖИВ, доступен (токен в 01) |
| Установленный браузер | машина оператора (Windows x64) | v0.7.0-dev.35532004761.1, УСТАНОВЛЕН 2026-09-20/21 |
| Данные БД (полные) | у оператора: `supabase-backup-20260920.tar.gz` (38 МБ: snapshot-dump 35МБ + манифесты + storage + edge-исходники + migrate-кит) и оригинальный `uploaded.clean.sql` (217 МБ) | ЕДИНСТВЕННЫЕ КОПИИ. В песочнице УМЕРЛИ при сбросе |
| Storage-объекты (рабочая копия) | песочница `/home/z/my-project/computefabric-parallel-glm/` (7 МБ) | жива (частичная) |
| Worklog (вся история) | песочница `/home/z/my-project/worklog.md` + копия `worklog-full.md` в этой капсуле | ЖИВ |
| Исторические скрипты/креды | песочница `/home/z/my-project/scripts/` | ЖИВ (сотни файлов) |
| Локальный pigsty-кластер | песочница `/home/z/my-project/pigsty/` | УМЕР при сбросе; восстановление через `infra/pigsty/bootstrap/` + dump от оператора |
| Облачный Supabase | xpeibufgzjknrhbhpffp | УДАЛЁН (DNS не резолвится) |

Верификация бэкапа (на момент создания, 2026-09-20): 256/256 таблиц точное совпадение строк с манифестом, 0 потерь; 8 «расхождений» = дрейф вперёд (backup новее снапшота); storage.objects 1831/1831; auth.users 1/1; 16 ролей.

---

## 6. ОСОБЕННОСТИ ПЕСОЧНИЦЫ AI (обязательно прочитать)

1. **Песочница НЕперманентна.** Между сессиями крупные артефакты могут пропадать (этот сброс уже случился 2026-09-20/21: pigsty, дампы, .ghtoken умерли). Вывод: всё ценное — сразу в `download/` (откуда оператор может скачать) и/или в GitHub (репо, releases, ветки). Не рассчитывать на `/home/z/my-project` как на хранилище.
2. **Bash-инструмент нестабилен.** Периодически серия подряд «403 broken session» на ВСЕ инструменты. Правило: после 2+ подряд сбоев — не ретраить вслепую, а попросить оператора перезапустить сессию (кнопка справа вверху). Исторически выживали через «mega-script» режим: один автономный скрипт на файл, один запуск, всё в лог (паттерн `scripts/pigsty-*-run*.sh`).
3. **Python-стек:** pg8000 доступен. PostgreSQL-клиентские бинарники умерли вместе с pg17/ — при необходимости `apt-get download postgresql-client-17` + `dpkg -x` (без root, паттерн в `infra/pigsty/bootstrap/01`).
4. **Всё, что ты делаешь — фиксируй в worklog** (формат в §8). Это единственная настоящая память проекта.

---

## 7. GIT/GITHUB-КАРТА

- **Рельса (релизная истина):** `release/self-update-ambiguity-live-v2` @ `6bf173c71dc3026b02171085d956625ef9526378` = merge #938. Пуш в неё = автозапуск релизной трубы (12–13 мин до публикации).
- **main** — историческая ветка, НЕ трогать для релизов.
- **~100 открытых PR** — почти все исторические RSI-конвергенции (контент слит каскадом + выборочной интеграцией #927). Для релиза НЕ критичны. Не пугаться.
- Ключевые смерженные PR хронологически: #927 (RSI selective integration), #935 (T3-9 fleet reliability), #936 (Pigsty DB integration), #937 (Tier 3: delta bus + Mission Control + loopback RPC), #938 (closed-loop audit fixes — Windows-фикс ESM-import `a5db15a3`, CI 30/30 GREEN).
- Локальный checkout: `/home/z/my-project/rsi-work/Compute-r` — СЕЙЧАС на устаревшей `work/browser-shell-quantum-console-v1` @ 5f44aa89. Первый шаг: fetch + checkout рельсы.
- CI-джобы релизные: `release-evidence-gate`, `self-update-fast-e2e`, `fast-autorelease`. Полный тест-сьют: **3320 тестов → 3318 pass / 0 fail / 2 skip** на момент релиза; `npm run check` (tsc) зелёный. Windows-раннеры чувствительны к абсолютным путям в ESM-import (нужен `pathToFileURL`) и к битам 0600 (проверять только на POSIX) — уже зашито в тесты, не забывать при новых тестах.
- **Релизы (свежие):**
  - `v0.7.0-dev.35532004761.1` — id 392548660, published 2026-09-20T19:33:37Z, target 6bf173c7 — **УСТАНОВЛЕН У ОПЕРАТОРА**. Инсталлятор: `https://github.com/PatrickFrome/Compute/releases/download/v0.7.0-dev.35532004761.1/METAENGINE-Browser-Test-Setup-0.7.0-dev.35532004761.1-x64.exe` (121086087 B). + 6 ассетов (blockmap, dev.yml, verified-self-update-manifest.json, guardian-native-staging-manifest.json, METAENGINEBrowserGuardian.exe 489472 B, METAENGINEBrowserGuardianConfigure.exe 344576 B).
  - `v0.7.0-dev.35525784133.1` — id 392515594, published 2026-09-20T17:37:05Z, target 2e50ed12 (= merge #937).
  - (и старее; полный список — `releases?per_page=100` API).

---

## 8. ПРОТОКОЛ РАБОТЫ (правила, которым следовали все сессии)

1. **Worklog — святой.** `/home/z/my-project/worklog.md`, формат:
   ```
   ---
   Task ID: <уникальный, напр. CAPSULE-SUCCESSOR-001>
   Agent: <кто ты>
   Task: <задача от оператора>

   Work Log:
   - <шаг 1>
   - <шаг 2>

   Stage Summary:
   - <итоги/решения/артефакты>
   ```
2. **Язык:** русский со оператором; технические записи worklog — русские с англ. терминами.
3. **Оператор-гейты:** deployment edge, merge PR (по governance-процедуре), RSI graduation, authority-эффекты — всегда за оператором. Ты готовишь, он решает.
4. **Не декоративность:** каждое изменение подтверждать независимой верификацией (чтение кода/живой прогон), как в 7-b.
5. **Токены не печатать в чат открыто** (печатать redacted), но в файлы капсул/кредов — можно (эта капсула по прямому распоряжению оператора содержит всё).
6. При серии сбоев инструментов (403) — просить перезапуск сессии, не ретраить.

---

## 9. КАМЕНЬ ПРЕТКНОВЕНИЯ ТЕКУЩЕГО МОМЕНТА (главная развилка)

Оператор хочет «подключись к live браузеру и запусти масштабные тесты». Реальность: cloud мёртв, песочница сброшена, браузер стоит у оператора на Windows. Ты физически НЕ можешь «подключиться» к его машине напрямую. Честные опции, которые надо ему предложить сразу:

1. **Он локально запускает браузер** и выполняет лёгкие шаги по твоей инструкции (скриншоты Mission Control, содержимое `~/.a2/supervisor-loopback.json`, логи) — ты анализируешь и ведёшь кампанию из песочницы по его фидбеку. Немедленно, но медленный цикл.
2. **Он поднимает Pigsty/стек у себя или даёт тебе доступ к хосту** (VPS/Codespace/tunnel) — ты разворачиваешь edge перед Pigsty (вариант A) и получаешь полный remote-контур для тестов command fabric/heartbeat/wake. Правильный полный путь.
3. **Self-hosted Supabase на VPS (вариант C)** — максимум совместимости, если оператор готов выделить VPS.

Рекомендация: начать с 1 (сегодня же), параллельно согласовать 2 или 3. Тест-план на 12 контуров готов: `02_LIVE_TEST_CAMPAIGN.md`.

---

## 10. СОДЕРЖИМОЕ КАПСУЛЫ

```
00_START_HERE_CAPSULE.md            ← этот файл
01_CREDENTIALS_AND_ENDPOINTS.md     ← ВСЕ токены/секреты/эндпоинты (chmod 600)
02_LIVE_TEST_CAMPAIGN.md            ← план масштабных тестов 12 контуров (T1–T12)
worklog-full.md                     ← ПОЛНЫЙ worklog проекта (с восстановленными вечерними записями 2026-09-20)
worklog-recovered-entries.md        ← реконструкция записей, утраченных при сбросе песочницы (3-a…7-c)
reference-from-rail/
  infra_pigsty_APP-INTEGRATION.md   ← как подключать edge/клиентов к Pigsty DB (с рельсы 6bf173c7)
  infra_pigsty_README.md            ← архитектура/эксплуатация pigsty
  infra_pigsty_RESTORE-REPORT-20260920.md ← живой отчёт восстановления БД
  docs_push-wake-edge-deploy-runbook.md   ← runbook деплоя edge (POSTGRES_NOTIFY wake)
reports/
  browser_live_masstest_2026-09-17.md     ← как выглядели прошлые масс-тесты live
  browser_fix_and_update_2026-09-16.md
  browser_context_deep_analysis_2026-09-16.md
  OPERATOR_GUIDE.md / ROADMAP_NEXT.md     ← операторские гайды (частично устарели — сверять с рельсой)
```

**Важно о worklog:** песочница была сброшена между сессиями 2026-09-20/21, и её снапшот worklog обрывался на дневных записях. Вечерние записи (хвост 4-a, 5-a, 6-a, 6-b, 7-a, 7-b, 7-c — Pigsty-интеграция, Tier 3, аудит, релиз) были дословно восстановлены из контекста сессии и встроены в `worklog-full.md` (плюс отдельно в `worklog-recovered-entries.md` с пометками; записи 3-a/3-b/3-c даны сводкой по сути — их точный текст утрачен, но итоги прослеживаются в последующих записях и в §3, §7 этого файла). Песочечный `/home/z/my-project/worklog.md` тоже уже содержит эти восстановленные записи — продолжай вести его.

Удачи. Контур замкнут, релиз стоит у оператора — доведи тесты до истины.
