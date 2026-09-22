# R10 · Tier-2 LLM-рефлексия + окно ВЕТКИ — ресёрч и внедрение

Дата: 2026-09-22 · Сырьё: r10-llm-reflect.json, r10-reflexion2.json, r10-virtual.json (web_search, z-ai CLI)
Контекст: R9 закрыл tier-1 (детерминированный диагноз в tasks.reflection) + retry-память. Бэклог: «tier-2 вербальная LLM-рефлексия».

## 1. Reflexion-направление (главное)

- **Reflexion (Shinn et al., 2023; 7700+ цитирований)**: вербальная рефлексия о провале = эпизодическая память для следующей попытки. 91% pass@1 на HumanEval; Reflexion+ReAct — 53% success против 32% у базового ReAct. Инсайты хранятся от попытки к попытке — наш `parentMemory()` реализует ровно этот перенос.
- **«The Reflection Loop» (2026)**: самоулучшающийся агент работает, когда шаг критики **конкретен и проверяем**, а не «подумай лучше». Наш tier-2 промпт требует: 1 конкретный урок + 1 конкретное действие (fix) — соответствует.
- **«Evaluating LLM Self-Reflection Loops» (2026)**: рефлексия иногда улучшает, иногда **ломает** результат; нужен pre-vs-post delta-контроль. Вывод для ME2: tier-2 — **по требованию оператора** (кнопка ✦), не автоматически на каждый провал; tier-1 остаётся всегда-пишущимся (он бесплатный и детерминированный).
- **AgentFixer (2026)** и «LLM Agentic Failure Modes» (8 режимов: task drift, reward hacking…): конвейер «детект → диагноз → фикс» — наш контур «tier-1 cause → LLM lesson → fix → retry_memory» ложится в этот паттерн; расширение таблицы CAUSE на 8 режимов — кандидат бэклога.

## 2. Виртуализация длинных списков

- Issue «perf: virtual rendering for large task lists (100+)» (фев 2026): списки задач 100+ деградируют без виртуализации — общее место агентских дашбордов.
- Решение ME2: SVG-граф ВЕТКИ масштабируется viewBox'ом (px-виртуализация по scrollTop потребовала бы отказа от responsive-масштаба), поэтому выбрано **окно 60 ветвей**: старшие строки скрываются за toggle «показать все» — DOM не растёт, merge-дуги считаются по видимому окну, полный список остаётся доступным по клику. При 50+ задачах совокупные узлы SVG ~600 — безопасно.

## 3. Внедрение (v0.10.0)

- **daemon v0.10.0**: REST `POST /tasks/:id/reflect` (enrichment, НЕ шина — реестр остаётся 47/47): мержит `llm:{lesson,fix,model,at}` в tasks.reflection (tier-1 сохраняется), emit `TASK_REFLECTED`.
- **/api/reflect (Next.js backend)**: z-ai-web-dev-sdk (LLM skill) → промпт-контракт «строго JSON {lesson,fix}, по-русски, конкретно» → loose-парс (срез ```-фенсов) → запись в daemon. Server-side fetch :3041 без gateway.
- **worker.ts parentMemory усилен**: ретрай-потомок теперь получает и **вербальный урок** LLM (+fix), а не только tier-1 — полный Reflexion-перенос.
- **Консоль**: кнопка ✦ (violet) на FAILED/CANCELLED строках ВЕТКИ + кнопка «llm-урок» в панели детали; фиолетовый блок «llm-рефлексия · tier-2» в tooltip (урок + → fix); спиннер ◌ на время генерации; toast с урезанным уроком. TASK_REFLECTED пушит снапшот по WS — tooltip обновляется сам.

## 4. Живая верификация

- `POST /api/reflect {taskId: tk_mucmc067kuh9tb}` → 1.85s → `{ok:true, lesson:"Агент не смог выполнить все три шага за отведённые два…", fix:"Увеличьте максимальное количество шагов до трёх…"}`.
- tasks.reflection: tier-1 (cause/what/hint) **и** llm-блок рядом; событие TASK_REFLECTED seq 513.

## 5. Бэклог после R10

- Tier-2 в конвейере retry: авто-вызов LLM-рефлексии при TASK_RETRY от FAILED (требует защиты от спама LLM — бюджет/квота).
- CAUSE-таблица на 8 agent-failure-modes (task drift, reward hacking…) в tier-1.
- Pre-vs-post delta: пассивная метрика «pass-rate ретраев с llm-уроком vs без» — из событий шины.
- per-client jpeg-качество стрима; M3 Tauri 2 externalBin; SQL-миграция me2_evidence (оператор).
