# R97 Live Mechanics Inventory — Browser-Native Agent Swarm

Date: 2026-09-28  
Baseline: `PatrickFrome/Compute @ 5aeaaa051166e3c068184b37c031988d0d70ce81` (PR #1024)  
Repair line: `work/r97-live-glm-bootstrap-repair-v1`  
Installed live candidate under qualification: `0.7.0-dev.36336130139.1`

## Target architecture

The production product has one development loop and one model interaction path:

`objective/task -> native Browser fleet -> z.ai Agent UI (GLM-5.3-Flash) -> semantic readback -> durable outcome/evidence -> memory/learning -> next task`.

Hard requirements:

- model execution happens through z.ai web Agent surfaces, not through Z.AI/Vercel/OpenAI-compatible model APIs;
- fleet members are physical Browser tabs/BrowserCells with exact tab/WebContents/process/document fencing;
- no production actuation may depend on screen coordinates or pixel geometry;
- `ACTIVE` means a usable canonical Agent task/conversation surface, not mere root-page reachability;
- one authoritative scheduler/effect plane; observation, UI, memory and diagnostics may not create rival scheduling authority;
- no blind retry after ambiguous physical effects;
- Supervisor, task/evidence state, memory and recovery are durable across tab/process/browser restarts;
- hidden model chain-of-thought is not a coordination primitive. Coordination uses actions, outcomes, durable notes, evidence and concise reasons exposed by the agents.

## Classification vocabulary

- **KEEP** — directly useful and already aligned.
- **FIX** — useful, but current semantics violate the target.
- **MERGE** — useful capability duplicated by another plane; retain one canonical implementation.
- **REMOVE** — conflicts with the target or creates a rival runtime.
- **DECORATIVE** — visible/maintained but does not close a useful production loop.
- **BLOCKING** — prevents the target architecture from working now.
- **NOT VERIFIED** — no sufficient physical evidence yet.

## Live blockers already proven

1. **BLOCKING — wrong fleet surface.** Current fleet provisioning opens ordinary `https://chat.z.ai/` Chat roots. User requirement is z.ai **Agent** surface.
2. **BLOCKING — root is not readiness.** Installed build overlays `PRECONVERSATION_ROOT -> ACTIVE`; RESEARCHER and IMPLEMENTER were live examples. Repair branch now keeps root-only agents `BOUND_UNVERIFIED`.
3. **BLOCKING — dirty account-synced root draft.** A fresh USER tab restored a 5921-character stale draft. The current verified-replace attempt failed with `native_semantic_type_replace_unverified` and mutated the draft to 5999 chars. No automatic retry is safe.
4. **BLOCKING — collapsed z.ai root has no semantic sidebar opener in current projection.** CAPTURE on the ordinary root exposed model/template controls and textboxes, but no `Agent`, `Toggle Sidebar`, or unnamed button. Direct navigation to `/agent` produces an error page. Agent is SPA state.
5. **BLOCKING — TYPED_CLICK is geometric.** Exact semantic lookup ends in `DOM.getBoxModel -> x/y -> Input.dispatchMouseEvent`. This is outside the accepted production architecture.
6. **FIX — command transport latency.** Batch/read paths work and exact bindings are healthy, but deployed wait-batch reports `DB_POLL_TIMEOUT_FALLBACK`; measured issue→lease and completion delays remain seconds.
7. **FIX — Supervisor rollover.** Live state previously showed `ROLLOVER_AMBIGUOUS / ROOT_DRAFT_OVERSIZED`; the old Chat-root composer bootstrap is not a valid immortal-Supervisor foundation.
8. **FIX — stale self-update transaction hold.** Installed version is CURRENT, but historical `AMBIGUOUS_INSTALL` state still needs reconciliation.

## ME1–ME42 inventory against the new objective

| ID | Old mechanic | New verdict | Production decision |
|---|---|---|---|
| ME1 | Daemon command bus / 4 lanes / budget | **MERGE** | Keep lane/idempotency concepts, but Browser native supervisor is the effect authority. Daemon bus may remain only for local DevOS tools, never as a second agent scheduler. |
| ME2 | Event log + hash chain | **KEEP** | Durable evidence and coordination substrate. |
| ME3 | Daemon API agent loop workers/tasks | **REMOVE** | Replace with BrowserCell-bound z.ai Agent fleet. `worker.ts` model loop must not run in Browser product. |
| ME4 | SQLite episodic/semantic/procedural memory | **MERGE** | Keep durable memory; converge with Browser Brain persistence instead of maintaining disconnected memories. |
| ME5 | Daemon BRAIN “LLM core” | **REMOVE/FIX** | Remove LLM-provider execution. Keep only deterministic planning/retrieval/projection pieces that feed web agents. |
| ME6 | Fleet registry/transport proof/freshness | **MERGE** | Canonical fleet is Browser fleet. Daemon fleet is read-only projection at most. |
| ME7 | Daemon source self-update | **MERGE** | Installed Browser self-update is authoritative. Remove duplicate user-facing “daemon ff update” as a product update path. |
| ME8 | RSI propose/adopt/rollback | **KEEP/FIX** | Keep evidence-gated learning; candidate proposals/evaluations must come from web-agent/dev tooling, not provider APIs. |
| ME9 | Code graph | **KEEP** | Directly useful to development agents. |
| ME10 | Worktrees + rerere | **KEEP** | Directly useful to parallel development. |
| ME11 | Sandbox plane | **KEEP/FIX** | Keep bounded execution; remove dead/locked decorative controls and ensure one real backend. |
| ME12 | OTel-lite spans | **KEEP** | Useful for latency/reliability evidence. |
| ME13 | Always-on MJPEG screencast | **MERGE/REMOVE DEFAULT** | Do not run a permanent visual side server merely for UI decoration. Keep bounded on-demand capture only when physical visual evidence is needed. Never use screenshots as actuation authority. |
| ME14 | Live roadmap verdict | **KEEP** | Useful high-level progress view if derived from real task/evidence state. |
| ME15 | Reward-hacking detector | **KEEP** | Useful verifier layer; no model provider dependency required. |
| ME16 | Evidence + providers | **FIX** | Keep evidence/identity. Remove provider/model gateway semantics. |
| ME17 | Semantic Browser perception + actuation | **BLOCKING/FIX** | Keep CAPTURE/exact refs. Delete geometry-based production click. Add focus metadata + semantic keyboard/native editing activation. |
| ME18 | CDP network/console sensors | **KEEP** | Read-only debugging/verification. |
| ME19 | Effect epistemology / one-attempt fences | **KEEP** | Core safety/reliability invariant. |
| ME20 | Performance baselines | **KEEP** | Must measure agent bootstrap, dispatch, readback, memory, update and soak. |
| ME21 | MCP server | **MERGE/OPTIONAL** | Not model execution. Retain only if it exposes useful local DevOS tools without creating scheduler/actuation authority; remove from primary UI otherwise. |
| ME22 | Eval harness | **KEEP** | Regression qualification. |
| ME23 | Objectives → tasks → agents projection | **KEEP/FIX** | Bind agents to native Browser fleet IDs, not daemon agents. |
| ME24 | Handoffs | **KEEP/FIX** | Durable handoffs between web agents; no daemon chat IDs as authority. |
| ME25 | GLM currency backend probe | **REMOVE** | No provider/API probe. Verify model/surface through z.ai UI readback. |
| ME26 | API reviewer-agent | **FIX** | Reviewer role should be another native z.ai Agent fleet member; deterministic verifier checks remain local. |
| ME27 | Approval policies | **KEEP** | Useful for irreversible/authority effects. Autonomous safe branch-local work should not be artificially blocked. |
| ME28 | Sense diffing | **KEEP** | Efficient semantic deltas; read-only. |
| ME29 | Sensor history TTL | **KEEP** | Bounded durable observability. |
| ME30 | DB hygiene | **KEEP** | Long-lived process reliability. |
| ME31 | Evidence mirror | **KEEP/FIX** | Keep if cloud persistence is healthy; it is not agent/model execution. |
| ME32 | Verifiable audit trail | **KEEP** | Core shared coordination/evidence primitive. |
| ME33 | API GLM executor pool | **REMOVE** | Replace with physical z.ai Agent tabs/BrowserCells and Browser fleet elasticity. |
| ME34 | Prompt token-economy | **FIX** | Retain retrieval/delta economy, but deliver context to z.ai Agent tasks, not API prompts. |
| ME35 | Daemon persistent agent chats/tool loop | **REMOVE** | Direct rival to required z.ai Agent UI runtime. |
| ME36 | Daemon thought/tool river + chat objectives | **FIX/MERGE** | Keep durable actions/outcomes/objectives; source them from native Browser fleet. Do not attempt to expose hidden chain-of-thought. |
| ME37 | Autonomy safety+liveness audit | **KEEP/FIX** | Keep non-bypass/liveness/risk checks, but remove assumptions about API-agent runtime. |
| ME38 | API LLM governor + demand create_chat | **REMOVE/REWRITE** | Remove provider quotas/failover/429 breaker. If needed, replace with Browser resource governor: tab count, memory, responsiveness, z.ai session readiness, backlog and latency. |
| ME39 | Policy + cron + outcomes | **KEEP/FIX** | Keep scheduling/outcome proof; cron dispatch must target native Browser tasks/agents, not daemon agentchat. |
| ME40 | Token vault | **FIX** | Keep only infrastructure credentials actually needed (GitHub/Supabase/update signing etc.). Remove Vercel/model-provider secret slots and model-provider UI. |
| ME41 | Separate legacy desktop client | **MERGE** | METAENGINE Browser Electron is the canonical desktop product. Remove duplicate shell/runtime authority and retain only code proven necessary to the Browser build. |
| ME42 | GitHub webhook ingress | **KEEP** | Useful event-driven development trigger; must stay non-authoritative until converted to durable tasks. |

## UI inventory

| Surface | Verdict | Required change |
|---|---|---|
| Main shell / native selected-agent surface | **KEEP/FIX** | Left rail must list real Browser fleet agents; right surface is their native z.ai Agent tab. |
| COMMAND | **KEEP/FIX** | Mission/objective/task overview stays; remove `agentchat:op create` and daemon chat selection. |
| AGENTS | **REWRITE** | Remove daemon `AGENT_SPAWN/AGENT_MODEL` and old model dropdowns. Show Browser fleet, Agent-surface readiness, role, task, health, memory/coordination status. |
| BROWSER | **FIX** | Keep exact tab/process/CDP/sensor diagnostics. Remove mutating `/browser/sense/act click` UI and all geometry-dependent actuation. |
| CODE | **KEEP/FIX** | Keep file/edit/exec/review/worktree/sandbox functions that physically work. Delete permanently disabled fake/locked buttons and demo-only controls from production. |
| COMPUTE | **REMOVE/REWRITE** | Delete API `/llm`, `/glm`, provider failover/quota and API pool concepts. Replace with native fleet capacity, tab/memory/latency/backpressure if a separate page remains justified. |
| MEMORY | **KEEP/FIX** | Keep durable memory/RSI/recall. Rebind delivery to Browser fleet task context; remove API-prompt language and demos. |
| OBSERVABILITY | **KEEP/FIX** | Keep evidence chain, command receipts, CI, hooks, DB hygiene, spans, perf/eval. Collapse ambient panels that do not affect operator decisions. |
| SUPERVISOR | **KEEP/FIX** | Keep objectives/workgraph/handoffs/approvals/roadmap and Browser Supervisor state. Remove GLM API probes, API reviewer and provider breaker/demand controls. |
| SYSTEM / Settings | **KEEP/FIX** | Keep Browser version/update, policies, diagnostics, useful secrets. Remove provider tokens and duplicate daemon self-update path. |
| TASKS | **KEEP/FIX** | Keep task graph/leases/retries/outcomes. Remove API LLM-reflection treatment; web-agent critic/reviewer replaces it. |
| AgentChatPanel | **REMOVE** | This is daemon API-agent chat, not physical z.ai Agent UI. |
| FleetGrid | **REWRITE** | Project Browser fleet only. |
| MirrorPanel | **MERGE** | Move evidence-mirror status into Observability/System unless it has a unique operator decision. |
| ContextDrawer | **MERGE/FIX** | Keep concise selection/evidence/commands inspector; remove redundant layout controls if they do not improve development work. |
| PeekInspector | **KEEP if real data** | Retain only exact selected task/agent evidence; no placeholder cards. |
| CommandPalette | **KEEP/FIX** | Commands must map only to retained real mechanisms. |
| Topbar | **KEEP** | Quiet navigation/search/settings is aligned. |
| Pagebar | **MERGE/REMOVE** | Avoid a second persistent navigation system; advanced pages should live behind Settings/search. |
| Statusbar | **KEEP/FIX** | Compact live Browser/Supervisor/fleet/update state only. |
| Dialogs | **KEEP as needed** | Only for real destructive/authority effects. |
| BrowserStage | **KEEP** | Native surface slot for the selected web agent. |

## Runtime composition decisions

### Remove from Browser product composition

- daemon API LLM provider execution: `apps/me2-daemon/providers.ts` model calls and gateway failover;
- daemon worker LLM loop in `worker.ts`;
- daemon `agentchat` model execution and its internal immortal supervisor as a second supervisor;
- `me2-fleet-bridge` dependency on daemon `/agentchat`;
- `me2-supervisor-mesh-bridge` dependency on daemon agentChat supervisor ticks;
- API GLM pool/governor/demand mechanics;
- Vercel AI Gateway key acquisition and model-provider token UI;
- geometry-dependent production `TYPED_CLICK` and Browser-page click actuation.

### Retain or converge

- Browser native Supervisor, exact mutation target and effect fences;
- Browser fleet/BrowserCell registry;
- native CDP semantic perception and event-driven readback;
- Browser Brain, collaboration journal, episodic memory and bounded persistence;
- Development Plane / Code / worktrees / sandbox / tests;
- durable objectives/tasks/handoffs/evidence/audit chain;
- Sentinel/host resilience/single-instance/update;
- CI/webhook/evidence ingress;
- local daemon only where it remains a bounded DevOS data/tool service, not a model/scheduler runtime.

## Required Agent-surface bootstrap

Desired non-geometric state machine:

1. create a physical z.ai tab;
2. wait for semantic readiness without treating 15s navigation timeout as task readiness;
3. CAPTURE exact process/document/semantic revision;
4. discover or reach the z.ai Agent SPA surface through keyboard/semantic controls only;
5. prove Agent surface by stable evidence such as `New Task` plus Agent-template controls;
6. create a new Agent task/session through semantic keyboard activation;
7. prove selected model is GLM-5.3-Flash from UI;
8. prove a clean task input before typing;
9. type via exact semantic ref with pre-insert replacement proof; if replacement cannot be proven, stop before insertion/submission;
10. submit once and prove the Agent task/session started;
11. only then mark Browser fleet member `ACTIVE`;
12. bind task/agent/tab/target/process/generation and publish durable coordination state.

The current CAPTURE projection must be extended with AX `focused`/`focusable` metadata so a bounded `Tab` traversal can be verified without geometry. No arbitrary page eval is required.

## Acceptance gates before release

- 0 model-provider API calls in production Browser-agent execution;
- 0 geometry-dependent actuation in the production fleet/Supervisor task path;
- 100% fleet agents created on proved z.ai Agent surfaces;
- no `PRECONVERSATION_ROOT` member counted as ACTIVE;
- clean-input proof before every first Agent task dispatch;
- exact one-attempt submit with event/readback proof;
- Supervisor survives/recreates after tab death and Browser restart;
- task/evidence/memory recovery after process restart;
- swarm scale test with bounded Browser resource governor and no artificial fixed fleet ceiling except actual host/session safety limits;
- shared durable action/outcome journal visible to agents; no claim of hidden chain-of-thought sharing;
- code/worktree/sandbox/test loop physically exercised;
- self-update package/install/restart/successor qualification passes;
- Windows package/install tests and live installed qualification pass on the exact release SHA;
- installer version is monotonic and its SHA-256/size are published.
