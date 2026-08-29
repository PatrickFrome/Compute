# METAENGINE Browser — Architecture Deep Research (2026-08-29)

Branch: `work/a2-compute-browser-b4-parity` (B-line work area; code identical to the
shell branch's `coordination/browser-compute/` at the time of writing).
Author: GLM (IM mode), acting as Principal Architect / Senior Implementation
Supervisor / Reliability & Security Research Engineer.
Method: every factual claim below was re-verified today against GitHub
(live `ls-remote`, per-head CI runs), Supabase (direct Postgres read of the
checkpoint ledger), and the source trees themselves — not inherited from any
relayed summary. External claims cite primary sources.
Companion implementation: B7-PRE1 (identity envelope + durable effect ledger +
action-plane seam closure), landed on this branch with 121/121 tests green
(see §21).

---

## 1. Verified source-of-truth snapshot

```text
AUTHORITATIVE_HEAD =
  Extension line:   A2_BROWSER_OPERATOR_EXTENSION_DURABLE_IDENTITY_UI_V1
                    @ 09a205a6d1deb00e71ae5401b8c6a36f4dace0b0 (v0.7.2)
  Compute browser:  A2_COMPUTE_BROWSER_B6_MULTI_BROWSER_POOL_V1
                    @ 3eccaee205c70d15eae004c6e2a42767fce0bacb (next = B7)
  Development Plane: METAENGINE_BROWSER_DEVELOPMENT_PLANE_DP2_VERIFICATION_SANDBOX_PLAN_V1
                    @ 0b6aa2dc73781d2d9eba829794dec73b8e33c9af
                    (next = DP2_PHYSICAL_SANDBOX_BACKEND_BINDING_V1)
  Global semantic head: CP072 (main integration is a separate, lagging surface)

VERIFIED_HEAD =
  Last physically proven DP milestone on all three OS surfaces: DP1
  @ 70f7ead5b3092d8a7b50b2099f88e491db7788c5 (DP2 plan is AUTHORITATIVE but
  PREPARE_ONLY; its backend binding is not yet physically attested)

LATEST_CI_VERIFIED_CANDIDATE =
  Shell: afc5554422dc911bd3be4cbcf704ec8828b351ba — CI success 2026-08-29
  (includes: DP2 backend binding trust contract d2a9345 + independent
  multi-gateway advisory evidence verification + physical DP evidence test)

ACTIVE_CANDIDATE_HEADS =
  work/metaengine-browser-shell-v1           afc55544 (8 commits beyond the DP2 plan)
  work/a2-browser-v072-durable-identity-ui   09a205a6 (sealed)
  work/a2-compute-browser-b4-parity          054b88b → this document + B7-PRE1

ACTIVE_MILESTONES =
  DP2_PHYSICAL_SANDBOX_BACKEND_BINDING_V1   (shell line, trust transition)
  B7_MULTI_BROWSER_POOL_SCHEDULER_V1        (compute line, next)
  LIVE_INSTALL_TESTS_V072 / R8-convergence  (extension line)

CURRENT_BROWSER_VERSION =
  Electron Browser Shell 0.3.2 (package 0.5.0 target), Electron 44, Node >= 24
  MV3 Browser Operator extension 0.7.2
  Compute Browser runtime 0.3.0-dev.4 (after B7-PRE1)
  Development Plane protocol 0.4.0

CURRENT_ARCHITECTURE_STAGE =
  MULTI-EXECUTOR / EVIDENCE-FIRST CONVERGENCE
  SELF-DEVELOPMENT = PRE-EXECUTION / PRE-PROMOTION (PREPARE_ONLY proven, DP3 not started)

BLOCKERS =
  authenticated physical sandbox backend (DP2 binding is contract-only, UNATTESTED)
  W1 global worker-safety gate (READY, not VERIFIED)
  A1 isolated workspace gate (blocked by W1)
  cross-plane identity/evidence convergence (partially addressed by B7-PRE1)
  durable cross-system workflow semantics
  mainline integration backlog (main @ 0d1c074c, 2026-08-27)

SOURCE_OF_TRUTH_DRIFT =
  CONTROLLED + ONE GOVERNANCE DEFECT
```

Drift taxonomy (all three kinds re-confirmed today):

1. **Controlled candidate drift.** Shell branch GitHub HEAD (afc5554) is eight
   commits ahead of the Supabase authoritative DP2 row (0b6aa2d). This is
   correct by design: d2a9345 adds the backend binding *trust contract* whose
   entire point is that a structurally valid provider observation still yields
   `trust_state = PROVIDER_OBSERVED_UNATTESTED`, so there is nothing yet that
   a seal could honestly claim. Promoting it now would inflate trust.
2. **Mainline drift.** `main` sits at 0d1c074c while three specialized browser
   lines advanced 30+ commits. That is an integration backlog, not an
   emergency; force-merging without the identity/evidence envelope (§7) would
   multiply, not reduce, the source-of-truth problem.
3. **Governance defect.** Supervisor-side tables still hold command rows whose
   `ACTIVE`-style status is stale relative to their timestamps, and pairing
   rows where `last_used_at` is null despite `active: true`. Statuses that
   require every client to privately interpret clocks are a defect of the
   model: `ACTIVE ∧ expired` must be a derived `STALE/EXPIRED` state, not a
   client-side convention.

A governance observation specific to this session: the shell branch advanced
twice *while this research was being written* (635051c → afc5554, both CI
green on exact heads). Multi-agent parallel development is now the normal
operating mode of this repository, which raises the value of every
cross-plane join primitive — the exact subject of §21.

---

## 2. Actual architecture map (from code, not from summaries)

The verified reality: **METAENGINE Browser is not one browser. It is three
executors, one proposer plane, and two evidence planes converging.**

```text
                         HUMAN / OPERATOR
                                │ intent, approval
                                ▼
              ┌──────────────────────────────────┐
              │  SUPERVISOR / ARBITRATION PLANE   │
              │  GPT / GLM / future models        │
              │  (proposals only — never authority)│
              └───────────────┬──────────────────┘
                              │ typed commands, leases (HMAC, TTL, resource-scoped)
                              ▼
              ┌──────────────────────────────────┐
              │  AUTHORITY / POLICY PLANE         │
              │  LeaseBroker · action contracts   │
              │  ambiguous-retry fence · receipts │
              └──────┬───────────┬───────────┬───┘
                     │           │           │
        ┌────────────┘           │           └────────────┐
        ▼                        ▼                        ▼
  MV3 EXTENSION            COMPUTE BROWSER            ELECTRON SHELL
  OPERATOR v0.7.2          daemon (B0–B6+PRE1)        0.3.2
  debugger broker          native-pipe CDP            USER_SPACE session
  OOPIF perception         (no TCP DevTools)          WebContentsView tabs
  typed click outcomes     profiles/contexts/targets  navigation policy
  durable device identity  process-incarnation fence  FleetProvisioner
  supervisor board         node registry (pool seed)  ComputeBridgeClient
        │                  ActionKernel+EffectLedger  DevelopmentPlane
        └────────────┬───────────┴───────────────────────┘
                     ▼
               Chromium / pages / frames / OOPIF

  DEVELOPMENT SIDE (proposer, PREPARE_ONLY):
  Development Plane (UtilityProcess) → DP1 candidate capsules (digest-bound,
  non-executable) → DP2 sandbox plan (closed network) → backend binding trust
  contract (provider-observed ≠ attested) → [DP3 attested promotion — missing]

  EVIDENCE SIDE:
  GitHub exact-head CI + provenance attestations → Supabase semantic
  checkpoint ledger (33 rows, 3 live AUTHORITATIVE lines) → per-action
  receipts + (new) per-profile hash-chained effect ledgers
```

Key structural facts read directly from code:

- **The shell branch is a superset of the B-line.** Its history contains B6
  (3eccaee), the health-probe hardening (6edb826) and the B4/B5/B6 seal doc
  (054b88b), then builds the Electron shell on top. `browser-compute/` is
  byte-identical between both branches, so B-line work merges clean.
- **Authority is genuinely separated from reasoning.** A model can propose,
  but effects require a LeaseBroker HMAC lease scoped to resource, actor,
  kind and TTL (`lease-broker.mjs`), and the kernel revalidates the lease,
  blocks ambiguous retries, and persists the pending intent *before* any CDP
  dispatch. This is the project's crown jewel and matches the direction
  OpenAI and Anthropic both publish for computer-use safety (§3.2).
- **Incarnation fencing is real and pervasive.** Contexts die to `LOST` when
  the process incarnation changes; bindings are invalidated on incarnation
  mismatch; receipts carry `process_incarnation_id`. This is stronger than
  every mainstream browser-agent framework reviewed in §3.
- **The shell main process is approaching the god-object boundary.**
  `main.mjs` already owns window/tab/view lifecycle, the navigation policy,
  fleet provisioning, compute bridge and DP lifecycle in one module with a
  `handleCommand()` switch. Growth must move into capability modules, not
  new command branches.
- **A latent B5→B6 seam defect existed and is now closed (§21).** The RPC
  layer dispatched `action.navigate/click/type/submit` to runtime methods
  that were never implemented — the ActionKernel existed as a tested library
  but was not wired into the daemon. Tests passed because bridge tests
  injected mock runtimes implementing those methods. This is a textbook
  example of why "tests green" ≠ "system integrated", and why the research
  prompt's insistence on restoring actual state matters.
- **Three identity models, three state stores, one missing join.** The
  compute browser owns profile/context/target identities; the shell owns
  tab/agent fleet identities; the extension owns device/target identities;
  the DP owns candidate/plan/binding digests; Supabase owns workspace/
  command identities. Each is individually sound. Nothing joins them —
  which is precisely the gap the §21 amplifier starts closing.

---

## 3. Deep research: five classes of analogs (primary sources)

### 3.1 Automation engines and protocols

**Playwright** remains the ergonomic reference. Its decisive idea is
*actionability*: before acting, it proves the element is visible, stable,
enabled, editable and receives events, and auto-waits until all checks pass
(playwright.dev/docs/actionability). METAENGINE's semantic target resolution
(`_liveRevalidate` → AX tree + DOMSnapshot → backend node id) already mirrors
the hard half of this; what it lacks is the wait/stability policy layer on
top (visual stability, eventability) — a cheap, high-value adoption.

**Selenium 4 / W3C WebDriver** shows the value and the cost of
standardization: the wire protocol unified a decade of tooling, but the
architecture (out-of-process driver per browser) is now the legacy being
replaced. Relevant lesson: METAENGINE's typed RPC surface
(`protocol-v1.json`, effect-classed methods, forbidden-capabilities list) is
already the better-shaped contract; do not trade it for protocol generality.

**WebDriver BiDi** is the W3C's bidirectional successor — real events, real
sessions, cross-browser (w3.org/TR/webdriver-bidi; developer.chrome.com/
blog/webdriver-bidi-2023). Correct posture: **DEFER** as a portability
adapter. Chromium-specific depth (OOPIF graph, DOMSnapshot, flat sessions)
is where METAENGINE's leverage lives; BiDi is shallower on exactly those.

**CDP itself** is the privileged backend and stays so: flat sessions +
auto-attach (chromedevtools.github.io devtools-protocol Target domain),
DOMSnapshot with layout/DOM-rects/shadow-DOM flattening, full AX trees. The
B-line's native-pipe-only transport (no TCP DevTools listener) is a
genuinely stronger default than most production deployments of Playwright.

### 3.2 Commercial agent-browser platforms

**OpenAI Operator / CUA** proved the universality of pixels + mouse +
keyboard as one action space (openai.com/index/computer-using-agent). Its
safety posture — a confirmation boundary before consequential actions, and
explicit treatment of page content as adversarial input
(openai.com/safety/prompt-injections) — is the industry consensus
METAENGINE already implements structurally (authority plane), and should
keep implementing at capability level (§7).

**Anthropic computer use** makes the same two moves from the other
direction: screenshot-driven acting plus human-in-the-loop confirmation for
meaningful effects (anthropic.com/news/developing-computer-use; platform
docs recommend domain restriction, isolation from sensitive data,
confirmation around consequential actions). Adoption target: capability-
scoped confirmation policy, not UI-only confirmation.

**Browserbase** demonstrates the observability product surface: session
recording, network/console/action correlation, stealth infrastructure and
persistent contexts (browserbase.com/blog/build-vs-buy-agent-infrastructure;
docs.browserbase.com). Their own security writing names the exact threat
METAENGINE's USER_SPACE/COMPUTE_SPACE split defends against: "one
compromised browser is a foothold". Adoption target: session replay and a
unified timeline — which the effect ledger (§21) is the substrate for.

**Stagehand** contributes the `observe → act` caching pattern: an LLM
observation returns structured, indexable actions that later execute
*without a second inference* (docs.stagehand.dev; browserbase.com/stagehand).
This maps one-to-one onto METAENGINE's R5 semantic action cache + R4
semantic frames, but generalized: observation output should be a
*validated, re-validatable action proposal* bound to semantic IDs.

**Browser Use** is the pragmatic DOM+vision hybrid reference
(github.com/browser-use): page extraction + screenshot to the model, with
element-level grounding. Its lesson is the cost model — every step pays a
model call when there is no action cache; METAENGINE's persistent semantic
identities are the structural counter.

**Skyvern / AgentQL** push semantic selection furthest: natural-language /
workflow-driven element resolution with self-healing selectors
(docs.agentql.com). ADOPT as a *front-end* to the perception compiler: the
semantic query language can compile to the same R4 frames, adding no new
authority.

### 3.3 Agent developer tooling

**Claude Code** normalizes sub-agent delegation with isolated context per
subagent (code.claude.com/docs/en/agent-sdk/subagents) — structurally the
same move as METAENGINE's fleet roles (PLANNER/CRITIC/FALSIFIER…) with
per-agent conversation epochs. **OpenAI Codex CLI** layers *approval
policies* on top of *sandbox modes* — the agent asks before acting
precisely when the sandbox would not contain the blast radius
(openai.com/index/unrolling-the-codex-agent-loop; sandboxing write-ups).
That two-axis design (containment × approval) is exactly the capability
envelope + confirmation policy combination proposed in §7/§14.
**SWE-agent / OpenHands** show the autonomous coding loop and its
benchmarks; their constraint — fixed action spaces beat free-form shells —
re-validates METAENGINE's typed-action bias.

### 3.4 Durable execution and orchestration

**Temporal** is the canonical durable-execution engine: workflows capture
state at every step and resume exactly where they stopped
(temporal.io). **Cloudflare** splits the world into Agents (durable
identity, realtime) and Workflows (durable run-to-completion), with
`step.do()` results never repeated after success
(developers.cloudflare.com/agents/concepts/workflows). This split maps
directly: Supervisor = Agent (identity, arbitration), effect ledger +
future workflow layer = Workflow (run-to-completion).

**LangGraph** is the instructive *negative* case: its checkpointers persist
graph state after every node, and the durable-execution literature's
critique applies verbatim — a checkpoint says "I saved your state, you take
it from here", while durable execution *guarantees the steps themselves*
(diagrid.io blog "Why Checkpoints Aren't Durable Execution"). METAENGINE's
Supabase ledger is checkpoint-shaped; the effect ledger shipped in §21 is
the first execution-shaped (per-effect, chained, tamper-evident) record.
The strategic conclusion: do not build a workflow engine inside the
Supervisor; give effects durable semantics and let planning stay
ephemeral.

### 3.5 Isolation and OS-level security

**Chromium site isolation** (per-site renderer processes as a security
boundary; chromium.org design docs) is the model for METAENGINE's plane
separation — and a reminder that extensions are structurally incompatible
with the strongest site-isolation posture, which is *why* the MV3 operator
and the compute browser must remain separate executors rather than merging.
**Firecracker** gives hardware-virtualized microVMs with dedicated kernels
(firecracker design docs); **gVisor** intercepts syscalls in userspace at
runtime cost; **Kata** sits between (northflank.com and edera.dev
comparisons, 2026). **Vercel Sandbox** (Firecracker-backed, documented
network policy and credential brokering outside the sandbox) and
**Cloudflare Sandbox** (VM per sandbox, Ubuntu environment) are the two
concrete provider candidates already encoded in DP2's
`PROVIDER_REQUIREMENTS` — and DP2's `provider_name_is_not_trust` invariant
is exactly right: the *name* of the provider is not evidence; the
attested observation chain is.

### 3.6 Benchmarks and adversarial research

**WebArena / BrowserGym / WorkArena** (servicenow.github.io/WorkArena;
github.com/servicenow/browsergym) define the evaluation layer METAENGINE
lacks: standardized task suites with rich action/observation spaces. The
R14 A2_BROWSER_BENCH line exists in the ledger but is not yet a
cross-plane regression gate. **BrowseSafe** (arxiv 2511.20597;
research.perplexity.ai/articles/browsesafe) decomposes prompt-injection
attacks on browser agents into three orthogonal dimensions and finds most
defenses address only one — a direct argument for METAENGINE's
defense-in-depth: taint at perception, capability at authority, isolation
at execution.

---

## 4. Comparison matrix

23 parameters, scored against the strongest analog per row. T = tied.

| # | Parameter | METAENGINE (verified) | Best analog | Verdict |
|---|---|---|---|---|
| 1 | Action ergonomics | typed kinds + leases | Playwright locators | analog better |
| 2 | Actionability proof | AX/DOM revalidation, no wait policy | Playwright | adopt gap |
| 3 | Cross-browser portability | Chromium-only by design | Selenium/BiDi | analog better, deferred |
| 4 | Deep Chromium access | native pipe CDP, OOPIF-aware | CDP direct | METAENGINE ≥ |
| 5 | Transport security | Unix socket/loopback + bearer token, no TCP DevTools | Playwright (TCP ws) | METAENGINE better |
| 6 | Authority model | HMAC leases, TTL, resource-scoped | none of the analogs | METAENGINE better |
| 7 | Effect ambiguity handling | AMBIGUOUS ≠ retry, fenced | Temporal (activity semantics) | METAENGINE unique in-browser |
| 8 | Incarnation/process fencing | first-class | none | METAENGINE better |
| 9 | Perception depth | DOM+AX+frames, no Runtime.evaluate | Browser Use (DOM+vision) | METAENGINE deeper structurally |
| 10 | Vision/multimodal | not in compute line yet | CUA / computer use | analog better |
| 11 | Session persistence | profile contexts + USER_SPACE partition | Browserbase contexts | T (different trust model) |
| 12 | Session replay/observability | receipts + (new) effect ledger | Browserbase replay | analog has product, we have substrate |
| 13 | Durable execution | per-effect chain (new), workflows missing | Temporal/CF Workflows | analog better at workflow level |
| 14 | Checkpointing semantics | Supabase semantic ledger, exact-head CI | LangGraph checkpointers | METAENGINE stronger (digest-bound) |
| 15 | Isolation of untrusted code | DP2 contract, physical backend unbound | Firecracker/gVisor/CF Sandbox | analog better (today) |
| 16 | Supply-chain provenance | digests, attestations, reproducible builds | SLSA L3 builders | METAENGINE comparable in-scope |
| 17 | Prompt-injection defense | authority separation + taint (R12) | BrowseSafe taxonomy | METAENGINE structural, needs coverage |
| 18 | Multi-model arbitration | supervisor duel / same-point swarm | none comparable | METAENGINE unique |
| 19 | Agent fleet management | roles, warm/desired/max, ambiguous states | Claude Code subagents | T, different scale |
| 20 | Human approval surface | supervisor chat + shell USER_SPACE | Operator takeover / Claude confirmations | analog more productized |
| 21 | Evaluation harness | R14 bench (dormant) | WebArena/BrowserGym | analog better |
| 22 | Self-development safety | PREPARE_ONLY, non-executable capsules, no self-promotion | Codex sandbox+approvals | METAENGINE stronger model, earlier stage |
| 23 | Production readiness | CI-green branches, daemon real | all analogs | analog better |

Net reading: METAENGINE is ahead on the *trust architecture* rows (6,7,8,14,
18,22) and behind on the *product/evaluation* rows (2,10,12,15,20,21,23).
That is the correct order for this project's thesis — trust first — but the
gap on actionability and evaluation is now cheap to close and retards every
milestone that depends on reliable acting.

---

## 5. What to adopt, what not to copy

**ADOPT (structural):** Playwright actionability semantics as a policy layer
over `_liveRevalidate`; Stagehand's observe→validated-action reuse as the
generalization of R5; Temporal/Cloudflare durable-step semantics for the
effect ledger's evolution (per-step completion is never repeated);
Browserbase's timeline/replay product shape on top of the ledger; Codex's
containment × approval two-axis policy; WebArena/BrowserGym task structure
for a cross-plane regression gate.

**ADOPT (conceptual):** the BrowseSafe three-dimensional attack taxonomy as
a checklist for every new perception surface; CUA's vision fallback *as a
fallback executor only*, never an authority path; AgentQL/Skyvern semantic
queries compiled to R4 frames.

**NOT COPY:** pixels-only action spaces as the primary interface;
WebDriver BiDi as the core protocol (portability adapter only); Kafka/NATS-
style event buses before event semantics are fixed; cloud session
infrastructures that require exporting cookies/credentials out of the
user's trust boundary; any "sandbox" whose isolation claim is a provider
name; retry-on-timeout semantics for non-idempotent effects; model-direct
raw CDP; self-promoting development loops.

---

## 6. Architectural gaps, ranked

1. **No cross-plane semantic execution model.** Eight identity models
   (extension device/target, compute profile/context/target/incarnation,
   shell tab/fleet-agent, DP candidate/plan/binding, Supabase
   workspace/command, GitHub CI/artifact, supervisor peer) cannot today
   answer one question end-to-end: *which authority caused which effect in
   which browser incarnation, with what evidence?* B7-PRE1 (§21) lays the
   substrate in the compute plane; the envelope must propagate to the
   extension, shell and DP next.
2. **Fragmented durability.** Receipts, action intents, fleet state, DP
   capsules and the Supabase ledger each persist their own slice with
   different (excellent) local disciplines. Nothing composes them into one
   resumable operation history — the Temporal property. The effect ledger
   is the start; workflow-shaped wrappers come after, not before.
3. **Action-plane integration debt (now closed in the compute line).** The
   B5→B6 seam defect (RPC dispatching to nonexistent runtime methods,
   §2/§21) is the exact failure class a cross-plane contract test must
   catch. The remaining exposure: lease issuance into the connected
   extension gate (R8-convergence) still has the same seam-shape risk.
4. **Two isolation models converging.** Compute Fabric's A1 workspace
   envelope and the browser DP2 sandbox contract must converge on one
   `ENVIRONMENT_ENVELOPE_V1` (§7) or the project will build two sandbox
   architectures with subtly different trust semantics.
5. **No unified observability timeline.** Debugging a failed multi-plane
   operation today means correlating receipt files, extension logs, CI
   artifacts and Supabase rows by hand.
6. **No actionability/wait policy** — the top reliability tax on every
   physical browser test (flaky waits, stability races).
7. **No evaluation harness wired as a gate** — R14 bench exists in the
   ledger but does not run regressions.
8. **Governance staleness** (§1.3): derived expiry states missing on the
   supervisor side.
9. **Electron main as a god-object in formation** (§2).
10. **Vision/multimodal perception absent** from the compute line, capping
    the universality argument (CUA parity) until added as fallback executor.

---

## 7. Cross-block integration planes

The six planes from the research directive, with a build/don't-build verdict:

**Identity Plane — ADOPT as schema, not service.** One versioned identity
envelope (shipped v1 in §21: lease/action/target/profile/browser-node/
incarnation/context/epochs/receipt; extensible upward to task/proposal/
command ids). Every plane emits it; no plane owns a monopoly. Rule: physical
identity (incarnation, binding) dies with the process; semantic identity
may be reconciled but never assumed equal.

**Capability Plane — ADOPT, the single authority abstraction.** One
capability record (issuer, subject, effect class, resource/browser/
incarnation/epoch scopes, expiry, single-use, evidence requirements)
subsuming leases, DP2 execution authorization, DP3 promotion authorization
and Codex-style approval policy. Everything else (leases today) becomes an
encoding of it. Security invariant to preserve verbatim: *no model, page,
or artifact content can mint authority* — only the authority plane itself.

**Event Plane — ADOPT as typed append-only contract first.** The effect
ledger entries (§21) define the event vocabulary and chaining; transport
(pub/sub, fan-out to observers) is a later adapter. Do not stand up a
message broker before the event semantics are frozen.

**Evidence Plane — ADOPT, in-toto-shaped.** Every meaningful claim =
{claim, subject digest, producer, source revision, evidence refs,
verification result, trust class}. DP capsules and the ledger already
match this shape; unify the schema so a Supabase checkpoint can reference
a ledger head (`head_seq`, `head_entry_sha256`) as its execution witness.

**Continuity Plane — ADOPT by unification, not construction.** Recovery
must read from the event/effect ledger instead of each subsystem
re-deriving its own notion of "what was in flight". The ledger's
RECOVERY_REQUIRED event type is reserved for exactly this.

**Development Plane — already correct.** PREPARE_ONLY, digest-bound,
non-self-promoting. Its next milestone (authenticated physical backend) is
the highest-value single trust transition in the project (§17 P2).

---

## 8. What owning the browser unlocks

**Immediate (substrate exists today):** authenticated SaaS operation
without APIs; durable logged-in research sessions; cloud console
operation; browser-native integration testing and UI regression
verification; CI/dashboard diagnosis from inside the real trust context;
human handoff inside the same session (USER_SPACE); persistent model-fleet
conversations (GPT/GLM tabs with durable identities); physical proof that
an action happened (typed click outcomes + receipts).

**Near-term (1–2 milestones of substrate):** browser-as-debugger; exact
reproduction of browser incidents (ledger + semantic frames); automatic
evidence collection; deployment canaries on real browsers; cross-service
workflows spanning GUI-only surfaces; semantic action caching at fleet
scale; long-running browsing tasks that survive process loss.

**Strategic (requires planes §7):** autonomous software maintenance
(incident→research→patch→canary→promote); a browser-driven development
environment; durable multi-model execution runtime; identity-preserving
personal agent; distributed browser worker fabric; a secure bridge between
GUI-only services and Compute Fabric.

**Experimental (requires P8+):** self-optimizing agent/browser policies;
automatic failure-to-patch loops; autonomous canary/promote/rollback; a
persistent semantic world model spanning sites and sessions.

The general principle: every row above is *only* defensible because the
browser is owned end-to-end — a hosted automation API could give the
convenience rows but never the trust rows (attested effects, USER_SPACE
separation, non-exported credentials).

---

## 9. Browser as development accelerator

The shell + DP already form a development loop: DP1 candidate capsules bind
source HEAD + component digests; DP2 plans verification in a closed-network
sandbox; the shell runs physical smoke on three OS surfaces in CI; GitHub
attests provenance; Supabase seals semantic state. What is missing is the
*middle*: isolated repo materialization, allowlisted build/test execution,
browser canaries against the operator's own UI, visual regression, and
automatic failure reproduction. Ranked by (value ÷ cost):

1. **Allowlisted build/test in DP2** (after backend binding) — unlocks
   everything else; nothing else can be trusted without it.
2. **Browser canary gate**: every extension/shell change runs a physical
   click-through against a local fixture page before merge — the R8c live
   canary pattern generalized to all lines.
3. **Visual regression on the shell UI** (screenshot-diff on fixed
   fixtures) — cheap, catches what typed tests cannot.
4. **Automatic failure reproduction**: ledger timeline + semantic frames
   replayed against a fresh context until the failure reproduces.
5. **Incident-to-patch loop** (P8): the full self-development cycle, only
   after DP3 attested promotion exists.

---

## 10. Model federation

Verified substrate: the supervisor plane already arbitrates GPT/GLM peers
(`metaengine_peer_health`, same-point swarm R11, adaptive router R16,
multi-gateway advisory evidence in the newest shell commits — the advisory
evidence verifier accepts PEER/COMMITTEE/CHALLENGE/DECISION receipt kinds
across VERCEL/SUPABASE/GITHUB/CLOUDFLARE/LOCAL gateways, hash-bound and
`HASH_BOUND_ADVISORY_UNATTESTED` by design). The correct next contract is a
**model adapter protocol**: every provider emits {proposal, confidence,
evidence refs, requested capability} into the same envelope; arbitration
consumes proposals; capability issuance never depends on provider identity.
Two rules to preserve: no provider-specific browser authority; no
advisory evidence promoted to attested trust without the DP3 chain. The
fleet profiles (BALANCED/RESEARCH/IMPLEMENTATION/INCIDENT) then become
hiring policies over one uniform candidate pool.

---

## 11. Perception and action architecture direction

**Perception.** Keep the two-level identity split (physical binding vs
semantic entity), and grow the R4 semantic frame into a unified perception
graph: structural (DOM snapshot, AX, shadow DOM) + visual (screenshot
regions, when the vision executor lands) + runtime (network, console,
lifecycle) + semantic graph (entities, roles, actionability, evidence refs,
confidence) — one world snapshot per navigation epoch, never one giant
blob; each layer separately digestible so the ledger can reference
perception evidence without embedding it.

**Action.** The canonical pipeline stands as implemented, with one
promotion and one addition:

```text
SEMANTIC INTENT → TARGET RESOLUTION → ACTIONABILITY PROOF (adopt, Playwright)
→ AUTHORITY CHECK (leases → capability envelope) → TRUSTED EXECUTOR SELECTION
→ PRE-EFFECT DURABLE FENCE (pending intent + INTENT_SEALED ledger event)
→ EXECUTION → OBSERVATION → EFFECT CLASSIFICATION → RECEIPT (+ ledger events)
```

Executor ladder (first match wins): browser-native typed command →
semantic DOM/AX resolved action → CDP trusted input → vision fallback →
OS input. DOM-event injection and arbitrary JS stay on the rejected path.
Stagehand-style cached proposals slot in between resolution and authority
check: a cached proposal is still revalidated and still needs a lease.

---

## 12. Observability, recovery, durable execution

Observability target: one execution timeline where a supervisor command,
the issued lease, the sealed intent, the CDP dispatch, the observed effect
and the receipt are consecutive entries joinable by the identity envelope.
The ledger shipped in §21 is the compute-plane instance; the extension and
shell should emit into the same schema (file or table transport is an
implementation detail). Recovery target: on restart, the last ledger head
plus live bindings distinguish "effect unknown" (AMBIGUOUS — fence) from
"no effect dispatched" (safe to re-plan); incarnation loss invalidates
bindings but not the ledger — history survives, authority does not.
Durable-execution target: per-effect completion recorded once and never
repeated (Cloudflare `step.do()` semantics); workflow wrappers later, and
never inside the Supervisor.

---

## 13. Threat model (verified defenses × missing pieces)

| Threat | Current defense (code-verified) | Missing piece |
|---|---|---|
| Webpage prompt injection | authority separation; page data = tainted input (R12 taint graph) | system-wide taint propagation into ledger refs |
| Hostile DOM/frame | brokered perception, OOPIF-aware capture | unified frame/world identity across executors |
| Model confusion / hallucinated authority | typed actions + lease HMAC | capability envelope shared across planes |
| Stale authority | lease TTL + incarnation fencing | epoch-scoped capabilities (§7) |
| Replay of effects | idempotency keys, ambiguous-retry fence | ledger replay detection as a *gate* (verify-on-read) |
| Renderer compromise | Chromium sandbox on; no node in remote content | smaller Electron main TCB; CSP on shell UI |
| Credential theft | USER_SPACE/COMPUTE_SPACE split; cookie transfer forbidden | explicit credential broker policy for DP2+ |
| Malicious generated code | DP PREPARE_ONLY; capsules non-executable | authenticated physical sandbox (DP2 binding) |
| Malicious build artifact | digests, reproducible builds, attestations | attested promotion gate (DP3) |
| Source-of-truth spoofing | exact-head CI, digest-bound ledger rows | multi-head integration index (P0.1) |
| Supply-chain compromise | pinned Actions, provenance attestations | dependency SBOM + policy admission |
| Provider self-report spoofing | provider_name_is_not_trust; UNATTESTED class | authenticated provider evidence chain (DP2 next) |
| Ledger tampering (local) | *(new)* hash-chained append-only ledger, fail-closed on broken chain | external anchoring (checkpoint references ledger head) |

---

## 14. Architectural amplifiers, ranked

Score 10 = maximum. Ranking by ROADMAP_MULTIPLIER ÷ (COST × RISK).

| # | Amplifier | Mult | Cost | Risk | Status after this slice |
|---|---|---:|---:|---:|---|
| 1 | Cross-plane Identity + Evidence Envelope | 10 | 4 | 2 | **started — v1 shipped in compute plane (§21)** |
| 2 | Durable Effect Ledger / state machine | 10 | 5 | 3 | **started — v1 shipped, hash-chained, fail-closed** |
| 3 | Unified Environment (A1↔DP2) Envelope | 10 | 4 | 2 | contract design next (P2.2) |
| 4 | Scoped Capability Broker | 10 | 6 | 3 | design; leases become an encoding |
| 5 | Actionability + Executor Resolver | 9 | 4 | 3 | adopt Playwright semantics over revalidation |
| 6 | Automated Evidence Compiler | 9 | 4 | 2 | ledger→checkpoint references next |
| 7 | Execution Timeline / unified observability | 9 | 5 | 2 | substrate shipped; cross-plane emission next |
| 8 | Unified Perception Graph | 9 | 6 | 3 | R4 frames are the seed |
| 9 | Deterministic Replay Simulator | 8 | 7 | 3 | requires ledger + frame snapshots |
| 10 | Fault-injection Harness | 8 | 5 | 2 | poison-ledger test is the first instance |
| 11 | Model-independent Router/Arbitrator | 8 | 5 | 3 | R16 adaptive router exists; adapter contract next |
| 12 | Physical Canary Promotion Gate | 9 | 7 | 5 | after DP2 backend binding |
| 13 | Semantic Action Cache generalization | 8 | 3 | 2 | R5 exists; Stagehand pattern extends it |
| 14 | Evaluation harness as CI gate | 7 | 4 | 2 | BrowserGym-style tasks on local fixtures |
| 15 | Multi-head Integration Index | 8 | 2 | 1 | P0.1, pure contract + CI job |
| 16 | Derived governance states | 7 | 2 | 1 | P0.2, closes the ACTIVE∧expired defect |

The strongest *minimal* amplifier — highest multiplier, lowest cost and
risk, immediately unblocking B7 and the cross-plane joins — is #1+#2
fused: identity envelope + durable effect ledger. That is what §21 ships.

---

## 15. Emergent combinations

1. **Long-run autonomous operator** = browser + effect ledger + capability
   broker + recovery + supervisor. The ledger's fail-closed ambiguity fence
   is the piece that makes unattended operation defensible.
2. **Safe self-development** = DP + physical sandbox + CI + browser canary
   + evidence + promotion gate. Everything except attested sandbox/promotion
   exists in some form today.
3. **API-independent SaaS execution** = persistent USER_SPACE identity +
   operator + human approval + semantic perception.
4. **Model-federated reasoning** = GPT+GLM(+future) proposals + arbitration
   + common evidence envelope; advisory evidence verifier is already
   multi-gateway.
5. **Replayable browser world model** = DOM+AX+visual+network snapshots +
   identity graph + event ledger + replay simulator.
6. **Incident→patch loop** = failure event + trace + supervisor research +
   DP sandbox + tests + canary + seal (P8; requires DP2/DP3).
7. **Distributed GUI execution fabric** = browser pool + node registry +
   scheduler + capability leases + work routing (B7→B9; the node registry
   and ledger are its first two organs).

---

## 16. Self-development meta-loop status

```text
OBSERVE OWN SYSTEM        8/10   (health, ledgers, CI, checkpoints)
IDENTIFY GAP              8/10   (verification-first culture)
RESEARCH                  9/10   (this document + per-step research docs)
DESIGN                    8/10   (contract-first, invariant-pinned)
CREATE CANDIDATE          8/10   (DP1 capsules)
ISOLATED IMPLEMENTATION   3/10   (DP2 backend binding not yet physical)
TEST                      8/10   (121/121 local, 3-OS CI)
PHYSICAL BROWSER VERIFY   8/10   (real Chromium self-tests in CI)
EVIDENCE                  9/10   (digests, attestations, ledger)
CHECKPOINT                9/10   (Supabase seal discipline)
SAFE PROMOTION            2/10   (DP3 attested gate missing)
ROLLBACK                  4/10   (immutable history; no active rollback)
```

≈ 6.6/10 overall. The missing center is isolated implementation + attested
promotion + rollback — one milestone chain (DP2 binding → DP3) away.

---

## 17. Roadmap synthesis (P0–P9)

**P0 Correctness / source of truth** — `P0.1 MULTI_HEAD_INTEGRATION_INDEX_V1`
(one contract + CI job binding the three authoritative heads and main);
`P0.2 DERIVED_GOVERNANCE_STATES` (ACTIVE∧expired → STALE). Proof:
deterministic readback.

**P1 Authority** — `P1.1` propagate identity envelope v1 to extension/shell/
DP; `P1.2 CAPABILITY_ENVELOPE_V1`; `P1.3 TAINT_PROPAGATION_V1`. Invariant:
nothing that reads page/model/artifact content can mint authority.

**P2 Isolation/recovery (critical path)** — `P2.1 DP2 authenticated physical
sandbox backend` (trust ladder: CANDIDATE_UNOBSERVED → PROVIDER_OBSERVED_
UNATTESTED → CONTROL_PLANE_AUTHENTICATED → INPUT_DIGEST_VERIFIED →
POLICY_PROBED → TEST_EXECUTED → OUTPUT_SEALED → TEARDOWN_VERIFIED →
BACKEND_VERIFIED); `P2.2 ENVIRONMENT_ENVELOPE_V1` converging A1 and DP2;
`P2.3` W1↔sandbox authority reconciliation; `P2.4` teardown/zero-persistence
proof.

**P3 Observability/evidence** — `P3.1` cross-plane event emission into the
ledger schema; `P3.2` ledger anchoring in Supabase checkpoints (head_seq +
head digest); `P3.3` unified timeline UI; `P3.4` evidence compiler emitting
in-toto/SLSA-shaped bundles.

**P4 Browser intelligence** — actionability/wait policy (P4.1, cheapest
reliability win); semantic world model v2; vision fallback executor;
OOPIF/frame graph completeness.

**P5 Development acceleration** — isolated repo materialization;
allowlisted build/test; browser canary gate; visual regression; automatic
failure reproduction (§9 order).

**P6 Model federation** — adapter protocol (§10); no provider-specific
authority.

**P7 Durable autonomous workflows** — workflow ledger v1 over effect
ledgers; timers/waits/human approval as first-class states; deterministic
resumption. No workflow engine inside the Supervisor.

**P8 Self-development** — gap→research→candidate→sandbox→test→canary→
evidence→independent review→signed promotion→restart→post-activation
verify. No running process overwrites itself.

**P9 Distributed fabric** — B7 scheduler (now unblocked by §21's ledger:
scheduling decisions become ledger events with identity envelopes), remote
nodes, lease broker federation, work stealing, economic routing. Only
after P1–P3.

---

## 18. Current assessment (0–10)

| Axis | Score | What blocks +1 |
|---|---:|---|
| Browser control | 8.5 | actionability policy; unified executor contract |
| Perception | 7.5 | persistent semantic identity; multimodal fusion |
| Security | 8.5 | system-wide taint/capability model |
| Authority isolation | 9.0 | capability envelope across planes |
| Reliability | 7.5 | cross-plane durable workflow |
| Recovery | 7.5 | ledger-driven recovery everywhere |
| Observability | 7.0 | single timeline (substrate shipped) |
| Development velocity | 7.5 | safe sandbox execution |
| Testability | 8.5 | cross-stack harness; seam tests added |
| Multi-agent architecture | 8.0 | model adapter contract |
| Model independence | 7.0 | provider adapter protocol |
| Evidence quality | 9.0 | ledger-anchored checkpoints |
| Long-run autonomy | 6.5 | workflow semantics |
| Self-development | 6.5 | isolated implementation + promotion |

(Observability/Testability/Recovery already moved +0.5 with §21; they will
move again when the extension and shell emit the same envelope.)

---

## 19. Mandatory conclusion blocks

```text
CURRENT_ARCHITECTURE_SUMMARY =
multi-executor agent execution system:
MV3 Extension Operator + Compute Browser daemon + Electron Browser Shell
+ Development Plane (PREPARE_ONLY) + supervisor/arbitration plane
+ evidence planes (CI attestations, Supabase ledger, per-effect ledgers)

STRONGEST_EXISTING_IDEAS =
authority separated from reasoning; typed effects; no blind retry;
process-incarnation fencing; semantic perception without page script eval;
exact-head evidence; digest-bound non-executable candidates;
non-self-promoting development plane; provider name ≠ trust

BIGGEST_ARCHITECTURAL_WEAKNESSES =
no cross-plane identity/effect model (substrate now shipped, not yet
propagated); fragmented durability; duplicate isolation semantics (A1 vs
DP2); no authenticated physical sandbox yet; no unified timeline;
mainline integration lag; no actionability policy

WHAT_BROWSER_UNLOCKS =
persistent authenticated agent runtime; universal SaaS/UI integration;
runtime observability; human approval surface; development canaries;
GUI-only workflows; distributed browser execution; self-development

BEST_EXTERNAL_IDEAS_TO_ADOPT =
Playwright actionability; Temporal/Cloudflare durable-step semantics;
Browserbase replay product shape; Stagehand observe→validated-action reuse;
Codex containment×approval policy; Firecracker/gVisor isolation;
SLSA/in-toto provenance; CUA vision fallback (executor only);
WebArena/BrowserGym evaluation; BrowseSafe injection taxonomy

TOP_ARCHITECTURAL_AMPLIFIERS =
1 identity+evidence envelope (shipped v1) 2 durable effect ledger (shipped v1)
3 unified environment envelope 4 capability broker 5 perception graph

SELF_DEVELOPMENT_OPPORTUNITIES =
incident→research→patch; sandboxed implementation; automatic tests;
physical browser canary; visual regression; evidence seal; attested
promotion; rollback verification

CRITICAL_PATH =
DP2 authenticated physical sandbox + W1/A1 convergence
+ cross-plane identity/capability/evidence propagation + DP3 promotion

TOP_5_NEXT_STEPS =
1 DP2 authenticated physical sandbox proof (trust ladder to BACKEND_VERIFIED)
2 Propagate identity envelope v1 to extension + shell + DP planes
3 Anchor ledger heads in Supabase checkpoints (evidence plane unification)
4 ENVIRONMENT_ENVELOPE_V1 converging A1 and DP2
5 Actionability/wait policy over live revalidation (P4.1)
```

---

## 20. Implementation bias

**ADOPT:** Playwright actionability; durable-step semantics; ledger-
anchored checkpoints; identity envelope propagation; environment envelope;
capability envelope; evaluation harness as gate; derived governance states;
multi-head integration index.

**EXPERIMENT:** vision fallback executor (behind a capability gate, never
authority); deterministic replay simulator; semantic action cache
generalization; distributed remote-browser pool beyond the local node
registry.

**DEFER:** WebDriver BiDi (portability adapter once Chromium depth is
consolidated); Kafka/NATS-class event transport (until event semantics are
frozen repo-wide); UI product polish of the timeline.

**REJECT:** model/page → raw CDP; unrestricted Runtime.evaluate;
overwriting the running binary; automatic replay of ambiguous effects;
cookie/session copying into COMPUTE_SPACE; shell execution disguised as
sandbox; trusting provider names as isolation proof; a second bespoke
sandbox model beside A1/DP2; a workflow engine inside the Supervisor;
pixels-only primary action space.

---

## 21. Implemented amplifier — B7-PRE1: Identity Envelope + Durable Effect Ledger + action-plane seam closure

The strongest minimal amplifier from §14 (#1+#2 fused) is not a proposal —
it is implemented, tested and included in this branch.

### 21.1 What shipped

1. **`coordination/browser-shared/effect-ledger.mjs`** — the shared-plane
   contract: `metaengine.a2-identity-envelope.v1` (task/proposal/command/
   lease/action/browser-node/profile/incarnation/context+epoch/target+
   conversation-epoch/receipt ids; required join keys: lease, action,
   target, profile) and `metaengine.a2-effect-ledger.entry.v1` (six event
   types: INTENT_SEALED, AUTHORITY_GRANTED, DISPATCH_PREPARED,
   EFFECT_OBSERVED, RECEIPT_EMITTED, RECOVERY_REQUIRED; sorted-key
   canonical JSON; per-entry SHA-256; `prev_entry_sha256` chaining; full
   `verifyLedgerChain` detecting mutation, reordering, gaps and — against
   the persisted head — tail truncation).
2. **`src/effect-ledger-store.mjs`** — per-profile append-only store
   (`effect-ledger.json`, atomic writes, stored head, chain verified on
   load; a broken chain poisons the store and **appends fail closed** — an
   unverifiable history is never silently extended).
3. **`src/action-kernel.mjs`** — every `executeAction` now emits
   INTENT_SEALED *before* CDP dispatch (a second, hash-chained pre-effect
   durable fence), EFFECT_OBSERVED with the classified outcome, and
   RECEIPT_EMITTED carrying `receipt_id` + `receipt_sha256`; each event
   carries the full identity envelope including `browser_node_id`,
   `process_incarnation_id` and `target_conversation_epoch` resolved from
   the live binding. Kernel constructed without a ledger store behaves
   byte-identically to before (back-compat by construction).
4. **`src/runtime.mjs`** — closes the B5→B6 seam: `navigateAction` /
   `clickAction` / `typeAction` / `submitAction` now exist on the real
   runtime and route exclusively through the ActionKernel (lease HMAC via
   `A2_ACTION_SESSION_KEY`, ambiguous-retry fence, pending intent,
   receipts). Per-profile action planes are constructed lazily;
   `ledgerHead` / `ledgerVerify` / `ledgerTimeline` expose the evidence
   surface. Runtime version 0.3.0-dev.4; health advertises
   `effect_ledger: b7_pre1_durable_effect_ledger_v1`.
5. **`src/rpc-server.mjs` + `protocol-v1.json` 1.4.0** — three new
   READ_ONLY methods (`ledger.head`, `ledger.verify`, `ledger.timeline`)
   with strict param allowlists; the protocol pin and its contract tests
   updated in lockstep.

### 21.2 Verification evidence (local, exact suite)

- Parse gate over `src` and `tests`: PASS.
- Full suite: **121/121 pass** (102 pre-existing + 12 ledger-contract/
  store tests + 7 action-seam tests), zero failures, no event-loop leaks.
- New invariant tests worth naming:
  - *fail-closed fence*: a corrupted ledger file makes `navigateAction`
    throw `effect_ledger_append_failed:INTENT_SEALED` with **zero CDP
    calls** — the effect cannot happen without a durable sealed intent;
  - *tamper evidence*: on-disk payload mutation and tail truncation are
    detected on store reopen (`verify().ok === false`, head poisoned);
  - *append-only proof*: prior entries are byte-identical after new
    appends;
  - *restart recovery*: a fresh store over the same file continues the
    chain from the persisted head (seq n+1, prev = head digest);
  - *identity completeness*: all three events of one action carry the same
    envelope (lease/action/profile/target/incarnation/browser-node/
    context/conversation-epoch), and the RECEIPT_EMITTED payload digest
    equals the emitted receipt's `receipt_sha256`;
  - *authority preservation*: a forged lease HMAC is rejected before any
    CDP dispatch; live-lease conflicts still fence concurrent actions;
    every ledger event is evidence — none can mint authority.
- B6 invariants untouched: context/target/health semantics, receipt
  contract, lease broker, forbidden-capabilities list all unchanged; the
  CI contract greps for `action.*: 'ACTUATION'` and `receipt.*:
  'READ_ONLY'` still hold, now joined by the ledger trio.

### 21.3 Verification plan (CI + beyond)

1. This branch's existing workflow (exact-head checkout, parse gate, full
   suite, real-Chromium self-test, serve/boot smoke, evidence bundle +
   provenance attestation) runs unchanged and must stay green.
2. B7 (`MULTI_BROWSER_POOL_SCHEDULER_V1`) consumes the ledger directly:
   scheduler decisions, node assignment and lease handoffs become ledger
   events with envelopes; the scheduler's recovery path reads the head
   instead of ad-hoc state.
3. Next propagation targets (P1.1): extension typed-click outcomes emit
   the same envelope; shell fleet transitions emit it; DP evidence
   digests reference it. Supabase checkpoints then anchor
   (head_seq, head_entry_sha256) per profile — closing the loop between
   the checkpoint plane (LangGraph-shaped) and the execution plane
   (Temporal-shaped).
4. Adversarial expansion (fault-injection harness, amplifier #10): kill
   the daemon between INTENT_SEALED and dispatch; assert restart fences
   the action as AMBIGUOUS-or-PENDING and never blind-retries.

### 21.4 What this deliberately does NOT do

No capability envelope yet (leases remain the authority encoding — P1.2);
no cross-plane transport (the schema is ready, emission is local-only);
no anchoring in Supabase yet; no workflow semantics. Each is a small,
separately verifiable slice — which is the point: the amplifier's value is
measured by how much cheaper it makes exactly those next slices.

---

## Appendix: primary sources

Playwright actionability — playwright.dev/docs/actionability. WebDriver BiDi
— w3.org/TR/webdriver-bidi; developer.chrome.com/blog/webdriver-bidi-2023.
Selenium 4/W3C WebDriver — selenium.dev and W3C WebDriver spec. OpenAI CUA/
Operator — openai.com/index/computer-using-agent; openai.com/safety/prompt-
injections. Anthropic computer use — anthropic.com/news/developing-computer-
use; platform.claude.com computer-use tool docs. Browserbase — browserbase.
com/blog/build-vs-buy-agent-infrastructure; docs.browserbase.com (contexts,
observability). Stagehand — docs.stagehand.dev; browserbase.com/stagehand.
Browser Use — github.com/browser-use. Skyvern — skyvern.com. AgentQL —
docs.agentql.com. Claude Code subagents — code.claude.com/docs/en/agent-sdk/
subagents. Codex agent loop — openai.com/index/unrolling-the-codex-agent-
loop. Temporal — temporal.io (durable execution, event sourcing). Cloudflare
Agents/DO/Workflows — developers.cloudflare.com/durable-objects;
developers.cloudflare.com/agents/concepts/workflows. Cloudflare Sandbox —
developers.cloudflare.com/sandbox/concepts/architecture. Vercel Sandbox —
vercel.com/sandbox. LangGraph checkpointing and its durable-execution
critique — docs.langchain.com/oss/python/langgraph/persistence;
diagrid.io/blog/checkpoints-are-not-durable-execution. Firecracker —
github.com/firecracker-microvm/firecracker/blob/main/docs/design.md. gVisor
vs Firecracker — northflank.com/blog/firecracker-vs-gvisor;
edera.dev/stories/kata-vs-firecracker-vs-gvisor. Chromium site isolation —
chromium.org/developers/design-documents/site-isolation; chromium.
googlesource.com process model docs. WebArena/BrowserGym/WorkArena —
servicenow.github.io/WorkArena; github.com/servicenow/browsergym. BrowseSafe
prompt-injection taxonomy — arxiv.org/html/2511.20597v1. SLSA — slsa.dev;
in-toto attestations — github.com/in-toto/attestation.
