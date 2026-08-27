# Main Roadmap Accelerators — evidence-backed implementation decision

Audience: METAENGINE H205F22 developers and Supervisor
Date: 2026-08-27
Scope: accelerators that reduce cycle time immediately without changing the
sealed Level-1 roadmap or treating PREP evidence as execution authority.

## Executive answer

The current canonical critical path remains `W1_PERSISTENT_LINUX_WORKER_SAFETY`
(Level-1 `C1`). The live Supabase roadmap has definition integrity and alignment
integrity, and W1 has the largest immediate dependency fan-out: it directly
unlocks `T1_TOOLCHAIN_PARITY_VERIFICATION` and
`A1_ISOLATED_WORKSPACE_AGENT_ADAPTER`, which then unlock the first serial coding
loop and most later acceleration work.

The strongest authority accelerator—an effective-execution preflight—is already
present in the fresh W1 rail. The highest-value missing accelerator is a
deterministic cycle oracle that combines live roadmap fan-out with exact Git
rail ancestry and emits a reproducible, explicitly non-authoritative checkpoint
payload. It prevents repeated stale-branch work and makes every future W1/F1/R1
cycle begin and end on a causally exact rail.

## Decision criteria

Candidates were ranked by:

1. transitive canonical milestones unblocked;
2. repeated time saved across future cycles;
3. ability to work with free, repository-local primitives;
4. compatibility with GLM-first, fail-closed, no-arbitrary-eval invariants;
5. no premature substitution for real W1/C1 or C2 runtime evidence.

| Candidate | Immediate value | Decision |
| --- | --- | --- |
| Effective execution preflight | Prevents stale `ACTIVE` labels from becoming provider authority | Reuse existing W1 implementation |
| Roadmap Cycle Oracle | Prevents stale-rail races; makes fan-out priority and checkpoints deterministic | Implement now |
| CI sharding / impact graph | Current full Python suite has been measured in seconds; canonical C12 is later | Defer |
| Remote cache / REAPI | Requires proven hermetic identity and worker parity first | Defer to C4/C11 |
| Browser Operator durable supervisor | High leverage, but v0.6.7 still has a user-browser installation boundary and must preserve GLM-first | Integrate as a later oracle consumer |

## Live roadmap analysis

Supabase readback on 2026-08-27 returned:

- roadmap ID `compute-fabric-roadmap-v1`;
- sealed/current definition SHA-256
  `96068a842c7dcb37d216aad6defc7b51e291394e916f76beed447be630024925`;
- no Level-1/Level-2 drift;
- next mainline `W1_PERSISTENT_LINUX_WORKER_SAFETY`, status `READY`;
- parallel ready set W1, F1, and R1.

W1 wins the immediate fan-out comparison. F1 contributes to production
acceptance but does not unlock the serial coding spine. R1 unlocks the
durability chain. W1 unlocks both toolchain parity and isolated workspace work,
which converge on the first real serial coding loop. On the exact 28-milestone
live snapshot, the oracle counts 21 transitive W1 dependents, including 13
critical-path descendants; R1 has 4 transitive dependents and F1 has 2.

## Analogue comparison and design implications

### Computer-use harnesses

OpenAI's current computer-use guide says the model returns actions for the
application's harness to execute, recommends isolated environments, and treats
page content as untrusted. It also places confirmation policy in product design
and says on-screen content is not permission. This supports keeping authority
and durable receipts outside the page/model response.

Anthropic's computer-use documentation likewise recommends a low-privilege VM
or container, domain allowlists, and human confirmation for consequential
actions, and warns that webpage/image prompt injection can override model
instructions. This corroborates Browser Operator's typed-action and
page-is-data boundary.

Microsoft Playwright MCP operates on structured accessibility snapshots and
describes deterministic tool application as an advantage over screenshot-only
interaction. This supports retaining Browser Operator's structured node-bound
actions and using visual coordinates only after exact node binding.

### Durable lifecycle

Chrome MV3 documentation says service workers can terminate unexpectedly and
global variables are lost; durable state must be saved in `chrome.storage` or
another persistent store. A cycle oracle therefore emits a serializable receipt
rather than relying on process memory.

Temporal Continue-As-New checkpoints state into a new Workflow Run with a new
Run ID and fresh history. That is the correct analogue for supervisor chat
rollover: create a new causal attempt and preserve prior outcome; never resend a
possibly actuated physical UI effect.

### Concurrent Git rails

Git documents `merge-base --is-ancestor` as the direct test for ancestry and
fast-forward compatibility. The oracle uses this primitive instead of guessing
from timestamps or branch names. PLAN accepts only a clean worktree at the exact
live remote commit. PUBLISH accepts only a clean local strict descendant of an
unchanged remote commit. Remote advancement or divergence blocks before push.

## Implemented accelerator

`controller/roadmap/roadmap_cycle_oracle.py`:

- validates the complete dependency graph and rejects cycles/unknown edges;
- verifies sealed/current definition equality and alignment integrity;
- binds the complete live snapshot and canonical Git source identity by SHA-256;
- ranks eligible work by canonical next-mainline, critical descendants,
  transitive dependents, direct unlocks, phase, and priority;
- binds the selected Level-2 target to an exact Level-1 mapping;
- checks Git ancestry and exact remote-head freshness;
- supports separate PLAN and PUBLISH phases;
- produces canonical JSON SHA-256 evidence and a ready-to-submit checkpoint
  payload;
- always returns `canonical=false`, `authority_effect=false`, and no provider,
  DDL, Edge, merge, or roadmap-promotion authority.

## Limitations

The oracle is a PREP accelerator. It cannot create a real Linux worker, renew a
claim/directive, mutate a provider, deploy Supabase changes, merge PR #57, or
advance a milestone to VERIFIED. It depends on a freshly fetched Git ref and a
fresh authoritative Supabase snapshot supplied by the caller. Browser Operator
v0.6.7 remains locally/CI verified but requires a new user-browser roundtrip for
live enrollment and supervisor dispatch evidence.

## Claim-to-source ledger

| Claim | Source | Publisher | Date/update | URL | Access note |
| --- | --- | --- | --- | --- | --- |
| Harness owns action execution and page content is untrusted | Computer use | OpenAI | accessed 2026-08-27 | https://developers.openai.com/api/docs/guides/tools-computer-use | Official documentation |
| Computer use needs isolation, allowlists, and consequential-action oversight | Computer use tool | Anthropic | accessed 2026-08-27 | https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool | Official documentation |
| Structured accessibility snapshots enable deterministic browser actions | Playwright MCP | Microsoft | accessed 2026-08-27 | https://github.com/microsoft/playwright-mcp | Official repository |
| MV3 globals disappear and state must persist outside the worker | Extension service worker lifecycle | Google Chrome | accessed 2026-08-27 | https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle | Official documentation |
| Continue-As-New starts a fresh run/history with carried state | Continue-As-New | Temporal | accessed 2026-08-27 | https://docs.temporal.io/workflow-execution/continue-as-new | Official documentation |
| `merge-base --is-ancestor` is the direct Git ancestry test | git-merge-base | Git project | manual 2.43+, accessed 2026-08-27 | https://git-scm.com/docs/git-merge-base | Official manual |
| Artifact verification requires producer expectations, not provenance alone | Verifying artifacts | SLSA | v1.2 | https://slsa.dev/spec/v1.2/verifying-artifacts | Open specification |

## Search and stop record

Primary-source review covered current OpenAI and Anthropic computer-use safety,
Chrome MV3 lifecycle, Playwright structured interaction, Temporal rollover, Git
ancestry, GitHub workflow concurrency, and SLSA verification expectations. The
search stopped after the missing accelerator, implementation primitive, safety
boundary, and defer decisions all had primary support and no material conflict
remained.
