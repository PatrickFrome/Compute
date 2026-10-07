# METAENGINE: critical system review before client installation

Review date: 2026-10-07. Starting source: `43f2bb8d5e1090bad68ce9942eac40d2deab4b66`.

## Objective and verdict

The target is coordinated agents performing continuous autonomous development,
with verified useful results and independently evaluated self-improvement.
Chat connectivity, a green CI suite, an accepted task, an advisory proposal,
and an executable coding environment are distinct facts.

The installed client's observed state does **not** demonstrate that target:
zero ACTIVE fleet agents, four PROVISIONING_AMBIGUOUS agents, Guardian HOLD,
and a READY Development Plane whose sandbox execution is unbound and
prepare-only. There is no admitted-worker-to-verified-artifact coding result.
The client installed on the user machine predates this source. These facts
cannot be changed by a UI label or inferred from synthetic tests.

Canonical roadmap: R1 continuity and support for C1 readiness; **C1 First Real
Linux Worker and C2 First Serial Coding Loop remain unverified here**. The
client L2 milestone identifiers do not substitute for canonical C1/C2.

## Comparison with relevant 2026 systems

This is a capability comparison using official documentation available on the
review date, not a universal benchmark ranking or an assertion that any
competitor has solved unattended self-improvement.

| Reference | Documented mechanism | METAENGINE implication |
| --- | --- | --- |
| Cursor Cloud Agents | Isolated VMs; parallel branches; build/test execution; browser interaction | Bind a real isolated executor before claiming coding readiness; concurrency must carry independently verified results. |
| Codex app | Parallel threads and worktrees, reviewable diffs, automations | Local sessions alone are insufficient; preserve source identity, branch isolation, result review and task continuity. |
| Claude Code agent teams | Shared task dependencies, communication between teammates, separate contexts and lifecycle hooks | Preserve one assignment/effect authority; a Critic must have a distinct verified session rather than being a label on the Implementer. Agent teams are documented as experimental. |
| OpenHands | Containerized agent-server execution runtime | A prepared sandbox plan is not a running, admitted worker. |
| LangGraph / Temporal | Durable checkpoints or execution history, recoverable task state, idempotent external operations | Preserve the effect fence after an uncertain write; failures proved to precede any write must remain recoverable without being reclassified as an uncertain send. |
| Devin | Repository setup and test/refactoring workflows | Acceptance must include a real edit/build/test/artifact path, not an agent's narrative that tests passed. |

Official references:

- [Cursor Cloud Agents](https://cursor.com/docs/cloud-agent)
- [Codex app](https://openai.com/index/introducing-the-codex-app/)
- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)
- [OpenHands custom sandbox](https://github.com/OpenHands/docs/blob/main/openhands/usage/advanced/custom-sandbox-guide.mdx)
- [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [Temporal tasks](https://docs.temporal.io/tasks)
- [Temporal Nexus operation semantics](https://docs.temporal.io/nexus/operations)
- [Devin testing and refactoring](https://docs.devin.ai/use-cases/testing-refactoring)

## Defects corrected in this change

| Area | Confirmed weakness | Correction and evidence boundary |
| --- | --- | --- |
| Local gateway | Arbitrary query ports and loose substring parsing could relay requests to unrelated services. | Exact URL parameter parsing; finite integer ports; duplicate parameters rejected; only configured UI and read-only probe routes; retired socket/stream ports denied. |
| Gateway origin | Loopback binding did not enforce request Host/Origin for HTTP or WebSocket. | One policy before opening an upstream socket; foreign origins and rebinding hosts rejected; connection-nominated and forwarded headers stripped; HTTP timeout bounded. |
| Sidecar ownership | A healthy external probe could be adopted despite the reported no-adoption policy. | External daemon adoption denied; routing requires an owned live child and a fresh health observation. Health defaults follow configured ports. |
| Chat bootstrap | The durable ambiguity fence could be persisted before a root-only CAPTURE, poisoning a dirty, missing or busy composer without a write. | Preflight remains read-only; persist the existing fence immediately before the first draft mutation. Navigation/model effects still fence before mutation. Existing ambiguous attempts are not cleared or replayed. |
| Cost control | Zero or insufficient budget still yielded one agent; invalid costs were coerced; independent verification could collapse to one agent. | Zero fanout with an explicit blocker; estimated total cost never exceeds a valid budget; verification needs two affordable agents. Planning remains advisory. |
| Agent routing | READY observations could stay eligible indefinitely. | Expiring observations, injected clock, generation and timestamp regression rejection; stale profiles excluded without creating assignments. |
| Product readiness | A chat admission badge could be read as complete development readiness. | Separate chat, coding, host-continuity and continuous-autonomy capabilities; CONTROL/armed and current-binding checks; coding needs an executable backend and Implementer; autonomy also needs Guardian and an independent Critic. No useful-work or self-improvement success is inferred. |
| UI state | Cached/diagnostic state, duplicated readiness polling and ambiguous agent counters could conceal the actual execution state. | One shared readiness resource for top bar, goal form and status bar; stale, invalid or hung observations clear a positive badge; fleet counters derive from current rows; blockers have plain-language labels. |
| Memory UI | Filter changes could be overwritten by late reads; polls ran independently; null or malformed mutation acknowledgements could be treated as success. | Abort earlier observations, sequence memory readbacks, share a bounded page poll, preserve active filters, require HTTP success plus `ok:true`; unavailable write actions are disabled. |
| Advisory RSI | Reject could change an already adopted proposal; rollback trusted arbitrary or changed file contents; a saved draft looked completed. | State-conditional decisions; an owned deterministic path and pinned digest; no overwrite of unrelated files; changed drafts preserved on rollback; exact orphaned draft reconciliation after an interrupted acknowledgement. UI and API explicitly distinguish advisory draft acceptance from evaluated runtime skill activation. |

## Verification contract

Meaningful tests cover budget boundaries, stale routing, exact proof readiness,
late/stale UI readbacks, dirty/missing/busy root composers before effects,
unknown first-draft outcomes after the durable fence, and real HTTP/WebSocket
relay denial. The gateway transport fixture explicitly opts into a synthetic
UI adoption; it is not a live fleet or coding result.

The RSI suite uses an isolated SQLite database and filesystem, with no model
or daemon boot. It exercises changed-content rollback, arbitrary-path denial,
symlink denial, immutable-file preservation and interrupted acknowledgement
reconciliation. Its actual Bun execution is required in CI.

Full Browser regression is required on an unrestricted CI runner. This local
environment denies ten Unix IPC tests and aborts Bun before test startup; its
Next production build fails at the runtime's unavailable RSS observation.
Those are recorded limitations, not passed tests. The locked CI UI quality
job and existing Windows visual/package workflows supply the missing checks.

Windows visual qualification must show chat readiness without an autonomous
ready color, explain coding/continuity blockers, discard stale readiness,
and preserve the existing narrow/wide workspace and native surface checks.
Source qualification must precede a fresh monotonic package identity; the
previous frozen package identity cannot be reused for changed source.

## Remaining physical acceptance gates

1. Install the exact newly qualified candidate and verify the installed source/version.
2. Resolve Guardian HOLD with current machine service, owner and device evidence.
3. Reconcile existing ambiguous sessions from positive native evidence, without blind replay.
4. Admit a real isolated Linux worker through the canonical C1 gate.
5. Prove canonical C2: pinned repository → edit → actual build/tests → verified artifact, with an independent reviewer and durable result delivery.
6. Exercise restart, budget exhaustion, lost acknowledgements and role/session drift in that live path.
7. Evaluate a proposed improvement against a matched baseline and held-out tasks, reject regressions and retain a rollback target before any skill activation.

More control-plane abstractions, additional test counts, or a saved proposal
are not substitutes for these gates. This change repairs confirmed source
defects and truthful observability; it does not assert that the user's machine
has already passed the autonomous-development or self-improvement gates.

## Source qualification before packaging

Source `83aaafaf485e2bca50cadaaf058f87837e8d002f` passed [Critical Audit run 37623582505](https://github.com/PatrickFrome/Compute/actions/runs/37623582505): all 4351 Browser Node tests on Windows, the 97 focused contracts (a subset, not additional independent tests), all 6 isolated Bun RSI lifecycle tests, frozen UI dependency installation, TypeScript and modified-boundary ESLint checks. No test failures or skips were reported in the full Windows run. The next package identity is `0.7.0-dev.37624000001.1`; its package and visual evidence must bind to its own source head. These tests are not evidence of canonical C1/C2 or live self-improvement on the user's machine.
