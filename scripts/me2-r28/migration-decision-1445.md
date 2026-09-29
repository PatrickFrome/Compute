# MIGRATION DECISION — §3 consumers (Job 419718 @14:45, R28)
*Решение замены LLM-пути 5 консьюмеров daemon'а (review/agentchat/eval/rsi/reviewer) после QUARANTINE gateway (commit 35369651). Дополняет daemon-inventory-1415.md (§6 INTEGRATE).*

## Контракт директивы
§3: только реальный пользовательский Web UI; никакого model API/SDK/gateway/fallback; удаление legacy — только после consumer search → replacement tests → migration → regression → physical proof (§15).

## Выбранный replacement path: FLEET READBACK CHAIN (вариант A)
```
daemon consumer (review/agentchat/eval/rsi/reviewer)
  → fleet-task (Supabase command/task table, T1 lease discipline)
  → live browser fleet GLM_CHAT tab (composer chain: SEMANTIC_FOCUS + SEMANTIC_TYPE — effect-proven 3x, WORKS)
  → READ_TRANSCRIPT readback (WORKS, effect-proven)
  → result → consumer
```
**Почему composer-путь первым**: цепочка focus/type/readback уже физически доказана сегодня 3 раза (см. талли 14:00, WORKS); z.ai Agent-surface требует TYPED_CLICK, чей effect-plane сломан (5 no-effect proofs) — Agent-миграция разблокируется только build-fix'ем. Composer-цепочка НЕ зависит от geometry и не использует клики.

## Фазирование
| Фаза | Содержание | Prereq | Статус |
|---|---|---|---|
| 1. QUARANTINE | gateway заблокирован 4 уровнями; consumers работают zai-only честно | — | ✅ commit 35369651, GATE PASS 70/70 |
| 2. Fleet-readback adapter | прототип: fleet-task → composer → readback → text; contract-test на 1 демо-задаче; негатив: AMBIGUOUS/timeout → честный `llm_unavailable` (НЕ silent fallback) | composer chain (есть) | NEXT tick (work package) |
| 3. Consumer migration | 5 консьюмеров → adapter; regression: eval 70/70 + по 1 физическому E2E на консьюмера | фаза 2 | очередь |
| 4. REMOVE gateway | физическое удаление ветки + TODO(migrate) маркеров | фаза 3 proof | очередь (§15) |
| 5. Agent-surface | перевод fleet-задач на z.ai Agent sessions (§2 контракт) | effect-plane build-fix | заблокировано build'ом |

## Негативные требования (без которых фаза не считается)
- Никакого скрытого fallback: отказ fleet-канала = явная ошибка наверх, park-and-resume (L4) для retry-able.
- AMBIGUOUS после мутации в браузере → reconciliation, не повтор (§4).
- Каждый шаг фаз 2-3 — physical proof (readback receipt), не "код существует".
- Память флит-задач: lessons → Brain (§11 verify отдельным тиком).

## Открытые зависимости вне daemon
- Effect-plane fix (build backlog) — блокирует фазу 5, не блокирует фазы 2-4.
- RESEARCHER consumption (9 silent readbacks) — приоритет-сигнал: fleet-канал доставки задач работает в одну сторону; фаза 2 должна доказать ОБРАТНУЮ сторону (readback потребителю).
