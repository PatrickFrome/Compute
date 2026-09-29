# R32 · E-линия (Evidence & Reliability) — ресёрч 2026 → конкретные шаги

Дата: 2026-09-23 · Раунд: R32 · Статус роадмапа R24: ЗАКРЫТ (A/B/C/D) → нужен новый качественный контур

## Контекст R32 (сделано)
- Роадмап R24 закрыт cron-раундами R27–R31 (A1/B1/B3/C1–C4/D1/D2/D4). Daemon v0.30.0.
- Директива «применяй SQL me2_evidence сам»: все 4 DDL-канала проверены живьём и закрыты платформой:
  mgmt+sb_secret=401 (sb_secret не JWT), mgmt+minted-JWT=401 (legacy-JWT auth отключён даже для самоподписанных токенов НОВОГО проекта), pg-proxy=404, psql/DB-password — отсутствуют. Пруфы: evidence_ddl_attempts + /evidence.
- **E1 СДЕЛАН**: evidence v2 = 3-уровневая доставка (rpc → table → **Storage-зеркало** `me2-evidence/batches/*.jsonl`, bucket создан daemon'ом сам, sb_secret работает: upload/read/list 200) + **DDL-хилер** (boot+5s, ретрай 15м, журнал attempts, авто-дренаж outbox при первом открытии канала). Outbox 1447 событий слился в облако (44 объекта) за ~4 мин. Найден и убит живым замером цикл 1-событийных батчей (EVIDENCE_STORAGE_SENT → outbox → again) — эмит только полных батчей.
- Механика ME31, eval v7 (32 чека, +evidence.remote), POST /evidence {op:probe_ddl|probe_storage}, чип хедера LIVE-STORAGE · sN.

## Ресёрч 2026 (источники: research/2026/r32-search-*.json)
1. **IETF draft-sharif-agent-audit-trail-04** (datatracker, 2026-09-15) — формируется стандарт аудита агентных трейлов. ME2 hash-chain (prev_hash/hash в каждом событии) уже резонирует; чего не хватает: каноническое JSON-кодирование для верифицируемости третьей стороной и «semantic units» (намерение → действие → результат).
2. **Agent Audit Trail Design: 7 Best Practices (digitalapplied, 2026-05)**: immutability, separation of evidence plane от operational plane, retention-политики, query-плоскость для аудиторов.
3. **Enterprise audit for multi-agent outputs (augmentcode, 2026-04)**: каждый артефакт должен быть привязан к (agent identity, model version, tool calls, input spec) — у ME2 есть всё кроме явной связки evidence↔task↔review в одном запросе.
4. **Orchestration 2026 (redis/jetbrains/truefoundry)**: тренд — не «оркестратор команд», а **event-driven supervisor**: планирование через наблюдаемые эффекты + backpressure + идемпотентные continuation (у ME2 это уже handoffs/TASK_ENQUEUE — совпадение с трендом).

## E-линия: конкретные архитектурные шаги (качественный скачок)
- **E1 ✅ (R32)** — durable remote evidence + self-healing DDL + honest statuses. Эффект: из «ждёт оператора» → «самозаживление при первом открытии канала», mirror работает сегодня.
- **E2 (R33, кандидат)** — *IETF-выравнивание evidence*: канонический JSON (JCS) для payload перед хешированием + `GET /evidence/verify?from&to` (проверка цепочки консумером) + связка evidence.seq ↔ task_id ↔ review verdict в одном индексе. Чек eval: verify возвращает ok на живой цепочке, FAIL на подделанном хеше (негатив).
- **E3 (R34, кандидат)** — *parallel live-GLM executor pool*: worker.ts исполняет задачи последовательно; пул N живых контекстов (каждый агент = отдельный context_id + GLM-latest, директива R29) с честными lease-гейтами (не фальшивый параллелизм: lease одного task у одного контекста, наблюдаемо в /fleet).
- **E4 (после открытия DDL)** — SQL-плоскость: аналитические views (evidence по задачам/агентам/вердиктам), retention 90д, audit-query API. Хилер применит миграцию сам — E4 автоматом разблокируется.
- **E5 (бэклог)** — token-economy на память: sense-diffing (D1) распространить на memBlock (дельта вместо полного блока).

## Верификация R32 (программные пруфы)
- eval v7 PASS 32/32 (6ms); actions=47 инвариант; lint 0/0.
- Outbox drain: 1447 → 0; 44 объекта в bucket; после фикса цикла objects стабильны (1 за прогон boot-батча, без вечного роста).
- UI: чип «LIVE-STORAGE · sN» программно (get text) + визуально на скриншоте; mobile 390 sw=iw.
- Механика: 5 процедурных CAVEAT после рестарта (ME18 obsv-attach, ME20 p95 cold-start, ME21 MCP-init, ME22 eval-фикс перезаписан PASS-прогоном, ME29 ждёт трафик вкладки) — все известные процедуры, не дефекты.
