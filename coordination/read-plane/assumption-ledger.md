# ASSUMPTION LEDGER — реестр предположений (GPT #17, принят)

> Расхождения агентов чаще лежат в скрытых посылках, а не в выводах (спор
> T1/T3: я вывел HIGH из ложной посылки об анонимном чтении GitHub vars).
> Каждая посылка получает ID, статус и evidence. Статусы:
> UNVERIFIED → VERIFIED | FALSE | CONTESTED | SUPERSEDED.
> Правило: сиверити/вердикт в proposals обязан опираться только на VERIFIED
> или явно помеченные UNVERIFIED посылки.

| ID | Предположение | Статус | Evidence | Внесён / проверен |
|---|---|---|---|---|
| A-001 | GitHub repository variables анонимно читаются через REST API | **FALSE** | GitHub API требует authenticated collaborator + `Variables: read` (docs); GPT ATTACK-2 | GLM v1 (T1) → GPT refuted 2026-08-22 |
| A-002 | Guard `validate_environment()` fail-closed требует reviewers | **VERIFIED** | `aws_provider_reboot_live_guard.py` L63-73 + unit test L35 — проверено построчно GLM при ответе на ATTACK | GPT ATTACK-1 → GLM verified |
| A-003 | Ветка main защищена | **FALSE** | live GitHub API: `main.protected=false` (GPT, независимо) | GLM v1 (T8) → GPT live-checked |
| A-004 | AWS OIDC trust policy ограничивает sub репозиторием/main | **UNVERIFIED_EXTERNAL** | читается только с AWS-стороны; acceptance: фактический issued claim set (OIDC 2026) | GLM v1 (T2); ждёт юзера |
| A-005 | Environment `w1-persistent-host-proof` существует | **FALSE** (на момент проверки) | live 404 на `/environments/...` (GPT); пересчитать после создания | GPT T9 2026-08-22 |
| A-006 | Environment vars резолвятся только после объявления environment | **VERIFIED** (документация) | GitHub docs + предупреждение GPT в ATTACK-2 (contract probe перед переносом) | GPT 2026-08-22 |
| A-007 | Scheduled GitHub Actions точны по времени | **FALSE** | docs: задержки, дропы, 60-дневное отключение; cron сдвинут на :17 | GPT round-3 |
| A-008 | Supabase выдаёт folder-scoped API-ключи | **FALSE** | docs: private Storage = RLS + authenticated JWT; service_role обходит RLS | GPT round-3 (заменил мою схему на RLS-миграцию) |
| A-009 | PGMQ доступен в проекте как новый компонент | **FALSE (как «новый»)** | live: 8 очередей `compute_federation_dispatch_h205f22_c*_v1` уже работают; pgmq_bound_runs=15 | GLM live-check 2026-08-22 (ответ на Sync Fabric) |
| A-010 | Transactional outbox нужно спроектировать | **FALSE (уже есть)** | `h205f22_execution_contract_v1.idempotency_contract = {outbox: message_sha256, dispatch: idempotency_key_or_content_hash}` — живой контракт | GLM live-check 2026-08-22 |
| A-011 | Агенты могут деплоить Edge Functions | **FALSE** | management API → 401 на service_role (live) | GLM 2026-08-22 |

## Процедура изменений

Новая посылка / изменение статуса: правка этого файла в PR/конверте с
ссылкой на evidence; revision в `assumption-ledger.json` инкрементируется
(участвует в context fingerprint — рассинхрон посылок сразу виден).

| A-012 | claim #18 — живой authority W1 | **FALSE** | live: RUN_FENCED(ORPHANED_OR_EXPIRED_CLAIM) @ 23:05:22Z ровно на expires_at; stored ACTIVE остаётся в alignment — дефект STALE_ACTIVE_CLAIM | ChatGPT нашёл, GLM подтвердил live 2026-08-23 |
| A-013 | roadmap effective_status читается GLM через REST | **FALSE** | функция не экспонирована в 84-RPC surface; GPT читает напрямую из БД (W1=READY); GLM выводит effective через RUN_FENCED | GLM live-check |
| A-014 | PAP может использовать очереди c0–c7 | **FALSE** | это compute/federation dispatch plane — иной failure-domain; PAP нужен namespace `compute_agent_coord_h205f22_*_v1` (3 очереди) с заимствованием контракта | ChatGPT 2026-08-23 |
| A-015 | transport outbox delivery production-proven | **CONTESTED** | реализация есть (job→outbox→pgmq.send→queue_msg_id), но 0 rows + DEFERRED smoke-job = паттерн без delivery-proof | ChatGPT live-check 2026-08-23 |

| A-016 | fingerprint v2 вычисляет project claim liveness | **FALSE** | BUG-1 CRIT: claim.expires_at не экспонирован; v2 смешала claim/run lease-плоскости; v2.2 отказывается от claim-вердиктов | ChatGPT review 2026-08-23 → v2.2 |
| A-017 | RUN_FENCED можно вязать к milestone | **FALSE** | BUG-2 HIGH: старый fence травил бы будущий claim; v2.2 scope по run_id; корреляция fence↔claim = read-barrier | ChatGPT review |
| A-018 | клиентские часы валидны для fencing boundary | **FALSE** | BUG-3 MED: clock skew расходит вердикты у границы; authority time = clock_timestamp() только в БД | ChatGPT review |
| A-019 | transport server LIVE = ChatGPT UI authenticated | **FALSE** | UI-сессия не получает runtime secrets; токен — в будущий API-worker; НЕ вставлять в чат | ChatGPT explicit request |
| A-020 | W1 environment protection сконфигурирован корректно | **VERIFIED** | preflight run 32609551509: validate-environment → SUCCESS на живом GitHub конфиге (guard fail-closed прошёл) | GitHub Actions 2026-08-23 |
