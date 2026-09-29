# R12 Research — Tier-1 Failure-Modes (8 режимов) · 2026-09-22

Контекст: R11 закрыл авто-tier-2 с квотой и /metrics. Пункт backlog R11 №1: «CAUSE-таблица tier-1 на 8 failure-modes (step_loop/context_overflow детекция)». Цель — детерминированные детекторы новых режимов (без LLM-расходов), усиление эпизодической памяти ретраев.

## Находки web_search (r12-failmodes.json)

1. **«LLM Agentic Failure Modes: Task Drift, Reward Hacking, …» (Apr 2026)** — «Eight LLM failure modes that surface only in agent and tool-use systems. Mechanism and defense for task drift, incorrect tool invocation, reward hacking…» → подтверждает сам факт таксономии из 8 режимов и называет ключевые: task drift, incorrect tool invocation, reward hacking.
2. **«Agent Drift: Quantifying Behavioral Degradation in Multi-…» (Jan 2026)** — behavioral drift = прогрессирующее отклонение паттернов решений; для мультиагентных систем это отдельный класс сбоев, плохо детектируемый по одиночным ошибкам → нужен сигнал по ПОСЛЕДОВАТЕЛЬНОСТИ действий, не по тексту исключения.
3. **«AI agent failure modes in production: Detection playbook» (Mar 2026)** — production-подход: таксономия → кластеризация → triage → regression gates. Наш tier-1 = дешёвый «кластеризатор» на сигнатурах шагов; /metrics (R11) = regression-метрика.
4. **WLLMA FAIL — Agent Error Taxonomy** — модульная классификация: memory / reflection / planning / action / system-level → наши причины покрывают action-level (инструменты) и planning-level (drift/loop); memory/reflection-level — вне scope (нет персистентной памяти агента).

## Маппинг таксономии на детерминированные детекторы ME2

| Режим (литература) | Детектор ME2 (v0.12.0) | Сигнатура |
|---|---|---|
| step_loop / behavioral loop | `sigStats.top.n >= 3` | одна сигнатура `tool:args` ≥3 раз из всех вызовов |
| task drift | `total>=6 && writes==0 && distinct>=4` | много разнообразных read-only действий, ноль артефактов |
| context overflow | паттерны текста ошибки | «context length», «too large», «413», «token limit»… |
| incorrect tool invocation | сигнал `tool_errors` (наблюдение, не вердикт) | observation.startsWith("ERROR:") |
| protocol violations | `parseFails>=2` + старые keyword-паттерны | шаги ушли на репарс |
| budget exhausted | max_steps_exhausted без аномалий | остаточная категория после уточнений |
| reward hacking | **НЕ реализован** (нужна верификация результата против spec — backlog) | — |
| memory failures | **НЕ реализован** (нет персистентной памяти) | — |

Приоритет диагноза (max_steps путь): overflow → protocol(parseFails) → loop → drift → budget. На исключениях: overflow → provider → path → protocol → loop → drift → runtime_error.

## Что изменено в v0.12.0

- `worker.ts`: `ReflectCtx` (toolCalls+parseFails собираются в runAgentTask), `sigStats()`, `OVERFLOW_PATTERNS`; buildReflection v2 — 8 причин + блок `signals` (loop_top/tool_calls/distinct/writes/tool_errors/parse_fails) в JSON рефлексии; TASK_FAILED теперь несёт реальный cause из рефлексии (раньше на max_steps жёстко «budget_exhausted»).
- `page.tsx`: CAUSE_RU +3 («цикл действий», «переполнение контекста», «дрейф задачи»), строка сигналов в amber-блоке tooltip.

## Честные ограничения

- drift-детектор эвристичен: read-only задача (отчёт) без write даст ложный drift — но она обязана вызвать finish; если не вызвала, бюджет и так исчерпан, т.е. вердикт «исследовал и не произвёл» честен.
- context_overflow живьём не воспроизводится на малых задачах (провайдер не отдаёт такие ошибки) — детектор покрыт юнит-пробой на реальном коде (см. worklog R12).
- reward_hacking/incorrect_tool_invocation как ВЕРДИКТ отложены: требуют семантики проверки результата (фаза M3+/A/B-контур).
