# R11 · Roadmap: авто-tier-2 с квотой + pass-rate метрика + окно 60+ — ресёрч и внедрение

Дата: 2026-09-22 · Сырьё: r11-auto-reflect.json, r11-metrics.json (web_search, z-ai CLI)
База: R10 (tier-2 ✦ вручную, окно 60, daemon v0.10.0). Выбрано из бэклога: авто-рефлексия при ретрае, метрика Reflexion-эффекта, load-test окна.

## 1. Авто-самокоррекция и infinite loops (ресёрч)

- **«Uncovering Infinite Agentic Loops» / «How to Stop AI Agent Infinite Loops: Two-Tier»**: самокоррекция без квоты порождает бесконечные платные циклы; рабочий рецепт — двухуровневый гард (rate-limit на попытку + лимит параллельных) и stop-условие по факту наличия результата.
- **«Self-Correction Loops for AI Agents» (Arthur)**: авто-коррекция полезна, когда (а) триггер — фактический провал, (б) результат коррекции записывается в наблюдаемое хранилище, (в) есть бюджет попыток. Иначе — выжигание токенов.
- Вывод для ME2: авто-tier-2 вешается на **единственный** момент TASK_RETRY (триггер = реальный провал), с гардом: 1 попытка/10 мин/задача + ≤2 in-flight + skip при существующем уроке. Fire-and-forget — команда ретрая не блокируется.

## 2. Метрики памяти агентов (ресёрч)

- **«State of AI Agent Memory 2026» / «Evaluating Memory in LLM Agents via Incremental…»**: память (эпизоды, уроки) оценивают через прирост success-rate с памятью vs без — ablation-подход; бенчмарки двигаются от «память есть» к «память помогает».
- Вывод: пассивная метрика из шина-данных (без инструментирования агентов): pass-rate ретраев, чей родитель имеет llm-урок, против ретраев без урока. Дешёво (SQLite-агрегат), честно ( observational, не рандомизированный A/B — ограничение зафиксировано в доке).

## 3. Внедрение (daemon v0.11.0)

- **Авто-tier-2**: commands.ts TASK_RETRY после TASK_RETRIED зовёт `void autoReflect(orig)` — POST /api/reflect {source:"auto_retry"}; гарды: cooldown-Map 10 мин, in-flight ≤2, skip если reflection.llm.lesson уже есть; AbortSignal 20s; ошибки молча (ручная ✦ остаётся). Цепочка: source прокидывается /api/reflect → daemon REST reflect → store.setTaskReflectionLlm → llm.source; TASK_REFLECTED несёт source («auto_retry» | «operator»).
- **GET /metrics** (READ_ONLY- observational): по всем задачам с parent_id — hasLlm(parent) × COMPLETED(child) → {with_lesson:{n,completed,rate}, without_lesson:{...}}. Без новых действий шины (реестр 47/47 не тронут).
- **Консоль**: чип в хедере ВЕТКИ «↳ X/Y с уроком · X2/Y2 без» (violet-акцент, poll 20s, скрыт при retries=0 — честно); в tooltip llm-блока бейдж «авто» (fuchsia) при source=auto_retry.
- **Загрузочное окно ВЕТКИ проверено живьём**: 59 load-задач (role=LOADTEST — воркеры их не берут, nextReadyTask матчинг ролей) + 16 реальных = 75 строк; toggle «показать все» ↔ «свернуть», 60→75 строк DOM; бюджет 24/60s честно ограничил скорость загрузки (11 задач за окно) — поднял BUDGET_ADJUST до 96, вернул 24 после. Очистка: 59×TASK_CANCEL → TASK_PURGE all_terminal (75 purged — включая старые probe; hash-chain events хранит историю).

## 4. Живая верификация

- **Авто-рефлексия end-to-end**: TASK_RETRY tk_muc63xqbcd6agu → потомок tk_mucodfgum161ol; через 8s у родителя llm {lesson:"Неэффективное использование шагов: попытка выполнить несколько write_file за оди…", source:"auto_retry", model:"glm"}; события: TASK_RETRIED seq 557 → TASK_REFLECTED seq 561 (source:auto_retry) ✓.
- **/metrics**: после двух ретраев-с-уроком: retries=2, with_lesson 2/2 (100%); чип в UI «↳ 2/2 с уроком · 0/0 без» (r11-01); после purge честно 0 → чип скрыт.
- **Load-test**: 75 строк в DOM при открытом окне; label «все 75 ветвей / свернуть» ✓ (r11-01).
- **Smoke после purge**: задача «r11-smoke.txt» → COMPLETED 3/3, result «r11-ok» — шина здорова.

## 5. Бэклог после R11

- CAUSE-таблица tier-1 на 8 agent-failure-modes (task drift, reward hacking — детекция step_loop/контекст-переполнения).
- Per-client jpeg-качество стрима :3042 (env-глобально сейчас).
- M3 Tauri 2 externalBin скелет (ресёрч-паттерн известен, сборка вне сандбокса).
- Рандомизированный A/B для метрики Reflexion (сейчас observational: операторы ретраят по-разному).
- SQL-миграция me2_evidence оператором (PGRST205, outbox буферизует).
