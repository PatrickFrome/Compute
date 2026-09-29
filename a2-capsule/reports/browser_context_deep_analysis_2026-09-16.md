# METAENGINE Browser — Максимально дельный анализ капсул, исходников, веток и live-браузера
**Дата:** 2026-09-16 21:00–21:40 UTC | **Task ID:** GLM-BROWSER-CONTEXT-DEEP-ANALYSIS-20260916
**Основа:** 4 загруженные капсулы (R6 master, R4, R3, Fleet Activation) + свежий git fetch + свежий live-readback Supabase + source-анализ на release head

---

## 1. EXECUTIVE SUMMARY — ГДЕ МЫ СЕЙЧАС

Проект прошёл за 4 дня (12–16 сентября) эволюцию блокеров: **R2** (generation floor drift) → **R3** (stale admission fence) → **R4** (first-bootstrap TYPE_EFFECT_AMBIGUOUS) → **R5** (process-boundary ambiguity, immediate predecessor) → **R6** (multi-hop ancestor, durable wake-local fence). Каждый фикс смержен, опубликован и **физически установлен** live-браузером — кроме R6, который опубликован (v0.7.0-dev.35088753563.1 @ `a0af13c0`), скачан на 100%, но **не установлен**, потому что предыдущая транзакция self-update `984008...` застряла в `SUCCESSOR_BOOTED` без терминальной квалификации.

**Свежая верификация (мои запросы 20:54–21:30 UTC):** всё в капсуле R6 подтверждено 1:1 — браузер жив (heartbeat 20:54:16 UTC, CONTROL/armed, Sentinel 1.6.1 HEALTHY, parent 20516 / worker 2408 — процесс непрерывен с 07:24 UTC), self_update ERROR `unresolved_prior:SUCCESSOR_BOOTED`, транзакция `7c7e48b3` в `TARGET_INSTALLED_PENDING_QUALIFICATION`, Fleet 7×BOUND_UNVERIFIED / 0 ACTIVE, DevOS OPEN floor 28, 7 READY задач (6 ADVISORY + 1 MUTATING), claims=0, supervisor lifecycle `WAKE_AMBIGUOUS` c pending wake `wake_810f...` от process `5fbbc...` (multi-hop предок текущего `fa139...`).

**Ключевая новая находка моего source-анализа (нет ни в одной капсуле):** утихающая квалификация — `qualifyUpdatedSuccessorWhenHealthy` работает **только 30-секундное окно на старте** (main-entry.mjs:506, timeoutMs=30_000) и больше никогда не перепроверяется, если за окно не выполнены все условия. Процесс живёт 13.5 часов с неквалифицированной транзакцией — это структурный liveness-гэп, а не разовый сбой. Детали и план — §5.

---

## 2. СВЕЖИЙ СРЕЗ ПРОЕКТА (мои проверки, 20:50–21:30 UTC)

### 2.1 Git (fetch origin-anon, теги+ветки)
| Реф | Значение | Статус vs капсула R6 |
|---|---|---|
| `release/self-update-ambiguity-live-v2` | `a0af13c0` «preserve multihop ambiguity fence» | ✅ совпадает |
| Тег новейший | `v0.7.0-dev.35088753563.1` → `a0af13c0` | ✅ новых релизов нет |
| `integration/metaengine-development-os-v1` | `b69f6629` «enforce guardian start dispatch permit» | ✅ совпадает |
| `main` | `0d1c074c` | ✅ не авторитет, без изменений |
| `update/browser-dev-channel` | hint на `35088753563.1` (коммит 40edc3e2) | ✅ лента готова |
| PR #557 `repair/supervisor-transitive-process-boundary-r6` @ `5f7e975e` | DIVERGED от release (ahead 5 / behind 6) | ✅ как в капсуле |
| PR #558 `repair/supervisor-multihop-process-boundary-r1` @ `80505796` | DIVERGED (ahead 5 / behind 6) | ✅ как в капсуле |
| **НОВАЯ ветка** `repair/supervisor-multihop-ambiguity-r1` @ `d3ef1f5e` (10:58 UTC) | — | 🆕 **не упомянута в капсуле**; проверено: `d3ef1f5e` = второй родитель merge `a0af13c0` → **уже полностью влит в release**, ahead-of-release = 0. Конкурирующего кода нет |

**Вывод:** после среза капсулы (20:28 UTC) новых релизов/PR-конкуренции не появилось; «новая» ветка — это влитая линия R6 (`a0af13c0` — merge `984008` + `d3ef1f5e`). Репозиторий стабилен, гОНка веток остановилась на R6.

### 2.2 Live browser (Supabase, прямые запросы)
| Домен | Свежее значение | Комментарий |
|---|---|---|
| Heartbeat | 20:54:16 UTC (запрос в 20:55) | жив, пульс ~2–3с |
| Версия/SHA | `0.7.0-dev.35067131325.1` @ `98400878` | R5-сборка, на один релиз позади |
| self_update | ERROR `self_update_transaction_unresolved_prior:SUCCESSOR_BOOTED`; available `35088753563.1`; download 100%; `restart_gate_safe=false` | **блокер №1** |
| startup_recovery | `TARGET_INSTALLED_PENDING_QUALIFICATION`, txn `7c7e48b3`, target `984008`/`35067131325.1`, `qualification_resume_allowed=true`, `recovery_installer_effect_allowed=false` | физически установлено, ждало квалификации с 07:24 UTC |
| Sentinel/HostResilience | ARMED/HEALTHY/ACTIVE, v1.6.1, parent 20516, worker 2408, `login_start_policy_hold` (advisory) | здоров, рестарта не было |
| supervisor_lifecycle.keepalive | `WAKE_AMBIGUOUS`, `admission_state=OPEN`, `conversation_url=null`, `cycle_seq=0`; pending wake `wake_810f...` (RESEARCH_ACCELERATOR_DUE:epoch-1, prepared 01:35:16, TYPE_EFFECT_AMBIGUOUS, retry=false, incarnation `5fbbc...`); **полей `process_boundary_fenced_at` ещё нет** (появятся с a0af) | **блокер №2**, мульти-хоп подтверждён физически |
| Fleet | desired 7 / 7 BOUND_UNVERIFIED / 0 ACTIVE; census 9 tabs (2 user + 7 fleet), потолок не достигнут; backpressure `PHYSICAL_TAB_CLOSED`→blocked=false | **блокер №3** (после 1–2) |
| DevOS env | OPEN, refill=true, admission=true, floor 28 (reset 09-13 USER_REQUESTED_CLEAN_SLATE_FINAL) | готов |
| Задачи | FENCED 572 / AMBIGUOUS 116 / COMPLETED 13 / READY 7 / CANCELLED 7 / FAILED 6; claims 0 | ready-набор тот же (PLANNER g85 p100 … RESEARCHER g88 p60; MUTATING repairer g101 p90 — не трогать первым) |
| Команды (последние) | CAPTURE COMPLETED ×5 (11:02–11:04, CHATGPT_SUPERVISOR); `SELF_UPDATE_APPLY` FAILED `self_update_apply_not_ready` (07:25:48); CAPTURE EXPIRED `lease_timeout_no_retry` ×2 (06:05, 06:28) | командный план жив; FAILed APPLY = прямое следствие блокера №1; EXPIRED = дефект result-транспорта (§7.3) |

**Расхождений с капсулой R6 не найдено.** Единственные дельты: heartbeat свежее (20:54 vs 20:25), SELF_UPDATE_APPLY FAIL в 07:25 и две EXPIRED CAPTURE — все консистентны с диагнозом капсулы.

---

## 3. СИНТЕЗ КАПСУЛ — ПОЛНАЯ ЛИНИЯ РЕМОНТА И ЕЁ УРОКИ

### 3.1 Хронология эскалации блокеров (что реально было причиной на каждом шаге)
| Раунд | Гипотеза входа | Истинная причина | Фикс | Итог |
|---|---|---|---|---|
| Sep-15 Fleet Activation | «нет моста observer→transport_proof» | ❌ опровергнуто R2-археологией: мост существовал, не доходило до него | #553 R2 | generation floor 28 синхронизирован |
| R3 | — | stale `RECOVERING+ADMISSION_FENCED` не реармился из OPEN | #554 | первый dedicated bootstrap дошёл до ChatGPT root |
| R4 | — | TYPE_EFFECT_AMBIGUOUS на первом bootstrap (value_length=1299 ≠ proof) | #555 | durable one-attempt fence `markAmbiguousContinuationAttempt` |
| R5 | — | ambiguous wake пережил process boundary; immediate-predecessor proof | #556 (merge `984008`) | installed live; но только 1 hop |
| R6 | — | wake пережил НЕСКОЛЬКО инкарнаций (мульти-хоп) | release `a0af13c0` | опубликован+скачан, **не установлен** (блокер №1) |

**Мета-урок линии:** каждый раунд «safety ahead of liveness» — система корректно отказывается действовать без proof, и каждый следующий блокер — это reconciliation-гэп между уже-безопасными компонентами, а не отсутствие механик. Паттерн решения неизменен: `fail closed → exact independent proof → deterministic reconciliation → continue without replay`.

### 3.2 Что каждая капсула добавляет уникального (сохранить в контексте)
- **FLEET_ACTIVATION (Sep-15):** полный acceptance-chain первого воркера (14 шагов: BOUND_UNVERIFIED→transport proof→ACTIVE→lease→RUNNING→terminal→cleanup), тест-матрица 15 кейсов transport proof, Definition of Done из 21 пункта, канонические DB-функции (`devos_fleet_{snapshot,reconcile,enqueue,lease,mark_running,complete}_v1`, `h205f22_a2_browser_supervisor_issue_native_v1` с idempotency_key), правило «первое доказательство — ADVISORY, никогда MUTATING».
- **R3:** дисциплина head≠tree SHA (head для commit/CI-утверждений, tree только для эквивалентности), контракт реарма admission (5 положительных условий OPEN, 10+ негативных гарантий), идемпотентность без side-effects.
- **R4:** source-контракты, которые обязаны переиспользоваться: `#typeAndSend` (единственная send-реализация), `composerMatches` (value_sha256, **не** length), `COMPOSER_HASH_OR_TRANSCRIPT_PROOF_V1`, наблюдение что `value_length=1299` — улика, но не proof; критический инсайт: ambiguous bootstrap живёт на **root**-табе до существования `/c/...`, поэтому обычная session-reconciliation его не видит.
- **R6 master:** текущая authority truth (§2), точный multi-hop факт (`5fbbc` ≠ предок `a3c`), clean root `tab_ce90935e` terminal-ready для recovery, защищённый USER-tab `tab_97c02ffd`, статус-таблица доменов, порядок исполнения STEP 1–7, инвариант «никогда не разменивать exact identity/durable fence/AMBIGUOUS на liveness».

---

## 4. АНАЛИЗ ИСХОДНИКОВ НА RELEASE HEAD `a0af13c0` (worktree готов)

Worktree: `/home/z/my-project/scripts/dev_r6_git` (detached @ `a0af13c0`), 464 тест-файла. Проверено наличие: `process_boundary_fenced_at` / `..._by_process_incarnation_id` (supervisor-keepalive.mjs:248–254, 745), proof-строка `DURABLE_PROCESS_BOUNDARY_FENCE_ORIGINAL_TARGET_ABSENT_UNIQUE_EMPTY_ROOT` (lifecycle-runtime-core.mjs:611), тест `supervisor-process-boundary-ambiguity-r5.test.mjs`. R6-механика подтверждена в исходнике.

### 4.1 Механика R6 retirement (чтение кода, keepalive.mjs:740–775)
Retirement ambiguous pending wake требует: pending-процесс ≠ текущий; (`immediatePredecessorFence` = предок совпадает с pending И `predecessor_fenced_at`) **ИЛИ** (`durableWakeBoundaryFence` = wake-local `process_boundary_fenced_at` И retry=false). Затем: queued wakes того же queue_key+incarnation фильтруются, wake копируется в `ambiguous_history` c `retired_reason=PROCESS_BOUNDARY_ORIGINAL_BOOTSTRAP_TARGET_LOST`, state возвращается в RECOVERING/WAITING. Звучит корректно; жёсткое условие `!this.#state.predecessor_fenced_at || ...` сохраняет fail-close даже при отсутствующем обоих proof.

### 4.2 КЛЮЧЕВАЯ НАХОДКА — анатомия блокера №1 (квалификация SUCCESSOR_BOOTED)

Полная цепочка старта (main-entry.mjs, проверено по коду):
1. `startSelfUpdateContinuityWatchdog` (main-entry.mjs:360) — таймер ≥30с: если continuity-capsule есть и `capsule.target_version === current` → quarantine + relaunch + exit(18); **если target ≠ current → `TARGET_VERSION_MISMATCH` и capsule остаётся навсегда**;
2. `installSignedSupervisorHeartbeatQualificationHook` (:371) — wrap fetch: signed state POST → 202 → `recordAcceptedSignedSupervisorHeartbeat`;
3. `shouldResumeSuccessorQualification` (successor-recovery.mjs:166) — true при `TARGET_INSTALLED_PENDING_QUALIFICATION` + resume_allowed + без installer-эффекта (live: все true);
4. `qualifyUpdatedSuccessorWhenHealthy({app})` (main-entry.mjs:506) — **poll 1с в течение 30с**, затем окно закрывается навсегда до следующего рестарта.

Условия QUALIFIED внутри окна (successor-qualification.mjs:117–186): exact txn binding → SUCCESSOR_BOOTED → version match → singleton → uptime≥3с → **continuity capsule отсутствует** → **signed heartbeat ≤10с свежести с совпадающей версией** → qualify (12 полей доказательств).

**Диагноз структурного гэпа:** процесс живёт с 07:24 UTC (>13ч) с неквалифицированной транзакцией. Возможные причины зависания в 30с-окне (в порядке вероятности):
- **H1 — PENDING_CONTINUITY (наиболее вероятно):** capsule с `target_version` ≠ текущая (остаток более старой попытки) → watchdog молчит (mismatch), probe возвращает PENDING_CONTINUITY всё окно. Замкнутый круг: capsule не чистится ничем, окно закрыто, следующий рестарт повторяет цикл → **возможно permanent deadlock**. Заметьте: `TARGET_VERSION_MISMATCH` в `recoverStuckSelfUpdateContinuity` вообще не имеет ветки reconcile (только информационный return).
- **H2 — PENDING_SIGNED_HEARTBEAT:** подписанный state POST не дал 202 в первые 30с (например, командный план ещё не поднялся, или hook установился позже первого POST-цикла);
- **H3 — RECOVERY_TRANSACTION_BINDING_DRIFT:** diagnostic txn id ≠ journal txn id → probe мгновенно терминируется с drift-стейтом (но live показывает одинаковый id `7c7e48b3`, так что вряд ли).

**Что нужно для точного диагноза (первое действие следующей сессии):** прочитать startup-journal/log строку `metaengine.browser.self-update-qualification.v2` от 07:24 — она логирует финальный `state` (PENDING_CONTINUITY / PENDING_SIGNED_HEARTBEAT / ...) и, для continuity, `pending_tab_count`. Путь: через CAPTURE-команду читать нельзя (логи локальны) — использовать `--metaengine-profile-probe` невозможно без рестарта; поэтому **канонический способ — SELF_UPDATE_STATUS/GATE_STATUS-подобная readback-команда или Dev Plane REPO_HEAD-типа action из 36-словаря executor'а**, либо parse локального startup journal через существующие read-only действия. Если readback невозможен — решать H1 и H2 параллельно в коде.

**Направление ремонта (минимальное, без ослабления инвариантов):**
1. **Reconcile TARGET_VERSION_MISMATCH capsule:** если `capsule.target_version` строго старше current (`compareVersions(current, capsule.target) > 0`) → capsule архивируется как superseded (по аналогии с 2f8cbed1 для AMBIGUOUS_INSTALL), НЕ перезапуская installer-авторитет;
2. **Периодический bounded re-probe:** пока txn=SUCCESSOR_BOOTED и `shouldResumeSuccessorQualification`=true — повторять probe каждые N сек (bounded, тот же fail-closed предикат), вместо одного 30с-окна; это не второй scheduler — тот же самый deterministic reconciliation tick;
3. Оба пути покрыть тестами из матрицы капсулы §27 (startup-survival, repeated-startup-no-replay, wrong-version fail-closed).

Это ровно «STEP 2» из капсулы R6, но теперь с конкретной анатомией где именно умирает liveness.

---

## 5. ВЕТКИ/PR — ДИСПОЗИЦИЯ

| Ветка/PR | Вердикт |
|---|---|
| `release/self-update-ambiguity-live-v2 @ a0af13c0` | Единственная runtime-authority. Все CI green (14 runs), инсталлер sha256 `fd9aa05d...` |
| PR #557 (transitive r6, `5f7e975e`) | DIVERGED behind 6. Сравнить уникальную семантику с a0af; порт только строго недостающий инвариант (например chronology/future-timestamp fencing), иначе закрыть как superseded. **Не мержить механически** |
| PR #558 (multihop r1, `80505796`) | Аналогично #557: строгие chronology-проверки + отдельный R6-тест — кандидат на порт 1–2 инвариантов |
| `repair/supervisor-multihop-ambiguity-r1` (10:58 UTC) | Уже влита (второй родитель a0af). Ничего не делать |
| `integration/metaengine-development-os-v1 @ b69f6629` | DevOS task-base authority (все 7 READY задач на этом base). Не смешивать с release-плоскостью |
| `main @ 0d1c074c` | Не авторитет. Не искать код поиском по дефолт-ветке |
| ~350 открытых PR | Шум; имя ветки ≠ авторитет. Никаких bulk-merge |

---

## 6. ЖИВОЙ БЛОКЕР-Каскад — ПОРЯДОК РАЗБЛОКИРОВКИ

```
[№1] txn 7c7e48b3 SUCCESSOR_BOOTED без квалификации
      └─► чиним reconciliation (§4.2) → QUALIFIED
[№2] установка a0af каноническим апдейтером (installer уже скачан, sha проверен)
      └─► рестарт-процесс → R6-механика активируется
[№3] multi-hop retirement wake_810f через durable wake-local fence
      + reuse единственного clean root tab_ce90935e (БЕЗ NEW_TAB, БЕЗ ретайпа)
      └─► lifecycle → RECOVERING/WAITING → первый реальный cycle
[№4] Fleet: transport proof через канонический /v1/devos/promotion-lease
      └─► 1×ACTIVE → ADVISORY lease → RUNNING → terminal → cleanup
[№5] result-transport liveness (EXPIRED lease_timeout_no_retry) — после №4
[№6] масштабирование: 2 воркера → 7-soak → durable memory proof → MUTATING
```

Логика каскада: №1→№2 — это один физический рестарт; №3 автоматически срабатывает на process boundary этого же рестарта; №4 — первый полезный work за всю линию R2–R6.

---

## 7. ГЛУБОКИЙ РЕСЕРЧ КЛЮЧЕВЫХ МЕХАНИК (сохранить как есть / улучшить)

### 7.1 Что уже работает отлично (не трогать)
- **Effect-эпистемология** CONFIRMED/NO_EFFECT_PROVEN/FAILED_PRE_EFFECT/FENCED/AMBIGUOUS + one-attempt fences (R4 `markAmbiguousContinuationAttempt`: durable барьер ДО физического Send) — эталонная механика проекта;
- **Exact identity chain** agent→tab→WebContents→renderer PID+creation→CDP target→generation; запрет authority от URL/title/page/model text;
- **Self-update транзакционность** (journal v8, pre-install receipts, SUPERSEDED-reconcile `2f8cbed1`, successor qualification с 12 полями proof);
- **Sentinel incarnation reconcile** (SUCCESSOR_BOUND + predecessor archive) — воркер сам лечится, worker_pid proof;
- **Fleet readiness contract** TRANSPORT_PROOF_REQUIRED — 7 физических воркеров не могут случайно получить authority;
- **Guarded Dev Plane** (arbitrary_eval=false, 14 capabilities, candidate capsules non-executable).

### 7.2 Механики с подтверждёнными дефектами (чинить по каскаду)
- **Квалификация SUCCESSOR_BOOTED** — 30с-окно без re-probe + unreconciled TARGET_VERSION_MISMATCH capsule (§4.2, блокер №1);
- **Result transport** (native-supervisor-client.mjs `#postBatchResults` → Edge completeBatch → RPC `h205f22_a2_browser_supervisor_complete_batch_v1`): отсутствие bounded delivery → `lease_timeout_no_retry` при живом эффекте. Безопасное направление: bounded redelivery **только receipt** (immutable), после authoritative readback DB-статуса; никогда не перезапускать browser effect. Тест-кейсы — капсула R6 §25 STEP 6 (9 кейсов);
- **Keepalive null-projection**: свежий supervisor_state.top_level не содержит keepalive (живёт в `supervisor_lifecycle`), аналогично brain/dev_plane/mesh — читать только канонические вложенные поверхности, не путать null-проекцию со смертью подсистемы (повторяющийся урок из всех капсул).

### 7.3 Непроверенные, но заявленные механики (физических proof ещё нет)
- Durable memory: save_count=0/load_count=0/episode_count=0 — нужен proof `save→restart→load→retrieve→provenance` после №4;
- Cognitive delta под pressure: 21530 ack-последовательность, resync_count=308 исторически — стресс-тест после Fleet ACTIVE;
- Cross-login continuity: `login_start_policy_hold=true` при `executable_will_launch_at_login=false` — сознательно отложено, не текущий P0;
- Fast Control Plane (Sep-09): p50~3ms/p95~31ms локально, узкое место — внешние round-trips; оптимизация только после №5.

---

## 8. ГОТОВНОСТЬ К РАЗРАБОТКЕ (environment ready)

| Ресурс | Состояние |
|---|---|
| Worktree release head | `/home/z/my-project/scripts/dev_r6_git` @ `a0af13c0` (detached, чистый) ✅ |
| Git refs | все repair-ветки, PR 557/558 (refs/prs/p557, p558), теги до `35088753563.1` ✅ |
| Live DB доступ | pg8000-скрипты `prep_01/02/03_live.py` — supervisor state/lifecycle/fleet/tasks/env, канонические функции ✅ |
| Командный план | `issue_native_v1` паттерн известен (idempotency_key, poll-to-terminal, AMBIGUOUS→stop) ✅ |
| Тестовая база | 464 тест-файла на head; матрицы из капсул §27 (qualification 9, R6-recovery 17, fleet 10, transport 9) — готовы к исполнению |
| Ключевые файлы для следующего патча | self-update-successor-qualification.mjs, self-update-continuity-watchdog.mjs, self-update-session-continuity.mjs, main-entry.mjs (qualification wiring), supervisor-keepalive.mjs, supervisor-lifecycle-runtime-core.mjs |

**Предлагаемая ветка первого патча:** `repair/successor-qualification-liveness-v1` от `a0af13c0` — capsule supersede-reconcile + bounded re-probe + тесты. Это минимальный шаг к разблокировке №1→№4 каскада.

---

## 9. РИСКИ/ОГРАНИЧЕНИЯ (что НЕ делать — консолидировано)

1. Не мержить #557/#558 механически (diverged, конкурирующая recovery-плоскость запрещена);
2. Не редактировать DB руками для очистки WAKE_AMBIGUOUS / транзакции / Fleet-статусов;
3. Не ретайпить промпт wake_810f, не кликать Send, не создавать второй root;
4. Не реплеить инсталлер 984008; не запускать инсталлер вручную в обход апдейтера;
5. Не использовать USER-tab `tab_97c02ffd` как воркер; не трогать FENCED-историю (572);
6. Первое DevOS-доказательство — только ADVISORY (не MUTATING repairer g101);
7. Не превращать timeout в NO_EFFECT_PROVEN; не ослаблять generation floor / fences ради liveness;
8. Не считать CI-E2E физическим proof установки на живой машине; heartbeat ≠ useful-work.

---

## 10. ВЕРДИКТ

Контекст проекта восстановлен полностью и верифицирован свежими данными: **капсула R6 точна и актуальна** (единственная новая ветка уже влита; новых релизов нет). Прямая дорога к возобновлению полезной работы: **(1)** диагностировать точную причину зависания 30с-окна квалификации (startup-лог от 07:24 UTC / readback-командой), **(2)** минимальный патч reconciliation-liveness (capsule supersede + bounded re-probe) с тестами, **(3)** каноническая установка `a0af`, **(4)** R6 multi-hop retirement на process boundary этого рестарта, **(5)** первый Fleet ACTIVE + ADVISORY task end-to-end. Среда разработки готова (worktree @ release head, live-доступ, матрицы тестов). Система — safety-mature, liveness-ограничена ровно одним reconciliation-гэпом, который теперь анатомически локализован в исходнике.
