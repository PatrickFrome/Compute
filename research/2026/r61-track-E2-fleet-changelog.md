# R61-E2 — Cursor Fleet / Multi-Agent Research + Dated Capability Timeline

Task ID: R61-E2 · Agent: research-track-E2 · Corpus: /tmp/r61-corpus (built 2026-09-24T00:59:35Z, 329/329 ok)
Scope: multi-agent/fleet research posts, long-running agents, handoff/UX, own-models infra, changelog timeline 2024-09 → 2026-09.

**CORPUS CAVEAT (methodological):** the fetched `changelog.txt` contains ONLY the latest entry (Sep 23, 2026 — Rollouts + Security Review). The full version-numbered IDE changelog (1.x → 3.x) is NOT in the corpus. The dated timeline below is therefore reconstructed from (a) per-post publication dates in blog headers (feature may have shipped days earlier/later), (b) dated CLI changelog (2026-05-07 → 2026-08-26), (c) SDK changelog (1.0.20→1.0.31), (d) version anchors stated inside posts (Cursor 2.0/2.2/3/3.1). Version numbers are given ONLY where the corpus states them; otherwise `ver=?`. Nothing invented; UNKNOWN marked.

Legend: Status = GA | BETA | PREVIEW | ANNOUNCED | RESEARCH | DEPRECATED | UNKNOWN. Autonomy: L0 manual … L4 fully autonomous. Sources: blogs dated by their own header; changelog entry = Sep 23, 2026.

---

## PART 1 — CAPABILITY CATALOG

### E2-01: Agent swarm (planner/worker task tree)
- Category: multi-agent
- Cursor Status: RESEARCH (basis of long-running product, E2-19)
- Source / Date: blog/scaling-agents Jan 14, 2026; blog/self-driving-codebases Feb 5, 2026; blog/agent-swarm-model-economics Jul 20, 2026
- What: Hundreds→thousands of concurrent agents on ONE codebase. Tree decomposition: planner agents (smartest models) split goal recursively into subplanners; workers (cheap fast models) execute leaves. Two-role design "superset of more rigid orchestration systems — swarm's shape grows to cover the problem's contours".
- Invoke: internal research harness (Rust, single large Linux VM, SSH terminal control; logged all messages/actions for replay).
- Runtime behind: role separation for context efficiency (planner never implements, worker never plans); no global synchronization; information propagates up via handoffs (E2-24).
- Prereqs: frontier planner models; massive compute (trillions of tokens); observability.
- Limitations: "nowhere near optimal"; periodic fresh starts needed vs drift; agents occasionally run too long.
- Autonomy: L4 (research; no human in loop for days)
- Evidence: "a planner never implements, so its context never fills with low-level detail" · "peaked at ~1,000 commits per hour across 10M tool calls over a period of one week" · "the new system peaks at around 1,000 commits per second"
- Confidence: HIGH

### E2-02: Coordination failure modes at swarm scale (named taxonomy)
- Category: multi-agent
- Cursor Status: RESEARCH
- Source / Date: blog/agent-swarm-model-economics Jul 20, 2026; blog/scaling-agents Jan 14, 2026
- What: Five named failure modes + fixes: (1) split-brain (two planners duplicate a concept) → planners decide, never delegate decisions; (2) planner contention (fight over files) → shared design docs with compile-checked references + reconciler merges docs; (3) merge conflicts → neutral third-party merge agent acts "on behalf of all parties" like a merge queue; (4) megafiles → workers flag bloat, commits blocked, outside agent decomposes; (5) ossification → "intentional breakage" licensed: agent patches outside scope with explanatory comment, compiler propagates. Plus stacked decorrelated "review lenses" and lock/optimistic-concurrency failures of v1 (20 agents slowed to throughput of 2-3).
- Autonomy: L4
- Evidence: "a neutral third-party agent intervenes on merge conflicts and resolves them on behalf of all parties" · "old run accumulated more than 70,000 conflicts… new run logged fewer than a thousand" · "constraints are more effective than instructions"
- Confidence: HIGH

### E2-03: Agent VCS (custom version control for agents)
- Category: multi-agent
- Cursor Status: RESEARCH
- Source / Date: blog/agent-swarm-model-economics Jul 20, 2026
- What: New VCS built from scratch because Git/Cargo coarse locks are "unworkable" at swarm commit rates; browser swarm peaked ~1,000 commits/hour on Git, new system ~1,000 commits/second. Collision detection and several coordination mechanisms implemented INSIDE the VCS.
- Limitations: no product surface stated; internal to swarm harness.
- Autonomy: L4
- Evidence: "we built a new version control system (VCS) from scratch" · "Every change in the system passes through the VCS, so it is where collisions first become visible"
- Confidence: HIGH

### E2-04: Field Guide (stigmergic self-authored shared context)
- Category: multi-agent
- Cursor Status: RESEARCH (experiment, "early… promising results")
- Source / Date: blog/agent-swarm-model-economics Jul 20, 2026
- What: Folder owned entirely by agents; index.md auto-injected into EVERY agent at start; agents curate content under a line budget; captures surprise encounters for successors (weights frozen, context is the learning channel).
- Autonomy: L4
- Evidence: "a folder owned entirely by agents, whose index.md is automatically injected into every agent at start" · "the environment shapes the next organism" (stigmergy)
- Confidence: HIGH

### E2-05: Multi-agent CUDA kernel optimization (NVIDIA collab)
- Category: multi-agent
- Cursor Status: RESEARCH (validated L4 harness)
- Source / Date: blog/multi-agent-kernels Apr 14, 2026
- What: Same multi-agent harness solved all 235 SOL-ExecBench problems in a single run: "a planner agent that distributed and rebalanced work across autonomous workers based on performance metrics". Entire coordination protocol = one markdown file (output format, rules, tests). System self-learned to call the benchmarking pipeline (continuous test/debug/optimize loop, no developer intervention). Result: 38% geomean speedup over single-agent-optimized PyTorch baseline; 63% of problems beaten; 19% >2x; GEMM to 86% of cuBLAS; SOL 0.9722 on paged GQA. Anti-cheating: pipeline invalidates caching/results beyond B200 physics.
- Runtime behind: 27× B200 GPUs; CUDA C+inline PTX and CuTe DSL runs.
- Limitations: median SOL only 0.56 — compute-limited, not capability-limited.
- Autonomy: L4 (3 weeks unattended)
- Evidence: "The entire coordination protocol lived in a single markdown file" · "planner agent that distributed and rebalanced work across autonomous workers based on performance metrics" · "38% geomean speedup"
- Confidence: HIGH

### E2-06: Parallel multi-agent interface + worktrees (Cursor 2.0)
- Category: fleet
- Cursor Status: GA (since Cursor 2.0)
- Source / Date: blog/2-0 Oct 29, 2025; docs/configuration__worktrees; docs/agent__agents-window
- What: Run many agents in parallel "without them interfering with one another, powered by git worktrees or remote machines". Best-of-N: "having multiple models attempt the same problem and picking the best result significantly improves the final output". UI-native worktrees = isolated Git checkouts per task (Agents Window only; IDE uses Worktree Skills commands).
- Invoke: Agents Window / 2.0 layout; worktree on agent start or move.
- Prereqs: git; Agents Window for UI-native worktrees.
- Autonomy: L2-L3 (user picks results)
- Evidence: "run many agents in parallel without them interfering with one another, powered by git worktrees or remote machines" · "Worktrees let Agent work in isolated Git checkouts"
- Confidence: HIGH

### E2-07: Cloud Agents (fleet of VM-backed agents)
- Category: fleet
- Cursor Status: GA (product post Oct 30, 2025; widened GA referenced "yesterday's launch of Cursor cloud agents" in Feb 26, 2026 post)
- Source / Date: blog/cloud-agents Oct 30, 2025; blog/third-era Feb 26, 2026; blog/agent-web Jun 30, 2025 (web/mobile predecessor)
- What: Many agents at once without laptop online; managed from editor + cursor.com/agents; surfaces: Slack, Linear, GitHub, web, editor. Each runs on own VM → parallelism + asynchronous work; multi-model attempt-and-pick workflow; GPT-5 Codex harness revamped "for long time horizons in the cloud".
- Autonomy: L3-L4 (user reviews artifacts/PR)
- Evidence: "run many agents at once, without requiring your laptop to stay connected" · "Each runs on its own virtual machine, allowing a developer to hand off a task and move on"
- Confidence: HIGH

### E2-08: Agents on web/mobile + PWA + Slack trigger
- Category: fleet / ux-handoff
- Cursor Status: GA
- Source / Date: blog/agent-web Jun 30, 2025
- What: cursor.com/agents — kanban view of agents; launch bug fixes/features/questions in background; review diffs & create PRs from web; PWA install (iOS/Android); @Cursor Slack trigger + completion notifications; multiple agents in parallel to compare results.
- Autonomy: L3
- Evidence: "Kanban view of Cursor Agents performing coding and research tasks" · "trigger agents with '@Cursor' in Slack conversations"
- Confidence: HIGH

### E2-09: Long-running agents (product, research preview)
- Category: long-running
- Cursor Status: PREVIEW (Ultra/Teams/Enterprise only, at cursor.com/agents)
- Source / Date: blog/long-running-agents Feb 12, 2026 (preview released ~Feb 5, 2026 "last week")
- What: Custom harness from the browser-swarm research: agent proposes plan and WAITS for approval before executing; plan + "multiple different agents checking each other's work" to follow through; runs >1 day (36h chat platform, 30h mobile app, 25h RBAC refactor; 52-hour task returning 151k-line PR). Produced "substantially larger PRs with merge rates comparable to other agents".
- Prereqs: Ultra/Teams/Enterprise plan.
- Limitations: preview; new tools needed "to handle the volume of code now being generated".
- Autonomy: L3-L4 (plan-approval gate, then autonomous to PR)
- Evidence: "Long-running agents in Cursor propose a plan and wait for approval" · "I can kick-off a 52-hour task that I don't have to babysit"
- Confidence: HIGH

### E2-10: Long-running research findings (what works at week scale)
- Category: long-running
- Cursor Status: RESEARCH
- Source / Date: blog/scaling-agents Jan 14, 2026; blog/self-driving-codebases Feb 5, 2026
- What: Browser from scratch ~1 week, >1M LoC / 1,000 files, hundreds of concurrent workers pushing one branch "with minimal conflicts". Solid→React in-place migration 3+ weeks (+266K/−193K). Side products: Java LSP 7.4K commits/550K LoC; Win7 emulator 14.6K/1.2M; Excel 12K/1.6M. Learnings: GPT-5.2 best at extended autonomous work (drift/focus/precision); Opus 4.5 "stops earlier and takes shortcuts"; role-specialized models beat one universal model; integrator role REMOVED (bottleneck); judge removed in final design; prompts matter more than harness; single big VM beat distributed complexity; disk became hotspot (GB/s builds); accept small constant error rate + periodic green-branch fixup pass.
- Autonomy: L4
- Evidence: "writing over a million lines of code across 1,000 files" · "We initially built an integrator role… it created more bottlenecks than it solved" · "the prompts matter more"
- Confidence: HIGH

### E2-11: Worker handoff documents (planner-worker protocol)
- Category: long-running / multi-agent
- Cursor Status: RESEARCH
- Source / Date: blog/self-driving-codebases Feb 5, 2026
- What: Workers on own repo copy produce a single handoff: "not just what was done, but important notes, concerns, deviations, findings, thoughts, and feedback" — delivered to requesting planner as follow-up message; planners keep planning after "done"; no cross-talk or global sync; recursive subplanner ownership.
- Autonomy: L4
- Evidence: "a single handoff that the system submits to the planner that requested the task" · "propagating information up the chain to owners with increasingly global views"
- Confidence: HIGH

### E2-12: Freshness / anti-drift mechanisms (long-running)
- Category: long-running
- Cursor Status: RESEARCH (parts productized: self-summarization Mar 17, 2026 post)
- Source / Date: blog/self-driving-codebases Feb 5, 2026; blog/self-summarization Mar 17, 2026
- What: scratchpad.md rewritten (not appended); auto-summarize at context limits; self-reflection + alignment reminders in prompts; agents encouraged to pivot/challenge assumptions anytime; periodic fresh starts.
- Autonomy: L4
- Evidence: "A scratchpad.md should be frequently rewritten versus being appended to" · "We still need periodic fresh starts to combat drift and tunnel vision"
- Confidence: HIGH

### E2-13: Specs as prompts (swarm-as-compiler)
- Category: long-running / multi-agent
- Cursor Status: RESEARCH
- Source / Date: blog/agent-swarm-model-economics Jul 20, 2026
- What: Unit of work becomes the spec (835-page SQLite manual → working Rust DB without source/tests/binaries/internet; graded on sqllogictest; new harness 73–85% at 4h cutoff vs old 11–77%, later 100%). Swarm = probabilistic compiler of intent; planners "parse a goal into task trees, then lower it step by step into executable work".
- Autonomy: L4
- Evidence: "With swarms, the unit of work becomes the spec" · "We gave the swarm 835 pages of prose and it came back with a database"
- Confidence: HIGH

### E2-14: Swarm model economics (planner/worker cost split)
- Category: multi-agent / own-models
- Cursor Status: RESEARCH
- Source / Date: blog/agent-swarm-model-economics Jul 20, 2026
- What: Four model mixes, same quality, wildly different cost: GPT-5.5 solo $10,565 vs Opus 4.8 planner + Composer 2.5 worker $1,339. Workers carry ≥69% (usually >90%) of tokens but planners dominate cost. Frontier intelligence needed only at decomposition/design/trade-offs: GPT-5.5 workers alone $9,373 vs $411 for the whole Opus-planned worker fleet. Fable 5 planner used fewer tokens but its workers burned more → net more expensive. Codebase quality: same suite passed in 9,908 LoC (new) vs 64,305 (old).
- Autonomy: L4
- Evidence: "every model mix produced similar quality while the costs varied enormously, from $1,339… to $10,565" · "the entire worker fleet cost $411"
- Confidence: HIGH

### E2-15: Automations (cron/event-triggered always-on agents)
- Category: fleet
- Cursor Status: GA (announced Mar 5, 2026)
- Source / Date: blog/automations Mar 5, 2026; changelog Sep 23, 2026 (bots enabled from automations tab)
- What: Agents run on schedules or events (Slack message, Linear issue, merged PR, PagerDuty incident, webhooks); spin up cloud sandbox, use configured MCPs/models, verify own output; memory tool to learn from past runs. Use-cases: security review on push to main, agentic codeowners (risk-classified auto-approve or 2 reviewers), incident response, test coverage, bug triage, weekly digests. "Bugbot is in many ways the original automation."
- Autonomy: L4 (event-driven, opens PRs)
- Evidence: "agents run on schedules or are triggered by events like a sent Slack message" · "a memory tool that lets them learn from past runs"
- Confidence: HIGH

### E2-16: Security Agents (fleet of security automations)
- Category: fleet
- Cursor Status: GA (4 templates released Mar 16, 2026)
- Source / Date: blog/security-agents Mar 16, 2026
- What: "a fleet of security agents that continuously identify and repair vulnerabilities" built on Automations; 4 new templates (details in track D catalog). Motivated by 5x PR velocity in 9 months.
- Autonomy: L3-L4
- Evidence: "using Cursor Automations… build a fleet of security agents" · "Today, we're releasing four new [templates]"
- Confidence: HIGH (templates detail → track D)

### E2-17: Rollouts (deploy-monitoring bot)
- Category: fleet
- Cursor Status: GA (Teams/Enterprise), Sep 23, 2026
- Source / Date: changelog Sep 23, 2026 (only corpus changelog entry)
- What: Attaches monitor to every PR; writes an editable monitoring plan as PR comment (risks, intended effect, signals, instrumentation gaps); wakes on deploy events, runs plan against logs/metrics/traces per environment (verified healthy / regression detected / inconclusive). On regression: names suspect change, notifies author; CAN open revert PR or hand finding to a cloud agent. "Does not merge or roll back on its own today." Rebuilt from Firetiger Change Monitors with the Bot Development Kit. Integrations: Origin/GitHub, CD system, Datadog+telemetry. Launch credits ≈50 (Teams) / 500 (Enterprise) changes.
- Autonomy: L3 (watchdog; writes revert PR only for review)
- Evidence: "Rollouts watches every change as it deploys and reports its health per environment" · "it can also open a revert PR for review or hand the finding to a cloud agent"
- Confidence: HIGH

### E2-18: Security Review (PR-exploit bot)
- Category: fleet
- Cursor Status: GA (Teams/Enterprise), Sep 23, 2026
- Source / Date: changelog Sep 23, 2026
- What: Reads every PR in codebase context, posts one review comment of exploitable bugs (SQL/command/template injection, authz bypasses incl. refactor-stopped-running checks, committed secrets, SSRF, unsafe deserialization, vulnerable dependency bumps; traces input flow). Findings carry severity + attack path + proposed fix; dismissal remembered per PR; team rules enforced per codebase. Style/quality stays with Bugbot. Draft PRs skipped.
- Autonomy: L2 (reports; no code changes stated)
- Evidence: "posts one review comment reporting exploitable bugs. Style and quality stay with Bugbot"
- Confidence: HIGH

### E2-19: Firetiger acquisition (production-monitoring agents)
- Category: fleet / platform
- Cursor Status: ANNOUNCED (Aug 13, 2026) → shipped as Rollouts (E2-17)
- Source / Date: blog/firetiger Aug 13, 2026; changelog Sep 23, 2026
- What: Firetiger = agents for software in production: monitor rollouts, catch regressions, investigate incidents, feed findings back to coding agents.
- Evidence: "They monitor rollouts, catch regressions, investigate incidents, and pass what they find back to coding agents"
- Confidence: HIGH

### E2-20: Builds (pre-warmed cloud environments)
- Category: fleet / long-running
- Cursor Status: GA (Aug 13, 2026)
- Source / Date: blog/builds Aug 13, 2026
- What: "ready-to-use copies of your development environment that Cursor prepares continuously in the background, at no additional cost" → cloud agents start 3x faster (no just-in-time boot/clone/install on big repos).
- Autonomy: n/a (infra)
- Evidence: "Cloud agents start 3x faster with builds" · "prepares continuously in the background, at no additional cost"
- Confidence: HIGH

### E2-21: Development environments for cloud agents
- Category: fleet
- Cursor Status: GA (May 13, 2026)
- Source / Date: blog/cloud-agent-development-environments May 13, 2026
- What: Configurable envs so agents "can run tests, query services, or reach APIs" and close the loop (details in track C1 catalog).
- Evidence: "An agent that can write code but can't run tests… cannot close the loop on its work"
- Confidence: HIGH

### E2-22: Self-hosted cloud agents
- Category: fleet / platform
- Cursor Status: GA (Mar 25, 2026)
- Source / Date: blog/self-hosted-cloud-agents Mar 25, 2026
- What: Cloud agents on your own infrastructure; code + tool execution "entirely in your own network" (architecture details → track C1).
- Autonomy: L3-L4
- Evidence: "Today, we're making self-hosted cloud agents generally available"
- Confidence: HIGH

### E2-23: Agents Window (Cursor 3 fleet cockpit)
- Category: fleet / ux-handoff
- Cursor Status: GA (Apr 2, 2026; Cmd+Shift+P → Agents Window)
- Source / Date: blog/cursor-3 Apr 2, 2026; docs/agent__agents-window
- What: Interface built from scratch (not VS Code fork surface), inherently multi-workspace/multi-repo; ALL local + cloud agents in one sidebar regardless of origin (mobile, web, desktop, Slack, GitHub, Linear); cloud agents produce demos/screenshots for verification; diffs view to stage/commit/manage PRs (commit→merged PR); integrated browser; files/LSP for depth; "option to switch back to the Cursor IDE at any time"; Marketplace plugins (MCPs, skills, subagents) one-click.
- Autonomy: L2-L3 control plane
- Evidence: "a unified workspace for building software with agents" · "All local and cloud agents appear in the sidebar"
- Confidence: HIGH

### E2-24: Local ⇄ cloud session handoff
- Category: ux-handoff
- Cursor Status: GA (Apr 2, 2026; CLI "Cloud transfers preserve model and workspace context" Jun 29, 2026)
- Source / Date: blog/cursor-3 Apr 2, 2026; blog/ios-mobile-app Jun 29, 2026; docs/cli__changelog Jun 29, 2026
- What: Move agent session cloud→local to edit/test on desktop; local→cloud to keep running while offline/laptop closed (esp. long-running). Bidirectional, fast; preserves model/workspace context (CLI changelog).
- Autonomy: L2-L3
- Evidence: "Move an agent session from cloud to local when you want to make edits" · "move an agent session from local to cloud to keep it running while you're offline"
- Confidence: HIGH

### E2-25: Cursor for iOS (fleet control from phone)
- Category: ux-handoff / fleet
- Cursor Status: BETA (public beta, all paid plans; iOS 26.0+/iPadOS 26.0+; Android planned)
- Source / Date: blog/ios-mobile-app Jun 29, 2026; docs/cloud-agent__mobile
- What: Native app on same backend as cursor.com/agents and desktop Agents Window: launch cloud agents (any frontier model, voice input, slash commands, choose repo); Remote Control to keep steering agents running ON your computer from the phone (+ keep-computer-awake setting); Live Activities on lock screen + push on finish/needs-input/ready-for-review; review artifacts, inspect diffs, leave follow-ups, MERGE PRs from phone; screenshot-annotate from other apps as visual context; local⇄cloud handoff from phone; repo-less chats planned. Promo: 75% off Composer 2.5 mobile runs through Jul 5, 2026.
- Autonomy: L2-L3 (remote steering + merge authority)
- Evidence: "launch always-on agents in the cloud, or control agents running on your computer from your phone" · "Remote Control to continue directing them from your phone" · "merge the PR directly from the app"
- Confidence: HIGH

### E2-26: Artifacts as review surface (demos/video/previews)
- Category: ux-handoff
- Cursor Status: GA
- Source / Date: blog/third-era Feb 26, 2026; blog/cloud-agents Oct 30, 2025; blog/agent-computer-use Feb 24, 2026
- What: Cloud agents return "logs, video recordings, and live previews rather than diffs" — artifacts make parallel fleets reviewable "without reconstructing each session from scratch"; human role shifts "from guiding each line of code to defining the problem and setting review criteria". (Mechanics → track D computer-use.)
- Autonomy: L3-L4 enabler
- Evidence: "returns with something quickly reviewable: logs, video recordings, and live previews rather than diffs"
- Confidence: HIGH

### E2-27: Plan Mode
- Category: ux-handoff / long-running
- Cursor Status: GA (Oct 7, 2025)
- Source / Date: blog/plan-mode Oct 7, 2025
- What: Shift+Tab in agent input; researches codebase, asks clarifying questions, writes Markdown plan with file paths/code references; inline-editable plan incl. add/remove to-dos; build from plan; save plan to repo; auto-suggest on complex tasks; "supports sending plans to be implemented in the cloud" (cloud-agents post). "Most new features at Cursor now begin with Agent writing a plan."
- Autonomy: L1-L2 gate
- Evidence: "create plans, research your codebase, and run longer agents" · "Cursor's plan mode supports sending plans to be implemented in the cloud"
- Confidence: HIGH

### E2-28: Debug Mode
- Category: ux-handoff
- Cursor Status: GA (Dec 10, 2025; Cursor 2.2)
- Source / Date: blog/debug-mode Dec 10, 2025
- What: New agent loop around runtime info + human verification: multiple hypotheses → instruments code with logging → user reproduces while agent collects variable states/execution paths/timing → targeted fix (often 2-3 lines) → human verifies, agent removes instrumentation. Human-in-loop is explicitly critical for gray-area calls.
- Autonomy: L2 (verification loop)
- Evidence: "an entirely new agent loop built around runtime information and human verification"
- Confidence: HIGH

### E2-29: Design Mode (visual prompts)
- Category: ux-handoff
- Cursor Status: GA (update Jun 5, 2026)
- Source / Date: blog/design-mode Jun 5, 2026
- What: From Cursor browser: click element / multi-select / draw on frozen viewport frame / voice; injects element identity (xpath, component, attributes, computed styles, fiber props) + screenshot for spatial context; fire-and-forget edits enable "managing multiple subagents"; hot reload as agents finish; tuned for Composer 2.5.
- Autonomy: L1-L2 (steering)
- Evidence: "you can click any element, draw on the page, or describe the change by voice" · "makes managing multiple subagents possible"
- Confidence: HIGH

### E2-30: Canvases (interactive agent output + agent-management UIs)
- Category: ux-handoff / fleet
- Cursor Status: GA (Apr 15, 2026; Cursor 3.1)
- Source / Date: blog/canvas Apr 15, 2026
- What: Agents respond with canvases — durable React-based artifacts in Agents Window (alongside terminal/browser/SCM): incident dashboards from Datadog/Databricks/Sentry MCPs, PR-review interfaces that group/prioritize changes, eval-failure investigation (operationalized via a skill), autoresearch progress visualization "while running experiments" — including UIs to "manage other agents in Cursor". Extensible via skills (Docs Canvas skill).
- Autonomy: L1-L3 (review surface for L3/L4 agents)
- Evidence: "agents can create dashboards… or even manage other agents in Cursor" · "canvases are durable artifacts that live alongside your other tools"
- Confidence: HIGH

### E2-31: Dynamic context discovery (files as context interface)
- Category: platform / long-running
- Cursor Status: GA ("live for all users in the coming weeks" from Jan 6, 2026)
- Source / Date: blog/dynamic-context-discovery Jan 6, 2026
- What: Fewer static details; agent pulls context on demand: long tool/terminal outputs → files (tail/read); chat history as file for summarization recovery; Agent Skills open standard; MCP tools synced as per-server folders — agent looks up on demand (−46.9% total agent tokens in A/B for MCP-calling runs); enables proactive re-auth messaging.
- Autonomy: L2-L3 enabler
- Evidence: "reduced total agent tokens by 46.9%" · "provide fewer details up front, making it easier for the agent to pull relevant context on its own"
- Confidence: HIGH

### E2-32: Plugins + Cursor Marketplace
- Category: fleet / platform
- Cursor Status: GA (Feb 17, 2026); private team marketplaces "coming soon" at post date
- Source / Date: blog/marketplace Feb 17, 2026; blog/new-plugins Mar 11, 2026; blog/cursor-3
- What: Plugins bundle MCP servers + skills + subagents + rules + hooks; curated partners (Amplitude, AWS, Figma, Linear, Stripe, Cloudflare, Vercel, Databricks, Snowflake, Hex…); community submissions; Cursor Team Kit (CI/review/testing workflows); team marketplaces with "central governance and security controls". (Governance modes → track B.)
- Autonomy: L2-L3 enabler
- Evidence: "Plugins bundle capabilities like MCP servers, skills, subagents, rules, and hooks"
- Confidence: HIGH

### E2-33: Auto-review (autonomy dial / classifier agent)
- Category: platform / ux-handoff
- Cursor Status: GA — "now the default for new users" (Jun 11, 2026)
- Source / Date: blog/agent-autonomy-auto-review Jun 11, 2026
- What: Small agentic classifier sits in execution path BEFORE tool calls (same RPC stream as parent, subagent-like architecture; can ReadFile/Grep/Glob/ListDir to judge context); feedback-to-parent instead of prompt-spam; blocks ~4% of reviewed actions; only ~7% of chats in Auto-review mode see ≥1 interruption (vs ~40% blocked under some enterprise prior setups); tuned on 6,122 labeled rows + synthetic worst cases; explicitly "a dial than a switch". (Not a security boundary → track D.)
- Autonomy: L3 guardrail layer
- Evidence: "makes decisions around agent autonomy behave more like a dial than a switch" · "only about 7% of total chats in Auto-review mode lead to at least one interruption"
- Confidence: HIGH

### E2-34: Composer model line (first-party agentic models)
- Category: own-models
- Cursor Status: GA (Composer Oct 29, 2025; 1.5 Feb 9, 2026; 2 Mar 19, 2026 + tech report Mar 27; 2.5 May 18, 2026)
- Source / Date: blogs composer*, 2-0, increased-agent-usage
- What: Composer "4x faster than similarly intelligent models", most turns <30s, trained with tools incl. codebase-wide semantic search; 1.5 "above Sonnet 4.5 on Terminal-Bench 2.0"; 2/2.5 power swarm-worker economics and Design Mode. Trainer's own MoE infra: MXFP8 kernels (E2-35), warp decode (E2-36), MoK (E2-37), real-time RL (Mar 26, 2026), SpaceX/SpaceXAI compute (E2-39).
- Autonomy: n/a
- Evidence: "Composer is a frontier model that is 4x faster than similarly intelligent models" · "completing most turns in under 30 seconds"
- Confidence: HIGH

### E2-35: Custom MXFP8 MoE training kernels
- Category: own-models
- Cursor Status: RESEARCH/production infra (Aug 29, 2025)
- Source / Date: blog/kernels Aug 29, 2025
- What: MoE layer rewritten from scratch, zero CUDA-library deps, pure CUDA/PTX + ThunderKittens: 3.5x MoE layer speedup → 1.5x end-to-end Blackwell training speedup (2x vs Hopper setup).
- Evidence: "we rewrote the entire MoE layer from scratch at the GPU kernel level" · "1.5x end-to-end training speedup on Blackwell"
- Confidence: HIGH

### E2-36: Warp decode (MoE INFERENCE)
- Category: own-models
- Cursor Status: RESEARCH (Apr 6, 2026)
- Source / Date: blog/warp-decode Apr 6, 2026
- What: MoE inference acceleration "by flipping the parallelism axis": 1.8x faster AND more accurate inference. NOTE: answers the task's "mixture-of-kittens (inference?)" question — MoK (E2-37) is TRAINING; inference is warp decode.
- Evidence: "1.8x faster and more accurate MoE model inference"
- Confidence: HIGH

### E2-37: Mixture-of-Kittens (MoK) — open-source MoE training megakernel
- Category: own-models
- Cursor Status: RESEARCH / OPEN-SOURCED (Aug 4, 2026; github.com/cursor/mixture-of-kittens)
- Source / Date: blog/mixture-of-kittens Aug 4, 2026
- What: Deterministic MoE TRAINING megakernel for GB300 NVL72: fuses ALL MoE communication + computation into a single kernel (push/pull per-operator choice, ring token buffers to kill CPU-GPU sync); up to 2.37x MXFP8 forward vs fastest public baseline (1.78x backward, 1.92x BF16 fwd, 1.58x BF16 bwd); 1.41x end-to-end tokens/s on 512-GPU production stack. Powers Composer training "across tens of thousands of GPUs". Agents co-built it ("Agents automated the simpler tasks… helped us get through the harder ones").
- Evidence: "fuses all MoE communication and computation into a single kernel" · "up to 2.37x higher MXFP8 forward throughput" · "It now powers Composer training across tens of thousands of GPUs"
- Confidence: HIGH

### E2-38: Router (model routing)
- Category: own-models / platform
- Cursor Status: GA (blog/router Jul 22, 2026; how-cursor-router-works Aug 6, 2026)
- Source / Date: blogs router, how-cursor-router-works
- What: Auto model selection layer (mechanics → track A/own-models posts); CLI "Auto stays pinned in the picker" (Aug 11, 2026), "New installs start on Auto" (Jul 6, 2026).
- Evidence: "Auto stays pinned in the picker" (CLI changelog)
- Confidence: MED (details not re-derived in E2)

### E2-39: SpaceX acquisition + SpaceXAI partnership
- Category: platform
- Cursor Status: ANNOUNCED→COMPLETED (partnership April 2026; acquisition complete Aug 14, 2026)
- Source / Date: blog/joining-spacex Aug 14, 2026; blog/spacex-model-training Apr 21, 2026
- What: Access to "the largest fleet of GPUs in the world" for stronger, cheaper models; Grok 4.6 (Aug 12, 2026) as first joint-era release; Grok line (4.5 Jul 8, 2026; 4.5 model card Jul 14; 4.6 Aug 12) in Cursor.
- Evidence: "Cursor has officially been acquired by SpaceX" · "access to the largest fleet of GPUs in the world"
- Confidence: HIGH

### E2-40: Usage pools / agent-usage expansion
- Category: platform
- Cursor Status: GA (Feb 11, 2026)
- Source / Date: blog/increased-agent-usage Feb 11, 2026
- What: Two pools for individual plans: first-party models pool (Auto/Composer — 3x Composer 1.5 limit, 6x promo to Feb 16) + API pool (≥$20/mo + overage); new in-editor usage page. Response to shift "toward coding with agents" and "ambitious changes across their entire codebase".
- Evidence: "There are now two usage pools" · "Composer 1.5 now has 3x the usage limit of Composer 1"
- Confidence: HIGH

### E2-41: Third era thesis (fleet framing)
- Category: platform
- Cursor Status: ANNOUNCED (strategy, Feb 26, 2026)
- Source / Date: blog/third-era Feb 26, 2026
- What: Era 1 = Tab autocomplete (~2 years); Era 2 = synchronous prompt-and-response agents (<1 year?); Era 3 = "agents that can tackle larger tasks independently, over longer timescales, with less human direction". Cursor = "the factory that creates your software" made of "fleets of agents that they interact with as teammates". Internal proof: 35% of merged PRs created by agents on cloud VMs; agent users 2x Tab users (was inverse 2.5x in Mar 2025); agent usage +15x YoY. Adoption traits: agents write ~100% of their code; time goes to decomposition/artifact review/feedback; multiple agents spun up in parallel.
- Evidence: "More than one-third of the PRs we merge are now created by agents" · "Agent usage in Cursor has grown over 15x in the last year" · "we now have 2x as many agent users as Tab users"
- Confidence: HIGH

### E2-42: Cursor CLI (agent in terminal/headless)
- Category: fleet / platform
- Cursor Status: GA (Aug 7, 2025)
- Source / Date: blog/cli Aug 7, 2025; docs/cli__changelog (May 7 → Aug 26, 2026 in corpus)
- What: "Cursor Agent from the CLI or headless in any environment". Dated 2026 additions on E2 surface: persistent sessions (agent persist, detach/attach/resume — Aug 26, 2026); steering + subagents with full transcript read (Aug 11, 2026); subagents keep context across resumes (Jul 6); worktree setup respects workspace trust (Jul 13); cloud transfers preserve model/workspace context (Jun 29); durable goals + sticky skills/custom modes (Aug 11). (Full CLI catalog → track C2.)
- Autonomy: L2-L4 (config-dependent)
- Evidence: "Keep agents running after you disconnect" · "Steer a running turn, then interrupt"
- Confidence: HIGH

### E2-43: Bugbot line (review agent fleet trigger)
- Category: fleet
- Cursor Status: GA (out of beta Jul 24, 2025; learning Jan/Apr 2026; Autofix Feb 26, 2026; changes May/Jun 2026)
- Source / Date: blogs bugbot-* (dates in timeline)
- What: PR-review agent, "the original automation… triggered thousands of times a day"; Autofix spawns fix agents (details → track D). Anchors timeline for review-automation arc.
- Evidence: "Bugbot is in many ways the original automation! It runs when a PR is opened or updated"
- Confidence: HIGH (pointer)

### E2-44: Sandboxing + computer use for local/cloud agents
- Category: platform / fleet
- Cursor Status: GA (sandbox Feb 18, 2026; computer use Feb 24, 2026)
- Source / Date: blogs agent-sandboxing, agent-computer-use
- What: OS-level sandbox enables auto-approve autonomy ("Users who auto-approve these commands unlock significantly more powerful agents"); cloud agents get own VM with desktop to test work and produce artifacts (mechanics → track D). Anchors timeline.
- Evidence: "Users who auto-approve these commands unlock significantly more powerful agents, but at the cost of increased risk" · "Cursor agents can now control their own computers"
- Confidence: HIGH (pointer)

### E2-45: Semantic search / retrieval for agents
- Category: platform
- Cursor Status: GA (semsearch Nov 6, 2025; secure indexing Jan 27, 2026; fast regex Mar 23, 2026)
- Source / Date: blogs semsearch, secure-codebase-indexing, fast-regex-search
- What: Own embedding model + indexing pipelines for NL retrieval; Composer trained with semantic search tool; secure indexing for code protection. Anchors timeline.
- Evidence: "we've trained our own embedding model and built indexing pipelines for fast retrieval"
- Confidence: HIGH (pointer)

### E2-46: IDE-era primitives predating the fleet era (timeline anchors)
- Category: platform
- Cursor Status: GA / historical
- Source / Date: blog/shadow-workspace Sep 1, 2024; blog/supermaven Nov 12, 2024; blog/tab-update Jan 13, 2025; blog/tab-rl Sep 12, 2025; blog/enterprise Oct 31, 2025; blog/codex-model-harness Dec 4, 2025; blog/hooks-partners Dec 22, 2025; blog/jetbrains-acp Mar 4, 2026; blog/cursorbench Mar 11, 2026; blog/typescript-sdk Apr 29, 2026; blog/continually-improving-agent-harness Apr 30, 2026; blog/organizations Jun 3, 2026; blog/aiuc-1 Aug 13, 2026
- What: Shadow workspace (pre-agent safe iteration), Supermaven acquisition (fast tab), Tab RL, Enterprise launch, per-model harness tuning (Codex), hooks partner launch, JetBrains ACP, CursorBench eval, TS SDK, harness-improvement methodology, organizations, AIUC-1 (trust certification, detail UNKNOWN in E2 corpus read).
- Evidence: (dates only — see timeline)
- Confidence: MED (one-line anchors)

---

## PART 2 — DATED TIMELINE (agent-relevant, 2024-09 → 2026-09)

Format: date — capability — status/type — source. `ver=?` = corpus contains no version number. Full IDE changelog versions NOT in corpus (see caveat).

**2024**
- Sep 1, 2024 — Shadow Workspace (safe iteration sandbox for edits) — GA-era research — blog/shadow-workspace
- (2024-09→2025-05: no agent-fleet posts in corpus; gap = pre-background-agents era; details UNKNOWN in corpus)

**2025**
- Jun 16, 2025 — new Ultra tier — platform — blog/new-tier
- Jun 30, 2025 — Agents on web & mobile (cursor.com/agents, PWA, kanban, @Cursor Slack trigger, parallel agents) — GA — blog/agent-web  ← background/remote agents entry point
- Jul 4, 2025 — June 2025 pricing (agent usage) — platform — blog/june-2025-pricing
- Jul 24, 2025 — Bugbot out of beta — GA — blog/bugbot-out-of-beta
- Aug 7, 2025 — Cursor Agent CLI (terminal/headless agent) — GA — blog/cli
- Aug 7, 2025 — GPT-5 in Cursor — model — blog/gpt-5
- Aug 12, 2025 — Aug 2025 pricing — platform — blog/aug-2025-pricing
- Aug 21, 2025 — Linear integration — integration — blog/linear
- Aug 29, 2025 — MXFP8 MoE training kernel rebuild (1.5x training speedup) — own-models infra — blog/kernels
- Sep 12, 2025 — Tab RL — own-models — blog/tab-rl
- Oct 1, 2025 — Java support — platform — blog/java
- Oct 7, 2025 — Plan Mode (plan tools, clarifying questions, plan file, send-to-cloud) — GA — blog/plan-mode
- Oct 29, 2025 — **Cursor 2.0 + Composer** (agent-first UI; multi-agent parallel w/ worktrees + remote machines; best-of-N models; native browser tool; Composer 4x-faster model) — GA — blog/2-0, blog/composer
- Oct 30, 2025 — **Cloud Agents** (manage from editor; Slack/Linear/GitHub/web; multi-model attempt-and-pick; long-horizon Codex harness) — GA — blog/cloud-agents
- Oct 31, 2025 — Cursor Enterprise launch — GA — blog/enterprise
- Nov 6, 2025 — Semantic search for agents (own embeddings) — GA — blog/semsearch
- Nov 11, 2025 — productivity research (SWE LLM study) — research — blog/productivity
- Nov 12, 2024 — Supermaven acquisition — platform — blog/supermaven (listed here for completeness; actual date Nov 12, 2024)
- Nov 13, 2025 — Series D — company — blog/series-d
- Dec 4, 2025 — Codex model harness tuning (per-model harness) — platform/research — blog/codex-model-harness
- Dec 10, 2025 — **Debug Mode** (runtime-log agent loop, human verification) — GA, Cursor 2.2 — blog/debug-mode
- Dec 11, 2025 — Browser visual editor — GA — blog/browser-visual-editor
- Dec 19, 2025 — Graphite partnership — integration — blog/graphite
- Dec 22, 2025 — Hooks + partners — GA — blog/hooks-partners

**2026 Q1**
- Jan 6, 2026 — Dynamic context discovery (files-as-context; MCP tool discovery −46.9% tokens; terminal-as-files) — research→GA — blog/dynamic-context-discovery
- Jan 9, 2026 — Agent best practices — docs/research — blog/agent-best-practices
- Jan 13, 2026 — CLI changelog window opens in corpus (releases from May 7, 2026; earlier CLI entries UNKNOWN)
- Jan 14, 2026 — **Scaling long-running autonomous coding** (planners/workers, 1M+ LoC browser, integrator removed, model-per-role) — RESEARCH — blog/scaling-agents
- Jan 15, 2026 — Building Bugbot — research — blog/building-bugbot
- Jan 27, 2026 — Secure codebase indexing — GA — blog/secure-codebase-indexing
- Feb 5, 2026 — **Towards self-driving codebases** (thousands of agents; final planner/subplanner/worker design; handoff docs; freshness mechanisms; research preview opened to some users) — RESEARCH/PREVIEW — blog/self-driving-codebases
- Feb 9, 2026 — Composer 1.5 — GA — blog/composer-1-5
- Feb 11, 2026 — Two usage pools; Composer 1.5 3x limits (6x promo) — GA — blog/increased-agent-usage
- Feb 12, 2026 — **Long-running agents research preview** at cursor.com/agents (Ultra/Teams/Enterprise; plan-approval gate; multi-agent cross-checking; 25-52h runs) — PREVIEW — blog/long-running-agents
- Feb 17, 2026 — **Plugins + Cursor Marketplace** (bundles of MCP/skills/subagents/rules/hooks) — GA — blog/marketplace
- Feb 18, 2026 — Secure sandbox for local agents (OS-level; enables auto-approve) — GA — blog/agent-sandboxing
- Feb 24, 2026 — Computer use: agents control their own computers (VM desktop, artifacts) — GA — blog/agent-computer-use
- Feb 25, 2026 — Cloud agents launch referenced as "yesterday" — GA widening — blog/third-era (inferential date, ±1 day)
- Feb 26, 2026 — **"Third era" thesis** (35% of internal PRs agent-made; 15x agent usage growth; fleets-as-teammates) + Bugbot Autofix — ANNOUNCED/GA — blog/third-era, blog/bugbot-autofix
- Mar 2, 2026 — PlanetScale case — case study
- Mar 3, 2026 — Cursor Support (support agent) — product — blog/cursor-support
- Mar 4, 2026 — JetBrains ACP — GA — blog/jetbrains-acp
- Mar 5, 2026 — **Automations** (cron + Slack/Linear/GitHub/PagerDuty/webhook triggers; memory tool; cloud sandbox) — GA — blog/automations
- Mar 11, 2026 — CursorBench + new plugins — GA/research — blog/cursorbench, blog/new-plugins
- Mar 16, 2026 — **Security Agents** (fleet of security automations, 4 templates) — GA — blog/security-agents
- Mar 17, 2026 — Self-summarization — GA/research — blog/self-summarization
- Mar 19, 2026 — Composer 2 — GA — blog/composer-2
- Mar 23, 2026 — Fast regex search — GA — blog/fast-regex-search
- Mar 25, 2026 — **Self-hosted cloud agents GA** — GA — blog/self-hosted-cloud-agents
- Mar 26, 2026 — Real-time RL for Composer — research — blog/real-time-rl-for-composer
- Mar 27, 2026 — Composer 2 technical report — research — blog/composer-2-technical-report

**2026 Q2**
- Apr 2, 2026 — **Cursor 3** (new interface from scratch; multi-repo; Agents Window; local⇄cloud handoff; diffs view; "fleets of agents work autonomously") — GA — blog/cursor-3
- Apr 6, 2026 — Warp decode (MoE inference, 1.8x) — research — blog/warp-decode
- Apr 8, 2026 — Bugbot learning (learned rules) — GA — blog/bugbot-learning
- Apr 14, 2026 — **Multi-agent kernels** (NVIDIA; 235 kernels; planner rebalances by metrics; 38% geomean; 3-week autonomous run) — RESEARCH — blog/multi-agent-kernels
- Apr 15, 2026 — **Canvases** (Cursor 3.1; durable interactive agent output; agent-management UIs) — GA — blog/canvas
- Apr 15, 2026 — Amplitude, better-models-for-ambitious-work — platform — blogs
- Apr 21, 2026 — SpaceX model-training partnership announced; app stability — ANNOUNCED — blogs
- Apr 29, 2026 — TypeScript SDK (public beta) — BETA — blog/typescript-sdk
- Apr 30, 2026 — Continually improving agent harness (eval-driven methodology) — research — blog/continually-improving-agent-harness
- May 7/14/20, 2026 — CLI releases (details in cli__changelog) — GA — docs
- May 11, 2026 — May 2026 Bugbot changes — GA — blog/may-2026-bugbot-changes
- May 13, 2026 — Development environments for cloud agents — GA — blog/cloud-agent-development-environments
- May 18, 2026 — Composer 2.5 — GA — blog/composer-2-5
- May 22, 2026 — Gartner MQ leadership — company — blog/cursor-leads-gartner-mq-2026
- Jun 1, 2026 — Teams pricing — platform — blog/teams-pricing-june-2026
- Jun 3, 2026 — Organizations — GA — blog/organizations
- Jun 5, 2026 — Design Mode update (click/draw/voice; multi-subagent flow) — GA — blog/design-mode
- Jun 9/22/29, 2026 — CLI releases: cloud transfers preserve context (Jun 29) — GA — docs/cli__changelog
- Jun 10, 2026 — Bugbot updates — GA — blog/bugbot-updates-june-2026
- Jun 11, 2026 — **Auto-review** (classifier-governed autonomy; default for new users) — GA — blog/agent-autonomy-auto-review
- Jun 25, 2026 — Reward-hacking benchmarks study — research — blog/reward-hacking-coding-benchmarks
- Jun 29, 2026 — **Cursor for iOS public beta** (launch/track/merge from phone; Remote Control of local agents) — BETA — blog/ios-mobile-app
- Jun 30, 2026 — Cloud agent environment deep-dive — GA — blog/cloud-agent-environment

**2026 Q3**
- Jul 6, 2026 — CLI: Auto default on new installs; model switch via slash; subagents keep context across resumes — GA — docs/cli__changelog
- Jul 8, 2026 — Grok 4.5 in Cursor — model — blog/grok-4-5
- Jul 13, 2026 — CLI: plugin marketplaces in shell; worktree workspace trust — GA — docs/cli__changelog
- Jul 20, 2026 — **Agent swarms and the new model economics** (v2 swarm; custom agent VCS @1,000 commits/s; merge-umpire; design-doc reconciler; Field Guide; SQLite-from-docs 100%; $1,339 vs $10,565 mixes) — RESEARCH — blog/agent-swarm-model-economics
- Jul 22, 2026 — Router — GA/research — blog/router
- Jul 28, 2026 — Cursor Start India; Vercel — company/integration
- Jul 30, 2026 — Cloud agent environment (part 2) — GA — blog/cloud-agent-environment
- Aug 4, 2026 — **Mixture-of-Kittens open-sourced** (deterministic MoE training megakernel NVL72; 2.37x fwd; 1.41x e2e) — RESEARCH/OSS — blog/mixture-of-kittens
- Aug 6, 2026 — How the Cursor router works — research — blog/how-cursor-router-works
- Aug 11, 2026 — CLI: steering + subagents (full transcript), persistent-mode precursors, durable goals, sticky skills/modes — GA — docs/cli__changelog
- Aug 12, 2026 — Grok 4.6 (first SpaceX-era model) — model — blog/grok-4-6
- Aug 13, 2026 — **Builds** (3x faster cloud starts, continuously prepared envs); Firetiger acquisition; AIUC-1 — GA/ANNOUNCED — blogs
- Aug 14, 2026 — **SpaceX acquisition complete** (GPU fleet for model training) — ANNOUNCED→done — blog/joining-spacex
- Aug 26, 2026 — CLI: **persistent sessions** (agent persist, detach/attach/resume); wake hibernated workers for follow-ups; shared-desktop viewing — GA — docs/cli__changelog
- Sep 23, 2026 — **Rollouts + Security Review bots** (deploy health monitoring w/ revert-PR-or-cloud-agent-handoff; exploitable-bug PR review; Teams/Enterprise; from automations tab) — GA — changelog.txt (ONLY changelog entry in corpus)

**Not found in corpus / UNKNOWN:** IDE changelog version numbers for 1.x era (background agents 2025 GA under that name, subagents/hooks/skills exact IDE version numbers, projects GA version, memory GA version, Composer model version-to-IDE-version mapping). CLI changelog in corpus starts May 7, 2026 — earlier CLI versions UNKNOWN. Android app: "planned" only.

---

## PART 3 — ME2-OS PARITY NOTES (from E2 surface only)

1. **Cursor's fleet architecture = planner/worker trees + handoff docs + review lenses**, converged on empirically: locks fail, integrators fail, judges were removed; context-efficiency (role separation) beats parallelism as the scaling mechanism. Directly maps to ME2 mesh/flot concepts: single-writer responsibilities, event-on-transition supervision, hash-chained journals = their "observability first" lesson.
2. **Coordination-in-VCS**: they moved conflict visibility into a custom VCS (1,000 commits/s); ME2 equivalent lever = mirror/sha256-reconcile pattern already built (R59); merge-umpire-as-agent is the borrowable pattern.
3. **Field Guide = agent-owned shared memory with line budget injected at start** — cheap to prototype in ME2 (skills/ext + mirror), high evidence of value.
4. **Handoff docs (notes/concerns/deviations/feedback) as the inter-agent message unit** — matches ME2 bus events; formalizing a handoff envelope would mirror their protocol.
5. **Specs-as-prompts economics**: frontier planner + cheap worker fleet cut cost ~8x at equal quality (Opus 4.8 + Composer 2.5: $1,339 vs GPT-5.5 solo $10,565) — model-mix policy is a first-class ME2 lever.
6. **Autonomy as a dial (Auto-review)**: classifier-in-loop w/ feedback-to-agent instead of approval spam (7% interruption rate) — pairs with ME2 non-bypass manifest + sandbox canon.
7. **Long-running product shape**: plan-approval gate → autonomous multi-day run → artifacts + PR; preview-gated (not Enterprise); ME2 equivalent = long-lived exthost + subscriptions.
8. Timeline gaps to close next round: full IDE changelog (versions), memory/projects GA versions, subagents product version, Android app.
