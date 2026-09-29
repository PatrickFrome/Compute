# RELEASE 0.58.0-swarm.1 — «ЧАТ-РОЙ БЕЗ ПРЕДЕЛОВ»

Дата: 2026-09-29 · ветка: `release/chat-agent-swarm-v1` · база: 17b69e89a (L3, живая линия daemon)
Мандат оператора (2026-09-29 00:26 +08): релиз целиком вокруг чат-агентов — рой автономных,
беспрерывно работающих, координирующихся, самовоспроизводящихся, общающихся и размножающихся
чат-агентов, улучшающих себя, систему и обновляющих браузер. Без механик, упирающихся в
бюджеты и лимиты. Без cron fleet. Память, высшая степень координации, все механизмы
самоулучшения и самообновления.

## 1. Снято (отсечки → очередь/телеметрия)

| Механика | Было (0.57.1) | Стало (0.58.0-swarm.1) |
|---|---|---|
| Бюджет командной шины (store.ts) | REJECTED `budget_exceeded` при 24 cost/60s, кламп оператора 6..96 | Отсечь УДАЛЕНА: команда всегда ставится в очередь; превышение advisory-порога = событие `COMMAND_BUDGET_NOTE` (телеметрия в hash-chain); кламп 1..1_000_000 |
| LLM-Governor (governor.ts) | token-bucket P0/P1/P2 + circuit breaker OPEN → fast-fail всех, кроме P0-пробы | Admission БЕЗГРАНИЧЕН; governor = плоскость телеметрии спроса (полосы, окно 429 — наблюдаемость); breaker навсегда CLOSED; `GOVERNOR_TRIP` — только как телеметрия «здесь был бы breaker» |
| Парк задач (quota.ts) | PARK_MAX=8 → после 8 парков честный FAILED | PARK_MAX=∞ — вечный park-and-resume (интервал растёт до cap 10м + jitter): работа роя не умирает никогда |
| Потолок чатов (agentchat.ts) | ME2_CHAT_CEILING=24 → `chat_ceiling_reached` | Снят (default 1_000_000): самосоздание/размножение без потолка; физика хоста — единственный внешний ограничитель |
| Конкурентные ходы (agentchat.ts) | CHAT_MAX_INFLIGHT=8: молчаливое отбрасывание ходов и skip в supervisorTick | УДАЛЕН: одновременные ходы не теряются; старты сериализует quotaPace (L1 pacing = ожидание, не отказ); chatInFlight — телеметрия |
| Глубина хода | MAX_STEPS=8, TURN_DEADLINE 10м | MAX_STEPS=24, TURN_DEADLINE 60м (глубже автономность; deadline — анти-зомби, restore подхватывает) |
| Автопилот спроса (demand.ts) | DEMAND_MAX=8, гистерезис 2 тика, role-cooldown 10м, откладка при OPEN breaker | DEMAND_MAX=∞, гистерезис=1 (мгновенный отклик), cooldown 1м (анти-дребезг), breaker-откладка удалена — размножение НИКОГДА не откладывается |
| Пул исполнителей (pool.ts) | POOL_MAX=4 | POOL_MAX=32 (env ME2_POOL_MAX): умножение роя; 32 — честная физика хоста, не продуктовый лимит |
| Cron-капы (policy.ts/policy.json) | crons_per_chat=8, crons_global=48, cron_min_minutes=5 | crons_per_chat=1_000_000, crons_global=1_000_000, cron_min_minutes=1 |

## 2. Cron fleet — устранён как принцип

- Рой живёт на ВНУТРЕННИХ всегда-включённых контурах daemon: `agentChatSupervisorTick` (60с),
  `demandTick` (60с), `cronTick` (30с), master-loop, pool-циклы, hygiene, CI-poll — внешние
  cron-разбудки не нужны: демон непрерывен по конструкции.
- Chat-cron (G7) ОСТАВЛЕН как инструмент само-планирования агентов (часть автономии),
  капы сняты (см. §1). Это не fleet-драйвер, а инструмент роя.
- Внешние cron-job'ы сессии супервизора (ME2-TICK/секреты/тесты — уровень операторской
  сессии, не продукта) в релиз не входят и рой не обслуживают.

## 3. Ядро — чат-агенты (всё уже в линии, в 0.58 без лимитов)

- **Перворичность чата** (G1): агент живёт в постоянной сессии (SQLite: messages/summary),
  tool-цикл (list_dir/read_file/write_file/shell/web_search/create_task/chat_send/
  create_chat/set_objective/schedule_cron/report_outcome/reply), hash-chain evidence.
- **Вечно-живущий супервизор** (G2): supervisorEnsure + перерождение + автономные ходы.
- **Координация высшей степени**: межчатовая почта `chat_send` + автономная реакция
  получателя (scheduleAutoTurn, анти-петля 20с), супервизорский digest флота, Outcome River.
- **Самовоспроизведение/размножение**: create_chat (без потолка) + G10 demand-автопилот
  (готовность/голод/штормы → мгновенное создание профильного CODE/RESEARCH/DEBUG-чата).
- **Память**: sticky-память E5 (memory economy) + rolling-summary + компакция без удаления
  истории (audit-trail) + эпизодическая память/reflections (memory.ts).
- **Самоулучшение**: RSI-ledger (adopt/reject/rollback через approval-гейт), reviewer C3,
  self-audit, eval-регресс в каждой инкарнации, P7 blast-radius мониторинг (read-only).
- **Самообновление системы**: selfupdate-плоскость (verify→apply→health→rollback, ff-only).
- **Обновление браузера**: fleet-readback — канонический канал к live-браузеру с §10
  reuse-пулом собственных scratch-табов (первый успешный NEW_TAB сеет пул; reuse-табы
  никогда не закрываются) + CAPTURE-evidence композер.

## 4. Что СОЗНАТЕЛЬНО сохранено (физика и честность, не лимитёры)

- **Storm-guard fleet-канала** (§7/§13): парк ask'ов при внешней стене браузера
  (tab_capacity) — это anti-burn против сжигания NEW_TAB, park-семантика, не отсечка
  внутренней работы; §10 reuse обходит стену переиспользованием.
- **Честный pre-effect отказ при детерминированной capacity** браузера (48 — внешняя
  физика установленного клиента, снимается owner-реклеймом USER-табов).
- L1 pacing (min-gap 800ms) / L2 cache / L3 failover — формирование спроса ДО сети
  (очередь, дедуп, второй канал), ни одна работа не теряется и не отклоняется.
- Policy-тиры T0/T1/T2 (authoritative-плоскость: admin/чужие цели — по-прежнему гейтится;
  это безопасность authority, не лимит ёмкости).
- EMERGENCY-полоса и /reset (kill-switch оператора, L5 recovery) — нетронуты.

## 5. Совместимость и проверка

- Версия-идентичность: store.ts VERSION = 0.58.0-swarm.1 (единый источник) + package.json
  синхронизирован (устранён дрейф 0.43.0 из аудита).
- Eval-датасет синхронизирован честно: `governor.breaker` переписан под телеметричную
  семантику (breaker CLOSED, admit безграничен, окно 429 — давление), `demand.autopilot` —
  под мгновенное создание (гистерезис=1), `worker.quota_park` — PARK_MAX=∞.
- GATE: `bash scripts/probe.sh` (изолированный boot + полный eval) — см. worklog-запись
  сборки.
- Dead-code честность: core.ts (Me2Core) не инстанцируется с R71 — его internal BUDGET
  не участвует в рантайме; бюджет УСТАНОВЛЕННОГО шелла (L2-клиент) — вне этого релиза.

## 6. Файлы релиза

store.ts (шина/версия), src/governor.ts, src/quota.ts, src/policy.ts, policy.json,
src/agentchat.ts, src/demand.ts, src/pool.ts, worker.ts, commands.ts, src/mechanics.ts,
src/eval.ts, package.json.
