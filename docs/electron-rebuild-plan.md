# R48 · Критический анализ всех веток GitHub + Supabase и план масштабной пересборки/интеграции в Electron-клиент

Дата: 2026-09-23 · Ветка: `sandbox/me2-os` · daemon v0.41.0 · Ответ: Z.ai Code (main)

> **СТАТУС ПЛАНА (обновляется по раундам):**
> - **Фаза A — ЗАКРЫТА (R49)**: `CONTRACT_VERSION me2-daemon-contract.v1` + capabilities в `/state`; op `mesh_heartbeat` на socket-поверхности; `GET /ui` self-contained Mission Control; eval v18 53/53; мосты `.mjs` переведены на socket `agentchat:op` (PR #950 merged, me2-socket-client — единственная новая зависимость shell).
> - **Фаза B — ЗАКРЫТА (R50)**: решение K2/K6 — авторитетная оболочка METAENGINE Browser; встроенный `me2-ui-gateway.mjs` (XTransformPort http+ws) + `me2-ui-host.mjs` (adopt/spawn панелей v5); `resolveUiUrl: env → live_gateway → /ui`; `#chat=<id>` на обоих UI; `desktop/updater.ts` DEPRECATED (PR #951 merged).
> - **Фаза C (monorepo) — СЛЕДУЮЩАЯ**: перенос пакетов me2-daemon/me2-ui в release-ветку, autorelease-gate с eval; D (Supabase-контур) и E (архивация веток) далее.
> - CI-конвейер доставки подтверждён: смарт-мержи R40/R49/R50 собираются в dev-релизы автоматически (Fast Verified Dev Release).

## 0. Метод и источники (всё проверено фактами, не по памяти)

- `git ls-remote origin`: **1164 ветки-головы, 142 тега, 1519 pull-refs**.
- GitHub REST: метаданные репо, список релизов, файлы PR #948/#949; raw-файлы release-ветки.
- GitHub GraphQL (батч): даты/сабжи `main`, `sandbox/me2-os`, всех `integration/*`, `release/*`, `me2/*`, `ops/*`, `repair/*`, `perf/*`, `scratch/*`, ключевых `work/*` и target-коммита последнего релиза.
- Git Trees API: полное дерево release-ветки (1854 записи, truncation=false) — инвентаризация браузера и CI.
- Supabase REST: OpenAPI-спека (`/rest/v1/`) → 15 таблиц + 243 RPC; счётчики строк (Prefer: count=exact); `/storage/v1/bucket`.
- Локальный daemon: `/health`, `/tokens`, `/evidence`; grep-сверка контрактов мостов.

## 1. Инвентаризация GitHub PatrickFrome/Compute

### 1.1 Три главные линии (все от 2026-09-23)

| Линия | HEAD-дата | Сабж | Роль |
|---|---|---|---|
| `release/self-update-ambiguity-live-v2` | 09-23 | Merge PR #949 (me2/smart-merge-r41) | **Продакшн-мейнлайн Electron-браузера**, из него CI autorelease собирает dev-релизы |
| `main` | 09-18 | Work/metaengine rsi phase34b… (#821) | Старый dev-цикл браузера; позади release-мейнлайна |
| `sandbox/me2-os` | 09-23 | R47: vault токенов… | Линия ME2 daemon (v0.41.0) + панельный UI + `desktop/`; **в release-контур не входит** |

Группы остальных голов: `work/*` 1025 (археология старого цикла: supervisor-mesh, self-update, devos, brain, world-model, duels…), `fix/*` 46, `repair/*` 31 (плотный цикл 09-13…09-18: runtime-coherence, supervisor heartbeat/ambiguity, self-update continuity), `ops/*` 16, `integration/*` 11, `release/*` 8, `scratch/*` 3, `perf/*` 3, `analysis/*` 2, `me2/*` 2, плюс `archive/w1-pre-dev-cycle-001`, `browser-dev-channel` (08-30), `build/metaengine-browser-test-exe-v035` (08-29), `rail-merge` (09-21), `do-not-use-placeholder`, tmp-*.

### 1.2 Смарт-мерж уже начат — ключевой факт

- **PR #948** (`me2/smart-merge-r40`, «ME2 smart merge R40: integrate METAENGINE-2 daemon plane into browser shell») → влит в release-мейнлайн; **последний релиз v0.7.0-dev.35835201961.1 (2026-09-23) собран именно из этого коммита** (`e38a2f4`).
- **PR #949** (`me2/smart-merge-r41`, «R41/R42: Mission Control tab + brain-economy adapter + supervisor-mesh bridge») → также влит.
- Браузерная me2-плоскость = 7 модулей `apps/metaengine-browser/src/me2/*.mjs`: `daemon-host`, `fleet-bridge`, `integration-entry`, `fleet-tabs-host`, `mission-control`, `brain-adapter`, `supervisor-mesh-bridge`. Документ `apps/metaengine-browser/docs/me2-smart-merge-r40.md` фиксирует карту интеграции и принцип «браузерные механизмы авторитетны, ME2 — дочерняя плоскость (fail-open, zero-authority)»; доставка — штатный self-update браузера.

### 1.3 Браузер (`apps/metaengine-browser`, пакет `@metaengine/browser-shell` 0.7.0-dev.2.1)

- 382 src-файла; ~66 ключевых механизмов: brain-fabric (24 модуля: cognition/collaboration/episodic-memory/working-memory/fanout…), `cognitive-delta-bus`, `supervisor-keepalive` + `browser-sentinel`, `self-update-runtime-v8` + `verified-download-manager` + Guardian (`browser-guardian-core`, `METAENGINEBrowserGuardian.exe`), `tab-registry` (роли MAIN/FLEET/SUPERVISOR, `A2_SUPERVISOR_TAB_CEILING`), fleet-provisioner + elastic-governor, native-supervisor-command-lanes, world-model/state-revision + ledger.
- main=`final-runtime-entry.mjs`; deps: **только electron-updater** (R40-принцип «нет новых зависимостей»); `npm run check` покрывает новые модули.
- CI: **107 workflows** (autorelease dev-канал, operators r0-r65, chat-bridge, w1-*, perf e2e…).

### 1.4 Релизы/доставка

- 142 тега `v0.7.0-dev.<runid>.1`; релизы-prerelease: NSIS x64 ~120MB + blockmap + `METAENGINEBrowserGuardian.exe` + `…Configure.exe` + `verified-self-update-manifest.json` + `guardian-native-staging-manifest.json` + `dev.yml`.
- Канал живых установок: `trusted-dev-release-resolver` → verified manifest → `self-update-runtime-v8` + Guardian. Релиз от 09-23 08:05 — **смарт-мерж R40 уже доставлен живым установкам через их собственный self-update**.

## 2. Инвентаризация Supabase

- **15 таблиц** (`*_h205f22`): enrollment_request **3265**, actuation_lease **4238**, supervisor_command **1833**, device_nonce **843**, architecture_checkpoint 38, pairing/mesh_instance 17/17, supervisor_state 16, device 3, gate_policy 1, peer_health 0; `cognitive_cursor` и `workspace_binding` отдают **403 на count даже service-role** (RLS — честно фиксируем, не ретраим циклично).
- **243 RPC** — монументальная coordination-плоскость старого цикла: `devos_fleet_*` (lease/enqueue/reconcile/snapshot/transport-promotion), `a2_supervisor_mesh_*`, `macroblock_*`, `duel_*` (v1…v6), `metaengine_federation_*` (28 шт), `worker_enrollment_*`, `interactive_round_*`, `aop1_*` — **включая `aop1_vercel_gateway_runtime_secret_v1`** (первоисточник gateway-ключа; теперь дубль истины — vault R47).
- **Storage**: `computefabric-parallel-glm`, `me2-evidence`. Daemon-mirror: **LIVE-STORAGE, bucket me2-evidence, 65 объектов, last_sent_seq 5607, pending 0, ошибок нет** (ручной листинг моими параметрами дал 404 — артефакт параметров запроса; авторитетен daemon-канал).
- DDL-канал: mgmt 401 — **миграции только через оператора** (протокол PGRST205: не ретраить циклично).

## 3. Локальная система (sandbox/me2-os) — на что опираемся

- daemon **v0.41.0**: шина 47/47; socket.io :3040 (`agentchat:op`, `tokens:op`); REST read-only + T0-плоскости `/tokens`, `/policy`, `/demand`, `/cron`; **vault токенов в SQLite** (5 мигрировано байт-в-байт, gateway-ключ добывается и сам сохраняется); G11 governor (полосы+breaker), G10 demand; autonomy non-bypass 29 маршрутов; eval v17 **50/50**; ME40.
- UI: панельный шелл v5 (БРАУЗЕР/ФЛОТ/МИССИЯ/ТЕЛЕМЕТРИЯ/ЖУРНАЛ, Alt+1..5) на :3000 (гейт :81); AgentChatPanel, FleetGrid, VAULT·R47.
- `desktop/` (R46): Electron PID-1 + встроенный gateway (:8137) + daemon-supervisor (exit-13 кооперация) + TabRegistry + updater (semver по релизам GitHub) + preload-мост. tsc 0 ошибок; интеграционный прогон gateway+WS под Node — ок; GUI-прогон возможен только на машине оператора.

## 4. Критический анализ — расхождения и риски

- **K1 (P0) · Контрактный дрейф двух daemon-линий.** Браузерная me2-плоскость ожидает: `POST /agentchat {op:'turn'|'mesh_heartbeat'}`, `GET /ui` (self-contained Mission Control), mesh-фенсы. Локальная v0.41.0: `POST /agentchat` СНЯТ (R46, socket `agentchat:op`), **`mesh_heartbeat` отсутствует вообще**, **`GET /ui` отсутствует**. Итог: `me2-fleet-bridge` (relay хода), `me2-supervisor-mesh-bridge`, `me2-mission-control` против v0.41 **неработоспособны**; `me2-brain-adapter` совместим (`/memory op:write|economy` живы); `me2-daemon-host` (health `/state`) совместим.
- **K2 (P0) · Двойная оболочка.** `desktop/` (наша, чистая, GUI-необкатанная, свой updater) vs `apps/metaengine-browser` (обкатан live-установками, self-update-v8+Guardian, CI autorelease). Системе нужен ОДИН PID-1.
- **K3 (P1) · Двойной UI.** Заявленный в R41-доке `GET /ui` daemon'а не существует локально; вкладка Mission Control браузера упрётся в 404. Панели v5 живут отдельно на :3000.
- **K4 (P1) · Supabase-дрейф.** 243 RPC старого цикла живы, но новой системой почти не используются (только evidence storage). Растущий разрыв «control-plane в облаке vs истина в SQLite». При этом RPC-канал ключа остаётся функциональным дублем vault'а.
- **K5 (P2) · 1164 ветки без политики архивации**; `main` отстал от release-мейнлайна; поиск/триггеры деградируют.
- **K6 (P1) · Гонка двух updaters**, если `desktop/updater.ts` и `self-update-runtime-v8` окажутся в одном процессе.
- **K7 (P2) · Секреты.** Vault (БД) — единая истина; `/home/z/.a2` и Supabase-RPC — seed-источники. Риск: внешняя ротация значения в Supabase не детектируется как конфликт с vault'ом.
- **K8 (P1) · Нет матрицы совместимости** browser me2-plane ↔ daemon (contract version); версии живут в трёх местах (browser package.json 0.7.0-dev.*, daemon VERSION 0.41.0, теги по runid).

## 5. План масштабной пересборки и интеграции в Electron-клиент

**Принцип** (наследие R40-дока, расширенное): один репозиторий, одна оболочка, один daemon, один UI, один канал доставки; браузерные механизмы авторитетны, ME2 — ядро; contract-first с handshake.

### Фаза A — контрактная сверка daemon'а (R49, P0)
1. `CONTRACT_VERSION` + capability-handshake: `me2-integration-entry` при старте читает daemon `/state` → `capabilities {contract, ops[], ui_url}`; при несовпадении — честный DEGRADED (без шторма рестартов).
2. daemon: (а) op `mesh_heartbeat` на socket-поверхности `agentchat:op` (1:1 с R41-доком: meta `mesh_last_heartbeat`, событие MESH_HEARTBEAT в hash-chain, ответ `supervisor_tick`); (б) `GET /ui` — самодостаточная Mission Control (флот/река/ход/#chat) без сборки и внешних зависимостей; (в) eval v18: `mission.ui_contract`, `mission.mesh_tick`, `contract.handshake`.
3. Мосты `.mjs`: fleet-bridge/mesh-bridge перевести с REST `POST /agentchat` на socket `agentchat:op` (socket.io-client в browser-shell — единственная осознанная новая зависимость; фолбэк loopback-REST только для probe-режимов). Brain-adapter не трогать.

### Фаза B — единая оболочка (R50, P0)
4. **Решение K2: авторитетная оболочка — `apps/metaengine-browser`** (live-установки + self-update + Guardian + CI). Механизмы `desktop/` переезжают как me2-модули: gateway → `src/me2/me2-ui-gateway.mjs` (UI :3000 за внутренним прокси), daemon-supervisor → слияние с `supervisor-keepalive` (единые политики рестарта + exit-13 кооперация), `updater.ts` — выводится из эксплуатации (закрытие K6).
5. Панели v5 доставляются как Mission Control: ME2_UI_URL → спавнимый daemon-host'ом Next-UI через внутренний gateway (выбор между static-бандлом и живым Next — по результату A3).

### Фаза C — единый monorepo (R51-R52, P1)
6. База — `release/self-update-ambiguity-live-v2`; в неё переносятся пакеты `apps/me2-daemon` (из `mini-services/me2-daemon`), `apps/me2-ui` (Next), `desktop/` (как source для B4). `sandbox/me2-os` остаётся dev-интеграционной веткой git-sync; в release — смарт-мерж PR'ами (как R40/R41). `main` заморозить.
7. В autorelease-конвейер — шаги: сборка UI, прогон eval/round-verify артефакта, публикация «ME2 unified» dev-релиза (живые установки обновятся сами).

### Фаза D — Supabase-контур (R53, P1, H6)
8. Роль зафиксировать: Supabase = federation/evidence/control-plane live-флота; локальная SQLite = истина. DEPRECATED-реестр: из 243 RPC активно держим ~15 (aop1 vercel gateway, supervisor_mesh_*, evidence); остальные — freeze (не удалять, пометить).
9. H6 SQL-контур: mirror событий дополнительно в SQL-таблицу (не только storage), чтение из UI с гейтом RLS; миграции — через оператора; директория `sql/` в репо синхронна.

### Фаза E — гигиена (R54+, P2)
10. Архивация: теги `archive-2026-09-<группа>` на work/* + fix/repair/ops; правило «14 дней без активности + superseded»; веткозащита руками оператора.
11. Матрица версий (K8): browser@0.7.0-dev.x ↔ daemon CONTRACT_VERSION ↔ UI build — таблица в `docs/` и в `GET /state`.

### Фаза F — верификация (каждый шаг)
eval v18 (ui_contract, mesh_tick, handshake, socket-мосты) + round-verify + браузерная QA :81 (панели; вкладка SUPERVISOR — на живом браузере) + release smoke (dev-релиз → самообновление живой установки → healthcheck me2-плоскости изнутри браузера).

## 6. Честные ограничения анализа

- Содержимое 1025 `work/*` инвентаризировано по сэмплу (GraphQL-батч) — полные диффы всех веток не читались (объём); для решения это не требуется: авторитетная линия определена.
- 2 таблицы Supabase не отдают count (RLS 403) — зафиксировано, не ретраится.
- GUI-прогон Electron в песочнице невозможен (нет дисплея) — финальная обкатка оболочки на машине оператора.
- DDL-миграции Supabase — только через оператора (mgmt 401).

## 7. Backlog R49+ (порядок из плана)

A1 handshake → A2 mesh_heartbeat + GET /ui + eval v18 → A3 socket-мосты → B4/B5 единая оболочка → C6/C7 monorepo + autorelease → D8/D9 SQL-контур → E10/E11 архивация + матрица версий.
