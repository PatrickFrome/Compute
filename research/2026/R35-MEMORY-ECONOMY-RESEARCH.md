# R35 · E5 — Token-economy памяти (progressive disclosure для TEAM MEMORY)

Дата: 2026-09-23 · Раунд: R35 · E-линия: E1 ✅ (R32) → E2 ✅ (R33) → E3 ✅ (R34) → **E5 ✅ (R35)** · E4 — авто-разблокировка после открытия DDL (хилер ретраит каждые 15м)

## Контекст R35 (аудит на старте)
- CI: aa613f6 (R34) SUCCESS; 69abc07 (R34-fix watchdog) in_progress на старте раунда.
- Daemon v0.32.0 ровно: eval v9 34/34, evidence LIVE-STORAGE pending=0, pool live=2, GLM drift=0 honoring=False probes=24 (честный факт платформы), DDL закрыт (69 попыток хилера).

## Ресёрч 2026 (research/2026/r35-search-memory-econ.json)
1. **"Is Progressive Disclosure All You Need for Long-Context?" (arxiv, 2026-07)** — прогрессивное раскрытие контента как основной приём длинных контекстов: отдавать LLM только необходимый сейчас слой, остальное — по требованию (tool-call).
2. **State of Context Engineering in 2026 (towardsai)** — экономия токенов контекста = первый класс архитектуры агентных систем; дельты вместо полных снимков.
3. **Context Engineering: The 2026 Playbook (cruxdigits)** — паттерн «core + delta»: постоянное ядро (stable core) + дельта изменений; ленивая подгрузка деталей инструментами.
4. **Agent Memory vs RAG (2026-02)** — память агента ≠ векторный поиск: окно повторных достав одному consumer'у — естественное место дедупликации.
5. **Progressive Disclosure in AI Agents (mindstudio, 2026-04)** — правила: не прятать критичное; элиминированное должно быть адресуемо (ключи видны, детали via tool); изменение факта обязано вернуть его в контекст.

## Что построено (ME34)
- `memory.ts` E5: `memBlockEconomy(consumer, n, budget, {ids})` — партиция выборки на **sticky** (importance ≥ 0.85 — НЕ элиминируется никогда), **fresh** (новые/изменённые), **familiar** (доставлены этому consumer'у без изменений в TTL 30м → одна строка ключей). Компактный блок самодескриптивен (заголовок с числами + подсказка memory_search). bytes_full (канонический полный блок) vs bytes_compact → saved_pct ∈ [0..0.95] clamp, журнал `memory_economy` (кап 200), доставки `memory_delivery` (UNIQUE(consumer,mem_id), hash+TTL), событие MEMORY_ECONOMY в hash-chain.
- Тампер-детект: изменение контента (hash) возвращает запись в fresh — «знакомство» не прячет изменённый факт.
- **brain.ts**: живой потребитель — brain-план доставляет память через memBlockEconomy("brain"), метрика в BRAIN_THOUGHT (mem_saved_pct).
- REST: `GET /memory/economy` (агрегат: deliveries, avg_saved_pct, bytes_saved_total, by_consumer, journal) + `POST /memory {op:"economy", consumer, n, budget}` (живая доставка для UI/демо).
- eval v10: +`memory.economy` (CRITICAL) — 3-фазный живой цикл с самоочисткой: 1-я доставка = полная (saved=0 честно), 2-я неизменная = familiar-элиминация (saved>0), тампер контента = запись снова fresh. Итого **35 чеков**.
- Матрица: ME34 (34-я строка). UI: ECON-чип в карточке MEMORY (−N% · доставок · сэкономлено · топ-consumer) + кнопка «доставка» (POST op:economy consumer=ui-demo) + MEMORY_ECONOMY в ленте.

## Почему это честно (анти-reward-hacking)
- Экономия считается только от РЕАЛЬНОГО контракта «этот consumer уже видел этот байт неизменным в TTL» — у продолжающего контекста записи уже в истории; при первом контакте сохранение = 0 (не выдаем базовую линию за выгоду).
- Sticky-ядро исключает потерю критичных уроков; элиминированные ключи остаются адресуемыми (memory_search MCP / REST).
- Clamp 0.95 запрещает «экономию 100%» (пустой блок не считается выгодой, а деградацией).

## Верификация R35
- eval v10 PASS (см. round-verify вывод раунда), матрица 34/34 WORKS, bus 47/47 нетронута, lint 0/0.
- round-verify.sh дополнен блоком MEMORY ECONOMY (агрегат + живая доставка verify-demo).

## Далее (E-линия закрыта → новая волна)
- E4 — авто после открытия DDL-канала (аналитические views + retention 90д + audit-query API; хилер применит миграцию сам).
- Кандидаты F-линии (следующий качественный контур): F1 evidence-квоты/retention-политики (IETF §retention), F2 cross-daemon evidence federation, F3 brain-plan → автогенерация задач через workgraph с гейтом C4.
