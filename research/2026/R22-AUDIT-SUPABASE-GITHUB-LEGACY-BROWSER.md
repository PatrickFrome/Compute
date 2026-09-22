# R22 — Глубокий аудит: GitHub + Supabase + старый live-браузер (Electron) vs ME2

**Дата:** 2026-09-22 23:20–23:55 UTC | **Agent:** Z.ai Code (main) | **Task ID:** R22-DEEP-AUDIT
**Основания:** живой GitHub API (T2), git-fetch рельсы `release/self-update-ambiguity-live-v2`, капсула a2-capsule (00_START_HERE + browser_context_deep_analysis_2026-09-16 + 02_LIVE_TEST_CAMPAIGN), прямые пробы Supabase REST/auth, логи CI-ранов.
**Секреты:** упомянуты только redacted-префиксами; значения — в /home/z/.a2/ (chmod 600), в дереве репо нулей нет (проверено rg-гвардом).

---

## 1. GITHUB-АУДИТ (repo = PatrickFrome/Compute = легаси-монорепо + наша ветка)

### 1.1 Масштаб репозитория
| Домен | Значение |
|---|---|
| Ветки | **200+** (2 полные страницы по 100): release/*, repair/* (40+), fix/devos-* (20+), work/*, sandbox/me2-os (наша), analysis/*, archive/*, build/*, do-not-use-placeholder (main-заглушка) |
| Открытые PR | **587** — исторические RSI-конвергенции + repair-линия; капсула прямо говорит: «шум, имя ветки ≠ авторитет, никаких bulk-merge» |
| Релизы | 5 свежих + draft; последний **v0.7.0-dev.35655839197.1 @ 71d0d42, published 2026-09-21T21:27Z** |
| CI-воркфлоу на рельсе | **~110 файлов** (.github/workflows): a2-browser-operator-r0..r3, guardian-* (12), rsi-r9..r14, w1-aws-* (7), self-update-fast-e2e, fast-autorelease, release-evidence-gate, windows-fleet-chaos-convergence, coordination-digest, governance и др. |
| Рельса (release/self-update-ambiguity-live-v2) | HEAD = 71d0d42 = merge #947 |

### 1.2 Рельса продвинулась ПОСЛЕ запечатывания капсулы (важно!)
Капсула зафиксировала 6bf173c7 (merge #938, аудит Closed Production Loop). Дальше слились:
- **#942** work/browser-fallback-console-v1 — fallback-консоль браузера
- **#943/#944** conversation-seed bootstrap: «fixes lease→effect dead end + dispatch-effect observability» + «proof-based settlement of rollover-blocked ambiguous wakes (self-update restart deadlock)»
- **#945** root-surface seed-first supervisor send + **proof-based poisoned-agent-tab self-heal** + seed-first контракт (process-boundary reuse + tab-neutrality settle)
- **#946 (3d2d065)** CP-W1 lease-liveness test — детерминированная пила для медленных CI-раннеров
- **a452e3e** **CP-W1 control-plane wedge hardening** — scheduler watchdog, cycle hard deadline, **lease liveness telemetry**
- **#947** R-DRAFT-FOCUS + R-ROOT-HYDRATION — «agent-mode provisioning unlocked»

→ 4 релиза только за 21-е (10:57, 16:39, 18:32, 21:27 UTC). Найденные в капсуле «блокеры №1–3» (квалификация SUCCESSOR_BOOTED, multi-hop wake, Fleet BOUND_UNVERIFIED) закрыты этой линией + вариaнт `repair/successor-qualification-liveness-v1` реально существует на remote (первый патч из §4.2 анализа).

### 1.3 CI на sandbox/me2-os (наша ветка) — 4 failure подряд: ОБЕ ПРИЧИНЫ НАЙДЕНЫ И УСТРАНЕНЫ
Логи ранов 35774591969 и 35797375265:
1. **Все ОС: `ENOENT: could not open output directory "../../src-tauri/binaries"`** — git не хранит пустые каталоги, а workflow делал `bun build --compile --outfile ../../src-tauri/binaries/...` без mkdir. → **ФИКС: `mkdir -p ../../src-tauri/binaries`** перед compile.
2. **Linux/macOS: `Unable to process file command 'env': Matching delimiter not found 'KEYEOF'`** — шаг Provision updater signing key (мой, R18) писал минисигн-ключ в GITHUB_ENV через heredoc `<<KEYEOF`, но `cat` файла ключа без завершающего `\n` склеивал последнюю строку base64 с делимитером. → **ФИКС: `printf '%s\n' "$(cat ...)"` + уникальный делимитер `ME2KEYEOF`.**
3. Windows-флейки rustup-скачивания (dtolnay action) — транзиентные; при повторах лечится re-run.
→ Фиксы внесены в tauri-build.yml этого раунда; верификация зелёности — следующий push.

---

## 2. SUPABASE-АУДИТ

### 2.1 Живая проба (сейчас, UTC 23:30–23:40)
| Проба | Результат |
|---|---|
| DNS/шлюз | **ЖИВ**: `sb-project-ref: xpeibufgzjknrhbhpffp`, `sb-gateway-version: 2`, `sb-error-code: UNAUTHORIZED_MISSING_API_KEY` на безключевой запрос |
| Архивный service_role JWT (iat 1787190012) | 401 Invalid API key |
| Свежечеканенный HS256 (raw secret) | 401 |
| Свежечеканенный HS256 (base64-decoded secret, std и urlsafe) | 401 |
| auth/v1/settings (публичный) | 401 — шлюз режет всё без валидного ключа |

**Вердикт:** капсула §1.2 says проект был УДАЛЁН 2026-09-20 (лимиты, DNS-FAIL). Сегодня шлюз отвечает, но **ни архивный ключ, ни мятый из архивного секрета не принимаются** → проект пересоздан/переведён на новые ключи формата (sb_publishable_/sb_secret_) либо секрет ротирован. Legacy-JWT путь закрыт на уровне платформы. **Для live-доступа нужен актуальный ключ из дашборда (Settings → API keys) — старые не восстановимы принципиально.**

### 2.2 Схема как код (истина — на рельсе; БД-данные — у оператора)
- **Данные:** единственные копии у оператора: `supabase-backup-20260920.tar.gz` (38 МБ: snapshot-dump 35 МБ + манифесты + storage 1831/1831 + edge-исходники + migrate-кит) и `uploaded.clean.sql` (217 МБ). Верифицированы при создании: 256/256 таблиц, 0 потерь, 16 ролей, auth.users 1/1. В песочнице дампы умерли при сбросе.
- **Схема/логика на рельсе:** `sql/` (browser_cognitive_delta_ingest_v1, browser_control_plane_fast_lane_v1, browser_control_plane_realtime_wake_v1, browser_fabric_event_effect_ledger_pilot_v1, t0_hermetic_toolchain_contract_v2/v3), канонические DB-функции `devos_fleet_{snapshot,reconcile,enqueue,lease,mark_running,complete}_v1`, RPC `h205f22_a2_browser_supervisor_issue_native_v1` (idempotency_key) и `_complete_batch_v1`, pgmq-очереди, realtime publication `supabase_realtime`, cron-задачи (supervisor-sweep 10s, fleet-watchdog 30s, attestation 1m, cat-trust 1m, baseline-sync 2m).
- **Edge-слой:** `supabase/functions/` — a2-browser-supervisor-v1..v4(+canary), a2-chat-bridge-remote, metaengine-devos-baseline-push-sync-h205f22, wait-emergency роут.

### 2.3 ME2-сторона облачного контура
- `evidence.ts` — outbox → RPC `me2_ingest_evidence_v1` (таблица me2_evidence), backoff 60s, DEGRADED без облака: pending копится **без потерь** (сейчас 100+).
- `mirror.ts` — durable evidence mirror (aging, MAX_PENDING 2000); **находка: читал `SUPABASE_SERVICE_ROLE_JWT`, а env-файл содержал только `SUPABASE_SERVICE_ROLE_KEY`** → в /home/z/.a2/supabase-cloud.env добавлен алиас (работоспособность ключа это не меняет — см. 2.1).
- `ME2_MIRROR_URL` env уже поддержан mirror'ом → **точка интеграции с self-hosted плоскостью готова без изменения кода.**

### 2.4 Правильный путь БД-плоскости (капсула §4, подтверждено аудитом)
- **A) HTTP-слой перед self-hosted Pigsty** (правильный полный путь): edge-стек рельсы + `DB_URL=postgres://...@host:55432/postgres` (direct, НЕ pooler 6543 — иначе ломаются pg_notify-подписки). Runbook: `a2-capsule/reference-from-rail/docs_push-wake-edge-deploy-runbook.md`.
- **B) Локальный режим** (быстрый старт): loopback RPC `~/.a2/supervisor-loopback.json`, локальный supervisor/fleet/DevOS/MC UI/память — remote-fabric недоступен, но браузер у оператора жив именно так.
- **C) Self-hosted Supabase (docker)** — 100% совместимость протоколов, ноль правок кода.
→ Для ME2: когда плоскость A/C поднимется, evidence-plane + mirror включаются одной переменной. До тех пор DEGRADED = ожидаемое состояние, НЕ баг.

---

## 3. СТАРЫЙ LIVE-БРАУЗЕР (Electron) — ДЕТАЛЬНЫЙ АНАЛИЗ (жив прямо сейчас у оператора)

### 3.1 Что это и где живёт
Electron-приложение `apps/metaengine-browser/` в монорепо (1063 файла в src/; ~190 модулей доменов supervisor/fleet/memory/brain/rsi/self-update/mission/delta/loopback/sentinel). **Установлен и работает у оператора (Windows x64): v0.7.0-dev.35532004761.1** (инсталлятор 121 МБ, 2026-09-20). Рельса уже ушла дальше (35655839197.1) — браузер может самообновиться по каналу DEV_HINT, когда облако/канал доступны; сейчас (облако мёртво) он живёт **локальным режимом (B)**: native supervisor, loopback RPC, fleet, DevOS-цикл, Mission Control UI, память, delta bus — всё локально.

### 3.2 Карта механик (по исходнику рельсы 71d0d42 + капсулы)
| Домен | Модули (файлы рельсы) | Суть |
|---|---|---|
| Supervisor lifecycle | supervisor-keepalive, supervisor-lifecycle-runtime-core, supervisor-keepalive-wake | keepalive-цикл, WAKE_AMBIGUOUS retirement (multi-hop durable fence), admission OPEN/RECOVERING/FENCED |
| Sentinel/HostResilience | browser-sentinel.mjs, sentinel-worker, sentinel-liveness, sentinel-action-journal | ARMED/HEALTHY, incarnation reconcile (SUCCESSOR_BOUND + archive предка), parent/worker PID proof |
| Guardian | guardian-core, guardian-bootstrap-plan, guardian-start-executor.cjs, guardian-health-admission, guardian-heartbeat-fence, guardian-session-broker-*, guardian-update-intake/actuator | bootstrap/activation/self-heal браузера как процесса; enrollment владельца; session broker с effect-gates |
| Self-update | self-update-* (continuity watchdog, successor-recovery, successor-qualification, signed heartbeat), guardian-update-* | транзакция обновления: journal v8, pre-install receipts, SUPERSEDED-reconcile, 12-полевая qualification, continuity capsule |
| Fleet/DevOS | devos-native-task-cycle(-core), devos-repo-read-model, devos-effect-delivery-journal, browser-fabric-cell-fleet, tab-registry | задачи с lease-генерациями, FENCED/AMBIGUOUS-учёт, транспортный proof BOUND→ACTIVE, потолки env-bounded (FLEET_TAB_CEILING 4..64, MAX_TABS 8..128), Outcome River → reliability-ordered retirement (#935) |
| Память | browser-brain-episodic-memory, browser-brain-working-memory, #advanceTaskOutcomeFor, #memoryBlockFor | коллаборационная память: 5 эпизодов/900 ток, TEAM MEMORY ≤1400 в промпте, идемпотентность terminal_task_immutable, progress_revision=lease_gen+1 |
| Cognitive delta | browser-cognitive-delta-bus, -transport | ring(64) + systemDeltaTail + IPC `metaengine:shell:system-deltas`; SYSTEM-события (FLEET_RECONCILE diff, executeNativeSupervisorCommand OK/FAILED+duration, health transitions, artifact recorded); DB-акцептор rollback-only, live-путь full-state fallback |
| Mission Control | metaengine-mission-control-projection.mjs, ui/app.js | проекция objectives→tasks→agents→effects + artifacts/attention/epochs; **fails-closed, zero-authority**; экран по умолчанию; work_graph рендер; RSI-вывод в UI |
| Loopback RPC | supervisor-loopback-rpc-server.mjs | HTTP POST /rpc только на loopback; сессионный 256-bit bearer (timing-safe); манифест `~/.a2/supervisor-loopback.json` (0600); методы health/snapshot (READ_ONLY) + command (fenced executor) |
| Effect-эпистемология | (сквозная) | CONFIRMED / NO_EFFECT_PROVEN / FAILED_PRE_EFFECT / FENCED / AMBIGUOUS + **one-attempt durable fences** (markAmbiguousContinuationAttempt — барьер ДО физического Send); «никогда не разменивать exact identity/durable fence/AMBIGUOUS на liveness» |
| Identity | (сквозная) | **exact identity chain**: agent→tab→WebContents→renderer PID+creation→CDP target→generation; запрет authority от URL/title/page/model text |
| Постираж | metaengine-browser-self-update-fast-e2e, fast-autorelease, release-evidence-gate | физическая N→N+1 верификация обновления на Windows-раннере; авто-релиз 7 ассетов; sha256-дайджесты |

### 3.3 Пост-капсульные улучшения (рельса #943–#947) — уже в live-ветке
seed-first bootstrap (lease→effect dead end), proof-based poisoned-agent-tab self-heal, settlement rollover-blocked ambiguous wakes, CP-W1: scheduler watchdog + cycle hard deadline + lease liveness telemetry, R-DRAFT-FOCUS/R-ROOT-HYDRATION (agent-mode provisioning).

### 3.4 Известные дефекты легаси (для НЕповторения в ME2)
30с-окно квалификации без re-probe (закрыто рельсой post-capsule); result-transport без bounded delivery (EXPIRED при живом эффекте); keepalive null-projection (учебный урок чтения state).

---

## 4. СРАВНЕНИЕ: легаси-браузер ↔ ME2 (daemon v0.21.0 + ME-матрица 18/18)

| Домен | Легаси | ME2 | Статус порта |
|---|---|---|---|
| Командная шина | issue_native_v1 (idempotency, lease, poll-to-terminal, AMBIGUOUS→stop) | ME1: 4 полосы + бюджет + idempotency, 47 действий, EMERGENCY-полоса | ✅ ПОРТИРОВАН (упрощён: локальная шина вместо DB-lease) |
| Воркеры/задачи | DevOS task cycle (lease_generation, FENCED/AMBIGUOUS, claims) | ME3: агент-цикл + TASK_* | ✅ портир. (без lease-генераций) |
| Fleet | transport proof BOUND→ACTIVE, census, env-потолки, **reliability-ordered retirement** | ME6: proof-gate, self-node 15s, GC 24h | ✅ портир. / ❌ нет Outcome River + потолков |
| Память | эпизодическая/рабочая, TEAM MEMORY ≤1400, но **save_count=0 — persistence никогда не был proof** | ME4: SQLite WAL + авто-материализация + persistence-пруф + /memory/block | ✅ ПОРТИРОВАН И УЛУЧШЕН |
| Brain/cognitive | cognitive delta bus (ring 64, ack/resync), мозг-эпизоды | ME5: brain/think (LLM-план + реколл памяти → мысль) | ✅ концепт-порт (без ack/resync — не нужен локально) |
| Self-update | транзакция: journal v8, qualification 12 полей, continuity watchdog, каналы | ME7: ff-only + dirty/diverged барьеры + bounded re-probe + check-кэш 30s | ✅ портир. с фиксом легаси-дефекта 30с-окна / ❌ нет N→N+1 e2e и release-трубы |
| RSI | 91 модуль, r9..r14 graduation-сертификаты (operator-managed) | ME8: propose(auto)/adopt/rollback (operator gate) | ✅ портир. (без graduation-цепи — сознательно) |
| Браузерная перцепция | semantic_targets[] {role,name,ref,value_sha256} + state_revision_id + CAPTURE→act→verify, «no pixel geometry» | ME17: sense (aria→semantic targets, revision sha, act+auto-verify, self-healing re-capture) | ✅ ПРЯМОЙ ПОРТ лучшей механики |
| Сенсоры страницы | (нет runtime — observation-cohorts только контракты) | **ME18: obsv network/console/exceptions (CDP, паритет DevTools MCP)** | ✅ НОВОЕ (впереди легаси) |
| Браузерные действия | Dev Plane guarded: 14 capabilities, **arbitrary_eval=false** | шина: 17 BROWSER_*, eval отсутствует (проверено /actions) | ✅ инвариант сохранён |
| Effect-эпистемология | 5 статусов + one-attempt durable fences | sense-act verify: revision_changed/target_alive (булевы) | ⚠️ УПРОЩЕНО — нет таксономии и durable fences |
| Identity chain | agent→tab→WebContents→PID→CDP target→generation | tab id + refs + revision | ⚠️ ЧАСТИЧНО (нет PID/генераций) |
| Mission Control | проекция objectives→tasks→agents→effects + work_graph, fails-closed | MC-панель: механики/fleet/memory/brain/sense/obsv/roadmap | ⚠️ ЧАСТИЧНО (нет objectives/work_graph слоя) |
| Loopback RPC | 256-bit bearer, timing-safe, 0600-манифест | REST :3041 локальный | ✅ эквивалент (без bearer-манифеста) |
| Realtime wake | POSTGRES_NOTIFY (pgmq) | WS :3040 | ✅ эквивалент локально |
| Self-update CI | self-update-fast-e2e (физический N→N+1) + fast-autorelease (7 ассетов) + evidence-gate | tauri-build (3 ОС, сборка+подпись) | ❌ НЕТ e2e-трубы обновления |
| Наблюдаемость | heartbeat-таблицы, Evidence plane | ME12 OTel-lite + OTLP, ME15 RH-verdicts, ME9 codegraph, ME11 sandbox, ME14 roadmap verdicts, :3042/:3043 live-видео | ✅ НОВОЕ, местами впереди легаси |

---

## 5. ЧТО ЕЩЁ НЕ ВНЕДРЕНО (приоритизировано)

### P1 — качественный скачок
1. **Effect-эпистемология 5-статусная + one-attempt durable fences** в sense-act и шине (CONFIRMED/NO_EFFECT_PROVEN/FAILED_PRE_EFFECT/FENCED/AMBIGUOUS) — эталонная механика легаси; в ME2 сейчас булев verify.
2. **Self-hosted DB-плоскость (вариант A/C)** → оживить evidence/mirror end-to-end (ME2_MIRROR_URL готов; edge-стек рельсы + Pigsty bootstrap-кит в репо; от оператора нужны VPS/хост или новые API-ключи).
3. **Fleet reliability-ordered retirement + grace** (Outcome River T3-9) + env-bounded потолки — в ME6.

### P2 — доведение до паритета
4. **CP-W1 lease liveness telemetry + scheduler watchdog + cycle hard deadline** (рельса a452e3e/3d2d065) → в ME3/ME6.
5. **Seed-first bootstrap и poisoned-tab self-heal** (#945) → принцип в sense/fleet: первое доказательство — seed-поверхность, proof-based замещение «отравленных» целей.
6. **Identity chain extension**: tab→CDP target (Target.getTargetInfo)→revision→generation в sense/obsv.
7. **Mission Control objectives→tasks проекция + work_graph** (порт mission-control-projection fails-closed).

### P3 — эксплуатационный паритет
8. **Self-update e2e-труба** (аналог self-update-fast-e2e: физическая N→N+1 верификация) + release-труба с 7-ассетным автопублишем.
9. **Кварантин/чистка легаси-остатков в ME2-дереве**: src/lib/fallback-console.ts, src/app/api/fallback/route.ts (+@/lib/edge, @/lib/pg) — живые легаси-маршруты из main-истории (решение оператора: удалить или задокументировать как legacy-plane).
10. **Bounded redelivery receipts** (из §7.2 легаси-анализа) — при появлении remote-плоскостей.
11. **Graduation-цепь RSI** (r9..r14-стиль) — сознательно отложено, operator-managed по дизайну.

---

## 6. ДЕЙСТВИЯ РАУНДА R22
1. Диагноз 2 корней падений tauri-build (ENOENT binaries; GITHUB_ENV delimiter) + фиксы в .github/workflows/tauri-build.yml → push → новый ран.
2. Env-алиас SUPABASE_SERVICE_ROLE_JWT (mirror.ts) в /home/z/.a2/supabase-cloud.env.
3. git-fetch рельсы (read-only, depth 40) — разбор #942–#947 и карты модулей.
4. Этот документ: research/2026/R22-AUDIT-SUPABASE-GITHUB-LEGACY-BROWSER.md.
5. Worklog R22 + push sandbox/me2-os.

## 7. ЧТО НУЖНО ОТ ОПЕРАТОРА
- **Для live-аудита БД из песочницы:** актуальный ключ дашборда (новый формат sb_secret_… или реактивированный legacy JWT) — все архивные варианты отвергнуты шлюзом (проверено 5 способами).
- **Для полного контура:** VPS/хост под вариант A (edge→Pigsty) или C (self-hosted Supabase); бэкапы у оператора (38 МБ + 217 МБ) — единственные копии данных.
- Решение по P3.9 (легаси-остатки в дереве ME2).
