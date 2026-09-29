# R52 — Supabase RPC-реестр (DEPRECATED-реестр, план electron-rebuild §D8)

> Дата: 2026-09-23 · Источник: живой OpenAPI `GET /rest/v1/` (service-role, 243 функции).
> Машиночитаемый артефакт: `research/2026/r52-rpc-registry.json` · SQL для оператора: `sql/0002-rpc-registry.sql`.

## Роль Supabase (зафиксирована планом §D8)

**Supabase = federation / evidence / control-plane live-флота. Локальная SQLite = истина.**
243 RPC — наследие старых циклов координации; новая единая система (R49–R52) использует
крошечное подмножество. Реестр фиксирует это РЕШЕНИЕ данными (таблица `me2_rpc_registry_h205f22`),
а не молчаливой деградацией: каждый RPC получает tier и обоснование.

## Три уровня

| Tier | Кол-во | Правило | Примеры |
|---|---|---|---|
| **ACTIVE** | 24 | Единая система: `aop1_*` (vercel gateway runtime secrets), `a2_supervisor_mesh_*` (mesh-синхронизация), evidence-канал | `aop1_consume_bootstrap_bundle_v1`, `a2_supervisor_mesh_sync_v1` |
| **CONTROL_PLANE** | 37 | Живые таблицы control-plane (enrollment_request 3265 строк, actuation_lease 4238, supervisor_command 1833, device_nonce 843, pairing/mesh_instance, gate_policy, peer_health, architecture_checkpoint) — держим до решения фазы D | `worker_enrollment_*`, `a2_browser_supervisor_enqueue_v1`, `device_consume_nonce` |
| **FREEZE** | 182 | Старые циклы (duel_v1-v6, macroblock_*, fabric_status, fail_run, legacy `a2_*` chat-bridge, interactive_round_*, старая federation) — **пометить DEPRECATED, НЕ удалять** | `duel_read_peer_relay_v4`, `macroblock_ingest_*`, `fabric_status_v2` |

## Правила работы с реестром

1. **FREEZE ≠ удаление.** Старые RPC могут ссылаться друг на друга и на триггеры; удаление —
   отдельное операторское решение после 30 дней наблюдения за `me2_event_mirror` (нет ли обращений).
2. **Миграции — только оператор** (PGRST205-протокол, mgmt 401): `sql/0002-rpc-registry.sql`
   создаёт таблицу реестра и засыпает туда 243 строки тремя insert'ами (idempotent, upsert).
3. **Новые RPC** — только через этот файл: правка `r52-rpc-registry.json` + SQL + обоснование в PR.
4. Контроль дрейфа: сверка `count(*)` OpenAPI (243) vs `count(*)` реестра при каждом раунде аудита.

## Связь с H6 SQL-контуром (R52)

`sql/0001-me2-event-mirror.sql` (оператор) → таблица `me2_event_mirror_h205f22` → daemon
`src/sqlmirror.ts` (`ME2_SQL_MIRROR=1`) переходит WARMUP → LIVE и зеркалирует hash-chain
события (idempotent по PK seq, `Prefer: resolution=ignore-duplicates`). Статус: `GET /sqlmirror`.
