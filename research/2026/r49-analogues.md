# R49 · Ресёрч: лучшие Electron-аналоги (VS Code, Cursor и др.) → применение к MetaEngine

Дата: 2026-09-23 · Раунд: R49 (фаза A) · Статус: внутренний анализ, применён в коде R49;
web-верификация источников отложена (платформенный 429 на web_search, прецедент R37/R38/R43).

## 1. Паттерны аналогов → что взяли

### 1.1 Handshake протоколов: LSP initialize / MCP capabilities → наш `me2-daemon-contract.v1`
- **LSP** (`initialize` → server capabilities → клиент деградирует честно) и **MCP**
  (`initialize` с version+capabilities) — индустриальный стандарт версиирования
  клиент⇄сервер. Наш аналог: `GET /state` → `{contract, capabilities:{ops[], ui,
  transport}}`; мост браузера сверяет при старте, `ME2_CONTRACT_MISMATCH` → DEGRADED
  без шторма рестартов. Это ровно то, как VS Code не падает при несовпадении
  LSP-сервера, а отключает фичи по одному.
- **Применено**: daemon `src/contract.ts` (withContract/capabilitiesJson), браузер
  `me2-integration-entry.mjs` (`me2ContractHandshake`, ожидание `me2-daemon-contract.v1`).

### 1.2 VS Code: процессная модель → наш daemon-supervisor / daemon-host
- VS Code: main (жизненный цикл/окна) + renderer (workbench) + extension host
  (изолированный, падение не роняет редактор) + shared/utility processes.
  Урок: **долгоживущая логика — вне UI-процесса**; UI можно убить без потери состояния.
- У нас уже так: ME2 daemon (SQLite, чаты-сессии) переживает перезапуск браузера
  (`killChild:false`, наследие R40), `me2-daemon-host.mjs` = adopt/spawn+backoff —
  подтверждено как верное направление; фаза B объединит его с `desktop/daemon-supervisor.ts`.

### 1.3 VS Code: update-службы → наш self-update-runtime-v8 + Guardian
- VS Code на Windows: Squirrel-стиль (staged update + swap при перезапуске) +
  собственный UpdateService с каналами quality/commit; обновление применяется
  «изнутри» без ручных установок.
- У нас: `trusted-dev-release-resolver` → verified manifest → `self-update-runtime-v8` +
  Guardian — тот же класс решения с более строгой верификацией (verified manifests,
  Guardian-процесс). Решение фазы B (K6): `desktop/updater.ts` выводится, авторитет —
  за self-update браузера; R49 не трогал.

### 1.4 Cursor: VS Code fork с AI-агентами → наш чат-агентный флот как первоклассная плоскость
- Cursor держит AI-поверхность как отдельные сервисы поверх fork'а (composer/agent,
  background-агенты), не вшивая в workbench; их агенты тоже «вне рендерера».
- Подтверждение нашего выбора: чат-агенты живут в daemon (постоянные сессии SQLite),
  браузер — оболочка и наблюдатель (fleet-bridge observation-строки, вкладки FLEET).
  Отличие/преимущество: у нас агенты взаимосвязаны (interchat, supervisor tick) и
  проверяемы (hash-chain, outcome-proof) — у публичных аналогов этого слоя нет.

### 1.5 Tab-менеджмент: WebContentsView/TabRegistry → роли MAIN/FLEET/SUPERVISOR
-VS Code editor groups / браузерные tab strips: вкладки — это реестр с ролями и
  квотами, а не «окна на Максимум». Наш TabRegistry (роли + A2_SUPERVISOR_TAB_CEILING)
  соответствует лучшей практике: роль определяет квоту и поведение (Mission Control
  через `role='SUPERVISOR'`, чат-агенты через `role='FLEET'` + `#chat=<id>`).

### 1.6 Honest degradation (Chrome/VS Code crash-дисциплина) → fail-open мостов
- Во всех аналогах отказ подсистемы — telemetry + деградация фичи, не падение ядра.
  R49 усилюил: TURN_RELAY_FAILED/TURN_REJECTED/ME2_CONTRACT_UNREACHABLE — машинные
  коды в stdout-шину, без ретрай-штормов (урок G11/429).

## 2. Применение в R49 (сводка)

| Паттерн-аналог | Наша реализация R49 |
|---|---|
| LSP/MCP capabilities handshake | `me2-daemon-contract.v1` + `/state` capabilities + handshake в entry |
| VS Code: логика вне UI | socket `agentchat:op` как единственная операционная поверхность |
| VS Code UpdateService (staged, изнутри) | сохранён авторитет self-update-runtime-v8 (B-фаза снимет дубль) |
| Cursor: AI-сервисы вне fork'а | socket-client singleton + ленивое подключение, fail-open |
| Tab-роли с квотами | ME2_UI_URL → `GET /ui` (Mission Control) в роли SUPERVISOR |
| Crash-дисциплина honest telemetry | DEGRADED-строки, ack-таймауты, ноль штормов |

## 3. Источники (к проверке при окне квоты)
- code.visualstudio.com/docs/supporting/FAQ + github.com/microsoft/vscode/wiki/Process-Architecture
- LSP 3.17 spec (initialize/capabilities), Model Context Protocol spec (initialize)
- electronjs.org/docs/latest/tutorial/updates (autoUpdate/differential), Squirrel.Windows
- Cursor docs/changelog (agents, background agents) — поверхностно, для карты паттернов

## 4. Следствия для фаз B/C (обновления плана)
- B4: объединение supervisor-keepalive (браузер) + daemon-supervisor (desktop/) — по
  образцу VS Code: единый «main-страж», один владелец рестартов, exit-13 кооперация.
- C7: autorelease уже собрал контур доставки — eval v18 прогон добавляется в gate
  (Fast Verified Dev Release) в фазе C.
- K7: соль-детект ротаций Supabase-vs-vault — кандидат R50 (по плану D8).
