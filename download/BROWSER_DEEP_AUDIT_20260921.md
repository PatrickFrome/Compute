# BROWSER_DEEP_AUDIT_20260921 — Глубокий аудит механик браузера METAENGINE

**Task ID:** 2-b (browser mechanics deep audit) · **Рельса:** `release/self-update-ambiguity-live-v2 @ 6bf173c7` (Merge PR #938 «work/browser-closed-loop-audit-fixes-v1») · **Режим:** READ-ONLY аудит
**Объект:** `apps/metaengine-browser/` — 353 модуля `src/*.mjs`, 17 файлов edge `supabase/a2-browser-native-supervisor-v1/`, 91 RSI-модуль, native Guardian (C++ SCM), ~350 тестов в `test/`.
**Метод:** прямое чтение кода + grep контрактов; верификация живости по «кто вызывает / что читает / что пишет в БД», а не по титулам PR.

---

## СВОДНАЯ ТАБЛИЦА ВЕРДИКТОВ

| # | Механика | Вердикт |
|---|----------|---------|
| 1 | TabRegistry (лимиты 28/48, census) | РАБОТАЕТ |
| 2 | Elastic fleet governor (24 агента, backlog-driven) | РАБОТАЕТ |
| 3 | DevOS task cycle (lease→running→complete→readback) | РАБОТАЕТ |
| 4 | Command plane (lanes, lease_batch_v1, wait-batch, receipts) | РАБОТАЕТ |
| 5 | Wake: POSTGRES_NOTIFY glm_browser_pulse | РАБОТАЕТ (фолбэк-поллинг есть) |
| 6 | Wake: Supabase Realtime broadcast | ДЕКОР (ключи не JWT → всегда фолбэк) |
| 7 | Emergency lane + wait-emergency | РАБОТАЕТ (роут смонтирован; браузером не используется — для внешних тулов) |
| 8 | Device identity P-256 + nonce + zero-authority | РАБОТАЕТ |
| 9 | Enrollment (PENDING→APPROVED→pairing token) | РАБОТАЕТ |
| 10 | Supervisor keepalive + rollover | РАБОТАЕТ (approveRollover — мёртвый вызов, компенсирован auto-release) |
| 11 | ROLLOVER_DEFERRED_AUTO_RELEASE 15 мин | РАБОТАЕТ (закладка от «вечного зомби») |
| 12 | Supervisor mesh (≤16, fenced reservation, sync RPC) | РАБОТАЕТ |
| 13 | Cognitive delta bus (PROCESS/SEMANTIC/METRICS/SYSTEM) | РАБОТАЕТ |
| 14 | Cognitive edge accept (курсорная таблица, без персистенции дельт) | РАБОТАЕТ (с ограничением — см. §6) |
| 15 | Эпизодическая память + гибридный retrieval | РАБОТАЕТ (in-process, не в PG) |
| 16 | Agent observation plane (консоль/сеть/health ring-буферы) | РАБОТАЕТ |
| 17 | Bounded worker observer v2 | РАБОТАЕТ |
| 18 | State plane push (12 плоскостей в PG jsonb) | РАБОТАЕТ |
| 19 | Self-update: hint→exact discovery→barrier→watchdog | РАБОТАЕТ |
| 20 | Guardian native (C++ SCM, WTS broker, actuator) | РАБОТАЕТ (Windows-only) |
| 21 | RSI runtime service + trust-root (40+ верификаторов) | РАБОТАЕТ (детерминированная эволюция; прод-выход за гейтом) |
| 22 | RSI Outcome River (tool-команды → эпизоды) | РАБОТАЕТ |
| 23 | Meta-оркестратор superstep (frontier admission) | РАБОТАЕТ |
| 24 | RSI Phase36 exposure-release / lineage contamination | РАБОТАЕТ как библиотечные верификаторы (вход — тесты/консоль, не самостоятельный прод-триггер) |
| 25 | Realtime process plane (наблюдение воркеров) | РАБОТАЕТ |

Итого: **~21 РАБОТАЕТ, 1 ДЕКОР (realtime wake), 3 с оговорками** (wait-emergency, Phase36, memory-in-process). Ни одна найденная механика не «висит в воздухе» без потребителя — по каждой есть вызов или запись в durable-плоскость; исключения перечислены в разрывах §10.

---

## 1. ТАБЫ И РЕЕСТР

**Файлы:** `src/tab-registry.mjs` (153 строки), `src/fleet-elastic-governor.mjs`, `src/fleet-provisioner-core.mjs`, `src/browser-webcontents-tab-index.mjs`, тесты `test/tab-registry*.test.mjs`, `test/rollover-tab-leak-reclaim.test.mjs`, `test/fleet-capacity-backpressure.test.mjs`.

| Константа | Значение | Где | Контракт |
|---|---|---|---|
| `FLEET_TAB_CEILING` | **28** (env `A2_FLEET_TAB_CEILING`, клэмп 4..64) | tab-registry.mjs:15 | жёсткий потолок вкладок роли FLEET |
| `MAX_TABS` | **48** (env `A2_MAX_TABS`, клэмп 8..128) | tab-registry.mjs:16 | общая стена; 20 слотов всегда зарезервированы за человеком |
| `A2_FLEET_MAX_TARGET_AGENTS` | **24** (1..64) | fleet-elastic-governor.mjs:49 | живой потолок агентов (поднят с 12 closed-loop fix'ом) |
| Ошибка стены | `'tab_capacity_exceeded'` | tab-registry.mjs:45-48 | одинаковая строка для обеих стен → детерминированная классификация `CREATE_TAB_AMBIGUOUS` в провижинере (no-effect, никогда не амбиггуитет) |

Ключевые функции: `TabRegistry.create/update/select/close/census/snapshot`; `census()` (стр. 116-142) — read-only щуп физической ёмкости (`fleet_tab_headroom`, `user_reserved_slots`, `release_signal: 'PHYSICAL_TAB_CLOSED'`, `authority_effect:false`); `planElasticFleetCapacity` (governor) — растит флот ТОЛЬКО по серверно-авторитетному backlog'у (READY+RUNNING через FLEET_RECONCILE), с idle-shrink; провижинер ведёт `capacity_backpressure` (ретайры без эффекта).

**Связи:** census читают DevOS-цикл (`devos-native-task-cycle-core.mjs:26` импортирует FLEET_TAB_CEILING) и governor; стена проверяется ДО создания вкладки; утечки rollover-вкладок дренируются по proof (`#drainRolloverLeaks` в lifecycle).

**Вердикт: РАБОТАЕТ.** Лимиты реальные, в двух независимых плоскостях (роль/всего), с operator-tunables и 保护 reserved-слотов пользователя.

---

## 2. СУПЕРВИЗОРЫ

**Файлы:** `src/supervisor-lifecycle-runtime-core.mjs` (1399 строк), `src/supervisor-keepalive.mjs`, `src/supervisor-bootstrap-keepalive.mjs`, `src/supervisor-mesh*.mjs` (4 файла), `src/browser-sentinel.mjs` v1.6.1, `src/host-resilience-runtime.mjs`, `src/browser-guardian-core.mjs` + `native/browser-guardian-scm/*.cpp` (Windows-сервис), тесты `supervisor-keepalive/continuity/mesh-*.test.mjs`.

**Кто перезапускает супервизоров — 4 слоя:**
1. **Keepalive-воскрешение в той же вкладке** (`SupervisorKeepalive`, мин. интервал 60 с): wake-сообщение `METAENGINE_SUPERVISOR_WAKE_V1` (`buildSupervisorWakeMessage`, supervisor-keepalive.mjs:180) печатается в composer той же беседы — «продолжай из durable state, не жди пользователя».
2. **Rollover** (новая беседа при переполнении контекста): `METAENGINE_SUPERVISOR_ROLLOVER_V1` (epoch+1, previous_conversation). Защита от зомби: D-C5 (8 no-progress циклов → перезапрос на FRESH tab), D-C6 (троттлинг скана кандидатов 30 с), D-C7 (дрейн утечек), D-S1 (fallback по одному кандидату в том же процессе), и **ROLLOVER_DEFERRED_AUTO_RELEASE** — `DEFERRED_ROLLOVER_AUTO_RELEASE_MS = 15*60*1000` (стр. 25, актуация 1266-1284): operator-class rollover, припаркованный в DEFERRED (т.к. `approveRollover` не имеет ни одного вызыва — D-K8), через 15 минут самораспускается и открывает свежую вкладку. Это честный фикс «мёртвого супервизора на single-conversation install».
3. **Crash sentinel** (`browser-sentinel.mjs`): worker-heartbeat ≤8 с, durable action-journal, successor-journal reconcile, restart policy, asar-unpack воркер.
4. **Guardian** (`browser-guardian-core.mjs` + `native/browser-guardian-scm/`): план механик `START_CHILD / RESTART_EXACT_CHILD / ACTIVATE_CANDIDATE / ROLLBACK_CANDIDATE / ESCALATE_TO_SCM`; исполнение — C++ Windows SCM-сервис (`browser-guardian-scm-service.cpp`), WTS session broker (`browser-guardian-session-broker-wts-executor.cpp` — запуск в интерактивной сессии), update actuator (`browser-guardian-update-actuator.cpp`), owner-enrollment store/reconciler; всё под effect-journal (контрактные тесты `browser-guardian-*-effect-journal.test.mjs`).

**Mesh:** `SupervisorMesh` строит реестр до 16 супервизоров (id = `sup_<sha256(url)[:24]>`, `metaengine.supervisor-mesh.state.v1`), `SupervisorMeshRuntime` — fenced reservation (`supervisor-mesh-fenced-reservation.mjs`), epoch fence, foreground-send через boundary-executor; синк в облако — RPC `h205f22_a2_supervisor_mesh_sync_v1` (index.ts:47, вызов из `upsertState`). Edge валидирует boundedMesh (supervisors ≤16, `authority_effect:false`, LOST→tab_id=null).

**Связи:** keepalive/rollover пишут `supervisor_lifecycle`-плоскость state; mesh → `supervisor_mesh`-плоскость + MESH_SYNC_RPC; guardian → self-update контур (§8).

**Вердикт: РАБОТАЕТ** (все 4 слоя живые, тестированные). Оговорка: `approveRollover` — мёртвый публичный API (нет вызыва) — но это задокументировано в коде и компенсировано auto-release; realtime mesh-обновления идёт через 5-с heartbeat, не push.

---

## 3. DevOS ЦИКЛ ЗАДАЧ

**Файлы:** `src/devos-native-task-cycle-core.mjs` (1321 строка), edge `devos-routes.mjs` (373), SQL-RPC: `devos_fleet_reconcile_v1`, `devos_fleet_snapshot_v1`, `devos_fleet_lease_v1` (7 арг., p_seconds=900), `devos_fleet_mark_running_v1`, `devos_fleet_complete_v1`, `devos_fleet_reconcile_ambiguous_v2`, `devos_environment_state_v1/resume_v1`; таблицы `destruktion_meta.devos_fleet_{task,claim,event}_h205f22`.

**Полный жизненный цикл задачи:**
```
[roadmap/meta-оркестратор или оператор] → devos_fleet_enqueue (SQL-плоскость)
→ ADMISSION: /v1/devos/cycle читает devos_environment_state_v1
   (refill_enabled ∧ supervisor_admission_enabled = OPEN; иначе ADMISSION_FENCED — fail-closed)
→ LEASE: /v1/devos/cycle → devos_fleet_reconcile_v1 → snapshot → fair-idle-кандидаты
   (роль-осознанный скан ≤32 агентов, потолок 16 лиз/цикл, «role exhausted» после первого отказа)
→ RUNNING: браузер вводит задачу в беседу агента; proof {prompt_sha256, conversation_url_sha256,
   effect_state∈PROVEN_*} → /v1/devos/mark-running → devos_fleet_mark_running_v1 (CAS по generation/epoch)
→ OBSERVE: #observeRunning — CAPTURE вкладки, stop-кнопка = GENERATING, tool-запросы агента
   обслуживаются через /v1/commands/issue-tool (allowlist CAPTURE/READ_TRANSCRIPT/TAB_TELEMETRY/
   SYSTEM_TELEMETRY/SCROLL/SEMANTIC_FOCUS)
→ COMPLETE: #postCompletionWithReadback → /v1/devos/complete → devos_fleet_complete_v1
   (состояния RESULT_READY/BLOCKED/COMPLETED/FAILED/AMBIGUOUS)
→ AMBIGUOUS-write recovery: GET /v1/devos/tasks/{id}/status — readback-доказательство
   (generation mismatch → no-retry), классы PRE_EFFECT_ABORTED / EFFECT_PROVEN →
   devos_fleet_reconcile_ambiguous_v2
```

Ключевые функции клиента: `advanceTaskOutcomeFor` (devos-native-task-cycle-core.mjs:**1242**, вызов из **1169**) — never-throw мост терминального исхода в episodic-memory (learning write path); `#memoryBlockFor` — retrieval 5 верифицированных эпизодов в промпт (token_budget 900, кэш на lease); `#recordTaskOutcomeArtifact` — детерминированный artifact_id `devos.task-result.{task_id}.{gen}`; `runningObservationBudget(live)` = clamp(ceil(live/2), 4..16); D-C2: параллельный dispatch лизов, по-табовая сериализация.

**Связи:** лизы идут только под agent-binding (tab_id/target_id/epoch); dispatch fenced от admission; каждый терминальный исход = 1 artifact + 1 memory advance + 1 episode (Outcome River §7).

**Вердикт: РАБОТАЕТ** — полный замкнутый цикл с двойным доказательством эффекта (proof-хэши) и readback-восстановлением после амбиггуитета. Единственный внешний вход задач — SQL enqueue (см. разрыв R3 §10).

---

## 4. КОМАНДНАЯ ПЛОСКОСТЬ

**Файлы:** edge `index.ts` (305), `src/native-supervisor-command-lanes.mjs` (514), `src/native-supervisor-command-batch-fastlane.mjs`, `src/native-supervisor-result-batch.mjs`, SQL: `supabase/command-fabric-issue-batch-v2.sql`, `command-fabric-lease-emergency-v1.sql`, `command-fabric-result-outbox-v1.sql`, `command-fabric-terminal-broadcast-v1.sql`.

**Lanes** (`classifyNativeSupervisorCommand`, schema `.command-lanes.v3`):

| Лейн | Приоритет | Действия | Параллельность |
|---|---|---|---|
| EMERGENCY | 0, exclusive | `DISARM`, `DEVELOPER_EMERGENCY_UPDATE`, `SET_SUPERVISOR_MODE{mode:OFF}` | блокирует всё |
| READ_ONLY | 10 | POLL, CAPTURE, TAB_CENSUS, FLEET_STATUS, **TAB_TELEMETRY, SYSTEM_TELEMETRY, READ_TRANSCRIPT**, DEV_PLANE_*, SELF_UPDATE_STATUS, GATE_STATUS… | параллельно, causal по tab |
| TAB_MUTATION | 20 | STOP_GENERATION, SEMANTIC_TYPE, TYPED_CLICK, NAVIGATE, CLOSE_TAB… (только с явным tab_id; без него — fenced) | serial per-tab, cross-tab параллельно |
| GLOBAL_MUTATION | 15, exclusive | ARM, SET_MODE, NEW_TAB, FLEET_RECONCILE, SELF_UPDATE_CHECK/APPLY, GATE_*, DOWNLOAD_* | строго по одному |

Планировщик `NativeSupervisorCommandLaneScheduler.drain()` — causal read-after-write/write-after-read по `tab:{id}`, O(n) предвычисление, детектор дедлока, pressure-budget регистр (live-tuning без изменения authority).

**Транспорт:** `lease_batch_v1` = RPC `h205f22_a2_browser_supervisor_lease_batch_v1` (max_batch ≤64, max_tab_mutations ≤8, timeout 120 с) → envelope `command-batch.v1`; **wait-batch** = held-запрос ≤15 с: lease→(пусто)→подписка wake→recheck→wake→lease; **result-batch** = `complete_batch_v1` (≤64 результатов, топ-уровневый `ok` обязателен); **receipts** = GET `/v1/commands/{id}/receipt` (terminal COMPLETED/FAILED, `result_receipt_readback_is_authority:false`); **effect sealing** = POST `/{id}/effect-intent` → `bind_effect_v1` (schemas v1/v2). Единый профиль авторизации: `A2_DEVICE_HTTP_SIGNATURE_V1` на каждый маршрут (§5).

**Wake-каналы:** POSTGRES_NOTIFY канал **`glm_browser_pulse`** — триггеры `glm_pulse_command`/`glm_pulse_state` (`infra/pigsty/bootstrap/07-wake-triggers.sql:11-20`) на INSERT/UPDATE команд/стейта вызывают `glm_browser_pulse_notify_v1` (миграция 20260906093000); edge `postgres-command-wake.mjs`: ≤128 официантов, конверты {table,target_client_id}/{tbl,client}, при reconnect — wake всех (LISTEN без истории). Без notify — `POSTGRES_*_DB_POLL_FALLBACK` (burn wait, потом durable recheck) — zero-delay spin исключён. Realtime-ветка (`realtime-command-wake.mjs`, топики `metaengine-control:{ws}:{client}|all`) — **ДЕКОР** при современных `sb_secret_*` ключах (не-JWT → `REALTIME_ACCESS_TOKEN=''`, всегда NOTIFY-прокси; честно отражено в `/health`: `command_wait_batch: POSTGRES_NOTIFY_PROXY`).

**Command-actions реестр:** полный allowlist — READ_ONLY 20 действий (стр. 11-20 lanes.mjs), TAB_MUTATION 13, GLOBAL_MUTATION 11, EMERGENCY 3; отдельный tool-issue allowlist `TOOL_ISSUE_ACTIONS` (index.ts:40) с per-agent attribution `issued_by=agent:<id>` и idempotency `tool:sha256(agent:task:request)`.

**Вердикт: РАБОТАЕТ** (lanes/lease/wait/receipts/sealing — полный контур, верифицирован E2E 10/10 ранее; realtime-ветка — задекорированный фолбэк, но не ломает контур).

---

## 5. ENROLLMENT / БЕЗОПАСНОСТЬ

**Файлы:** `src/supervisor-device-identity.mjs` (357), edge `index.ts` (verifyEnrollment/authenticateDevice), RPC `h205f22_a2_browser_device_consume_nonce_v2`, `h205f22_a2_browser_device_activate_approved_v1`; bootstrap `infra/pigsty/bootstrap/06-reconstruct-device-enrollment.sql`.

- **Ключ:** ECDSA **P-256** (prime256v1), подпись sha256, `dsaEncoding: ieee-p1363`, base64url; приватный ключ — PEM в Electron `safeStorage` (`encrypted_private_key_b64`, файл состояния mode 0600, atomic rename); fingerprint = sha256(canonical JWK {crv,ext,key_ops,kty,x,y}).
- **Профили:** `A2_DEVICE_HTTP_SIGNATURE_V1` (device), `METAENGINE_NATIVE_ENROLLMENT_V1` (enroll), `METAENGINE_GUARDIAN_OWNER_CHALLENGE_V1`, `METAENGINE_GUARDIAN_UPDATE_ACTUATOR_V1`.
- **Заголовки:** `x-a2-device-{profile,id,timestamp,nonce,body-sha256,signature}` + `x-a2-chat-bridge-client`; материал = профиль/device/method/path/timestamp/nonce/body_sha256 (клиент supervisor-device-identity.mjs:333-356 ↔ edge index.ts authenticateDevice — зеркально).
- **Nonce:** 24 байта base64url; сервер — атомарное потребление через `consume_nonce_v2` (sha256(nonce), timestamp-окно); enrollment headers — 2-мин окно.
- **Pairing:** APPROVED-заявка активируется RPC → одноразовый pairing_token (sha256-хэш в `compute_fabric_a2_chat_bridge_remote_pairing_h205f22`); каждый device-запрос пере-проверяет `enrollment_pairing_token_hash` → revoke пары = мгновенный PAIRING_REVOKED.
- **Zero-authority гейт:** `src/owner-safety-gate-registry.mjs` + все edge-контракты требуют `authority_effect:false`, `automatic_retry_allowed:false`; браузерные плоскости (workspace-workbench-projection: `browser_actuation_authority:false`, `url_heuristic_grouping:false`) и RSI-объекты — все через `zero()`-конструкторы (десятки полей `*_authority:false`).
- **Agent context tokens:** те же device-ключи подписывают per-agent контекст-токены (`agent-context-token.mjs`, TTL ≥60 с, mission_digest) — атрибуция агентов без общего секрета.

**Вердикт: РАБОТАЕТ.** Подпись, nonce-replay защита, pairing-отзыв, zero-authority-инварианты — сквозные и взаимосогласованные. Не найдено ни одного маршрута edge без authenticateDevice (кроме /health).

---

## 6. КОГНИТИВНЫЙ СЛОЙ

**Файлы:** `src/browser-cognitive-delta-bus.mjs`, `browser-cognitive-delta-transport.mjs`, `browser-cognitive-system-deltas.mjs`, `browser-cognitive-message-port-hub.mjs`, edge `cognitive-delta-routes.mjs`, RPC `h205f22_a2_browser_cognitive_accept_v1`, курсорная таблица `compute_fabric_a2_browser_cognitive_cursor_h205f22`.

- **Шина:** кольцевой буфер 4096 (hard 16384), read ≤256 (hard 1024), stream_id UUIDv4, приоритеты P0..P3: навигация/attach = P0, Accessibility/DOM = P1, Network/Runtime = P2, METRICS_SAMPLE = P3, SYSTEM-флотовые переходы = P1. Источники ровно 4: **PROCESS / SEMANTIC / METRICS / SYSTEM** (стр. 72; SOURCES-set в edge:1-13 — расхождение источника = 400 батча, T3-8 fix).
- **Транспорт:** POST `/v1/cognitive/deltas` ≤128 событий / 256 КБ, zero-authority fences (`raw_payload_exposed/page_text_exposed/input_values_exposed/control_authority/command_leasing/authority_effect` все=false), ack = курсор `accepted_through_sequence/accepted_batches/accepted_events`; `delivery_is_authority:false`. Fallback — full snapshot (`browser-cognitive-delta-fallback.test.mjs`).
- **Ограничение:** облако НЕ персистит дельты — только курсор (подтверждено облачным аудитом 006: хранение = cursor-таблица). Долгосрочная когниция живёт в браузерных модулях.
- **Cognitive cursor + brain:** `browser-brain-cognition-fabric.mjs` (advisory-plan из дельт, инвалидация по DOM.documentUpdated/frameNavigated/RendererGone), `browser-brain-observation-cursors*.mjs` (cohort-acks), `browser-brain-stream-clock.mjs` (валидация порядка), collaboration-fabric/journal, working-memory, stall-detector.
- **Память:** `browser-brain-episodic-memory.mjs` — гибридный retrieval (лексический + 64-мерный hash-vector cosine), дайджесты; **мост из DevOS**: `advanceTaskOutcomeFor` (§3) материализует эпизоды; retrieval — в `#memoryBlockFor` → промпт. PR-темы #915/#907/#899 (memory rehabilitation / retrieval utility) в рельсе представлены `rsi-adaptive-experience-retrieval.mjs` + `rsi-memory-governance.mjs` (trust-root снапшоты подключены в rsi-runtime-service.mjs:35,37); отдельного слова «rehabilitat*» в коде нет — темы реализованы как adaptive-retrieval/governance.
- **UI:** `metaengine-mission-control-projection.mjs` → `ui/app.js:1587` рендерит `mission_control` (подтверждено).

**Вердикт: РАБОТАЕТ** (шина+транспорт+курсор+память связаны в контур «действие→дельта→эпизод→промпт»). Оговорка: персистенция эпизодов — in-process файлы (userData), не PG; дельты не переживают рестарт браузера (по дизайну — full snapshot recovery).

---

## 7. RSI-КОНТУР

**Файлы:** 91 модуль `src/rsi-*.mjs`; сборщик — `src/rsi-runtime-service.mjs` (40+ `*TrustRootSnapshot` импортов); точки входа в main.mjs:8-11,730-761 (`RsiRuntimeService` ledger `metaengine-rsi-runtime-ledger-v1.jsonl`, `RsiOutcomeRiver`, `RsiOperatorSteering`, `rsi-operator-console`); edge `result-receipt-readback.mjs`.

- **Живой каркас:** `rsi-shadow-core.mjs` (`RSI_HARD_INVARIANTS`, ShadowArchive), `rsi-shadow-observer`, `rsi-verified-evolution-archive` (инвариант: архив принимает ТОЛЬКО канонически воспроизводимый результат турнира — пере-эвалюация обязана совпасть digest-в-digest), `rsi-shadow-tournament`, `rsi-promotion-admission-gate`, `rsi-evaluator-mesh`, `rsi-runtime-ledger`, evidence-origin crypto (`scripts/rsi-evidence-origin-crypto.mjs`).
- **Outcome River:** каждая tool-команда командной плоскости (issue-tool, §4) рождает `rsi_task` контекст; терминальный receipt инжестится как candidate-bound credit-eligible эпизод (`rsi-browser-outcome-ingest.mjs`, «one tool command = one experience case»).
- **Phase36:** в коде — схема `rsi-skill-exposure-release-review.v1` + `...transition-proof.v1` (runtime exposure review: environment_fingerprint, task_signature_digest, routing_context/retrieval_profile/memory_context/harness_integrity/benchmark_provenance дайджесты, matched-comparison + negative-transfer receipts); в тестах (`rsi-bounded-revision-devos-bridge.test.mjs:3841-3852`) — фаза `phase36.runtime.exposure-review`. Это **работающие верификаторы-библиотеки** (детерминированные, с zero-authority-инвариантами), но их вход — тесты/консоль оператора, а не самозапускающийся прод-триггер.
- **lifecycle CAS admission:** `rsi-revision-library-admission`, `rsi-revision-scope-admission`, `rsi-promotion-admission-gate` (CAS-гейт продвижения навыков), `rsi-held-skill-credit-admission`, `rsi-anytime-library-admission`.
- **one-attempt exposure release:** `rsi-skill-exposure-release-transition-proof.mjs` — переход release-состояния навыка доказывается ОДНИМ переходным proof'ом (digest-скреплённым), повтор невозможен.
- **lineage contamination gate:** `rsi-skill-lineage-contamination-review.v3` (PASS/FAIL/UNKNOWN предикаты поверх `rsi-lineage-provenance-acceptance`) — закупорка заражённых линий в верифицированном скилл-библиотеке.
- **Steering/консоль:** `rsi-operator-steering`, `rsi-operator-console` — оператор видит состояние и рулит; `rsi-command-plane-liveness-observer` — живость командной плоскости.

**Честная оценка:** RSI-контур в рельсе — **работающий детерминированный каркас** (runtime service реально стартует в main, ledger персистентен, trust-root из ~40 снапшотов валидируется при старте), но это **не самопишущийся код**: воспроизводящая эволюция (tournament→archive→admission) вырабатывает proposals/гейты, а физическое применение изменений остаётся за оператором/пайплайном (promotion gate = human/CI gate). Phase36/exposure/contamination — реальные модули в этом релизе (не «планы в ветках»), их full-scale прод-использование ограничено входом от тестов/консоли.

**Вердикт: РАБОТАЕТ как доказательно-эволюционный контур; прод-автоприменение — за гейтом (осознанный дизайн zero-authority).**

---

## 8. САМООБНОВЛЕНИЕ

**Файлы:** `src/self-update-runtime.mjs` (289, надстройка) → `self-update-runtime-v8.mjs` (482); `trusted-dev-release-resolver.mjs` (GitHub release rail PatrickFrome/Compute, API_ROOT/DOWNLOAD_ROOT, `parseMetaengineDevVersion` `\d+\.\d+\.\d+-dev\.\d+\.1`, bounded fetch, 2 ретрая листинга); `verified-download-manager.mjs`; `self-update-transaction-journal.mjs` (INSTALL_EFFECT_BARRIER); `self-update-old-parent-handoff.mjs` (watchdog); `self-update-successor-qualification/recovery/transaction-authority`; `self-update-bootstrap-recovery-classifier.mjs`; `browser-guardian-bootstrap-plan.mjs`; `browser-guardian-update-intake.mjs`; `scripts/verify-installed-guardian-native-staging.ps1` (стр. 17-67: staging manifest → SHA256 → **`verified-self-update-manifest.json`** в evidence); native `browser-guardian-scm/*`.

**Release rail механика:** двухфазный цикл — (1) дешёвый zero-authority hint (`dev-update-hint`, 15 мин `DEFAULT_CONTINUOUS_DEV_UPDATE_INTERVAL_MS`, retry 5 мин) → (2) single-flight exact discovery (8 с дедлайн) через trusted-resolver: точный dev-релиз, метадата+sha256/512 ассетов, инвариант `self_update_test_feed_not_allowed` (тест-фиды запрещены в проде). Install: `beforeInstallerLaunch` — **write-ahead барьер** `markSelfUpdateInstallEffectAttempted` (журнал-транзакция), затем arm `startSelfUpdateOldParentHandoffWatchdog` (read-only до доказанного SUCCESSOR_BOOTED; далее один relaunch-intent на транзакцию), затем финальный native handoff (Electron relaunch + SCM). **Откат/восстановление:** guardian `ROLLBACK_CANDIDATE` + bootstrap-recovery-classifier (классификация состояний при старте) + `self-update-quarantine-auth-heal-repair`, successor-receipt reconcile, session-continuity (restore сессии + клин только provable-дубликатов по `created_by_continuity_id`, tab-registry.mjs:18-24). Guardian actuator proof подписывается device-ключом с 10 полями (release_version/installer/manifest/installed_exe sha256, supervisor-device-identity.mjs:253-310) — нельзя подменить бинарную цепочку.

**Связи:** команда `SELF_UPDATE_CHECK/APPLY` — GLOBAL_MUTATION lane; статус — READ_ONLY (`SELF_UPDATE_STATUS`); heartbeat → `self_update`-плоскость state.

**Вердикт: РАБОТАЕТ** (полная цепочка hint→discover→verify→journal→handoff→qualify→rollback с durable-барьерами; Windows-специфика — через native SCM-сервис).

---

## 9. НАБЛЮДАЕМОСТЬ

| Механика | Файл | Что пишет/читает | Вердикт |
|---|---|---|---|
| State plane push | edge index.ts `upsertState` + PLANE_KEYS | 12 плоскостей (tabs, development_plane, compute, fleet, perception, supervisor_lifecycle, supervisor_mesh, self_update, host_resilience, realtime_process_plane, control_latency, rsi*) в `..._supervisor_state_h205f22.state` (jsonb, **per-plane shallow merge** — P1-2 fix, writers не стирают друг друга) + `last_seen_at` | РАБОТАЕТ |
| Agent observation plane | `agent-observation-plane.mjs` v1.0.0 | per-tab ring-буферы: console ≤64 (clip 500), network ≤64 (method/status/timing, без тел), health ≤16; единый трейс `SYSTEM_TELEMETRY`; read-only, metadata-only | РАБОТАЕТ |
| Bounded worker observer v2 | `bounded-worker-observer.mjs` | lifecycle-биндинги агентов (tab/target/epoch) → сигналы LOST/RETIRED/PROVISIONING_AMBIGUOUS, prefetch-наблюдение | РАБОТАЕТ |
| TAB_TELEMETRY / SYSTEM_TELEMETRY / READ_TRANSCRIPT | main.mjs (read lane) + lanes.mjs READ_ONLY | телеметрия вкладок/процесса/транскриптов через device-signed command plane | РАБОТАЕТ |
| Cognitive delta → edge | §6 | курсор-акки, zero-authority fences | РАБОТАЕТ |
| DevOS runtime observability | `devos-runtime-observability.test.mjs`, cycle-snapshot | last_artifact_record_reason / last_task_outcome_advance_reason, elastic_idle_cycles, budgets | РАБОТАЕТ |
| Self-update heartbeat telemetry | `self-update-heartbeat-telemetry.test.mjs` | snapshot в state-плоскость | РАБОТАЕТ |
| Mission Control | `metaengine-mission-control-projection.mjs` → `ui/app.js:1587` | проекция механик в UI | РАБОТАЕТ |

Всё, что «пишется в Supabase», идёт через 3 двери: state upsert (heartbeat ≤5 c), командная таблица (issue/lease/receipt), mesh-sync RPC + cognitive cursor. Ничего не пишется мимо device-аутентификации.

---

## 10. ГЛАВНОЕ — ЗАМКНУТЫЙ КОНТУР

### 10.1 Схема контура (по коду)

```
                     [Оператор / GitHub release rail / roadmap SQL]
                                        │ enqueue/admission (devos_fleet_enqueue, frontier admit)
                                        ▼
   ┌────────────────────────── PG (Supabase ref xpeibufgzjknrhbhpffp) ──────────────────────────┐
   │  devos_fleet_task/claim/event   supervisor_command (lanes CHECK)   device/enrollment/pairing │
   │  cognitive_cursor               supervisor_state (12 плоскостей)   mesh                        │
   └──────▲──────────────────┬──────────────────────────────┬───────────────────────▲─────────────┘
          │ RPC lease/mark/  │ TRIGGER glm_pulse_command     │ lease_batch_v1 /      │ mesh_sync,
          │ complete/verify  │ → NOTIFY glm_browser_pulse    │ result-batch/receipts │ cognitive_accept
          │                  ▼ (wake ≤сек)                  ▼                       │
   ┌──────┴───────────────────────────────── ELECTRON ГЛАВНЫЙ ПРОЦЕСС ─────────────────┴────────┐
   │ NativeSupervisorClient: cycle() → held wait-batch (≤15 c, delay=0 при SUPPORTED)           │
   │   → lane scheduler (EMERGENCY prio0 / READ_ONLY параллельно / TAB serial)                  │
   │   → executeCommand (CAPTURE/SEMANTIC_TYPE/NAVIGATE…) на вкладки чата агентов               │
   │   → result-batch receipts → readback                                                       │
   │ DevOS task cycle: lease(≤16) → dispatch на табы → mark-running(proof) → observeRunning      │
   │   → complete → [artifact + advanceTaskOutcomeFor] → memory block → следующий промпт         │
   │ Supervisor lifecycle: keepalive wake (60 c) → rollover (FRESH tab, DEFERRED auto-release    │
   │   15 мин) → mesh ≤16 (fenced reservation) → state push                                      │
   │ Cognitive bus: PROCESS/SEMANTIC/METRICS/SYSTEM → /v1/cognitive/deltas → курсор → brain      │
   │ Self-update: hint(15 мин) → exact discovery → journal barrier → installer → watchdog →      │
   │   successor qualification → (откат: guardian ROLLBACK)                                      │
   │ Tab registry: 28 fleet / 48 total → census → elastic governor (≤24 агентов, backlog-driven) │
   └────────────────────────────────────────────────────────────────────────────────────────────┘
          ▲ CrECH слои перезапуска: browser-sentinel (crash) → guardian SCM (Windows service,
            START/RESTART_EXACT_CHILD) → bootstrap-keepalive (восст. вкладок) → rollover (контекст)
```

**Вечный цикл существует и замкнут:** wait-batch (held) → lease → физический эффект в беседе агента → proof/readback → receipt → эпизод памяти → следующий промпт; при простое держится подписка wake; при рестартах — durable state (PG + журналы + ledger'ы); при переполнении контекста — rollover с новой беседой; при падении процесса — sentinel/guardian; при устаревании — self-update.

### 10.2 Разрывы и риски (топ)

| # | Разрыв | Где | Серьёзность | Митигция в коде |
|---|---|---|---|---|
| R1 | **Realtime wake — декор**: `sb_secret_*` не JWT → `REALTIME_ACCESS_TOKEN=''`, ветка realtime-command-wake мертва на обоих контурах | index.ts:15-21 | низкая | NOTIFY-прокси работает; фолбэк-поллинг есть |
| R2 | **Wake-триггеры — облачный ad-hoc артефакт**: миграции их дропают при пересоздании таблиц; в облаке не верify-able из репо | bootstrap/07-wake-triggers.sql:3-8 | **средняя** (при пересоздании таблиц в облаке — wake умрёт, останется 60-с поллинг) | задокументировано «применять после любых пересозданий» |
| R3 | **Нет браузерного enqueue задач**: `devos_fleet_enqueue_v1` — только SQL/оператор/meta-оркестратор. Пустой roadmap+frontier ⇒ флот idle (но цикл живой, keepalive не глохнет) | devos-routes.mjs (нет enqueue-роута) | средняя для «бесконечной автономии», by-design для zero-authority | meta superstep admit-task из roadmap |
| R4 | `approveRollover` не вызывается нигде (D-K8) | supervisor-lifecycle-runtime-core.mjs:1196 | низкая (закрыто) | 15-мин auto-release |
| R5 | **Pinned URL задублирован в 2 файлах без env-переопределения** — смена облака = правка кода + пересборка | native-supervisor-endpoints.mjs:1, native-supervisor-client-base.mjs:37 | средняя (ops) | единый ref сейчас корректен |
| R6 | **Память эпизодов и RSI ledger — локальные JSON-файлы** (userData): гибель диска/профиля = потеря когниции; в PG только курсоры/команды | browser-brain-episodic-memory, main.mjs:734-758 | средняя | durable-write + digest-инварианты |
| R7 | Edge недоступен (PG/сеть down): `cycle().catch(()=>{})` продолжает по интервалу; wake умирает; поллинг остаётся. **Дедлок лиз невозможен**: p_lease_timeout_seconds=120 → auto-expiry; reconcile-ambiguous требует readback, но never-retry без доказательства | index.ts:846-848, lease 120 с | низкая-средняя | bounded-поллинг, CAS-фенсинг, timeout-автолиз |
| R8 | wait-emergency смонтирован, но собственный клиент его не вызывает (для внешних операторских тулов) | emergency-routes.mjs:5 | низкая | основной контур ловит EMERGENCY в lease_batch (prio 0) |
| R9 | RSI promotion/self-update — гейты оператора: «полностью беспилотное» производство изменений ограничено zero-authority-дизайном | rsi-promotion-admission-gate | осознанный дизайн | evidence-gates, транзишн-пруфы |
| R10 | Mesh peer_health в облаке пуст (0 строк) — health-attestation 1.5 с таймаут часто не успевает | index.ts:48 | низкая | boundedRpc с деградацией |
| R11 | `MAIN` ветка GitHub дивергировала от rail (7 коммитов) — self-update rail берёт релизы, а не main | trusted-dev-release-resolver | ops-риск | rail = единственный источник |

**Что произойдёт при падении PG/сети:** wait-batch вернёт transport-ошибку → клиент молча перезапланирует цикл (интервал); все эффекты либо не начаты (no-effect), либо подтверждены receipts; лизы протухнут за 120 с; rollover/keepalive не зависят от PG; сам-update просто не найдёт hint. Восстановление — автоматическое, без деградации authority. Терминальные точки контура: ADMISSION_FENCED (оператор закрыл), DISARM/EMERGENCY OFF, и «нет задач в очереди» (idle, но живой).

---

## 11. КОНФИГ SUPABASE (pinned)

**Где задаются (файл + строки):**

| Что | Файл:строка | Значение |
|---|---|---|
| Pinned Supabase URL (edge base) | `src/native-supervisor-endpoints.mjs:1` | `https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1` |
| Pinned Supabase URL (клиент-плоскость) | `src/native-supervisor-client-base.mjs:37` | идентично (второй экземпляр) |
| Runtime-маршрутизация подписи | `src/native-supervisor-endpoints.mjs:2,13-20` | `NATIVE_SUPERVISOR_RUNTIME_PATH = '/a2-browser-native-supervisor-v1'`; подписывается canonical path |
| Workspace | edge `index.ts:22` | `2de9f84b-7c0a-4091-911c-894ff1d6eaf4` (WORKSPACE_ID) |
| Side ключи edge | edge `index.ts:13-21` | `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY/ANON_KEY` — env самой функции Supabase, НЕ в браузере |

**Как подключить установленный браузер к облаку ref `xpeibufgzjknrhbhpffp`:** он УЖЕ туда смотрит — pinned URL в двух константах совпадает с ref облачного METAENGINE_H205F22_RECOVERY. Ключей anon/service в клиенте **нет и не нужно**: каждый запрос аутентифицируется device-подписью (§5), edge создан с verify_jwt выключенным (единственные исключения — /health). Для смены облака/локального edge: заменить константу в **обоих** файлах (endpoints + client-base) и пересобрать (env-переменной нет — это разрыв R5). Для облака дополнительно нужен живой триггер `glm_pulse_command` (R2) — иначе wake только через DB-poll фолбэк. Функция edge в облаке разворачивается из `supabase/a2-browser-native-supervisor-v1/` (Deno; `npm:postgres@3.4.7`), ей нужны env `SUPABASE_DB_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

---

## ИТОГ

- **Каталогизировано ~25 механик в 11 областях; 21 работают, 1 декоративная (Realtime wake — с рабочим фолбэком), 3 с оговорками.** Ни одна не изолирована: каждая связана с durable-плоскостью (PG/журнал/ledger) и имеет потребителя.
- Замкнутый контур **существует и вечный**: enqueue/roadmap → lease → физический эффект с proof → receipt → память → следующий промпт, при перезапусках — durable recovery, при переполнении — rollover, при падении — sentinel/guardian, при устаревании — self-update.
- Главные дыры не в механиках, а в **опс-слое**: ad-hoc wake-триггеры в облаке (R2), отсутствие браузерного enqueue задач (R3), дублирование pinned URL без env (R5), локальность когнитивной памяти (R6).
- Pinned Supabase: `src/native-supervisor-endpoints.mjs:1` + `src/native-supervisor-client-base.mjs:37` → `https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1`; авторизация — только P-256 device-подписи.
