# METAENGINE Development OS — Анализ плана + синтез с ME2 blueprint
Дата: 2026-09-22 · Анализ входного плана (Dev Cockpit / Code Intelligence / Agent Fabric / Sandbox / Build Fabric / Observability / Resilience) на стыке с код-аудитом 108k строк и ресёрчем-2026.

---

## ВЕРДИКТ

План **сильный и на ~80% принимается**, но в нём **4 слепых пятна**, которые повторят текущие боли (медленность/конфликтность), если не поправить:

1. **Нет разделения горячий/холодный путь.** План делает Supabase-координацию P0 («durable DB task/claim plane — агенты сами находят работу») — это тот же DB-как-автобус, что даёт 4s-поллы, lease-гонки и 411 AMBIGUOUS сегодня. Поправка: **локальный command bus + SQLite WAL — первичны**, Supabase — durable-зеркало (дельты, batch). Аналогия Temporal в плане верная, но её идеи (event history, effect boundary) надо реализовать в локальном event-log, а не в облаке.
2. **Оболочка не решена.** План строит «внутри Browser» (Electron). Аудит: 95% кода — чистый Node; P0 «Transactional A/B self-update (PR #103)» — это **чинка того, что Tauri 2 updater даёт бесплатно**, и весь Resilience Plane (A/B updater, crash-loop breaker, session store, 3,641+3,762 строк) в новой оболочке **вырождается в ~50 строк**. Строить Development OS внутри умирающей оболочки = двойная работа.
3. **Windows-реальность sandbox.** gVisor и Firecracker — Linux-only. Девайс — Windows (NSIS/SCM). План молчит об этом. Поправка: Vercel Sandbox (облако, snapshots) — да; локальные microVM — только через WSL2/Hyper-V или remote worker; в роадмапе это отдельный риск.
4. **Агент остаётся вкладкой чата.** Для Development OS когниция должна прийти через API-воркеров (z.ai API / Vercel AI Gateway — ключ уже есть, Ollama локально) с worktree-доступом к коду. Вкладка-чат остаётся только для web-only платформ и капч. Иначе Monaco+LSP ничего не даст агенту, который живёт в чате z.ai.

---

## ЧТО В ПЛАНЕ ПРАВИЛЬНО (принимается полностью)

| Пункт плана | Подтверждение |
|---|---|
| Git worktree per agent + rerere | Дёшево, снимает checkout-конфликты флота; сочетается с generation floor |
| Tree-sitter + LSP Code Graph | Даёт R10 детерминированный источник капсул; экономия токенов 5–20× |
| Monaco + xterm.js в консоли | Работают в ЛЮБОМ webview (Tauri в т.ч.) — это просто JS-библиотеки |
| Единая Capability API над CDP/Playwright/BiDi | Совпадает с моей матрицей переноса №4: контракт 47 действий сохраняется, транспорты — адаптеры |
| Stagehand как resolver plugin, не executor | Верно — иначе второй authority plane |
| WebMCP без authority (R12 taint выше) | Верно, кандидат→taint→revalidation→lease→effect |
| MCP как Developer Tool Bus (спека 2026-07-28) | Верно; MCP-инструменты → capability objects |
| Vercel Sandbox (Firecracker, snapshots) как DP2 | Да; snapshots = checkpoint окружения |
| Perfetto только sidecar (приватность) | Верно: URLs/заголовки не в shared DB |
| OTel + R13 canonical trace | Верно: R13 hash-chain уже есть |
| Bazel/REAPI/sccache как P2 | Согласен, рано; сначала incremental impact graph + sccache |
| НЕ внедрять: Stagehand-замена, Temporal-дубль, LangGraph/CrewAI, Browserbase-пул, BiDi-вместо-CDP | Полностью согласен + аудиторское подтверждение |

## СТЫКОВКА С ME2 BLUEPRINT (кто кого содержит)

План Development OS и blueprint ME2 — **одна система на разных уровнях**:

```
METAENGINE DEVELOPMENT OS  (= ME2)
│
├── Оболочка: Tauri 2 + консоль (Next.js static)      ← blueprint M2/M3
│   └── Development Cockpit: Mission Control + Monaco + xterm.js + Git graph
│       (план «внутри Browser» → переносится в консоль 1:1, webview-агностично)
│
├── ME2 daemon (bun→Rust) — хозяин состояния           ← blueprint M1
│   ├── Локальный command bus (47 действий, 4 полосы)  ← план «Unified Capability API»
│   │   └── адаптеры: CDP-pipe (primary) / Playwright / BiDi-shadow
│   ├── Code Intelligence: tree-sitter + LSP + symbol graph (в daemon'е)
│   ├── Worktree Workspace Manager (plan §2)
│   ├── Worker pool: API-воркеры + platform-воркеры    ← исправление слепого пятна №4
│   ├── Sandbox plane: Vercel Sandbox backend (+WSL2 gVisor позже)
│   ├── Build fabric: impact graph + sccache (Bazel — P2)
│   └── SQLite WAL event-log = Temporal-идеи локально
│
├── Agent Fabric: R10/R11/R12 + C5 из RSI (42.9k ln чистого Node)  ← план §4, перенос почти без изменений
│
├── Durable Coordination: Supabase = ЖУРНАЛ (дельты, evidence, дашборды) ← исправление №1
│   └── task/claim/evidence остаётся, но claims выдаёт daemon, не SQL-гонка
│
└── Observability: OTel + R13 (+Perfetto sidecar)      ← план §11
```

## ЕДИНЫЙ РОАДМАП (синтез плана и blueprint)

| Фаза | Срок | Содержимое | Закрывает |
|---|---|---|---|
| **M1 Daemon core** | 3–5 дн | command bus (47/4), browser-tool (CDP pipe из browser-compute), SQLite event-log, WS push | Униф. Capability API (P1), горячий путь |
| **M2 Консоль-IDE** | 5–7 дн | Mission Control 3 колонки + **Monaco + xterm.js + tree-sitter graph** | Development Cockpit (P0-IDE) |
| **M3 Tauri 2 shell** | 2–3 дн | sidecar daemon, Tauri updater, ⌘K глобально | **Self-update P0 бесплатно**, Resilience Plane вырожден |
| **M4 Worktree Manager** | 2–3 дн | worktree per agent + branch/claim/semantic point + rerere | P0-воркспейсы |
| **M5 Sandbox plane** | 3–4 дн | Vercel Sandbox backend + snapshot-подготовка toolchain + candidate executor | DP2 (P1) |
| **M6 Agent Fabric live** | 5–7 дн | R10/R11/R12 перенос + API-воркеры (Vercel Gateway/z.ai/Ollama) + durable assignments | P0-координация, P1-R10/R11/R12 |
| **M7 Observability** | 2–3 дн | OTel + R13 + Perfetto sidecar | P1-наблюдаемость |
| **P2 (позже)** | — | Bazel+REAPI+BuildGrid · MCP gateway+A2A · BiDi full · gVisor/Firecracker self-host | — |

**Итого до «Browser сам развивает Compute» (COMPUTE_UNIFIED_AUTONOMOUS_CONVERGENCE): ~4–6 недель**, при этом первые 2 недели дают рабочий daemon+IDE+Tauri без Electron.

## ТОП-4 ТЕХНОЛОГИИ СТАРТА (план называл 3 — добавляю 4-ю)

1. **Git Worktree Workspace Manager** — согласен, самое дешёвое с наибольшим эффектом.
2. **Tree-sitter/LSP Code Graph** — согласен, усилитель R10.
3. **DP2 snapshot sandbox** (Vercel Sandbox) — согласен, свобода агентам без риска хоста.
4. **(+ME2) Локальный command bus + SQLite event-log** — без него пп.1–3 снова упрутся в 4s DB-полл и AMBIGUOUS-гонки; это урок, оплаченный полугодом инцидентов.

## ЧТО НЕ ВНЕДРЯТЬ (согласен с планом + дополнение)

- Stagehand/Browserbase как основной браузер · Temporal как второй scheduler · LangGraph/CrewAI/AutoGen как fleet manager · BiDi вместо CDP сейчас.
- **+ME2:** не строить Development OS внутри Electron-оболочки (перенос потом дороже); не делать облако координатором горячего пути; не плодить второй browser pool (R15/B6 остаётся).

## ОТКРЫТЫЕ РИСКИ

- Windows+gVisor/Firecracker: только WSL2/облако — проверить бюджет Vercel Sandbox при 10–30 агентах.
- MCP-спека 2026-07-28 ещё churn — gateway держать тонким.
- Перенос R10/R11/R12 (42.9k) — самый большой объём работ; начать с R10 (Context Compiler) как критического пути.
- Переходный период: старый Browser жив (keepalive mesh держит DB-план) — параллельная работа до M3, потом старый plane консервируется.
