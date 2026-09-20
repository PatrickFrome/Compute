# Live-масстест браузера v0.7.0-dev.35156994273.1 — интерим-отчёт #1
**Дата**: 2026-09-17, 04:48–05:40 UTC | **Оператор тестов**: GLM_LIVE_TEST_OPERATOR | **Клиент**: 2a60d6a2

## 1. Завершение цепочки обновления — ВСЁ ПОДТВЕРЖДЕНО ✅

| Механика | Результат live-проверки |
|---|---|
| Версия | `0.7.0-dev.35156994273.1` (shell_version), boot 04:48:33 UTC |
| Self-update журнал R5 (txn 7c7e48b3) | **SUPERSEDED** (inspectSelfUpdateStartup cmp>0 — расчётное заживление сработало) |
| Self-update состояние | **CURRENT**, last_error=null, last_check 04:48:53 — дедлок SUCCESSOR_BOOTED излечен, транзакция само-квалифицировалась (F1–F4 работают) |
| Sentinel 1.6.1 | ARMED, worker HEALTHY, parent_pid 12184 / worker_pid 23688, без crash-loop (reconcile 76070eb6 работает) |
| Host resilience | ACTIVE (v7) |
| Fleet | 7 агентов созданы при boot 04:48:59 (PLANNER×2, RESEARCHER, IMPLEMENTER, CRITIC, FALSIFIER, SYNTHESIZER) — все BOUND_UNVERIFIED |
| Keepalive R6 fence | **predecessor_fenced_at = 04:48:35.789Z** — мультихоп-барьер сработал при boot; pending wake_810f ещё не retired (ожидает цикла) |
| Pulse-триггеры | glm_pulse_{state,command,mesh} живы |
| Dev-plane | READY (pid 9804), DEVOS_REPO_READ_MODEL SUCCESS, repo head = 2b8b4b4e (точное соответствие релизу) |
| Realtime observation push | true, поток SEMANTIC_EVENT (seq до 10206) |
| Транспорт-идентичность | A2_DEVICE_HTTP_SIGNATURE_V1, device_id 45ad481a |
| Fast-lane планировщик | v3, max_batch 64, read_concurrency 128, mutation_concurrency 8, pressure GREEN |

## 2. Батарея команд (до обнаружения дефекта)

**Read-only — 11/11 COMPLETED** (latency 3.3–11.5s):
POLL 5152ms, CAPTURE 3500ms, CAPTURE_VIEW 3528ms, DOWNLOAD_STATUS 11526ms, DEV_PLANE_STATUS 3293ms, DEV_PLANE_HEALTH 3292ms, DEV_PLANE_CAPABILITIES 4932ms, DEV_PLANE_PROCESS_METRICS 3289ms, DEV_PLANE_REPO_HEAD 4932ms, SELF_UPDATE_STATUS 3288ms, + повторные. Все с receipt v2, lane=READ_ONLY, authority_effect=false.

**Контракт allowlist — 12/12 корректных отказов на issue** (`native_supervisor_action_invalid`):
CONTROL_CAPABILITIES, PROCESS_CENSUS, PROCESS_EVENTS, SEMANTIC_CENSUS, SEMANTIC_EVENTS, CONTROL_LATENCY_STATUS, TAB_CENSUS, FLEET_STATUS, GATE_STATUS, RESOLVE_PROMPT, BOGUS_ACTION_LT — **ровно те действия, у которых в control-actions-manifest `generic_issue_v1=false`**. Fail-closed выдача соблюдена точно по контракту манифеста. (Эти действия тестируются через direct-INSERT — корневой путь, в следующей серии.)

**Негативные контракты**:
- CAPTURE с bogus tab_id → FAILED `native_supervisor_target_view_unavailable` за 16.4s — fail-closed подтверждён ✅

## 3. 🚨 КРИТИЧЕСКИЙ ДЕФЕКТ L1: полный wedge командного плана

### Симптом
- SCROLL d5d24937 (tab f6e1e267, effect-binding sealed) — LEASED с **05:09:48** и не завершается (>30 мин)
- После этого **НИ ОДНА команда не подхватывается** — ни мутации, ни read-only (probe SELF_UPDATE_STATUS: PENDING 75s, не leased)
- При этом heartbeat жив (3–6s), perception свежий (каждые ~5s), CDP-пул отвечает, edge-function сервер отвечает (401 на unsigned probe за 1.5s) — **зомби-супервизор: жив, но неконтролируем**

### Доказательная цепочка (по данным + исходникам 2b8b4b4e)
1. `leased_at 05:09:48.211`, `effect_bound_at 05:09:49.879` — claim и запечатывание effect-intent прошли
2. `last_command` проекция заморожена на 05:09:45 (последняя обработанная = FAILED CAPTURE bogus) — цикл обработки команд умер сразу после
3. `one_steady_state_lease_loop: true` — единый цикл claim→execute→post-result; `#runCommand` awaited inline → **одна зависшая команда замораживает весь цикл**
4. Необорванные await в терминальном пути команды:
   - `createBoundedSupervisorFetch`: `if (isCommandResultUrl(url)) return fetchImpl(url, init)` — **POST `/v1/commands/{id}/result` намеренно без AbortController/дедлайна** (комментарий: «DB completion state/readback is the reconciliation boundary»)
   - CDP `Input.dispatchMouseEvent` / `Page.getLayoutMetrics` — Electron debugger.sendCommand **без тайм-аута**
5. Edge-function жива (heartbeat через неё же проходит каждые 3–6s) → висит конкретное соединение (black-hole) либо CDP-ack — в обоих случаях await бесконечен
6. TTL lease (180s, истёк 05:12:46) **не восстанавливает** — server-side expiry обрабатывается при новых claim-попытках, а их нет
7. Watchdog-слепота: все сторожевые собаки смотрят heartbeat-staleness — heartbeat жив → никто не сработает

### Класс дефекта
Liveness/самовосстановление: unbounded await + сериальный цикл = потеря управления всем командным планом при одной зависшей команде. Маскируется живым heartbeat.

### Дизайн фикса (для следующего релиза)
- **F-L1a**: обёртка CDP sendCommand с пер-командным дедлайном (~15–30s) → fail `native_supervisor_cdp_deadline`
- **F-L1b**: result-POST: ждать с щедрым дедлайном (~120s); по истечении — фоновые bounded-ретраи (бюджет F7) **без блокировки claim-цикла** (DB — граница reconciliation, соответствует собственной философии комментария)
- **F-L1c**: watchdog возраста in-flight команды: lease-execution > TTL → отказ client-side, цикл продолжает работу
- **F-L1d**: наблюдаемость: в heartbeat-state выставлять last_claim_at / in-flight command age — детектируемость состояния «жив-но-неконтролируем»

### Восстановление сейчас
Только перезапуск процесса браузера (внутренних путей нет: командный план мёртв, self-update CURRENT, sentinel не сработает — процесс жив).

## 4. Пассивные плоскости во время wedge (окно 45s, 05:36)
- Heartbeat: 3–6s стабильно ✅
- Perception: обновляется каждые ~5s ✅ (CDP-пул жив)
- Поток SEMANTIC_EVENT: остановился в 05:24:52 (пассивные DOM-события ответов LLM завершились; события на tab_a7e1a904/7e074215/webcontents:8)
- Keepalive: WAKE_AMBIGUOUS, wake_810f pending (retirement не произошёл — требует рабочих циклов)
- Fleet: 7×BOUND_UNVERIFIED, transport_proof=false у всех — стадия каскада [4] не достигнута (требует рабочего командного плана / DevOS циклов)

## 5. Что дальше (после перезапуска браузера)
1. Верификация восстановления: version/self_update не слетели, wedge-команды подметаются в EXPIRED первым claim-циклом
2. Полная батарея заново: read-only + мутации (SCROLL/SEMANTIC_FOCUS/SELECT_TAB/NEW_TAB/RELOAD/NAVIGATE/CLOSE_TAB/BACK/FORWARD)
3. Группа D: ARM/FLEET_RECONCILE/SELF_UPDATE_CHECK/SELF_UPDATE_APPLY (F5-верификация: чистый отказ без отравления)
4. Группа E: координация SEMANTIC_TYPE+TYPED_CLICK (composer+send)
5. Root-policy действия через direct-INSERT: TAB_CENSUS, FLEET_STATUS, GATE_STATUS, PROCESS_CENSUS, SEMANTIC_CENSUS, CONTROL_LATENCY_STATUS
6. Стресс 60+ команд, каскад разблокировки, F7-проверки
7. Отчёт финальный + PR с фиксами L1 (F-L1a..d)
