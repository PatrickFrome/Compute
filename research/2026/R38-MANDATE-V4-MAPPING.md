# R38 — Анализ мандата ME2 v3 и усиления v4 → маппинг на живую систему (v0.36.0)

Источники: `upload/Pasted Content_1790145784206.txt` (MANDATE v3 целиком + внешний анализ v4),
устная концепция оператора (8 пунктов), runtime-состояние на 2026-09-23 (daemon v0.36.0,
eval v13 41/41, матрица 36, CI 64b8a36 green, R36/R37 — G-линия).

---

## 1. Анализ мандата v3 (что он требует и где ME2 уже стоит)

Мандат v3 = «policy-governed autonomy»: система исполняет гейты сама, по политикам-коду,
с независимой верификацией, обратимостью и Decision Ledger; человек = root of trust.

| Требование v3 | Состояние ME2 (факт, runtime-доказательства) |
|---|---|
| Policy Engine (детерминированный, политики=код) | **ЧАСТИЧНО**: approvals.ts — гейты `fence_clear/rsi_adopt/authority_effect` (gateCheck, формальные предикаты, REST-контур, APPROVED/DENIED/expiry); объективный статус-контур effect.ts (5 вердиктов CONFIRMED…FENCED, one-attempt). Нет единого policy-файла с tier'ами T0/T1/T2 |
| Trust Ladder T0→T1→T2 с деградацией | **НЕТ как явного механизма** (уровни неявно: операторские approvals). В очередь реализации |
| Reviewer-Agent (C3, zero-authority verifier) | **ЕСТЬ** (R29): reviewer.ts, вердикты на COMPLETED, собственный контекст, `UPDATE tasks SET review` — никогда не статус |
| Decision Ledger (hash-chained, зеркалируемый) | **ЕСТЬ как substrate** (E1/E2, R32/R33): events = append-only hash-chain + verifyChain + Storage-зеркало (LIVE-STORAGE). Ledger-поля гейтов (tier/rollback_plan) — расширение |
| Evidence-driven objective closure | **ЧАСТИЧНО**: objectives ACTIVE/ACHIEVED/FAILED/PARKED + effect-verdicts CONFIRMED; формула закрытия в коде — в очередь |
| Fence-clear по evidence-классам E1–E3 | **ЧАСТИЧНО**: fenceCheck (E-классы в effect.ts), approval-гейт fence_clear |
| SQL-autonomy (shadow→canary→verify→rollback) | **BLOCKED(policy) честно**: DDL-каналы платформы закрыты (5 пруфов R32), хилер ретраит 15м, Storage-зеркало доставляет evidence. Механизм миграционного контура — будущий раунд |
| Merge-автономия (CI+reviewer+eval-gated) | **ЧАСТИЧНО**: push через git-sync.sh (ручной ритуал агента раундов = T0 по мандату), CI green серия; auto-merge роботом — будущий раунд |
| Self-update | **ЕСТЬ** (selfupdate.ts, ff-only барьер, minisign-подпись CI) |
| Chaos: гейт-плоскость | reviewer-смерть → задачи не висят (timeout → возврат в READY — есть); policy-exception fail-closed — частично; Ledger-повреждение → verifyChain детектирует |

Вывод по v3: **архитектурные столпы в системе есть и работают** (reviewer, ledger, gates,
verdicts, mirror, selfupdate), но связка «policy-engine как единая точка принуждения с
tier'ами и circuit breaker'ом» не собрана в один контур — и главное, нет **машинно-проверяемых
инвариантов живости и непробиваемости**, которые v4 справедливо требует.

## 2. Анализ усиления v4 (P1–P8): что ME2 уже даёт, чего не хватает

Верхний принцип v4 принят: **AUTONOMY MUST BE BOTH SAFE AND LIVE** — система без нарушений,
но без прогресса = неисправна; система с прогрессом через нарушения = неисправна.

| # | Протокол v4 | ME2 сегодня | Разрыв → действие |
|---|---|---|---|
| P1 | Proof-of-Non-Bypass | 47 шинных действий идут через lanes/budget; REST write-маршруты разрозненны; НЕТ систематического доказательства «каждый путь → enforcement point» | **Реализовано в R38**: non-bypass аудит — извлечение всех POST-маршрутов из ИСХОДНИКА index.ts (не из рукописного манифеста) и проверка покрытия enforcement-семействами; вердикт NO_BYPASS/UNKNOWN_ROUTE(n), машинно-проверяемый |
| P2 | Liveness / Progress | Watchdog задач (5м stale), lease TTL, degraded-детект чатов; НЕТ агрегированного вердикта живости | **Реализовано в R38**: /autonomy liveness — oldest READY age, RUNNING age vs hard deadline, reviewer backlog, supervisor last-turn age, inflight; verdict LIVE/STALLED + machine-checkable предикаты |
| P3 | Deadlock/Livelock | Ручные проверки; cycles в handoff-графе не искались; oscillation не считалась | **Реализовано в R38**: wait-graph cycle detector (task_handoff + objective edges, DFS), oscillation-детектор (task с >K смен статуса в окне без завершения) |
| P4 | Independent Evidence | emit() — runtime-эмит на местах действий (не исполнитель пишет своё доказательство); reviewer независим; НЕТ явного «proof of independence» | **Реализовано в R38**: independenceProof() — source-scan reviewer'а (нет UPDATE статусов), evidence-цепь verifyChain, producer-классификация |
| P5 | Recovery Hierarchy + Immutable Bootstrap | Watchdog+health-mirror+incarnation guard (L1), supervisor rebirth (L2), selfupdate (L3), GitHub sandbox (L4), EMERGENCY lane (L5) — всё есть, НЕТ единой карты L0–L5 | **Реализовано в R38**: recoveryHierarchy() — L0–L5 с живыми статусами и «кто кого реанимирует» |
| P6 | Objective Outcome Proof | effect-вердикты + approval-гейты; closure-формула не автоматическая | В очередь (след. раунды; связать с policy-engine T1) |
| P7 | Cumulative Autonomy/Risk Budget | Rate-limits шины (24 cost/60s) есть; cumulative blast-radius НЕТ | **Реализовано в R38**: budgetStatus() — взвешенная сумма деструктивных событий за 24ч, пороги OK/WARN/BREACH (rate-limit ≠ risk-limit) |
| P8 | Meta-Audit | round-verify + eval + tamper-негативы; сам аудитор не проверялся | **Реализовано в R38**: independenceProof + eval-чек verifier-independence; полная meta-audit-процедура — в мандат следующего раунда-аудита |

## 3. Концепция оператора (8 пунктов) → текущий статус

1. «Оператор даёт задание в чат» — ✅ агентные чаты (R36), оператор пишет в чат/REST.
2. «Система активирует беспрерывный автономный процесс» — ✅ supervisor-тики 60с + pool + workgraph.
3. «Супервизор жив всегда, реанимация мгновенна» — ✅ supervisorEnsure + rebirth (R36, eval-доказано).
4. «Неограниченное число специализированных агентов-чатов» — ✅ create_chat, потолок само-создания 24 (оператор без потолка), роли.
5. «Видят ход работы, размышления, БД, полный обзор, координация» — ✅+ (R37: река = чаты И pool-исполнители; digest с пулом и целями; events/hash-chain/WS/Storage-зеркало).
6. «Работа параллельна, не пошагова» — ✅ pool leases (≤4 слота, эксклюзивность), чаты конкурентны (inflight ≤8).
7. «Запуск cron и воркеров» — воркеры ✅ (create_task → pool); **cron-планировщик из чатов — НЕТ → в очередь G-линии**.
8. «Система обучается и самообновляется» — ✅ RSI-плоскость + selfupdate + memory economy; обучение браузера — инкрементально.

## 4. Что реализовано в R38 (H-линия, «Autonomy hardening»)

Новый read-only REST-семейство **`GET /autonomy`** (вне шины 47/47, bench_admin) — один
эндпоинт, четыре плоскости v4 + supervisor-видимость (liveness в daemon_status каждого тика):

- `liveness` (P2+P3): verdict LIVE/STALLED, предикаты с числами (age/starvation/cycles/oscillation).
- `budget` (P7): взвешенный blast-radius 24ч, state OK/WARN/BREACH, топ-вкладчики.
- `non_bypass` (P1): POST-маршруты, извлечённые из исходника index.ts регэкспом, vs enforcement-покрытие; NO_BYPASS | UNKNOWN_ROUTE.
- `recovery` (P5): L0–L5 карта.
- `independence` (P4+P8): reviewer zero-authority (source-scan), chain verified, producer=runtime.

eval v14: +autonomy.liveness (синтетический stall + cleanup), +autonomy.budget (веса/пороги),
+autonomy.nonbypass (реальный аудит исходника) = 44 чека. Механика ME37.

## 5. Порядок следующих раундов (v4 → v5 roadmap)

1. **H2**: Policy-файл с tier'ами T0/T1/T2 + circuit breaker + ledger-поля гейтов (связать approvals+objectives+effect в единый policy-engine).
2. **H3**: Objective Outcome Proof (P6): acceptance-предикаты objective в коде, closure через reviewer+predicates.
3. **G7**: cron-планировщик daemon'а + инструмент чата `schedule_task` (концепт п.7).
4. **H4**: Meta-audit-процедура раунда (двухпроходный аудит с разными стратегиями) в round-verify.
5. **H5**: Merge-конвейер T1 (auto-merge sandbox/me2-os по политике §4.D) — после H2.
6. **H6**: SQL-autonomy контур (P: shadow→canary→rollback) — при открытии DDL-канала платформой.
