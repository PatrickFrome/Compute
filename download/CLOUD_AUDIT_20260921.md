# CLOUD AUDIT — METAENGINE (Supabase + GitHub), 2026-09-21

Оператор предоставил: service_role JWT + JWT secret (Supabase ref `xpeibufgzjknrhbhpffp` = METAENGINE_H205F22_RECOVERY) и GitHub PAT. Креды сохранены в `~/.a2/supabase-cloud.env` и `~/.a2/ghtoken` (0600, НЕ коммитить). Сырые данные аудита: `download/audit-cloud-20260921/`.

## 1. Supabase cloud (xpeibufgzjknrhbhpffp)

### 1.1 REST / PostgREST
- `GET /rest/v1/` → HTTP 200, OpenAPI 322 KB: **15 открытых таблиц** (public), **243 RPC** в schema cache.
- Открытые таблицы h205f22: supervisor_command, supervisor_state, device, device_enrollment_request, device_nonce, **cognitive_cursor**, architecture_checkpoint, mesh_instance, workspace_binding, chat_bridge_remote_{command,pairing,peer}, actuation_lease, development_gate_policy, metaengine_peer_health.

### 1.2 Row counts (service_role, count=exact)
| таблица | строк | локально (Pigsty) |
|---|---|---|
| supervisor_command_h205f22 | **1537** | 30 |
| device_enrollment_request_h205f22 | **3150** | 20 |
| device_h205f22 | **3** | 16 |
| device_nonce_h205f22 | 764 | ~ |
| supervisor_state_h205f22 | 16 | ~ |
| mesh_instance_h205f22 | 13 | ~ |
| architecture_checkpoint_h205f22 | 38 | ~ |
| metaengine_peer_health_h205f22 | 0 | ~ |
| **cognitive_cursor_h205f22** | **403 (SELECT закрыт — см. 1.3)** | нет |
| workspace_binding_h205f22 | SELECT закрыт | ~ |

### 1.3 Tightened ACL (подтверждено заново)
- `cognitive_cursor_h205f22` и `workspace_binding_h205f22`: HTTP **403 42501 permission denied** даже для service_role через PostgREST (`GRANT SELECT ... TO service_role` отозван). Это каноничное состояние облака: доступ только через edge-функции (DIRECT_POSTGRES, definer-RPC).
- RPC-вызовы через PostgREST → **PGRST202** (функция не в schema cache для анонимного вызова) — норма; edge зовёт их напрямую в БД.

### 1.4 Cognitive acceptor — точный облачный контракт (для локальной реконструкции)
- RPC `h205f22_a2_browser_cognitive_accept_v1` **существует в облаке**. Сигнатура (из OpenAPI): `p_workspace_id, p_client_id, p_device_id, p_stream_id, p_after_sequence (integer), p_through_sequence (integer), p_events, p_authority_effect (boolean)`.
- Хранение: **курсорная таблица** `compute_fabric_a2_browser_cognitive_cursor_h205f22` — колонки: `workspace_id, client_id, device_id, stream_id, accepted_through_sequence (integer), accepted_batches, accepted_events, first_seen_at, last_seen_at`. **Сами дельты НЕ персистятся** (курсор = watermark реплея; delivery_is_authority=false).
- Следствие: локальный bootstrap/08 строим как cursor+RPC (см. infra/pigsty/bootstrap/08-cognitive-delta-cursor.sql).

### 1.5 Edge-функция (каноническая, облако)
- `GET /functions/v1/a2-browser-native-supervisor-v1/health` → ok:true, DIRECT_POSTGRES, `command_wait_batch=BOUNDED_DB_POLL` (realtime-ключи не заданы → фолбэк-путь, как в локальном контуре), cognitive_delta_route:true, supervisor_mesh:true, devos_routes:true.

### 1.6 Storage / Auth
- Storage: 1 приватный бакет `computefabric-parallel-glm` (создан 2026-08-21).
- Auth admin API доступен (total_users не отдал число — не критично; hook `metaengine_h205f22_custom_access_token_hook` в списке RPC).

### 1.7 Командная плоскость облака (живая)
- lane dist: READ_ONLY=793, **EMERGENCY=18**, DEVELOPER_EMERGENCY_UPDATE=0 (из 1537).
- Последние команды: SYSTEM_TELEMETRY / READ_TRANSCRIPT / TAB_TELEMETRY от GLM_LIVETEST_QUANTUM_20260920 и probe-агентов, 2026-09-20 (плоскость активна).
- Enrollment gate: **0 PENDING** — очередь оператора пуста.

## 2. GitHub (PatrickFrome/Compute)

- Токен: login `PatrickFrome`, scopes = полный admin (repo, workflow, delete_repo, …).
- **Ветки: 1154** · **открытых PR: 587** · **открытых issues: 14** · repo size ~13.4 GB.
- Активная линия — **release rail** `release/self-update-ambiguity-live-v2` @ `6bf173c7` (merge #938):
  - release `v0.7.0-dev.35532004761.1` published 2026-09-20T19:33:37Z, target=6bf173c7 ✓ совпадает с локально установленной.
  - CI по rail: 12/12 workflows **success** (Self Update E2E #2549, Windows Package Smoke #2092, Critical Audit #1555, …) на 19:20:55Z.
- ⚠️ **main дивергировал от rail**: `compare 6bf173c7...main` → status=diverged, main ahead=7 / behind=2973. В main есть 7 коммитов, не перенесённых в rail: 6× `ci(operator)` (trusted Playwright MV3 canary, supervisor control behavioral gate, board DOM contract, pairing epoch rotation, version-aware canary/rollover, chat-bridge version-aware) + merge #821 (phase34b lifecycle cas admission). Рекомендация: оператору решить — cherry-pick в rail или оставить (обсудить на сессии).
- Последние 5 релизов: 35532004761 (6bf173c7), 35525784133 (2e50ed12), 35523076056 (d12d27ca), 35513605325 (7ea17c65), 34288696323 (0aa3d760).

## 3. Сверка cloud vs local Pigsty

| аспект | облако | локально | действие |
|---|---|---|---|
| канонические имена таблиц | подтверждены OpenAPI | совпадают (раунды 005/006) | — |
| cognitive layer | cursor-таблица + accept-RPC | **отсутствовал** | bootstrap/08 (этот раунд) |
| devos_* RPC | 28 шт. в schema cache (fleet_lease/complete/enqueue/admission, meta_*, promotion) | 19 объектов отсутствуют (прошлый отчёт) | следующий кандидат на реконструкцию |
| destruktion_meta таблицы | НЕ открыты через PostgREST (schema не exposed) | fleet_* есть локально | — |
| enrollment gate | 0 PENDING | рабочий UI-гейт | live-браузер может подключаться |
| devices | 3 активных (живые браузеры) | 16 (probe/e2e) | — |

## 4. Риски / рекомендации
1. **main ↔ rail расхождение** (7 коммитов ci(operator) не в rail) — решить при следующем merge-цикле.
2. Секреты: лежат в `~/.a2/` (0600). В worklog/репо не попадут. Токен service_role — полный доступ к облаку: не логировать в артефакты.
3. PGRST202/42501 — не баги: канонический tightened-ACL. Локальные RPC-проверки делать DIRECT_POSTGRES (psql), как edge.
4. Локальная реконструкция когнитивного слоя — точный контракт получен (§1.4), применён в этом раунде (bootstrap/08 + панель Cognitive Bus).
