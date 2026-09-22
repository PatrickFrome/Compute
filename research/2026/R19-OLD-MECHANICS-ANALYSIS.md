# R19 — Полный анализ механик старой системы (A2 / MetaEngine) → интеграция в ME2

Дата: 2026-09-22 · Источники: `src/app/api/mechanics/route.ts` (канонический реестр M1–M18),
`src/lib/browser-tools.ts`, `src/lib/fleet-plane.ts`, `src/lib/cloud.ts`, `src/lib/probe-device.ts`,
`src/lib/fallback-console.ts`, `api/fleet/*`, `api/agent-factory/*`, `api/cognitive|reflect|emergency|enrollment|wake-test`,
`mini-services/agent-factory/*`, `mini-services/a2-edge-local/`, `a2-capsule/**`, `src/me2-watchdog.ts`.
Метод: чтение легаси-кода + Explore-свип всего дерева + сверка с реестром M1–M18 (15 WORKS / 1 DECOR / 2 CAVEAT).

## 0. Карта «старое → новое» (что и куда интегрировано в daemon v0.19.0)

| Старая механика | Старый вердикт | Файлы старой системы | Новая механика ME2 | Модуль v0.19.0 | Улучшение |
|---|---|---|---|---|---|
| M13 Episodic memory (in-process JSON, ≤5 эпизодов / 900 ток. / TEAM MEMORY ≤1400) | **CAVEAT** (R6: без persistence-пруфа) | браузер-сайд `#advanceTaskOutcomeFor`/`#memoryBlockFor` (репо браузера), `reflect` route | **ME4 MEMORY** | `src/memory.ts` | SQLite-таблица с UNIQUE(kind,key) = идемпотентная материализация (аналог `terminal_task_immutable`), score-поиск (важность×свежесть×hits×match), auto-материализация терминальных задач/вердиктов/уроков из event-шины, persistence-пруф в `/memory` |
| M12 Cognitive delta bus (T9/T10, cursor watermark) | WORKS | `api/cognitive/route.ts` | **ME5 BRAIN** | `src/brain.ts` | LLM-ядро: реколл памяти (memSearch+touch) → строгий JSON-план {summary, steps, risks} → мысль сохраняется в память; само-проба (eventloop_ms) вместо NOTIFY-пробы |
| M2/M3/M8/M10/M11 Fleet governor + task cycle + transport-proof + keepalive/mesh | WORKS | `fleet-plane.ts`, `api/fleet/*`, `devos_fleet_*_v1` RPC | **ME6 FLEET** | `src/fleet.ts` | Реестр нод: BOUND→ACTIVE только с proof (порт M8 transport-proof), freshness ACTIVE<45s / STALE<300s / LOST (порт 45s-контракта), self-node daemon с авто-beat 15s (liveness-проекция, урок CP-W1), backlog из шины задач |
| M15 Self-update (hint→discovery→barrier→rollback, journal v8, 12-field proof) | WORKS | браузер-сайд + `api/me2/boot`, watchdog'и | **ME7 SELF-UPDATE** | `src/selfupdate.ts` | check (ls-remote+fetch+rev-list: BEHIND/AHEAD/DIVERGED) → apply (барьеры: dirty-tree, ff-only, diverged-refuse) → journal в SQLite; токен только из `/home/z/.a2/.github.env`, маскируется в выводах; bounded re-probe вместо одноразового окна (урок 13.5h-тупика) |
| M14 RSI runtime (91 модулей, operator-gated promotion) | **CAVEAT** (R9: промоушен за гейтом) | браузер-сайд, `a2-capsule/reports/ROADMAP_NEXT.md` | **ME8 RSI** | `src/rsi.ts` | propose (evidence = уроки памяти + RH-вердикты → LLM-черновик) → adopt/reject оператором (zero-authority) → артефакт `skills/rsi/<id>.md` + rollback; event-sourced (RSI_* события + спаны) |
| M1–M18 реестр механик (живые пробы) | WORKS | `api/mechanics/route.ts` | **ME-матрица** | `src/mechanics.ts` | ME1–ME16: вердикты считаются из реального состояния daemon (actions/seq/memory/fleet/selfupdate/rsi/spans/roadmap), каждая строка несёт old_ref на M1–M18 |
| M4 Command plane (lanes, receipts, idempotency) | WORKS | `cloud.ts`, command-таблица | уже в ядре ME2 (шина 4 полосы, budget 24/60s, idempotency_key) | — | инвариант 47/47 не тронут |
| M5 Wake (PG NOTIFY glm_browser_pulse, 3–13ms) | WORKS | `api/wake-test/route.ts` | не портируется 1:1 (нет PG) — wake = event-listeners шины (мгновенно in-proc) | — | проба латентности перенесена в brain.self_probe (eventloop_ms) |
| M7/M8 Emergency lane + device identity P-256 | WORKS | `api/emergency`, `probe-device.ts` | lane EMERGENCY уже в шине; device identity не нужен (single-plane) | — | — |
| M16–M18 (seed-first, poisoned-tab self-heal, wedge hardening) | WORKS | браузер-сайд | перенесены принципы: bounded awaits, heartbeat≠liveness → fleet freshness + workers reaper | — | — |

## 1. Ключевые уроки старой системы (перенесены в дизайн v0.19.0)

1. **Episodic memory без persistence-пруфа декоративна** (M13 CAVEAT, gap R6) → ME4 хранит в SQLite WAL,
   `/memory` отдаёт `persistence_proof` (rows, oldest, db_bytes).
2. **Секвенсы — из watermark, не из локального счётчика** (урок cognitive bus) → episode-key = `task:<id>`
   с ON CONFLICT — повторная материализация не плодит дубли.
3. **Transport-proof до ACTIVE** (M8) → fleet-node без proof остаётся BOUND.
4. **Heartbeat ≠ liveness** (CP-W1 zombie: 2s heartbeat при мёртвом lease-loop) → freshness считается от
   `last_seen` (45s/300s пороги), self-node бьётся каждые 15s.
5. **Bounded re-probe вместо одноразового окна квалификации** (self-update 13.5h тупик) → apply можно
   повторять; check кэшируется 30s.
6. **Timeout ≠ NO_EFFECT_PROVEN**; каждый await ограничен → все git/fetch вызовы с timeout, fail-closed.
7. **Zero-authority**: RSI-промоушен и self-update apply — только оператор (ручной вызов REST), авто только propose.
8. **Хардкод id в cleanup ведёт к стейлу** → protected-set выводится из живого состояния.

## 2. Что НЕ переносится и почему

- Supabase/Pigsty-плоскость (`pg.ts`, `cloud.ts`, RPC `devos_*`/`h205f22_*`) — локальный plane уже
  полнее (блокированные PGRST205-зависимости), зеркалирование — вне sandbox.
- P-256 device identity + enrollment (M8/M9) — в single-plane daemon HTTP-подписи не нужны; при появлении
  внешних нод — порт схемы `A2_DEVICE_HTTP_SIGNATURE_V1` (canonical JWK → sha256 fingerprint).
- Fallback sentinel hysteresis (`fallback-console.ts`) — полезный паттерн, но применим к облаку, которого нет.
- Browser automation (`browser-tools.ts`: semantic_ref, CAPTURE→act→verify) — ME2 уже имеет 47 действий шины
  включая BROWSER_*; semantic-адресация — кандидат v2 на codegraph-слое, не ядре.

## 3. Реестр новых REST v0.19.0 (все вне шины — maintenance-плоскость, 47/47 инвариант сохранён)

- `GET /memory?q&kind&limit` · `POST /memory {op:write|delete,...}` · `GET /memory/block?n&budget`
- `GET /brain` · `POST /brain/think {goal}`
- `GET /fleet` · `POST /fleet/beat {id,kind?,caps?,meta?,proof?}`
- `GET /selfupdate` (check кэш 30s) · `POST /selfupdate {op:check|apply}`
- `GET /rsi` · `POST /rsi {op:propose|adopt|reject|rollback}`
- `GET /mechanics` — живая матрица ME1–ME16 с old_ref.

## 4. Авто-хуки памяти (событийная шина → материализация)

- `TASK_DONE` → episodic `task:<id>` (outcome COMPLETED, digest=result, importance 0.7)
- `TASK_FAILED` → episodic `task:<id>` (FAILED, error+cause, importance 0.85 — провалы ценнее)
- `TASK_REWARD_HACK` → semantic `rh:<task>` (эвристики, importance 0.9)
- `TASK_REFLECTED` → semantic `reflect:<task>` (tier-2 урок → `retry_memory` для потомков)
