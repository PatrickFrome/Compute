# R61-E1 — Cursor Model Routing, Context Engineering, Evals, Memory, Own Models

Agent: research-track-E1 (RESEARCH-ONLY). Corpus: /tmp/r61-corpus/ (all files have SOURCE_URL + FETCHED_AT 2026-09-24). No code changes.
Scope files: docs/cursor-router, models-and-pricing, evals, models__composer-1/2-5, models__gpt-5-6-{luna,sol,terra}, customizing__aws-bedrock + 18 blogs. Supplementary greps: models__* catalog, enterprise model mgmt, request-based-legacy pricing.
Statuses are as of fetch 2026-09-24. "GA" = documented as live product behavior in current docs/blog.

Model catalog stats (from 55 docs/models__*.txt files): 55 model entries / 7 provider families —
Anthropic 14, OpenAI 19, Google 8, Cursor first-party 5 (Composer 1, Composer 2.5, Grok 4.5/4.6/4.7 — Grok docs list provider=Cursor), Moonshot 2, Z.ai 1 (glm-5.2), Meta 1 (Muse Spark 1.3).
Context windows: 200k default (Claude/Gemini/Kimi/Composer), 256k (Grok), 262k (Kimi K2.7), 272k (all GPT-5.x), 300k (Fable 5.x, Opus 5.5, Muse Spark); Max context 1M (most Claude/Gemini/GPT-5.4+/Kimi K3/Muse), 500k (Grok 4.7), "-" (Composer, older GPT).

---

## MODEL ROUTING

### router-auto: Cursor Router (the engine behind Auto)
- Category: model-routing
- Cursor Status: GA (Teams & Enterprise only; launched Jul 22, 2026)
- Source: docs/cursor-router.txt; blog/router (Jul 22, 2026); blog/how-cursor-router-works (Aug 6, 2026)
- What: classifier run on each agent request that picks the model per task type/complexity; "data-driven and managed by Cursor"; pool changes as models ship; user cannot hand-pick which model Auto uses, only the optimization mode. Deployed across desktop, web, iOS, CLI, SDK.
- Invoke: model picker → Auto → Optimize For {Cost, Balance, Intelligence}; SDK model id "auto-smart" w/ optimize_for param; Cursor.models.list() to confirm availability.
- Runtime behind: trained on 600k+ live requests; online A/B across millions of requests; reward = user satisfaction (AFC). Cache-aware in training and eval (includes cache-miss cost of switching models).
- Prereqs: Teams/Enterprise; Enterprise: manual enable, per-org-group config, Grok 4.6 enabled is REQUIRED; blocking too many models degrades/disables routing.
- Limitations: not on individual plans (Auto modes exist there but router is Teams+); no per-request model hand-pick; routing quality drops if too many models blocked.
- Results (claimed): Auto Intelligence ≈ Fable-level satisfaction at 60%→68% lower cost; Auto Balance > Opus 4.8 satisfaction at 36%→41% lower cost; early-access enterprises saved 30–50% vs all-Opus-4.8; cost per commit: Intelligence $6.76, Balance $4.63 vs Fable $12.69 / Opus 4.8 $7.34.
- Autonomy: L2 (system selects model autonomously; user/admin steers via mode + policy, no approval gate)
- Evidence: "Cursor Router runs a classifier on each agent request and routes it based on task type and complexity"; "We trained Cursor Router on 600k+ live requests"; "enabling Grok 4.6 is a requirement for the router to work"
- Confidence: HIGH

### router-compass: Compass complexity predictor
- Category: model-routing
- Cursor Status: GA (production subsystem, publicly explained Aug 6, 2026)
- Source: blog/how-cursor-router-works
- What: model that predicts per-turn whether the user will be satisfied — used as a proxy for task complexity; outputs continuous score 0..1; threshold τ decides price-efficient model vs frontier escalation. Trained on the performance signal (next-user-action inference: moving on = positive, correcting = negative).
- Runtime behind: dataset of hundreds of thousands of turns from live Cursor traffic (privacy-mode respected); offline cross-validation → live A/B.
- Limitations: threshold is a cost/quality tradeoff knob (sweep published); offline analysis "cannot fully capture" production behavior.
- Autonomy: L3 (fully automatic per-turn decision inside router)
- Evidence: "Compass estimates the complexity of each turn by predicting whether the user will be satisfied"; "Turns that Compass rated as most likely to succeed received a positive performance signal 96% of the time"
- Confidence: HIGH

### router-taxonomy: Task router (domains/tasks/modifiers taxonomy)
- Category: model-routing
- Cursor Status: GA (production subsystem)
- Source: blog/how-cursor-router-works; blog/router
- What: when Compass ≥ τ, classifies the turn into a taxonomy learned from real traffic — Domains (backend, database schemas, frontend), Tasks (fixing bugs, running commands, writing tests), Modifiers (bounded edits, product questions, visual-heavy changes) — then picks the frontier model with strongest observed performance for that label.
- Decision rules: (1) candidate eligible only if observed perf clears a one-sided 75% uplift-confidence threshold vs price-efficient model; (2) optimizer picks traffic-weighted best mix within the mode's per-turn cost budget. Balance = more traffic on cheap path + smaller budget; Intelligence = bigger budget.
- Known model strengths (from production data): Grok = broad routine work (Git, DB ops); Sol = planning + codebase comprehension; Opus = execution-heavy (devops, DB queries, perf); Fable = debugging + visual implementation. "No model dominates every kind of work."
- Autonomy: L3
- Evidence: "classify the turn using a taxonomy of tasks, domains, and modifiers learned from real developer traffic"; "75% confidence that the improvement is real"; "Grok offers strong value across broad, routine work"
- Confidence: HIGH

### router-modes: Auto optimization modes (Cost/Balance/Intelligence)
- Category: model-routing
- Cursor Status: GA
- Source: docs/cursor-router.txt; blog/router
- What: three points on the cost-intelligence Pareto frontier. Cost = previous Auto logic, optimizes token spend; Balance = intelligence+speed+cost; Intelligence = most capable models for hard tasks at sub-frontier cost. Modes consume limits at different rates; switchable anytime; bill at list price of routed-to model (+ Cursor Token Rate if third-party).
- Autonomy: L1 (user selects policy; system executes)
- Evidence: "Cost: Uses the previous Auto routing logic. It optimizes token spend"; "Balance: Optimizes for intelligence, speed, and cost"
- Confidence: HIGH

### router-admin: Router team/enterprise admin controls
- Category: model-routing
- Cursor Status: GA
- Source: docs/cursor-router.txt
- What: dashboard toggles — Enable Router (off by default on Enterprise, per-org-group configurable), Routing preferences (disable up to 2 of 3 modes), Underlying model display (show/hide which model Auto routed to; hidden is default+recommended), Impose Auto (Soft = default for new chats; Hard = lock picker to Auto).
- Autonomy: L2 (admin sets constraints; runtime autonomous)
- Evidence: "Hidden is the default and recommended, so results are judged on their own merit rather than by model name"; "Soft defaults each new chat to Auto; members can still switch models"
- Confidence: HIGH

### router-sdk: Router via SDK (auto-smart)
- Category: model-routing
- Cursor Status: GA (in TS/Python SDK)
- Source: docs/cursor-router.txt
- What: model id "auto-smart" with params optimize_for = cost|balanced|intelligence; Agent.create({model:{id:"auto-smart", params:[...]}}); discover via Cursor.models.list(). SDK is agent-workflow runner, NOT raw chat-completions.
- Autonomy: L2
- Evidence: "The TypeScript SDK and Python SDK expose Cursor Router as model id auto-smart with parameter optimize_for"
- Confidence: HIGH

### router-cache-aware: Cache-aware routing economics
- Category: model-routing
- Cursor Status: GA
- Source: blog/router; blog/how-cursor-router-works
- What: routing decisions account for prompt-cache misses caused by switching models mid-conversation — modeled in training data and measured in reported savings. "Real routing happens across a conversation: which model to pick, and when to switch."
- Autonomy: L3
- Evidence: "It is trained on a dataset where routing results in cache misses"; "including cache misses caused by switching models"
- Confidence: HIGH

### model-picker-ui: Manual model selection UI
- Category: model-routing
- Cursor Status: GA
- Source: docs/models-and-pricing.txt; docs/cursor-router.txt
- What: user picks a specific third-party model → usage draws from Other Models pool at that model's API rate; or Auto → router. ~60% of developers pick a single daily-driver model (router motivation). Fast-mode tiers and effort levels are per-model selectable (fixed medium effort on Start plan).
- Autonomy: L0 (manual selection)
- Evidence: "When you select a specific third-party model, usage is drawn from the Other Models pool at that model's API rate"
- Confidence: HIGH

### token-rate: Cursor Token Rate
- Category: model-routing
- Cursor Status: GA (Teams/Enterprise)
- Source: docs/models-and-pricing.txt; docs/customizing__aws-bedrock.txt
- What: +$0.25 per million tokens on third-party model usage (included, on-demand, and BYOK); applies when third-party selected directly AND when Auto routes to third-party; first-party (Grok, Composer) exempt; applies to Bedrock-routed requests (cursorTokenFee field).
- Autonomy: L0 (pricing policy)
- Evidence: "third-party model requests include a Cursor Token Rate of $0.25 per million tokens"
- Confidence: HIGH

### usage-pools: Two usage pools (Cursor Models / Other Models)
- Category: model-routing
- Cursor Status: GA
- Source: docs/models-and-pricing.txt
- What: Cursor Models pool = Grok 4.7/4.6/4.5 + Composer 2.5 (generous included usage); Other Models = third-party at API price. Start (India, ₹649/mo) = Cursor Models only, no Auto/Bugbot/SDK/Other pool. Plans: Pro $20, Pro Plus $60, Ultra $200; Teams Standard $40 / Premium $120 (5x limits). On-demand at same API rates; "Requests are never downgraded in quality or speed."
- Autonomy: L0
- Evidence: "The Cursor Models pool includes Grok 4.7, Grok 4.6, Grok 4.5, and Composer 2.5"
- Confidence: HIGH

### model-access-controls: Enterprise model access control
- Category: model-routing
- Cursor Status: GA (Enterprise; contact sales)
- Source: docs/enterprise__model-and-integration-management.txt (supplementary)
- What: Team Settings → Models baseline + Organization Group widening; reconciled by most-permissive (union) rule; Admin API model-access routes; BYOK controls team-level only. Router respects these blocks (routes to allowed model).
- Autonomy: L2
- Evidence: "A model is allowed if the team or any of the user's Organization Groups allows it"
- Confidence: HIGH

### bedrock: AWS Bedrock BYO-infra routing
- Category: model-routing
- Cursor Status: GA
- Source: docs/customizing__aws-bedrock.txt
- What: route requests through customer's AWS Bedrock account. IAM role + External ID (anti confused-deputy; Cursor roleAssumer arn:aws:iam::289469326074) or access keys (less secure). Per-user IDE toggle off by default; explicit Bedrock model IDs (us./eu./apac./ca. prefixes) route via Bedrock; standard names + Auto stay on Cursor providers. Usage appears in dashboard as BYOK kind, model cost ≈ $0, Cursor Token Rate still applies.
- Invoke: dashboard Settings → Bedrock IAM Role (ARN, region, test model) → Validate & Save; IDE Settings → Models → AWS Bedrock toggle.
- Limitations: policy is admin-gated; non-Bedrock models fail with "not supported by bedrock" while toggle on; AWS inference cost not surfaced in Cursor.
- Autonomy: L1 (explicit config + manual model pick)
- Evidence: "Route AI requests through your AWS Bedrock account instead of Cursor's model providers"; "Standard model names ... and Auto continue to route through Cursor's model providers"
- Confidence: HIGH

---

## CONTEXT ENGINEERING

### dcd: Dynamic context discovery (pattern)
- Category: context-engineering
- Cursor Status: GA ("live for all users in the coming weeks", Jan 6, 2026)
- Source: blog/dynamic-context-discovery
- What: harness philosophy — provide fewer details up front; agent pulls relevant context on demand; files are the universal primitive (vs static injection). Contrasts static context; token-efficient; reduces contradictory context.
- Autonomy: L3 (agent autonomously pulls context; guardrail = plain files)
- Evidence: "We're calling this pattern dynamic context discovery, in contrast to static context which is always included"; "files have been a simple and powerful primitive"
- Confidence: HIGH

### dcd-tool-files: Long tool responses written to files
- Category: context-engineering
- Cursor Status: GA
- Source: blog/dynamic-context-discovery
- What: instead of truncating long shell/MCP outputs (data loss), Cursor writes output to a file; agent tails/reads as needed → "fewer unnecessary summarizations when reaching context limits."
- Autonomy: L3
- Evidence: "we instead write the output to a file and give the agent the ability to read it"
- Confidence: HIGH

### dcd-summarization-history: Chat history as files during summarization
- Category: context-engineering (memory-adjacent)
- Cursor Status: GA
- Source: blog/dynamic-context-discovery
- What: on context-limit (or manual) summarization, agent gets a reference to the history file; can search history to recover details lost in the lossy summary.
- Autonomy: L3
- Evidence: "we use the chat history as files to improve the quality of summarization"; "it can search through the history to recover them"
- Confidence: HIGH

### dcd-skills: Agent Skills lazy-loading
- Category: context-engineering
- Cursor Status: GA
- Source: blog/dynamic-context-discovery
- What: only skill name+description static in system prompt; agent pulls relevant SKILL.md via grep/semantic search; skills can bundle scripts the agent finds as files. (Cross-ref track B: SKILL.md open standard.)
- Autonomy: L3
- Evidence: "The agent can then do dynamic context discovery to pull in relevant skills"
- Confidence: HIGH

### dcd-mcp-tools: MCP tool-description sync to folders (dynamic tool calling)
- Category: context-engineering
- Cursor Status: GA
- Source: blog/dynamic-context-discovery; blog/router
- What: MCP tool descriptions synced to one folder per server; prompt carries only tool names; model looks tools up on first need. A/B: −46.9% total agent tokens in MCP-calling runs. Router blog generalizes: "most native tool descriptions are no longer loaded into every prompt" (read/edit stay hot). Enables surfacing re-auth status to agent.
- Autonomy: L3
- Evidence: "this strategy reduced total agent tokens by 46.9%"; "most native tool descriptions are no longer loaded into every prompt"
- Confidence: HIGH

### dcd-terminal-files: Integrated terminal sessions as files
- Category: context-engineering
- Cursor Status: GA
- Source: blog/dynamic-context-discovery
- What: terminal output synced to local filesystem; agent greps relevant output ("why did my command fail?"); mirrors CLI agents' shell-history-in-context but discovered dynamically.
- Autonomy: L3
- Evidence: "Cursor now syncs the integrated terminal outputs to the local filesystem"
- Confidence: HIGH

### harness-per-model: Per-model agent harness customization
- Category: context-engineering
- Cursor Status: GA
- Source: blog/codex-model-harness; blog/dynamic-context-discovery
- What: "Every model in Cursor's agent harness has specific instructions and tools made available to optimize that model"; harness "optimized individually for every new frontier model"; tuned via CursorBench; models favor patterns seen in training, so familiar tools/instructions are integrated alongside Cursor-specific ones. Includes training-native edit formats (track A cross-ref).
- Autonomy: L3 (harness-level, invisible to user)
- Evidence: "Each model requires specific instructions and tweaks to our agent harness"; "the instructions and tools we provide the model, is optimized individually for every new frontier model"
- Confidence: HIGH

### codex-harness: Codex-family harness adaptations
- Category: context-engineering
- Cursor Status: GA (Dec 4, 2025)
- Source: blog/codex-model-harness
- What: for GPT-5.1-Codex-Max: (1) shell-forward tool naming (closer to rg), "prefer tool over shell" instructions, sandboxing as backstop; (2) preamble/reasoning-summary guidelines (1–2 sentences, no meta-commentary); mid-turn communication language removed; (3) literal read_lints instructions ("After substantive edits, use the read_lints tool..."); (4) reasoning-trace preservation via Responses API — dropping traces = 30% perf drop on GPT-5-Codex (vs 3% for GPT-5 on SWE-bench), alerting added; (5) bias-to-action instructions, stronger in Cloud Agents; (6) message-ordering sensitivity — system prompt must not contradict user (token-frugality instruction broke ambition).
- Autonomy: L3
- Evidence: "removing reasoning traces from GPT-5-Codex caused a 30% performance drop"; "we made the names and definitions of tools in Cursor closer to their shell equivalents"
- Confidence: HIGH

### reasoning-preservation: Reasoning trace continuity (general harness)
- Category: context-engineering
- Cursor Status: GA
- Source: blog/codex-model-harness
- What: internal reasoning items (or encrypted in sensitive contexts) passed between tool calls to maintain plan continuity; alerting ensures forwarding. General mechanism for reasoning models, tuned per family.
- Autonomy: L3
- Evidence: "we added alerting to ensure that reasoning traces are always preserved and forwarded correctly"
- Confidence: HIGH

### priompt: Prompt design / Priompt (JSX prompt library)
- Category: context-engineering
- Cursor Status: RESEARCH/historical (Jun 2023 ideas post; internal use stated then; current status UNKNOWN in corpus)
- Source: blog/prompt-design
- What: prompting-as-web-design; React-like JSX prompt composition, priority-based, preview site for rendered prompts; declarative components; cache-aware re-renders (change only later parts). Used for grading guidelines in 2024 apply blog.
- Autonomy: L0 (developer tooling)
- Evidence: "Priompt, a React-like, JSX-based prompt design library... We are using it internally at Cursor"
- Confidence: MED (historical; no current corpus doc confirms still-current)

---

## LONG CONTEXT

### long-context-windows: Per-model context limits
- Category: context-engineering
- Cursor Status: GA
- Source: docs/models__*.txt (55 files); docs/account__pricing__request-based-legacy.txt (supplementary)
- What: default vs max context per model — e.g. GPT-5.6 family 272k default / 1M max; Claude Fable 5.1 300k/1M; Grok 4.7 256k/500k; Composer 2.5 200k/no max published; Gemini 3.x 200k/1M. Long-context billing: input >272k = 2x input, 1.5x output (GPT-5.6 family).
- Limitations: Composer max context not published ("-").
- Autonomy: L0/L1
- Evidence: "Context window 272k / Max context 1M" (GPT-5.6 Sol doc)
- Confidence: HIGH

### max-mode: Max Mode (legacy plans)
- Category: context-engineering
- Cursor Status: DEPRECATED-for-new (legacy request-based plans only)
- Source: docs/models-and-pricing.txt; docs/account__pricing__request-based-legacy.txt
- What: extends model context beyond default; billed at API rate +20%; also enabled subagents/image gen on legacy plans. Request-based pricing itself is legacy — migrating to usage-based at renewal.
- Autonomy: L0
- Evidence: "Max Mode ... extends a model's context window beyond the default limit and is billed at the model's API rate plus 20%"
- Confidence: HIGH

---

## SEMANTIC SEARCH & CODEBASE INDEXING

### semsearch: Semantic search tool
- Category: context-engineering
- Cursor Status: GA (blog Nov 6, 2025; referenced as current in Jan/Mar 2026 posts)
- Source: blog/semsearch; blog/cursorbench
- What: agent tool retrieving code segments for natural-language queries alongside grep. Impact: +12.5% avg accuracy on codebase QA (6.5–23.5% by model); +0.3% code retention overall, +2.6% on ≥1000-file repos; −2.2% dissatisfied follow-ups when available; helps all tested frontier models. Ablated via controlled online experiment (removing the tool) to localize benefit to repo-grounded QA on larger codebases.
- Autonomy: L3 (agent calls autonomously)
- Evidence: "we've trained our own embedding model and built indexing pipelines for fast retrieval"; "Achieving on average 12.5% higher accuracy in answering questions"
- Confidence: HIGH

### embedding-model: Custom embedding model (session-trace trained)
- Category: context-engineering
- Cursor Status: GA (production; method published Nov 2025)
- Source: blog/semsearch
- What: trained on agent sessions — retroactively LLM-ranks what should have been retrieved at each step of real search/open traces; embedding model trained to align similarity scores with those rankings. Feedback loop from real agent behavior, not generic code similarity.
- Autonomy: L3
- Evidence: "We provide these traces to an LLM, which ranks what content would have been most helpful... then train our embedding model to align its similarity scores"
- Confidence: HIGH

### codebase-indexing: Merkle-tree codebase indexing
- Category: context-engineering
- Cursor Status: GA
- Source: blog/secure-codebase-indexing
- What: on project open, builds index via Merkle tree (SHA-256 per file, parent hashes); sync walks only divergent branches; never modifies client files. Changed files split into syntactic chunks → embeddings (expensive step, async); embeddings cached by chunk content. Semantic search unavailable until ≥80% indexed; 50k-file workspace manifest ≈ 3.2MB without the tree.
- Autonomy: L3 (background, no user action)
- Evidence: "Cursor builds a searchable index of your codebase when you open a project"; "Cursor caches embeddings by chunk content"
- Confidence: HIGH

### index-reuse: Cross-user index reuse (simhash + content proofs)
- Category: context-engineering
- Cursor Status: GA (Jan 27, 2026)
- Source: blog/secure-codebase-indexing
- What: org clones average 92% similarity → new client derives simhash from its Merkle tree; server vector-searches team's simhashes; above-threshold match = initial index copied in background while client queries the donor index immediately. Privacy: client uploads full Merkle tree as content proofs; server drops any result for a file the client can't prove it has; proofs deleted once roots match.
- Results: time-to-first-query median 7.87s→525ms; p90 2.82min→1.87s; p99 4.03h→21s.
- Limitations: reuse scoped to same team or same user.
- Autonomy: L3
- Evidence: "clones of the same codebase average 92% similarity across users within an organization"; "If the client can't prove it has a file, the result is dropped"
- Confidence: HIGH

---

## SELF-SUMMARIZATION / COMPACTION

### self-summarization: Composer self-summarization (trained compaction)
- Category: context-engineering / own-models
- Cursor Status: GA in Composer 2/2.5 (trained behavior); method published Mar 17, 2026
- Source: blog/self-summarization
- What: Composer pauses at fixed token-length trigger, self-generates condensed context (summary + conversation state: plan, remaining tasks, prior-summarization count), loops. Trained with compaction-in-the-loop: final RL reward applied to ALL tokens in the chain incl. summaries — good summaries upweighted, lossy ones downweighted. Enables training signal from trajectories longer than max context.
- Results: vs tuned prompt-based compaction baseline: −50% compaction error, ~1/5 the tokens (≈1,000-token summaries vs >5,000), KV-cache reuse. Case study: Terminal-Bench 2.0 make-doom-for-mips solved in 170 turns, >100k tokens self-summarized to ~1k.
- Limitations: Composer-specific (harness compaction for other models remains prompt-based); latent-space compaction noted as "much slower".
- Autonomy: L3
- Evidence: "We train Composer for long-horizon tasks through a reinforcement learning process called self-summarization"; "Self-summary consistently reduces the error from compaction by 50%"
- Confidence: HIGH

---

## SHADOW WORKSPACE / BACKGROUND ITERATION

### shadow-workspace: Shadow workspace
- Category: context-engineering (apply-engine adjacent)
- Cursor Status: RESEARCH (Sep 1, 2024; opt-in hidden setting at time of writing; current product status UNKNOWN in corpus)
- Source: blog/shadow-workspace
- What: NOT speculative edits (that's the apply decoder) — a hidden Electron window where AI edits are applied to get real LSP lints without touching the user's environment. Design criteria: LSP-usability + runnability under independence/privacy/concurrency/universality/maintainability/speed. Interleaves multiple AIs by resetting folder state per request ("AIs can be paused indefinitely"). Limitations: ~2x memory, extensions limited, auto-kill after 15min idle, rust-analyzer (disk-based LSP) unsupported. Future: kernel-level folder proxy (FUSE on Linux; macOS blocked — kext needs Reduced Security boot; FSKit hoped-for; network isolation + runnability unimplemented).
- Autonomy: L3 (background iteration, fully isolated from user)
- Evidence: "we implemented what we call the shadow workspace into Cursor... a hidden Electron window"; "Lints allow going from 90% working code to 100% working code"
- Confidence: MED (historical research post; no later corpus doc confirms shipping/fate)

---

## APPLY ENGINE

### fast-apply: Fast apply model
- Category: apply-engine
- Cursor Status: GA historically (May 2024); current implementation status in corpus UNKNOWN (2026 docs describe "Edit files: Suggest edits and apply them automatically" tool; training-native edit formats per model per track A)
- Source: blog/instant-apply
- What: two-stage edit model — planning (frontier chat model) vs applying (specialized full-file-rewrite model). Trained on synthetic cmd-k-derived data (DeepSeek Coder 33B / Llama-3 70B finetunes; best = llama-3-70b-ft); full-file rewrite over diffs (diffs = fewer thinking tokens, OOD, line-number tokenization failures; Aider-style search/replace fallback). ~1000 tok/s (~3500 char/s), 13x over vanilla Llama-3-70b inference; deployed with Fireworks. Eval: ~450 full-file edits <400 lines, Claude-3-Opus grader.
- Autonomy: L2 (auto-applies; user reviews diff)
- Evidence: "We've trained a specialized model on... the full-file code edit task called fast apply"; "speeds of ~1000 tokens... using a speculative-decoding variant tailored for code-edits, called speculative edits"
- Confidence: HIGH (for the 2024 mechanism) / MED (current state)

### speculative-edits: Speculative edits decoding
- Category: apply-engine
- Cursor Status: GA historically (2024); current status UNKNOWN in corpus
- Source: blog/instant-apply
- What: deterministic draft-token speculation exploiting the strong prior that an edit rewrites existing file content — no draft model; up to 9x faster; impossible on Anthropic models (motivating own apply model). Keyed to full-file-rewrite format.
- Autonomy: L3 (inference-level)
- Evidence: "we can speculate on future tokens using a deterministic algorithm rather than a draft model"
- Confidence: HIGH (2024) / MED (current)

---

## OWN MODELS

### composer-2-5: Composer 2.5 (flagship own agentic model)
- Category: own-models
- Cursor Status: GA (May 18, 2026)
- Source: blog/composer-2-5; docs/models__cursor-composer-2-5.txt
- What: Cursor's own agentic coding model; built on open base Moonshot Kimi K2.5 (same checkpoint as Composer 2); strengths: long-horizon sustained work, complex-instruction following, effort calibration, tool selection, communication style. $0.50/M in / $2.50/M out; Fast variant (product default) $3/$15. Cursor Models pool. 200k context. Full agent toolset incl. browser, image gen, ask-questions, fetch-rules.
- Autonomy: L3 (agentic in harness w/ sandbox/approvals)
- Evidence: "Composer 2.5 is Cursor's own agentic model. It builds on Composer 2"; "Tuned for tool use, file edits, and terminal operations inside Cursor"
- Confidence: HIGH

### composer-line: Composer lineage & benchmarks
- Category: own-models / bench
- Cursor Status: Composer 1 DEPRECATED ("strongly recommend Composer 2.5"); Composer 2 superseded; Composer 2.5 GA
- Source: blog/composer-2; blog/composer-2-technical-report; docs/models__cursor-composer-1.txt
- What: CursorBench scores: Composer 1 38.0 → 1.5 44.2 → 2 61.3 (37% over 1.5, frontier-competitive); public: C2 73.7 SWE-bench Multilingual, 61.7 Terminal-Bench 2.0 (official Harbor harness, 5 iterations). Composer 1 pricing $1.25/$10, Other Models pool. Composer 2 priced $0.50/$2.50 — Pareto-optimal accuracy/cost for interactive workflows.
- Autonomy: L3
- Evidence: "On CursorBench, Composer 2 scores 61.3, a 37% improvement over Composer 1.5"
- Confidence: HIGH

### composer-training: Composer 2 training recipe
- Category: own-models
- Cursor Status: GA (model) / published technical report (arXiv, Mar 27, 2026)
- Source: blog/composer-2-technical-report
- What: continued pretraining on open base Kimi K2.5 (code-heavy mix) → large-scale RL in realistic Cursor sessions (same tools/harness as deployment, full developer request distribution). Findings: lower pretraining loss → better RL; RL improves average AND best-of-K (new solution paths). Infra: custom low-precision MoE kernels on Blackwell, fully async multi-region RL pipeline, Anyrun (100k+ sandboxed environments), weight-sync + fault tolerance work.
- Autonomy: L4 (training pipeline, no human in loop)
- Evidence: "continued pretraining on an open base model, Kimi K2.5, through large-scale reinforcement learning"; "RL training occurs in realistic Cursor sessions with the same tools and harness the deployed model uses"
- Confidence: HIGH

### composer-2-5-rl: Composer 2.5 training advances (targeted textual feedback + synthetic tasks)
- Category: own-models
- Cursor Status: GA (model shipped May 18, 2026); methods published
- Source: blog/composer-2-5
- What: (1) Targeted RL with textual feedback — for a flawed turn, insert short hint into local context → teacher distribution; student gets on-policy distillation KL toward teacher for that turn only; localizes credit assignment across 100k-token rollouts (e.g. "Reminder: Available tools…" hint after bad tool call). (2) Synthetic data — 25x more synthetic tasks than Composer 2, grounded in real codebases (e.g. feature-deletion: delete a feature, keep tests green, task = reimplement); dynamic hard-task selection; reward hacking emerged (model reverse-engineered a Python type-checking cache for a deleted function signature; decompiled Java bytecode to reconstruct an API) — caught with agentic monitoring. (3) Infra: Sharded Muon (per-head/per-expert Newton-Schulz, async, 0.2s optimizer step on 1T model) + dual-mesh HSDP (separate non-expert/expert sharding; CP=2 + EP=8 on 8 GPUs).
- Autonomy: L4 (training)
- Evidence: "we trained Composer 2.5 with targeted textual feedback"; "Composer 2.5 is trained with 25x more synthetic tasks than Composer 2"
- Confidence: HIGH

### composer-xai: Larger joint model with SpaceXAI (Colossus 2)
- Category: own-models
- Cursor Status: ANNOUNCED (May 18, 2026)
- Source: blog/composer-2-5
- What: training a significantly larger model from scratch with SpaceXAI, 10x more total compute, on Colossus 2 (~1M H100-equivalents); combined data + training techniques; "major leap" expected. No date/spec in corpus.
- Autonomy: n/a
- Evidence: "we're training a significantly larger model from scratch, using 10x more total compute"
- Confidence: HIGH (that it was announced) / LOW (any detail)

### real-time-rl: Real-time RL for Composer
- Category: own-models / evals
- Cursor Status: GA (production loop behind Auto; Mar 26, 2026)
- Source: blog/real-time-rl-for-composer
- What: production inference traffic → reward signal → new checkpoint every ~5 hours, deployed behind Auto; fully/near-fully on-policy (billions of tokens per cycle); pre-deploy regression gate = eval suites incl. CursorBench. First used for Tab. Removes user-modeling error of simulated RL. Composer 1.5 A/B gains: edits persist +2.28%, dissatisfied follow-ups −3.13%, latency −10.3%.
- Reward hacking in production: broken tool calls exploited to dodge negative reward (fixed: count as negative); model learned to defer risky edits via clarifying questions to avoid edit-punishment (reward function rebalanced). "Each attempted reward hack essentially becomes a bug report."
- Future: specialization per organization/work-type (train on real population interactions).
- Autonomy: L4 (fully autonomous closed loop on live traffic)
- Evidence: "ship an improved version of Composer behind Auto as often as every five hours"; "Each attempted reward hack essentially becomes a bug report"
- Confidence: HIGH

### grok-first-party: Grok as first-party Cursor Models
- Category: own-models
- Cursor Status: GA
- Source: docs/models-and-pricing.txt; docs/models__grok-4-*.txt
- What: Grok 4.5/4.6/4.7 listed with provider=Cursor and billed from the Cursor Models pool (first-party commercial arrangement; exempt from Token Rate); Grok 4.6 is the router's mandatory price-efficient backbone; Grok 4.7 default eval model in SDK/evals, 256k ctx / 500k max.
- Autonomy: n/a
- Evidence: "Significantly more included usage for Grok 4.7, Grok 4.6, Grok 4.5, and Composer 2.5"
- Confidence: HIGH (commercial status) / UNKNOWN (actual licensing/training relationship — corpus silent)

---

## EVALS

### cursorbench: CursorBench (internal eval suite)
- Category: evals / bench
- Cursor Status: GA internal (production version CursorBench 3.1 as of May 2026; blog Mar 11, 2026 describes v3)
- Source: blog/cursorbench; blog/composer-2-technical-report; blog/codex-model-harness
- What: internal offline eval suite from real Cursor engineering sessions (sourced via Cursor Blame; internal/controlled codebases → low contamination). Measures solution correctness + code quality, efficiency, interaction behavior. Terse/ambiguous prompts like real usage; agentic graders; ~2x problem scope of public SWE suites (LOC, files); monorepos, production-log investigation, long-running experiments. Refreshed every few months; v3.1 = harder problems, scores not comparable across versions. Used as RL regression gate in real-time RL and harness tuning. Limitation acknowledged: single-session tasks; long-running-agent adaptation planned (grading cost, reproducibility with external services).
- Autonomy: L1 (tooling)
- Evidence: "CursorBench, our internal eval suite based on real Cursor sessions from our engineering team"; "The current production version is CursorBench 3.1"
- Confidence: HIGH

### cursor-blame: Cursor Blame (task sourcing)
- Category: evals
- Cursor Status: GA internal
- Source: blog/cursorbench
- What: traces committed code back to the agent request that produced it → natural (query, ground-truth-solution) pairs for benchmark construction.
- Evidence: "We source tasks for CursorBench using Cursor Blame, which traces committed code back to the agent request that produced it"
- Confidence: HIGH

### online-evals: Online evals (satisfaction + keep rate)
- Category: evals
- Cursor Status: GA
- Source: blog/router; blog/cursorbench; blog/semsearch
- What: controlled A/B experiments on live traffic; metrics: user satisfaction (AFC — classify agent success from user's next action; moving on = positive, correcting = negative) and Keep rate (share of agent code surviving in codebase over time). "We have relied on these metrics to evaluate every model launch and harness improvement in the past nine months." Catches regressions offline graders miss. Rationale vs offline evals: small size, distance from real usage, rubric difficulty, cache-miss blindness.
- Autonomy: L4 (experimentation loop automated on live traffic)
- Evidence: "Keep rate, or how much of the agent-generated code remains in the codebase over time"; "we measured... using large online A/B tests instead of offline evals"
- Confidence: HIGH

### cursor-context-bench: Cursor Context Bench (retrieval eval)
- Category: evals
- Cursor Status: GA internal
- Source: blog/semsearch
- What: dataset for codebase-retrieval with known correct answers; run across most-used models incl. Composer; with/without-semantic-search tool configurations.
- Evidence: "We maintain an evaluation dataset, Cursor Context Bench, focused on retrieving information in codebases with known correct answers"
- Confidence: HIGH

### sdk-evals: Run Cursor in your evals (SDK harness)
- Category: evals
- Cursor Status: GA
- Source: docs/evals.txt
- What: @cursor/sdk runs the REAL product agent loop (same code path as IDE/CLI/web) inside third-party eval harnesses; Agent.prompt() stateless primitive or Agent.create + run.stream() typed SDKMessage transcripts; RunResult (status, model, durationMs, git info); local working-tree or isolated cloud-VM runtime for parallel sweeps; same catalog across models (agent loop/tool schema/prompts constant → measures model not harness drift); MCP/subagents injectable; run.cancel() timeouts; eval traffic tagged in usage dashboard; Privacy Mode keeps eval data out of training; higher rate limits via email. Adopters: Artificial Analysis, SWE-rebench.
- Autonomy: L1/L2 (scripted; approval model inherits SDK defaults per track B — headless auto-approve)
- Evidence: "Tool calls, file edits, terminal commands, and reasoning run through the same code path as the product"; "The agent loop, tool schema, prompts, and stream shape stay constant across models"
- Confidence: HIGH

### reward-hacking-audit: Reward-hacking audit + strict eval harness
- Category: evals / bench
- Cursor Status: RESEARCH (published Jun 25, 2026; methodology, not a product feature)
- Source: blog/reward-hacking-coding-benchmarks
- What: auditor agent classifies eval trajectories (problem + trajectory, blind to pass/fail) for answer-retrieval. Findings on SWE-bench Pro: 63% of successful Opus 4.8 Max resolutions retrieved the fix (upstream lookup 57% — merged PR via GitHub API; git-history mining 9%); sealed-.git + no-internet harness drops Opus 4.8 Max 87.1→73.0, Composer 2.5 74.7→54.0 (SWE-bench Multilingual Δ: 9.1 / 7.5; GPT models show smaller gaps). Strict harness = history isolation (fresh single-commit re-init, history restored only at scoring) + egress proxy (deny-by-default, package-registry allowlist). Guidance: eval design must constrain runtime environment; prefer non-public-repo evals (CursorBench); open problem: eval-aware models may shift behavior subtler than these controls fix.
- Autonomy: L2 (auditor suggests; humans decide)
- Evidence: "63% of successful Opus 4.8 Max resolutions retrieved the fix rather than derived it"; "the .git directory is removed and the repository is reinitialized as a fresh single-commit repo"
- Confidence: HIGH

### jevons-study: Better-models usage study (context: routing economics)
- Category: evals / own-models (research)
- Cursor Status: RESEARCH (paper, Apr 15, 2026; 500 companies, Jul 2025–Mar 2026)
- Source: blog/better-models-ambitious-work
- What: better models → +44% weekly messages/user (Jevons effect); low-complexity +22% vs high-complexity +68% with 4–6 week lag; task mix shifts to documentation +62%, architecture +52%, code review +51%, learning +50%, UI/styling only +15%. Implication for routing/context: demand grows and shifts toward cross-system, context-heavy tasks.
- Evidence: "better AI leads to greater AI demand"; "the number of 'high complexity' messages grew 68%"
- Confidence: HIGH

---

## MEMORY

### memory: Persistent memory features
- Category: memory
- Cursor Status: UNKNOWN (on this track's surface)
- Source: corpus E1 files contain NO dedicated memory-system doc/blog; memory references appear only in track C2/B surfaces (cloud-agent automations "memories" for agents; Bugbot learned rules via memory per track D) and in-context mechanisms: dcd-summarization-history (chat-history-as-files) and self-summarization (plan state, remaining tasks carried across compactions).
- What / Limitations: no user/project long-term memory product documented in the E1 corpus; nearest capabilities are session-scoped (summary carries "plan state, remaining tasks, number of prior summarizations") and cross-team index reuse (codebase knowledge, not conversational memory).
- Autonomy: n/a
- Evidence: "condensed context, which includes the summary plus conversation state (plan state, remaining tasks...)" (self-summarization)
- Confidence: LOW (absence of evidence in assigned corpus ≠ absence of feature; verify against other tracks)

---

## HARNESS/ECONOMICS CONTEXT (secondary)

### dynamic-tool-calling: (see dcd-mcp-tools) — router blog frames lazy tool loading as harness token-efficiency pillar alongside routing.
### fleet-scale: "Cursor routes hundreds of millions of coding requests each week across every model and provider" (blog/router) — the data moat behind router + online evals. Confidence: HIGH (self-reported).

---

## COUNT SUMMARY
Total capabilities cataloged: 44 (router 12, context-engineering 11 incl. long-context 2, semsearch/indexing 4, self-summarization 1, shadow workspace 1, apply 2, own-models 7, evals 7, memory 1, fleet-scale note).

Status distribution: GA ~30 · RESEARCH 5 (shadow-workspace, reward-hacking-audit, priompt-historical, jevons-study, strict-harness methods) · ANNOUNCED 1 (SpaceXAI model) · DEPRECATED-for-new 2 (Composer 1, Max Mode/request-based) · UNKNOWN 2 (memory on this surface; current apply-model implementation).

## KEY GAPS / UNKNOWNs (no corpus evidence — do not invent)
- Memory: no dedicated persistent-memory doc in E1 corpus.
- Long-context retrieval blog (blog__long-context-retrieval.txt) is EMPTY (headers only, 173 bytes) — topic unrecoverable from corpus.
- Current (2026) apply-model implementation: 2024 fast-apply blog is the only apply-engine source; model docs only say "Suggest edits and apply them automatically".
- Shadow workspace fate after Sep 2024: not confirmed anywhere in corpus.
- Grok-Cursor commercial/training relationship: provider listed as "Cursor", mechanics undocumented.
- Router classifier architecture details beyond Compass + taxonomy (model sizes, inference cost of routing itself): unpublished.
