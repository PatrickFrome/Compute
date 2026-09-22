# DB AUDIT — все плоскости данных METAENGINE (2026-09-22)
Контекст: частичный сброс песочницы 2026-09-22 унёс /home/z/.a2 (ключи облака) и Pigsty-инфраструктуру. Аудит живых+статических плоскостей для старта M1 (ME2 daemon).

---

## 1. Cloud Supabase `xpeibufgzjknrhbhpffp` — ПРОДАКШЕН-ПЛОСКОСТЬ

**Статус: ЖИВ (DNS ok, HTTP 401 без ключа) · live-проба ЗАБЛОКИРОВАНА: service-ключ потерян при сбросе песочницы.**

### 1.1 Таблицы, экспонированные PostgREST (15, из rest-openapi.json 2026-09-21)
- compute_fabric_a2_browser_device / _device_nonce / _device_enrollment_request
- compute_fabric_a2_browser_supervisor_command / _supervisor_state
- compute_fabric_a2_browser_architecture_checkpoint / _cognitive_cursor
- compute_fabric_a2_supervisor_mesh_instance / _actuation_lease / _workspace_binding
- compute_fabric_a2_chat_bridge_remote_{pairing,peer,command}
- compute_fabric_development_gate_policy · metaengine_peer_health

**ВАЖНО**: task-plane (devos-задачи, claims) живёт в схеме, НЕ экспонированной PostgREST (ист. PURGE-20260921: "destruktion_meta") — доступ только через SECURITY DEFINER RPC.

### 1.2 RPC: 243 (families)
- devos_fleet_* (enqueue, lease, mark_running, complete, snapshot, reconcile, reconcile_ambiguous, capacity_snapshot, transport_promotion_*)
- devos_environment_{state,reset,resume} (+ legacy) · devos_supervisor_admission · devos_runtime_capabilities
- devos_meta_{dispatch,snapshot} · devos_recovery_debt_snapshot · devos_roadmap_* (assert_alignment, baseline_sync_*, contract)
- h205f22_a2_browser_device_* (enroll, consume_nonce, activate_approved, rotate_embedded_bootstrap)
- h205f22_a2_browser_supervisor_{issue_native,lease*,complete*,bind_effect,_control,_bootstrap,_emergency}
- h205f22_a2_supervisor_mesh_{sync,heartbeat} · h205f22_a2_browser_cognitive_accept
- coordination_read_barrier · acceptance/oidc/duel/abandon_sync_round (прочие)

### 1.3 Известные дыры прав (зафиксировано 2026-09-21)
- service_role без DELETE/SELECT (42501) на: supervisor_command, workspace_binding, cognitive_cursor, peer_health → только SECURITY DEFINER RPC.
- Realtime wake триггеры glm_pulse_* — ad-hoc артефакт облака, миграции их дропают (R2 из DEEP_AUDIT).

### 1.4 Миграции: 103/103 применены 2026-09-21 (download/db-migrations-final-103-of-103-20260921.txt)

### 1.5 Действие оператора
Выдать заново service-ключ пересозданного проекта (или новый .env) — иначе evidence-синк ME2 (M5) не сможет писать. Ключ хранить: /home/z/.a2/supabase-cloud.env + копия в a2-capsule.

---

## 2. Pigsty (локальный PostgreSQL-контур) — МЁРТВ

- Кластер (порт 55432, 272 таблицы на 2026-09-21) погиб при сбросе песочницы.
- Инфраструктура инфраструктуры wiping: infra/pigsty/bin/, smoke.sh, bootstrap/01→07 — УТЕРЯНЫ; уцелел только bootstrap/08-cognitive-delta-cursor.sql.
- Зависимости не живы: psql отсутствует, a2-edge-local (порт 3031) не сможет стартовать без PG.
- Путь восстановления: полный pigsty-bootstrap (01→03) + дамп оператора `supabase-backup-20260920.tar.gz` (38 МБ, у оператора) либо `uploaded.clean.sql` (217 МБ) + повторное применение 08.

---

## 3. Prisma SQLite (`db/custom.db`, DATABASE_URL в .env) — ЖИВ

- Модели: User (cuid, email unique), Post (title/content/published/authorId) — boilerplate Next.js.
- Использование ME2: НЕ используется. ME2 daemon держит собственный SQLite (bun:sqlite, WAL) в mini-services/me2-daemon/data/ — разделение runtime-ядра и web-приложения.

---

## 4. ME2 data-layer решения (M1) — выводы из аудита

| Урок старой системы | Решение ME2 |
|---|---|
| DB-как-автобус (4s поллы, 243 RPC, lease-гонки) | Локальный command bus + SQLite WAL; облако = journal (M5) |
| 3 писателя в одну state-строку | Один владелец состояния (daemon); снапшот → WS push |
| AMBIGUOUS-класс (411+ записей) | Детерминированный автомат: PENDING→LEASED→RUNNING→COMPLETED/FAILED; физ. эффекты через write-ahead effect journal; AMBIGUOUS невозможен по построению (single-writer) |
| 42501 GRANT-дыры | Локальный SQLite без RLS; облако позже — через один SECURITY DEFINER ingest-RPC |
| Миграции ≠ облако (104 файла) | Схема ME2 версионируется в коде daemon'а (migration-функция при старте) |

### Схема me2.db (v1)
```sql
events(id INTEGER PK, ts INTEGER, type TEXT, actor TEXT, subject TEXT, payload TEXT JSON, prev_hash TEXT, hash TEXT)
commands(id TEXT PK, action TEXT, lane TEXT, status TEXT, payload TEXT, result TEXT, idempotency_key TEXT UNIQUE, created_at INTEGER, leased_at INTEGER, completed_at INTEGER, error TEXT)
workers(id TEXT PK, role TEXT, kind TEXT (API|PLATFORM), state TEXT, generation INTEGER, created_at INTEGER, heartbeat_at INTEGER)
tasks(id TEXT PK, title TEXT, spec TEXT, role TEXT, state TEXT (READY|LEASED|RUNNING|COMPLETED|FAILED), worker_id TEXT, generation INTEGER, created_at INTEGER, updated_at INTEGER, result TEXT)
meta(key TEXT PK, value TEXT)
```
Ланы команд: EMERGENCY(0) / CONTROL(1) / READ_ONLY(9) / MUTATION(5) — приоритет очереди + бюджет 24 cost/60s (перенос семантики старого supervisor_action_budget).

---

## 5. Инвентарь источников
- download/audit-cloud-20260921/rest-openapi.json (2026-09-21) · download/db-migrations-final-103-of-103 · download/DEEP_AUDIT_SYNTHESIS_20260921.md · download/drain_fleet.sh (контракт issue/receipt)
- worklog.md (PURGE-20260921-2210, DEVOS-ANALYSIS-20260922) · a2-capsule/01_CREDENTIALS_AND_ENDPOINTS.md
