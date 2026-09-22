# Починка выявленных ошибок + обновление браузера — фиксы вмержены и опубликованы релизом, инсталлер стейджится на хосте
**Дата:** 2026-09-16 (21:10–22:50 UTC) | **Task ID:** GLM-BROWSER-FIX-AND-UPDATE-20260916 | **Ветка:** `repair/successor-qualification-liveness-v1` @ `dbb43606` (база `a0af13c0`)

## 1. Резюме

Выявленные ошибки починены, протестированы и **доставлены вплоть до живого хоста**: PR #560 смержен (merge `2b8b4b4e`), autorelease-пайплайн опубликовал verified релиз **`v0.7.0-dev.35156994273.1`** (22:31 UTC, инсталлер+blockmap+dev.yml+манифесты), dev-channel feed переведён на него, живой браузер через командный план (`SELF_UPDATE_CHECK` ×3, retry после транзиентного `ERR_CONNECTION_RESET`) **скачал инсталлер на 100%** (`downloaded_version=35156994273.1`, стейджинг завершён 22:45 UTC). Осталась **одна физическая атома** — единственный запуск инсталлера на Windows-хосте (§6): работающий R5-процесс математически не способен сам разрешить собственный дедлок (доказательство §3, ровно этот класс фикса — внутри новой версии). Watchdog-демон автоверификации уже запущен.

## 2. Точный диагноз (источник-верифицированный, глубже капсульного)

Живой браузер: R5 `0.7.0-dev.35067131325.1` @ `98400878`, heartbeat жив, txn `7c7e48b3` SUCCESSOR_BOOTED без квалификации 13.5ч+, кандидат R6 (`35088753563.1` = `a0af13c0`) скачан 100%, `restart_gate_safe=false`, `SELF_UPDATE_APPLY` → `self_update_apply_not_ready`.

**Трёхсторонний структурный дедлок** (каждое звено доказано чтением кода на `a0af13c0`):

1. **GAP-A — однократное 30с-окно квалификации.** `qualifyUpdatedSuccessorWhenHealthy` (main-entry.mjs:506) опрашивает 30с на старте, затем окно закрывается навсегда. Никакого повторного probe не существует. Стартовое окно R5 проиграло гонку (см. 2), и с 07:24:30 UTC транзакция неквалифицируема.
2. **GAP-B — самоотравление updater'а.** Авто-установка следующего релиза (R6) вызывает `beginSelfUpdateTransaction` → бросает `self_update_transaction_unresolved_prior:SUCCESSOR_BOOTED` (journal:95) → updater уходит в липкий ERROR (latched, повторная попытка только по force). Signed-heartbeat-предикат `recordAcceptedSignedSupervisorHeartbeat` требует здорового updater → **каждый heartbeat отвергается** (`HEARTBEAT_UPDATER_UNHEALTHY`). Круг замкнут: квалификация требует здорового updater; updater ошибочен ровно до тех пор, пока квалификация не завершена.
3. **GAP-C — рестарт не лечит.** После очистки капсулы перезапущенный successor постит `self_update_session_continuity.state = NONE` (в `#restoreSessionContinuity` статус остаётся NONE при отсутствии капсулы) → heartbeat отвергается `HEARTBEAT_CONTINUITY_NOT_RESTORED` → после рестарта дедлок воспроизводится.
4. **GAP-D — капсула без reconcile.** `recoverStuckSelfUpdateContinuity` при TARGET_VERSION_MISMATCH — информационный return; строго-устаревшая капсула блокирует probe (`PENDING_CONTINUITY`) вечно.
5. **D1 (из масстеста 09-09)** — гонка cancel() в обоих watchdog-таймерах: in-flight попытка довыполняет relaunch+exit после отмены.
6. **GAP-E — result-transport** — единая попытка POST receipt; транзиентный сбой = `CAPTURE EXPIRED lease_timeout_no_retry` (2 живых наблюдения 06:05/06:28 UTC).

**Ключевой вывод для доставки:** ни одна команда командного плана не может вылечить работающий R5 (SELF_UPDATE_CHECK лишь перевзводит отравление; SELF_UPDATE_APPLY — not_ready; квалификационных команд в словаре нет; журнал — файл на хосте, не БД). Единственный выход — **boot более новой версии**, при которой `inspectSelfUpdateStartup` (handoff.mjs:292) делает `cmp > 0` → txn → **SUPERSEDED** → журнал очищен (BEGIN_ALLOWED).

## 3. Фиксы (все fail-closed инварианты сохранены)

| # | Фикс | Механика |
|---|---|---|
| F1 | **Bounded re-probe loop** | Тот же fail-closed предикат probe на интервале (60с, ≤600 попыток) пока diagnostic = TARGET_INSTALLED_PENDING_QUALIFICATION; стоп на терминальных состояниях; на PENDING_CONTINUITY — durable reconcile; никакого installer-эффекта, authority_effect=false |
| F2 | **Толерантность heartbeat к pending-prior** | Ровно `self_update_transaction_unresolved_prior:SUCCESSOR_BOOTED` (не FAILED) считается ожидаемым состоянием ожидающей квалификации; любые другие ошибки/FAILED — жёсткий отказ |
| F3 | **Continuity NONE принят** | Рестартнутый successor без капсулы = «восстанавливать нечего»; probe независимо верифицирует отсутствие капсулы на диске. TARGET_VERSION_MISMATCH со строго-старым target капсулы = stale leftover (не карантин); новее/равно — карантин сохранён |
| F4 | **Supersede-reconcile капсулы** | Строго-старый target → архив в sidecar `*-superseded-<stamp>.json` (durable rename, никогда не удаляется); будущий target / несравнимые версии — fail-closed без действий |
| F5 | **Guard самоотравления updater** | `#launchInstaller` держит следующую установку (READY_RESTART, `last_error=null`, `pending_prior_qualification=true`), пока prior txn SUCCESSOR_BOOTED для текущей версии; после квалификации — установка без повторного grace |
| F6 | **D1 cancel-race** | Оба watchdog'а (continuity + old-parent-handoff) проверяют отмену на await-точках ДО эффектных хвостов (relaunch/exit); durable-записи остаются аудируемыми |
| F7 | **Bounded redelivery receipt** | Идемпотентный (по command_id) повтор POST только на 5xx/сетевых сбоях (≤3 попыток, backoff 1с/3с); 4xx — немедленный surface; эффекты браузера никогда не перезапускаются |

Изменённые файлы: `self-update-successor-qualification.mjs`, `self-update-continuity-watchdog.mjs`, `self-update-session-continuity.mjs`, `self-update-handoff.mjs` (экспорт compareVersions), `self-update-runtime-v8.mjs`, `self-update-old-parent-handoff.mjs`, `native-supervisor-client-base.mjs`, `main-entry.mjs`. Коммит `dbb43606`, +969/−23.

## 4. Тестирование

| Серия | Итог |
|---|---|
| Новые контракт-тесты (13, вкл. end-to-end сценарий самолечения дедлока) | **13/13** |
| Батарея self-update (все `test/self-update-*.test.mjs`) | **160 pass / 0 fail / 1 Windows-skip** |
| Батарея native-supervisor + supervisor + sentinel | **236/236** |
| Полный прогон ×2 (2271 тест) | **2264 pass / 5 fail / 2 skip — идентично**; 5 падений = предсуществующие env-зависимые (electron-пакет, config-харнессы), воспроизведены на базовом `a0af13c0`; 0 флаков, 0 регрессий |
| `node --check` всех src-модулей | **259/259 чисто** |
| GitHub CI (PR #560) | transaction-durability (ubuntu+windows), fast-lane-contract, emergency-update (ubuntu), exact-head, development-plane-linux — **SUCCESS**; windows-package-smoke / soak / chaos-seeds — в процессе |

## 5. Доставка (выполнено)

- Ветка `repair/successor-qualification-liveness-v1` запушена в origin; **PR #560** создан (base `release/self-update-ambiguity-live-v2`).
- **CI: 32/32 чеков зелёные** (0 падений) — вкл. windows-nsis-package-smoke, windows-installed-chat-qualification, windows-final-runtime-activation, transaction-durability (ubuntu+windows), fast-lane, emergency-update, evidence-гейты.
- **PR смержен** 22:18:11 UTC (merge commit `2b8b4b4e`, формат merge-commit как у #553–556).
- **Autorelease сработал автоматически**: evidence gate success (13м) → fast physical E2E → **релиз `v0.7.0-dev.35156994273.1` опубликован 22:31:49 UTC** (тег → `2b8b4b4e`), ассеты: `METAENGINE-Browser-Test-Setup-0.7.0-dev.35156994273.1-x64.exe` + blockmap + dev.yml + verified manifests; feed `update/browser-dev-channel` переведён (`a23b9010`).
- **Живой браузер получил обновление через командный план** (канонический `issue_native_v1`, issued_by GLM_UPDATE_OPERATOR): `SELF_UPDATE_CHECK` → updater разблокирован (ERROR→APPROVED_DOWNLOAD, resolved_git_sha=`2b8b4b4e`) → первая загрузка упала на 64.9% (`net::ERR_CONNECTION_RESET`, транзиент) → retry `SELF_UPDATE_CHECK` → **READY_RESTART, downloaded_version=`35156994273.1`, 100%** (22:45 UTC). Инсталлер физически стейджится в кэше апдейтера на Windows-хосте.
- R5 предсказуемо заперевёл install-попытку в ERROR `unresolved_prior` (это старый код — фикс F5 именно этого поведения находится в скачанной новой версии).

## 6. Обновление живого браузера — каскад и остаточная атома

```
[1] ✅ CI 32/32 → PR #560 смержен → релиз 35156994273.1 + лента     (готово)
[2] ✅ SELF_UPDATE_CHECK ×3 → R5 скачал инсталлер с фиксами на 100%  (готово)
[3] ⬜ ОДИН запуск инсталлера на Windows-хосте  ← остаточная атома (оператор)
[4] Boot 35156994273.1: inspectSelfUpdateStartup cmp>0 → txn R5 → SUPERSEDED
    → журнал чист → R6-multihop-механики + все 7 фиксов активны
[5] Квалификация собственной транзакции — самолечение (re-probe + толерантности)
[6] Fleet 7×BOUND_UNVERIFIED → transport proof → первый ACTIVE → ADVISORY задача
```

**Атома (одиночный запуск):** на Windows-хосте запустить стейдженный инсталлер
`METAENGINE-Browser-Test-Setup-0.7.0-dev.35156994273.1-x64.exe`
(кэш electron-updater: `%LOCALAPPDATA%\<metaengine-browser-test>-updater\pending\`; либо скачать напрямую:
`https://github.com/PatrickFrome/Compute/releases/download/v0.7.0-dev.35156994273.1/METAENGINE-Browser-Test-Setup-0.7.0-dev.35156994273.1-x64.exe`).
После него всё автономно: runAfterFinish → boot → SUPERSEDED-хил журнала → самолечение квалификации (фиксы уже в этой версии) → multihop retirement wake_810f → Fleet. Watchdog-демон (`scripts/fixupd_watchdog.py`, двойной-fork) уже следит: при смене версии проверит квалификацию/sentinel/keepalive и закроет цикл отчётом `download/browser_fix_update_watchdog.json` (фазы WATCHING → VERIFYING → DONE).

Чего НЕ делалось (инварианты): ручные правки БД (запрет капсулы R6 §9), перезапуск инсталлера 984008 в обход апдейтера, ретайп wake_810f, мерж #557/#558 механически, ослабление generation floor/fences.

## 7. Верификация после атомы (чек-лист)

1. `prep_01_live.py`: current_version = фиксированный релиз; self_update без `unresolved_prior`; startup_recovery QUALIFIED/NO_TRANSACTION; restart_gate_safe=true.
2. Журнал квалификации: строка `metaengine.browser.self-update-qualification.v2` со state QUALIFIED (или reprobe v1 → terminal:QUALIFIED).
3. supervisor_lifecycle: WAKE_AMBIGUOUS → RECOVERING/WAITING (retirement wake_810f), Fleet → 1×ACTIVE после transport proof.
4. Команды: CAPTURE без EXPIRED lease_timeout_no_retry (bounded redelivery работает).
5. Дальнейшие релизы ставятся безостановочно (дедлок класса GAP-A/B/C/D не воспроизводится).
