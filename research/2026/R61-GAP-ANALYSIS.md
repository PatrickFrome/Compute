# R61 — CAPABILITY GAP ANALYSIS

Раунд: R61 (2026-09-24). Полный список гэпов — R61-PARITY-MATRIX.md (110 строк PARTIAL/MISSING: P0=15, P1=36, P2=44, P3=15). Здесь: **все P0 в полном формате миссии §24**, P1 — компактной таблицей, P2/P3 — ссылкой на матрицу. Формат: Capability → Current State → Gap → Root Cause → Required Architecture → Modules → Contracts → Runtime → Tests → Evidence → Dependencies → Risk → Effort → Priority.

Соглашение имён: модули живут в `mini-services/me2-daemon/src/`; «шина» = 47 действий; eval = `src/eval.ts` (v25, 61/61); гейт = CI смарт-мержа.

---

## P0-0. Автономный агентный harness (exec-инструмент + edit-инструмент)

- **Capability**: `core.agent-loop` + `core.builtin-tools` — Cursor Agent: autonomous edit→run→observe→repair loop над файлами и терминалом.
- **Current State**: agentchat turn-loop жив (create/turn/compact/close), GLM-провайдеры отвечают, pool исполняет задачи work_graph; шина даёт workspace r/w и браузер; reviewer проверяет post-hoc.
- **Gap**: у агента нет **TERMINAL/RUN-действия** (shell с approval-семантикой) и **EDIT-инструмента с валидацией** (дифф+применение+откат); агент не может сам прогнать тест и прочитать вывод — центральная петля Cursor отсутствует.
- **Root Cause**: шина проектировалась под браузерный план и задачи, а не под кодовый harness; exec считается «опасной зоной» без канона.
- **Required Architecture**: действие шины `TERMINAL_RUN` (lane MUTATION/CONTROL, cost≥2) с: белым списком команд по умолчанию → prlimit-обёрткой (канон sandbox.ts) → таймаутом → захватом stdout/stderr в effect-вердикт; `FILE_EDIT` с unified-diff входом, валидацией применения и auto-rollback при ошибке.
- **Required Modules**: `src/exec.ts` (новый), `src/edit.ts` (новый), расширение `commands.ts`/`autonomy.ts` (2 новых действия → манифест non-bypass 30→32).
- **Required Contracts**: exec.request{cmd, cwd, timeout_ms, sandbox} → verdict{exit, stdout_tail, stderr_tail, duration, sandboxed}; edit.request{path, diff} → verdict{applied, hunks, rollback_at}.
- **Required Runtime**: spawn под prlimit как в exthost; env-белый-список; секреты не входят в окружение.
- **Required Tests**: eval-контракты `contract.exec_tool` + `contract.edit_tool`; негативы: неизвестная команда → отказ, timeout → kill+верdict, env-утечка → гард.
- **Required Evidence**: живой прогон «агент чинит падающий тест»: edit→run→green + hash-chain события EDIT_APPLIED/TERMINAL_RUN.
- **Dependencies**: нет (фундамент).
- **Risk**: расширение поверхности атаки → гасится сандбоксом и манифестом.
- **Effort**: M (2 модуля + 2 действия + eval).
- **Priority**: **P0**.

## P0-1. Run Modes + классификатор пре-исполнения

- **Capability**: `core.run-modes` + `sec.auto-review-classifier`.
- **Current State**: lanes+costs+approvals+policy.json (детерминированно, жёстко); reviewer — post-hoc, zero-authority.
- **Gap**: нет режима «sandbox-when-possible» и **пре-исполнения LLM-классификатора** для команд вне белого списка (у Cursor: Haiku/GPT-5.4-Mini агентно решает allow/block с объяснением агенту; ~4% блоков).
- **Root Cause**: approvals binary (да/нет оператора); нет среднего тира.
- **Required Architecture**: третий тир в approvals: allowlist → sandbox-ability → **classifier** (маленькая модель через providers.ts, промпт с уликами: команда+cwd+последние действия) → решение allow/sandbox/ask/block с reason в шину.
- **Required Modules**: `src/classifier.ts` (новый), точка входа в `approvals.ts`.
- **Required Contracts**: classify.request{action, context} → {verdict: allow|sandbox|ask|block, reason, model}; политика в policy.json (вкл/выкл тира).
- **Required Runtime**: один LLM-вызов ≤3с; таймаут → ask (fail-closed к оператору, не к allow).
- **Required Tests**: eval `contract.classifier_tier`; негатив: таймаут классификатора → ask; блок → событие CLASSIFIER_BLOCK + reason агенту.
- **Required Evidence**: серия прогонов: 20 команд → распределение вердиктов; лог-события в зеркале.
- **Dependencies**: P0-0 (объект классификации).
- **Risk**: ложные блоки → лимитировать только MUTATION-команды; квоты как в reviewer.
- **Effort**: M. **Priority**: **P0**.

## P0-2. OS-сандбокс (fs/syscall-конфайнмент)

- **Capability**: `sec.sandbox-os` (+ `sec.network-deny`, `sec.sandbox-config`).
- **Current State**: prlimit (rlimit) — лимиты ресурсов, но не границы доступа; exthost без сети «по построению».
- **Gap**: нет confinement'а файловой системы и syscall'ов (у Cursor: Landlock+seccomp/Seatbelt/Bwrap, overlay-remap, UID-remap, default-deny сеть с allowlist и SSRF-блоком).
- **Root Cause**: канон prlimit выбран для R60 как достаточный для stdio-расширений; для exec-агента недостаточно.
- **Required Architecture**: `src/sandbox2.ts`: Linux → **Landlock** (fs ruleset: rw только workspace, ro только чтение системного) + seccomp-профиль; сеть → выключена по умолчанию, allowlist доменов в policy.json (URL-фильтр на уровне прокси-обёртки); env-белый-список наследуется от exthost.
- **Required Modules**: `src/sandbox2.ts` (новый), интеграция в exec.ts и exthost.ts.
- **Required Contracts**: sandbox.profile{fs.rw[], fs.ro[], net: deny|allowlist[], env_keys[]} — «конфигурация как данные» в policy.json с merge-порядком user<repo<team(=hardcoded аналог).
- **Required Runtime**: чистый Node/Bun syscall-интерфейс (prctl/Landlock через bun:ffi) — без внешних зависимостей.
- **Required Tests**: негативы обязательны: попытка записи вне workspace → EACCES; обращение к секретному env → пусто; соединение к запрещённому домену → отказ; escape через symlink → отказ.
- **Required Evidence**: отчёт прогона с CURSOR-аналогичными маркерами (ME2_SANDBOX=1, LANDLOCK_STATUS) + eval `contract.sandbox2`.
- **Dependencies**: P0-0. **Risk**: FFI-хрупкость → fallback на prlimit+честный вердикт unsandboxed→ask. **Effort**: L. **Priority**: **P0**.

## P0-3. Внешние триггеры автоматизаций (event-plane)

- **Capability**: `auto.automations` + `long.subscriptions` + `auto.webhooks-in`.
- **Current State**: cron.ts + TASK_SCHEDULE + self-audit (внутренние расписания, 20-мин цикл).
- **Gap**: нет источников событий извне: GitHub (PR/CI/issue), webhooks-in, Slack/Linear. Cursor: 12 типов GitHub-триггеров + входящие webhooks (HMAC) + подписки агентов на события (wake).
- **Root Cause**: событийная шина слушает только себя и socket-клиентов; нет ingress-слоя.
- **Required Architecture**: `src/ingress.ts`: (1) входящие webhooks — POST /ingress/webhook/:source с HMAC-верификацией и пер-источником секретом из vault; (2) поллеры — GitHub poller (ETag/If-Modified-Since, без токена в логи) для sandbox/me2-os; (3) маппинг события → TASK_ENQUEUE/agentchat turn (действиями шины, не мимо неё).
- **Required Modules**: `src/ingress.ts` (новый), маршрут в index.ts (вне шины приём, шина для реакции).
- **Required Contracts**: ingress.event{source, type, payload_ref, signature_ok} → policy.json: какие события к каким objectives/задачам.
- **Required Runtime**: анти-шторм (коалесинг как у Cursor burst coalescing), идемпотентность по delivery-id, квоты.
- **Required Tests**: eval `contract.ingress`: HMAC неверный → 401; дубль → пропуск; событие → задача в шине; поллер офлайн → честный DEGRADED.
- **Required Evidence**: живой GitHub-триггер (issue → задача) сквозь гейт.
- **Dependencies**: vault (есть). **Risk**: секреты поллера → только env/vault. **Effort**: M. **Priority**: **P0**.

## P0-4. Durable execution долгоживущих агентов

- **Capability**: `long.long-running` + `long.durable-execution`.
- **Current State**: sqlite-журнал + зеркалоSupabase; supervisor mesh; pool-leases с reap. Прогон живёт, пока жив процесс daemon.
- **Gap**: нет workflow-двигателя, пережидающего смерть процесса/узла, нет plan-gate для многодневных прогонов (Cursor: 25–52ч, Temporal-подобный durable loop, подписки-wake).
- **Root Cause**: состояние персистентно, но ход исполнения не восстановим пошагово.
- **Required Architecture**: `src/durable.ts`: агентный прогон = **step-функция** (id, state, next); каждый шаг фиксирует input/output в sqlite (WAL) до исполнения (intent-log); при рестарте daemon → resume с последнего подтверждённого шага; plan-gate: прогоны >N часов требуют APPROVE-команду оператора (канон approvals).
- **Required Modules**: `src/durable.ts` (новый), hook в boot index.ts.
- **Required Contracts**: durable.run{id, plan_ref, steps[], status, last_ok_step}; событие DURABLE_RESUMED/STALLED.
- **Required Tests**: убийство процесса на шаге k → рестарт → продолжение с k+1 (без дублей); plan-gate без одобрения → пауза.
- **Required Evidence**: прогон 6+ часов с 2 форсированными рестартами, zero-loss (счётчики шагов).
- **Dependencies**: P0-0 (шаги = действия шины). **Risk**: двойное исполнение → intent-log идемпотентность. **Effort**: L. **Priority**: **P0**.

## P0-5. Swarm-протокол (planner→worker + handoff-документы)

- **Capability**: `fleet.swarm` + `fleet.handoff-docs` + `core.projects`.
- **Current State**: AGENT_SPAWN + handoffs.ts + objectives + pool; флот 134, координация — плоская.
- **Gap**: нет рекурсивного planner→worker дерева, нет контракта handoff-документа (notes/concerns/deviations/feedback), нет планировщика, который не имплементит.
- **Root Cause**: delegation есть, протокола нет.
- **Required Architecture**: `src/swarm.ts` поверх шины: planner-агент получает objective → декомпозирует в задачи с **handoff-документом** (структура фиксирована контрактом) → workers (pool) исполняют → результат возвращается как handoff-ответ; запрет planner'у на WRITE-действия (lane-политика по роли).
- **Required Modules**: `src/swarm.ts` (новый), роль-политика в autonomy.ts.
- **Required Contracts**: handoff.doc{objective, notes[], concerns[], deviations[], feedback[], done_criteria} — версия в contract.ts (v1→v2).
- **Required Tests**: eval `contract.swarm`: planner не пишет файлы; handoff-документ проходит валидацию; worker-fail → переразбор планировщиком (лимит 2).
- **Required Evidence**: демо: objective «добавь фичу в /ui» → 2 worker-задачи → PR-подготовка.
- **Dependencies**: P0-0. **Risk**: LLM-расход дерева → квоты/бюджет-губернатор. **Effort**: L. **Priority**: **P0**.

## P0-6. Plan Mode

- **Capability**: `plan.plan-mode`.
- **Current State**: roadmap.ts + objectives.ts — цели и дорожная карта есть; исследовательской фазы с кликабельным build-гейтом нет.
- **Gap**: нет pipeline «research → вопросы-уточнения → редактируемый план-файл → явный CLICK → build».
- **Root Cause**: objectives минуют фазу плана.
- **Required Architecture**: `src/planmode.ts`: план = файл в workspace (me2/plans/<id>.md, канон .cursor/plans); статусы DRAFT/APPROVED; build возможен только из APPROVED (проверка в TASK_ENQUEUE);
- **Required Modules**: `src/planmode.ts` (новый), фильтр в enqueue.
- **Required Contracts**: plan.item{id, status, build_gate: explicit_click}.
- **Required Tests**: build из DRAFT → отказ честный; из APPROVED → задача создана.
- **Required Evidence**: скриншот /ui с планом + кликом + событием PLAN_APPROVED.
- **Dependencies**: P0-0. **Risk**: низкий. **Effort**: S-M. **Priority**: **P0**.

## P0-7. Провижининг окружения агента (env-as-code)

- **Capability**: `cloud.vm-dev-env` (+ частично `cloud.environment-json`).
- **Current State**: me2-sandboxes + WORKER_ENROLLMENT; окружение daemon'а едино.
- **Gap**: нет контракта «окружение задачи»: репо+deps+secrets+startup, воспроизводимо и изолированно (у Cursor: VM+environment.json+Builds).
- **Required Architecture**: `src/envspec.ts`: envspec.json (канон environment.json): repo_ref, setup[], secrets_refs (vault), healthcheck; worker перед задачей применяет spec в worktree/песочнице; failure → честный ENV_SETUP_FAILED + диагностика (зерно self-healing).
- **Required Modules**: `src/envspec.ts` (новый), интеграция с worktrees.ts и pool.ts.
- **Required Contracts**: envspec.v1{repo, setup[], secrets[], healthcheck} — резолюция repo>personal>team.
- **Required Tests**: невалидный spec → отказ до старта; failing setup → ENV_SETUP_FAILED; healthcheck → READY.
- **Required Evidence**: прогон задачи в чистом worktree по envspec (лог + тайминг <10 мин).
- **Dependencies**: worktrees.ts (есть), vault (есть). **Risk**: время setup → кэш-снапшоты (зерно Builds, P1). **Effort**: M. **Priority**: **P0**.

## P0-8. MCP-клиент для агентов

- **Capability**: `ext.mcp-client`.
- **Current State**: mcp.ts — ME2 отличный MCP-**сервер** (7 tools, zero-authority); агенты внешние инструменты не потребляют.
- **Gap**: агент не может подключить внешний MCP-сервер (у Cursor: полный клиент с OAuth/политиками/аппрувами).
- **Required Architecture**: `src/mcpclient.ts`: агентский инструмент `mcp_call{server, tool, args}`; серверы — данные в policy.json (stdio|http), токены — vault; вызов проходит approvals (канон P0-1).
- **Required Tests**: списковые tools/list живого сервера (наш же mcp.ts как первый клиент — самопроверка!), tools/call + отказ неавторизованного.
- **Required Evidence**: агент через MCP-клиент вызывает daemon_health внешнего daemon'а (dogfooding-петля).
- **Dependencies**: P0-0. **Risk**: низкий (MCP = JSON-RPC, канон уже в репо). **Effort**: M. **Priority**: **P0**.

## P0-9. Hooks как пользовательские lifecycle-скрипты

- **Capability**: `ext.hooks`.
- **Current State**: enforcement жёстче канона (non-bypass, fail-closed), но не программируется оператором.
- **Gap**: нет 21-событийного пользовательского контура (before/after action, matcher, блокировка, followup-луп с лимитом).
- **Required Architecture**: `src/hooks.ts` (пользовательский слой ПОВЕРХ несгибаемой шины): события = подмножество переходов шины; хук = stdio-процесс под prlimit (канон exthost), exit 2 = блок действия (но не bypass core-политик — слоение: hooks не могут ослабить non-bypass).
- **Required Contracts**: hook.def{on, matcher, cmd, timeout, fail: open|closed}; hook.result{verdict, followup?}.
- **Required Tests**: блокирующий хук останавливает действие; зацикленный followup упирается в loop_limit; хук не может разрешить запрещённое (критично!).
- **Required Evidence**: демо-хук «запрет удаления файлов» + попытка → отказ + событие.
- **Dependencies**: exthost-канон (есть). **Risk**: hooks не должны стать дырой — fail-closed по умолчанию. **Effort**: M. **Priority**: **P0**.

---

## P1 (36 строк) — компактная таблица

| Gap | Суть | Модуль-кандидат | Effort |
|---|---|---|---|
| `sec.permissions-json` / `sec.sandbox-config` | permissions/sandbox как данные с merge-порядком | policy.json v2 | S |
| `cloud.builds` | снапшоты env, форк тёплого | envspec + кэш-слои | M |
| `ctx.semantic-index` | эмбеддинг-индекс кодовой базы | codegraph → вектора | L |
| `ctx.compaction` | перенос plan-state через сжатие | agentchat compact v2 | M |
| `ctx.dynamic-discovery` | файлы-как-примитив, lazy MCP-описания | mechanics v2 | M |
| `ext.skills` | SKILL.md-пакеты агента (совместимость со стандартом) | skills/ v2 | M |
| `ext.rules` | per-project rules с glob-активацией | rules.ts | S |
| `ext.subagents` | флаги tools/readonly/nesting | spawn-контракт v2 | S |
| `core.agent-review` | ревью PR-диффов, auto-after-commit, rules-файл | reviewer v2 | M |
| `core.checkpoints` | авто-снапшот перед правкой + restore | edit.ts + git | S |
| `core.edit-files` | diff-ревью accept/reject в /ui | /ui + edit.ts | M |
| `core.explore-subagent` | изолированный поисковый субагент | swarm.ts (роль explore) | S |
| `core.goal-loop` | агент выбирает интервал пробуждения | cron+objectives | S |
| `git.agent-delivery` | агент сам branch/commit/push/PR | exec.ts + gh-канал | M |
| `git.pr-review-merge` | агент-ревью и мерж по политике | reviewer+ingress | M |
| `api.rest-agents` | публичный API создания агентов (идемпотент) | rest v2 | M |
| `api.sse-run-stream` | SSE-стрим прогона с resume | socket→SSE мост | M |
| `api.pool-queue` | очередь пула как API (claim/release) | pool v2 | S |
| `cli.cli` | CLI-бинарник (headless+JSON) | bin/me2.ts | M |
| `ext.mcp-policy` | allowlist MCP per-tool | policy v2 | S |
| `cloud.egress-modes` | доменный allowlist-движок сети | sandbox2 net | M |
| `sec.bugbot` | ревью диффов по расписанию | reviewer+cron | M |
| `long.self-healing-env` | autoinstall: диагностика→починка→resume | envspec+heal | M |
| `core.project-context` | общий контекст проекта для сварм-агентов | memory v2 | M |
| `ext.harness-composition` | документированная композиция механизмов | docs+contract | S |
| `plan.context-preservation` | перенос контекста plan→build | planmode | S |
| `mdl.router` | простейший роутер (2 модели по стоимости/сложности) | router.ts | M |
| `core.harness-errors` | таксономия ошибок инструментов + триаж-автоматизация | events-аналитика | M |
| `fleet.coord-protocol-md` | протокол координации как один markdown | swarm | S |
| `fleet.handoff-docs` | handoff-документы как валидируемый контракт | swarm | S |
| `art.videos` | артефакт-видео сессии | screencast→file | S |
| `art.pr-attach` | артефакты, прикреплённые к PR/задаче | evidence v2 | S |
| `hand.remote-control` | полное Remote Control (действия из /ui) | /ui write v2 | M |
| `ext.plugins` | бандлы (rules+skills+hooks+MCP) | plugins.ts | M |
| `core.queued-messages` / `core.steering` | формализованная очередь/руление | agentchat v2 | S |
| `ext.sdk` | публичный SDK над контрактом | sdk.ts | L |

## P2/P3 (59 строк)

Полный перечень с приоритетами — R61-PARITY-MATRIX.md (колонка «Приоритет»); сводка: UX-слои (canvases, debug/design mode, side-chats, mobile-app, sharing), enterprise-контролы (SSO-вход device-flow — уже кандидат R61-дорожной карты мастера, signed commits, private connectivity), продукты уровня Origin-forge/Grok-Bot/SDK-эвалы — осознанно за горизонтом P1.

---

## Корневые причины (агрегат)

1. **Шина проектировалась под browser-fleet, не под кодовый harness** → P0-0/P0-1/P0-2.
2. **Enforcement жёсткий, но непрограммируемый** → P0-9.
3. **Событийный контур замкнут на себя** → P0-3.
4. **Исполнение персистентно, но не восстановимо пошагово** → P0-4.
5. **Делегация без протокола** → P0-5/P0-6.
6. **Окружение одно на всех** → P0-7.
7. **MCP-поверхность односторонняя** → P0-8.
