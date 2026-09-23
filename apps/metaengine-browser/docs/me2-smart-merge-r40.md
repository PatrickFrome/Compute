# ME2 ⇄ METAENGINE Browser — умное слияние (R40)

База: последний релиз **v0.7.0-dev.35655839197.1** (commit `71d0d42`, канал `release/self-update-ambiguity-live-v2`).
Принцип: **ничего не переписывать** — механизмы браузера остаются авторитетными, ME2 встраивается как
дочерняя плоскость (fail-open, zero-authority). Браузер = оболочка и наблюдатель флота; ME2 daemon = ядро
(постоянные чаты, пул, workgraph, evidence). Доставка обновлений — штатный self-update браузера
(`trusted-dev-release-resolver` → verified manifest → self-update-runtime-v8 + Guardian): слияние выезжает
как очередной dev-релиз, живые установки обновляются **изнутри**.

## Карта интеграции (модуль ME2 ↔ механизм браузера ↔ мост)

| Механизм Electron-браузера | Модуль(и) браузера | ME2-модуль | Мост R40 | Статус |
|---|---|---|---|---|
| supervisor-keepalive / crash sentinel | supervisor-keepalive.mjs, browser-sentinel.mjs | daemon (watchdog.sh, incarnation guard) | `me2-daemon-host.mjs`: spawn/adopt + health-probe + backoff-restart | ✅ R40 |
| fleet provisioner + elastic governor | fleet-provisioner*.mjs, fleet-elastic-governor.mjs | agentchat.ts (ceilings, roles, supervisor) | `me2-fleet-bridge.mjs`: FLEET_DIGEST/FLEET_MEMBER observation-строки | ✅ R40 |
| вкладки флота chat.z.ai (heritage) | tab-registry.mjs, chatgpt-session-monitor.mjs | agent_sessions (SQLite, постоянные) | вкладка-оболочка ME2 UI — флот теперь ВНУТРИ (чаты не теряют контекст) | ✅ R41 |
| Outcome river / cognitive delta bus | browser-cognitive-delta-bus.mjs, browser-cdp-outcome-latch.mjs | события AGENT_CHAT_* (hash-chain) | RIVER/OUTCOME_DEGRADED строки в stdout-шину | ✅ R40 |
| Ходы оператора во вкладку | native-supervisor-command-lanes.mjs | POST /agentchat op:turn | `me2ChatTurn()` (мост вкладка→чат) | ✅ R40 |
| Self-update изнутри | self-update-runtime-v8.mjs, verified-download-manager.mjs | — (ME2-раунды пушат merge-ветку) | push → CI autorelease → dev-релиз → браузер обновляется сам | ✅ R40 (доставка) |
| Guardian (host resilience) | browser-guardian-core.mjs, host-resilience-runtime.mjs | daemon watchdog | не тронут; daemon переживает рестарт браузера (killChild=false) | ✅ R40 |
| Brain (память/курсоры/фанаут) | browser-brain-*.mjs | memory.ts (E5 economy) | R42a: адаптер памяти me2-brain-adapter.mjs (brain checkpoint ⇄ /memory op:write + op:economy, sidecar) | ✅ R42 |
| Supervisor mesh | supervisor-mesh*.mjs | agentChatSupervisorTick | R42b: me2-supervisor-mesh-bridge.mjs — двусторонний (op:'mesh_heartbeat' ⇄ supervisor_tick), штатные epoch-фенсы bindCoordinationFence/assertCurrent | ✅ R42 |
| Mission Control UI | ui/app.js, tab-registry.mjs | ME2 UI (:3041/ui) | R41: вкладка через TabRegistry.create(role='SUPERVISOR') + по вкладке FLEET на ACTIVE чат (#chat=<id>) — браузер сам открывает чат-агентов прямо в сайте | ✅ R41 |

## Что в R40 реально в репозитории

1. `src/me2/me2-daemon-host.mjs` — хост daemon'а: adopt/spawn, health `/state`, экспоненциальный
   backoff, lifecycle-строки `metaengine.browser.me2.daemon-host.v1`.
2. `src/me2/me2-fleet-bridge.mjs` — мост флота: дайджест/участники/река/деградации + relay хода.
3. `src/me2/me2-integration-entry.mjs` — вход плоскости, will-quit.shutdown, глобальный статус.
4. `final-runtime-entry.mjs` — один аддитивный guarded-блок (env `ME2_INTEGRATION=0` выключает всё).
5. Все новые модули добавлены в `npm run check`.

## Гарантии

- probe/stdout-контракты не нарушены (в probe-режимах интеграция не стартует вовсе).
- Нет новых зависимостей; Node ≥24 (нативный fetch/AbortSignal уже используются браузером).
- Self-update authority не затронута: интеграция не читает и не пишет release-состояние.

## R41/R42 — доставка (ME2_INTEGRATION_VERSION = r41-r42-smart-merge-1)

**R41 — Mission Control (браузер сам открывает чат-агентов прямо в сайте):**
1. `tab-registry.mjs` — аддитивно роль `SUPERVISOR` (`TAB_ROLES += SUPERVISOR`,
   отдельный потолок `A2_SUPERVISOR_TAB_CEILING` (default 4, не ест FLEET-квоту и
   пользовательскую бронь); census — честные счётчики по ролям + SUPERVISOR-поля).
2. `src/me2/me2-fleet-tabs-host.mjs` — узкая capability main.mjs → ME2-плоскость
   (registry census + createTab; регистрируется одним guarded-вызовом в main.mjs;
   без хоста — честный DEGRADED).
3. `src/me2/me2-mission-control.mjs` — сверка «флот daemon'а ⇄ вкладки браузера»:
   одна вкладка `TabRegistry.create(role='SUPERVISOR')` → `ME2_UI_URL` (default
   `http://127.0.0.1:3041/ui` — самодостаточная страница Mission Control самого daemon'а);
   по вкладке `role='FLEET'` на каждый ACTIVE чат (`#chat=<id>` — сайт открывает агента сам);
   чат закрылся → вкладка закрывается; вкладку снаружи закрыли → churn-лимит (без шторма).
4. daemon: `GET /ui` — самодостаточная Mission Control (флот/река/ход оператора/#chat),
   0 сборки и внешних зависимостей; loopback LOCAL_DEV разрешён штатной политикой браузера.

**R42a — память brain ⇄ mem-economy:** `src/me2/me2-brain-adapter.mjs` — читает
durable-checkpoint мозга (тот же файл/лимит 32MB), честный дельта-хеш (stable stringify),
ограниченная проекция → `POST /memory {op:'write', key='brain:browser:<hash8>'}` (дедуп по
ключу в daemon'е); обратно — `POST /memory {op:'economy', consumer='browser-brain'}`
(sticky+fresh+familiar E5) → атомарный sidecar в userData (tmp+rename, 0600) для
потребителей мозга. Ноль записи в checkpoint мозга (read-only), fail-open.

**R42b — двусторонний supervisor-mesh ⇄ agentChatSupervisorTick:**
`src/me2/me2-supervisor-mesh-bridge.mjs` — читает состояние mesh (файл состояния
SupervisorMeshRuntime в userData), строит ШТАТНЫЙ фенс `bindCoordinationFence`
(supervisor-mesh-epoch-fence.mjs), проверяет актуальность `assertCoordinationFenceCurrent`
(устаревшая эпоха → FENCE_STALE, ход не уходит), и стучится в daemon:
`POST /agentchat {op:'mesh_heartbeat', mesh_epoch, coordinator, supervisors, fence}`;
daemon отвечает `supervisor_tick` (последний тик agentChatSupervisorTick) — мост
публикует `DAEMON_SUPERVISOR_TICK` в stdout-шину (наследие outcome river).
Daemon-сторона: op mesh_heartbeat (meta mesh_last_heartbeat + событие MESH_HEARTBEAT
в hash-chain, честная метка mesh_epoch_advanced), тики супервизора пишутся в
meta supervisor_tick_last и отдаются в GET /agentchat.

**Проверки daemon (eval v16, PASS 47/47):** `mission.ui_contract` (самодостаточность
Mission Control UI) и `mission.mesh_tick` (meta-контур тика/mesh читаем, fence-контракт).

