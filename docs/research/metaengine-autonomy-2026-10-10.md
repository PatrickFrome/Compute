# METAENGINE: автономное исполнение, история проекта и координация агентов — исследование 10 октября 2026

## Вывод для текущей разработки

Самый полезный перенос из изученных систем — устойчивый проверяемый цикл работы. Native Supervisor должен оставаться владельцем исполнения, PostgreSQL — владельцем координации и истории, UI — наблюдающим клиентом. Новая библиотека оркестрации сама по себе не закрывает разрыв между «агент ответил», «внешнее действие произошло» и «результат независимо проверен».

Пять приоритетов непосредственно для METAENGINE:

1. Стабильные `goal_id/project_id/task_id/run_id`, отдельные attempts и durable intent перед эффектом. Повтор команды сверяет receipt и состояние внешней системы; сбой после эффекта не превращается в слепой повтор.
2. Один append-only журнал проекта, причинные связи и bounded чтение по подтверждённому cursor. UI и агенты используют одинаковую разрешённую историю; stream ускоряет доставку, durable read восполняет пропуски.
3. Рекурсивное делегирование через штатную очередь child tasks: ancestry, lease generation, capacity/backpressure и явная политика завершения родителя. Общее число логических задач может расти, одновременно активные исполнители ограничены ресурсами.
4. Независимый verifier перед completion и продвижением знания: exact source SHA, изменённые bytes, выбранные host checks, observed exit/timeout/output, подтверждённый teardown и receipt. Публичное объяснение агента не заменяет эти доказательства.
5. Checkpoint epochs сохраняют cursor, выполненные/незавершённые ветви и ссылки на артефакты. Shared memory имеет provenance, scope, version, evaluation и отзыв; сжатие контекста не удаляет durable историю и не доказывает улучшение качества.

Это рекомендации METAENGINE. Источники ниже подтверждают механики соответствующих систем, но не гарантии нашего кода и не «лучшие результаты 2026».

## Метод и дата доказательств

Первичные документы и официальные репозитории прочитаны по HTTPS 10 октября 2026, Europe/Moscow; фактический readback пришёлся примерно на 00:52–00:56. Времена UTC 9 октября в HTTP/Git метаданных соответствуют этой местной дате. Для GitHub использован `commits?until=2026-10-10T20:59:59Z&per_page=1`: это последний доступный commit до конца указанного местного дня на момент чтения, а не предсказание дальнейших commits этого дня. Для закреплённых исходников использованы URLs с SHA.

Страницы документации являются **текущими снимками чтения**. HTTP `Last-Modified`, особенно у Markdown-сервисов, не доказывает дату появления функции. Version prerequisites на текущей странице тоже не равны release-date evidence. SHA/date ниже — отдельно проверяемая история репозитория. Для коммерческих продуктов такая история может содержать документацию и changelog, а не полный implementation source.

Сетевой readback проверяет доступность и содержание источника. Benchmark harnesses этих систем не запускались; модели, цены, install availability, лицензии и physical isolation не квалифицировались. Численные рекламные benchmark claims README исключены из сравнительной оценки. До OpenAI-выводов прочитан OpenAI Docs skill, выполнены official-domain search и фактическое чтение официальных страниц; выводы OpenAI опираются на `developers.openai.com` и `learn.chatgpt.com`.

Два URL потребовали корректировки: LangGraph `durable-execution.md` перенаправляет на `persistence.md`; детали получены из `checkpointers.md` и `fault-tolerance.md`. Старый OpenAI `agents-sdk.md` вернул 404 в Markdown, HTML был overview redirect; актуальный путь найден в official index: `guides/agents/sdk.md`. SWE-agent `config/environment/` вернул 404 и не использован как доказательство environment contract.

## Сравнение архитектурных механизмов

| Система | Что подтверждено первичными источниками | Что это даёт METAENGINE | Существенная граница |
| --- | --- | --- | --- |
| Temporal | Workflow durable history/replay; Activities с idempotency и retry; heartbeat details; child workflows; Continue-As-New | Stable goal/run identity, intent/receipt, bounded history epochs, child lifecycle | Activity retry сам не делает внешний эффект exactly-once. Нужны effect key и reconciliation. Child workflows не переносятся автоматически при parent Continue-As-New |
| LangGraph | Checkpoint каждого super-step, durable pending writes успешных соседних nodes, sync/async/exit durability, thread Store distinction, time travel, drain | Восстанавливать только незавершённые branches; checkpoint отдельно от shared knowledge; deliberate drain | In-memory saver теряется после restart; async/exit имеют crash gaps. Time travel повторно запускает downstream LLM/API calls и не является undo внешних эффектов |
| OpenHands SDK | Conversation/events/state/workspace boundaries, append-only EventLog, persistence/resume, Agent Server REST/WS, local/container/remote workspaces | Общий causally linked event source; независимый execution service; взаимозаменяемый execution adapter | LocalWorkspace — host subprocess, а не доказанная sandbox. Current SDK docs не квалифицируют наш executor или DB cursor ordering |
| SWE-agent / mini-SWE-agent | SWE-agent authors рекомендуют mini; mini default loop model→action→observation, сохранение trajectory, step/cost/wall-time/format-error limits | Минимальный inspectable agent loop, versioned trajectory и budgets; простой baseline для controlled comparison | Saved trajectory не гарантирует durable pre-effect intent/leases/exactly-once. `cost_limit` проверяется перед следующим call и может быть превышен стоимостью текущего вызова |
| Aider | Git commits/undo, dirty-change handling, configurable lint/test repair loop, bounded repository map | Reviewable change batches и edit→check feedback; компактный relevance-selected repo context | Commit не доказательство качества. Автоматическое commit пользовательского dirty state не подходит для нашего ownership contract без отдельного решения. По умолчанию pre-commit hooks могут обходиться |
| AutoGen / Magentic-One | Agent/team save/load state, termination conditions, task/progress ledgers, stall detection/replan в pinned source | Отдельный план, наблюдаемое продвижение, причины stall и bounded replanning | Model-generated progress verdict не независимое completion evidence. AutoGen README закреплённого SHA объявляет maintenance mode и рекомендует Microsoft Agent Framework для новых проектов |
| Claude Code | Subagent contexts/tools/permissions, bounded nesting/concurrency, memory scopes, worktree option, checkpoint/rewind, sandbox docs | Contract ограничений child agents, scoped memory и worktree ownership; explicit rewind boundaries | Rewind не восстанавливает shell changes и большинство subagent edits. File checkpoint не откатывает БД/network effects. Current page описывает nesting до трёх слоёв, а не бесконечную active recursion |
| Codex / OpenAI Agents SDK | Subagents и worktrees; bounded concurrent agents; SDK runner, sessions, handoff vs agents-as-tools, approval state, tracing, sandbox/harness separation | Одно владение workflow, сохранение run state при pause, narrow helper contracts, trusted harness отдельно от compute | SDK session, API conversation, agent run и sandbox — различные ресурсы. Transcript replay и server continuation нельзя бездумно смешивать. Наличие subagent feature не доказывает наш autonomous fleet |

## Подробные выводы

### Temporal: replay координатора и повтор внешнего действия — разные границы

[Workflow Execution](https://docs.temporal.io/workflow-execution) сохраняет историю workflow. [Activities](https://docs.temporal.io/activities) выполняют внешние операции и могут повторяться согласно retry policy. Документ прямо рекомендует idempotent Activity; при повторной попытке Activity начинается с начала, если её код не использует сохранённые heartbeat details. [Failure detection](https://docs.temporal.io/encyclopedia/detecting-activity-failures) различает execution timeouts и heartbeat; наличие heartbeat не удостоверяет полезный результат.

Перенос: внешний эффект получает ключ на уровне логической операции, а lease generation отвечает за допуск попытки. Durable `INTENT` фиксируется до эффекта; `PROVEN/FAILED/AMBIGUOUS` после наблюдения. Если процесс погиб после worktree add/agent dispatch и до receipt, восстановление читает внешнее состояние. Новый owner не повторяет неоднозначный dispatch только потому, что исчез старый PID.

[Continue-As-New](https://docs.temporal.io/workflow-execution/continue-as-new) передаёт актуальное состояние в новый Run ID при прежнем Workflow ID и новой истории. [Child Workflows](https://docs.temporal.io/child-workflows) допускают, что child сам становится parent; одновременно подчёркивают costs и history limits, отсутствие shared local state, необходимость Parent Close Policy. Ongoing children не переносятся автоматически, когда parent делает Continue-As-New.

Перенос: epoch меняет checkpoint/run, но durable child task IDs и результаты живут вне bounded context. Parent cancellation/epoch switch должны иметь explicit `wait/cancel/detach` policy; оператор видит её в истории. Рекурсивное дерево не должно дублировать children при restart. Число агентов — не метрика достижения цели.

### LangGraph: checkpoint, pending writes и знания между threads

[Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) отделяет checkpointer thread state от Store cross-thread data. [Checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers) сохраняют полные state snapshots на super-step boundaries и writes отдельного node до завершения всей параллельной ступени. После сбоя соседнего node successful nodes не требуется вычислять заново.

Режим `sync` сохраняет checkpoint до следующего шага; `async` допускает окно потери checkpoint при process crash; `exit` не обещает mid-run recovery. Это tradeoff конкретного backend, а не единая гарантия всех конфигураций. [Time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel) повторно исполняет nodes после выбранного checkpoint, включая LLM/API calls. Внешние эффекты требуют своей идемпотентности.

[Fault tolerance](https://docs.langchain.com/oss/python/langgraph/fault-tolerance) сохраняет failure provenance и описывает cooperative drain. Drain не убивает threads/async tasks сам по себе: для жёсткого deadline нужны cancellation и timeout. Перенос: graceful stop сохраняет завершившиеся branches, а hard crash/kill остаётся отдельным qualification scenario.

[Memory](https://docs.langchain.com/oss/python/concepts/memory) и [Stores](https://docs.langchain.com/oss/python/langgraph/stores) полезны для namespaces/relevance retrieval. METAENGINE должен добавлять отсутствующую в этом сравнении независимую promotion policy: observation → candidate knowledge → evaluated knowledge; rejected evidence не становится обязательной инструкцией новым агентам.

### OpenHands: события общие, состояние и исполнение имеют разных владельцев

[SDK overview](https://docs.openhands.dev/sdk/arch/overview) отделяет agent behavior SDK, Agent Server REST/WS и приложения. [Conversation](https://docs.openhands.dev/sdk/arch/conversation) содержит immutable EventLog и state-only/event-based updates. [Workspace](https://docs.openhands.dev/sdk/arch/workspace) задаёт local/container/remote execution interface. Pinned [EventLog source](https://github.com/OpenHands/software-agent-sdk/blob/1cfba2117e92730b0fe1c32520a39aad8611bb8c/openhands-sdk/openhands/sdk/conversation/event_store.py) содержит event IDs, assigned index и parent chain traversal с cycle checks; цепочка имеет ограничение чтения.

Перенос: project event содержит `seq`, `causal_parent_seq`, actor/task/attempt, тип и artifact/receipt references. UI не строит project identity из названия вкладки, agent title или local memory. Database registration/claim устанавливают binding. Локальный журнал проектного effect может существовать для crash reconciliation, но не становится второй несогласованной общей event history.

Local execution и isolated execution должны отображаться разными capability states. Создать subprocess adapter технически проще, чем доказать isolation: необходимы writable-layer limits, network/secret policy, subprocess-tree teardown и независимые physical probes.

### SWE-agent, mini-SWE-agent и Aider: простой loop как baseline, Git как артефакт

Pinned [SWE-agent README](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/README.md) указывает текущий фокус разработки на mini-SWE-agent и рекомендует его для дальнейшего использования. Pinned [mini default.py](https://github.com/SWE-agent/mini-swe-agent/blob/04d809ceab9df28f9adaed044884180159172930/src/minisweagent/agents/default.py) показывает model query, parsed actions, environment execution и observations; trajectory сохраняется в `finally`. Лимиты включают calls/steps, cost, wall time и consecutive format errors. Стоимость не является строгим prepaid admission budget: текущий call уже может превысить лимит.

Перенос: сначала воспроизводимый single-worker baseline на нашем наборе задач; затем сравнение с recursive workers при одинаковом source/model/check catalog/budget. Сохранение trajectory полезно для debugging/evals, но недостаточно для crash-safe effects: она может быть записана после действия.

[Aider Git integration](https://aider.chat/docs/git.html) делает edits reviewable и undoable через commits, отделяет dirty changes и имеет настройку hooks. [Lint/test loop](https://aider.chat/docs/usage/lint-test.html) использует output и nonzero exit для repair. [Repository map](https://aider.chat/docs/repomap.html) показывает подход к compact relevance-ranked code context.

Перенос: immutable diff/artifact digest связывается с check receipt. Host-owned check catalog полезнее candidate-supplied произвольной «проверки». Проверять итоговый diff и отсутствие evaluator tampering; зелёный exit команды, выбранной самим кандидатом, не удостоверяет успех задачи. Shared checkout edits/dirty-state commits не стоит переносить как default multiauthor behavior: isolated task worktrees и controlled integration подходят лучше.

### Magentic-One: progress ledger помогает управлению, не выдаёт полномочия

[Magentic-One](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/magentic-one.html) является AgentChat team. Pinned [orchestrator source](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py) содержит task ledger, progress ledger, проверки структуры ответа, progress/loop signals и счётчик stalls. [State](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/state.html) описывает save/load для агента и команды; [termination](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/termination.html) задаёт composable stop criteria.

Перенос: public plan/observations/next action/progress evidence/stall reason должны быть различимы. Model `is_request_satisfied` остаётся advisory, durable completion gate читает independently verified receipts. Replan ограничен budget; тот же ineffective plan не создаёт бесконечные children. Pinned [AutoGen README](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/README.md) объявляет maintenance mode; для новой зависимости требуется оценка актуального Microsoft Agent Framework, который в этом исследовании не квалифицирован.

### Claude Code: subagent isolation, recursion bounds и честное rewind

Текущая [Subagents page](https://code.claude.com/docs/en/sub-agents) описывает отдельный context, tools/permissions, `maxTurns`, memory scopes и `isolation: worktree`. Она явно описывает nested subagents до трёх слоёв и отдельное concurrency ограничение; total число agents за session не обязано иметь fixed ceiling. Эти конкретные defaults относятся к прочитанной версии страницы, а не обещают unlimited active workers у METAENGINE.

[Checkpointing](https://code.claude.com/docs/en/checkpointing) откатывает tracked edits, но не bash/shell file modifications; большинство subagent edits требуют Git revert. Резервная копия code/conversation не откатывает database writes, browser effects или dispatch. [Memory](https://code.claude.com/docs/en/memory) задаёт scoped persistent instructions/auto memory; persistence не эквивалентна проверенному знанию. [Sandboxing](https://code.claude.com/docs/en/sandboxing) описывает filesystem/network controls; shell permission и context discipline — разные защитные границы.

Перенос: ancestry/depth/cost/concurrency policy проходит host admission. Checkpoint UI обозначает scope rollback. Для RSI сохраняются previous version, candidate digest, evaluation set version, rollback target и immutable evaluation receipts. Чтение нового memory version проверяет его scope и отозванность.

### Codex и OpenAI Agents SDK: владелец результата, pause state и compute boundary

Текущая [Subagents documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents) описывает isolated contexts и concurrency configuration, а [Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees) — независимые working copies для parallel chats. [Long-running work](https://learn.chatgpt.com/docs/long-running-work) рекомендует конкретный outcome/completion criteria. Это продуктовые механики, не доказательство нашей DB authority или installed fleet.

[Agents SDK overview](https://developers.openai.com/api/docs/guides/agents/sdk), [Running agents](https://developers.openai.com/api/docs/guides/agents/running-agents) и [Results/state](https://developers.openai.com/api/docs/guides/agents/results) различают run, sessions, replay history, server conversation и response chaining. Нельзя дублировать full local history и server continuation без reconciliation. Approval interruption возобновляется из saved run state; это продолжение прежнего turn, а не новая задача. [Orchestration](https://developers.openai.com/api/docs/guides/agents/orchestration) различает handoff ownership и specialist-as-tool, где manager сохраняет ответственность за итог.

[Guardrails/approvals](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals) и [observability](https://developers.openai.com/api/docs/guides/agents/integrations-observability) дают validation/review/traces. Traces помогают расследованию; authority выдаёт отдельный admission contract. [Sandbox agents](https://developers.openai.com/api/docs/guides/agents/sandboxes) явно отделяет orchestration harness от compute, sandbox session/snapshot/mounts от run state и credentials от prompt. Provider-specific persistence/cleanup требуется проверить физически.

Дополнительное полезное сравнение — [Agents API events/items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events): transient events и saved messages/tool calls различаются. Reconnect pattern: открыть stream и buffer, получить saved items, восстановить по item ID, применить buffered updates и пропустить уже final items. Pagination использует `after`; одна страница не содержит всю history. Исторические items не сообщают, какие approvals сейчас pending, и reconnect не требует повторного task/approval dispatch.

Для METAENGINE DB cursor должен дополнительно гарантировать commit ordering. Простая PostgreSQL sequence, выделенная до commit двух конкурентных транзакций, может дать visible high-watermark, за которым позже коммитится более ранний номер. Если reader продвинулся за него, событие теряется. Выделение и вставка cursor в сериализованной project transaction либо иной доказанный ordering mechanism обязательны; это наш engineering requirement, не утверждение о перечисленных SDK.

## Контракт переноса и измерения

| Граница | Минимальная реализация | Проверка, отличающая гарантию от демонстрации |
| --- | --- | --- |
| Внешний эффект | Durable intent, immutable binding, fresh lease, stable effect key, terminal receipt | Kill после реального эффекта до receipt; restart сверяет внешний readback и не дублирует эффект |
| Project history | Canonical binding, append-only entries, commit-ordered project seq, snapshot `through_seq`, bounded cursor/filter queries | Конкурирующие транзакции с out-of-order commit; reconnect во время snapshot; no missing/duplicate rows; wrong project scope отказ |
| Recursive agents | Host-created child task IDs, parent/root IDs, ancestry, capacity lease, depth/cost/stop policy | Parent→child→grandchild выполняют useful task, duplicate spawn/restart не дублирует IDs; active cap соблюдён, queued branches не теряются |
| Completion | Independent check catalog, source/edit digests, no evaluator changes, observed receipts | Candidate объявляет success без checks/подменяет output; completion отказ. Истинный negative test остаётся FAILED после replay |
| Isolation | Trusted harness отдельно от candidate compute; explicit writable/network/secrets/process-tree budgets | Попытка write вне workspace, доступ к credentials/network, surviving descendant, teardown после crash; qualification указывает OS/provider/version |
| Checkpoint | Epoch, last confirmed cursor, completed/pending branches, artifact refs, schema/catalog version | Тысячи событий и несколько epochs; bounded resident memory; restart продолжает только pending branches |
| Memory/RSI | Scoped versioned evidence store, baseline/candidate, held-out eval, rollout/rollback target | Same tasks/budget сравнивают baseline и candidate; regressions блокируют promotion; отзыв версии влияет на новых agents |

Измерять нужно независимо: task success, evidence-qualified success, duplicate effects, missing events, recovery latency, attempts до успеха, tokens/cost, active/wait time, conflict/integration rate, output artifact validity, teardown failures и rollback regressions. Отдельно отображать model judgement, check pass и physical installed qualification.

Для проверки рекурсии сравнить single agent и два/три bounded поколения на одинаковом pinned task corpus. Успех суммарных offspring отчётов без integrated verified artifact не считается. Использовать задачи разной структуры: независимые edits, shared-file conflict, dependency chain, interrupted dispatch, unavailable provider, malicious instruction in repository data. Контрольные tasks не разрешается переписывать кандидатам; evaluation version фиксируется до запуска. [OpenAI evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices) поддерживает task-specific datasets, calibrated graders и continuous comparison. Прочитанная страница сообщает deprecation Evals platform, поэтому механизм measurement не должен зависеть от выбора именно этого managed продукта.

Rollout improvements: offline evaluation → shadow replay безопасных read-only decisions → limited admitted cohort → сравнение receipts/quality/cost → explicit promotion version → rollback при заранее заданных критериях. Это предлагаемая процедура METAENGINE; исследования эффективности rollout здесь не проводились. Shared memory revision и executable runtime revision должны откатываться независимо, сохраняя историю принятия решения.

## Проверенные repository anchors

| Репозиторий | Закреплённый SHA | Commit timestamp UTC | Значение |
| --- | --- | --- | --- |
| temporalio/sdk-python | `3fd2823f461483210c6f8ef7d65758225640f787` | 2026-10-09 21:47:57 | Доступный source anchor, не release qualification |
| langchain-ai/langgraph | `12aeb0fddb5e835a5745a10a72358c2de37a66a6` | 2026-10-09 19:59:10 | Source anchor; текущие docs snapshot отдельно |
| OpenHands/software-agent-sdk | `1cfba2117e92730b0fe1c32520a39aad8611bb8c` | 2026-10-09 19:47:33 | EventLog source прочитан с exact SHA |
| SWE-agent/SWE-agent | `3ea751c087f32b16e039a2233dd6eefecef325d5` | 2026-07-16 15:21:18 | README primary recommendation mini прочитана |
| SWE-agent/mini-swe-agent | `04d809ceab9df28f9adaed044884180159172930` | 2026-09-03 05:05:59 | README/default.py прочитаны с exact SHA |
| Aider-AI/aider | `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` | 2026-05-22 14:02:20 | Repository anchor; Git/test mechanics из официальных docs |
| microsoft/autogen | `027ecf0a379bcc1d09956d46d12d44a3ad9cee14` | 2026-04-06 22:35:32 | README maintenance и Magentic source прочитаны |
| anthropics/claude-code | `2301018b1f61073c501a8e7a4813ef48c239163b` | 2026-10-09 19:28:36 | Public changelog/docs anchor, не весь closed runtime source |

OpenAI comparison использует непосредственно официальную документацию, без вывода feature dates из внешнего репозитория. Числа benchmark из README не нормализованы по моделям, budget, tasks и harness; они не используются для ранжирования.

## Следующий ограниченный рубеж

Текущая рабочая копия уже связывает принятую цель с registered project, child/grandchild admission и общей DB history; Code и Task Sheet читают этот контракт с честным pagination window. [Критическая оценка механизмов](metaengine-mechanics-status-2026-10-10.md) отдельно фиксирует реализацию, fixture evidence и незакрытые границы. Следующий рубеж: installed goal → реальный child/grandchild useful work → actual edit/check → immutable completion evidence → process crash/restart → continuation. После этого measured baseline позволяет решать, какие planning/memory/recursive changes улучшают результаты.

Этот документ не объявляет autonomous system, production verifier, multi-generation useful work или self-improvement квалифицированными. Их статус определяется реализацией и независимыми acceptance receipts.
