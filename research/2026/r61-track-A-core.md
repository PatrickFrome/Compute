# R61 Track A — Cursor Core Agent / Harness / Planning / Projects / Agent UX catalog

- Task ID: R61-A (RESEARCH-ONLY). Corpus: /tmp/r61-corpus (329 pages fetched 2026-09-24T00:59Z).
- Scope: docs/agent__* (overview, plan-mode, projects, agents-window, agent-review, debug-mode, design-mode, prompting, tools/{browser,canvas,search,terminal}), get-started/quickstart, customize-cursor, reference/keyboard-shortcuts; blogs: continually-improving-agent-harness (2026-04-30), agent-best-practices (2026-01-09), prompt-design (2023-06-11). Two supplementary peeks (docs/subagents, docs/agent/security/run-modes) used only to annotate approval/delegation behavior referenced by track-A pages.
- Status honesty: doc pages carry no explicit GA/BETA badges in extracted text; "GA" = described as shipping with no rollout caveat; rollout caveats quoted verbatim. Blog dates are the page's own dates.

---

### agent-loop: Cursor Agent (core agent loop)
- Category: agent-core
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/overview
- Date: fetch 2026-09-24
- What: Cursor's assistant that independently completes complex coding tasks, runs terminal commands, and edits code, with unlimited tool calls per task.
- Invoke: Sidepane via Cmd+I / Ctrl+I; also Agents Window, CLI, web (cursor.com/agents).
- Runtime behind: Agent = orchestrates instructions + tools + model per task (see harness-triad). "There is no limit on the number of tool calls Agent can make during a task."
- Prereqs / Limitations: none stated beyond sign-in.
- Autonomy: L2 semi (governed by Run Modes; see run-modes entry) up to L4 (Run Everything)
- Evidence: "Agent is Cursor's assistant that can complete complex coding tasks independently, run terminal commands, and edit code."; "There is no limit on the number of tool calls Agent can make during a task."
- Confidence: HIGH

### harness-triad: Agent = Instructions + Tools + Model
- Category: harness
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/overview (+ blog agent-best-practices)
- Date: fetch 2026-09-24
- What: Official decomposition of the agent into three components; Cursor tunes instructions and tools per frontier model.
- Invoke: N/A (architecture).
- Runtime behind: "Cursor's agent orchestrates these components for each model we support, tuning instructions and tools specifically for every frontier model."
- Prereqs / Limitations: model-specific tuning is vendor-side, not user-visible config.
- Autonomy: n/a
- Evidence: "An agent is built on three components: Instructions… Tools… Model…"; "Cursor handles the model-specific optimizations."
- Confidence: HIGH

### built-in-tools: Built-in tool suite
- Category: tool
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/overview
- Date: fetch 2026-09-24
- What: Named built-ins: search files/folders, Web, Fetch Rules, Read files (incl. images .png/.jpg/.gif/.webp/.svg for vision models), Edit files, Run shell commands, Browser, Image generation, Ask questions.
- Invoke: Agent calls tools autonomously; user influences via prompts/@-mentions.
- Runtime behind: shell uses "the first terminal profile available"; image output saved to project `assets/` by default and shown inline.
- Prereqs / Limitations: image reading needs vision-capable model; terminal profile configurable via Command Palette.
- Autonomy: L2-L3 depending on Run Mode
- Evidence: "Intelligently read the content of a file. Also supports image files…"; "Generate images from text descriptions or reference images."
- Confidence: HIGH

### ask-tool: Ask clarifying questions (non-blocking)
- Category: tool
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/overview
- Date: fetch 2026-09-24
- What: Agent can ask the user a clarifying question mid-task while continuing to read files, edit, or run commands; answer is incorporated when it arrives.
- Invoke: agent-initiated; user answers in chat.
- Runtime behind: UNKNOWN (mechanism of parallel work while question pending not detailed).
- Prereqs / Limitations: only stated that answer is used "as soon as it arrives".
- Autonomy: L2 (agent pauses decision, keeps working)
- Evidence: "Ask clarifying questions during a task. While waiting for your response, the agent continues reading files, making edits, or running commands."
- Confidence: HIGH

### checkpoints: Checkpoints (auto snapshot + restore)
- Category: ux
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/overview
- Date: fetch 2026-09-24
- What: Automatic snapshots of all modified files before significant changes; click any checkpoint in the timeline to preview and restore.
- Invoke: automatic creation; restore via chat-timeline checkpoint, "Restore Checkpoint" button, or + button on hover.
- Runtime behind: stored locally, separate from Git; restores files only, not conversation messages.
- Prereqs / Limitations: local only; "use Git for permanent version control".
- Autonomy: L0 (restore is manual; snapshotting is automatic)
- Evidence: "Agent automatically creates them before making significant changes"; "Restoring a checkpoint reverts files only; it does not remove messages from the conversation."
- Confidence: HIGH

### queue-msg: Queued messages while agent works
- Category: ux
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/overview
- Date: fetch 2026-09-24
- What: Type next instruction while agent works; Enter queues it; agent processes queued messages sequentially after the current task; drag to reorder.
- Invoke: Enter = queue; Cmd/Ctrl+Enter = force send immediately (appended to most recent user message).
- Runtime behind: force-send "attaches to tool results and sends immediately".
- Prereqs / Limitations: none stated.
- Autonomy: L0 human control surface
- Evidence: "Press Enter to queue your message (it waits until Agent finishes the current task)"; "press Cmd+Enter to send immediately, bypassing the queue."
- Confidence: HIGH

### steer-now: Mid-run steering at tool-call boundary
- Category: ux
- Cursor Status: GA (web now; "rolling out in the Agents Window")
- Source: https://cursor.com/docs/agent/overview
- Date: fetch 2026-09-24
- What: "Send now" follow-up delivered at the agent's next tool call instead of interrupting mid-action; preserves in-flight work. Tab queues for after the turn instead.
- Invoke: Send now button, or press Enter twice (web/Agents Window); in CLI, Enter steers at a safe boundary, second Enter interrupts.
- Runtime behind: delivery point = next tool call boundary.
- Prereqs / Limitations: Agents Window availability rolling out at fetch date.
- Autonomy: L0/L2 (human nudges a semi-autonomous run)
- Evidence: "The message is delivered at the agent's next tool call instead of cutting off work mid-action"; "In the CLI, pressing Enter while the agent works steers the active run at a safe boundary."
- Confidence: HIGH

### side-chats: Side chats (/side, /btw)
- Category: ux
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/overview
- Date: fetch 2026-09-24
- What: Durable side conversation using the parent thread as hidden reference context, keeping its own transcript; can be @-mentioned back into the main thread.
- Invoke: type `/side` or `/btw` (+ optional question) in chat input, or the plus button atop the chat panel.
- Runtime behind: parent thread becomes "hidden reference context".
- Prereqs / Limitations: none stated.
- Autonomy: L0
- Evidence: "A side chat is a durable agent conversation. It uses the parent thread as hidden reference context and keeps its own transcript."
- Confidence: HIGH

### conversation-search: Cross-conversation search
- Category: ux
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/overview
- Date: fetch 2026-09-24
- What: Search past agent transcripts from the Agents Window via command palette; Cursor builds a local search index. Cmd/Ctrl+F searches the open conversation.
- Invoke: Cmd/Ctrl+K in Agents Window, then search.
- Runtime behind: "Cursor builds a local search index."
- Prereqs / Limitations: located in Agents Window per doc.
- Autonomy: L0
- Evidence: "Search past agent transcripts from the Agents Window… then search across conversations. Cursor builds a local search index."
- Confidence: HIGH

### goal-loop: /goal + /loop (long-lived objectives, recurring wake)
- Category: planning
- Cursor Status: /goal = PREVIEW ("rolling out"); /loop = GA doc'd built-in skill (status badge UNKNOWN)
- Source: https://cursor.com/docs/agent/overview
- Date: fetch 2026-09-24
- What: /goal gives the agent a long-lived objective it works toward until fully complete (each normal message otherwise read as "a new job"); /loop is a built-in skill running a prompt or skill on recurring/variable intervals — if no interval given, the agent chooses when to wake.
- Invoke: `/goal fix all flaky tests and make CI green`; CLI Ctrl+C pauses the goal; pair with a Custom Mode or /loop.
- Runtime behind: UNKNOWN (scheduler/supervisor internals not disclosed).
- Prereqs / Limitations: /goal may not appear until rollout reaches you ("try it in a new chat").
- Autonomy: L3 autonomous-guardrails (bounded by goal definition; approaches L4 when combined with Run Everything)
- Evidence: "Use /goal to give the agent a long-lived objective to work towards until it's fully complete"; "If you don't specify a fixed interval, the agent chooses when to wake."
- Confidence: HIGH (surface), MED (internals UNKNOWN)

### plan-mode: Plan Mode (research → plan → click-to-build)
- Category: planning
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/plan-mode (+ get-started/quickstart, blog agent-best-practices)
- Date: fetch 2026-09-24
- What: Before writing code, agent asks clarifying questions, researches the codebase, produces a reviewable/editable plan; user reviews via chat or markdown files, then clicks to build. Cursor auto-suggests Plan Mode when keywords indicate complex tasks.
- Invoke: Shift+Tab from chat input to rotate into it; mode picker dropdown.
- Runtime behind: plans saved by default in home directory; "Save to workspace" moves plan into workspace (blog: `.cursor/plans/`) for team sharing, resuming interrupted work, and future-agent context.
- Prereqs / Limitations: recommended for multi-approach/multi-file/unclear-requirement work; "For quick changes… jumping straight to Agent mode is fine."
- Autonomy: L2 (plan generation is autonomous; build gated on explicit click)
- Evidence: "Plan Mode creates detailed implementation plans before writing any code."; "You review and edit the plan through chat or markdown files. Click to build the plan when ready."; "Wait for your approval before building."
- Confidence: HIGH

### plan-restart: Restart-from-plan workflow
- Category: planning
- Cursor Status: GA (documented practice, not separate feature)
- Source: https://cursor.com/docs/agent/plan-mode
- Date: fetch 2026-09-24
- What: If the build misses intent, revert the changes, refine the plan, rerun — positioned as faster and cleaner than fixing an in-progress agent via follow-ups.
- Invoke: manual workflow (revert + plan edit + rerun).
- Runtime behind: none (workflow guidance).
- Prereqs / Limitations: user judgment required.
- Autonomy: L0/L2
- Evidence: "Revert the changes, refine the plan to be more specific… and run it again. This is often faster than fixing an in-progress agent."
- Confidence: HIGH

### mode-rotate: Agent mode rotation (mode picker, Shift+Tab)
- Category: ux
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/plan-mode (+ debug-mode, keyboard-shortcuts)
- Date: fetch 2026-09-24
- What: Modes are switched via the mode picker dropdown or Shift+Tab quick rotation. Corpus explicitly names Plan Mode and Debug Mode as modes; Design Mode toggles inside the browser. (A discrete "Ask" mode is NOT named in this corpus — older-era mode naming not evidenced here.)
- Invoke: Shift+Tab; Cmd/Ctrl+. opens Mode Menu (keyboard-shortcuts page); Shift+Tab listed as "Rotate between Agent modes".
- Runtime behind: UNKNOWN.
- Prereqs / Limitations: keyboard shortcuts remappable.
- Autonomy: n/a (control surface)
- Evidence: "Use the mode picker dropdown in Agent. Press Shift+Tab for quick switching."
- Confidence: HIGH

### custom-modes: Skills used as Custom Modes
- Category: ux
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/prompting
- Date: fetch 2026-09-24
- What: Any skill with valid frontmatter can back a Custom Mode that stays in context on every turn (for hours) until exited; unlike a one-message `/` attach which "fades as the conversation moves on". icon/color frontmatter style the badge.
- Invoke: `/` menu → Option/Alt+Enter, or "Use as Mode" on the skill entry.
- Runtime behind: skill pinned into system context each turn while mode active.
- Prereqs / Limitations: available in Agents Window and CLI.
- Autonomy: L2-L3 (shape agent behavior for the whole run)
- Evidence: "Inside a mode, the skill stays in context on every turn, even as the agent works for hours, until you exit the mode."; "Any skill with a valid frontmatter block can back a mode."
- Confidence: HIGH

### projects: Projects (coordinator agent, delegation, months of context)
- Category: projects
- Cursor Status: PREVIEW — "rolling out to all users"; NOT on Enterprise; NOT with Privacy Mode (Legacy)
- Source: https://cursor.com/docs/agent/projects
- Date: fetch 2026-09-24
- What: A Project takes larger bodies of work (feature, migration, full app). A coordinator agent plans, delegates to many agents in parallel, and returns finished work; coordinator itself writes no code. Maintains context over months, does recurring work unprompted.
- Invoke: Agents Window left-nav → Projects → New Project (name/icon, pick workspace repo + coordinator model) → chat with coordinator.
- Runtime behind: runs on Cloud Agents on "its own computer in the cloud" (survives laptop close; more parallel agents than a laptop); spins up a local agent when something must be tested on your machine.
- Prereqs / Limitations: GitHub connected for repo list; no Enterprise; no Legacy Privacy Mode (code stored in cloud while running).
- Autonomy: L3 autonomous-guardrails (delegates and manages agents on your behalf; you direct by chat)
- Evidence: "The coordinator doesn't write code itself. It plans the work, delegates it to agents that write the code"; "A Project maintains context over months of work, delegates tasks to many agents in parallel, and performs recurring work without being prompted."
- Confidence: HIGH

### project-shared-context: Project shared context (files syncing across agents/machines)
- Category: projects
- Cursor Status: PREVIEW (ships with Projects rollout)
- Source: https://cursor.com/docs/agent/projects
- Date: fetch 2026-09-24
- What: Each Project maintains files that sync across every cloud and local machine its agents use; agents add research, artifacts, and learned preferences ("If one agent figures out how to test a service, every future agent can use those instructions").
- Invoke: automatic; grows as agents work.
- Runtime behind: UNKNOWN (sync mechanism not disclosed).
- Prereqs / Limitations: part of Projects (see projects limitations).
- Autonomy: L3 (agents write to shared context autonomously)
- Evidence: "Each Project maintains a set of files that sync across every cloud and local machine its agents use."
- Confidence: HIGH

### project-subscriptions: Project subscriptions (Slack/schedule/PR triggers)
- Category: projects
- Cursor Status: PREVIEW (ships with Projects rollout)
- Source: https://cursor.com/docs/agent/projects
- Date: fetch 2026-09-24
- What: Tell the coordinator to watch a Slack channel, run on a schedule, or follow PRs; it acts on detected signals without waiting for a prompt (e.g., delegate a fix per bug report).
- Invoke: ask coordinator in chat; "Listening" pill above chat input lists every subscribed event (channel message, PR activity, CI runs, schedules); remove from same list.
- Runtime behind: UNKNOWN (event plumbing; related pages point to Automations/Slack integration).
- Prereqs / Limitations: integrations (e.g., Slack) must be connected.
- Autonomy: L3-L4 (acts unprompted on external signals)
- Evidence: "Tell the coordinator to watch a Slack channel, run on a schedule, or follow your pull requests. It then acts on the signals it detects without waiting for your prompt."
- Confidence: HIGH

### cloud-agents: Cloud Agents (remote sandbox execution)
- Category: projects
- Cursor Status: GA (per corpus usage; no rollout caveat on referenced pages)
- Source: https://cursor.com/blog/agent-best-practices (+ referenced by docs/agent/projects)
- Date: 2026-01-09 (blog)
- What: Agents that clone the repo, create a branch, work autonomously, open a PR when finished, and notify (Slack/email/web); run in remote sandboxes so the laptop can be closed. Startable from cursor.com/agents, editor, or phone.
- Invoke: cursor.com/agents, editor, phone, Slack "@Cursor".
- Runtime behind: "Cloud agents run in remote sandboxes" — internals UNKNOWN (see cloud-environment corpus pages, other tracks).
- Prereqs / Limitations: repo access; notification channel optional.
- Autonomy: L3-L4 (opens PR autonomously; human merges)
- Evidence: "The agent clones your repo and creates a branch. It works autonomously, opening a pull request when finished."
- Confidence: HIGH

### agents-window: Agents Window (agent-first interface)
- Category: ux
- Cursor Status: GA — "generally available with Cursor 3, released on April 2, 2026"
- Source: https://cursor.com/docs/agent/agents-window
- Date: fetch 2026-09-24
- What: Agent-first interface unifying local, cloud, remote SSH agents; editor remains available simultaneously. Exclusive features: multi-workspace, new diffs view, parallel cloud agents (workable from phone/web/Slack/GitHub/Linear), easy local↔cloud handoff, cloud subagents, worktrees.
- Invoke: Cmd/Ctrl+Shift+P → "Open Agents Window"; back via "Open IDE"; Cmd+P / Cmd+Shift+F file search inside.
- Runtime behind: UNKNOWN.
- Prereqs / Limitations: Enterprise rollout was admin-gated for two weeks post-launch, then default-on.
- Autonomy: n/a (surface for managing L2-L4 agents)
- Evidence: "The Agents Window is Cursor's agent-first interface… across repos and environments, including local, cloud, remote SSH"; "generally available with Cursor 3, released on April 2, 2026."
- Confidence: HIGH

### worktrees: Git worktrees for parallel agents
- Category: tool
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/agents-window (+ blog agent-best-practices)
- Date: fetch 2026-09-24
- What: Agents run in isolated Git checkouts so each task has its own files/changes; Cursor "automatically creates and manages git worktrees for parallel agents"; Apply merges changes back to your branch on finish.
- Invoke: select worktree option from agent dropdown; listed as Agents Window feature.
- Runtime behind: git worktrees; disabled for multi-root workspaces (per search FAQ).
- Prereqs / Limitations: single git root; multi-root workspaces and Cloud Agents don't support (FAQ).
- Autonomy: L2 (isolation guardrail enabling parallel L3 agents)
- Evidence: "run agents in isolated Git checkouts so each task has its own files and changes"; "click Apply to merge its changes back to your working branch."
- Confidence: HIGH

### cloud-subagent-handoff: /in-cloud and /autopilot handoffs
- Category: ux
- Cursor Status: GA (Agents Window feature list)
- Source: https://cursor.com/docs/agent/agents-window
- Date: fetch 2026-09-24
- What: Hand a task to a cloud subagent with /in-cloud, or put a PR on /autopilot so long-running work runs on its own VM and branch while you keep working locally. Local↔cloud agent move is one click.
- Invoke: slash commands in agent input (`/in-cloud`, `/autopilot`).
- Runtime behind: cloud VM + branch per work (details in Cloud Agents docs, other tracks).
- Prereqs / Limitations: Agents Window; cloud infrastructure.
- Autonomy: L3-L4 (/autopilot = fully delegated long-runner)
- Evidence: "hand off a task to a cloud subagent with /in-cloud, or put a PR on /autopilot, so long-running work runs on its own VM and branch."
- Confidence: HIGH

### diffs-view: Diffs view (review/commit/PR without leaving)
- Category: ux
- Cursor Status: GA (Agents Window exclusive)
- Source: https://cursor.com/docs/agent/agents-window
- Date: fetch 2026-09-24
- What: "New diffs view: review and commit changes, and manage PRs without leaving Cursor."
- Invoke: Agents Window UI.
- Runtime behind: UNKNOWN.
- Prereqs / Limitations: Agents Window.
- Autonomy: L0 review surface
- Evidence: "review and commit changes, and manage PRs without leaving Cursor."
- Confidence: HIGH

### agent-review: Agent Review (local AI code review)
- Category: agent-core
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/agent-review
- Date: fetch 2026-09-24
- What: Dedicated code review run on local changes from inside Cursor; reads repository rules from BUGBOT.md files; two depth levels (Quick: small diffs/fast/low cost; Deep: complex logic/security/large refactors).
- Invoke: (1) Automatic after every commit (settings-enabled); (2) `/agent-review` slash command; (3) Source Control tab review vs main branch. Configure in Cursor Settings > Agents (moves to Git & PRs > Pull Requests in Cursor 3.11).
- Runtime behind: dedicated review pass analyzing proposed edits line-by-line (blog); BUGBOT.md rule ingestion (BugBot family).
- Prereqs / Limitations: BUGBOT.md optional; depth = speed/cost tradeoff.
- Autonomy: L3 when auto-after-commit (runs unprompted); L1/L2 manual otherwise; read-only reporting
- Evidence: "Agent Review runs a dedicated code review on your local changes from inside Cursor."; "Type /agent-review in the agent window input to trigger a review on demand."; "Agent Review also reads repository rules from BUGBOT.md files."
- Confidence: HIGH

### debug-mode: Debug Mode (hypothesis + runtime evidence)
- Category: agent-core
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/debug-mode
- Date: fetch 2026-09-24
- What: For hard-to-reproduce/tricky bugs: agent explores, generates multiple root-cause hypotheses, adds log statements sending data to a local debug server running in a Cursor extension, asks the user to reproduce, analyzes logs, makes a targeted fix, then removes instrumentation.
- Invoke: mode picker dropdown or Shift+Tab rotation.
- Runtime behind: "a local debug server running in a Cursor extension" collects runtime data during user reproduction.
- Prereqs / Limitations: requires human-in-loop reproduction (multiple reproductions help for race conditions); best with detailed context (errors, stack traces, steps).
- Autonomy: L2 (agent instruments and fixes; reproduction step is manual and mandatory)
- Evidence: "The agent adds log statements that send data to a local debug server running in a Cursor extension."; "Debug Mode asks you to reproduce the bug and provides specific steps."
- Confidence: HIGH

### design-mode: Design Mode (visual/voice prompting in browser)
- Category: ux
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/design-mode
- Date: fetch 2026-09-24
- What: Direct agents with visual prompts from the browser inside the Agents Window: click an element, multi-select elements, draw over a frozen viewport frame, or narrate by voice; agent edits code while you send the next change; app hot reloads as agents finish.
- Invoke: open browser in Agents Window; toggle with Cmd/Ctrl+Shift+D. Shortcuts: Shift+drag select area; Cmd/Ctrl+L add element to chat; Option/Alt+click add element to input.
- Runtime behind: element pick yields "element identity: the xpath, the component, attributes, computed styles, and props from the fiber tree" + a screenshot of page state. Recommends Composer 2.5 for the flow.
- Prereqs / Limitations: lives in the Agents Window browser; fiber tree implies React-oriented signal.
- Autonomy: L2 (edits applied as you continue; hot reload verification)
- Evidence: "Click an element in the running app, prompt against that selected element, and let the agent edit the code."; "the xpath, the component, attributes, computed styles, and props from the fiber tree."
- Confidence: HIGH

### browser-tool: Browser tool (agent-driven web view)
- Category: tool
- Cursor Status: GA (one sub-capability partial: Network Traffic "currently only available in the Agent panel, coming soon to the layout")
- Source: https://cursor.com/docs/agent/tools/browser
- Date: fetch 2026-09-24
- What: Agent controls a browser to navigate/click/type/scroll/screenshot, read console output and network traffic; used for testing apps, WCAG accessibility audits, design-to-code, visual regression. No external tools to install.
- Invoke: agent-invoked; @Browser mention attaches built-in browser context.
- Runtime behind: "Browser runs as a secure web view and is controlled using an MCP server running as an extension"; logs written to files the agent can grep (token-efficient reads); dev-server detection to reuse correct ports; screenshots integrated with file-reading tool so the agent "actually sees" state.
- Prereqs / Limitations: session persistence per workspace (cookies, localStorage/sessionStorage, IndexedDB persist; isolated per workspace). Recommended models: Sonnet 4.5, GPT-5, Auto. Enterprise gating via MCP toggles + origin allowlist (v2.1+ dashboard; must request enablement). Allowlist edge cases: link/redirect/JS navigation from allowed origin to non-allowed origin succeeds (best-effort).
- Autonomy: L2 default ("Browser tools require your approval by default") — configurable L1 (allow-listed actions auto) or L4 (auto-run; docs warn never with untrusted code)
- Evidence: "Agent has access to the following browser tools: Navigate… Click… Type… Scroll… Screenshot… Console Output… Network Traffic"; "Browser runs as a secure web view and is controlled using an MCP server running as an extension."
- Confidence: HIGH

### canvas-tool: Canvases (interactive artifacts)
- Category: tool
- Cursor Status: GA (sharing = paid plans only)
- Source: https://cursor.com/docs/agent/tools/canvas
- Date: fetch 2026-09-24
- What: Cursor creates interactive artifacts (dashboards, analyses, audits, reports) rendered next to chat with sections/stats/tables; saved, reopenable, rerunnable with fresh data; source editable by hand or by asking Cursor.
- Invoke: agent decides or user asks; card at end of response opens it; Command Palette "Open Canvas" (under View); new-tab menu in Agents Window.
- Runtime behind: UNKNOWN (render/edit pipeline not disclosed).
- Prereqs / Limitations: Publish/share = read-only live snapshots for teammates; paid plans + team membership + non-Legacy-Privacy-Mode; team admins can disable org-wide (Shared Canvases setting); dashboard lists only your own shares.
- Autonomy: L2 (agent builds/iterates on request or judgement)
- Evidence: "Canvases let Cursor create interactive artifacts that render next to the chat."; "Cursor saves the canvas so you can reopen and rerun it later with fresh data."
- Confidence: HIGH

### canvas-skills: Canvas workflows packaged as skills
- Category: tool
- Cursor Status: GA (docs describe the pattern)
- Source: https://cursor.com/docs/agent/tools/canvas
- Date: fetch 2026-09-24
- What: Canvas skills bundle trigger description, layout instructions, data sources/queries (SQL/API/shell), formatting rules so a short prompt regenerates a consistent canvas for every teammate.
- Invoke: skill authoring (SKILL.md per Skills docs); then short prompt.
- Runtime behind: composition of skills system + canvas system.
- Prereqs / Limitations: skill must be authored/installed.
- Autonomy: L2-L3
- Evidence: "Common canvas workflows can be packaged as skills so Cursor produces a consistent layout every time you ask."
- Confidence: HIGH

### instant-grep: Instant Grep (custom search engine)
- Category: tool
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/tools/search
- Date: fetch 2026-09-24
- What: Cursor ships a custom search engine claimed to outperform ripgrep on large codebases; full regex + word-boundary matching; runs automatically with no configuration; agent uses grep automatically when symbols are referenced.
- Invoke: agent-initiated (automatic).
- Runtime behind: builds and queries index locally; "Cursor does not upload file paths or code to build a search index, and it does not store embeddings of your codebase for search." Semantic search also used per best-practices blog ("grep and semantic search").
- Prereqs / Limitations: opening a match can still send file content to the model (Data Use policy governs).
- Autonomy: L3 (fully agent-driven)
- Evidence: "Cursor ships with Instant Grep, a custom search engine that outperforms ripgrep on large codebases."; "Instant Grep builds and queries its index on your machine."
- Confidence: HIGH

### explore-subagent: Explore subagent (parallel search in own context)
- Category: tool
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/tools/search (+ docs/subagents supplementary)
- Date: fetch 2026-09-24
- What: Agent spawns an Explore subagent in its own context window on a faster model; runs many parallel searches; returns only relevant findings — context-management mechanism keeping the main conversation focused.
- Invoke: automatic when broad search helps; or request directly ("use a subagent to find…").
- Runtime behind: per subagents doc — built-ins are Explore/Bash/Browser; Explore defaults to a faster model enabling "10 parallel searches in the time a single main-agent search would take"; subagents start with clean context, parent must include needed info in prompt.
- Prereqs / Limitations: result is a summary, not raw file dumps.
- Autonomy: L3 (agent-launched, no approval gate mentioned)
- Evidence: "runs in its own context window with a faster model. It executes many parallel searches without bloating the main conversation."
- Confidence: HIGH

### subagents-general: Subagents (custom, foreground/background)
- Category: agent-core
- Cursor Status: GA
- Source: https://cursor.com/docs/subagents (supplementary) + customize-cursor + agent/prompting (Subagents category in context tray)
- Date: fetch 2026-09-24
- What: Specialized assistants the agent delegates to; each with own context window, custom prompts/tool access/model; foreground (blocks, returns result) or background (returns immediately) modes; definable per project and reusable; harness added "users directly ask for a subagent to be run with a particular model".
- Invoke: agent auto-launch; user request in chat; configured via Customize page.
- Runtime behind: clean-context child conversations; parent prompt must carry all context.
- Prereqs / Limitations: no parent-history access inside subagent.
- Autonomy: L3
- Evidence: "Each subagent operates in its own context window, handles specific types of work, and returns its result to the parent agent."; "Subagents run in one of two modes: Foreground… Background…"
- Confidence: HIGH

### terminal-tool: Terminal tool (agent shell execution)
- Category: tool
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/tools/terminal (+ agent/overview)
- Date: fetch 2026-09-24
- What: Cursor runs shell commands directly in your terminal and monitors output; Run Mode controls when commands run, when Cursor asks, and when commands enter the sandbox. Default terminal = "the first terminal profile available" (configurable).
- Invoke: agent-invoked; user sets Run Mode in Settings.
- Runtime behind: sandbox blocks unauthorized file access and network activity (details in Run Modes > Sandboxing: sandbox.json, network modes, env vars — see run-modes entry and Track on security).
- Prereqs / Limitations: heavy shell themes (Powerlevel9k/10k) can corrupt inline output; `CURSOR_AGENT` env var lets shell configs detect agent sessions and skip fancy prompts.
- Autonomy: L2-L3 by Run Mode (see run-modes); L4 if "Run Everything"
- Evidence: "Cursor runs shell commands directly in your terminal. Your Run Mode controls when commands run, when Cursor asks, and when terminal commands enter the sandbox."; "Use the CURSOR_AGENT environment variable in your shell config to detect when Cursor is running."
- Confidence: HIGH

### run-modes: Run Modes (Auto-review / Allowlist / Run Everything) + sandbox
- Category: agent-core
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/security/run-modes (supplementary; directly governs terminal tool approval behavior)
- Date: fetch 2026-09-24
- What: Three approval regimes for shell/MCP/Fetch calls: Auto-review (allowlisted run immediately; other shell sandboxed when possible; non-sandboxed go to a classifier), Allowlist (deterministic), Run Everything (zero prompts). Recommended default: Auto-review.
- Invoke: Settings > Agents > Approvals & Execution.
- Runtime behind: Auto-review classifier = "a small Cursor-managed model. Today that is Claude 4.5 Haiku or GPT-5.4 Mini"; sandbox is a layer on top for shell; on classifier block, agent may try another approach or, if it insists, Cursor shows a human approval prompt. "Auto-review is not a security boundary."
- Prereqs / Limitations: classifier model must be allowed under Enterprise model access controls.
- Autonomy: L3 (Auto-review default), L2 (Allowlist), L4 (Run Everything)
- Evidence: "The safest useful setup for most people is Auto-review."; "When the classifier blocks a call, Cursor can try another approach."
- Confidence: HIGH

### prompting-surface: @-mention context attachments
- Category: ux
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/prompting
- Date: fetch 2026-09-24
- What: `@` attaches context: files/folders (@auth.ts, @src/components/ with `/` to descend), @Terminals (terminal output), @Chats (previous conversations, selectively read), @Commit (diff of working state), @Branch (diff vs main), @Browser (built-in browser context).
- Invoke: type `@` in chat input, pick from suggestions.
- Runtime behind: docs advise: tag files only when you know them; otherwise agent finds context itself via search.
- Prereqs / Limitations: none stated.
- Autonomy: L0 (human context curation)
- Evidence: "@Chats to reference context from a previous conversation"; "@Commit (Diff of Working State) for uncommitted changes, or @Branch (Diff with Main)".
- Confidence: HIGH

### multimodal-input: Image + voice input
- Category: ux
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/prompting (+ design-mode voice)
- Date: fetch 2026-09-24
- What: Drag-drop or paste images (screenshots, mockups) as visual context; microphone dictation with transcription review. Design Mode adds voice narration that stays available while agents run.
- Invoke: Cmd/Ctrl+V paste, drag-drop, or mic icon in chat input.
- Runtime behind: images enter conversation context for vision-capable models (per overview Read files tool).
- Prereqs / Limitations: vision-capable model for image analysis.
- Autonomy: L0
- Evidence: "Paste from clipboard with Cmd+V, including screenshots"; "Click the microphone icon in the chat input to dictate your prompt instead of typing."
- Confidence: HIGH

### context-tray: Context usage ring + breakdown tray + auto-summarization
- Category: ux
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/prompting
- Date: fetch 2026-09-24
- What: Fixed context window shared per chat; when near full, "Cursor compresses older parts of the conversation into a summary". Context ring shows fullness; click opens breakdown by category: System prompt, Tools, Rules, Skills, MCP, Subagents, Summarized conversation, Conversation.
- Invoke: click the context ring next to the prompt input.
- Runtime behind: automatic summarization of older turns; category accounting per prompt segment.
- Prereqs / Limitations: long conversations accumulate noise after summarizations (best-practices blog: start new chat when effectiveness drops).
- Autonomy: L3 (compaction automatic)
- Evidence: "Cursor compresses older parts of the conversation into a summary to leave more room"; "The context ring next to your prompt input shows how full the window is at a glance."
- Confidence: HIGH

### model-switch: Mid-conversation model switching
- Category: ux
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/prompting (+ blog continually-improving-agent-harness)
- Date: fetch 2026-09-24
- What: Model picker or Cmd/Ctrl+/ cycles models mid-conversation; change applies going forward; default model in Settings > Models. Harness handles the switch.
- Invoke: model picker dropdown; Cmd/Ctrl+/ keyboard cycle.
- Runtime behind: per harness blog — switching auto-swaps to that model's customized prompts/tools; injects custom instructions telling the model it's taking over mid-chat and to avoid tools absent from its set; cache miss on switch (provider-specific caches); experiment: summarize-at-switch mitigates cost but can lose detail; recommendation: stay on one model per conversation, or delegate to a fresh-context subagent on the target model.
- Prereqs / Limitations: cache penalty; out-of-distribution history risk.
- Autonomy: L0
- Evidence: "When a user switches models, Cursor automatically switches to the appropriate harness"; "These instructions also steer it away from calling tools that appear in the conversation history but aren't part of its own tool set."
- Confidence: HIGH

### keyboard-invocation: Keyboard-driven invocation
- Category: ux
- Cursor Status: GA
- Source: https://cursor.com/docs/reference/keyboard-shortcuts (+ agent pages)
- Date: fetch 2026-09-24
- What: Full keyboard surface: Cmd+I/Cmd+L toggle sidepanel; Cmd+E toggle Agent layout; Cmd+. Mode Menu; Cmd+/ loop models; Shift+Tab rotate modes; Cmd+Shift+P palette; Enter queue / Cmd+Enter force-send; Cmd+Shift+Backspace cancel generation; Tab cycle messages; Cmd+K inline edit & terminal prompt bar; Cmd+Shift+Space voice mode; @ and / open context/command pickers; all remappable (VS Code keybindings baseline).
- Invoke: keyboard.
- Runtime behind: none needed.
- Prereqs / Limitations: "unless bound to mode" caveat on Cmd+I/Cmd+L.
- Autonomy: L0
- Evidence: "Cmd . — Mode Menu"; "Cmd / — Loop between AI models"; "Shift Tab — Rotate between Agent modes"; "All Cursor keybindings… can be remapped in Keyboard Shortcuts settings."
- Confidence: HIGH

### edit-files: Multi-file editing + diff review + accept/reject
- Category: agent-core
- Cursor Status: GA
- Source: https://cursor.com/docs/agent/overview (+ quickstart + keyboard-shortcuts + best-practices blog)
- Date: fetch 2026-09-24
- What: Edit files tool suggests and applies edits across files automatically; diff view shows changes live; Stop button cancels and redirects mid-generation; accept-all/reject-all via Cmd+Return / Cmd+Shift+Backspace on suggested changes.
- Invoke: agent-invoked during task; user reviews in diff view.
- Runtime behind: per-model edit formats (patch-based for OpenAI-trained, string-replacement for Anthropic-trained) provisioned by harness — see per-model-harness.
- Prereqs / Limitations: review is advised ("AI-generated code can look right while being subtly wrong").
- Autonomy: L2 default (edits applied, human reviews diffs), L3-L4 under auto-run modes
- Evidence: "Suggest edits to files and apply them automatically."; "The diff view shows changes as they happen. If you see the agent heading in the wrong direction, click Stop."
- Confidence: HIGH

### rules: Rules (project/user/team/AGENTS.md)
- Category: agent-core
- Cursor Status: GA
- Source: https://cursor.com/docs/customize-cursor (+ best-practices blog)
- Date: fetch 2026-09-24
- What: Persistent instructions shaping agent behavior at start of every conversation; markdown in `.cursor/rules/` (project), user rules, team rules, or AGENTS.md; Fetch Rules tool retrieves rules by type/description at runtime.
- Invoke: authored as files / settings; agent loads automatically; @cursor on a GitHub issue/PR can have the agent update a rule.
- Runtime behind: injected into system context (visible as "Rules" segment in context tray).
- Prereqs / Limitations: guidance — keep rules short, reference files, don't copy style guides; rules checked into git for team benefit.
- Autonomy: L3 (always-on shaping of autonomous behavior)
- Evidence: "Rules: Persistent instructions that shape how Agent works with your code."; "project rules, user rules, team rules, or AGENTS.md."
- Confidence: HIGH

### skills: Skills (SKILL.md dynamic capabilities)
- Category: agent-core
- Cursor Status: GA (core component per customize-cursor fetch 2026-09-24; NOTE: best-practices blog of 2026-01-09 said "Agent Skills are currently only available in the nightly release channel" — historical, superseded)
- Source: https://cursor.com/docs/customize-cursor (+ customize-cursor, prompting, canvas docs)
- Date: fetch 2026-09-24
- What: Domain knowledge, workflows, and scripts in SKILL.md files loaded dynamically when the agent decides they're relevant (vs always-on Rules); frontmatter supports icon/color; invocable as `/` commands or pinned as Custom Modes; skills descriptions injected into system context (context tray "Skills" segment).
- Invoke: agent auto-loads on relevance; user invokes via `/`; manage in Customize page per scope (user/team/workspace).
- Runtime behind: description in system context; body loaded on demand — "Skills are loaded dynamically when the agent decides they're relevant."
- Prereqs / Limitations: valid frontmatter required to back a Custom Mode.
- Autonomy: L3
- Evidence: "Skills: Specialized capabilities Agent loads when relevant. Skills package domain knowledge, workflows, and scripts in SKILL.md files."
- Confidence: HIGH

### commands: Commands (reusable `/` prompts)
- Category: ux
- Cursor Status: GA
- Source: https://cursor.com/docs/customize-cursor (+ best-practices blog)
- Date: fetch 2026-09-24
- What: Markdown files defining focused workflows invoked with `/` in Agent chat (e.g., /pr commit+push+PR, /fix-issue, /review, /update-deps); stored in `.cursor/commands/`, checked into git for the team; "The agent can use these commands autonomously".
- Invoke: `/` in agent input.
- Runtime behind: reusable prompt expansion + agent executes steps.
- Prereqs / Limitations: none stated.
- Autonomy: L2-L3 (one invocation delegates a multi-step workflow)
- Evidence: "Commands: Reusable prompts you invoke with / in Agent chat. Commands are markdown files…"; "Store them as Markdown files in .cursor/commands/."
- Confidence: HIGH

### hooks: Hooks (lifecycle scripts, agent-loop control)
- Category: harness
- Cursor Status: GA (core component per customize-cursor; detailed patterns from 2026-01-09 blog)
- Source: https://cursor.com/docs/customize-cursor (+ blog agent-best-practices)
- Date: fetch 2026-09-24
- What: Scripts that "observe, control, or extend the agent loop at specific lifecycle events" (e.g., `stop`). Stop-hook pattern returns a `followup_message` to keep the agent looping until a condition (tests pass, scratchpad DONE) or MAX_ITERATIONS cap — a user-built long-running-agent loop.
- Invoke: `.cursor/hooks.json` config (version 1, hooks.stop[].command); script reads context JSON from stdin, writes JSON to stdout.
- Runtime behind: hook receives {conversation_id, status: completed|aborted|error, loop_count}; empty JSON output = let stop; followup_message = continue.
- Prereqs / Limitations: hooks run local scripts (security tooling integrations exist via partners); skills+hooks were nightly-channel-only at blog date (historical).
- Autonomy: L4-capable (agent re-prompts itself; guardrail = iteration cap in user script)
- Evidence: "Hooks: Scripts that observe, control, or extend the agent loop at specific lifecycle events."; "returns a followup_message to continue the loop."
- Confidence: HIGH

### plugins-marketplace: Plugins, Marketplace, Customize page
- Category: ux
- Cursor Status: GA
- Source: https://cursor.com/docs/customize-cursor
- Date: fetch 2026-09-24
- What: Plugins = distributable bundles packaging rules, skills, subagents, commands, MCP servers, and hooks; Customize page = single sidebar surface to install from Cursor Marketplace (official/community), team MCP via Default marketplace, scope filtering (user/team/workspace), team leaderboard of popular plugins/skills/MCPs; "plugin canvases" for shared setup templates.
- Invoke: Customize sidebar page; one-click install.
- Runtime behind: UNKNOWN (distribution internals).
- Prereqs / Limitations: community catalog at cursor.directory.
- Autonomy: n/a
- Evidence: "Plugins: Distributable bundles that package rules, skills, subagents, commands, MCP servers, and hooks."; "See your team leaderboard of the most popular plugins, skills, and MCPs."
- Confidence: HIGH

### per-model-harness: Per-model harness customization (tool formats, prompts)
- Category: harness
- Cursor Status: GA (internal engineering practice, publicly described)
- Source: https://cursor.com/blog/continually-improving-agent-harness
- Date: 2026-04-30
- What: Model-agnostic harness abstractions customized per model: each model gets the edit-tool format it was trained on (OpenAI patch-based vs Anthropic string-replacement), custom prompting per provider and even per model version.
- Invoke: n/a (system behavior).
- Runtime behind: harness provisions training-native tool shapes to cut reasoning tokens/mistakes; per-model baselines for expected tool-call errors; "context anxiety" mitigation via prompt adjustments.
- Prereqs / Limitations: invisible to users; users cannot override per-model tool formats (not stated).
- Autonomy: n/a
- Evidence: "we provision each model with the tool format it had during training"; "OpenAI's models are trained to edit files using a patch-based format, while Anthropic's models are trained on string replacement."
- Confidence: HIGH

### harness-evals: Harness measurement (CursorBench, A/B, Keep Rate)
- Category: harness
- Cursor Status: GA (internal practice, publicly described)
- Source: https://cursor.com/blog/continually-improving-agent-harness
- Date: 2026-04-30
- What: Multi-layer measurement: public benchmarks + internal CursorBench eval suite; online A/B of harness variants on real usage; quality metrics = latency, token efficiency, tool call count, cache hit rate, plus "Keep Rate" (fraction of agent-proposed code surviving in the codebase after fixed intervals) and an LLM reading user replies for semantic satisfaction.
- Invoke: n/a (internal).
- Runtime behind: e.g., experiment shelving a more expensive summarization model after negligible quality delta.
- Prereqs / Limitations: n/a.
- Autonomy: n/a
- Evidence: "we track what fraction of those remain in the user's codebase after fixed intervals of time"; "A user moving on to the next feature is a strong signal the agent did its job."
- Confidence: HIGH

### harness-errors: Tool-error taxonomy + alerts + weekly triage Automation
- Category: harness
- Cursor Status: GA (internal practice, publicly described)
- Source: https://cursor.com/blog/continually-improving-agent-harness
- Date: 2026-04-30
- What: All unknown tool errors = harness bugs (alert on threshold per tool); expected errors classified (InvalidArguments, UnexpectedEnvironment, ProviderError, UserAborted, Timeout); anomaly alerts on expected errors vs per-tool/per-model baselines; a weekly Automation with a log-searching skill files/updates backlog tickets and kicks off Cloud Agent fixes from Linear.
- Invoke: n/a (internal); conceptually = "automated software factory".
- Runtime behind: tool call errors left in context cause "context rot" — accumulated mistakes degrade subsequent decisions.
- Prereqs / Limitations: n/a.
- Autonomy: L4 (self-repair loop of the harness itself)
- Evidence: "Any unknown error represents a bug in the harness, and we treat it accordingly."; "we have anomaly detection alerts which fire when expected errors significantly exceed the baseline."
- Confidence: HIGH

### context-evolution: (HISTORICAL) Static-context guardrails → dynamic context
- Category: harness
- Cursor Status: DEPRECATED (mostly removed per blog: "That is mostly long gone")
- Source: https://cursor.com/blog/continually-improving-agent-harness
- Date: 2026-04-30 (describing late-2024→2026 evolution)
- What: Early agent era: heavy static context (folder layout, semantically matched snippets, compressed manual attachments) plus guardrails (surfacing lint/type errors after every edit, rewriting too-small file reads, capping tool calls per turn). Current: mostly removed in favor of dynamic context fetched by the agent mid-work; some static context remains (OS, git status, current/recently viewed files).
- Invoke: n/a.
- Runtime behind: adaptation to stronger models; "knocking down guardrails and providing more dynamic context."
- Prereqs / Limitations: historical — do NOT model current Cursor on the removed behaviors.
- Autonomy: shift toward L3
- Evidence: "surfacing lint and type errors to the agent after every edit… That is mostly long gone."; "We still include some useful static context (e.g., operating system, git status, current and recently viewed files)."
- Confidence: HIGH

### multi-agent-vision: Orchestration-of-specialists as harness role (vision)
- Category: harness
- Cursor Status: ANNOUNCED (forward-looking statement, not shipped surface)
- Source: https://cursor.com/blog/continually-improving-agent-harness
- Date: 2026-04-30
- What: Stated future: multi-agent systems where the harness learns "which agent to dispatch, how to frame the task for that agent's strengths, and how to stitch the results" — planning/fast-edit/debug specialists. Directionally matches today's Projects coordinator + subagents.
- Invoke: n/a.
- Runtime behind: none shipped as described (vision).
- Prereqs / Limitations: vision, not a documented current capability.
- Autonomy: L4 (aspiration)
- Evidence: "The ability to orchestrate that kind of coordination will live in the harness rather than any single agent."
- Confidence: HIGH (that it is a stated vision), LOW (as a current capability)

### prompt-design-priompt: (HISTORICAL) Prompt-design philosophy + Priompt
- Category: harness
- Cursor Status: HISTORICAL (2023 ideas post; internal library status today UNKNOWN)
- Source: https://cursor.com/blog/prompt-design
- Date: 2023-06-11
- What: Early framing of prompting as "prompt design" (clear communication with dynamic input, JSX-declarative composition, cache-aware re-renders); introduced Priompt, a React-like JSX prompt library used internally at Cursor at the time.
- Invoke: n/a.
- Runtime behind: Priompt preview website for rendering prompts with real props; declarative components over string concatenation.
- Prereqs / Limitations: 2023-era; GPT-3.5/4 context; self-flagged caveats (pixel-perfection obsolete, control trends).
- Autonomy: n/a
- Evidence: "agent prompting can be seen as building an interactive website for the agents"; "Priompt, a React-like, JSX-based prompt design library."
- Confidence: HIGH (historical), LOW (current relevance)

### worktree-parallel-models: Multi-model same-prompt comparison
- Category: ux
- Cursor Status: GA (described in best-practices blog as available pattern)
- Source: https://cursor.com/blog/agent-best-practices
- Date: 2026-01-09
- What: Select multiple models from the dropdown, submit one prompt, compare results side by side; Cursor "will also suggest which solution it believes is best"; pairs with worktrees so parallel agents don't collide. Multiple models on the same problem improves outcomes on hard tasks.
- Invoke: agent dropdown multi-select + submit.
- Runtime behind: UNKNOWN (fan-out mechanics).
- Prereqs / Limitations: notifications/sounds recommended to track completion.
- Autonomy: L2 (human picks best)
- Evidence: "running the same prompt across multiple models simultaneously… Cursor will also suggest which solution it believes is best."
- Confidence: MED (blog-described; not in docs pages read)

### codebase-orientation: Codebase understanding workflow (quickstart surface)
- Category: planning
- Cursor Status: GA (onboarding workflow)
- Source: https://cursor.com/docs/get-started/quickstart
- Date: fetch 2026-09-24
- What: Canonical onboarding loop: agent explains codebase (searches, reads, summarizes), suggests small safe improvements with tradeoffs, makes the change, user reviews diff and asks agent to run existing checks (tests/typechecker/lint/build), then Plan Mode for bigger work.
- Invoke: Cmd+I then prompted questions; prompts like "Explain this codebase…".
- Runtime behind: composition of search/read/summarize + edit tools.
- Prereqs / Limitations: none.
- Autonomy: L1-L2
- Evidence: "Cursor will search your repo, read relevant files, and summarize how the project fits together."
- Confidence: HIGH

### tdd-pattern: TDD / verifiable-goal agent pattern
- Category: planning
- Cursor Status: GA (documented best practice, not a feature)
- Source: https://cursor.com/blog/agent-best-practices
- Date: 2026-01-09
- What: Pattern: agent writes tests first (no implementation), tests committed, agent implements until green without touching tests; grounded in "Agents perform best when they have a clear target to iterate against". Ties to typed languages/linters as autonomy guardrails.
- Invoke: prompting pattern (explicit TDD instruction).
- Runtime behind: none (guidance).
- Prereqs / Limitations: requires verifiable success signals (tests, typecheck).
- Autonomy: L3 (iterate-until-green within guardrails)
- Evidence: "Agents perform best when they have a clear target to iterate against."
- Confidence: HIGH

---

## Coverage checklist (task requirements)
- Agent modes: plan-mode, debug-mode, design-mode, mode-rotate, custom-modes. NOTE: corpus never names an "Ask" mode as a distinct mode — not invented; Ask-style behavior covered by ask-tool.
- Agent = instructions+tools+model: harness-triad. ✓
- Plan Mode incl. handoff to build: plan-mode ("Click to build the plan when ready"). ✓
- Projects coordinator/delegation/large work: projects, project-shared-context, project-subscriptions. ✓
- Agents Window parallel management: agents-window, cloud-subagent-handoff, diffs-view, worktrees. ✓
- Agent Review: agent-review. ✓ Debug Mode: debug-mode. ✓ Design Mode: design-mode. ✓
- Prompting best practices as capability surface: rules, skills, commands, hooks, prompting-surface, tdd-pattern, plan-restart. ✓
- Browser/Canvas/Search/Terminal tools: browser-tool, canvas-tool, instant-grep, terminal-tool, run-modes. ✓
- Keyboard-driven invocation: keyboard-invocation. ✓
- Multi-file editing: edit-files. ✓
- Checkpoints/restore: checkpoints. ✓
- Context handling in agent loop: context-tray, explore-subagent, context-evolution, model-switch (cache/summarize), steer-now. ✓
- Harness internals: per-model-harness, harness-evals, harness-errors, multi-agent-vision. ✓

Count: 53 capabilities.
