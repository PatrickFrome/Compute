# ME2 ⇄ METAENGINE Browser — умное слияние R49 (фаза A: контрактная сверка)

База: release-мейнлайн после R40/R41/R42 (PR #948/#949). Принцип прежний:
**браузерные механизмы авторитетны, ME2 — дочерняя плоскость (fail-open, zero-authority)**.
R49 не переписывает ни один механизм — он чинит контрактный дрейф, вскрытый аудитом
(`docs/electron-rebuild-plan.md` в ветке `sandbox/me2-os`, риски K1/K3/K8).

## Что сломалось (честно)

Daemon v0.40+ снял REST-операции флота (единственная поверхность — socket.io
`agentchat:op` c ack), а мосты R40-R42 шлут `POST /agentchat {op:'turn'}` и
`{op:'mesh_heartbeat'}` → против v0.41 это честный 404. Также в daemon отсутствовали
`mesh_heartbeat` и `GET /ui`, заявленные R41-доком. Аудит зафиксировал: 3 из 7 мостов
неработоспособны против v0.41, brain-adapter и daemon-host совместимы.

## Что сделано в R49 (обе стороны)

**Daemon (sandbox/me2-os, v0.42.0, eval v18 53/53):**
1. `CONTRACT_VERSION = me2-daemon-contract.v1` + capabilities в `GET /state`
   (`withContract()`, аддитивно; аналогия — LSP initialize / MCP capabilities).
2. Op `mesh_heartbeat` на socket-поверхности `agentchat:op`: meta
   `mesh_last_heartbeat`/`mesh_epoch_last` (персистентны), событие `MESH_HEARTBEAT`
   в hash-chain, `mesh_epoch_advanced` честно, в ответе `supervisor_tick`
   (meta `supervisor_tick_last`, теперь пишется каждым тиком).
3. `GET /ui` — самодостаточная Mission Control (12.7KB, 0 сборки, 0 внешних
   зависимостей): флот/река/ход оператора/#-чат; socket-клиент берётся с самого
   daemon'а; gateway-адаптация (XTransformPort) для проверки через гейт :81.
4. eval v18: `contract.handshake`, `mission.ui_contract`, `mission.mesh_tick`.

**Браузер (этот PR):**
1. `src/me2/me2-socket-client.mjs` — ЕДИНСТВЕННАЯ новая зависимость shell
   (`socket.io-client` ^4.7.5, как договорено в плане): lazy-singleton, честный
   ack-таймаут, машинные коды ошибок, fail-open, zero-authority.
2. `me2-fleet-bridge.mjs`: ход (`me2ChatTurn`) — socket `agentchat:op` op:'turn'
   (TURN_RELAYED/TURN_REJECTED/TURN_RELAY_FAILED — честные исходы, без ретраев-штормов).
3. `me2-supervisor-mesh-bridge.mjs`: heartbeat — socket op:'mesh_heartbeat'
   (оба имени координатора — совместимость R41/R49), фенсы не тронуты.
4. `me2-integration-entry.mjs`: **capabilities-handshake** до стартов мостов —
   `GET /state` → сверка `contract`/`mesh_heartbeat`/`ui`; ME2_CONTRACT_OK /
   ME2_CONTRACT_MISMATCH (DEGRADED) / ME2_CONTRACT_UNREACHABLE — в stdout-шину;
   статус интеграции несёт contract + socket_client. Наблюдение (read-only REST) живо
   в любом случае — деградация не роняет браузер.

## Гарантии

- probe-режимы не тронуты (интеграция по-прежнему не стартует в probe).
- socket-клиент не читает и не пишет release-состояние (self-update authority не задета).
- read-only REST наблюдения (/agentchat, /events, /state) — без изменений.
- Все мосты при недоступности daemon'а/socket'а честно деградируют (без шторма).

## Проверки

- daemon: eval v18 53/53 PASS; socket-пробы mesh_heartbeat (позитив/негатив/bad_op);
  MESH_HEARTBEAT в hash-chain; /ui через gateway (:81) — интерактив (тик супервизоров
  через socket-ack) подтверждён агентным браузером.
- браузер: `npm run check` (node --check всех модулей, включая новый socket-client);
  интеграционный прогон me2-socket-client против живого daemon'а (ack mesh_heartbeat
  с supervisor_tick) — в тексте PR.
