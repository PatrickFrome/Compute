# R61 Track B — Cursor Extensibility Catalog (research-only)

- Compiled: 2026-09-24, from pre-fetched corpus /tmp/r61-corpus/ (docs + blog). All sources carry SOURCE_URL/FETCHED_AT headers; docs fetched 2026-09-24.
- Scope: Rules, Skills, Subagents, Hooks, MCP, Plugins, Extension API, SDKs, Bridge, harness composition, security model.
- Capability count: 57. Statuses are inferred from doc language (docs rarely state lifecycle labels); UNKNOWN used freely per rules.
- Historical vs current: legacy "dynamic rules" + slash commands are being migrated to skills via built-in `/migrate-to-skills` (Cursor 2.4) — treated as DEPRECATED paths.

Autonomy scale: L0 manual, L1 suggest, L2 semi(approval), L3 autonomous-guardrails, L4 fully-autonomous.

---

## RULES

### rules-project: Project Rules (.cursor/rules)
- Category: rules
- Cursor Status: GA
- Source: https://cursor.com/docs/rules
- Date: fetch 2026-09-24
- What: Persistent prompt-level instructions stored as `.mdc` files in `.cursor/rules`, version-controlled, folder-organizable. Content included at start of model context. Plain `.md` in that dir is ignored (no frontmatter).
- Invoke: automatic per frontmatter (always/description/globs) or `@rule-name` in chat.
- Runtime behind: prompt-context injection only; no execution.
- Prereqs: none.
- Limitations: "Keep rules under 500 lines"; rules do NOT affect Cursor Tab or other AI features; not applied to Inline Edit (Cmd/Ctrl+K) for User Rules.
- Autonomy: L1 (guidance shaping, no enforcement)
- Evidence: "Rules provide system-level instructions to Agent."; "A plain .md file in .cursor/rules is ignored by the rules system"; "Rules do not impact Cursor Tab or other AI features."
- Confidence: HIGH

### rules-activation: Rule activation semantics (frontmatter)
- Category: rules
- Cursor Status: GA
- Source: https://cursor.com/docs/rules
- Date: fetch 2026-09-24
- What: 4 modes via type dropdown: Always (alwaysApply:true), Apply Intelligently (description only, Agent decides), Apply to Specific Files (globs auto-attach), Apply Manually (@mention). Explicit truth table for alwaysApply/description/globs. Glob syntax `*`, `**`, comma-separated.
- Invoke: frontmatter + chat @-mention.
- Runtime behind: frontmatter parsing; description surfaced to Agent for relevance decision.
- Prereqs: .mdc frontmatter.
- Limitations: "Apply Intelligently" needs a description; glob rules need matching file in context.
- Autonomy: L1–L2 (Agent can self-select rules via description)
- Evidence: "Agent reads the description and pulls the rule in when relevant."; "Auto-attached when a matching file is in context."
- Confidence: HIGH

### rules-user: User Rules
- Category: rules
- Cursor Status: GA
- Source: https://cursor.com/docs/rules
- Date: fetch 2026-09-24
- What: Global free-text preferences in Customize → Rules, applied across all projects; used by Agent (Chat) only.
- Invoke: automatic.
- Runtime behind: prompt injection.
- Prereqs: none.
- Limitations: "Do User Rules apply to Inline Edit (Cmd/Ctrl+K)? No."; not stored on filesystem (hence not migrated to skills).
- Autonomy: L1
- Evidence: "User Rules are global preferences... that apply across all projects."; "They are only used by Agent (Chat)."
- Confidence: HIGH

### rules-team: Team Rules (dashboard, enforceable)
- Category: rules
- Cursor Status: GA (Teams/Enterprise)
- Source: https://cursor.com/docs/rules
- Date: fetch 2026-09-24
- What: Admin-managed rules from Cursor dashboard; free-form text with optional glob patterns; per-rule "Enable immediately" and "Enforce this rule" (enforced = cannot be disabled by members). Included in Agent (Chat) context across all repos for the team.
- Invoke: automatic (glob-scoped when set).
- Runtime behind: dashboard config synced to clients.
- Prereqs: Team or Enterprise plan.
- Limitations: "AI guidance should not be your only security control."
- Autonomy: L1 (org-level guidance; enforcement is advisory)
- Evidence: "Team Rules work alongside other rule types and take precedence"; "When enabled, the rule is required for all team members and cannot be disabled in Customize."
- Confidence: HIGH

### rules-precedence: Precedence & merging
- Category: rules
- Cursor Status: GA
- Source: https://cursor.com/docs/rules
- Date: fetch 2026-09-24
- What: Explicit precedence order Team Rules → Project Rules → User Rules; all applicable rules merged; earlier sources win on conflict. Nested AGENTS.md: child dirs override parents ("more specific instructions taking precedence").
- Invoke: automatic.
- Runtime behind: merge at context assembly.
- Prereqs: —
- Limitations: conflict semantics only described for guidance text.
- Autonomy: L1
- Evidence: "Rules are applied in this order: Team Rules → Project Rules → User Rules. All applicable rules are merged; earlier sources take precedence."
- Confidence: HIGH

### rules-agents-md: AGENTS.md (root + nested)
- Category: rules
- Cursor Status: GA
- Source: https://cursor.com/docs/rules
- Date: fetch 2026-09-24
- What: Plain-markdown agent instructions alternative to .cursor/rules; supported at project root AND subdirectories (nested), auto-applied when working files fall under that directory; nested files combined with parents, more specific wins.
- Invoke: automatic by directory.
- Runtime behind: filesystem discovery + prompt injection.
- Prereqs: none.
- Limitations: no metadata/globs.
- Autonomy: L1
- Evidence: "Cursor supports AGENTS.md in the project root and subdirectories."; "Nested AGENTS.md support in subdirectories is now available."
- Confidence: HIGH

### rules-import-plugin: Rules/skills distribution via plugins (no direct repo import)
- Category: rules | plugins
- Cursor Status: GA
- Source: https://cursor.com/docs/rules (also docs/skills)
- Date: fetch 2026-09-24
- What: Rules (and skills) cannot be imported standalone from a repo; must be packaged in a plugin (repo needs `.cursor-plugin/marketplace.json`) or added as a team marketplace, then the plugin installed; components appear in Customize.
- Invoke: Customize → From GitHub Repository / team marketplace.
- Runtime behind: plugin packaging pipeline.
- Prereqs: plugin/marketplace.
- Limitations: indirect-only import path.
- Autonomy: L0 (install-time)
- Evidence: "Rules aren't imported on their own. To bring rules in from a GitHub repository, package them in a plugin."
- Confidence: HIGH

### rules-create-rule: /create-rule skill
- Category: rules | skills
- Cursor Status: GA (built-in skill)
- Source: https://cursor.com/docs/rules
- Date: fetch 2026-09-24
- What: Type `/create-rule` in Agent; Agent generates rule file with proper frontmatter and saves to .cursor/rules. Agent can also be asked in chat to create rules, and can update rules via @cursor on GitHub issues/PRs.
- Invoke: chat command.
- Runtime behind: built-in skill + file write.
- Prereqs: —
- Limitations: —
- Autonomy: L2 (agent authors file; user reviews)
- Evidence: "Type /create-rule in Agent and describe what you want. Agent generates the rule file with proper frontmatter."
- Confidence: HIGH

---

## SKILLS

### skills-core: Agent Skills (SKILL.md packages)
- Category: skills
- Cursor Status: GA (open standard, agentskills.io)
- Source: https://cursor.com/docs/skills
- Date: fetch 2026-09-24
- What: Portable version-controlled packages: folder with SKILL.md (YAML frontmatter: name, description required; paths, disable-model-invocation, icon, color, metadata optional) + optional scripts/, references/, assets/. Open standard ("Agent Skills is an open standard", agentskills.io).
- Invoke: Agent auto-applies when relevant; manual `/skill-name` (attaches to one message); as Custom Mode (session-long).
- Runtime behind: discovery at Cursor start; progressive resource loading.
- Prereqs: skill dir present.
- Limitations: name must match folder; lowercase/hyphens only; legacy `globs` field accepted as fallback (superseded by `paths`).
- Autonomy: L2 (model-invoked; scripts run via normal tool approval) — L3 when combined with sandbox/hooks.
- Evidence: "A skill is a portable, version-controlled package that teaches agents how to perform domain-specific tasks."; "Skills load resources on demand, keeping context usage efficient."
- Confidence: HIGH

### skills-dirs: Skill directories & third-party compat
- Category: skills
- Cursor Status: GA
- Source: https://cursor.com/docs/skills
- Date: fetch 2026-09-24
- What: Auto-loaded from `.agents/skills/`, `.cursor/skills/` (project), `~/.agents/skills/`, `~/.cursor/skills/` (user). Compat loading from `.claude/skills/`, `.codex/skills/`, `~/.claude/skills/`, `~/.codex/skills/`. Recursive/nested skill dirs; nested project `.cursor/skills/` anywhere in repo auto-scoped to that directory (monorepos).
- Invoke: automatic discovery.
- Runtime behind: recursive walk of skills roots.
- Prereqs: —
- Limitations: `~/.agents/skills/` and unsynced local skills are NOT copied to Cloud Agents, Agents Window remote SSH, or self-hosted workers (bake into image instead).
- Autonomy: L2
- Evidence: "Cursor also loads skills from Claude and Codex directories: .claude/skills/, .codex/skills/"; "Cursor walks the skills root recursively and picks up any SKILL.md it finds."
- Confidence: HIGH

### skills-invocation: Invocation modes & disable-model-invocation
- Category: skills
- Cursor Status: GA
- Source: https://cursor.com/docs/skills
- Date: fetch 2026-09-24
- What: Default: agent auto-applies on relevance. `disable-model-invocation: true` → behaves like traditional slash command (only via `/skill-name`). Any skill with valid frontmatter can back a Custom Mode (session-pinned, badge with icon/color).
- Invoke: auto / slash / Custom Mode.
- Runtime behind: context inclusion.
- Prereqs: frontmatter block for Custom Mode.
- Limitations: manual slash attach is per-message.
- Autonomy: L1 (manual-only mode) to L3 (agent-decides within session guardrails)
- Evidence: "Set disable-model-invocation: true to make a skill behave like a traditional slash command"; "keeps the skill in context for the whole session."
- Confidence: HIGH

### skills-scripts: Scripts inside skills
- Category: skills
- Cursor Status: GA
- Source: https://cursor.com/docs/skills
- Date: fetch 2026-09-24
- What: `scripts/` dir with executable code referenced by relative path from SKILL.md; any language (Bash, Python, JS). Agent reads instructions and executes scripts via its tools when skill invoked. references/ = docs on demand; assets/ = static templates.
- Invoke: agent executes per SKILL.md instructions.
- Runtime behind: normal agent tool execution (shell), subject to tool policies/sandbox.
- Prereqs: executable availability in environment.
- Limitations: scripts "should be self-contained"; no sandboxing specific to skills.
- Autonomy: L2
- Evidence: "Skills can include a scripts/ directory containing executable code that agents can run."; "Scripts can be written in any language."
- Confidence: HIGH

### skills-builtin: Built-in skills (~20)
- Category: skills
- Cursor Status: GA
- Source: https://cursor.com/docs/skills
- Date: fetch 2026-09-24
- What: Cursor-managed skills: /automate, /autopilot, /canvas, /create-hook, /create-rule, /create-skill, /create-subagent, /cursor-blame, /loop, /migrate-to-skills, /review, /review-bugbot, /review-security, /sdk, /shell, /split-to-prs, /statusline, /update-cli-config, /update-cursor-settings. Meta-capability: the harness ships self-authoring skills for every other mechanism.
- Invoke: slash or automatic when request matches purpose.
- Runtime behind: bundled with product.
- Prereqs: —
- Limitations: —
- Autonomy: L2–L3 (e.g. /autopilot monitors a PR and acts)
- Evidence: "/create-hook — Creates Cursor hooks and updates hooks.json"; "/loop — Runs a prompt or skill repeatedly at a specified interval."; "Agent may also use some built-in skills automatically."
- Confidence: HIGH

### skills-migration: /migrate-to-skills (rules/slash-commands deprecation path)
- Category: skills | rules
- Cursor Status: GA (shipped in 2.4); underlying legacy formats DEPRECATED-in-motion
- Source: https://cursor.com/docs/skills
- Date: fetch 2026-09-24
- What: Built-in skill converts (a) dynamic rules (alwaysApply:false, no globs — "Apply Intelligently") into standard skills; (b) user+workspace slash commands into skills with disable-model-invocation:true. Always-on rules, glob rules, and User Rules are NOT migrated.
- Invoke: `/migrate-to-skills` in chat.
- Runtime behind: agent-driven rewrite into .cursor/skills/.
- Prereqs: Cursor 2.4+.
- Limitations: only eligible formats converted.
- Autonomy: L2
- Evidence: "Cursor includes a built-in /migrate-to-skills skill in 2.4 that helps you convert existing dynamic rules and slash commands to skills."
- Confidence: HIGH

### skills-cloud-sync: Personal skills sync for Cloud Agents
- Category: skills
- Cursor Status: GA
- Source: https://cursor.com/docs/skills
- Date: fetch 2026-09-24
- What: Settings → Agents → "Sync Skills for Cloud Agents" copies ~/.cursor/skills/ content to cloud; private to the user; team admins can disable sync org-wide (Security & Identity). Only ~/.cursor/skills/ syncs.
- Invoke: manual toggle.
- Runtime behind: Cursor-managed copy to cloud env.
- Prereqs: Cloud Agents; team setting (default member choice).
- Limitations: project skills and ~/.agents/skills/ stay local; sync ≠ team publish.
- Autonomy: L0 (config)
- Evidence: "Turn on Sync Skills for Cloud Agents to use those same skills with Cloud Agents. Synced skills stay private to you."
- Confidence: HIGH

### skills-team-publish: Publish personal skill to team marketplace
- Category: skills | plugins
- Cursor Status: GA (Teams/Enterprise)
- Source: https://cursor.com/docs/plugins
- Date: fetch 2026-09-24
- What: Member publishes a ~/.cursor/skills/ skill to the team Default marketplace; Cursor packs it into a plugin, stores a copy in a team-hosted repo; installs are opt-in; author keeps sync/unpublish control; "one skill, one plugin" (referenced skills not bundled). Admins can turn off member publishing.
- Invoke: Customize → Skills → Publish.
- Runtime behind: plugin packaging + hosted repo.
- Prereqs: Teams/Enterprise.
- Limitations: publishing does not install for others.
- Autonomy: L0
- Evidence: "Cursor packs the skill into a plugin, stores a copy in a repository hosted for your team, and adds it to the Default marketplace."
- Confidence: HIGH

---

## SUBAGENTS

### subagents-core: Subagent delegation model
- Category: subagents
- Cursor Status: GA
- Source: https://cursor.com/docs/subagents
- Date: fetch 2026-09-24
- What: Agent delegates to specialized assistants; each subagent has its OWN context window, starts clean, works autonomously, returns final message to parent. No prior conversation history — parent must pack context into prompt. Available in editor, CLI, Cloud Agents.
- Invoke: automatic (Task tool) on complexity; explicit `/name` or natural mention ("use the verifier subagent").
- Runtime behind: Task tool spawning a nested agent loop.
- Prereqs: Task tool access in current mode.
- Limitations: startup overhead; ~N× token usage for N parallel; can be slower for trivial tasks.
- Autonomy: L3 (autonomous execution, parent-mediated)
- Evidence: "Each subagent operates in its own context window... and returns its result to the parent agent."; "Subagents start with a clean context."
- Confidence: HIGH

### subagents-builtin: Built-in subagents (Explore / Bash / Browser)
- Category: subagents
- Cursor Status: GA
- Source: https://cursor.com/docs/subagents
- Date: fetch 2026-09-24
- What: Three built-ins auto-used by Agent: Explore (codebase search, faster model, parallel searches), Bash (isolates verbose shell output), Browser (MCP browser tools, filters DOM noise). Designed from analysis of conversations hitting context limits; not user-configurable.
- Invoke: automatic when appropriate.
- Runtime behind: internal Task tool presets.
- Prereqs: —
- Limitations: "You don't need to configure these subagents."
- Autonomy: L3
- Evidence: "Cursor includes three built-in subagents: explore for codebase search, bash for running shell commands, and browser for browser automation via MCP."
- Confidence: HIGH

### subagents-custom: Custom subagents (file format & locations)
- Category: subagents
- Cursor Status: GA
- Source: https://cursor.com/docs/subagents
- Date: fetch 2026-09-24
- What: Markdown files with YAML frontmatter: name, description, model (inherit|model ID), readonly (bool, default false), is_background (bool, default false) + prompt body. Locations: `.cursor/agents/` (project), `~/.cursor/agents/` (user), plus Claude/Codex compat `.claude/agents/`, `.codex/agents/` (and user-level). Project > user on name conflict; `.cursor/` > `.claude/`/`.codex/`. Description drives auto-delegation ("use proactively"/"always use for" phrasing encouraged).
- Invoke: auto-delegation by description; explicit `/name`; natural mention.
- Runtime behind: registered as tools available to Agent ("Agent includes all custom subagents in its available tools").
- Prereqs: file on disk; vcs-recommended.
- Limitations: anti-pattern >dozens of generic subagents; recommendation 2–3 focused.
- Autonomy: L3
- Evidence: "readonly: true — the subagent runs with restricted write permissions (no file edits, no state-changing shell commands)."; "Project subagents take precedence when names conflict."
- Confidence: HIGH

### subagents-model: Subagent model configuration & overrides
- Category: subagents
- Cursor Status: GA
- Source: https://cursor.com/docs/subagents
- Date: fetch 2026-09-24
- What: `model: inherit` (default) or explicit ID (e.g. composer-2, gpt-5.6-sol). Model parameters via square brackets: `claude-opus-5[effort=high,context=300k]`, `composer-2.5[fast=false]`. Cursor falls back to a compatible model when: team admin blocked the model, legacy Max Mode requirement, plan limitation. On legacy request-based plans without Max Mode subagents run Composer regardless.
- Invoke: frontmatter.
- Runtime behind: model routing layer.
- Prereqs: plan/model availability.
- Limitations: silent fallback conditions listed above.
- Autonomy: L3
- Evidence: "Cursor honors the model field in your subagent frontmatter unless one of these conditions applies" (admin block / Max Mode / plan).
- Confidence: HIGH

### subagents-parallel-isolation: Parallel execution & isolated project copies
- Category: subagents
- Cursor Status: GA
- Source: https://cursor.com/docs/subagents
- Date: fetch 2026-09-24
- What: Multiple Task tool calls in one message → simultaneous subagents. Default: shared parent checkout (edit collisions possible). On request ("each in its own environment"): per-subagent isolated Git worktree with own branch on same machine, or dedicated cloud VM+clone; changes stay on branches until parent merges. `is_parallel_worker` flag visible to subagentStart hook. Whole-agent isolation separate (worktree / cloud subagent).
- Invoke: user phrasing or agent choice.
- Runtime behind: git worktrees / cloud VMs.
- Prereqs: git for worktrees.
- Limitations: "Running five subagents in parallel uses roughly five times the tokens."
- Autonomy: L3–L4 (parallel autonomous workers with merge step)
- Evidence: "Agent sends multiple Task tool calls in a single message, so subagents run simultaneously."; "an isolated Git worktree with a separate working directory on the same machine."
- Confidence: HIGH

### subagents-nesting: Nesting limit (since Cursor 2.5)
- Category: subagents
- Cursor Status: GA (since 2.5)
- Source: https://cursor.com/docs/subagents
- Date: fetch 2026-09-24
- What: Subagents can spawn child subagents within a limit: main agent and its direct subagents can launch subagents, but a subagent launched by another subagent cannot launch further ones (2-level tree). Requires Task tool access in current mode; hooks or tool policies can block spawning. SDK doc adds: every level reaches the same named subagents and custom tools.
- Invoke: automatic.
- Runtime behind: same subagent executor handed down.
- Prereqs: Cursor 2.5+.
- Limitations: depth=2 max; policy-gated.
- Autonomy: L3
- Evidence: "The main agent and its direct subagents can launch subagents, but a subagent launched by another subagent can't launch further ones."
- Confidence: HIGH

### subagents-lifecycle: Lifecycle: background, resume, failure, debugging
- Category: subagents
- Cursor Status: GA
- Source: https://cursor.com/docs/subagents
- Date: fetch 2026-09-24
- What: Foreground (blocks, immediate result) vs background (is_background:true; returns immediately, works independently). Each execution returns an agent ID resumable with full context ("Resume agent abc123..."). Background subagents write output/state to ~/.cursor/subagents/ (parent can read progress). On failure returns error status; parent can retry/resume/handle. SDK 1.0.31: background subagent results now return to parent as a follow-up turn on the same run.
- Invoke: frontmatter is_background / prompt.
- Runtime behind: state files + ID registry.
- Prereqs: —
- Limitations: —
- Autonomy: L3
- Evidence: "Background subagents write output to ~/.cursor/subagents/. The parent agent can read these files to check progress."; "Each subagent execution returns an agent ID."
- Confidence: HIGH

### subagents-tools: Tool inheritance & restriction
- Category: subagents
- Cursor Status: GA
- Source: https://cursor.com/docs/subagents (FAQ)
- Date: fetch 2026-09-24
- What: Subagents inherit ALL parent tools including configured MCP servers. Restriction only via readonly:true (no edits/state-changing shell), or blocking spawn via hooks/tool policies. Cloud subagents exception: MCP servers come from team config at cursor.com/agents, not local session.
- Invoke: inherited.
- Runtime behind: tool scoping per agent.
- Prereqs: —
- Limitations: no per-subagent custom tool allowlist in docs (SDK has top-level tools/disallowedTools instead).
- Autonomy: L3
- Evidence: "Subagents inherit all tools from the parent, including MCP tools from configured servers."
- Confidence: HIGH

### subagents-cloud: Cloud subagents (/in-cloud, /autopilot)
- Category: subagents
- Cursor Status: GA (documented); confidence MED on rollout completeness
- Source: https://cursor.com/docs/subagents
- Date: fetch 2026-09-24
- What: Hand off work from a local session to a cloud subagent on own VM+branch via `/in-cloud` (next task runs in cloud) or `/autopilot` (cloud agent iterates a PR to merge-ready). Runs from Agents Window in desktop app; uses repo-configured environment; team MCP config, not local.
- Invoke: slash commands.
- Runtime behind: cloud VM provisioning.
- Prereqs: Cloud Agents environment config.
- Limitations: cloud MCP sources differ; follow cloud model/capability rules.
- Autonomy: L4 (long-running, unattended) with PR guardrails
- Evidence: "Type /in-cloud and the next task you submit runs as a cloud subagent. It spins up its own VM and branch."
- Confidence: MED

---

## HOOKS

### hooks-core: Hooks framework
- Category: hooks
- Cursor Status: GA (released "earlier this year" per Dec 2025 blog)
- Source: https://cursor.com/docs/hooks
- Date: fetch 2026-09-24
- What: Observe/control/extend the agent loop with custom scripts. Defined in hooks.json (project or user) or installed via plugins. Spawned processes, stdio JSON both directions; run before/after agent-loop stages; can observe, block, or modify. Use cases: formatters, analytics, PII/secret scans, gating risky ops, controlling Task tool, session-start context injection. Debug via Customize Hooks tab + Hooks output channel; config hot-reloaded on save.
- Invoke: event-driven.
- Runtime behind: spawned processes; working dir depends on source (project root / ~/.cursor/ / enterprise dir / managed dir).
- Prereqs: trusted workspace for project hooks.
- Limitations: relative-path semantics differ per source.
- Autonomy: L3 (policy enforcement) — can drive L4 loops via followups
- Evidence: "Hooks are spawned processes that communicate over stdio using JSON in both directions."
- Confidence: HIGH

### hooks-events: Trigger event catalog (21 events, 3 categories)
- Category: hooks
- Cursor Status: GA
- Source: https://cursor.com/docs/hooks
- Date: fetch 2026-09-24
- What: Agent hooks (Cmd+K/Agent Chat): sessionStart, sessionEnd, preToolUse, postToolUse, postToolUseFailure, subagentStart, subagentStop, beforeShellExecution, afterShellExecution, beforeMCPExecution, afterMCPExecution, beforeReadFile, afterFileEdit, beforeSubmitPrompt, preCompact, stop, afterAgentResponse, afterAgentThought. Tab hooks: beforeTabFileRead, afterTabFileEdit. App lifecycle: workspaceOpen (fires on workspace open + folder change; can return pluginPaths).
- Invoke: hooks.json mapping event → array of definitions.
- Runtime behind: per-stage interception.
- Prereqs: —
- Limitations: per-event output fields vary (some fire-and-forget; preCompact observational only).
- Autonomy: L3
- Evidence: "These separate hook surfaces let you apply different policies to autonomous Tab operations, user-directed Agent operations, and workspace startup."
- Confidence: HIGH

### hooks-exec: Command vs prompt hooks; blocking & fail modes
- Category: hooks
- Cursor Status: GA (command); prompt type documented, rollout status UNKNOWN
- Source: https://cursor.com/docs/hooks
- Date: fetch 2026-09-24
- What: Command hooks: shell scripts, JSON via stdin/stdout. Exit 0 = use output; exit 2 = block (Claude-compatible); other codes = fail-open by default; `failClosed: true` blocks on crash/timeout/invalid output. Permission hooks (beforeShellExecution, beforeMCPExecution, beforeReadFile, beforeTabFileRead, subagentStart, preToolUse) block on invalid JSON/schema mismatch even when failClosed=false. Prompt hooks: LLM-evaluated natural-language condition returning {ok, reason}; fast model; optional model override; $ARGUMENTS placeholder. Outputs: permission allow/deny(/ask), updated_input rewriting, additional_context injection, followup_message auto-continue.
- Invoke: config.
- Runtime behind: process spawn / fast-model call.
- Prereqs: —
- Limitations: `"ask"` is accepted by the schema but not enforced for preToolUse today; ask unsupported for subagentStart (treated as deny).
- Autonomy: L3 (fail-open default noted as security caveat; failClosed for security-critical)
- Evidence: "Other exit codes - Hook failed, action proceeds (fail-open by default)"; "any deny wins over ask, and ask wins over allow, regardless of source."
- Confidence: HIGH

### hooks-matchers: Matchers (regex filters)
- Category: hooks
- Cursor Status: GA
- Source: https://cursor.com/docs/hooks
- Date: fetch 2026-09-24
- What: Per-definition regex; empty or "*" matches all. Tested against: tool type for preToolUse/postToolUse (Shell, Read, Write, Grep, Delete, Task, `MCP:<tool_name>`); subagent type for subagentStart/Stop (generalPurpose, explore, shell...); full shell command text for before/afterShellExecution; fixed sentinel values (Read/Write/TabRead/TabWrite/UserPromptSubmit/Stop/AgentResponse/AgentThought) for others.
- Invoke: `"matcher"` field.
- Runtime behind: regex test before spawn.
- Prereqs: —
- Limitations: —
- Autonomy: L3
- Evidence: "beforeShellExecution: The matcher runs against the shell command string."
- Confidence: HIGH

### hooks-config-sources: Config sources, merge & priority
- Category: hooks
- Cursor Status: GA (Enterprise features on Enterprise plan)
- Source: https://cursor.com/docs/hooks
- Date: fetch 2026-09-24
- What: Sources: Enterprise (MDM: /Library/Application Support/Cursor/hooks.json, /etc/cursor/hooks.json, C:\ProgramData\Cursor\hooks.json) → Team (dashboard, cloud-distributed, Enterprise) → Project (.cursor/hooks.json, vcs, trusted workspace) → User (~/.cursor/hooks.json). All matching hooks run; merge: deny > ask > allow regardless of source; user_message/agent_message concatenated; other fields last-response-wins with lower priority overriding.
- Invoke: automatic.
- Runtime behind: multi-source loader + watcher.
- Prereqs: trust for project hooks.
- Limitations: user-level hooks NOT available in cloud agents.
- Autonomy: L3
- Evidence: "Priority order (highest to lowest): Enterprise → Team → Project → User."
- Confidence: HIGH

### hooks-enterprise: Team/Enterprise distribution
- Category: hooks
- Cursor Status: GA (Enterprise)
- Source: https://cursor.com/docs/hooks
- Date: fetch 2026-09-24
- What: Distribution channels: project hooks via version control; MDM file placement; Enterprise cloud distribution from web dashboard — auto-sync to all members every thirty minutes, OS targeting, centralized management. Team hooks and enterprise-managed hooks also run in cloud agents and self-hosted workers.
- Invoke: dashboard config.
- Runtime behind: cloud sync.
- Prereqs: Enterprise plan.
- Limitations: contact-sales gated.
- Autonomy: L3 (org policy)
- Evidence: "Automatic synchronization to all team members (every thirty minutes)"; "Operating system targeting for platform-specific hooks."
- Confidence: HIGH

### hooks-loop-limit: stop/subagentStop follow-up loops
- Category: hooks
- Cursor Status: GA
- Source: https://cursor.com/docs/hooks
- Date: fetch 2026-09-24
- What: stop hook fires when agent loop ends; optional followup_message auto-submitted as next user message (iterate-until-goal loops). subagentStop followup_message only consumed when status completed. `loop_limit` per script: default 5 auto follow-ups, null = unlimited. loop_count exposed in input.
- Invoke: hook output field.
- Runtime behind: automatic message submission.
- Prereqs: —
- Limitations: loop limit is the only guardrail; unlimited when set to null.
- Autonomy: L4-capable (self-perpetuating agent loops, capped by default 5)
- Evidence: "The default limit is 5 auto follow-ups per script, configurable via the loop_limit option."
- Confidence: HIGH

### hooks-schema: Common schema, env vars, session env
- Category: hooks
- Cursor Status: GA
- Source: https://cursor.com/docs/hooks
- Date: fetch 2026-09-24
- What: All hooks receive common input: conversation_id, generation_id, model, model_id, model_params, hook_event_name, cursor_version, workspace_roots, user_email, transcript_path. Env: CURSOR_PROJECT_DIR, CURSOR_VERSION, CURSOR_USER_EMAIL, CURSOR_TRANSCRIPT_PATH, CURSOR_CODE_REMOTE, CLAUDE_PROJECT_DIR (compat). sessionStart can return env vars propagated to all later hook executions + additional_context.
- Invoke: stdin JSON.
- Runtime behind: environment injection.
- Prereqs: transcripts enabled for transcript path.
- Limitations: —
- Autonomy: L3
- Evidence: "Session-scoped environment variables from sessionStart hooks are passed to all subsequent hook executions."
- Confidence: HIGH

### hooks-claude-compat: Third-party (Claude Code) hooks
- Category: hooks
- Cursor Status: GA
- Source: https://cursor.com/docs/reference/third-party-hooks
- Date: fetch 2026-09-24
- What: Loads Claude Code hooks from .claude/settings.local.json → .claude/settings.json → ~/.claude/settings.json when Settings → Agents → Third-Party Imports ("Include Third-Party Plugins, Skills, and Other Configs", on by default) is enabled. Merges below Cursor sources in priority. Maps event names (PreToolUse→preToolUse etc.), supports nested hookSpecificOutput and flat formats, exit-code-2 blocking, tool-name mapping (Bash→Shell, Edit→Write). Prompt-type hooks also supported.
- Invoke: automatic when enabled.
- Runtime behind: adapter mapping layer.
- Prereqs: third-party imports setting.
- Limitations: no Notification / PermissionRequest events; no Glob tool mapping; native-only features: subagentStart hook, loop_limit, dashboard distribution.
- Autonomy: L3
- Evidence: "Cursor supports both Claude Code's nested hookSpecificOutput response format and the older flat response format."
- Confidence: HIGH

### hooks-cloud: Hooks on Cloud Agents & self-hosted workers
- Category: hooks
- Cursor Status: GA
- Source: https://cursor.com/docs/hooks
- Date: fetch 2026-09-24
- What: Cloud agents run project hooks (.cursor/hooks.json) plus team/enterprise hooks (Enterprise). Supported set excludes sessionStart/sessionEnd (deferred/no editor-lifetime boundary), before/afterMCPExecution, Tab hooks, workspaceOpen. Command-based hooks ONLY in cloud (prompt hooks need auth wiring unavailable there). Early read-only turns skip hooks. Self-hosted workers run same command-based hooks; sessionStart/End fire on worker claim/release.
- Invoke: automatic.
- Runtime behind: cloud worker execution.
- Prereqs: repo hooks file.
- Limitations: no user-level (~/.cursor) hooks in cloud.
- Autonomy: L3
- Evidence: "Cloud agents run command-based hooks only."
- Confidence: HIGH

### hooks-partners: Partner integrations ecosystem
- Category: hooks
- Cursor Status: GA (partner program)
- Source: https://cursor.com/blog/hooks-partners + docs/hooks Partner Integrations
- Date: 2025-12-22 (blog); fetch 2026-09-24 (docs)
- What: Vendors built on hooks: MintMCP, Oasis Security, Runlayer (MCP governance); Corridor, Semgrep (code security w/ regenerate-until-clean loop); Endor Labs (dependency/supply-chain interception); Snyk Evo Agent Guard (prompt-injection/dangerous-call prevention); 1Password (secrets mounted before shell exec). Submission form open.
- Invoke: install partner hooks.
- Runtime behind: hook events (esp. beforeMCPExecution, beforeShellExecution, afterFileEdit).
- Prereqs: vendor tooling.
- Limitations: —
- Autonomy: L3 (security guardrails)
- Evidence: "Semgrep automatically scans AI-generated code for vulnerabilities with real-time feedback to regenerate code until security issues are resolved."
- Confidence: HIGH

---

## MCP

### mcp-core: MCP servers & transports
- Category: mcp
- Cursor Status: GA
- Source: https://cursor.com/docs/mcp
- Date: fetch 2026-09-24
- What: Connect external tools/data. Transports: stdio (local, single user, manual auth), SSE, Streamable HTTP (local/remote, multi-user, OAuth). Servers in any language that prints to stdout or serves HTTP. Manage via Customize or mcp.json; per-server on/off toggle; failed servers isolated (others keep working); MCP Logs output channel.
- Invoke: agent auto-uses tools when relevant (incl. Plan Mode); by name or description.
- Runtime behind: protocol client (stdio process or HTTP/SSE).
- Prereqs: server config.
- Limitations: envFile only for stdio.
- Autonomy: L2 default (approval) → L3 with allowlist/run-modes
- Evidence: "Cursor supports three transport methods: stdio, SSE, Streamable HTTP."; "Cursor isolates server failures to prevent one server from affecting others."
- Confidence: HIGH

### mcp-protocol: Protocol capabilities incl. MCP Apps
- Category: mcp
- Cursor Status: GA; MCP Apps extension support noted (MED confidence on maturity)
- Source: https://cursor.com/docs/mcp
- Date: fetch 2026-09-24
- What: Supported protocol features: Tools, Prompts (templated workflows), Resources (readable data sources), Roots (server-initiated boundary inquiries), Elicitation (server-initiated user requests), Apps extension (interactive UI views returned by MCP tools, progressive-enhancement fallback to plain tool output). Images can be returned base64 and attached to chat.
- Invoke: protocol.
- Runtime behind: host implementation.
- Prereqs: —
- Limitations: —
- Autonomy: L2
- Evidence: "Cursor supports the MCP Apps extension. MCP tools can return interactive UI along with standard tool output."
- Confidence: MED

### mcp-config: mcp.json locations & interpolation
- Category: mcp
- Cursor Status: GA
- Source: https://cursor.com/docs/mcp
- Date: fetch 2026-09-24
- What: Project `.cursor/mcp.json`, global `~/.cursor/mcp.json`. Interpolation in command/args/env/url/headers: ${env:NAME}, ${userHome}, ${workspaceFolder}, ${workspaceFolderBasename}, ${pathSeparator}/${/}. stdio fields: type, command, args, env, envFile.
- Invoke: config.
- Runtime behind: variable resolution.
- Prereqs: —
- Limitations: remote servers don't support envFile.
- Autonomy: L0
- Evidence: "Cursor resolves variables in these fields: command, args, env, url, and headers."
- Confidence: HIGH

### mcp-auth: Authentication (OAuth + static OAuth + env)
- Category: mcp
- Cursor Status: GA
- Source: https://cursor.com/docs/mcp
- Date: fetch 2026-09-24
- What: Env-var auth by default; OAuth supported. Static OAuth client credentials in mcp.json `auth` object (CLIENT_ID, optional CLIENT_SECRET, scopes; scope discovery via /.well-known/oauth-authorization-server) for providers without dynamic client registration. Fixed redirect URLs: https://www.cursor.com/agents/mcp/oauth/callback (web/agents) and http://localhost:8787/callback (desktop); server identified via state param. auth values interpolate ${env:...}.
- Invoke: OAuth flow on install/use.
- Runtime behind: OAuth 2.0 client.
- Prereqs: provider app registration.
- Limitations: redirect URLs fixed.
- Autonomy: L0
- Evidence: "Cursor uses fixed OAuth redirect URLs for MCP servers."
- Confidence: HIGH

### mcp-approval: Tool approval & run modes
- Category: mcp
- Cursor Status: GA
- Source: https://cursor.com/docs/mcp
- Date: fetch 2026-09-24
- What: "Cursor asks for approval before using MCP tools by default" (argument preview via arrow). MCP follows same Run Modes as terminal commands; in Auto-review mode allowlisted MCP tools run immediately, rest routed through classifier.
- Invoke: chat.
- Runtime behind: permission system.
- Prereqs: —
- Limitations: —
- Autonomy: L2 default
- Evidence: "Cursor asks for approval before using MCP tools by default."
- Confidence: HIGH

### mcp-enterprise: Enterprise MCP policy (allowlist, network, user MCPs)
- Category: mcp
- Cursor Status: GA (Enterprise)
- Source: https://cursor.com/docs/mcp
- Date: fetch 2026-09-24
- What: MCP Allowlist (Team Settings > MCP Configuration): command-pattern entries (stdio), URL-entry patterns (remote) with tool allowlists (empty = all tools). Network controls: remote URLs restricted to patterns; local servers per-server network mode (allow all / allowlist / deny all / no sandbox). User MCP extensions: admins may allow user-defined servers outside patterns; User MCP Network Denylist blocks destinations.
- Invoke: dashboard.
- Runtime behind: policy engine.
- Prereqs: Enterprise.
- Limitations: allowlist approves config, does not distribute/install.
- Autonomy: L3 (policy)
- Evidence: "Enterprise admins can control which MCP servers users may run from the Cursor dashboard."
- Confidence: HIGH

### mcp-team: Team MCP distribution & Default marketplace
- Category: mcp | plugins
- Cursor Status: GA (Teams/Enterprise)
- Source: https://cursor.com/docs/mcp + docs/plugins
- Date: fetch 2026-09-24
- What: Team MCP servers configured under Dashboard > Plugins & MCPs, available to Cloud Agents; can be linked into the Default team marketplace so teammates install/configure in Agent Window, IDE, CLI. Linking ≠ installing for everyone. Removing linked plugin/marketplace can delete the Team MCP server (documented hazard).
- Invoke: admin flow.
- Runtime behind: marketplace plumbing.
- Prereqs: Teams/Enterprise.
- Limitations: per-developer auth still needed.
- Autonomy: L0
- Evidence: "Admins still control marketplace access and plugin installation modes. Each developer may also need to authenticate."
- Confidence: HIGH

### mcp-install-links: Deeplink install
- Category: mcp
- Cursor Status: GA
- Source: https://cursor.com/docs/mcp/install-links
- Date: fetch 2026-09-24
- What: `cursor://anysphere.cursor-deeplink/mcp/install?name=$NAME&config=$BASE64_ENCODED_CONFIG` — same format as mcp.json; click/paste into browser → Cursor prompts install; docs now steer sharers toward plugins instead.
- Invoke: deeplink.
- Runtime behind: protocol handler.
- Prereqs: —
- Limitations: single server per link.
- Autonomy: L0 (user confirms install)
- Evidence: "MCP servers can be installed with Cursor deeplinks."
- Confidence: HIGH

---

## PLUGINS

### plugins-cursor: Cursor Plugins (.cursor-plugin/plugin.json)
- Category: plugins
- Cursor Status: GA (Marketplace launched Feb 2026 per blog)
- Source: https://cursor.com/docs/plugins + docs/reference/plugins
- Date: fetch 2026-09-24
- What: Bundle rules (.mdc), skills, agents, commands (.md/.mdc/.markdown/.txt), hooks (hooks/hooks.json), MCP servers (mcp.json), and variables into one distributable directory with `.cursor-plugin/plugin.json` manifest (name required; description/version/author/logo/keywords...). Automatic folder-based discovery per component when manifest omits paths (manifest field REPLACES default folder). Root SKILL.md = single-skill plugin. Local dev in ~/.cursor/plugins/local; marketplace plugin with same name takes precedence; symlinks only resolve inside that folder.
- Invoke: Customize → Install (project or user scope).
- Runtime behind: manifest parser + component discovery.
- Prereqs: —
- Limitations: manifest paths must be relative (no .., no absolute).
- Autonomy: L0 (distribution vehicle; content determines autonomy)
- Evidence: "Plugins package rules, skills, agents, commands, MCP servers, and hooks into distributable bundles."
- Confidence: HIGH

### plugins-agent-standard: Agent Plugins open standard
- Category: plugins
- Cursor Status: GA (spec-conformant plugins load)
- Source: https://cursor.com/docs/plugins + docs/reference/plugins
- Date: fetch 2026-09-24
- What: Open, vendor-neutral spec (agent-plugins.org, GitHub spec): root `plugin.json` with $schema https://agent-plugins.org/schemas/1.0.0/plugin.schema.json; packages skills + MCP servers. Cursor loads spec-conformant plugins. Cursor does NOT expand standard's ${PLUGIN_ROOT}/${PLUGIN_DATA} in mcp.json — use ${CURSOR_PLUGIN_ROOT} (also ${CLAUDE_PLUGIN_ROOT} accepted) in command/args/env/cwd. Cursor Plugins continue "in parallel" with extra components.
- Invoke: same install flow (format auto-detected from manifest).
- Runtime behind: dual-format loader.
- Prereqs: —
- Limitations: variable expansion divergence from standard.
- Autonomy: L0
- Evidence: "Cursor supports Agent Plugins alongside Cursor Plugins."; "Cursor does not expand the standard's ${PLUGIN_ROOT} and ${PLUGIN_DATA} variables in mcp.json."
- Confidence: HIGH

### plugins-marketplace: Cursor Marketplace & review security
- Category: plugins
- Cursor Status: GA
- Source: https://cursor.com/docs/plugins + blog/marketplace + blog/new-plugins
- Date: 2026-02-17 (launch blog), 2026-03-11 (30+ new plugins); fetch 2026-09-24
- What: Official marketplace at cursor.com/marketplace; plugins distributed as Git repos, submitted at cursor.com/marketplace/publish; every plugin + update manually reviewed; all plugins must be open source. Community: cursor.directory. Launch set: Amplitude, AWS, Figma, Linear, Stripe...; Mar 2026 adds Atlassian, Datadog, GitLab, Glean, Hugging Face, monday.com, PlanetScale; Cursor Team Kit (CI/review/testing internal workflows). Blog insight: "MCPs + skills bundles > MCPs alone" for agent success. Prebuilt plugin canvases (Hex Canvas, Atlassian Canvas) as shared setup templates.
- Invoke: browse/install in Customize.
- Runtime behind: marketplace indexing (re-index at most once per 10 min with Auto Refresh).
- Prereqs: —
- Limitations: manual review = submission latency.
- Autonomy: L0
- Evidence: "Every plugin is manually reviewed before it's listed."; "Plugins provide that by bundling capabilities like MCPs with skills."
- Confidence: HIGH

### plugins-team-marketplaces: Team marketplaces & install modes
- Category: plugins
- Cursor Status: GA (Teams: up to 1; Enterprise: unlimited)
- Source: https://cursor.com/docs/plugins
- Date: fetch 2026-09-24
- What: Distribute Agent + Cursor Plugins via team marketplace: Import from Repo (GitHub, GitLab, Bitbucket, Azure DevOps) or create from scratch; Marketplace Access restricted to Organization Groups (SCIM sync); install modes per plugin: Default Off / Default On (opt-out) / Required (cannot uninstall); members may publish personal skills (admin toggle "Allow Members to Publish"); "Serve marketplace from Cursor" = Cursor keeps synced copy for GitHub-imported marketplaces (no GitHub access needed downstream); Auto Refresh via Cursor GitHub App.
- Invoke: Dashboard → Plugins & MCPs.
- Runtime behind: repo sync + policy.
- Prereqs: Teams/Enterprise.
- Limitations: 10 MB marketplace manifest cap; non-GitHub imports always serve from source repo.
- Autonomy: L0–L2 (Required mode pushes tools org-wide)
- Evidence: "Required: The plugin is always installed and cannot be uninstalled."
- Confidence: HIGH

### plugins-variables: Plugin variables (secret injection schema)
- Category: plugins
- Cursor Status: GA
- Source: https://cursor.com/docs/reference/plugins
- Date: fetch 2026-09-24
- What: Manifest `variables` = JSON Schema (fixed keyword set) declaring variable NAMES for tokens/connection strings; plugin stores no secret values; values set by users/team admins in dashboard (Plugins → Configure) at install or later; substituted into ${VAR} placeholders in mcp.json etc.
- Invoke: dashboard configuration.
- Runtime behind: placeholder substitution.
- Prereqs: —
- Limitations: "Do not put secret values in the plugin repo."
- Autonomy: L0
- Evidence: "The plugin only defines the schema; it does not include the secret values themselves."
- Confidence: HIGH

### plugins-multi-repo: Multi-plugin repositories (.cursor-plugin/marketplace.json)
- Category: plugins
- Cursor Status: GA
- Source: https://cursor.com/docs/reference/plugins
- Date: fetch 2026-09-24
- What: One Git repo exposes many plugins via `.cursor-plugin/marketplace.json` (name, owner, plugins[] with per-entry source/manifest overrides). Resolution: per-plugin .cursor-plugin/plugin.json merged with marketplace entry (manifest wins), then component discovery inside plugin dir.
- Invoke: import repo as marketplace.
- Runtime behind: marketplace manifest parser.
- Prereqs: —
- Limitations: manifest ≤10 MB.
- Autonomy: L0
- Evidence: "A single Git repository can contain multiple plugins using a marketplace manifest."
- Confidence: HIGH

---

## EXTENSION API (VS Code extensions in Cursor)

### extapi-overview: vscode.cursor namespace
- Category: extension-api
- Cursor Status: GA (narrow surface); overall VS Code-extension parity via VS Code codebase
- Source: https://cursor.com/docs/extension-api
- Date: fetch 2026-09-24
- What: Cursor exposes extension APIs under `vscode.cursor` for programmatic configuration from VS Code extensions. Two namespaces only (documented): mcp and plugins. Cursor is a VS Code fork: one-click import transfers Extensions, Themes, Settings, Keybindings; regular rebases onto VS Code.
- Invoke: import from extension code.
- Runtime behind: in-editor extension host.
- Prereqs: VS Code extension.
- Limitations: no documented APIs for rules/skills/agents control; only registration surfaces.
- Autonomy: L0 (config automation)
- Evidence: "Cursor exposes extension APIs under vscode.cursor for programmatic configuration."; "This will transfer your: Extensions, Themes, Settings, Keybindings."
- Confidence: HIGH

### extapi-mcp-register: vscode.cursor.mcp.registerServer / unregisterServer
- Category: extension-api | mcp
- Cursor Status: GA
- Source: https://cursor.com/docs/extension-api
- Date: fetch 2026-09-24
- What: Runtime MCP registration without editing mcp.json — StdioServerConfig (command/args/env) or RemoteServerConfig (url + optional headers). Intended for enterprise onboarding/automated setup. unregisterServer by name.
- Invoke: API call.
- Runtime behind: in-memory server registry.
- Prereqs: extension.
- Limitations: persistence semantics not documented (UNKNOWN whether survives restart).
- Autonomy: L0
- Evidence: "Register MCP servers programmatically using vscode.cursor.mcp.registerServer()."
- Confidence: HIGH

### extapi-plugin-paths: vscode.cursor.plugins.registerPath / unregisterPath
- Category: extension-api | plugins
- Cursor Status: GA
- Source: https://cursor.com/docs/extension-api
- Date: fetch 2026-09-24
- What: Register a directory as a plugin source at runtime; manifest optional — automatic folder-based discovery of rules/, skills/, agents/, commands/, mcp.json, hooks/hooks.json. Enables extensions to ship bundled agent components ("to inject skills you can register a directory that contains a skills/ subfolder; no manifest needed").
- Invoke: API call on activation.
- Runtime behind: plugin path registry + discovery.
- Prereqs: extension.
- Limitations: dispose pattern recommended in examples.
- Autonomy: L0
- Evidence: "Cursor discovers and loads any valid plugins in this directory."
- Confidence: HIGH

---

## SDKs & BRIDGE

### sdk-ts: Cursor TypeScript SDK (@cursor/sdk)
- Category: sdk
- Cursor Status: BETA ("public beta for all users", Apr 2026 blog; changelog at 1.0.31 with rapid additive releases)
- Source: https://cursor.com/docs/sdk/typescript + blog/typescript-sdk
- Date: blog 2026-04-29; docs fetch 2026-09-24
- What: Programmatic agents on the same runtime/harness/models as desktop/CLI/web. `Agent.create({local:{cwd}}|{cloud:{repos,autoCreatePR}})`; Run handle: stream()/wait()/cancel()/steer()/conversation(); agent.prompt() one-shot; resume by agent ID; Agent.getRun for cloud re-attach; artifacts (cloud only); getUsage. Model selection incl. Cursor Router modes (auto/cost-balanced etc.) and per-model params; per-run model override sticky. systemPrompt replacement (gated per account, local only). Reload re-reads hooks/MCP/subagents config.
- Invoke: npm install @cursor/sdk.
- Runtime behind: local agent loop or Cloud Agents VM runtime; all inference via Cursor hosted models.
- Prereqs: CURSOR_API_KEY (user or service-account key; Team Admin keys NOT supported).
- Limitations: "The Cursor SDK is an agent SDK, not a standalone model-inference or chat-completions API" (no raw model endpoint documented).
- Autonomy: L4 headless by default (see sdk-sandbox)
- Evidence: "The Cursor SDK is now available in public beta for all users."; "Agents launched through the SDK benefit from the same harness that powers Cursor."
- Confidence: HIGH

### sdk-python: Cursor Python SDK (cursor-sdk)
- Category: sdk
- Cursor Status: BETA (same program as TS)
- Source: https://cursor.com/docs/sdk/python
- Date: fetch 2026-09-24
- What: pip install cursor-sdk (Python ≥3.10); sync + async clients (Agent/AsyncAgent, Run/AsyncRun, CursorClient/Client, AsyncClient); typed dataclasses; same local/cloud runtimes and concepts as TS. Bundles the sdk-bridge binary (cursor-sdk-bridge on PATH). Quickstart with context-manager disposal.
- Invoke: pip install.
- Runtime behind: local loop via bundled bridge / cloud VMs.
- Prereqs: CURSOR_API_KEY.
- Limitations: parity noted as slightly behind TS for some features (e.g. steer TS-local-only per changelog).
- Autonomy: L4
- Evidence: "The cursor-sdk package lets you call Cursor's agent from your own Python code."
- Confidence: HIGH

### sdk-custom-tools: SDK custom tools (local.customTools)
- Category: sdk | mcp
- Cursor Status: BETA
- Source: https://cursor.com/docs/sdk/typescript
- Date: fetch 2026-09-24
- What: Expose in-process functions as tools without a separate MCP server — SDK registers them as an MCP server named `custom-user-tools`; discovered/called through the same MCP path; reach subagents incl. nested. Definition: description, inputSchema, outputSchema (advertised, not validated), MCP annotations (readOnlyHint, destructiveHint, idempotentHint...), execute callback. Deny rules and sandbox still apply, but custom tools SKIP interactive approval. Local agents only (cloud throws ConfigurationError).
- Invoke: local.customTools on Agent.create or per send().
- Runtime behind: internal MCP bridge into your process.
- Prereqs: TS/Python SDK local run.
- Limitations: local-only; per-send replaces creation-time set.
- Autonomy: L4 (no approval by design)
- Evidence: "the SDK registers them as an MCP server named custom-user-tools"; "custom tools skip interactive approval."
- Confidence: HIGH

### sdk-tool-restriction: SDK toolset restriction (tools / disallowedTools)
- Category: sdk
- Cursor Status: BETA (since 1.0.27)
- Source: https://cursor.com/docs/sdk/typescript + docs/sdk/changelog
- Date: fetch 2026-09-24
- What: `tools` allowlists built-ins (["read","grep","glob","ls"] read-only agent; [] = text-only model); `disallowedTools` removes while keeping rest incl. future tools. Names: public tool names, capability groups "shell"/"mcp", raw proto names; unknown throws ConfigurationError. Deny wins. Disallowing "task" prevents subagents; disallowing "mcp" also removes custom tools. Local agents only; not persisted (re-pass on resume).
- Invoke: Agent.create/Agent.resume options.
- Runtime behind: tool gating layer.
- Prereqs: SDK local run.
- Limitations: local only "for now".
- Autonomy: L4 with explicit guardrails
- Evidence: "tools: [] offers no built-in tools, so the model can only respond with text."; "Disallowing \"task\" prevents subagents."
- Confidence: HIGH

### sdk-sandbox: SDK sandbox & auto-review (headless safety)
- Category: sdk
- Cursor Status: BETA
- Source: https://cursor.com/docs/sdk/typescript
- Date: fetch 2026-09-24
- What: Default headless local agent runs tool calls with NO approval ("Quickstart approves tool calls automatically"). `local.sandboxOptions.enabled: true` → writes limited to cwd/temp/sandbox.json paths; shell inside platform sandbox (bubblewrap Linux, seatbelt macOS, bundled helper); outbound network DENIED by default, allowlist via .cursor/sandbox.json or ~/.cursor/sandbox.json. `local.autoReview: true` routes calls through the IDE's Auto-review classifier (permissions.json autoRun block); blocked calls denied, not escalated. Cloud runs always isolated VMs (sandboxOptions N/A). Docs: classifier is "not a security boundary".
- Invoke: Agent.create options.
- Runtime behind: OS sandbox + classifier service.
- Prereqs: platform sandbox support else ConfigurationError.
- Limitations: strict control requires combining sandbox + allowlist.
- Autonomy: L4 default; L3 when sandboxed
- Evidence: "The default local agent runs tool calls (shell, edit, write, etc.) without asking for approval"; "Outbound network is denied by default."
- Confidence: HIGH

### sdk-bridge: SDK Bridge (other languages)
- Category: sdk
- Cursor Status: GA-supported contract ("Cursor publishes and supports the sdk.v1 contract and bridge binaries"); adapters themselves unsupported
- Source: https://cursor.com/docs/sdk/bridge
- Date: fetch 2026-09-24
- What: Small local server embedding the TypeScript SDK; exposes same agent surface over Connect/protobuf `sdk.v1` on loopback HTTP/1.1 (classic gRPC over HTTP/2 will NOT connect). For Go/Rust/Java/C# adapters. Services: sdk_agent_service (create/resume/send/stream/artifacts/usage), sdk_cursor_service (identity/models/repos), sdk_bridge_control_service (Ping/version/shutdown/tool-callback registration), plus adapter-hosted callback services for custom tools and custom agent stores. Auth: Cursor API key + per-process bridge bearer token. Versioning: additive; sdk.v2 path for breaking. Python SDK talks to a bundled copy.
- Invoke: spawn cursor-sdk-bridge binary (GitHub releases; darwin/linux/win32 × x64/arm64).
- Runtime behind: Connect protocol over HTTP/1.1; unary POSTs + streamed responses.
- Prereqs: API key; pinned release.
- Limitations: "Adapters in other languages are not first-party SDKs."
- Autonomy: L4 (same headless semantics as TS SDK)
- Evidence: "The SDK Bridge is a small local server that embeds the TypeScript SDK and exposes the same agent surface over a stable Connect/protobuf protocol."
- Confidence: HIGH

### sdk-cloud-api: Cloud Agents API (REST)
- Category: sdk
- Cursor Status: GA (referenced as stable surface; detailed API doc outside this track's corpus)
- Source: https://cursor.com/docs/sdk/bridge (decision table), blog/typescript-sdk
- Date: fetch 2026-09-24
- What: "You only need cloud agents over HTTP, with no local agent runtime" — REST path for cloud agents; SDK cloud mode "uses our updated Cloud Agents API" so runs surface in Agents Window/web; OAuth redirect for MCP on web/agents is part of this surface.
- Invoke: HTTP.
- Runtime behind: cloud VMs.
- Prereqs: API key.
- Limitations: not covered in this track's files beyond references (UNKNOWN details).
- Autonomy: L4
- Evidence: "Cloud Agents API — You only need cloud agents over HTTP, with no local agent runtime."
- Confidence: MED

---

## HARNESS COMPOSITION & CROSS-MECHANISM

### harness-composition: How rules/skills/subagents/hooks/MCP/plugins compose
- Category: rules | skills | subagents | hooks | mcp | plugins | sdk
- Cursor Status: GA
- Source: https://cursor.com/docs/rules, /skills, /subagents, /hooks, /plugins, /sdk/typescript, blog/typescript-sdk
- Date: fetch 2026-09-24
- What: One agent loop, layered inputs: (1) RULES inject persistent guidance at context start (Team > Project > User; AGENTS.md nested). (2) SKILLS are discovered at startup and either agent-selected (description relevance, paths scoping) or user-invoked — they can carry scripts the agent executes with its normal tools. (3) SUBAGENTS are registered from .cursor/agents/*.md as available tools; parent delegates via Task tool; nesting depth 2; hooks can gate spawn (subagentStart matcher). (4) HOOKS wrap the loop (before/after tool, shell, MCP, read, edit, prompt, stop...) with allow/deny/modify/observe + followup loops. (5) MCP supplies external tools/prompts/resources; approval default; enterprise allowlist. (6) PLUGINS are the distribution container bundling all of the above; workspaceOpen hook can even return plugin paths to load. (7) SDK reproduces the same harness headlessly: "MCP servers... Skills... Hooks... Subagents" all listed as harness features SDK agents inherit. Meta-composition: built-in skills (/create-rule, /create-hook, /create-skill, /create-subagent) let the agent author the extension mechanisms themselves; /migrate-to-skills converges legacy formats onto skills.
- Invoke: filesystem + config + code.
- Runtime behind: single harness shared by IDE, CLI, Cloud Agents, SDK.
- Prereqs: —
- Limitations: rules are prompt-only (no enforcement); hooks are the only hard gate; subagents have depth limit.
- Autonomy: L2–L4 depending on configuration (guardrails: hooks failClosed, sandbox, readonly, tool allowlists, Required plugins, model allowlists)
- Evidence: "Plugins bundle capabilities like MCP servers, skills, subagents, rules, and hooks that extend agents"; "Subagents: Delegate subtasks to named subagents... which the main agent spawns via the Agent tool" (SDK blog).
- Confidence: HIGH

### harness-limits: Documented limits & concurrency
- Category: hooks | subagents | sdk | plugins
- Cursor Status: GA
- Source: corpus docs listed per item
- Date: fetch 2026-09-24
- What: Subagent nesting: depth 2 (since 2.5). Hook loop_limit: default 5 (stop & subagentStop), null = unlimited; per-script. Hook timeout: per-script seconds, "platform default" otherwise. Team marketplace: Teams=1, Enterprise=unlimited; marketplace manifest ≤10 MB; re-index ≤ once/10 min; enterprise hook sync every 30 min. Plugin repos: relative paths only. Rules: recommended <500 lines. Parallel subagents: ~linear token multiplier; SDK cloud 409 agent_busy on concurrent sends (local.force to expire). Model params: effort/context/fast per model.
- Invoke: —
- Runtime behind: —
- Prereqs: —
- Limitations: enumerated above; timeout defaults undocumented.
- Autonomy: n/a
- Evidence: "Per-script loop limit for stop/subagentStop hooks. null means no limit. Default is 5."
- Confidence: HIGH

### harness-security: Security model per mechanism
- Category: rules | skills | subagents | hooks | mcp | plugins | sdk
- Cursor Status: GA
- Source: corpus docs listed per item
- Date: fetch 2026-09-24
- What: Rules: advisory only — "AI guidance should not be your only security control." Skills: run with agent's tools (no extra gate); team sync gated by admin; publishing opt-in. Subagents: readonly flag; tool-policy/hooks gating of Task; cloud MCP from team config. Hooks: the hard policy layer — deny>ask>allow merge, exit-2 block, failClosed for security-critical, fail-open otherwise; trusted-workspace requirement for project hooks; MDM/enterprise distribution; partner security vendors (Semgrep, Snyk, Endor Labs, 1Password...). MCP: default approval prompt; run modes/auto-review classifier; enterprise allowlist + per-server network modes + user-MCP denylist; OAuth fixed redirects; "verify the source" guidance. Plugins: manual review + open-source requirement + update review; local plugin imports admin-controlled off-by-default on Enterprise; symlink containment. SDK: headless auto-approve default → must opt into sandbox/autoReview; custom tools bypass approval; tool allowlists; cloud VM isolation; service-account key scope; Privacy Mode carries over.
- Invoke: —
- Runtime behind: —
- Prereqs: —
- Limitations: prompt-hook/ask semantics incomplete (preToolUse "ask" not enforced).
- Autonomy: guardrail inventory for L3/L4 operation
- Evidence: "While this is supported, AI guidance should not be your only security control."; "The classifier is best-effort convenience, not a security boundary."
- Confidence: HIGH

---

## SUMMARY TABLES

Counts by category: rules 9, skills 9, subagents 9, hooks 10, mcp 9, plugins 6, extension-api 3, sdk 7 (incl. bridge/cloud-api + 2 cross-cutting SDK), composition 3 → **57 capabilities** (some entries double-tagged).

Strategic top-10 for ME2-OS parity (opinion of this track):
1. harness-composition — single harness shared across IDE/CLI/Cloud/SDK.
2. subagents-core + nesting/parallel isolation (worktree-per-subagent swarm).
3. hooks-events + blocking semantics (the enforcement backbone; 21 events).
4. skills-core + dirs incl. Claude/Codex compat loading.
5. plugins-cursor + Agent Plugins open standard (distribution).
6. sdk-ts (programmatic agents, headless L4 with sandbox).
7. sdk-custom-tools (in-process tools via MCP path, approval-skipping).
8. rules-precedence + team enforce (org governance).
9. mcp-enterprise (allowlist/network denylist policy).
10. sdk-bridge (language-agnostic parity path).
