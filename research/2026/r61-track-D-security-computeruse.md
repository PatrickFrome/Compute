# R61-D — Cursor Security / Sandbox / Approvals / Computer Use / Browser / BugBot catalog

- Agent: research-track-D (RESEARCH-ONLY, no code changes)
- Corpus: /tmp/r61-corpus/ (built 2026-09-24T00:59:35Z, 329 targets, ok=329)
- Fetch date for all sources: 2026-09-24 (blog posts carry their own publication dates)
- Scale: 45 capabilities. Only corpus evidence; gaps marked UNKNOWN.
- Note on product relation: **Grok Bot is a separate Cursor product** (docs under cursor.com/docs/grok-bot) — durable AI "Bots" on persistent cloud computers; bundled with paid Cursor plans / Teams, or via linked SuperGrok subscription; unrelated to Grok LLM licensing in corpus (corpus shows no model-binding evidence).

---

## A. SECURITY GUARDRAILS & APPROVALS (local agent)

### D01: Agent security guardrails (default posture) + workspace trust
- Category: security
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/security (fetched 2026-09-24)
- What: Default-deny posture for sensitive actions; reads/searches need no approval; agents edit workspace files without approval except config files; terminal commands need approval by default; MCP connections and each MCP tool call need individual approval; agents' network requests limited to GitHub, direct-link retrieval, web-search providers. Workspace trust exists but is disabled by default (`security.workspace.trust.enabled`), MDM-enforceable.
- Invoke: default behavior; settings.json / MDM.
- Runtime behind: local editor guardrails, best-effort ("not a hard security boundary").
- Prereqs: none. Limitations: auto-reload can execute agent changes before review.
- Autonomy: L2 (semi — approval-gated)
- Evidence: "By default, sensitive actions require your manual approval."; "Agents cannot make arbitrary network requests with default settings."
- Confidence: HIGH

### D02: Run Mode — Auto-review (classifier-gated autonomy)
- Category: approvals
- Cursor Status: GA (recommended default since Cursor 3.6, May 29, 2026)
- Source: https://cursor.com/docs/agent/security/run-modes; https://cursor.com/blog/agent-autonomy-auto-review (Jun 11, 2026)
- What: Runs allowlisted calls immediately; sandboxes shell when possible; everything else (shell, MCP, Fetch) goes to the Auto-review classifier — an agentic small model that reviews actions in context before they run. Order: allowlist → sandbox-ability (unsandboxable → classifier) → classifier.
- Invoke: Settings > Agents > Approvals & Execution; optional `permissions.json` `autoRun.allow_instructions` / `block_instructions` (plain-English steering, not enforcement); team dashboard config overrides local files.
- Runtime behind: small Cursor-managed model — Claude 4.5 Haiku or GPT-5.4 Mini; runs in the same RPC stream as the parent agent (subagent-like, no extra endpoint); classifier can inspect workspace with ReadFile/Grep/Glob/ListDir; on block it returns an explanation to the parent agent, which can retry a safer path or escalate to a user prompt. Enterprise: model-access controls apply — blocking all classifier models disables Auto-review.
- Prereqs: Cursor 3.6+; classifier model allowed for team.
- Limitations: "not a security boundary"; doesn't review every side effect (Grok Bot variant); classifier blocks ~4% of reviewed actions, only ~7% of Auto-review chats hit ≥1 interruption.
- Autonomy: L3 (autonomous with guardrail classifier)
- Evidence: "It runs known-safe calls, sandboxes shell commands when it can, and asks a classifier to review anything else."; "the classifier runs in the same RPC stream as the parent agent, using an architecture similar to subagents."
- Confidence: HIGH

### D03: Run Mode — Allowlist / Run Everything / (Ask Every Time deprecated)
- Category: approvals
- Cursor Status: GA; Ask Every Time DEPRECATED (Cursor 3.5, May 22, 2026)
- Source: https://cursor.com/docs/agent/security/run-modes
- What: Allowlist = actions in allowlist run without approval, sandbox optional for shell; deterministic for trusted repeat actions. Run Everything = every tool call runs automatically, no sandbox, no classifier. "Run in Sandbox" was folded into Allowlist with sandboxing enabled; "Ask Every Time" replaced by Allowlist with empty allowlist.
- Invoke: Settings > Agents > Approvals & Execution; admins can restrict available modes.
- Limitations: allowlists best-effort.
- Autonomy: Allowlist L2; Run Everything L4 (fully autonomous, zero prompts).
- Evidence: "Run Everything — Every tool call runs automatically."; "Ask Every Time was deprecated. New users cannot choose it."
- Confidence: HIGH

### D04: permissions.json (MCP/terminal allowlists + autoRun steering)
- Category: approvals
- Cursor Status: GA
- Source: https://cursor.com/docs/reference/permissions
- What: `~/.cursor/permissions.json` (per-user) + `<workspace>/.cursor/permissions.json` (per-repo, committed) — arrays concatenated. Keys: `mcpAllowlist` (`server:tool`, wildcards `*:my_tool`), `terminalAllowlist` (command/prefix patterns, `npm:install*` args-glob), `autoRun` (NL classifier steering). File-defined key fully replaces the IDE allowlist (editor becomes read-only). Precedence: team admin (dashboard) > permissions.json > IDE settings UI. Hot-reloaded on change; JSONC supported; CLI has a separate permissions system.
- Prereqs: only effective when a Run Mode is enabled; empty array = empty effective allowlist (no IDE fallback).
- Autonomy: L2/L3 (configures L2-L3 autonomy)
- Evidence: "team admin (dashboard) > permissions.json (per-user ∪ per-repo) > IDE settings UI"; "Allowlists and autoRun instructions are best-effort convenience."
- Confidence: HIGH

### D05: Enforcement hooks (block commands, scrub secrets, DLP)
- Category: security | enterprise-controls
- Cursor Status: GA (hooks); MDM/cloud distribution = Enterprise guidance
- Source: https://cursor.com/docs/enterprise/llm-safety-and-controls; https://cursor.com/docs/enterprise/security-hardening
- What: Custom shell logic at agent lifecycle points: before prompt submission (block API keys/PII), before file reading (redact secrets — example blocks reads matching `gh[ps]_...`), after code generation (scan for creds/SQLi), before terminal execution (block `git push`, `sudo`, DROP). JSON contract `permission: allow|deny`, `exit 3` deny; `failClosed` option for critical hooks; usable to call external DLP/SIEM APIs.
- Runtime behind: host shell scripts invoked at hook points; distributed via MDM or cloud.
- Autonomy: L0 (deterministic enforcement layer, model-independent)
- Evidence: "Scan prompts for sensitive data before they're sent to LLMs. Block submissions that contain API keys"; "set failClosed for critical hooks."
- Confidence: HIGH

### D06: .cursorignore (read/context exclusion)
- Category: security
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/security; https://cursor.com/docs/enterprise/llm-safety-and-controls; https://cursor.com/docs/enterprise/security-hardening
- What: gitignore-like exclusion of files from agent reading and context selection; sandbox makes ignored files fully inaccessible on Linux (overlay remount). NOT a security boundary: terminal commands and MCP tools can still read ignored files; users can read them manually.
- Autonomy: L0 (config)
- Evidence: "Use .cursorignore to block agent access to specific files."; "Terminal commands and MCP tools can still read ignored files."
- Confidence: HIGH

### D07: Other protections (Browser / File-Deletion / External-File)
- Category: approvals
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/security/run-modes
- What: Three always-on protections that force approval even in auto modes: Browser Protection (no auto Browser-tool runs), File-Deletion Protection (no auto deletions incl. `rm`), External-File Protection (no auto create/modify/delete outside workspace).
- Autonomy: L2 (forces L1/L2 checkpoints)
- Evidence: "File-Deletion Protection: Prevents the agent from automatically deleting files, including rm commands."
- Confidence: HIGH

---

## B. SANDBOXING (local shell sandbox)

### D08: Sandbox — macOS (Seatbelt / sandbox-exec)
- Category: sandbox
- Cursor Status: GA (Cursor v2.0+, no extra setup)
- Source: https://cursor.com/docs/agent/security/run-modes; https://cursor.com/blog/agent-sandboxing (Feb 18, 2026)
- What: Shell sandbox for the full subprocess tree. macOS implementation: Seatbelt via `sandbox-exec` (deprecated-by-Apple but used by Chrome; chosen over App Sandbox/containers/VMs). Profile generated dynamically at runtime from workspace + admin settings + .cursorignore (deny file-write regexes for `.vscode`, `.cursor` except rules/commands/worktrees/skills/agents, `.code-workspace`, `.cursorignore`, `.git/config`, `.git/hooks`).
- Invoke: transparent within Run Modes ("sandboxed shell commands when it can").
- Autonomy: L3 enabler
- Evidence: "Cursor uses Seatbelt through sandbox-exec. A generated sandbox profile limits file access, network access, and other process behavior for the full subprocess tree."
- Confidence: HIGH

### D09: Sandbox — Linux (Landlock + seccomp; Bubblewrap fallback) + Windows (WSL2)
- Category: sandbox
- Cursor Status: GA
- Source: https://cursor.com/blog/agent-sandboxing; https://cursor.com/docs/agent/security/run-modes
- What: Linux: seccomp blocks unsafe syscalls; Landlock enforces filesystem restrictions; workspace mapped into an overlay filesystem, ignored files overwritten with Landlocked unreadable copies (no lazy path filtering — seccomp-bpf lacks file path). Fallback backend: `CURSOR_SANDBOX_LANDLOCK_STATUS` reports `fully_enforced` (Landlock) or `bubblewrap` (Bubblewrap fallback). Linux sandbox creates a user namespace remapping UID→0 inside; scripts must use `CURSOR_ORIG_UID/GID` (Docker `--user` pattern documented). Windows: the Linux sandbox runs inside WSL2; native Windows primitives worked on with Microsoft.
- Autonomy: L3 enabler
- Evidence: "We decided to use Landlock and seccomp directly."; "On Windows, we run our Linux sandbox inside WSL2."; "Reports the active sandbox backend: fully_enforced (Landlock), bubblewrap (Bubblewrap fallback)."
- Confidence: HIGH

### D10: sandbox.json (filesystem/network config; protected paths; merge order)
- Category: sandbox
- Cursor Status: GA
- Source: https://cursor.com/docs/reference/sandbox
- What: `~/.cursor/sandbox.json` + `<workspace>/.cursor/sandbox.json` (project wins). Fields: `type` = `workspace_readwrite` (default) | `workspace_readonly` | `insecure_none` (disables sandbox); `additionalReadwritePaths`/`additionalReadonlyPaths`; `disableTmpWrite` (removes default /tmp write); `enableSharedBuildCache` (npm/cargo/pip caches redirected to shared tmpdir); `networkPolicy` {default: deny, allow[], deny[]}. Always write-protected regardless of config: `.cursor/*.json`, `.claude/*.json`, `.vscode/**`, `.code-workspace`, `.git/hooks/**`, `.git/config`, `.git/info/attributes`, `.cursorignore`; SSL cert paths and `~/.ssh` always readable. Merge: per-user < per-repo < team-admin < hardcoded; deny always beats allow; restrictive booleans true-wins.
- Autonomy: L0 config / L3 enforcement
- Evidence: "\"insecure_none\" disables the sandbox entirely."; "per-user < per-repo < team-admin < hardcoded (lowest) (highest)."
- Confidence: HIGH

### D11: Sandbox network policy (default-deny + default domain allowlist)
- Category: sandbox | network-controls
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/security/run-modes; https://cursor.com/docs/reference/sandbox
- What: Sandboxed commands: network blocked by default, opened by network mode + sandbox.json. Modes: "sandbox.json Only" (only your allowlist), "sandbox.json + Defaults" (default — adds Cursor's built-in allowlist of ~100 package-manager/language-tool domains: npmjs.org, pypi.org, crates.io, docker.io, github.com, archive.ubuntu.com, etc.), "Allow All". Patterns: exact domain, wildcard `*.example.com`, CIDR `10.0.0.0/8`; deny > allow; RFC1918 + `169.254.169.254` (cloud metadata) and IPv6 private ranges blocked by default (SSRF protection); URL paths ignored.
- Autonomy: L3
- Evidence: "Network: Blocked by default, then opened by your network mode and sandbox.json."; "Private/RFC 1918 addresses ... and cloud metadata endpoints (169.254.169.254) are blocked by default to prevent SSRF."
- Confidence: HIGH

### D12: Sandbox environment variables (CURSOR_SANDBOX, CURSOR_ORIG_UID/GID)
- Category: sandbox
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/security/run-modes
- What: Injected into every sandboxed child: `CURSOR_SANDBOX` = "seatbelt" (macOS) / "native" (Linux); `CURSOR_ORIG_UID`/`CURSOR_ORIG_GID` = host UID/GID captured before namespace remap; `CURSOR_SANDBOX_LANDLOCK_STATUS` = backend diagnostics (Linux).
- Autonomy: L0 (observability)
- Evidence: "Set to \"seatbelt\" (macOS) or \"native\" (Linux) when the process is running inside the sandbox."
- Confidence: HIGH

### D13: Sandbox-aware agent harness (escalation UX + adoption)
- Category: sandbox
- Cursor Status: GA (shipped; research post Feb 18, 2026)
- Source: https://cursor.com/blog/agent-sandboxing
- What: Harness teaches models sandbox constraints via Shell tool descriptions; failure results surface which sandbox constraint fired and suggest permission escalation; agents must anticipate sandbox-ability and request elevation. Measured: sandboxed agents "stop 40% less often"; a third of requests on supported platforms run sandboxed; enterprise adopters incl. NVIDIA.
- Limitations: approval fatigue was the motivating problem; escalation retries were a failure mode fixed by result rendering.
- Autonomy: L3
- Evidence: "Sandboxed agents stop 40% less often than unsandboxed ones"; "We now see a third of requests on supported platforms running with the sandbox."
- Confidence: HIGH

---

## C. BROWSER PLANE & CANVAS

### D14: Browser tool (agent-driven web view)
- Category: browser
- Cursor Status: GA (enterprise toggle v2.0+)
- Source: https://cursor.com/docs/agent/tools/browser
- What: Native browser the agent controls: Navigate, Click (incl. double/right/hover), Type, Scroll, Screenshot, Console output read, Network traffic monitor (Agent panel only). Screenshots integrated with file-reading tool (agent sees images); logs written to files the agent greps selectively (token-efficient); dev-server port detection; session persistence per workspace (cookies, localStorage/sessionStorage, IndexedDB). Runs as secure web view controlled via MCP server extension; per-session random auth token, per-tab unique IDs; external security auditors reviewed.
- Invoke: in-chat (`@browser`), pane/inline in Cursor.
- Prereqs: none locally; enterprise = MCP controls toggle.
- Autonomy: L2 default (manual approval), configurable to L4 (auto-run) or allow/block lists
- Evidence: "Agent can control a web browser to test applications, audit accessibility, convert designs into code"; "Browser tools require your approval by default."
- Confidence: HIGH

### D15: Browser approval modes + enterprise origin allowlist
- Category: browser | enterprise-controls
- Cursor Status: GA (modes); Origin allowlist GATED (v2.1+, must be enabled per org by account team)
- Source: https://cursor.com/docs/agent/tools/browser
- What: Modes: Manual approval (recommended) | Allow-listed actions | Auto-run. Enterprise: browser availability under MCP controls; Browser Origin Allowlist restricts `browser_navigate` and MCP tool execution to configured origins (empty = allow all). Manual user navigation still allowed; once on a non-allowed origin, agent browser tools blocked. Best-effort edge cases: link clicks, redirects, and JS navigation from allowed→non-allowed origins succeed.
- Autonomy: L2→L4 by mode
- Evidence: "The agent can only use the browser_navigate tool to visit URLs matching origins in the allowlist"; "If the agent clicks a link on an allowed domain that navigates to a non-allowed origin, the navigation will succeed."
- Confidence: HIGH

### D16: Browser visual editor
- Category: browser
- Cursor Status: GA (Cursor 2.2, Dec 11, 2025)
- Source: https://cursor.com/blog/browser-visual-editor
- What: Drag-and-drop of rendered DOM elements, component/props inspection in sidebar, visual style controls (color pickers, grid/flex/typography), point-and-prompt ("make this bigger") with parallel agents applying changes to code.
- Autonomy: L1 (human drives UI, agent writes code)
- Evidence: "tell the agent to apply it. The agent will locate the relevant components and update the underlying code for you."
- Confidence: HIGH

### D17: Canvases (interactive artifacts)
- Category: browser (adjacent surface)
- Cursor Status: GA (sharing on paid plans; Legacy Privacy Mode blocks shares)
- Source: https://cursor.com/docs/agent/tools/canvas
- What: Standalone rendered views (dashboards/reports) next to chat; openable, editable, rerunnable with fresh data; publish/share as read-only team links; packagable as skills (trigger + layout + data sources + formatting rules); openable from command palette and Agents Window; admin can disable org-wide.
- Autonomy: L2 (agent builds, human iterates)
- Evidence: "Cursor saves the canvas so you can reopen and rerun it later with fresh data."
- Confidence: HIGH

---

## D. BUGBOT (PR review bot)

### D18: Bugbot PR review (core)
- Category: bugbot
- Cursor Status: GA (out of beta July 2025)
- Source: https://cursor.com/docs/bugbot; https://cursor.com/blog/building-bugbot (Jan 15, 2026)
- What: Reviews PR diffs on GitHub/GHES, GitLab/self-hosted, Bitbucket DC, Azure DevOps; comments with explanations + fix suggestions; automatic on every PR update or manual via `cursor review` / `bugbot run` comments; reads PR comments as context; "Fix in Cursor"/"Fix in Web" deep links; incremental reviews (diff since last review) toggleable; PR summaries (description/comment/off); effort levels Low/Default/High/Smart (usage-based plans); `/review-bugbot` skill runs same review pre-push with patch-ID dedup sync.
- Invoke: Automations dashboard; SCM comments; API (D23).
- Runtime behind: fully agentic since fall 2025 — reasons over diff, calls tools, dynamic context; earlier pipeline: 8 parallel passes with randomized diff order → bucketing → majority voting → validation model → dedupe; resolution-rate metric (LLM-judged at merge) used for hill-climbing; ~2M PRs/month, resolution rate 52%→78.13% (vs Greptile 63.49%, CodeRabbit 48.96%).
- Limitations: findings default to `neutral` check conclusion (does not block merge by itself).
- Autonomy: L3 (autonomous review on events)
- Evidence: "Bugbot analyzes PR diffs and leaves comments with explanations and fix suggestions."; "Run eight parallel passes with randomized diff order ... Majority voting to filter out bugs found during only one pass."
- Confidence: HIGH

### D19: Bugbot CI check statuses
- Category: bugbot
- Cursor Status: GA
- Source: https://cursor.com/docs/bugbot
- What: Publishes check per run: GitHub "Cursor Bugbot", Bitbucket `cursor-bugbot`, Azure DevOps `cursor-bugbot/review`. Conclusions: success (no issues, no unresolved), neutral (findings — default), failure (fail-on-unresolved-issues enabled); no `skipped` conclusion; separate "Cursor Bugbot Autofix" check uses success/neutral only. Branch protection can require the check.
- Autonomy: L3
- Evidence: "failure: Bugbot found issues and the check is configured to fail on unresolved issues."
- Confidence: HIGH

### D20: Bugbot rules (team / repository / .cursor/BUGBOT.md / manual)
- Category: bugbot
- Cursor Status: GA
- Source: https://cursor.com/docs/bugbot
- What: Team rules (dashboard, org-wide) + repository rules + project `.cursor/BUGBOT.md` files (root always included; nested per-path) merge in order: Team Rules → BUGBOT.md → learned rules → manual rules. Caps: 30k chars/rule, 100k combined. `bugbot run verbose=true` posts table of rules used (truncated/omitted flagged). Cursor `.mdc` project rules do NOT apply. Examples: eval/exec flagging, license scan (GPL/AGPL blocking), missing-tests gate, TODO rules.
- Autonomy: L3 (steers autonomous review)
- Evidence: "Create .cursor/BUGBOT.md files to provide project-specific context for reviews."
- Confidence: HIGH

### D21: Bugbot learned rules (self-improving from PR signals)
- Category: bugbot
- Cursor Status: GA (launched in beta; >110k repos, >44k rules by Apr 8, 2026)
- Source: https://cursor.com/docs/bugbot; https://cursor.com/blog/bugbot-learning (Apr 8, 2026)
- What: Rules auto-generated from team GitHub activity (comment reactions, replies, human reviewer comments) or backfilled from repo history; `@cursor remember [fact]` inline teaching; candidate rules promoted/demoted by accumulated signal; per-rule analytics (issues found, acceptance rate); manual rules also supported; Cursor auto-enables/disables rules over time.
- Autonomy: L4 (self-improving loop) within review scope
- Evidence: "Bugbot processes these signals into candidate rules that it continues to evaluate against incoming PRs."; "more than 110,000 repos have enabled learning, generating more than 44,000 learned rules."
- Confidence: HIGH

### D22: Bugbot Autofix
- Category: bugbot
- Cursor Status: GA (out of beta Feb 26, 2026)
- Source: https://cursor.com/docs/bugbot; https://cursor.com/blog/bugbot-autofix
- What: On findings, automatically spawns a Cloud Agent that analyzes/fixes and pushes to existing branch or a new branch, then comments on the PR. Team defaults: Off | Create New Branch (recommended) | Commit to Existing Branch (max 3 attempts per PR, loop prevention). Provider matrix: GitHub/Origin both modes; GitLab/Bitbucket commit-to-existing only; Azure DevOps none. Uses default agent model; requires on-demand usage + storage (not Legacy Privacy Mode); Cloud Agent credits billing; >35% of autofix changes merged into base PR.
- Autonomy: L3 (autonomous fix, human merges)
- Evidence: "Bugbot Autofix automatically spawns a Cloud Agent to fix bugs found during PR reviews."; "Commit to Existing Branch — max 3 attempts per PR to prevent loops."
- Confidence: HIGH

### D23: Bugbot API + Admin API
- Category: bugbot
- Cursor Status: GA (Enterprise teams)
- Source: https://cursor.com/docs/bugbot
- What: `POST /bugbot/review` (trigger by prUrl; `dryRun:true` runs full pipeline without SCM side effects, still billed; 30 rpm; admin:* key) and `GET /analytics/team/bugbot-reviews` (per-review commit, findings, cost_cents, resolution_status; read:* key). Admin API: `/bugbot/repo/update` (enable/disable, manualTriggerOnly), `/bugbot/repos`, `/bugbot/user/update` (allow/blocklist provisioning, 60 rpm) for integrating with internal access-request tooling.
- Autonomy: L0/L3 (external trigger of autonomous review)
- Evidence: "Set dryRun to true to run the full analysis pipeline without posting review comments, inline comments, checks, or other SCM side effects."
- Confidence: HIGH

---

## E. SECURITY AGENTS & PR APPROVAL (Automations platform)

### D24: Security Agents (Security Reviewer + Vulnerability Scanner)
- Category: security | bugbot
- Cursor Status: GA (requires Cloud Agents; Security Review Context in approval agent needs Team/Enterprise)
- Source: https://cursor.com/docs/security-agents
- What: Two Cursor-managed agent types on the Automations platform: Security Reviewer (checks PRs before merge; Git-based triggers) and Vulnerability Scanner (scans codebase at rest; cron triggers). Built-in security checks toggleable; custom instructions; tools/MCPs (Reviewer needs ≥1 tool to save); Scanner findings land in "Flagged Vulnerabilities" list (status Active/Dismissed, feedback Useful/False Positive/Unimportant, severity Critical/High/Medium); "Fix in Cursor" starts a Cloud Agent fix; analytics: vulnerabilities found / issues fixed / resolution rate (LLM-judged diffs); billed to team usage pool under shared service account. In-agent skills: `/review-security` and `/review` (Cursor 3.7+, web, CLI) review branch diff vs base branch.
- Autonomy: L3 (event/cron autonomous), fix path L3
- Evidence: "Security Reviewer checks pull requests before they merge."; "Vulnerability Scanner scans your codebase at rest."
- Confidence: HIGH

### D25: Security automation templates (Agentic Security Review, Vuln Hunter, Anybump, Invariant Sentinel)
- Category: security
- Cursor Status: GA (templates released Mar 16, 2026; internal fleet proven)
- Source: https://cursor.com/blog/security-agents
- What: Four blueprints on Automations (powered by cloud agents): (1) Agentic Security Review — PR review with blocking CI gate check + Slack; (2) Vuln Hunter — segments codebase and hunts pre-existing vulns; (3) Anybump — dependency patching with reachability analysis, tests, auto-PR, canary gate; (4) Invariant Sentinel — daily drift monitoring of security/compliance invariants with subagents + automations memory + Slack reports. Supporting security MCP (serverless Lambda): persistent data, LLM dedup (Gemini Flash 2.5 classifier), consistent Slack output.
- Autonomy: L3-L4 (Anybump opens PRs autonomously; Invariant Sentinel self-schedules daily)
- Evidence: "we implemented a blocking gate check"; "Anybump runs reachability analysis to narrow vulnerabilities to those that are actually impactful."
- Confidence: HIGH

### D26: PR Routing & Approval (approval-agents — agents that approve PRs)
- Category: approvals
- Cursor Status: GA (GitHub + Origin repos only)
- Source: https://cursor.com/docs/approval-agents
- What: Automations agent that (1) assigns reviewers by code ownership/commit history and (2) auto-approves low-risk PRs. Signals: risk scoring with Maximum Risk Threshold, Bugbot Review Context, Security Review Context (waits for agentic reviewer checks; will not approve if human review needed), approval policy files: exact-basename `APPROVAL_POLICY.md` discovered per changed file (closest wins; ancestors apply), top-level `.cursor/approval-policies/ROUTING.md` (YAML product→boundary→policies). Self-hardening: PRs touching policy files use base-branch version; conflicts resolved to stricter policy / no auto-approval. Triggers: PR opened/pushed/commented(regex).
- Autonomy: L3 (autonomous approval under guardrails)
- Evidence: "routes pull requests to the right reviewers and can approve low-risk changes"; "the agent does not use the changed content to relax review requirements for that same PR."
- Confidence: HIGH

---

## F. CLOUD AGENTS: COMPUTER USE & DATA CONTROLS

### D27: Cloud Agent computer use (agents control their own VMs)
- Category: computer-use
- Cursor Status: GA (Feb 24, 2026)
- Source: https://cursor.com/blog/agent-computer-use
- What: Cloud agents get isolated VMs with full dev environments; can test their own changes by driving the VM desktop/browser (click, type, screenshots, video recording) and produce artifacts (videos, screenshots, logs); agent's remote desktop can be taken over by the user ("control the agent's remote desktop ... and make edits yourself"); available from web/mobile/desktop/Slack/GitHub. Internally: >30% of merged PRs at Cursor created by autonomous cloud agents; demos: reproducing a clipboard-exfiltration vuln end-to-end, UI walkthroughs.
- Invoke: cursor.com/onboard, Slack, GitHub; artifacts in chat.
- Runtime behind: cloud sandbox VM per agent; recording of desktop interaction.
- Autonomy: L3 (autonomous inside VM; PR is the review boundary)
- Evidence: "agents operating autonomously in cloud sandboxes"; "The agent recorded itself interacting with desktop applications in its VM."
- Confidence: HIGH

### D28: Cloud Agent Runtime Secrets ([REDACTED] scrubbing)
- Category: security | enterprise-controls
- Cursor Status: GA
- Source: https://cursor.com/docs/cloud-agent__security-network (docs/cloud-agent/security-network)
- What: Secret type "Runtime Secret": loaded as env vars but values stripped from tool call results, chat transcript, commits and commit messages, replaced with placeholder `[REDACTED]`; the model never sees the value. Other secret types exist in Secret & Network reference (values UNKNOWN from this corpus slice). Secrets stored in encrypted credential stores in Cursor's backend; per-agent encrypted transcripts.
- Autonomy: L3 enabler (run secret-dependent agents without exposure)
- Evidence: "their contents are redacted from the agent's tool call results, chat transcript, commits, and commit messages, and replaced with the placeholder string [REDACTED]."
- Confidence: HIGH

### D29: Cloud Agent network egress modes
- Category: network-controls | enterprise-controls
- Cursor Status: GA (Enterprise admins can lock org-wide)
- Source: https://cursor.com/docs/cloud-agent__security-network (docs/cloud-agent/security-network); https://cursor.com/docs/enterprise/security-hardening
- What: Modes: Allow all network access | Default + allowlist (default domains + your list) | Allowlist only. Enterprise lock org-wide; per-environment restrictions inherited by agents using that environment. Separate Tailscale/Cloudflare Tunnel recipes exist for Cloud Agent VMs (userspace networking + proxy variables — distinct from Grok Bot's Team Setup pattern). Cloud Agent OIDC federation to AWS/GCP/Azure replaces long-lived cloud keys.
- Autonomy: L3 boundary
- Evidence: "Default + allowlist ... Allowlist only"; "Enterprise admins can lock the policy org-wide."
- Confidence: HIGH

### D30: Self-hosted computer use (worker machines)
- Category: computer-use
- Cursor Status: NEW/PREVIEW ("Computer use and desktop sharing are new"; explicit opt-in, never server-enabled)
- Source: https://cursor.com/docs/cloud-agent/self-hosted/computer-use
- What: Agent on a Self-Hosted Machines worker clicks, types, takes screenshots, drives applications with a UI; can drive a browser if Chrome/Chromium installed. macOS: helper app "Cursor Computer Use" (`co.anysphere.cursor-computer-use`, Apple Team ID DCNK4UB866) installed by CLI from downloads.cursor.com; needs signed-in GUI session + Accessibility + Screen Recording permissions (MDM PPPC possible for Accessibility; Screen Recording always human-approved; fleet pattern grant→verify→snapshot; `CUA_SERVICE_APP` env for MDM-deployed bundles). Linux: X11 display (explicit `--display :0` > inherited DISPLAY > managed TigerVNC desktop running Xfce); deps `dbus-x11 ffmpeg tigervnc-standalone-server x11-utils x11-xserver-utils xdotool xfce4`; works for My Machines and Team Pools; verify via `agent worker debug` + real screenshot task.
- Invoke: `agent worker --computer-use start` (flag before `start`).
- Autonomy: L3 (autonomous GUI operation on worker)
- Evidence: "computer use lets an agent on a Self-Hosted Machines worker click, type, take screenshots, and drive applications with a UI"; "Both features are explicit opt-ins and are never enabled by the server."
- Confidence: HIGH

### D31: Desktop sharing (--share-desktop)
- Category: computer-use
- Cursor Status: NEW/PREVIEW (Linux-only)
- Source: https://cursor.com/docs/cloud-agent/self-hosted/computer-use
- What: Authorized viewers watch or take control of a Linux agent desktop from Cursor. Modes `view` or `view_and_control` (default). Uses worker-created isolated agent desktop (not the machine session), requires tigervnc-standalone-server; fail-closed input filter enforces control mode; clipboard transfer blocked; pixels leave only through the worker's existing outbound connection (no inbound ports). Separate app identity from computer use (Cursor Agent Helper, `co.anysphere.cursor.agent-helper`).
- Autonomy: L0/L1 (human watch/control) for the viewer; enables human-in-the-loop on agent desktops
- Evidence: "A fail-closed input filter on the machine enforces control, and clipboard transfer stays blocked."
- Confidence: HIGH

---

## G. GROK BOT (dedicated computer-use product)

### D32: Grok Bot product (durable Bots on persistent cloud computers)
- Category: computer-use
- Cursor Status: GA (included with every paid individual plan + Teams; SuperGrok link path; iOS app iOS 18+)
- Source: https://cursor.com/docs/grok-bot; https://cursor.com/docs/grok-bot/get-started
- What: Named AI teammates with compounding context (memory, files, browser sessions, preferences); each Bot works on a persistent cloud computer with browser, filesystem, terminal; messaging-based UX (attach files, @-mention Bots/groups/routines/plugins, group chats 2-6 Bots, async Bot-to-Bot handoffs); skills (saved reusable workflows) and routines (scheduled/event-triggered, up to 50/Bot, 20 run records); "Teach a task" records a demonstrated browser workflow (up to 10 min, no mic audio) into a draft skill (rolling out gradually = BETA); plugins for Gmail/Notion/Slack etc. (OAuth tokens held on Cursor's connector backend, never on the computer).
- Relation to Cursor: separate product surface from the IDE agent and Cloud Agents; can delegate coding tasks to Cloud Agents (admin-switchable).
- Autonomy: L3 (autonomous work with approval stops)
- Evidence: "Each Bot works on a persistent cloud computer with a browser, filesystem, and terminal"; "Teaching records visible computer interaction for up to ten minutes."
- Confidence: HIGH

### D33: Grok Bot computer-use mechanics (screens, watch, take over, recording)
- Category: computer-use
- Cursor Status: GA
- Source: https://cursor.com/docs/grok-bot/work; https://cursor.com/docs/grok-bot (FAQ)
- What: All Bots of one user share one cloud computer: every Bot gets its own screen; one computer-use task per screen at a time; screens are work surfaces, NOT security boundaries. "Agent Computer" view streams clicks/typing/navigation for live watching; Bot hands over the computer for passwords, 2FA, CAPTCHAs, payment/identity checks and human-required sites (Bot never types credentials and doesn't see the password); sessions persist on the durable disk. Transcript shows tool activity, computer use, files, questions, approvals.
- Autonomy: L3 with L2 handoffs
- Evidence: "Each Bot gets its own screen, and one Bot runs one computer-use task on its screen at a time"; "The Bot hands you the computer for passwords, passkeys, two-factor codes, CAPTCHAs, payment or identity checks."
- Confidence: HIGH

### D34: Grok Bot isolation (Firecracker microVMs)
- Category: security | sandbox
- Cursor Status: GA
- Source: https://cursor.com/docs/grok-bot/security-faq; https://cursor.com/docs/grok-bot/teams
- What: Per-user isolation: each user gets a dedicated Firecracker microVM with its own kernel, memory, virtual devices; hardware-level separation between users; strict isolation between users, none between a user's own Bots. Hosting: Cursor-hosted only — no on-prem, no in-perimeter, no bring-your-own-image. Computers run in the US (not covered by US-only residency program by default). Linux computers, not MDM-enrolled.
- Autonomy: L3 boundary
- Evidence: "Each user gets a dedicated Firecracker microVM with its own kernel, memory, and virtual devices."
- Confidence: HIGH

### D35: Grok Bot Auto Review (independent review model)
- Category: approvals
- Cursor Status: GA (Enforce Auto-review + team rules = Enterprise only)
- Source: https://cursor.com/docs/grok-bot/security
- What: Independent review model evaluating risky actions BEFORE they run, covering: shell commands, plugin calls, computer use, automation writes (routine/event-trigger changes), delegation (Cloud Agent and subagent launches). Verdicts: let proceed / require approval / deny. Approvals UI: Allow once / Always allow (saves matching rule) / Deny (iOS: Approve once/Deny). Rules: "Ask first" always stops matches; "Allow automatically" proceeds only if reviewer finds no other reason to stop; personal rules only make behavior stricter; Ask first wins conflicts; team rules appear locked ("Required by your admin"). Blind spots: memory writes and most settings changes are not reviewed. Prompt-injection defense: Auto Review + network policy + per-action approvals + per-user isolation; outside content marked untrusted.
- Autonomy: L3
- Evidence: "an independent review model that evaluates risky Bot actions before they run, covering shell commands, plugin calls, computer use, automation writes ..., and delegation"; "Ask first rules always stop matching actions."
- Confidence: HIGH

### D36: Grok Bot Network Controls (egress destination policy)
- Category: network-controls
- Cursor Status: GA control, Enterprise only (self-serve Teams default allow-all)
- Source: https://cursor.com/docs/grok-bot/security; https://cursor.com/docs/grok-bot/security-faq
- What: Four modes: No policy (allow-all default) / Explicitly allow all / Defaults plus team allowlist / Team allowlist only (+ destinations the computer needs to function). Destinations = web domains + IP ranges with ports, no entry cap. Directory groups can set own policy (group widens only); lock makes team policy apply to all. Policy applies to running computers within ~1 minute, sleeping on wake, no recreate needed. Egress via shared static egress IPs (no dedicated per-customer IPs); members can route traffic through their desktop; TLS-inspecting gateways must exempt `*.cursor.sh`, `*.cursorvm.com`, `*.*.cursorvm.com`. No dedicated DLP hooks ("Dedicated data loss prevention hooks are not available").
- Autonomy: L3 boundary
- Evidence: "Mode ... Team allowlist only — Only your list, plus the destinations a computer needs to function"; "Computers reach the internet through shared static egress IP addresses by default."
- Confidence: HIGH

### D37: Grok Bot Team Setup + private networks (Tailscale/Cloudflare Tunnel pattern)
- Category: network-controls | enterprise-controls
- Cursor Status: GA (Enterprise only)
- Source: https://cursor.com/docs/grok-bot/private-networks
- What: Team Setup = admin-managed manifests of install scripts run on every team computer (computer start + ~daily refresh; Check Script skips if exit 0; 30-min timeout per entry; failed entries retried; no secrets allowed in scripts). Purpose: install your networking client (worked examples: Tailscale exit node, Cloudflare Tunnel Access) so Bots reach private services; auth happens interactively in the computer's browser under your IdP policies. Cursor installs/operates nothing; no fleet view of script results. Also used for custom EDR/security tooling (no built-in customer-facing EDR feed).
- Autonomy: L0 (admin-run pattern)
- Evidence: "manifests of install scripts that run on every team computer"; "Cursor installs nothing by default, doesn't operate or monitor your network client."
- Confidence: HIGH

### D38: Grok Bot logging: Action Recording, audit logs, OpenTelemetry Export
- Category: enterprise-controls
- Cursor Status: GA, all Enterprise only (Action Recording off by default; Legacy Privacy Mode forces off)
- Source: https://cursor.com/docs/grok-bot/teams; https://cursor.com/docs/grok-bot/security
- What: Action Recording records Bot actions — MCP tool calls, shell commands (secret-scrubbed), browser navigations (`scheme://host/path` + title, query strings/credentials stripped), computer-use sessions (action + screenshot COUNTS and duration only — no screenshots, clicks, or typed text); internal store, 90-day retention; delivered to your collector via OpenTelemetry Export tagged `cursor.surface=grok_bot`. Audit logs (separate pipeline) cover admin/security/auth + Grok Bot control-plane events (Bot creation, access changes, Team Setup manifests, MCP auth, routines), SIEM-streamable. No customer-facing EDR/telemetry feed.
- Autonomy: L0 observability
- Evidence: "computer use sessions record action and screenshot counts and the session duration, without the screenshots, clicks, or typed text"; "Shell commands are secret-scrubbed."
- Confidence: HIGH

### D39: Grok Bot local execution (Bot acting on member's own machine)
- Category: computer-use | approvals
- Cursor Status: GA (admin cap = Teams+Enterprise; default "Always allow" leaves member at per-command ask)
- Source: https://cursor.com/docs/grok-bot/security; https://cursor.com/docs/grok-bot/teams
- What: Bots can run commands, read files, move files between cloud computer and local machine via desktop app. Policy: ask every time (default at member level) / always allow / never. Admin ceiling "Execution on Local Computer" on Grok Bot page; member's stricter setting still applies; "Allow Local Egress" (Enterprise) separately controls routing web traffic through the desktop (off stops routes within 5 min). Distinct from Auto Review (which governs the hosted computer).
- Autonomy: L2 default (per-command approval), up to L4 if member sets always-allow
- Evidence: "Per-command approval is the default, and the approval card shows the exact command."; "Pick Never allow unless Bots have a specific reason to work on member machines."
- Confidence: HIGH

### D40: Grok Bot computer lifecycle (recreate/terminate/hibernate/30-day auto-terminate)
- Category: security | enterprise-controls
- Cursor Status: GA (Enterprise only, org admins)
- Source: https://cursor.com/docs/grok-bot/computers
- What: Recreate = rebuild on latest image + re-run Team Setup, durable disk kept (Bots/files/logins return), Bot mid-turn pauses at safe point (recreate fails if it can't pause); Terminate = stops work, durable disk kept, next message starts fresh computer; "Delete VMs and Data" removes durable data. Terminate Inactive Computers: auto-terminate after 30 days hibernation (off by default; never kills an awake/working computer; no grace period). Idle computers hibernate automatically (hibernation ≠ deletion); image updates recreate preserving files; backups daily; DPA deletion within 30 days of written direction; no per-org retention policy or per-computer PITR.
- Autonomy: L0 (admin ops)
- Evidence: "Both actions keep the member's durable disk"; "When a member's computer goes 30 days without use, Cursor terminates it."
- Confidence: HIGH

### D41: Grok Bot identity (SSO/SCIM, no Bot identity, credential handling)
- Category: enterprise-controls | security
- Cursor Status: GA (SCIM + Enterprise enable switch = Enterprise only)
- Source: https://cursor.com/docs/grok-bot/identity; https://cursor.com/docs/grok-bot/security
- What: Sign-in via Cursor account/SSO (SAML 2.0: Okta, Entra, Google Workspace, OneLogin; can require SSO). SCIM 2.0 provisioning/deprovisioning. Bots have NO identity or credentials of their own — act as the signed-in member, actions attributable to a named member; team-managed connectors are the exception (service-account credentials). IdP sign-in inside the computer: Linux session unmanaged ("Other Desktop" platform in Okta; FastPass/device-compliance rules must be relaxed per-app); revocation via IdP ends sessions. Masked "secure secret request" keeps values out of transcript and away from the model.
- Autonomy: L0
- Evidence: "A Bot has no identity or credentials of its own"; "Bots act as the signed-in member."
- Confidence: HIGH

---

## H. ENTERPRISE PLATFORM CONTROLS

### D42: Privacy & data governance (Privacy Mode/ZDR, CMEK, residency, model retention)
- Category: enterprise-controls
- Cursor Status: GA (US-only residency GA, 10% model-price uplift; EU+Iceland inference-only on request; CMEK via sales; Cloud Agent retention custom windows "early access")
- Source: https://cursor.com/docs/enterprise/privacy-and-data-governance; https://cursor.com/docs/enterprise/security-hardening
- What: Privacy Mode enforceable org-wide (members can't disable; ZDR commitments for Cursor-routed models); Cloud Agents are the only feature storing code (encrypted copies, deleted after run); BYOK loses Cursor's ZDR; some models (Claude Fable 5.x) require provider data retention → admin approval gate, guardrail-tripped Fable requests auto-route to Claude Opus; CMEK for Cloud Agent data; data residency across inference/processing/storage layers; eligible residency models: gpt-*, Claude 4.6+, Gemini 2.5 Flash, Composer, Grok 4.5; non-regional: SSO (WorkOS), BYOK, custom models, MCPs, Bugbot (repo region), shared links. Retention: Cloud Agent snapshots 90-day inactivity expiry; retention windows Indefinite/90d.
- Autonomy: L0
- Evidence: "With Privacy Mode enabled your code is never used for training by Cursor or other AI model providers."; "US-only data residency incurs a 10% uplift on Model pricing."
- Confidence: HIGH

### D43: Compliance & monitoring (audit logs, SIEM streaming, OTel export, SOC2)
- Category: enterprise-controls
- Cursor Status: GA (Enterprise plan)
- Source: https://cursor.com/docs/enterprise/compliance-and-monitoring; https://cursor.com/docs/enterprise/security-hardening
- What: Audit logs (JSON, `application_type`: grok_bot|cursor; event_types incl. login/logout, add_user, mcp_server_config, privacy_mode, grok_bot_vm_bulk, grok_bot_routine, bugbot_*) — agent responses and generated code NOT logged (hooks recommended for that); streamable to SIEM (Splunk/Sumo/Datadog), webhooks, S3; CSV export. OpenTelemetry Export = separate OTLP pipeline for usage/activity telemetry + recorded Grok Bot actions. Certifications: SOC 2 Type II, GDPR, ISO 27001 + ISO 42001 (Schellman; Grok Bot in ISO scope). No OT trace/span IDs in audit logs.
- Autonomy: L0
- Evidence: "We do not log agent responses or generated code content."; "Stream audit logs to your existing systems: SIEM systems (Splunk, Sumo Logic, Datadog, etc.)"
- Confidence: HIGH

### D44: Endpoint security configuration (AV/EDR exclusions)
- Category: enterprise-controls
- Cursor Status: GA (guidance doc)
- Source: https://cursor.com/docs/enterprise/endpoint-security
- What: AV/EDR per-file scanning of JS modules at startup can exceed Cursor startup timeouts and break Agent; doc lists Windows process/path exclusions (Cursor.exe, rg.exe, inno_updater.exe; user+system install paths), macOS (Cursor.app); identification commands (Get-CimInstance AntiVirusProduct, fltmc drivers, EDR injection env vars BPP/COR_PROFILER/COMPLUS/__COMPAT); kernel minifilter drivers need path exclusions too.
- Autonomy: L0
- Evidence: "security software that intercepts file operations or injects into processes can slow startup past internal timeouts, causing features like Agent to fail."
- Confidence: HIGH

### D45: Enterprise network configuration (proxies, SSL inspection, allowlist, private connectivity)
- Category: enterprise-controls | network-controls
- Cursor Status: GA (guidance)
- Source: https://cursor.com/docs/enterprise/network-configuration
- What: HTTP/2 bidirectional streaming default with transparent HTTP/1.1 SSE fallback (Zscaler); recommend disabling SSL inspection for .cursor.sh, cursor-cdn.com, marketplace.cursorapi.com, authenticate/authenticator.cursor.sh, `*.cursorvm.com`, `*.*.cursorvm.com` (both cursorvm patterns required for Grok Bot; off-network/roaming profiles too); curl tests for issuer + streaming; domain allowlist (api2/api3/api4/api5.cursor.sh, repo42, gcpp regionals, prod.authentication...); PrivateLink + Cloudflare Tunnel for private SCMs (no VPC peering / PSC); editor agents inherit host network (NSGs, firewall, DNS); Cloud Agents cannot reach resources behind corporate firewall; LLM gateways not recommended (hooks instead).
- Autonomy: L0
- Evidence: "Cursor automatically falls back to HTTP/1.1 Server-Sent Events (SSE) mode"; "Cursor does not currently offer VPC peering or customer-facing Google Private Service Connect."
- Confidence: HIGH

---

## Cross-cutting observations (for ME2-OS parity mapping)

1. **Sandbox mechanics (local)**: OS-subprocess-tree confinement, not VMs — Seatbelt profiles (macOS), Landlock+seccomp with overlay-remapped ignored files and user-namespace UID remap (Linux, Bubblewrap fallback), WSL2 re-use (Windows). Config as data (`sandbox.json`) with layered merge (user < repo < team < hardcoded) and SSRF-protected default-deny network with domain/CIDR allowlists. This is the same layer pattern as ME2 prlimit/exthost but richer (per-command sandbox-ability check feeding the classifier).
2. **Approval stack is three-tier**: allowlist (deterministic) → sandbox-ability check (deterministic) → LLM classifier (probabilistic, small fast model, agentic inspection, feedback-to-agent-instead-of-prompt). Explicitly documented as best-effort, paired with deterministic hooks (failClosed) — "pair best-effort guardrails with deterministic ones".
3. **Computer-use stack**: three distinct surfaces — (a) local sandboxed shell, (b) Cloud Agent VMs w/ screen recording + remote-desktop takeover, (c) Grok Bot: per-user Firecracker microVM, one screen per Bot, one computer-use task per screen, human takeover for credentials/2FA/CAPTCHA, computer-use sessions recorded as counts-only metadata; (d) self-hosted workers via CLI flags (`--computer-use`, `--share-desktop`) with X11/TigerVNC/xdotool on Linux and a signed macOS helper app gated by TCC permissions.
4. **Review loop economy**: Bugbot resolution rate (LLM-judged) as the north-star metric; learned rules close the loop from PR outcomes; Autofix closes it into code; Security Agents + PR-approval agents consume each other's findings (Bugbot/Security contexts gate auto-approval).
5. **UNKNOWN / not in corpus**: sandbox hardening internals beyond the blog (no syscall tables); exact classifier prompts/model mix per surface; Bugbot seat-based legacy pricing details; Cursor CLI permissions schema (separate doc, not read in this track); Grok Bot model binding (corpus only says "Cursor manages model selection", no fixed vendor set).
