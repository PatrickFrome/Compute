# R61 — CURSOR → METAENGINE PARITY MATRIX

Раунд: R61 (2026-09-24) · Источник: официальный корпус 329 страниц (docs.cursor.com sitemap + blog/security/changelog) · Сырьё: 360 capabilities из 7 треков → после дедупликации **138 строк матрицы**.

Статусы: `PARITY` · `PARTIAL` · `MISSING` · `SUPERIOR` · `UNKNOWN` · `NOT_APPLICABLE`. Приоритеты гэпов: P0 (критично следующему раунду) / P1 / P2 / P3.

Правило SUPERIOR (честность): только при (а) отсутствии документированного аналога Cursor в корпусе и (б) наличии верифицируемого evidence у ME2 (eval/PR/артефакт). Подробности каждой capability Cursor — в трек-файлах r61-track-*.md.

## Сводка

| Статус | Строк |
|---|---|
| PARITY | 18 |
| PARTIAL | 76 |
| MISSING | 34 |
| SUPERIOR | 6 |
| UNKNOWN | 0 |
| NOT_APPLICABLE | 4 |
| **Всего** | **138** |

Гэпы (PARTIAL+MISSING): **110** → P0: 15 · P1: 36 · P2: 44 · P3: 15

## Матрица по категориям

### 1. Core Agent & Harness (31)

| Cursor capability | Cursor | MetaEngine эквивалент | Статус | Приоритет | Примечание |
|---|---|---|---|---|---|
| `core.agent-loop` Cursor Agent core loop (instructions+tools+model, autonomous edit-test-repair) | GA | agentchat turn-loop (create/turn/compact/close) + GLM providers + reviewer | **PARTIAL** | P0 | loop есть per-chat; нет автономного harness edit→run→observe→repair над инструментами шины |
| `core.builtin-tools` Built-in tool suite (edit/read/search/terminal) | GA | bus 47: workspace r/w, browser 17, tasks, diagnostics | **PARTIAL** | P0 | нет TERMINAL/RUN-действия с approval-семантикой; нет edit-инструмента с diff-валидацией |
| `core.harness-triad` Agent = Instructions + Tools + Model (documented composition) | GA | contract.capabilities + policy.json + providers.ts | **PARTIAL** | P0 | триада есть, tools-поверхность тоньше |
| `core.ask-tool` Ask clarifying questions tool (non-blocking) | GA | — | **MISSING** | P2 | агент не может формально задать вопрос и ждать |
| `core.checkpoints` Checkpoints (auto pre-change snapshot + restore files) | GA | git + hash-chain + sqlite journal | **PARTIAL** | P1 | нет авто-снапшота файлов перед правкой с restore-UX |
| `core.queued-messages` Queued messages while agent works | GA | agentchat send queue | **PARTIAL** | P2 | поведение очереди не формализовано контрактом |
| `core.steering` Mid-run steering at tool-call boundary | GA | socket ops send/tick во время turn | **PARTIAL** | P2 | нет гарантии доставки на границе tool-call |
| `core.side-chats` Side chats (/side, /btw) from running agent | GA | — | **MISSING** | P3 |  |
| `core.conv-search` Cross-conversation search | GA | EVENTS_SEARCH (шина, не чаты) | **PARTIAL** | P2 |  |
| `core.goal-loop` /goal + /loop (long-lived objective, agent picks wake interval) | GA | objectives.ts + TASK_SCHEDULE + cron.ts | **PARTIAL** | P1 | нет семантики 'агент сам выбирает интервал пробуждения' |
| `core.mode-rotate` Agent mode rotation (Shift+Tab picker) | GA | — | **MISSING** | P2 |  |
| `core.multimodal-input` Image + voice input to agent | GA | скриншоты как файлы; VLM-канал вне агентного лупа | **PARTIAL** | P2 |  |
| `core.model-switch` Mid-conversation model switching | GA | AGENT_MODEL (смена модели агента) | **PARITY** | - |  |
| `core.edit-files` Multi-file editing + diff review + accept/reject | GA | WORKSPACE_WRITE + reviewer post-hoc | **PARTIAL** | P1 | нет diff-ревью UX и apply-модели с валидацией |
| `core.explore-subagent` Explore subagent (parallel search, own context) | GA | codegraph.ts + sense.ts | **PARTIAL** | P1 | нет изолированного поискового субагента с быстрыми параллельными запросами |
| `core.debug-mode` Debug Mode (hypothesis + instrumentation + human repro + targeted fix) | GA | — | **MISSING** | P2 |  |
| `core.design-mode` Design Mode (visual/voice prompting in running app) | GA | — | **MISSING** | P3 |  |
| `core.browser-tool` Browser tool (navigate/click/type/screenshot/console/network) | GA | browser-плоскость 17 действий + CDP obsv + screencast + a11y-snapshot | **PARITY** | - | candidate-superior (fleet BrowserCell) — не доказано бенчмарком |
| `core.canvas` Canvases (interactive artifacts, agent-management UIs) | GA | — | **MISSING** | P2 |  |
| `core.projects` Projects (coordinator plans-and-delegates, months of context) | BETA | AGENT_SPAWN + handoffs.ts + pool | **PARTIAL** | P0 | нет planner→worker дерева и project-shared-context |
| `core.project-context` Project shared context (files syncing across agents) | BETA | memory.ts | **PARTIAL** | P1 |  |
| `core.project-subscriptions` Project subscriptions (Slack/schedule/PR triggers → agent) | BETA | — | **MISSING** | P1 |  |
| `core.agents-window` Agents Window (fleet cockpit, all local+cloud agents) | GA | /ui Флот-панель | **PARTIAL** | P2 |  |
| `core.cloud-handoff` /in-cloud, /autopilot handoffs | BETA | — | **MISSING** | P2 |  |
| `core.diffs-view` Diffs view (review/commit/PR in-panel) | GA | git в смарт-мерже; /ui событийная река | **PARTIAL** | P2 |  |
| `core.agent-review` Agent Review (dedicated review pass, auto-after-commit, rules file) | GA | reviewer.ts (zero-authority LLM-ревью, анти-фальш сигналы) | **PARTIAL** | P1 | область: результаты задач vs PR-диффы; нет auto-after-commit и правил-файла |
| `core.run-modes` Run Modes (Auto-review/Allowlist/Run-Everything) | GA | lanes READ_ONLY/MUTATION/CONTROL/EMERGENCY + costs + approvals + policy | **PARTIAL** | P0 | нет classifier-тира и sandbox-when-possible режима |
| `core.per-model-harness` Per-model harness customization (edit formats, prompts) | GA | providers.ts (GLM-адаптация) | **PARTIAL** | P2 |  |
| `core.harness-evals` Harness measurement (CursorBench, A/B, keep-rate) | GA | eval.ts v25 61/61 (CI-gate) + bench.ts | **PARITY** | - | разные цели: контрактный гейт vs продуктовый бенч |
| `core.harness-errors` Tool-error taxonomy + alerts + weekly triage automation | GA | честные вердикты DEGRADED + self-audit события | **PARTIAL** | P2 |  |
| `core.historical-guardrails` (HIST) static context guardrails, capped tool calls | DEPRECATED | — | **NOT_APPLICABLE** | - | Cursor сам ушёл от статических лимитов |

### 2. Planning & Projects (4)

| Cursor capability | Cursor | MetaEngine эквивалент | Статус | Приоритет | Примечание |
|---|---|---|---|---|---|
| `plan.plan-mode` Plan Mode (research → clarifying → editable plan → click-to-build) | GA | roadmap.ts + objectives.ts | **PARTIAL** | P0 | нет .cursor/plans-аналога и явного build-гейта |
| `plan.plan-restart` Restart-from-plan workflow | GA | TASK_RETRY | **PARTIAL** | P2 |  |
| `plan.task-tracking` Task tracking (todos/plan items) | GA | tasks + work_graph | **PARITY** | - |  |
| `plan.context-preservation` Context preservation across plan→build | GA | compact op + memory economy | **PARTIAL** | P1 |  |

### 3. Extensibility (Rules/Skills/Subagents/Hooks/MCP/Plugins/SDK) (19)

| Cursor capability | Cursor | MetaEngine эквивалент | Статус | Приоритет | Примечание |
|---|---|---|---|---|---|
| `ext.rules` Rules (.cursor/rules, frontmatter, globs, alwaysApply) | GA | policy.json как данные | **PARTIAL** | P1 | нет per-project prompt-гайденса с активацией по glob |
| `ext.rules-precedence` Rules precedence team→project→user | GA | policy merge частично | **PARTIAL** | P2 |  |
| `ext.agents-md` AGENTS.md root+nested | GA | — | **MISSING** | P2 |  |
| `ext.skills` Agent Skills (SKILL.md packages, scripts, progressive load) | GA | skills/ + skills/ext манифесты | **PARTIAL** | P1 | наши ext — изолированные расширения хоста, не SKILL.md-пакеты агента |
| `ext.skills-migration` /migrate-to-skills (deprecate rules/slash-commands) | GA | — | **NOT_APPLICABLE** | - |  |
| `ext.subagents` Custom subagents (files, model, tools restriction, readonly, nesting depth-2) | GA | AGENT_SPAWN + AGENT_MODEL + pool | **PARTIAL** | P1 | нет флагов tools/readonly/nesting-лимитов |
| `ext.subagents-builtin` Built-in subagents (Explore/Bash/Browser) | GA | sense/screencast-воркеры | **PARTIAL** | P2 |  |
| `ext.subagents-lifecycle` Subagent lifecycle (background/resume/failure) | GA | pool leases (UNIQUE task_id) + reaper + resume | **PARITY** | - | lease-семантика честная, канон |
| `ext.hooks` Hooks (21 events, blocking, failClosed, loop_limit) | GA | bus lanes + approvals + non-bypass (жёстче, но не user-scriptable) | **PARTIAL** | P0 | нет пользовательских lifecycle-скриптов; наша enforcement-шина строже, но не программируется оператором |
| `ext.hooks-claude-compat` Third-party hooks import (Claude Code) | GA | — | **MISSING** | P3 |  |
| `ext.mcp-server` MCP server exposure (Cursor as MCP provider via CLI) | GA | mcp.ts Streamable HTTP + stdio (7 tools, zero-authority) | **PARITY** | - |  |
| `ext.mcp-client` Agents consuming external MCP servers (tools/resources/prompts, auth) | GA | — | **MISSING** | P1 | ME2-агенты не умеют подключать внешние MCP |
| `ext.mcp-policy` Enterprise MCP policy (allowlist, per-tool, network modes) | GA | policy.json | **PARTIAL** | P2 |  |
| `ext.plugins` Plugins (.cursor-plugin bundle: rules+skills+hooks+MCP+variables) | GA | skills/ext каталог | **PARTIAL** | P2 |  |
| `ext.marketplace` Marketplace + team install modes (Off/On/Required) | GA | — | **MISSING** | P3 |  |
| `ext.sdk` SDK TS/Python (headless L4 agents, stream/steer/resume, custom tools) | BETA | REST+socket контракт v1 | **PARTIAL** | P2 | контракт есть, публичного SDK нет |
| `ext.sdk-custom-tools` SDK custom in-process tools (hidden MCP) | BETA | — | **MISSING** | P2 |  |
| `ext.extapi` vscode.cursor extension API (MCP/plugins registration) | GA | N/A — свой exthost-канон (R60) | **NOT_APPLICABLE** | - |  |
| `ext.harness-composition` Documented composition rules+skills+subagents+hooks+MCP across IDE/CLI/cloud/SDK | GA | контракт + шина едины для /ui, MCP, ext | **PARTIAL** | P1 | единообразие есть, документированной композиции нет |

### 4. Cloud Agents & Development Environment (14)

| Cursor capability | Cursor | MetaEngine эквивалент | Статус | Приоритет | Примечание |
|---|---|---|---|---|---|
| `cloud.vm-dev-env` Full dev environment per-agent VM (clone+deps+secrets+startup) | GA | me2-sandboxes + WORKER_ENROLLMENT | **PARTIAL** | P0 | нет контракта провижининга окружения для агента |
| `cloud.parallel-scale` Massive parallelism, laptop-independent | GA | pool 4 слота + флот 134 | **PARTIAL** | P1 |  |
| `cloud.microvm` Firecracker microVM isolation, per-agent keys | GA | prlimit+stdio-only+env-whitelist (exthost) | **PARTIAL** | P1 | границы процессов, не VM |
| `cloud.builds` Builds (pre-warm env, hourly snapshots, fork warm VM 3x TTFT) | GA | — | **MISSING** | P1 |  |
| `cloud.environment-json` environment.json / Dockerfile env-as-code | GA | — | **MISSING** | P1 |  |
| `cloud.agent-led-setup` Agent sets up own environment (<10 min guidance) | GA | start.sh + watchdog | **PARTIAL** | P2 |  |
| `cloud.multi-repo` One env, many repos (monorepo+multi-repo) | GA | — | **MISSING** | P2 |  |
| `cloud.secrets` Secrets management & injection (dashboard tab) | GA | vault (R47, 0600, никогда в логи) | **PARITY** | - |  |
| `cloud.secret-redaction` [REDACTED] runtime secrets scrubbing | GA | маскирование URL/секретов + guard 0 + env-белый-список | **PARITY** | - |  |
| `cloud.oidc-tokens` Short-lived OIDC JWTs from VM socket (aud-bound) | GA | supabase-jwt.ts (TTL 120с, gotrue-канал) | **PARTIAL** | P2 | область: только Supabase |
| `cloud.signed-commits` HSM-backed Ed25519 signed commits | GA | — | **MISSING** | P3 |  |
| `cloud.egress-default` Internet ON by default for agents | GA | полная сеть в песочнице (curl-канон R61) | **PARITY** | - |  |
| `cloud.egress-modes` 3 egress modes + allowlist + Enterprise lock + published IPs | GA | exthost no-net-by-construction; доменного движка нет | **PARTIAL** | P1 | для ext строже (нет сети), общего policy-движка нет |
| `cloud.private-connectivity` PrivateLink/Cloudflare Tunnel/Tailscale to private SCMs | GA | — | **MISSING** | P3 |  |

### 5. Long-Running & Durable Execution (8)

| Cursor capability | Cursor | MetaEngine эквивалент | Статус | Приоритет | Примечание |
|---|---|---|---|---|---|
| `long.followups` Follow-ups to running agent | GA | agentchat send | **PARTIAL** | P2 |  |
| `long.subscriptions` Subscriptions: wake on CI/Slack/Linear/timer events (180d) | GA | cron.ts (внутренний) + self-audit | **PARTIAL** | P0 | нет внешних источников событий |
| `long.auto-ci-fix` Automatic CI-failure fixing on own PRs | GA | — | **MISSING** | P2 |  |
| `long.long-running` Long-running agents (25–52h, plan-approval harness) | PREVIEW | supervisor mesh + leases + checkpoint sqlite | **PARTIAL** | P0 | нет многодневных прогонов с plan-gate |
| `long.durable-execution` Durable execution (Temporal-backed loop, node failure recovery) | GA(инфра) | sqlite journal + SQL-зеркало | **PARTIAL** | P0 | нет workflow-движка с resume после смерти процесса |
| `long.stuck-detection` Stuck/timeout detection + handling | GA | watchdog + lease reap + exthost kill (2с ack) | **PARITY** | - |  |
| `long.self-healing-env` Cloud Doctor / autoinstall (diagnose→repair→verify→resume) | GA | self-audit (20 мин, переходные события) + гейт-само-восстановление R56 + watchdog | **PARTIAL** | P1 | лечит свой контур; нет generic autoinstall зависимостей |
| `long.hibernate` VM hibernation/resume/fork, snapshot restore | GA | restore из зеркала (state) | **PARTIAL** | P2 |  |

### 6. Security, Sandbox, Approvals (9)

| Cursor capability | Cursor | MetaEngine эквивалент | Статус | Приоритет | Примечание |
|---|---|---|---|---|---|
| `sec.auto-review-classifier` Auto-review LLM classifier (small model, agentic, pre-exec) | GA | reviewer.ts (post-hoc, zero-authority) | **PARTIAL** | P0 | нет пре-исполнения классификатора команд |
| `sec.sandbox-os` OS subprocess-tree sandbox (Seatbelt/Landlock+seccomp/Bwrap) | GA | prlimit (--as --nofile --core) только лимиты | **PARTIAL** | P0 | нет fs/syscall-конфайнмента |
| `sec.sandbox-config` sandbox.json (fs/network config, protected paths, merge order) | GA | policy.json + CAPS_WHITELIST | **PARTIAL** | P1 |  |
| `sec.network-deny` Default-deny network + pkg-manager allowlist + SSRF-block | GA | exthost нет сети по построению | **PARTIAL** | P1 |  |
| `sec.cursorignore` .cursorignore (context+read exclusion, overlay-remap unreadable) | GA | — | **MISSING** | P2 |  |
| `sec.permissions-json` permissions.json (MCP/terminal allowlists, autoRun) | GA | policy.json | **PARTIAL** | P1 |  |
| `sec.security-agents` Security Agents (PR Security Reviewer + cron Vuln Scanner) | GA | — | **MISSING** | P2 |  |
| `sec.bugbot` Bugbot (agentic PR review, learned rules, Autofix) | GA | reviewer.ts (задачи, не PR) | **PARTIAL** | P2 |  |
| `sec.pr-approval-agent` PR Routing & Approval agent (risk threshold, policy-file self-hardening) | GA | — | **MISSING** | P3 |  |

### 7. Computer Use (5)

| Cursor capability | Cursor | MetaEngine эквивалент | Статус | Приоритет | Примечание |
|---|---|---|---|---|---|
| `cuse.cloud-computer-use` Computer Use in cloud VMs (desktop+browser, self-recording) | GA | browser-плоскость только; desktop нет | **MISSING** | P1 | главный computer-use gap |
| `cuse.desktop-recording` Session video/screenshot artifacts | GA | screencast.ts (живой стрим, не артефакт) | **PARTIAL** | P2 |  |
| `cuse.remote-takeover` Human remote-desktop takeover + release back | GA | /ui просмотр (view-only) | **PARTIAL** | P2 |  |
| `cuse.grok-bot` Grok Bot: durable Bots on persistent per-user microVM computers | GA | — | **MISSING** | P3 | отдельный продукт |
| `cuse.selfhosted-cu` Self-hosted computer use worker (--computer-use, --share-desktop) | GA | — | **MISSING** | P3 |  |

### 8. Git & Software Delivery (5)

| Cursor capability | Cursor | MetaEngine эквивалент | Статус | Приоритет | Примечание |
|---|---|---|---|---|---|
| `git.worktrees` Git worktrees per agent (cap 25, setup scripts) | GA | worktrees.ts (cap 8, whitelist, timeouts) | **PARITY** | - | лимит 8 vs 25 — параметр |
| `git.agent-delivery` Agent branch/commit/push/PR end-to-end | GA | смарт-мерж оператора + git-sync.sh | **PARTIAL** | P1 | доставка агентом не автоматизирована |
| `git.pr-review-merge` PR review + merge + conflict resolution by agents | GA | CI-гейты PR (daemon/ui/ui-build) | **PARTIAL** | P1 |  |
| `git.multi-agent-repo` Multiple agents on same repository safely | GA | pool leases UNIQUE + worktrees | **PARITY** | - |  |
| `git.origin-forge` Origin: собственный git-forge (hosting+PR+apps+mirror) | BETA | GitHub sandbox/me2-os + git-sync | **MISSING** | P3 |  |

### 9. Automations, API, CLI (9)

| Cursor capability | Cursor | MetaEngine эквивалент | Статус | Приоритет | Примечание |
|---|---|---|---|---|---|
| `auto.automations` Automations: cron + event triggers (GitHub 12 типов/GitLab/Slack/webhooks/Linear/Sentry/PagerDuty) | GA | cron.ts + TASK_SCHEDULE + self-audit (внутренние) | **PARTIAL** | P0 | нет внешних триггеров — главный automation gap |
| `auto.webhooks-in` Inbound webhooks (private endpoint + API key) | GA | — | **MISSING** | P1 |  |
| `auto.webhooks-out` Outbound webhooks (statusChange, HMAC) | GA | — (есть SSE socket шина внутрь) | **MISSING** | P2 |  |
| `api.rest-agents` Cloud Agents REST API (create/list/stop, repos≤20, subagents≤20, idempotent) | BETA | REST read + POST whitelist (/exthost/run, /tokens, /policy, /demand, /cron) | **PARTIAL** | P1 |  |
| `api.sse-run-stream` SSE run stream (Last-Event-ID resume, presigned artifacts) | BETA | socket.io шина (events) | **PARTIAL** | P1 |  |
| `api.pool-queue` Worker pools queue API (list/SSE/claim/release, scale-to-zero) | v0 | pool.ts leases + WORKER_ENROLLMENT/HEARTBEAT/REAP | **PARTIAL** | P1 | внутренняя, не публичный API |
| `cli.cli` Cursor CLI (interactive+headless, JSON output, sessions resume/fork) | GA | mcp-stdio + REST (нет CLI-бинарника) | **PARTIAL** | P1 |  |
| `cli.acp` ACP server (JSON-RPC stdio, request_permission) | GA | — (есть MCP-stdio) | **MISSING** | P3 |  |
| `cli.github-actions` GitHub Actions integration (L2/L4 autonomy patterns) | GA | CI-гейты смарт-мержа (реагирует, не действует) | **MISSING** | P2 |  |

### 10. Models & Routing (4)

| Cursor capability | Cursor | MetaEngine эквивалент | Статус | Приоритет | Примечание |
|---|---|---|---|---|---|
| `mdl.own-models` Own model line (Composer/RL/training infra) | GA | N/A (GLM-провайдеры) | **NOT_APPLICABLE** | - | стратегически: RSI-контур вместо тренинга |
| `mdl.router` Cursor Router (Compass P(satisfaction) + таксономия + budget per mode) | GA | ручной AGENT_MODEL | **MISSING** | P1 |  |
| `mdl.catalog` Model catalog 55 моделей/7 провайдеров + Cursor Token Rate | GA | providers.ts (GLM-семейство) | **PARTIAL** | P2 |  |
| `mdl.cost-governor` Cost-based routing/optimization | GA | budget governor (6..96/60) на стоимости действий шины | **PARTIAL** | P2 | разные валюты: bus-cost vs token-cost |

### 11. Context Engineering, Memory, Evals (4)

| Cursor capability | Cursor | MetaEngine эквивалент | Статус | Приоритет | Примечание |
|---|---|---|---|---|---|
| `ctx.semantic-index` Merkle-tree codebase indexing + custom embeddings | GA | codegraph.ts (структурный граф) | **PARTIAL** | P1 | нет эмбеддинг-индекса |
| `ctx.dynamic-discovery` Dynamic context discovery (files-as-primitive, 5 паттернов) | GA | mechanics.ts + sense | **PARTIAL** | P1 |  |
| `ctx.compaction` Self-summarization (trained compaction, plan-state перенос) | GA | agentchat compact + memory economy | **PARTIAL** | P1 |  |
| `ctx.memory` Persistent agent memory | UNKNOWN (в корпусе не найдено) | memory.ts: эпизоды/семантика/процедуры + economy + memSearch | **SUPERIOR** | - | corpus-negative: у Cursor на исследованной поверхности персист-памяти агентов нет; у ME2 реализована и документирована |

### 12. Multi-Agent / Fleet (9)

| Cursor capability | Cursor | MetaEngine эквивалент | Статус | Приоритет | Примечание |
|---|---|---|---|---|---|
| `fleet.swarm` Agent swarm (recursive planner/worker trees, handoff-doc protocol) | RESEARCH | AGENT_SPAWN + handoffs.ts + objectives | **PARTIAL** | P0 | нет протокола planner→worker и handoff-документов как контракта |
| `fleet.handoff-docs` Handoff documents (notes/concerns/deviations/feedback) | RESEARCH | handoffs.ts | **PARTIAL** | P1 |  |
| `fleet.agent-vcs` Custom agent VCS (1000 commits/s, coordination inside VCS) | RESEARCH | git + hash-chain | **PARTIAL** | P3 |  |
| `fleet.field-guide` Field Guide (agent-owned shared memory, auto-injected) | RESEARCH | memory.ts + roadmap.ts | **PARTIAL** | P2 |  |
| `fleet.merge-umpire` Neutral merge-umpire agent | RESEARCH | — | **MISSING** | P2 |  |
| `fleet.coord-protocol-md` Whole coordination protocol = one markdown file | RESEARCH | contract.ts (v1) | **PARTIAL** | P1 |  |
| `fleet.economics` Planner/worker model-mix (8x cheaper) | RESEARCH | pool (GLM-слоты одной модели) | **PARTIAL** | P2 |  |
| `fleet.parallel-ui` Parallel multi-agent interface (best-of-N, worktrees) | GA | /ui флот | **PARTIAL** | P2 |  |
| `fleet.mobile` iOS app (launch/steer/merge from phone) | BETA | /ui responsive (моб. QA R60) | **PARTIAL** | P3 |  |

### 13. Artifacts / Proof of Work (5)

| Cursor capability | Cursor | MetaEngine эквивалент | Статус | Приоритет | Примечание |
|---|---|---|---|---|---|
| `art.screenshots` Screenshots as evidence/artifacts | GA | BROWSER_SCREENSHOT + download/rXX | **PARITY** | - |  |
| `art.videos` Video artifacts attached to results | GA | screencast (стрим, не файл-артефакт) | **PARTIAL** | P2 |  |
| `art.logs` Logs attached to agent results | GA | EVENTS + dev.log/daemon.log | **PARITY** | - |  |
| `art.pr-attach` Artifacts attached to PR | GA | evidence-chain (вне PR) | **PARTIAL** | P2 |  |
| `art.trace` Execution trace of agent work | UNKNOWN | hash-chain событий + evidence-chain + OTel-спаны + non-bypass манифест | **SUPERIOR** | - | corpus-negative: у Cursor нет документированного эквивалента tamper-evident trace; у ME2 — верифицируемая цепь |

### 14. Human ↔ Agent Handoff (3)

| Cursor capability | Cursor | MetaEngine эквивалент | Статус | Приоритет | Примечание |
|---|---|---|---|---|---|
| `hand.remote-control` Remote Control (управлять локальным агентом извне) + takeover | GA | /ui + gate :81 (удалённое управление daemon) | **PARTIAL** | P2 |  |
| `hand.local-cloud` Local⇄cloud session transfer (Move to Cloud/Remote) | GA | N/A (нет cloud-плоскости) | **MISSING** | P3 |  |
| `hand.sharing` Share agent runs (view/follow-up permissions) | GA | — | **MISSING** | P3 |  |

### 15. Infra-инварианты ME2 (self-update, шина, аудит, state-plane) (6)

| Cursor capability | Cursor | MetaEngine эквивалент | Статус | Приоритет | Примечание |
|---|---|---|---|---|---|
| `infra.self-update` Self-update (manifest→download→atomic→health→rollback) | GA | selfupdate.ts E2E + версионная матрица | **PARITY** | - |  |
| `infra.nonbypass-bus` — (нет аналога в корпусе) | UNKNOWN | шина 47 + non-bypass манифест 30/30 + eval-гейт | **SUPERIOR** | - | corpus-negative + evidence: eval v25 ловит незарегистрированные REST-маршруты |
| `infra.audit-loop` — (K8s/AWS-Config узор вне продуктов-аналогов) | UNKNOWN | self-audit.ts: RLS+реестр-243, события только на переходах, 20 мин | **SUPERIOR** | - | corpus-negative + evidence: PASS/FAIL-переходы в живом daemon |
| `infra.exthost-strict` VS Code exthost (env наследует, нет rlimit) | GA | exthost: prlimit+env-белый-список+stdio-only+caps | **SUPERIOR** | - | evidence R60: 3 измерения строже канона |
| `infra.state-plane` — (облако-провайдер state нет) | UNKNOWN | Supabase-зеркало LIVE + RLS fail-closed (42501) + reconcile-хеш 243 | **SUPERIOR** | - | corpus-negative + evidence: sql/0003+0004, reconcile PASS |
| `infra.contract` — (нет публичного контракта-хендшейка) | UNKNOWN | me2-daemon-contract.v1 + version-matrix + честный DEGRADED | **PARITY** | - | канон LSP/MCP-handshake |

## Топ-гэпы P0 (dependency-ядро, см. R61-ROADMAP.md)
- `core.agent-loop` (PARTIAL): Cursor Agent core loop (instructions+tools+model, autonomous edit-test-repair)
- `core.builtin-tools` (PARTIAL): Built-in tool suite (edit/read/search/terminal)
- `core.harness-triad` (PARTIAL): Agent = Instructions + Tools + Model (documented composition)
- `core.projects` (PARTIAL): Projects (coordinator plans-and-delegates, months of context)
- `core.run-modes` (PARTIAL): Run Modes (Auto-review/Allowlist/Run-Everything)
- `plan.plan-mode` (PARTIAL): Plan Mode (research → clarifying → editable plan → click-to-build)
- `ext.hooks` (PARTIAL): Hooks (21 events, blocking, failClosed, loop_limit)
- `cloud.vm-dev-env` (PARTIAL): Full dev environment per-agent VM (clone+deps+secrets+startup)
- `long.subscriptions` (PARTIAL): Subscriptions: wake on CI/Slack/Linear/timer events (180d)
- `long.long-running` (PARTIAL): Long-running agents (25–52h, plan-approval harness)
- `long.durable-execution` (PARTIAL): Durable execution (Temporal-backed loop, node failure recovery)
- `sec.auto-review-classifier` (PARTIAL): Auto-review LLM classifier (small model, agentic, pre-exec)
- `sec.sandbox-os` (PARTIAL): OS subprocess-tree sandbox (Seatbelt/Landlock+seccomp/Bwrap)
- `auto.automations` (PARTIAL): Automations: cron + event triggers (GitHub 12 типов/GitLab/Slack/webhooks/Linear/Sentry/PagerDuty)
- `fleet.swarm` (PARTIAL): Agent swarm (recursive planner/worker trees, handoff-doc protocol)

## SUPERIOR-строки (обоснование)
- `ctx.memory`: corpus-negative: у Cursor на исследованной поверхности персист-памяти агентов нет; у ME2 реализована и документирована
- `art.trace`: corpus-negative: у Cursor нет документированного эквивалента tamper-evident trace; у ME2 — верифицируемая цепь
- `infra.nonbypass-bus`: corpus-negative + evidence: eval v25 ловит незарегистрированные REST-маршруты
- `infra.audit-loop`: corpus-negative + evidence: PASS/FAIL-переходы в живом daemon
- `infra.exthost-strict`: evidence R60: 3 измерения строже канона
- `infra.state-plane`: corpus-negative + evidence: sql/0003+0004, reconcile PASS
