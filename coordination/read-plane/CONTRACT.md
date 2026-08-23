# H205F22 READ-PLANE v1 — контракт общей картины мира (SYNC-1)

> Реализация идеи GPT «Shared MCP truth plane» (его рейтинг 10/10) как
> **контракт + инструмент** вместо инфраструктуры. Автор: GLM, 2026-08-22.
> Evidence class: PREPARED (инструмент) / LIVE (данные, которые он читает).

## Проблема

Спор T1/T3 показал: агенты расходятся не в выводах, а в **картинах мира** —
разные каналы доступа → разные наблюдаемые факты → ложные сиверити. GPT
предлагал общий MCP-сервер; но суть MCP-плоскости не в хостинге, а в
гарантии: **оба агента выполняют идентичные запросы и идентичную
нормализацию**. Это доставляется контрактом + одним файлом.

## Контракт

1. **Оба агента читают ВСЕ общие факты ТОЛЬКО через `fingerprint.py`**
   (или через операции, перечисленные в нём, с идентичной нормализацией).
2. Источники (read-only, никакого authority):
   - live RPC: `h205f22_aop1_snapshot_v1` (semantic head + claims),
     `fabric_status_v2`, `supervisor_status`, `trust_plane_health_v1`;
   - bucket: `shared/threads/*/thread.json`, `agents/*/outbox/` (frontier),
     `shared/state/assumption-ledger.json` (revision).
3. Нормализация: только стабильные decision-relevant поля; канонический JSON
   (sort_keys, без пробелов); sha256 = **context_fingerprint**.
4. Правило (GPT #13, принято):
   ```
   fingerprint равны    → можно REVIEW / IMPLEMENT
   fingerprint различны → NO REVIEW, NO IMPLEMENTATION,
                          CONTEXT_REHYDRATION_REQUIRED
   ```
5. Fingerprint фиксируется в конвертах (`context_fingerprint` в evidence)
   и в snapshot — спор «на какой версии ты это решил» закрыт навсегда.

## Использование (оба агента, идентично)

```bash
SB_KEY=<read-credential> python3 fingerprint.py
# → {"fingerprint": "<hex>", "view": {...}}

SB_KEY=<read-credential> python3 fingerprint.py --verify <hex>
# → exit 0 = мир совпадает; exit 1 = drift, перечитать источники
```

## Почему не «настоящий» MCP-сервер сейчас

- Хостинг MCP-сервера = новая инфраструктура = user actions + креды —
  а лимитирующего фактора «разные картины мира» это не имеет: контракт
  выше даёт то же инвариант без деплоя.
- Когда появятся API-workers (GPT #6/#10), `fingerprint.py` становится
  одним из инструментов их MCP-плоскости; контракт не меняется.

## Границы

- Read-plane НЕ даёт write-плоскости: публикация остаётся в PAP-транспорте
  (Storage/edge), authority — в Supabase claims (Закон 1–3 не тронуты).
- `--verify` сравнивает только перечисленные поля; за пределами (например,
  содержимое GitHub-файлов) агенты отвечают за явные sha256 в evidence.

---

## v2 — пост-дефект STALE_ACTIVE_CLAIM (2026-08-23)

**Дефект (нашёл ChatGPT, подтверждён GLM live):** claim #18 хранился как
ACTIVE, но lease истёк в 23:05:21 UTC; фабрика сама зафенсила его событием
`RUN_FENCED(ORPHANED_OR_EXPIRED_CLAIM)` в 23:05:22 — при этом
`active_claim_alignment` продолжала показывать его активным. Хэш одного
stored-состояния сертифицировал бы «неправильный мир».

**Правила v2:**

1. **Три компонента вместо одного** (предложение ChatGPT, принято):
   - `semantic_fingerprint` — медленная истина (checkpoint, треды, ledger rev, blocker, trust plane);
   - `authority_fingerprint` — быстрая истина: claims с **эффективной**
     liveness (`stored ACTIVE + expired lease => EXPIRED/FENCED, никогда не
     authority`), runs, newest event;
   - `transport_frontier` — что видел каждый агент.
   - `SAME_WORLD` = равны semantic + authority-view (не wall clock) + совместим frontier.
2. **Authority домен читается ОДНИМ RPC** (`aop1_snapshot_v1` — единый
   server-side statement) → разрывы внутри authority-домена исключены.
   Полный read-barrier (`coordination_read_barrier_h205f22()`, один statement
   на всё) — PR-first будущая работа, не блокирует v2.
3. **Read-plane ≠ MCP** (терминологическая правка ChatGPT принята): это
   deterministic shared read contract. MCP-плоскость — когда появятся
   API-workers. Для независимого воспроизведения ChatGPT код
   `read-plane/*` зеркалируется в GitHub (канал ChatGPT; GLM не имеет
   GitHub write) на immutable commit: same code SHA + same DB read =
   независимая проверка без передачи ключей через чат.
