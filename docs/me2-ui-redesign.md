# METAENGINE UI/UX REBUILD — DESIGN ARCHITECTURE (R74)

Версия: 1.0 · Дата: R74 · Статус: РЕАЛИЗУЕТСЯ
Задача: полная пересборка интерфейса METAENGINE по Page-архитектуре (DaVinci Resolve — архитектурный ориентир, Cursor/VS Code — agent-UX ориентир).

---

## 0. RESEARCH SUMMARY (Phase 1)

Зафиксированные UX-механики референсов и их перенос в METAENGINE:

| Источник | Механика | Перенос в METAENGINE |
|---|---|---|
| DaVinci Resolve | **Pages** — одна система, специализированные рабочие контексты; нижняя навигация страниц; переключение мгновенное, состояние каждой Page персистится | 10 Pages, нижняя Page-панель, состояние Page сохраняется (localStorage), панели монтируются условно (перф) |
| DaVinci Resolve | Global (один на систему) vs Page-local (свой на страницу) — никогда не смешиваются | Глобально: command bar, palette, dialogs, task sheet, status bar, supervisor-чип. Локально: всё остальное |
| DaVinci Resolve | Workspace presets (можно сохранить раскладку под задачу) | Workspace System: Development / Browser Ops / Debugging / Monitoring / Supervisor — workspace = page + layout-prefs, быстрое переключение |
| Resolve/Cursor | Плотная профессиональная вёрстка без «SaaS-карточек», 11–13px данные, моно-шрифт для машинных данных | Design language: zinc-dark + emerald-акцент, dense rows, font-mono для данных |
| VS Code / Cursor | **Activity-переключение контекста из одного места** (Command Palette = универсальный переход) | ⌘K Palette с режимами: Actions / Pages / Agents / Tasks — переход к любому объекту ≤1 действия |
| VS Code | Статус-бар как глобальная строка состояния (кликабельные сегменты) | Нижний статус-бар: daemon, флот, задачи, бюджет, зеркало, отложенные команды |
| Cursor | **Agent-first**: агент = единый контекст (чат + файлы + браузер + задача), боковая панель агентов всегда под рукой | Agent Sidebar в Command Center: статус, задача, модель, browser, workspace, progress каждого агента; клик = мгновенный переход в его контекст |
| Cursor | AI-панель и терминал — первоклассные соседи редактора, а не отдельные страницы | Supervisor Panel — постоянный control-plane справа в Command Center |
| VS Code | Quick Open (⌘P) — fuzzy-переход к файлу | Palette-режим Tasks/Agents — fuzzy-переход к объекту системы |
| VS Code | Keyboard-first: всё действие имеет шорткат | Alt+1..0 страницы, ⌘K палитра, N новая задача, ⌘⇧P→palette, Esc закрыть, Alt+←/→ недавние страницы |
| Resolve | Inspector — контекстные свойства выделенного объекта | Task Sheet (правая выдвижная панель свойств задачи) + деталь агента |
| Resolve | Ни одна функция не теряется при смене контекста — меняется только представление | Feature→Page Matrix (§2): каждая механика получила новое место, ничего не удалено |

**Главный принцип (не копия Resolve, а его архитектура):**
> Одна профессиональная система → 10 специализированных Pages → каждая Page = оптимизированный рабочий контекст. Пользователь видит только тот уровень сложности, который нужен сейчас (progressive disclosure).

---

## 1. METAENGINE AUDIT SUMMARY (Phase 2)

Полный аудит выполнен двумя исследовательскими агентами (полные отчёты в работе агентов, R74):

- **Текущий UI**: монолит `page.tsx` 4797 строк, 5 панелей (browser/fleet/mission/telemetry/log), ~60 useState, ~45 REST-опросов, socket.io `/?XTransformPort=3040` (snapshot каждые 2с + event-стрим), скринкаст WS :3042 + CDP :3043, 6 overlay-диалогов, window-события `me2:select-chat`/`me2:chat-selected`/`me2:chat-create`, localStorage `me2.panel.v1` + hash, Electron-мост `me2Desktop()`.
- **Daemon v0.57.1**: 67 GET-маршрутов, 47-действий command bus (полосы EMERGENCY/CONTROL/MUTATION/READ_ONLY, бюджет 24/60s), домены: tasks/agents/workers/pool, agentchat (мутации только socket `agentchat:op`), browser sense/obsv/effect, sqlmirror/evidence/hooks/ci, memory/brain/fleet/rsi/selfupdate, exec/file/review/sandbox/sandboxes/approvals, governor/demand/glm/llm/quota, bench/eval/otel/codegraph/worktrees/policy/tokens/cron/exthost.
- **Честно НЕТ в daemon**: /research, /notifications, /settings, /repos, /checkpoints, /workspace-REST (это команды шины), /tabs-REST (команда BROWSER_TABS).
- **Инварианты совместимости** (нарушать запрещено): относительные fetch + `?XTransformPort=3041|3042|3043`, socket path `/` порт 3040, события `snapshot`/`event`, `command` c ack, `agentchat:op`/`tokens:op` c ack, каталог `/actions` = 47, window-события, data-testid (сохраняются ключевые), localStorage/hash-контракт расширяется, бюджет шины, страницы рендерятся условно.

---

## 2. FINAL PAGE ARCHITECTURE (Phase 3)

Гипотеза оператора (10 Pages) сверена с аудитом. Изменения против гипотезы:
- «SUPERVISOR» оставлен отдельной Page (это control-plane: objectives/workgraph/handoffs/governor/demand/reviews/approvals/brain/roadmap) — не merged.
- «HOME/COMMAND» = Command Center (3-колоночный), впитал текущую панель browser.
- BROWSER выделена как инфраструктурная Page (sense/obsv/effect/cdp) — Command Center показывает только живой скринкаст.
- MEMORY/KNOWLEDGE получила memory+economy+rsi (capsules/checkpoints в daemon отсутствуют — откат правок уже живёт в CODE через /file rollback).
- SYSTEM (settings) — tokens/vault, policy, budget, selfupdate, ME-матрица, контракт, каталог.

### Финальные 10 Pages

| # | Page | Назначение | Что внутри |
|---|---|---|---|
| 1 | **COMMAND** | Ежедневный центр управления | Agent Sidebar (лево) · Browser/Workspace Stage (центр: скринкаст, вкладки, url, pair-control, профили) · Supervisor Panel (право: health, cycle, objectives, running, blocked, события, решения) |
| 2 | **AGENTS** | Управление всеми AI-агентами | Fleet Grid (чаты-агенты) · реестр AGENTS (spawn/модель/pause/retire) · чат-панель агента · cron |
| 3 | **BROWSER** | Браузерная инфраструктура | Stage (тот же компонент, расширен) · SENSE (aria-перцепция + actuation) · OBSV (network/console/exceptions) · EFFECT (вердикты+fences) · CDP-LIVE |
| 4 | **CODE** | Код, репозитории, execution | EXEC/EDIT (TERMINAL_RUN, FILE_EDIT+rollback) · REVIEW RUN MODES (тир-3 очередь) · SANDBOX OS (probe/run/config) · SANDBOXES PLANE (worktree-песочницы) · WORKTREES+rerere · CODEGRAPH (метрики/impact/fan) |
| 5 | **TASKS** | Задачи и execution plans | ВЕТКИ·ГРАФ (BranchGraph, retry-дуги, фильтры) · ОЧЕРЕДЬ · METRICS (retry A/B) · детали через Task Sheet |
| 6 | **SUPERVISOR** | Control-plane оркестрации | OBJECTIVES · WORKGRAPH (проекция цели→задачи→агенты) · HANDOFFS · GLM·REVIEWS · APPROVALS · GOVERNOR (breaker/lanes) · АВТОПИЛОТ DEMAND · BRAIN · ROADMAP M1–M7 |
| 7 | **COMPUTE** | Исполнительные мощности | EXECUTOR·POOL (scale/burn/leases) · WORKERS (реестр+heartbeat) · LLM·QUOTA (pacing/cache/failover/park/каналы) · GLM-плоскость (canonical/дрейф/upgrade) · FLEET-NODES |
| 8 | **MEMORY** | Память и знание | MEMORY (поиск/write/delete по kind) · TOKEN-ECONOMY · RSI (propose/adopt/reject) · BRAIN-реколл |
| 9 | **OBSERVABILITY** | Журналы, события, здоровье | EVENT LOG (live-tail/фильтры/экспорт) · COMMAND BUS (отложенные+история) · BENCH · EVAL · CI-INGRESS · WEBHOOKS-IN · SQL-ЗЕРКАЛО (MirrorPanel) · EVIDENCE·CHAIN (verify) · DB·HYGIENE · AUTONOMY·V4 · SPANS(OTel) · VERDICTS(RH) |
| 10 | **SYSTEM** | Конфигурация системы | VAULT·TOKENS · POLICY T0/T1/T2 · BUDGET · SELF-UPDATE · ME-МАТРИЦА · CONTRACT/CAPABILITIES · DESKTOP/оболочка · ОПАСНАЯ ЗОНА (reset) |

### Global vs Local (критическое правило)

**GLOBAL (доступно из любой Page):** Top Command Bar (поиск/команды), ⌘K Palette, Task Sheet, диалоги (Новая задача/Events Search/Budget/Reset), Page Bar, Status Bar (низ), WS-индикатор, бюджет, KPI-мини, часики, Supervisor-чип статуса.

**LOCAL (только своей Page):** всё остальное (см. таблицу Pages).

---

## 3. FEATURE → PAGE MATRIX (инвентарь: каждая существующая механика получила место)

| Существующая механика (старая панель) | Назначение | Новое место | Global/Local | User flow |
|---|---|---|---|---|
| Header: бренд, версия, KPI-tiles, sparkline, WS, ⌘K | статус системы | **TopBar** (global) | Global | всегда виден |
| browser: aside чатов (AgentChatPanel) | общение с агентами | COMMAND лево + AGENTS | Local | агент→чат |
| browser: browser-shell (вкладки, url, профили, viewport, pair-control, консоль) | живой браузер | COMMAND центр (BrowserStage) + BROWSER | Local | агент→браузер |
| browser: CDP-фолбэк q/w | качество кадра | BrowserStage (общий) | Local | — |
| fleet: FleetGrid | сетка чатов | AGENTS | Local | обзор агентов |
| fleet: EXECUTOR·POOL | пул GLM | COMPUTE | Local | мощности |
| fleet: ФЛОТ·АГЕНТЫ (spawn/модель/pause/retire) | реестр | AGENTS | Local | управление |
| fleet: WORKERS | воркеры | COMPUTE | Local | мощности |
| mission кол.1: ВЕТКИ·ЗАДАЧИ (граф, фильтры, retry) | задачи | TASKS | Local | задачи |
| mission кол.1: ОЧЕРЕДЬ ЗАДАЧ | очередь | TASKS | Local | задачи |
| mission кол.1: MirrorPanel | зеркало | OBSERVABILITY | Local | аудит |
| mission кол.2: ME-матрица | механики | SYSTEM | Local | система |
| mission кол.2: CI-INGRESS | GitHub Actions | OBSERVABILITY | Local | ingress |
| mission кол.2: WEBHOOKS-IN | push-канал | OBSERVABILITY | Local | ingress |
| mission кол.2: LLM-QUOTA | квоты | COMPUTE | Local | мощности |
| mission кол.2: OBJECTIVES | цели | SUPERVISOR | Local | оркестрация |
| mission кол.2: HANDOFFS | передачи | SUPERVISOR | Local | оркестрация |
| mission кол.2: GLM·REVIEWS | ревью | SUPERVISOR | Local | контроль качества |
| mission кол.2: APPROVALS | гейты | SUPERVISOR | Local | решения |
| mission кол.2: MEMORY+ECON | память | MEMORY | Local | знание |
| mission кол.2: BRAIN | LLM-ядро | SUPERVISOR (+ MEMORY реколл) | Local | планирование |
| mission кол.2: FLEET | флот-ноды | COMPUTE | Local | мощности |
| mission кол.2: SELF-UPDATE | обновление | SYSTEM | Local | система |
| mission кол.2: RSI | самоулучшение | MEMORY | Local | знание |
| mission кол.3: ГРАФ КОДА | codegraph | CODE | Local | код |
| mission кол.3: ROADMAP M1–M7 | план | SUPERVISOR | Local | оркестрация |
| mission кол.3: САНДБОКС (worktree-плоскость) | песочницы | CODE | Local | код |
| mission кол.3: EXEC/EDIT | терминал+правки | CODE | Local | код |
| mission кол.3: RUN MODES/REVIEW | тир-3 | CODE | Local | код |
| mission кол.3: SANDBOX OS | confinement | CODE | Local | код |
| mission кол.3: COMMAND BUS | шина | OBSERVABILITY (+ глобальные отложенные в Status Bar) | Local | аудит |
| telemetry: SENSE | перцепция | BROWSER | Local | браузер |
| telemetry: OBSV | CDP-observability | BROWSER | Local | браузер |
| telemetry: BENCH | латентности | OBSERVABILITY | Local | аудит |
| telemetry: EVAL | регресс | OBSERVABILITY | Local | аудит |
| telemetry: DB·HYGIENE | гигиена БД | OBSERVABILITY | Local | аудит |
| telemetry: EVIDENCE·CHAIN | hash-chain | OBSERVABILITY | Local | аудит |
| telemetry: AUTONOMY·V4 | плоскости v4 | OBSERVABILITY | Local | аудит |
| telemetry: GOVERNOR+DEMAND | control | SUPERVISOR | Local | оркестрация |
| telemetry: VAULT·TOKENS | секреты | SYSTEM | Local | система |
| telemetry: CDP·LIVE | скринкаст-стат | BROWSER | Local | браузер |
| log: EVENT LOG | журнал | OBSERVABILITY | Local | аудит |
| ⌘K палитра | команды | Palette (расширена режимами) | Global | везде |
| Диалоги: новая задача / events search / budget / reset / task sheet | действия | Global overlays | Global | везде |
| window-события me2:select-chat / chat-selected / chat-create | связка компонентов | сохранены as-is (store-мост) | Global | — |
| Electron-мост (tabs.setActive, native events) | оболочка | сохранён + расширен на Pages | Global | — |
| hash-навигация #panel, localStorage me2.panel.v1 | персист | расширено: #page, me2.page.v1 | Global | — |

**Вывод: 0 механик потеряно.** 5 старых панелей → 10 новых Pages + 6 глобальных зон.

---

## 4. NAVIGATION MAP

```
TopBar (global) ── ⌘K ──→ Palette: [Actions | Pages | Agents | Tasks | Commands]
   │                          выбор → setPage / openTask / setChatId / sendCommand
   └─ поиск-подсказка → Enter → Palette

PageBar (низ, Resolve-style):  [⌂ COMMAND][⧉ AGENTS][◎ BROWSER][</> CODE][☰ TASKS]
                               [🛡 SUPERVISOR][⚙ COMPUTE][◈ MEMORY][📡 OBSERVABILITY][⚙ SYSTEM]
   Alt+1..0 · Alt+←/→ недавние · workspace-свитчер слева · статус-чипы справа

Status Bar (глобальная строка): daemon · флот · задачи · бюджет(клик→BUDGET_ADJUST)
                                · зеркало · отложенные · boot/порты

Контекстные переходы (agent-first):
  Agent Sidebar → клик агента → его чат (AgentChatPanel) + его задачи (фильтр) + его браузер
  Task row → клик → Task Sheet (свойства) → «во флот» → setChatId(supervisor)
  Supervisor Panel → клик objective → SUPERVISOR page
  Palette → Agents режим → выбор → COMMAND с выбранным агентом

Window-события (legacy-совместимость): fleet-grid → me2:select-chat → store → COMMAND
```

---

## 5. COMMAND CENTER WIREFRAME (Page 1)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ME2 ▸ COMMAND · v0.57.1   [ ⌘ поиск/команда/переход… ]   WS·LIVE  KPI  ⏱  │ TopBar
├──────────────┬─────────────────────────────────────────────┬───────────────┤
│ AGENT        │  BROWSER / WORKSPACE STAGE                  │ SUPERVISOR    │
│ SIDEBAR      │  ┌ tabs: t1* t2 t3 [+ ]                     │ PANEL         │
│              │  ├ urlbar [https://…        ⟳] prof/руль/⟳  │               │
│ ● super-1    │  │                                          │ ● supervisor  │
│   THINKING   │  │        живой скринкаст (:3042)           │   cycle 12s   │
│   zai:4.6    │  │        (pair-control: клик/клавиши)      │ objectives 3  │
│   task: tk_… │  │                                          │ running 2     │
│ ○ impl-2     │  │                                          │ blocked 1     │
│   IDLE       │  └ status: fps·kbps·url·ошибки             │ events (live) │
│ + spawn      │  [лента консоли вкладки — сворачиваемая]   │ decisions     │
│──────────────│                                             │ [action… ]    │
│ (список из   │                                             │               │
│ /agentchat + │                                             │               │
│  snapshot)   │                                             │               │
├──────────────┴─────────────────────────────────────────────┴───────────────┤
│ WORKSPACE ▾   ⌂ COMMAND  ⧉ AGENTS  ◎ BROWSER  </> CODE  ☰ TASKS  …  СТАТУС│ PageBar
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. PAGE WIREFRAMES (кратко, layout каждой Page)

- **AGENTS**: grid 2-3 кол.: [FleetGrid] | [AGENT CHAT панель выбранного] ; низ: реестр агентов (строки: роль, статус, модель, действия) + cron-чипы.
- **BROWSER**: grid: [BrowserStage (расширенный)] | правая колонка табов: SENSE (цели+act) / OBSV (net/con/exc) / EFFECT (fences+вердикты) / CDP-LIVE (q/w, stats).
- **CODE**: 2×3 сетка свёрток: EXEC/EDIT · REVIEW · SANDBOX OS · SANDBOXES PLANE · WORKTREES · CODEGRAPH.
- **TASKS**: лево (2fr): ВЕТКИ (граф+фильтры+вкладки) ; право (1fr): ОЧЕРЕДЬ + METRICS; клик по ветке/задаче → Task Sheet.
- **SUPERVISOR**: 3 колонки: OBJECTIVES+WORKGRAPH | HANDOFFS+REVIEWS+APPROVALS | GOVERNOR+DEMAND+BRAIN+ROADMAP.
- **COMPUTE**: 2 колонки: POOL+WORKERS | LLM·QUOTA+GLM+FLEET-NODES.
- **MEMORY**: 2 колонки: MEMORY (поиск/список/операции) | ECONOMY + RSI.
- **OBSERVABILITY**: лево: EVENT LOG (live, фильтры) ; центр: COMMAND BUS + CI + HOOKS ; право: MIRROR + EVIDENCE + BENCH + EVAL + HYGIENE + AUTONOMY + SPANS + VERDICTS (вертикальный стек свёрток).
- **SYSTEM**: 2 колонки: VAULT+POLICY+BUDGET | SELFUPDATE+ME-МАТРИЦА+CONTRACT+DANGER.

Каждая Page: заголовок-строка (title + контекстные действия + testid `page-<key>`), панели — Card с плотным header (иконка+название+счётчик+сворачивание).

---

## 7. COMPONENT ARCHITECTURE

```
src/app/page.tsx                    → <Me2Shell/> (thin, 10 строк)
src/lib/me2-bus.ts                  → типы Snapshot/Agent/Task/Ev/…, WS_OPTS, me2Fetch,
                                      getSocket(), sendCommand(), EVENT_STYLE, laneChip, hhmmss, age
src/components/me2/store.tsx        → zustand: ws/snap/events/catalog/mirror/nowMs + page/
                                      workspace/palette/dialogs/chatId + init()/setPage()/openTask()/
                                      setChatId() (мост window-событий) + desktop-мост + hotkeys
src/components/me2/ui/primitives.tsx→ Dot, KpiTile, Sparkline, StateBadge, Chip, Sec (Card-секция)
src/components/me2/shell/
  me2-shell.tsx                     → композиция: TopBar + <PageOutlet> + PageBar + StatusBar + Overlays
  topbar.tsx                        → бренд, глобальный командный бар, WS, KPI, часы
  pagebar.tsx                       → Resolve-style нижняя навигация 10 Pages + workspace-свитчер
  statusbar.tsx                     → глобальный статус (кликабельные сегменты)
  command-palette.tsx               → ⌘K: Actions/Pages/Agents/Tasks/Реестр-47
  dialogs.tsx                       → НОВАЯ ЗАДАЧА · EVENTS_SEARCH · BUDGET · RESET · TASK SHEET
src/components/me2/pages/
  command.tsx  agents.tsx  browser.tsx  code.tsx  tasks.tsx
  supervisor.tsx  compute.tsx  memory.tsx  observability.tsx  system.tsx
переиспользуемые (без изменений): me2/agent-chat-panel.tsx, me2/fleet-grid.tsx, me2/mirror-panel.tsx
```

Данные: WS push (snapshot 2с + event) — через store; REST-опросы — локальны в страницах (монтируются условно, как раньше); мутации — единый `sendCommand()` (socket ack → REST fallback); чат-мутации — `agentchat:op`; vault — `tokens:op`.

---

## 8. INTERACTION SPECIFICATION

| Действие | Спецификация |
|---|---|
| Клик по Page (PageBar) | мгновенная смена, состояние Page сохраняется в store (не теряется) |
| Alt+1..0 | прямая навигация по Pages |
| Alt+← / Alt+→ | назад/вперёд по недавним Pages |
| ⌘K / Ctrl+K | Palette; Esc закрыть; Enter исполнить; режимы через префикс: `>` команды, `@` агенты, `#` задачи, `~` страницы |
| N (вне поля ввода) | НОВАЯ ЗАДАЧА |
| Клик агент (Sidebar/FleetGrid) | выбор агента: чат + его задачи; dispatch me2:select-chat (совместимость) |
| Клик задача | Task Sheet (spec/result/error/хроника/действия); live-синхронизация по WS |
| Двойной клик агент (AGENTS) | открыть его workspace-чат |
| Hover строк/чипов | tooltip (title/aria) + подсветка |
| Свёртки секций | клик по header; состояние в localStorage per-page |
| Пара-руль скринкаста | тумблер; клик/колесо/клавиши → WS :3042 input_* |
| Бюджет в Status Bar | клик → BUDGET_ADJUST |
| Ошибки шины | toast (title/variant) — без молчаливых отказов |
| Загрузка | скелетоны/`…` в местах данных; никогда не блокируют весь экран |

---

## 9. STATE SYSTEM (единый словарь состояний, §13 ТЗ)

StateBadge: **Running** (emerald, pulse-dot) · **Idle** (zinc) · **Paused** (amber, pause) · **Waiting** (amber, clock) · **Blocked** (amber, octagon) · **Failed** (rose, x) · **Recovering** (violet, rotate) · **Completed** (teal, check) · **Offline** (zinc, x-circle) · **Degraded** (amber, alert) · **WARMUP** (violet, loader) · **LIVE** (emerald, radio).
Маппинг: task status → READY=Waiting, RUNNING=Running, COMPLETED=Completed, FAILED=Failed, CANCELLED=Offline, HANDED_OFF=Recovering; worker state IDLE/RUNNING/OFFLINE; mirror OFF/WARMUP/LIVE/DEGRADED; breaker CLOSED/OPEN/HALF_OPEN. Всегда иконка+текст+цвет (не только цвет).

---

## 10. MIGRATION PLAN

1. **Сохранён референс** `docs/legacy-mission-control.tsx.txt` (старый page.tsx, источник порта).
2. **Ядро сначала**: me2-bus → store → primitives → shell + диалоги → пустые Pages-стабы. UI собирается и QA-проверяется на шелле до порта содержимого.
3. **Порт страниц** параллельными агентами из legacy-референса (каждая механика переносится 1:1, testid сохраняются).
4. **Интеграция+QA**: lint 0/0, agent-browser (рендер всех Pages, переходы, палитра, диалоги, WS LIVE, mobile 390px), dev.log без ошибок.
5. **Риск-план**: если страница не успевает — она честно показывает «LEGACY-ПОРТ: в процессе» со ссылкой на раздел (без потери данных — данные легкодоступны через Palette→Actions).
6. Обратная совместимость: старые testid `panel-tab-*` сохранены как синонимы в PageBar (`data-testid="page-tab-<key>"` + `panel-tab-<key>`).

---

## 11. ФИНАЛЬНЫЙ КРИТЕРИЙ (проверка после сборки)

1. Что сейчас происходит? → TopBar + Status Bar + Supervisor Panel.
2. Какие агенты работают? → Agent Sidebar / AGENTS / KPI.
3. Что делает каждый агент? → Agent Sidebar (задача/прогресс) + чат.
4. Где он работает? → Sidebar (browser/session/workspace) + BrowserStage.
5. Что делать дальше? → Supervisor Panel (decisions/recommendations) + Palette.
