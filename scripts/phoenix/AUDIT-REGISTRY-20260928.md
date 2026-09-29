# METAENGINE BROWSER/DEVOS — CONVERGENCE AUDIT REGISTRY (gen20260928-0740)

Mandate: PRINCIPAL-DIRECTIVE.md (sha256 0aa0957922d0f9d65296e4038b160887eaf85fd517cf8650ca365e75e556f739)
Runtime identity: live client 2a60d6a2-c7c2-4dcc-b4c9-99de768443c9 · v0.7.0-dev.36336130139.1 · supervisor_mode=CONTROL · armed=true · authority_effect=true · workspace 2de9f84b
Evidence: AUDIT-20260928-0631 (phases E–J), BROWSER-TEST-t0700 (phases R/M/A, 2026-09-28), worklog BROWSER-TEST-*/FLEET-*/UI-AUDIT-*/AUDIT-* sections.
Rule: ровно один вердикт на механику; UNKNOWN запрещён.

## 1. REGISTRY — 48 IMPLEMENTED MECHANICS

| Mechanism | Purpose | Used? | Connected? | Duplicate? | Cost | Evidence | Verdict | Action |
|---|---|---|---|---|---|---|---|---|
| POLL | batch completion primitive | yes | yes | no | ~3.5s/call | R/M/E cycles ×20+ | KEEP | canonical completion path |
| CAPTURE | semantic perception (tree+targets+url) | yes | yes | no | 3.3–6s; LEASED-hang 55s под budget | R01,M02,M04,A10×N | KEEP+FIX | добавить lease-watchdog + retry-once после RELOAD |
| CAPTURE_VIEW | viewport screenshot | rarely | partial | да (CAPTURE покрывает) | geometry-coupled | E-phase probe | QUARANTINE | исключить из runtime-контура (geometry ban #4) |
| CONTROL_CAPABILITIES | contract introspection | yes | yes | no | 5.4s | R01 ×2 | KEEP | — |
| PROCESS_CENSUS | process plane inventory | yes | yes | no | 7.0s | R06 ×2 | KEEP | — |
| PROCESS_EVENTS | process event stream | yes | yes | no | ~5s | E-phase | KEEP | — |
| SEMANTIC_CENSUS | semantic plane stats | yes | yes | no | ~4s | F09 | KEEP | — |
| SEMANTIC_EVENTS | semantic event log | yes | yes | no | ~4s | E-phase | KEEP | — |
| CONTROL_LATENCY_STATUS | fast-lane latency stats | yes | yes | no | 3.6s | R10 | KEEP | источник p50/p95/p99 (#13) |
| TAB_TELEMETRY | per-tab observation | yes | yes | no | ~4s | E-phase | KEEP | — |
| SYSTEM_TELEMETRY | host telemetry | yes | yes | no | 6.4s | R05 ×3 | KEEP | drill-down surface only (#9) |
| READ_TRANSCRIPT | conversation readback | yes | yes | no | 3.5s | B02,M11,S06,AG6 | KEEP | canonical result readback |
| TAB_CENSUS | tab inventory by kind/role | yes | yes | no | 4.8s | R02 ×3 | KEEP | — |
| FLEET_STATUS | fleet+policy state | yes | yes | no | 3.7s | R03 ×3 | KEEP | — |
| DOWNLOAD_STATUS | downloads state | attempted | yes | no | LEASED-hang 55.8s без терминала | R08 | FIX | lease-watchdog; иначе REMOVE |
| DEV_PLANE_STATUS | dev-plane state | yes | yes | no | 3.6s | R09 ×2 | KEEP | release-path visibility (#12) |
| DEV_PLANE_HEALTH | dev-plane health | yes | yes | no | ~4s | F06 | KEEP | — |
| DEV_PLANE_CAPABILITIES | dev-plane flags | yes | yes | no | ~4s | F07 | KEEP | settings-audit источник |
| DEV_PLANE_PROCESS_METRICS | dev-plane perf | attempted | yes | no | ~4s | E-phase | KEEP | — |
| DEV_PLANE_REPO_HEAD | repo identity | attempted | yes | no | ~4s | E-phase | KEEP | source-of-truth identity |
| SELF_UPDATE_STATUS | update runtime state | yes | yes | no | 3.6s | R07 ×3 | KEEP | — |
| GATE_STATUS | safety gates snapshot | yes | yes | no | 3.6s | R04 ×3 | KEEP | owner-visibility |
| STOP_GENERATION | stop active generation | attempted | yes | no | err=native_glm_stop_requires_semantic_ref_button | E,S04 | FIX | нужен semref stop-кнопки; тест с активной генерацией |
| SCROLL | page scroll | yes | yes | no | CDP deadline 30s / LEASED-hang | M09 ×3 | FIX | cdp deadline не архитектурен; repair или REMOVE |
| SEMANTIC_FOCUS | focus element by semref | yes | yes | no | fence AMBIGUOUS на дубликатах | UI-AUDIT-0610 | KEEP+FIX | дедуп-стратегия fence |
| SEMANTIC_TYPE | type+submit text | yes | yes | no | replace_unverified (clean draft); AMBIGUOUS_AFTER_ENTER | M03,M21 ×5 | KEEP+FIX | пост-условие: transcript/url readback вместо url-sha на / |
| TYPED_CLICK | semantic click | yes | yes | RPC v3 validator сломан (false reject) | COMPLETED через INSERT ×4 | J3,M14,CLICK-* | KEEP+MERGE | канонизировать INSERT-путь (DB-trigger validation), RPC v3 sync |
| SELECT_TAB | select active tab | yes | yes | no | 6.2s | C03,M10 ×3 | KEEP | — |
| PRESS_KEY | key dispatch | yes | partial | да (внутри SEMANTIC_TYPE native chain) | target=null swallowed | C06,C32 | MERGE | поглотить в SEMANTIC_TYPE/KEY_PRESS(next); standalone закрыть |
| CLOSE_TAB | close tab | yes | yes | no | 9× cleanup | FLEET-0605 | KEEP | hygiene |
| NAVIGATE | URL navigation | yes | yes | no | postcondition AMBIGUOUS on same-URL | M05 ×2 | KEEP+FIX | same-URL = NOOP-success, не AMBIGUOUS |
| BACK | history back | yes | yes | no | NO_EFFECT_PROVEN на свежем табе (корректно-консервативно) | M07,E-phase OK | KEEP | — |
| FORWARD | history forward | yes | yes | no | аналогично BACK | M08 | KEEP | — |
| RELOAD | tab reload | yes | yes | no | 3.5s; лечит деградировавший CAPTURE | M06 ×3 | KEEP | canonical healer |
| ARM | authority on | yes | yes | no | authority_effect=true ×3 | D,E,ARM-0605 | KEEP | вечный супервизор |
| DISARM | authority off | blocked | n/a | n/a | 23514 always-on contract | E-phase | QUARANTINE | конституционный запрет — by design; не в runtime |
| SET_SUPERVISOR_MODE | mode control | yes | yes | no | LEASED-hang при budget | E,F01 | KEEP+FIX | lease-watchdog |
| NEW_TAB | tab/agent-cell birth | yes | yes | no | 23.3s cold | C01,M01 ×6 | KEEP | canonical agent-cell creator |
| FLEET_RECONCILE | fleet to target | yes | yes | no | backlog-driven model | C11,D02 ×3 | KEEP | growth lever |
| FLEET_SET_PROFILE | fleet policy profile | yes | yes | no | BALANCED set | FLEET-0605 | KEEP | — |
| DOWNLOAD_FILE | verified download | attempted | yes | no | verified_download_filename_invalid→sha256_required ×2 | E,J | QUARANTINE | install_authority=false; манифест недокументирован |
| DOWNLOAD_CANCEL | cancel download | no | yes | no | untested (нет активных загрузок) | — | QUARANTINE | пара к DOWNLOAD_FILE |
| SELF_UPDATE_CHECK | feed check | yes | yes | no | CURRENT; hint<current | D04,F05 ×3 | KEEP | — |
| SELF_UPDATE_APPLY | apply update | yes | yes | no | EXPIRED lease_timeout_no_retry; no-op при CURRENT (безопасно) | E | KEEP+FIX | lease-watchdog |
| GATE_DISABLE | disable gate | blocked | n/a | n/a | id_invalid (пустой override-список) | F04 ×2 | QUARANTINE | owner-plane only; autonomy loop не должен зависеть от снятия гейтов |
| GATE_DISABLE_ALL | disable all gates | blocked | n/a | n/a | owner override required | — | QUARANTINE | как GATE_DISABLE |
| GATE_ENABLE | enable gate | no | yes | no | зеркален GATE_DISABLE | — | KEEP | owner-plane (включение — безопасно) |
| GATE_ENABLE_ALL | enable all gates | no | yes | no | зеркален | — | KEEP | owner-plane |

Итог: KEEP 27 · KEEP+FIX 9 · FIX 4 · MERGE 2 · QUARANTINE 6 (CAPTURE_VIEW, DISARM*, DOWNLOAD_FILE, DOWNLOAD_CANCEL, GATE_DISABLE, GATE_DISABLE_ALL — *конституционные by design) · REMOVE 0 (в implemented-слое; снятия требует координационная плоскость, см. §3).

## 2. ROADMAP («next», 21) — классификация ДО внедрения

| Mechanism | Verdict | Rationale |
|---|---|---|
| KEY_PRESS (CDP_INPUT) | INTEGRATE | закрывает дыру PRESS_KEY; требовать semantic target |
| POINTER_CLICK | REMOVE | geometry (fence CAPTURED_VIEWPORT_AND_TAB) — запрещено #4 |
| DRAG | REMOVE | geometry — запрещено #4 |
| SET_ZOOM | REMOVE | geometry/DPI — запрещено #4; 23514 подтверждает gate |
| DUPLICATE_TAB / MOVE_TAB / PIN_TAB / MUTE_TAB | QUARANTINE | hygiene nice-to-have, не в loop |
| SEARCH_WEB | INTEGRATE | research-агентам (#1.7) |
| FIND_IN_PAGE | QUARANTINE | низкая ценность при семантической плоскости |
| SESSION_STATUS | QUARANTINE | телеметрия session без consumer |
| SET_SITE_PERMISSION / SET_PROXY / CLEAR_SITE_DATA | QUARANTINE | operator-level, не autonomy |
| WEBMCP_LIST / WEBMCP_INVOKE | QUARANTINE | чужая экосистема, unproven |
| CHATGPT_STATUS / CHATGPT_* (5) | REMOVE | чужая платформа, анти-паттерн #3 |

## 3. COORDINATION PLANE (Supabase) — CONVERGENCE

261 таблиц / ~90 RPC. Обнаружено ≥6 ДУБЛИРУЮЩИХ scheduler/task/authority-плоскостей:

| Plane | Objects | Verdict | Action |
|---|---|---|---|
| browser supervisor command/state/lease/complete | enqueue_v1/v2/v3, complete_v4/v5, lease_v1/v2/v3, batch, bootstrap, control_v4, emergency | KEEP+MERGE | канон: enqueue_v3 + INSERT-путь, complete_v5, lease_batch_v1; v1/v2/v4 + legacy → QUARANTINE после migration |
| devos_fleet_* | enqueue v1+legacy, lease v1+legacy, complete, reconcile v1+ambiguous_v2, snapshot, capacity, transport_promotion ×2 | MERGE | один canonical fleet governor; legacy-варианты → REMOVE после consumer-search |
| meta_orchestrator_* | controller_lease, task_admit | MERGE | слить в canonical task plane |
| metaengine_federation_* | claim/release/seed/get/dependencies | MERGE | кандидат на canonical task/claim lifecycle (federation seed_task = backlog-питание) |
| aop1_* | lease_run, reap_expired, adopt, rearm, return_authority | MERGE | cycle-recovery роли → в canonical governor |
| duel_* | lease, lockstep v2/v3, peer_relay v4 | QUARANTINE | peer-relay эксперименты; direct_peer_messaging=false подтверждает не-использование |
| mesh_* | register/sync v1+legacy, heartbeat | KEEP | identity/heartbeat роя |
| cognitive_* | accept_v1, cursor (403 для роли) | FIX | RBAC: роль координатора без SELECT на cursor — мёртвый контур; дать grant или REMOVE |
| chat_bridge_remote_command | bridge plane | QUARANTINE | если consumer не доказан |

REMOVE ledger (плоскостной, до исполнения: consumer search → migration → regression → physical proof):
1. enqueue_v1/v2, complete_v4, lease_v1/v2, *_legacy RPC — replacement: enqueue_v3/INSERT + complete_v5 + lease_batch_v1.
2. duel_* peer-relay v4 — replacement: mesh heartbeat + federation claims.
3. Pointer-механики roadmap — replacement: semantic_ref execution path.
4. CHATGPT_* — replacement: отсутствует (чужая платформа, вне контура).

## 4. SETTINGS AUDIT (достижимая из command-plane поверхность)

| Setting/Flag | Reader | Writer | Effect | Restart | Test | Product effect | Verdict |
|---|---|---|---|---|---|---|---|
| supervisor_mode (OFF/OBSERVE/CONTROL) | state table, governor | SET_SUPERVISOR_MODE | actuation authority | сохраняется (LEASED) | ARM-цикл ×3 | прямой | KEEP |
| armed/authority_effect | governor | ARM | mutating dispatch | durable | ×3 | прямой | KEEP |
| fleet policy: max_agents=null, hard_agent_cap=null, profile=BALANCED, burst=8, ELASTIC_BACKLOG_DRIVEN | FLEET_PROVISIONER | FLEET_SET_PROFILE/RECONCILE | масштабирование | durable | ×3 | прямой | KEEP — соответствует #10 (нет искусственных лимитов) |
| supervisor_action_budget 24pts/60s (mutation=4pts) | command scheduler | owner-plane (не механика) | throttling, LEASED-hang при давлении | durable | R/M наблюдения | КОСВЕННЫЙ — главный тормоз бутстрапа роя | FIX (owner): поднять/сделать adaptive backpressure (#10), это ЕДИНСТВЕННАЯ настройка, чьё изменение разблокирует масштабирование |
| automatic_install=true (self-update) | TRUSTED_UPDATER | build config | авто-обновление | durable | SELF_UPDATE_CHECK ×3 | прямой | KEEP |
| direct_peer_messaging=false | mesh | build config | peer-канал роя выключен | durable | capabilities ×3 | рой координируется только через Supabase | FIX (owner): включить после доказательства mesh |
| automatic_work_retry=false | governor | build config | авто-повтор задач | durable | capabilities ×3 | анти-blind-retry согласен с #4/#19 | KEEP (false корректно) |
| install_authority=false (downloads) | VERIFIED_DOWNLOAD | build config | блок DOWNLOAD_FILE | durable | E/J ошибки | согласен с sandbox-моделью | KEEP |
| 15 registered gates (OWNER_AUTHORITY) | OWNER_GATE_REGISTRY | owner only | fail-close safety | durable | GATE_STATUS ×3 | safety-инфраструктура (#1) | KEEP — не мешают легальному контуру, снимаются только owner-override |
| cognitive_cursor RBAC (403) | Supabase RLS | operator | coordinator не читает cursor | — | probe | мёртвый контур для нас | FIX: grant или REMOVE |

## 5. ANTIPATTERN FINDINGS (проверка #7)

- два+ scheduler: подтверждено (§3, ≥6 плоскостей) — главный источник сложности.
- две authority plane: командная (Supabase command) + owner-gate registry — допустимо (safety), но GATE_* без override недостижимы и потому «декоративны» для runtime: документировать как owner-only.
- несколько способов создать агента: два — (a) chat-рецепт NEW_TAB→SEMANTIC_TYPE(submit) (проверен ×3), (b) Agent-tab путь (в проверке). После доказательства (b) — канонизировать его, chat-путь оставить как fallback-worker surface, НЕ как agent-creation.
- polling где есть event-driven: PROCESS_EVENTS/SEMANTIC_EVENTS уже стримят; CONTROL_LATENCY показывает fast-lane — правомерно.
- URL/title guessing: не обнаружен (все пути semantic).
- selected-tab-as-authority: не обнаружен (все команды tab_id-таргетны) — соответствует #4.
- таймерные retry после ambiguous: НЕ обнаружены в браузере (AMBIGUOUS фиксируется, blind retry отсутствует) — соответствует #19.
- duplicate persistence: worklog+vault+Supabase+shards — 4 канала одного журнала (осознанный phoenix-дублизм, reduce не требуется: это recovery-кворум, а не state duplication).

## 6. TARGET ARCHITECTURE MAP (конечный контур)

USER GOAL → SUPERVISOR (CONTROL, armed, вечный) → PLANNER (decomposition в federation tasks) → AGENT POOL (ELASTIC_BACKLOG_DRIVEN, BrowserCell=tab/агент, reuse+queueing) → Z.AI AGENT UI (canonical: sidebar→Agent→New Task→task→readback; chat = fallback) → BROWSERCELLS (CAPTURE/SEMANTIC_*/TYPED_CLICK INSERT) → BRAIN/MEMORY (federation results + lessons; retrieval в planner brief) → WORKSPACE/DEVOS (dev-plane visibility; сборка — operator pipeline) → TEST/CRITIC (critic-агенты; STOP/RETRY policy без blind retry) → VEF (effect readback: transcript/url/census) → RELEASE (SELF_UPDATE feed; operator installer) → NEXT CYCLE (15-min directive loop, cron 419718).

## 7. OPEN PHYSICAL GAPS (честно, без статусов «зелёный по наследству»)

1. Agent-tab E2E — выполняется в фоне (pid 26495); до COMPLETED-транскрипта контур «агент через Agent» не закрыт.
2. Rebuild/installer/CI — недоступны из песочницы (Windows-пайплайн оператора); фиксируется как operator-stage, не как отсутствие механизма.
3. budget 24/60s — физический предел параллельного бутстрапа; требует owner-изменения.
4. peer-mesh (duel/peer_relay) — не проверен end-to-end.
5. STOP_GENERATION — не проверен с активной генерацией.
