# METAENGINE 2 — Финальный blueprint пересборки (оболочка ≠ Electron, механики 1:1, дизайн, архитектура)
Дата: 2026-09-22 · Дополнение к METAENGINE-REBUILD-RESEARCH.md
Источники: полный код-аудит hostsrc/Compute-rel (108k строк) + 20 веб-поисков 2026 (research/2026/*.json)

---

## 0. Резюме для оператора (TL;DR)

1. **Electron убираем полностью.** Оболочка = **Tauri 2** (Rust + OS WebView): бандл ~2.5–10 МБ вместо ~120 МБ, RAM в ~4–5× ниже, старт ~3.7× быстрее, авто-апдейт и single-instance из коробки.
2. **Главный факт ресёрча-2026:** WebView Tauri **не имеет CDP на Linux** (WebKit) — автоматизация UI невозможна. Поэтому **управляемый браузер ≠ UI-оболочка**. Браузер — отдельный Chromium, запущенный демоном с `--remote-debugging-pipe` (этот паттерн УЖЕ реализован в `coordination/browser-compute/cdp-pipe-client.mjs` — переносим как есть).
3. **Все механики браузера повторяются 1:1** через тонкий CDP-клиент: AX-дерево (perception), `Input.dispatch*` (actuation), semantic frames, outcome-latches, вкладки по-demand. Матрица переноса — §3.
4. **Архитектура: daemon + консоль.** ME2 Core daemon (Rust `chromiumoxide` / или bun для быстрого старта) — единый владелец состояния, локальный event-bus вместо DB-поллинга, SQLite WAL event-log, облако Supabase остаётся только evidence-plane (журнал, не автобус).
5. **Дизайн: Mission-Control консоль** — тёмный плот-лейаут (3 колонки: флот/поверхности, live-view браузера, работы/задачи), референсы 2026: Codex Desktop, Mission Control (builderz-labs), Linear, Raycast, Warp 2.0.

---

## 1. Полный инвентарь механик текущего приложения (что именно «повторить»)

Код-аудит `apps/metaengine-browser` (v0.7.0-dev.2.1, Electron 44, 108,158 строк src):

### 1.1 Браузерный план (ядро)
| Механика | Файл | Как работает |
|---|---|---|
| 1 окно + N WebContentsView | `main.mjs:1565` | BaseWindow 1440×960 + view на вкладку; layout через `shell-layout.mjs` |
| CDP через `webContents.debugger` | `native-browser-control.mjs` (1,482 ln) | Accessibility.getFullAXTree, Input.dispatchMouseEvent/KeyEvent, DOMSnapshot, capturePage |
| Персистентные CDP-сессии | `browser-persistent-cdp-session.mjs` (747 ln) | пул дебаггеров + восстановление runtime-context |
| Semantic perception | `captureSemanticFrame` | AX-дерево → `perception.v1` c semantic_targets[], кэш 4s |
| Outcome-latch | `browser-cdp-outcome-latch.mjs` | доказательства эффектов: PROVEN_COMPOSER_CLEARED / PROVEN_NEW_CONVERSATION / PROVEN_GENERATING |
| Actuation | SEMANTIC_TYPE/SEMANTIC_FOCUS/TYPED_CLICK/PRESS_KEY/SCROLL | 13-ключевой whitelist, Ctrl+A, Enter-submit с write-ahead barrier |
| Политики навигации | `browser-policy.mjs` | origin-allowlist (chat.z.ai, chatgpt.com), sandbox:true, deny-all permissions |

### 1.2 Командная поверхность
- **47 действий** в `control-actions-manifest.mjs`, 4 полосы (`native-supervisor-command-lanes.mjs` v3): EMERGENCY / READ_ONLY / TAB_MUTATION / GLOBAL_MUTATION.
- Полный список: POLL, CAPTURE, CAPTURE_VIEW, SEMANTIC_CENSUS, TAB_TELEMETRY, SYSTEM_TELEMETRY, READ_TRANSCRIPT, TAB_CENSUS, FLEET_STATUS · STOP_GENERATION, SCROLL, SEMANTIC_FOCUS, SEMANTIC_TYPE, TYPED_CLICK, PRESS_KEY, SELECT_TAB, CLOSE_TAB, NAVIGATE, BACK, FORWARD, RELOAD · ARM, NEW_TAB, FLEET_RECONCILE, FLEET_SET_PROFILE, DOWNLOAD_FILE, SELF_UPDATE_CHECK/APPLY, GATE_* · DISARM.
- Lifecycle команды: idempotency_key → PENDING → lease (120s, budget 24 cost/60s) → LEASED → effect-intent binding → execute → receipt → COMPLETED/FAILED; ambiguity = AMBIGUOUS/NO_EFFECT_PROVEN + write-ahead effect journal.

### 1.3 Supervisor / Fleet / DevOS
- Supervisor cycle 2s + **wait-batch long-poll (4s hold)** + fastlane 600ms + watchdog 5s; heartbeat 2s; обслуживание в idle.
- Fleet provisioner (`fleet-provisioner-core.mjs`, 643 ln): `planBacklogCapacity` — demand = ready+running, target = warm+demand, burst 8, census-gate, elastic retire ≤8/cycle.
- Агент = вкладка чат-платформы (Z.ai GLM / ChatGPT): REGISTERED → PROVISIONING → BOUND_UNVERIFIED → ACTIVE; transport-proof = proven conversation URL.
- DevOS task cycle (`devos-native-task-cycle-core.mjs`, 1,483 ln): lease → CAPTURE → render prompt ≤24,000 chars (sha256 journal) → SEMANTIC_TYPE submit → 6×700ms readback → mark-running → observe → complete/reconcile.
- Keepalive supervisor-чата (`supervisor-keepalive.mjs`, 898 ln): привязка к `chat.z.ai/c/<uuid>`, 11 состояний (ACTIVE…ROLLOVER_AMBIGUOUS), wake-причины, admission fence с generation floor.
- Mesh (`supervisor-mesh.mjs`): пиры-супервизоры, actuation lease, exact target/incarnation binding.
- Self-update: транзакционный (journal → successor probe → qualification → handoff), 3,641 ln + Windows Guardian SCM (C++ 3,762 ln).
- RSI-подсистема: **42,930 строк** (91 файл) — research queue, skill lifecycle, outcome river.

### 1.4 UI (renderer)
- Vanilla JS 3,388 ln: омнибокс, вертикальный рейл вкладок, статус-пилюли, **DevOS Surface Grid** (мульти-панельные сессии), Operations panel (Mission Control: objectives→tasks→agents→effects), RSI console, fallback console, brain-line когнитивных дельт.
- Контракт renderer↔main: **1 snapshot-push** (`metaengine.browser-shell.snapshot.v3`) + **1 command-channel** + 5 invoke-handlers + brain MessagePort. → Переезд в WebSocket/HTTP тривиален.

### 1.5 Транспорт
Supabase Edge Function `a2-browser-native-supervisor-v1` (Deno, 2,076 ln) + ECDSA P-256 подписи каждого запроса + nonce-consume + enrollment; wake = Realtime broadcast / LISTEN-NOTIFY (hint, не authority); ~90 RPC, 104 миграции.

---

## 2. Диагноз: почему медленно и конфликтно (подтверждено кодом)

| Симптом | Корень в коде |
|---|---|
| Медленно | Каждая команда = HTTPS+подпись+lease+receipt через облако; fastlane 600ms существует **чтобы скрыть worst-case 4s DB-полла** (комментарий в коде); perception кэш 4s; readback 6×700ms |
| Конфликтно | Состояние размазано: 3 независимых писателя в одну строку state (patch через per-plane jsonb merge), вкладка-как-агент (draft-poison, composer_not_unique), lease-гонки, 411 AMBIGUOUS-мусора |
| Тяжело | 20+ вкладок Chromium в одном процессе оболочки; RSI 42.9k строк; защитных состояний больше, чем логики (PROVISIONING_AMBIGUOUS, 8-strike, grace…) |
| Хрупко | self-forking self-update, 104 миграции ≠ облако, GRANT-дыры 42501, бюджет supervisor_action_budget_exceeded |

**Вывод:** 95% кода — чистый Node без единого `import electron`. Меняется только оболочка и транспорт, не логика.

---

## 3. Матрица переноса механик: старое → METAENGINE 2 (1:1)

| # | Механика (старое) | Куда идёт в ME2 | Способ |
|---|---|---|---|
| 1 | WebContentsView на вкладку | Отдельный Chromium у daemon'а, вкладки = CDP Targets | **Перенос** паттерна `browser-compute` (уже есть: `chrome-process.mjs`, `--remote-debugging-pipe`, hand-rolled CDP-клиент, 0 зависимостей) |
| 2 | webContents.debugger (AX/Input) | Тот же CDP через pipe в daemon (Rust: `chromiumoxide` — самая полная Puppeteer-like API для Rust, 2026; альтернатива `cdpkit` type-safe) | **Перенос** всех вызовов: Accessibility.getFullAXTree, Input.dispatch*, DOMSnapshot |
| 3 | Semantic frames + outcome-latch | Тот же код-контракт `perception.v1`, те же PROVEN_*-доказательства | **Перенос** контрактов из `browser-shared/action-contract.mjs` |
| 4 | 47 действий / 4 полосы | Локальный command bus в daemon (in-process, µs); JSON-манифест сохраняется как единый контракт; полосы = приоритеты tokio-очередей | **Переписать** транспорт, **сохранить** семантику |
| 5 | Fleet provisioner (planBacklogCapacity) | Тот же алгоритм в daemon; агенты = **worker-процессы с контекстом**, а вкладка-чат = один из platform-типов воркера | **Перенос** алгоритма как есть |
| 6 | DevOS task cycle (lease→prompt→submit→proof) | Master loop daemon'а; для platform-воркеров — те же CDP-механики submit/readback; для API-воркеров — прямой вызов провайдера (z.ai API / Vercel Gateway) | **Двухрежимный** |
| 7 | Keepalive супервизора (11 состояний) | Встроен в master loop как его собственный диалог (состояние в памяти, не в облаке) | **Упрощение** — победа над WAKE_AMBIGUOUS-классом |
| 8 | Mesh пиров + actuation lease | Нужен ТОЛЬКО если несколько устройств; в single-device заменяется одним владельцем-daemon'ом | **Отбрасывается** (YAGNI) либо локальный singleton-lock |
| 9 | Self-update транзакционный | Tauri 2 updater (встроенный, подписанный) + daemon обновляется как sidecar | **Замена** стандартным инструментом |
| 10 | Windows Guardian SCM | Не нужен: обновляет Tauri-инсталлятор | **Отбрасывается** |
| 11 | RSI 42.9k строк | Вынести в отдельный сервис, читать event-log; НЕ переносить в ядро | **Изоляция** |
| 12 | Snapshot pump + brain port | WebSocket push в UI (Tauri webview ↔ localhost WS) + SSE дельты | **Замена** транспорта |
| 13 | Cloud command-plane (edge, 90 RPC) | Supabase остаётся **evidence-plane**: event-log дельты, дашборды, история. Команды — локально. | **Деградация роли облака** |
| 14 | ECDSA подписи/enrollment | Сохранить для облачных каналов; локальный bus — loopback token (уже есть в compute-bridge) | **Сохранение** |
| 15 | DevOS Surface Grid UI | Новый живой вид: Page.startScreencast/CDP-скриншоты вкладок управляемого Chromium в canvas | **Реплика** |

**Чего НЕ теряем (все механики воспроизведены):** вкладки/навигация, semantic perception, actuation с доказательствами, fleet-эластичность по backlog, задачи/лизы/generation floor, keepalive, download manager, gates, fallback-переключение облако↔резерв, session-continuity (cookie-профили Chrome = `--user-data-dir`).

**Что уходит намеренно:** mesh-пиры, Guardian SCM, self-forking update, вкладка-как-единственный-тип-агента, DB-как-автобус.

---

## 4. Выбор оболочки (финал, 2026 факты)

| Критерий | Tauri 2.x | Wails v3 | Neutralino | Electron (статус-кво) | Daemon+Web |
|---|---|---|---|---|---|
| Бандл | **2.5–10 МБ** | ~10 МБ | ~2 МБ | 120+ МБ | 0 |
| RAM | **−75%** | −70% | −75% | база | −80%+ |
| Старт | **~3.7× быстрее** | быстро | быстро | база | мгновенно |
| Rust-ядро для daemon'а в одном бинаре | **да (sidecar)** | Go | нет | Node в main | отдельно |
| Авто-updater подписанный | **встроен** | plugin | нет | electron-updater+кастом | ОС |
| CDP-автоматизация управляемого браузера | **через daemon ✓** | ✓ | ✓ | ✓ (сейчас — через себя ✗) | ✓ |
| Зрелость 2026 | **дефолт для новых десктоп-проектов** | стабильна, экосистема меньше | нишевая | тяжёлая легаси | всегда |

**Решение: Tauri 2 + ME2 daemon (sidecar) + отдельный Chromium.**
- Tauri-окно = только консоль (Next.js билд кладётся в dist, WebView рендерит).
- Daemon = Rust (`chromiumoxide`, `tokio`, SQLite WAL) **или bun** (быстрый MVP: переиспользование 95% существующего чистого Node-кода как есть!).
- Управляемый Chromium = отдельный процесс с `--remote-debugging-pipe` + `--user-data-dir` (cookie-профили платформ сохраняются), вкладки по-demand.
- Критично найденное: в Tauri UI-WebView нет CDP на Linux — поэтому никакой автоматизации через UI-вебвью; весь браузерный контроль из daemon'а. На Windows WebView2 имеет CDP-эндпоинт (tauri-webview-debug), но на него НЕ опираемся.

**Why daemon-first (bun) для MVP:** существующие `native-supervisor-client*`, `fleet-provisioner-core`, `devos-native-task-cycle-core`, `browser-compute` — чистый Node ≥22. bun запускает их сегодня. Rust-версия — этап 3 оптимизации, не блокер.

---

## 5. Архитектура METAENGINE 2

```
┌────────────────────────── Tauri 2 окно (OS WebView) ──────────────────────────┐
│  Консоль ME2 (Next.js static в Tauri): Mission Control                        │
│  [Флот и поверхности] [Live-view Chromium] [Задачи/спеки/диффы/логи/спенд]     │
└───────────────▲ WebSocket push (snapshot v3 совместим) ────────────────────────┘
                │ + REST команды (47-действий контракт сохранён)
┌───────────────┴────────────────────────────────────────────────────────────────┐
│                    ME2 CORE daemon (sidecar, bun→Rust)                          │
│  • Master loop — единый владелец состояния (событийный bus, tokio/EventEmitter) │
│  • Local command bus: 47 действий, 4 полосы, бюджеты — без облака, µs-latency   │
│  • Worker pool: API-воркеры (z.ai API / Vercel AI Gateway / Ollama)             │
│    + platform-воркеры (вкладка чата — для платформ БЕЗ API)                     │
│  • Browser tool: 1 Chromium `--remote-debugging-pipe` (CDP: AX/Input/Screencast)│
│  • Repo map (tree-sitter) · spec-парсер (EARS) · worktree-менеджер              │
│  • Event log: SQLite WAL (created→claimed→running→completed) — журнал истины    │
│  • Secrets: локальный vault + SECURITY DEFINER bootstrap только при старте      │
└───────────────┬─────────────────────────────────────────────────────────────────┘
                │ дельты evidence (batch, не поллинг)
┌───────────────▼─────────────────────────────────────────────────────────────────┐
│  Supabase = evidence-plane: история, дашборды, cross-device, self-update feed    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 5 принципов (из ресёрча 2026)
1. **Агент ≠ вкладка** (Cline-модель): браузер — инструмент воркера; cognition через API-провайдеров; вкладка-чат — legacy-режим для платформ без API.
2. **Один владелец состояния** (Claude Code master-loop): daemon единолично владеет истиной; UI и облако — подписчики event-log. Никаких 3-писателей в одну строку.
3. **Спека вместо чатов** (Kiro/EARS): задачи = spec-файлы; переписка — не канал координации.
4. **Горячий путь локален**: команды/лизы в памяти + SQLite; облако — журнал доказательств (Confluent/MS 2026: event-driven с персистентным логом — единственный устоявшийся паттерн).
5. **Минимальное ядро** (Pi: 418 строк loop'а): <1k строк master loop; всё остальное — плагины-инструменты.

### Аналоги 2026 — финальный список через запятую
Claude Code, Aider, Kilo Code, Cursor, GitHub Copilot, Windsurf, Cline, Continue, Ollama, OpenCode, Codex CLI/Desktop, Kiro, Roo Code, Pi, Kodik, **Browser Use, Stagehand, Skyvern, Playwright MCP, Mission Control, Intent, Sculptor**

### Что берём у каждого (свежее 2026)
- **Browser Use** (21k★, 89% WebVoyager): agent-first фреймворк браузер-контроля — эталон CDP-слоя; его «ditched own framework» пост (07.2026) показывает: тонкий CDP > собственный фреймворк.
- **Stagehand**: stage-based API (act/extract/observe) — повторяем как 3 примитива browser-tool.
- **Skyvern**: vision-first скриншот→действие — fallback, когда AX-дерево врёт (капчи).
- **Playwright MCP**: уже есть MCP-инструменты браузера — совместимость контрактов.
- **Codex Desktop / Intent / Sculptor**: десктоп-оболочки агент-рантаймов — референсы UX (run-лента, диффы, спенд).
- **Mission Control (builderz-labs)**: self-hosted control plane: dispatch/inspect/review/spend — прямой референс консоли.
- Claude Code (master loop + subagents + steering), Aider (repo map, git-native), Kiro (EARS-спеки), OpenCode (75+ провайдеров, одно ядро — много оболочек), Pi (минимализм, состояние=файлы), Cline (human-in-loop, браузер=инструмент), Ollama/Continue (локальные модели для рутин).

---

## 6. Дизайн консоли (новый)

**Стиль:** тёмный (как сейчас #101216 база), но 2026-шный: 3-колоночный Mission Control (Linear-плотность, Raycast-командная палитра, Warp-статус-бар).

```
┌────────────────────────────────────────────────────────────────────┐
│ ⌘K палитра · статус-пилюли: daemon · chromium · провайдеры · спенд │
├──────────────┬─────────────────────────────────┬───────────────────┤
│ ФЛОТ (240px) │ LIVE VIEW (flex)                │ РАБОТЫ (320px)    │
│ ├ воркеры    │  скринкаст активной вкладки     │ ├ задачи по спекам│
│ │  ●running  │  (CDP screencast, canvas)       │ │  EARS-спека     │
│ │  ○idle     │  overlay: semantic targets      │ ├ run-лента       │
│ ├ очереди    │  кнопки: takeover/stop/prove    │ │  created→done   │
│ └ платформы  │  вкладки-стрип внизу            │ ├ диффы/PR        │
│              │                                 │ └ event-log tail  │
├──────────────┴─────────────────────────────────┴───────────────────┤
│ статус-бар: generation · backlog · leases · latency p50/p99 · спенд│
└────────────────────────────────────────────────────────────────────┘
```
- Скринкаст вкладок вместо встраивания Chromium в окно (решает проблему Tauri-WebView-CAP).
- ⌘K палитра = все 47 действий как команды (Raycast-паттерн).
- Run-лента + event-log tail (Mission Control паттерн): каждая задача = created→claimed→running→completed с доказательствами.
- Спенд-пилюля по провайдерам (Codex Desktop паттерн).
- Takeover-кнопка (Ctrl+Shift+H механика сохраняется).

---

## 7. Дорожная карта

| Этап | Срок | Что делаем | Результат |
|---|---|---|---|
| **M1 daemon-MVP** | 3–5 дней | bun-daemon: master loop + command bus (47 действий) + browser-tool (перенос browser-compute) + SQLite event-log + WS push | Консоль в браузере видит флот и вкладки, команды µs |
| **M2 консоль** | 3–4 дня | Next.js Mission Control UI (скринкаст, флот, задачи, спеки, ⌘K) | Полная замена текущего UI |
| **M3 Tauri 2** | 2–3 дня | Tauri-оболочка (sidecar daemon, updater, ⌘K глобально) | Десктоп-приложение 10 МБ |
| **M4 воркеры-API** | 3–5 дней | API-провайдер слой (Vercel Gateway/z.ai API/Ollama) + EARS-спеки + repo map | Уход от вкладка-агентов на API-платформах |
| **M5 evidence-bridge** | 2 дня | Дельты в Supabase (batch), дашборды, совместимость старых данных | Облако = журнал |
| **M6 Rust-ядро** | 1–2 нед | Порт daemon на Rust/chromiumoxide (опционально, если bun-упирается) | Один статический бинарь |

**Итого: рабочий ME2 без Electron — ~2 недели (M1–M3), полная функциональность — ~3–4 недели.**

---

## 8. Новые источники (сессия 2026-09-22, research/2026/s15–s20)
- respan.ai — Browser Use vs Stagehand (21k★, 89% WebVoyager)
- scrapfly.io / bytetunnels.com / skyvern.com — Browser Use vs Stagehand vs Skyvern 2026
- nohacks.co — Agentic Browser Landscape 2026 (полный ландшафт)
- github.com — «Linux: no CDP, no automated UI verification of a Tauri app» (критическая находка)
- tarai.dev — tauri-webview-debug (WebView2 CDP endpoint — только Windows)
- mayhemcode.com / digitalapplied.com / tech-insider.org — Tauri 2 в 2026: 96% меньше, −75% RAM, дефолт для новых
- teamdev.com — Top 5 Electron alternatives 2026 (MōBrowser, Electrobun, NW.js)
- dev.to — Puppeteer in Rust 2026: chromiumoxide №1; lib.rs — cdpkit type-safe
- augmentcode.com — 9 Best AI Coding Agent Desktop Apps 2026 (Codex Desktop, Intent, Sculptor)
- promptquorum.com / github builderz-labs — Mission Control: self-hosted control plane 2026
- confluent.io — Agentic Event-Driven Systems Architecture 2026
- arxiv.org — Orchestration of Multi-Agent Systems (2026)
