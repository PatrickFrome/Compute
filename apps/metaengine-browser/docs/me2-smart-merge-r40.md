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
| вкладки флота chat.z.ai (heritage) | tab-registry.mjs, chatgpt-session-monitor.mjs | agent_sessions (SQLite, постоянные) | вкладка-оболочка ME2 UI — флот теперь ВНУТРИ (чаты не теряют контекст) | 📍 R41 |
| Outcome river / cognitive delta bus | browser-cognitive-delta-bus.mjs, browser-cdp-outcome-latch.mjs | события AGENT_CHAT_* (hash-chain) | RIVER/OUTCOME_DEGRADED строки в stdout-шину | ✅ R40 |
| Ходы оператора во вкладку | native-supervisor-command-lanes.mjs | POST /agentchat op:turn | `me2ChatTurn()` (мост вкладка→чат) | ✅ R40 |
| Self-update изнутри | self-update-runtime-v8.mjs, verified-download-manager.mjs | — (ME2-раунды пушат merge-ветку) | push → CI autorelease → dev-релиз → браузер обновляется сам | ✅ R40 (доставка) |
| Guardian (host resilience) | browser-guardian-core.mjs, host-resilience-runtime.mjs | daemon watchdog | не тронут; daemon переживает рестарт браузера (killChild=false) | ✅ R40 |
| Brain (память/курсоры/фанаут) | browser-brain-*.mjs | memory.ts (E5 economy) | R41: адаптер памяти (episodic ⇄ mem-economy) | 📍 R41 |
| Supervisor mesh | supervisor-mesh*.mjs | agentChatSupervisorTick | R42: двусторонний mesh (epoch-фенсы) | 📍 R42 |
| Mission Control UI | ui/app.js | ME2 UI (:81/:3000) | R41: вкладка ME2 UI через TabRegistry.create(role='SUPERVISOR') | 📍 R41 |

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
