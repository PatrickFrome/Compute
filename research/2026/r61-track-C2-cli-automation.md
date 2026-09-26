# R61-C2 — Cursor CLI + Automations + Git Delivery + Integrations + API research catalog

Agent: research-track-C2 (research-only). Corpus: /tmp/r61-corpus (fetch date 2026-09-24). Sources = corpus docs + blog files with SOURCE_URL headers. Statuses reflect current docs unless marked historical.
Autonomy scale: L0 manual · L1 suggest · L2 semi(approval) · L3 autonomous-guardrails · L4 fully-autonomous.

## A. CLI (`agent` binary)

### cli-install: CLI install & auto-update
- Category: cli
- Cursor Status: GA (launched in BETA Aug 7 2025; docs now unqualified)
- Source: docs/cli__installation.txt; blog__cli.txt (Aug 7 2025)
- What/Invoke: one-liner install `curl https://cursor.com/install -fsS | bash` (PowerShell variant for native Windows); binary `agent`; `agent --version`, `agent update`; auto-updates by default.
- Runtime behind: shell installer → `~/.local/bin/agent`.
- Limitations: launch blog: "This CLI is still in beta. Security safeguards are still evolving" (historical).
- Autonomy: n/a (L0 tooling)
- Evidence: "Install Cursor CLI with a single command"; "Cursor CLI will try to auto-update by default"
- Confidence: HIGH

### cli-interactive: Interactive agent session with modes
- Category: cli
- Cursor Status: GA
- Source: docs/cli__overview.txt, cli__using.txt
- What/Invoke: `agent` / `agent "<prompt>"`; modes Agent (default, full tools), Plan (`/plan`, Shift+Tab, `--plan`), Ask (`/ask`, read-only); review UI Ctrl+R; @file context; skills/custom modes (Enter attach once, Option+Enter sticky custom mode); terminal notification on finish.
- Runtime: same agent harness as editor; rules from `.cursor/rules` + `AGENTS.md` + `CLAUDE.md` auto-loaded.
- Limitations: —
- Autonomy: L2 (command approval y/n before terminal commands)
- Evidence: "Before running terminal commands, CLI will ask you to approve (y) or reject (n)"; "Agent has tools for file operations, searching, running shell commands, and web access"
- Confidence: HIGH

### cli-print: Headless print mode
- Category: cli
- Cursor Status: GA
- Source: docs/cli__headless.txt, cli__using.txt, cli__overview.txt
- What/Invoke: `agent -p "prompt"` non-interactive for scripts/CI; combine `--output-format`; without `--force` changes "are only proposed, not applied"; `--force`/`--yolo` allows direct file changes without confirmation; `--trust` skips workspace trust prompt in headless.
- Runtime: full tool access in print mode ("Has access to all tools, including write and shell").
- Limitations: thinking events suppressed in print mode.
- Autonomy: L2 by default (approval unless allowlisted), L4 with `--force` + allowlist
- Evidence: "With non-interactive mode, you can invoke Agent in a non-interactive way… scripts, CI pipelines"; "Without --force, changes are only proposed, not applied"
- Confidence: HIGH

### cli-output: Output formats for automation
- Category: cli
- Cursor Status: GA
- Source: docs/cli__reference__output-format.txt
- What/Invoke: `--output-format text|json|stream-json` (default text; only with `--print`); `json` = single result object (result, session_id, duration_ms); `stream-json` = NDJSON events (system/init, user, assistant, tool_call started/completed, result); `--stream-partial-output` = char-level deltas with timestamp_ms/model_call_id dedup fields.
- Runtime behind: CLI process stdout; failure = non-zero exit + stderr (no JSON).
- Limitations: json waits for completion; unknown fields may be added backward-compatibly.
- Autonomy: n/a
- Evidence: "emits a single JSON object… when the run completes successfully"; "--stream-partial-output … emits text as it's generated in small chunks"
- Confidence: HIGH

### cli-sessions: Session lifecycle (resume/fork/rewind)
- Category: cli
- Cursor Status: GA
- Source: docs/cli__overview.txt, cli__using.txt, cli__reference__slash-commands.txt
- What/Invoke: `agent ls`, `agent resume`, `--continue` (alias `--resume=-1`), `--resume=<id>`, `/fork`, `/rewind`, `/summarize` (/compress alias), `/rename`, `/clear`; `agent create-chat` returns new empty chat ID (scriptable).
- Autonomy: L0
- Evidence: "Resume previous conversations to maintain context"; "Create a new empty chat and return its ID"
- Confidence: HIGH

### cli-persist: Persistent (detachable) sessions
- Category: cli
- Cursor Status: GA (Aug 26 2026 release)
- Source: docs/cli__changelog.txt
- What/Invoke: `agent persist` keeps agents running after disconnect; `/detach`; `agent persist attach`, `agent persist list|stop`, `agent persist --resume`.
- Runtime behind: daemonized CLI sessions.
- Autonomy: L2 (agent runs unattended while detached; approvals per policy)
- Evidence: "Keep agents running after you disconnect. Start a persistent session with agent persist"
- Confidence: HIGH

### cli-acp: ACP server (Agent Client Protocol)
- Category: cli
- Cursor Status: GA (advanced/hidden command)
- Source: docs/cli__acp.txt; blog__jetbrains-acp.txt (Mar 4 2026)
- What/Invoke: `agent acp` = JSON-RPC 2.0 over stdio, newline-delimited; flow initialize → authenticate (`cursor_login`) → session/new|load → session/prompt; handle session/update, session/request_permission (allow-once/allow-always/reject-once), session/cancel.
- Extension methods: blocking `cursor/ask_question`, `cursor/create_plan`; notifications `cursor/update_todos`, `cursor/task` (subagent types incl. explore/computer_use/browser_use/shell), `cursor/generate_image`.
- IDE integrations: JetBrains (ACP Registry), Neovim avante.nvim, Zed, custom editors.
- Limitations: "Team-level MCP servers configured through the Cursor dashboard are not supported in ACP mode"; unanswered permission requests block tool execution.
- Autonomy: L2 (client answers permission requests)
- Evidence: "run agent acp and connect a custom client over stdio using JSON-RPC"; "ACP is intended for building custom clients and integrations"
- Confidence: HIGH

### cli-mcp: MCP management in CLI
- Category: cli
- Cursor Status: GA
- Source: docs/cli__mcp.txt, cli__reference__parameters.txt
- What/Invoke: `agent mcp list|list-tools|login|enable|disable`; `/mcp` slash; same mcp.json as editor (project → global → nested precedence); `--approve-mcps` auto-approves all servers.
- Limitations: team dashboard MCP servers unsupported in ACP mode (see ACP).
- Autonomy: L2 (server approval) → L3 once approved
- Evidence: "The CLI will automatically detect and respect your mcp.json configuration file"; "agent --approve-mcps 'query my database…'"
- Confidence: HIGH

### cli-shellmode: Shell Mode
- Category: cli
- Cursor Status: GA
- Source: docs/cli__shell-mode.txt
- What/Invoke: `/shell`, `/sh`, `/run` — run non-interactive shell commands inside conversation; runs in `$SHELL` (zsh/bash); output truncation; permission-checked against CLI + team settings.
- Limitations: hard 30s timeout, non-configurable; no servers/interactive prompts; `cd` does not persist.
- Autonomy: L2 (allowlist via decision banner, Tab to allowlist)
- Evidence: "Commands timeout after 30 seconds"; "Admin policies may block certain commands, and commands with redirection cannot be allowlisted inline"
- Confidence: HIGH

### cli-permissions: CLI permission model
- Category: cli
- Cursor Status: GA
- Source: docs/cli__reference__permissions.txt, cli__reference__configuration.txt
- What/Invoke: permission tokens in `~/.cursor/cli-config.json` (global) and `<project>/.cursor/cli.json` (project = permissions only): `Shell(cmd)`, `Shell(cmd:args-glob)`, `Read(glob)`, `Write(glob)`, `WebFetch(domain)`, `Mcp(server:tool)`; allow/deny arrays; deny wins; globs `**`,`*`,`?`; `--force` forces allow unless explicitly denied.
- Also: `approvalMode: allowlist | auto-review | unrestricted`; sandbox.mode + networkAccess keys.
- Autonomy: defines the guardrail layer (L2↔L3 depending on config)
- Evidence: "Deny rules take precedence over allow rules"; "Only permissions can be configured at the project level"
- Confidence: HIGH

### cli-sandbox: Sandbox
- Category: cli
- Cursor Status: GA
- Source: docs/cli__overview.txt, cli__reference__parameters.txt
- What/Invoke: `/sandbox` or `--sandbox enabled|disabled` (persists); `agent sandbox enable|disable|reset|run` with `--allow-paths`, `--readonly-paths`, `--blocked-patterns`, `--network` (default false), `--sb-debug`; toggle network access interactively.
- Autonomy: enables L3 (autonomous under OS-level guardrails)
- Evidence: "Configure command execution settings with /sandbox … control network access"; "Run a command in a sandbox with workspace read/write"
- Confidence: HIGH

### cli-config: CLI configuration file
- Category: cli
- Cursor Status: GA
- Source: docs/cli__reference__configuration.txt
- What/Invoke: `~/.cursor/cli-config.json` (global) / `<project>/.cursor/cli.json` (project perms only); env overrides CURSOR_CONFIG_DIR, XDG_CONFIG_HOME; fields: vimMode, permissions, channel, model, notifications, hints, rewind, suggestNextPrompt, display.*, approvalMode, sandbox.*, network.useHttp1ForAgent (Zscaler/HTTP1.1+SSE fallback), attribution.attributeCommitsToAgent / attributePRsToAgent ("Made with Cursor" trailers, default true).
- Autonomy: n/a
- Evidence: "Add 'Made with Cursor' trailer to Agent commits (default: true)"; "Corrupted files are backed up as .bad and recreated"
- Confidence: HIGH

### cli-slash: Slash command surface
- Category: cli
- Cursor Status: GA (`/goal` rolling out)
- Source: docs/cli__reference__slash-commands.txt
- What/Invoke: /model, /run-everything (alias /auto-run), /plan, /ask, /debug, /goal [objective] (durable long-lived objective; "Rolling out"), /logs, /max-mode, /resume, /fork, /rewind, /shell, /sandbox, /mcp, /plugin, /config, /bedrock, /open (opens Git root in Cursor), etc.
- Autonomy: /run-everything = L3 toggle; /goal = L3+ persistent objective
- Evidence: "/goal [objective] Give the agent a long-lived objective to work towards until it's fully complete. Rolling out."
- Confidence: HIGH

### cli-worktrees: CLI worktrees
- Category: cli / worktrees
- Cursor Status: GA
- Source: docs/cli__using.txt, cli__reference__parameters.txt, cli__changelog.txt
- What/Invoke: `-w/--worktree [name]` runs agent in new Git worktree under `~/.cursor/worktrees/<reponame>/<name>` (shared with editor worktrees); `--worktree-base <branch>`; `--skip-worktree-setup` skips `.cursor/worktrees.json` setup scripts; same retention/cleanup rules as editor.
- Autonomy: L2/L3 — parallel isolated agent runs
- Evidence: "Pass -w or --worktree [name] to run the agent in a new Git worktree"; "the sandbox fully understands worktree layouts" (changelog)
- Confidence: HIGH

### cli-cloud-handoff: Cloud Agent handoff from CLI
- Category: cli
- Cursor Status: GA
- Source: docs/cli__overview.txt, cli__using.txt
- What/Invoke: prepend `&` to any message to push conversation to a Cloud Agent that keeps running remotely; pick up at cursor.com/agents (web/mobile).
- Autonomy: L4 (cloud agent runs autonomously with repo access)
- Evidence: "Push your conversation to a Cloud Agent to continue running while you're away. Prepend & to any message"
- Confidence: HIGH

### cli-auth: CLI authentication
- Category: cli
- Cursor Status: GA
- Source: docs/cli__reference__authentication.txt, cli__reference__parameters.txt
- What/Invoke: `agent login` browser flow (NO_OPEN_BROWSER=1 prints URL), `agent logout`, `agent status|whoami` (text/json); API keys via `CURSOR_API_KEY` or `--api-key`; also `--auth-token`/`CURSOR_AUTH_TOKEN`, `-H` custom headers, `-e` endpoint override.
- Autonomy: n/a
- Evidence: "For automation, scripts, or CI environments, use API key authentication"
- Confidence: HIGH

### cli-worker: Private cloud worker from CLI
- Category: cli / api
- Cursor Status: GA
- Source: docs/cli__reference__parameters.txt, cli__changelog.txt
- What/Invoke: `agent worker start|debug` — connects your machine to Cursor as a private worker that runs cloud agents; `--pool`/`--pool-name` (register for pool assignment), `--worker-dir` (repeatable), `--idle-release-timeout`, `--label/--labels-file`, `--management-addr` (/healthz /readyz /metrics), `--computer-use` (drive desktop; macOS helper app), `--share-desktop view|view_and_control` (Linux), `--auth-token-file`, `--data-dir`; changelog adds `agent worker controller` with `--spawn` hook to wake hibernated workers.
- Autonomy: L4 substrate (hosts autonomous cloud agents on your infra)
- Evidence: "Start a private cloud worker that connects to Cursor and runs agents in your environment"
- Confidence: HIGH

### cli-gha: GitHub Actions integration
- Category: cli / git-delivery
- Cursor Status: GA
- Source: docs/cli__github-actions.txt
- What/Invoke: install CLI in workflow, `CURSOR_API_KEY` from repo/org secret, `agent -p "..." --model gpt-5`; cookbook workflows: "updating documentation" and "fixing CI issues".
- Two documented autonomy postures: (1) Full autonomy — agent "Create[s] and manage[s] git branches… Commit and push changes… Post comments on pull requests"; (2) Restricted — agent only modifies files, deterministic CI steps do git/PR comment; plus permission-config JSON at CLI level (allow Read/Write/Shell(grep), deny Shell(git), Shell(gh), Write(.env*)).
- Autonomy: L2 (restricted) ↔ L4 (full autonomy) — explicitly documented choice
- Evidence: "Give the agent complete control over git operations… Simpler setup, requires more trust"; "critical operations remain deterministic and auditable"
- Confidence: HIGH

### cli-sudo: Sudo password prompting
- Category: cli
- Cursor Status: GA
- Source: docs/cli__overview.txt
- What/Invoke: masked password prompt when a command needs sudo; password flows to sudo via secure IPC; "the AI model never sees it".
- Autonomy: L2→L3 enabler
- Evidence: "Run commands requiring elevated privileges without leaving the CLI"
- Confidence: HIGH

### cli-plugins-hooks: Plugins + hooks
- Category: cli
- Cursor Status: GA (hooks: Claude Code-format compatible)
- Source: docs/cli__changelog.txt, cli__reference__parameters.txt, cli__reference__slash-commands.txt
- What/Invoke: `--plugin-dir` (repeatable), `/plugin` (plugins & marketplaces); changelog: hooks accept payloads over stdin, session start/end, stop hooks with follow-up loops ("autonomous 'keep going' patterns"), pre-compaction, subagent lifecycle hooks; plugin hooks run from installed plugins; "Claude Code-format hook responses are accepted".
- Limitation: "Repository-controlled git configuration, including fsmonitor, hooks, attributes… no longer runs during the agent's own git operations" (repo git hooks disabled for agent ops).
- Autonomy: hooks enable L3 autonomous loops
- Evidence: "stop hooks with follow-up loops (autonomous 'keep going' patterns)"; "Claude Code-format hook responses are accepted"
- Confidence: HIGH

## B. Automations

### autom-core: Cursor Automations (always-on cloud agents)
- Category: automations
- Cursor Status: GA (launched Mar 5 2026)
- Source: docs/cloud-agent__automations.txt; blog__automations.txt
- What/Invoke: run cloud agents on schedule or on events from "GitHub, GitLab, Slack, webhooks, Linear, and more". Create via Agents Window, cursor.com/automations, `/automate` skill (plain-language config of triggers/instructions/tools), or Marketplace templates. Multiple triggers per automation (any fires). Billing = cloud agent usage; max context window always.
- Examples: PR bug review, deep security review, Slack bug triage, scheduled change summaries.
- Autonomy: L3/L4 (fully autonomous cloud agent runs with tool guardrails)
- Evidence: "Cursor Automations run cloud agents in the background, either on a schedule or in response to events"; "The /automate skill lets you describe the workflow you want in plain language"
- Confidence: HIGH

### autom-triggers-sc: Source-control triggers
- Category: automations / integrations
- Cursor Status: GA
- Source: docs/cloud-agent__automations.txt
- What/Invoke: core triggers on all connected providers (GitHub, GitLab, Bitbucket Cloud): Draft opened; Pull request opened; PR pushed; PR merged; Push to branch; Comment added.
- GitHub extras: PR label changed, Issue label changed, CI completed, Issue comment, PR review comment, PR review submitted, Review thread updated, Workflow run completed. GitLab extras: PR label changed, PR approved. Bitbucket Cloud extras: PR approved (no label/inline-comment triggers; Server/Data Center unsupported).
- Limitations: "Pull request triggers don't run on PRs opened from forks" (exception: PR merged); repo selection required for SC triggers.
- Autonomy: L4 trigger plane
- Evidence: "GitHub is the reference provider and supports every source control trigger"; "Fork pull requests not supported"
- Confidence: HIGH

### autom-triggers-slack: Slack triggers
- Category: automations / integrations
- Cursor Status: GA
- Source: docs/cloud-agent__automations.txt
- What/Invoke: New message in channel (top-level by default; keyword/regex filter for threaded replies), Emoji reaction, Channel created. Fires via Cursor Slack integration.
- Limitations: "Only public Slack channels are visible to Slack triggers at this time".
- Autonomy: L4
- Evidence: "Slack triggers respond to events from the Cursor Slack integration"
- Confidence: HIGH

### autom-triggers-webhook: Webhook triggers (inbound)
- Category: automations / api
- Cursor Status: GA
- Source: docs/cloud-agent__automations.txt
- What/Invoke: automation gets a private HTTP endpoint; POST starts a run; URL + API key generated on save; connect internal systems, CI pipelines, monitoring.
- Autonomy: L4
- Evidence: "Webhook triggers create a private HTTP endpoint for your automation. POST to the endpoint to start a run"
- Confidence: HIGH

### autom-triggers-linear: Linear triggers
- Category: automations / integrations
- Cursor Status: GA
- Source: docs/cloud-agent__automations.txt
- What/Invoke: Issue created, Status changed, End of cycle.
- Autonomy: L4
- Evidence: "Linear triggers respond to events from the Cursor Linear integration"
- Confidence: HIGH

### autom-triggers-sentry-pd: Sentry + PagerDuty triggers
- Category: automations / integrations
- Cursor Status: GA
- Source: docs/cloud-agent__automations.txt
- What/Invoke: Sentry: Issue created / Issue updated / Any issue event (investigate errors, root cause, propose fixes). PagerDuty: Incident triggered / acknowledged / resolved / Any incident event (triage or resolve incidents).
- Autonomy: L4
- Evidence: "PagerDuty triggers run on incident events and can be helpful to automatically triage or even resolve incidents"
- Confidence: HIGH

### autom-tools: Automation tool surface
- Category: automations
- Cursor Status: GA
- Source: docs/cloud-agent__automations.txt
- What/Invoke: Pull request creation (enabled by default, opens PRs against trigger/env repos); Comment on pull request (top-level + inline; with approvals enabled agent can approve/request changes/dismiss reviews); Request reviewers; Send to Slack (fixed or agent-chosen channel); Read Slack channels; MCP server attach (grants all server tools); Memories (persistent per-automation notes, MEMORIES.md, on by default, editable/deletable, prompt-injection caution); Computer use (browser/screenshots, included by default).
- Repo scope: none / single repo+branch / multi-repo environment.
- Autonomy: L4 (with approvals toggle as guardrail)
- Evidence: "If you enable approvals, the agent can also approve, request changes, and dismiss reviews"; "Memories let the agent read and write persistent notes across runs"
- Confidence: HIGH

### autom-identity: Automation identity & sharing
- Category: automations
- Cursor Status: GA
- Source: docs/cloud-agent__automations.txt
- What/Invoke: Run as: Me (billed to creator) or Service account (team usage pool, `automation-<id>` service account, admins only); Access: private / members view / members edit; GitHub comments/approvals/reviewer-requests run as `cursor`; "Automations that run as you open pull requests as your GitHub account"; service-account automations open PRs as `cursor`; Slack messages from Cursor bot; regenerate webhook key after identity switch.
- Autonomy: L4 governance layer
- Evidence: "GitHub comments, review approvals, and reviewer requests run as cursor"
- Confidence: HIGH

### autom-managed: Cursor-managed automations
- Category: automations
- Cursor Status: GA
- Source: docs/cloud-agent__automations.txt
- What/Invoke: Automations page ships three managed agents: Bugbot (PR bug/quality review), Security Agents (PR + codebase vulnerability scanning), PR Routing & Approval ("routes pull requests to reviewers and can approve low-risk changes").
- Autonomy: L4 (auto-approve within risk policy)
- Evidence: "PR Routing & Approval routes pull requests to reviewers and can approve low-risk changes"
- Confidence: HIGH

## C. REST / webhook API

### api-agents: Cloud Agents API v1 (agents CRUD)
- Category: api
- Cursor Status: PUBLIC BETA ("APIs may change before general availability")
- Source: docs/cloud-agent__api__endpoints.txt
- What/Invoke: POST /v1/agents (create + initial run), GET /v1/agents (list; limit/cursor/prUrl filter/includeArchived), GET /v1/agents/{id}, POST …/archive, POST …/unarchive (both idempotent), DELETE /v1/agents/{id} (irreversible). Auth: Basic or Bearer user or service-account API key.
- Create options: prompt.text + up to 5 images (15MB), model.id/params, name, env (cloud|pool|machine), repos (max 20, startingRef, prUrl), workOnCurrentBranch, autoCreatePR, skipReviewerRequest, envVars (beta, ≤50, encrypted, deleted with agent), mcpServers (≤50 inline, http/sse/stdio), customSubagents (≤20), mode plan|agent, client-supplied agentId `bc-<uuid>` idempotency (409 agent_id_conflict).
- Status model: ACTIVE / IDLE / ARCHIVED.
- Autonomy: programmatic L4 agent launcher
- Evidence: "The Cloud Agents API v1 is in public beta"; "Create a Cloud Agent and immediately enqueue its initial run"
- Confidence: HIGH

### api-runs: Runs API (follow-up prompts, cancel)
- Category: api
- Cursor Status: PUBLIC BETA
- Source: docs/cloud-agent__api__endpoints.txt
- What/Invoke: POST /v1/agents/{id}/runs (follow-up uses current conversation+workspace; 409 agent_busy if run active; optional mcpServers replace, mode override), GET …/runs (list), GET …/runs/{runId} (status, durationMs, result text, git.branches[] with repoUrl/branch/prUrl), POST …/runs/{runId}/cancel (terminal CANCELLED; 409 run_not_cancellable otherwise).
- Autonomy: enables external orchestrators (L4 control loop)
- Evidence: "Only one run can be active per agent"; "Cancellation is terminal — the run transitions to CANCELLED and cannot be resumed"
- Confidence: HIGH

### api-sse: Run streaming (SSE)
- Category: api
- Cursor Status: PUBLIC BETA
- Source: docs/cloud-agent__api__endpoints.txt
- What/Invoke: GET /v1/agents/{id}/runs/{runId}/stream — events status/assistant/thinking/tool_call/interaction_update/heartbeat/result/error/done; `Last-Event-ID` resume; `X-Cursor-Stream-Retention-Seconds`, then 410 stream_expired → fall back to Get A Run.
- Autonomy: L4 observability for controllers
- Evidence: "Stream Server-Sent Events (SSE) for one run… does not replay prior runs"
- Confidence: HIGH

### api-usage-artifacts: Usage + artifacts endpoints
- Category: api
- Cursor Status: PUBLIC BETA
- Source: docs/cloud-agent__api__endpoints.txt
- What/Invoke: GET /v1/agents/{id}/usage (per-run token breakdown: input/output/cacheRead/cacheWrite/total; optional runId scope); GET /v1/agents/{id}/artifacts (list, paths under artifacts/); GET …/artifacts/download?path= → 15-minute presigned S3 URL.
- Autonomy: n/a (metering/extraction)
- Evidence: "Retrieve a temporary 15-minute presigned S3 URL for a specific artifact"
- Confidence: HIGH

### api-webhooks-out: Agent webhooks (outbound, legacy v0)
- Category: api
- Cursor Status: GA on legacy v0; v1 "coming soon"
- Source: docs/cloud-agent__api__webhooks.txt; api__endpoints.txt
- What/Invoke: when creating an agent with a webhook URL, Cursor POSTs on status changes — "Currently, only statusChange events are supported, specifically when an agent encounters an ERROR or FINISHED state." Headers: X-Webhook-Signature (sha256=<hex> HMAC-SHA256 of raw body), X-Webhook-ID, X-Webhook-Event, UA `Cursor-Agent-Webhook/1.0`. Payload: event, timestamp, id (bc_…), status, source.repository/ref, target.url/branchName (cursor/…)/prUrl, summary. Retries on error responses.
- Autonomy: L4 notification plane
- Evidence: "Currently, only statusChange events are supported"; "Webhooks are coming soon" (v1)
- Confidence: HIGH

### api-workers-pools: Workers & pools API (self-hosted fleet control)
- Category: api
- Cursor Status: GA (v0 paths retained)
- Source: docs/cloud-agent__api__endpoints.txt
- What/Invoke: service-account key required. GET /v0/private-workers (list/filter), /summary (scale decisions), /{id}; GET/POST/DELETE /v0/private-workers/pools (durable pools, scale-to-zero, workerReadyTimeoutSeconds); GET /v0/private-workers/pending-requests (+ claimed-but-offline entries with claimedWorkerId/wakeTimeoutMs → revive machine); GET …/pending-requests/stream (SSE watch; created/claimed/claimed_offline/expired/heartbeat; ≤4 concurrent streams; 5-min cursor TTL; best-effort delivery, list = source of truth); POST /claim + POST /claims/{id}/release (atomic assignment, worker started with CURSOR_AGENT_WORKER_ID).
- Autonomy: L4 infra-autoscaling plane (documented autoscaler loop)
- Evidence: "build autoscaling for your pools. Durable pools stay registered after the last worker disconnects"; "use one stream per controller and fan out locally"
- Confidence: HIGH

### api-meta: Metadata endpoints (me, models, repositories, sub-tokens)
- Category: api
- Cursor Status: PUBLIC BETA (v1 surface)
- Source: docs/cloud-agent__api__endpoints.txt
- What/Invoke: GET /v1/me (API key info); GET /v1/models (model ids, params, variants for model.id); GET /v1/repositories (GitHub repos via Cursor GitHub App; strict rate limits 1/user/min, 30/user/hour); POST /v1/sub-tokens (1-hour user-scoped worker token from agent-scoped service-account key; cannot self-refresh).
- Evidence: "Limit requests to 1 / user / minute, and 30 / user / hour"; "The returned token expires after 1 hour and cannot refresh itself"
- Confidence: HIGH

## D. Worktrees & git delivery lifecycle

### wt-config: Worktree configuration & cleanup
- Category: worktrees
- Cursor Status: GA (Agents Window UI + IDE skills; Cursor 3.5 semantics)
- Source: docs/configuration__worktrees.txt
- What/Invoke: `.cursor/worktrees.json` setup keys setup-worktree[-unix|-windows] (command array or script path; `$ROOT_WORKTREE_PATH` env); discovery via mtime checkpoint; auto cleanup `cursor.worktreeCleanupIntervalHours` (6) and `cursor.worktreeMaxCount` (25/machine, all workspaces count); IDE skills `/worktree` (isolated run), `/best-of-n sonnet,gpt,composer …` (same task across models, one worktree each), `/apply-worktree`, `/delete-worktree`.
- Limitation: "does not merge changes back into your main checkout for you" (best-of-n).
- Autonomy: parallel L3 agent isolation
- Evidence: "Worktrees let Agent work in isolated Git checkouts… main checkout stays untouched"; "cursor.worktreeMaxCount: the default cap is 25 worktrees per machine"
- Confidence: HIGH

### git-lifecycle: Cloud agent git lifecycle (branch→commit→push→PR→review→merge)
- Category: git-delivery
- Cursor Status: GA
- Source: docs/cloud-agent__api__endpoints.txt, integrations__github.txt, integrations__azure-devops.txt, integrations__bitbucket.txt, origin__pull-requests.txt, automations doc
- What/Invoke: cloud agents clone repos, create working branches (auto branch prefix `cursor/...` unless workOnCurrentBranch), commit, push (git.branches[] reported per agent), open PRs (autoCreatePR / PR-creation tool default-on in automations), comment/approve/dismiss reviews (approvals-enabled automations), request reviewers; GitHub App reads branch protection + required checks "to determine PR mergeability"; Azure DevOps: "Open, update, and merge pull requests created by Cloud Agents"; Origin PRs mergeable in UI; rollback = cancel run / archive agent / git revert by new agent (no explicit revert API in corpus — UNKNOWN).
- Autonomy: L4 (whole loop hands-off) with review guardrails
- Evidence: "Cursor pushes commits to a new auto-generated branch (cursor/...)"; "Read branch protection and required check rules to determine PR mergeability"
- Confidence: HIGH

### builds: Builds (pre-warmed cloud environments)
- Category: git-delivery / automations
- Cursor Status: GA (default for all environments from Aug 17 2026)
- Source: blog__builds.txt (Aug 13 2026)
- What/Invoke: background-prepared environment copies (repos cloned, deps installed, install script executed), hourly by default; agents fork a live warm machine; broken builds never activate — "agents keep using the last successful build"; Builds tab (status, logs, commit SHAs, run→build record, max git-state drift threshold); agents manage builds via built-in Cursor Cloud MCP.
- Claimed: 3x faster time-to-first-token, 10x faster boot internally; Faire: 2,000+ automated runs/week.
- Autonomy: L4 reliability layer
- Evidence: "Cursor runs a new build every hour"; "broken builds never take down the agent fleet"
- Confidence: HIGH

## E. Integrations

### int-github: GitHub App integration
- Category: integrations / git-delivery
- Cursor Status: GA (github.com + GitHub Enterprise Server)
- Source: docs/integrations__github.txt
- What/Invoke: dashboard Connect → All/Selected repositories; powers Cloud Agents + Bugbot. Permissions: repo access (clone, working branches), PRs, Issues, Checks & statuses, Actions/workflows ("Monitor CI/CD pipelines and trigger CI re-runs from pull requests"), Administration (branch protection → mergeability), custom repo roles, org custom properties. IP allow list: pre-configured app IP list or git egress proxy. Protected Git Scopes lock org→Cursor org. Enterprise networking: AWS PrivateLink, Cloudflare Tunnel.
- Triggers it enables: Bugbot PR reviews, cloud agent @-flows, automations SC triggers, API repo listing.
- Autonomy: L4 substrate
- Evidence: "Actions and workflows — Monitor CI/CD pipelines and trigger CI re-runs from pull requests"
- Confidence: HIGH

### int-gitlab: GitLab integration
- Category: integrations / git-delivery
- Cursor Status: GA (gitlab.com + self-hosted)
- Source: docs/integrations__gitlab.txt
- What/Invoke: requires paid GitLab plan (Premium/Ultimate; project access tokens not on Free); maintainer access; Sync Repos; Cloud Agents + Bugbot; Protected Git Scopes (Owner role); Enterprise tunnels: PrivateLink, Cloudflare Tunnel, Reverse Proxy Tunnel (websocket).
- Evidence: "GitLab integration requires a paid GitLab plan (Premium or Ultimate)"
- Confidence: HIGH

### int-slack: Slack integration
- Category: integrations
- Cursor Status: GA
- Source: docs/integrations__slack.txt
- What/Invoke: `@Cursor [prompt]` starts Cloud Agent / follow-ups in threads (thread context read for solutions); options natural or inline: repo=, env=, branch=, model=, autopr=, worker=/machine=, pool=, self_hosted=/sh=, channel=; commands: `@Cursor agent`, `list my agents`, `settings`, `pool set/unset`; repo routing (message → recent activity → routing rules → channel default → default repo); team default pool (Enterprise); posts plan + status, PR link on completion; full Slack scope list (mentions, history, files, reactions ⏳✅❌). Privacy Mode supported.
- Limitations: channel settings only for public channels; repo-bound pool without resolved repo → ephemeral rejection.
- Autonomy: L4 (Slack → autonomous cloud agent)
- Evidence: "Mention @cursor and give your prompt"; "Cloud Agents read the entire thread for context when invoked"
- Confidence: HIGH

### int-linear: Linear integration
- Category: integrations
- Cursor Status: GA
- Source: docs/integrations__linear.txt; blog__linear.txt exists in corpus
- What/Invoke: assign issue to "Cursor" or `@Cursor` in comments; non-dev work auto-filtered; real-time status in Linear; PRs auto-created; follow-ups via @Cursor comment; config `[repo=owner/repo] [branch=] [model=]` in text/comments, parent-child labels (group "repo", labels owner/repo), project labels; triage rules auto-delegate issues (needs human assignee currently).
- Autonomy: L4 (issue → PR)
- Evidence: "Cloud Agents show real-time status in Linear and create PRs automatically when complete"; "Cursor analyzes issues and filters out non-development work automatically"
- Confidence: HIGH

### int-jira: Jira integration
- Category: integrations
- Cursor Status: GA (Teams & Enterprise plans only)
- Source: docs/integrations__jira.txt
- What/Invoke: Atlassian Marketplace app; requires Jira Commercial Cloud with Rovo; not HIPAA/FedRAMP; assign work item to Cursor or `@Cursor [repo= branch= model=]`; service-account vs user-level authentication; Rovo chat for follow-ups; routing rules keyword→repo; branch prefix setting; posts status + completion summary + PR link.
- Autonomy: L4
- Evidence: "assign it to Cursor or mention @Cursor in a Jira comment"; "The Cursor Jira integration is currently available only on Cursor Teams and Enterprise plans"
- Confidence: HIGH

### int-azdo: Azure DevOps integration
- Category: integrations / git-delivery
- Cursor Status: PUBLIC BETA (dev.azure.com only; Server unsupported)
- Source: docs/integrations__azure-devops.txt
- What/Invoke: Cloud Agents clone/branch/PR; Bugbot reviews via Microsoft Entra service principal (tenant admin consent once; principal added to Project Administrators per project; installs service hooks); build status context `cursor-bugbot/review`; on-demand review via `cursor review`/`bugbot run` comments (sign-in-address match required).
- Limitations: "Automations, Bugbot autofix, Security Agents… don't support Azure DevOps yet"; no Auto-Enable, no rule learning, no personal Bugbot settings.
- Autonomy: L4 minus automations
- Evidence: "The Azure DevOps integration is in public beta"; "The following features don't support Azure DevOps yet: Automations…"
- Confidence: HIGH

### int-bitbucket: Bitbucket integration
- Category: integrations / git-delivery
- Cursor Status: PUBLIC BETA (Cloud); Bugbot-only for Data Center
- Source: docs/integrations__bitbucket.txt
- What/Invoke: developer OAuth connects clone/push/PR as the user; workspace admin installs Cursor Forge app for Bugbot/status comments as "Cursor"; PRs attributed to the person who started the agent; webhook permission for repo/PR events; PRs from agents need per-user connection; Data Center via service-account token + PrivateLink/Cloudflare/reverse-proxy tunnels.
- Autonomy: L4
- Evidence: "The Bitbucket Cloud integration is in public beta"; "Connect Bitbucket Data Center repositories to Bugbot"
- Confidence: HIGH

## F. Origin (Cursor's git forge)

### origin-platform: Origin — git forge & code hosting
- Category: origin-platform
- Cursor Status: EARLY BETA ("Access opens in stages")
- Source: docs/origin.txt
- What/Invoke: "Origin is Cursor's git forge for storing and sharing code." Namespace = claimed codebase name at `https://cursor.com/codebase/{owner}/{repo}` (immutable during beta); Pro/Teams/Enterprise only (not free); Privacy Mode follows namespace owner; admins can disable. Capabilities: create repos (UI or via agent), standard git clone/push/pull, GitHub mirroring, browse/search, open/review/merge PRs, repo + codebase settings, Origin Apps, Public API, automations/cloud agents on Origin repos, Origin CLI.
- WHAT ORIGIN IS: a GitHub-competitor forge built into Cursor — repo hosting with origin.cursor.com git remotes, a web UI (code browse/search, PR review/merge, checks), an app/integration platform (apps, API, CI providers like Buildkite/Vercel/Depot), and GitHub mirror mode so GitHub can remain source of truth during adoption.
- Autonomy: L4 substrate (agents commit/PR directly on it)
- Evidence: "Origin is Cursor's git forge for storing and sharing code"; "For Origin-hosted repos, Origin is the source of truth. For synced repos, GitHub stays the source of truth"
- Confidence: HIGH

### origin-git: Origin git transport (clone/push/pull, /local branches)
- Category: origin-platform / git-delivery
- Cursor Status: EARLY BETA
- Source: docs/origin__git.txt
- What/Invoke: HTTPS remote `https://origin.cursor.com/{owner}/{repo}.git`; `origin auth login` sets git credential helper; dual-push to GitHub+Origin during evaluation supported. Mirrored repos: pushes to clone URL land on GitHub, Origin updates after GitHub accepts. Forge-local `origin/*` branches live only on Origin via `origin push local` (creates `origin-local` remote scoped to `refs/heads/origin/*`, endpoint `/local`, per-repo enable) — the supported write path when GitHub is down; GitHub branches named `origin`/`origin/...` are deliberately never synced.
- Limitations: Git LFS batch does not fail over; `/local` only on inbound mirrors.
- Autonomy: L0/L4 (plain git or agents)
- Evidence: "git push to this remote goes to GitHub. Origin updates after GitHub accepts the push"; "/local is the supported write path while GitHub is down"
- Confidence: HIGH

### origin-mirror: GitHub mirroring
- Category: origin-platform / git-delivery
- Cursor Status: EARLY BETA
- Source: docs/origin__mirror-github.txt
- What/Invoke: Sync from GitHub (needs GitHub repo admin + Cursor GitHub app); syncs history/branches/tags/PRs (PR reviewable in Cursor), ongoing updates; NOT synced: Issues, Actions workflows & secrets; Detach from GitHub (Danger Zone) converts to standalone Origin-hosted repo. PRs from agents on mirrored repos open on GitHub.
- Autonomy: L0 setup, L4 agent usage after
- Evidence: "Mirroring copies a GitHub repository into Origin and keeps Origin updated"; "GitHub stays the source of truth"
- Confidence: HIGH

### origin-prs: Origin pull requests (review/merge)
- Category: origin-platform / git-delivery
- Cursor Status: EARLY BETA
- Source: docs/origin__pull-requests.txt, origin__cli__reference__pull-requests.txt, origin__settings.txt
- What/Invoke: PR tab: Activity/Commits/Checks/Files-changed; request reviewers, reviews, line comments, merge when reviews+CI satisfied; "Origin surfaces merge conflicts so you can resolve them before merging"; repo Settings → "Rules and Protections… branch rules and merge protections". Origin CLI `origin pr create|view|diff|checks|checkout|edit|ready|review --approve|comment|thread list|merge|close|reopen|refresh`.
- Autonomy: L2 human review, L4 agent-created PRs
- Evidence: "Open, review, and merge pull requests"; "Rules and Protections is where you configure branch rules and merge protections"
- Confidence: HIGH

### origin-clonekit: CloneKit CI fast clone
- Category: origin-platform / git-delivery
- Cursor Status: EARLY BETA (Enterprise-only, per-repo enable "no self-serve toggle")
- Source: docs/origin__clonekit-ci.txt
- What/Invoke: `origin repo clone-fast {owner}/{repo} [DIR]` replaces `git clone` in CI: fetches kit manifest, downloads pack artifacts from gitcdn.origin.cursor.com (`--verify` hashes), installs into empty dir, "tops up" with new objects; `--bare`, `--no-top-up`, `--fallback auto|never`; prints `mode: clone-kit` / `mode: git-clone`, machine-readable `clone-kit-result:` lines. Tokens ≤15 min via CURSOR_AUTH_TOKEN: Buildkite Agent API mint, or Origin App Ed25519 JWT → installation token `POST /v1/origin/app/installations/{id}/access_tokens`; mirror-wait via `POST /v1/origin/repos/{repo}:syncMirror`; `origin auth setup-git` credential helper.
- Supported CI: Buildkite (native repository provider w/ checks read+write), GitHub Actions, GitLab CI/Jenkins/CircleCI. glibc x64/arm64 only (no musl/Alpine).
- Autonomy: L0 (CI acceleration), token flow L2-safe
- Evidence: "Instead of cloning from scratch, it downloads a prebuilt clone kit"; "Tokens expire after at most 15 minutes and cannot be refreshed"
- Confidence: HIGH

### origin-cli: Origin CLI (`origin`, separate from `agent`)
- Category: origin-platform
- Cursor Status: EARLY BETA
- Source: docs/origin__cli.txt, origin__git.txt
- What/Invoke: install `curl -fsSL https://downloads.cursor.com/origin/install.sh | sh` → `~/.local/bin/origin`; `origin auth login|status|setup-git`; `origin repo create|delete`; `origin repo clone-fast`; `origin update`; agents (local or cloud) drive the same commands to create repos/remotes/push as part of tasks.
- Evidence: "The Origin CLI (origin) is separate from the Cursor Agent CLI (agent)"; "Cursor agents can drive the same commands"
- Confidence: HIGH

### origin-apps-api: Origin Apps + Origin API
- Category: origin-platform / api
- Cursor Status: EARLY BETA (Public API documented separately; corpus has api__origin* files)
- Source: docs/origin.txt, origin__codebase-settings.txt, origin__clonekit-ci.txt
- What/Invoke: codebase settings → Apps: third-party apps (Vercel, Depot, Buildkite listed) + internal apps for API access; auth = app JWTs (Ed25519 signing keys, ≤10 active, aud `origin-apps`) exchanged for scoped installation access tokens (`repository:contents:read|write`), installations with repo selection mode; endpoints seen in corpus: List App Installations, Create Installation Access Token, Sync Mirror.
- Autonomy: L4 integration substrate
- Evidence: "Create private Origin Apps to build integrations on Origin through our Public API"; "Apps authenticate with app JWTs and installation access tokens"
- Confidence: HIGH (endpoints verified in clonekit doc; full API surface = see api__origin corpus files)

### origin-agents: Automations & cloud agents on Origin
- Category: origin-platform / automations
- Cursor Status: EARLY BETA
- Source: docs/origin__integrations.txt
- What/Invoke: point automations at Origin repos like GitHub/GitLab; triggers: Push to branch, PR opened/pushed and related; cloud agents clone/branch/commit/push on Origin repos; Origin-created repos get Origin PRs, mirrored repos get GitHub PRs; agents use the Cursor account's Origin access; local agents create Origin repos via Origin CLI.
- Autonomy: L4
- Evidence: "Automations run cloud agents on a schedule or when source-control events fire. Point an automation at an Origin repository"
- Confidence: HIGH

## G. Gaps / UNKNOWN (for ME2-OS parity planning)
- CLI: no documented native cron/scheduler inside the `agent` binary itself — scheduling lives in cloud Automations; local recurrence = user cron + `agent -p`.
- Outbound webhooks: only agent `statusChange` (ERROR/FINISHED) on legacy v0; v1 webhook surface not yet shipped ("coming soon").
- PR merge/rollback via API: no /v1 merge or revert endpoint in corpus; merge happens in provider UI (GitHub/Origin/ADO) — UNKNOWN.
- Cloud Agents API repo support appears GitHub-centric in v1 examples (repos[].url "GitHub repository URL"); GitLab/ADO/Bitbucket/Origin programmatic create via API not evidenced — UNKNOWN.
- Origin: no standalone user-facing CI pipeline runner documented (CloneKit is clone acceleration, not CI execution; CI runs on Buildkite/GHActions/etc. against Origin remotes).
- `agent sandbox run --network` default false; Shell Mode 30s hard timeout — relevant for ME2 daemon parity.
- Blog historical: CLI GA'd out of beta after Aug 2025 launch; automations shipped Mar 2026; builds default Aug 17 2026; Origin early beta as of fetch 2026-09-24.
