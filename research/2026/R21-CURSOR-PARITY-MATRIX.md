# R21 — CURSOR CAPABILITY PARITY MATRIX (P0 deliverable v1)

Round: R21 · 2026-09-24
Метод: строка = механика ME1–ME18 (живой реестр daemon `/mechanics`), столбец
Cursor = публично документированная/подтверждённая способность Cursor.
Дисциплина §34: parity-оценка Cursor-стороны ТОЛЬКО по датированным источникам
(s-свайпы research/2026/); отсутствие публичного свидетельства ≠ «у Cursor нет»
→ маркируем `UNKNOWN`, не `SUPERIOR`.SUPERIOR не используется в v1 (нет ни одной
строки с двусторонним evidence).

Легенда parity: `PARITY` — обе стороны имеют подтверждённую способность;
`PARTIAL` — наша сторона уже/ограничена против задокументированной Cursor;
`MISSING` — у Cursor документировано, у нас нет; `UNKNOWN` — Cursor-сторона не
подтверждена источниками; `N/A` — Cursor-аналог не применим.

| ME | Механика (verdict live) | Cursor-аналог | Parity | Наш evidence | Источник (Cursor) | Conf |
|----|--------------------------|---------------|--------|--------------|-------------------|------|
| ME1 | Command bus: 4 полосы, бюджет, idempotency (WORKS, 47/47) | Tool-call loop агента (Composer/Agent) | PARITY | R9–R20 live | s6 daily.dev Mar 26 2026 | MED |
| ME2 | Event-log hash-chain (WORKS) | — | UNKNOWN | seq+chain live | нет публичных доков | LOW |
| ME3 | Agent loop: воркеры+задачи+Reflexion (WORKS) | Agent mode (автономные прогоны) | PARITY | R10–R13 live | s6 devopstales Mar 19 2026 | MED |
| ME4 | MEMORY SQLite (episodic/semantic/procedural, auto-materialize) | Memories / Rules | PARTIAL | R19 persistence-пруф | s6 aidevme Apr 27 2026 (Cursor optimization fork) | MED |
| ME5 | BRAIN: LLM-ядро + реколл (WORKS) | Composer/Chat LLM | PARITY | R19 think live | s6 daily.dev | MED |
| ME6 | FLEET: реестр нод + transport-proof (WORKS, 1 нода) | — (мультиагентность Cursor не документирована публично) | UNKNOWN | R19 fleet live | нет | LOW |
| ME7 | SELF-UPDATE ff-only+journal (CAVEAT: NO_TOKEN) | Auto-update (Squirrel/NSIS — Electron-стек) | PARTIAL | R19/R21 | общедоступное поведение VS Code-форков | HIGH |
| ME8 | RSI propose→adopt→rollback (CAVEAT: 0 proposals) | — | UNKNOWN | R19 | нет | LOW |
| ME9 | Code Graph regex-v1 (WORKS: 113 файлов/185 рёбер) | Codebase indexing (@codebase, embeddings — официально) | PARTIAL | R16 live | s6 + официальная известность фичи | MED |
| ME10 | Worktrees+rerere (WORKS) | — | UNKNOWN | R16 live | нет | LOW |
| ME11 | Sandbox plane (prlimit+snapshot) (WORKS) | — | UNKNOWN | R17 lifecycle live | нет | LOW |
| ME12 | OTel-lite + OTLP (WORKS) | — | UNKNOWN | R16 live | нет | LOW |
| ME13 | Screencast MJPEG :3042 (WORKS) | Browser agent (анонсирован) | PARTIAL | R15 live | announced≠available (§34) | LOW |
| ME14 | LIVE roadmap verdict (WORKS 7/7) | — | UNKNOWN | R17 live | нет | LOW |
| ME15 | Reward-hacking verdicts tier-1 (WORKS) | — (bugbot ≠ runtime RH-детектор) | UNKNOWN | R18 bait пойман | нет | LOW |
| ME16 | Evidence+providers (WORKS) | — | UNKNOWN | R19 live | нет | LOW |
| ME17 | Semantic browser sense CAPTURE→act→verify (CAVEAT: 0 tabs) | Browser/computer-use (анонсирован) | PARTIAL | R20 verify-revision live | announced≠available (§34) | LOW |
| ME18 | Electron client shell (sidecar+secure window) (WORKS: code+CI) | VS Code fork shell (полный продукт) | PARTIAL | R21 skeleton+CI | s6 visualstudiomagazine Jan 26 2026 | HIGH |

## Сводка

- PARITY: 3 · PARTIAL: 6 · UNKNOWN: 9 · MISSING: 0 · SUPERIOR: 0 (§34: нет двусторонних evidence)
- Крупнейшие честные MISSING-кандидаты для P1 (у Cursor документировано, у нас нет):
  **встроенный редактор/дифы** (Cursor: редактор кода), **Tab-автодополнение**
  (Cursor Tab — официально), **@codebase embeddings-поиск** (ME9 → tree-sitter+embeddings).
- Все `UNKNOWN` превращаются в `PARITY/PARTIAL/MISSING` только после R22-свайпов
  официальных доков Cursor (docs.cursor.com) — не раньше.

## Dependency DAG (вершины следуют из матрицы)

```
P0 client-shell (R21, эта сессия) ─┐
ME9 tree-sitter+embeddings ────────┼→ P1 core parity (editor/diff/tab-complete/codebase-search)
ME17 browser sense + client tabs ──┤
                                   └→ P2 agent runtime (chat/composer поверх шины ME1)
P2 → P3 fleet(>1 нода) → P4 computer-use → P5 automation → P6 self-heal → P7 RSI → P8 self-update → P9 beyond
```
