# METAENGINE Browser Runtime Compatibility — continuation audit

Date: 2026-09-01
Branch: `work/browser-runtime-compatibility-v2`
Pre-checkpoint head: `03b521d2543e76ae218d9b56d49590f857982c1f`
PR: #166 (`work/browser-runtime-compatibility-v2` -> `work/browser-continuous-fleet-audit-v1`)

## Scope and authority

This is branch-local evidence only. It does not authorize a main merge, production Supabase/Edge mutation, Browser release, automatic replay of ambiguous physical effects, or a second scheduler.

## Closed gate: physical Windows N -> N+1

GitHub Actions run `33556378176` completed the full `windows-n-to-n-plus-1` job successfully on exact source head `03b521d2543e76ae218d9b56d49590f857982c1f`.

Observed completed stages:

1. contract gates before packaging;
2. build baseline N installer;
3. install N and seal real profile continuity marker;
4. build exact target N+1 and update metadata;
5. execute one physical update transaction N -> N+1;
6. verify target version, real profile continuity and singleton;
7. stage and upload evidence.

Evidence artifact:

- artifact id: `9819651376`
- name: `metaengine-browser-self-update-e2e-03b521d2543e76ae218d9b56d49590f857982c1f-1`
- artifact digest: `sha256:4665066085409f2247675acaf68fac0a5188a1650fa7a93c4f08adcc99f6b820`
- production promotion: not authorized by this evidence.

This closes the missing physical same-lineage updater proof from the old `0.6.1-dev.2.1` source-test capsule. It does not close signed supply-chain provenance or production runtime compatibility deployment.

## Closed gate: full Node contract suite

The shell contract job on the same source lineage completed `584/584` tests PASS after three test-contract repairs:

- platform-aware DevOS pre-effect recovery: Windows `WRITE_AHEAD_PLATFORM_UNVERIFIED_V1` remains ambiguous instead of being falsely requeued;
- heartbeat route oracle now requires Meta controller lease before reconcile/snapshot while preserving the single existing scheduler;
- self-update handoff tests isolate transaction state and preserve unresolved `PREPARED` fail-closed evidence.

No runtime code was weakened to obtain these passes.

## Remaining CI defect: Development Plane PR source identity

The current `METAENGINE Browser Shell V1` physical Development Plane smoke is RED on pull requests for a provenance reason, not a sandbox/runtime capability failure.

GitHub `pull_request` checkout uses `refs/pull/<n>/merge` by default. The Development Plane candidate verifier correctly accepts only an exact authoritative `refs/heads/*` remote source. In PR CI the repository is therefore detached at the synthetic merge commit and `REPO_HEAD_READ` returns no branch ref; remote-bound verification fails closed with `candidate_remote_ref_invalid` before the sandbox-plan stage.

Required repair:

- preserve synthetic-merge checkout for merge-compatibility contract tests;
- run physical Development Plane provenance smoke from a second exact PR-head checkout bound to `github.event.pull_request.head.sha` and its same-repository branch ref;
- assert checked-out HEAD equals the event head SHA before smoke;
- keep `candidate-remote-source.cjs` restricted to `refs/heads/*`; do not admit `refs/pull/*` as authority.

## Branch lineage audit

All counts below are relative to pre-checkpoint head `03b521d2543e76ae218d9b56d49590f857982c1f`.

### Contained

`work/browser-meta-orchestrator-v1 @ c0e3d3c277c4e36d3802448dfa6db78ab68f3981` is a strict ancestor of the current line. Current head is 89 commits ahead / 0 behind. No separate integration is needed.

### Diverged authority-bearing lineages

- `work/c0-restart-effect-receipt-persistence-v1 @ c64006525e4a2cd15d467f05c2bc5d266f935363`: diverged, 104 commits ahead of the common merge base and 327 commits behind current. Contains durable restart intent, generation provenance, successor acceptance, effect receipts and persistence gates. Integrate only by semantic slices.
- `work/c5-server-lease-verifier-quality-repair-v1 @ 38d4f6e611056df226ecfb1120cf76a29b72b748`: diverged, 50 ahead / 327 behind. Contains target revalidation, transport proof/promotion and server lease verification. Do not bulk merge.
- `work/devbrowser-workspace-registry-v1 @ fc0298015acfbca58560c223ac4777cc20a4efdc`: diverged, 44 ahead / 327 behind. DB registry migration is already duplicated byte-for-byte in the audit lineage; remaining useful payload is primarily `workspace-manager.mjs`, `workspace-git-hardening.mjs` and their tests.
- `integration/compute-unified-v1 @ a23b647220c6bdeaa4340f804575dc2009e434cb`: diverged, 289 ahead / 638 behind. It remains a separate capability universe containing R4-R16 perception, WebMCP, skill sandbox/runtime, durable action graph/fence, trace replay, remote browser pool and adaptive routing. Reconcile capability-by-capability only.

### Compact selective candidates

- `work/windows-fleet-chaos-convergence-v1 @ c5f4ac67c99e421e4e6a9f4637e1f7d80fc594e6`: only 2 unique commits, changing `native-supervisor-client.mjs` and `native-supervisor-heartbeat-watchdog.test.mjs`. High-value selective semantic audit candidate.
- `work/devos-self-update-evidence-harness-v1 @ eb3d51a4a36a787a1814d78627087119f1cedaec`: only 1 unique workflow commit. It hardens singleton evidence by reading the durable reported primary PID rather than trusting the transient `Start-Process` handle, and captures first/second stderr. This is reliability hardening, not a blocker for the now-proven physical N -> N+1 path.

## Research checkpoint

### GitHub PR source identity

GitHub documents that `pull_request` workflows use the synthetic merge ref by default; `actions/checkout` explicitly supports checking out the PR head when head-only identity is required. METAENGINE should therefore keep two distinct CI semantics: merge-result compatibility and remote-authoritative branch provenance.

### Supply-chain provenance

GitHub artifact attestations can provide cryptographically signed build provenance bound to repository, workflow, triggering event and commit SHA. This should become the next release-evidence layer rather than inventing a parallel custom signing plane.

### Windows update signing

Modern electron-builder/electron-updater supports Authenticode verification of downloaded NSIS updates and publisher-name binding. Production promotion should require signed installer identity and fail-closed publisher rotation; development unsigned physical N -> N+1 evidence is necessary but not sufficient.

### Browser incarnation evidence

Future convergence should add a lifecycle provenance ledger sourced from CDP/BiDi target/context lifecycle events. Destruction/crash/replacement should monotonically fence the previous target generation rather than relying mainly on UI/URL observations.

### Observability

A later cross-cutting slice should map Goal -> Plan Generation -> Node -> Agent Turn -> Tool/Browser Effect -> Evidence -> Reconcile into OpenTelemetry-style traces, keeping model/tool content tainted and authority decisions in typed receipts.

## Dependency-safe next order

1. Repair Development Plane PR-head provenance CI without weakening branch-only remote verification.
2. Re-read exact-head CI after that repair and preserve the already-green N -> N+1 artifact as immutable evidence for `03b521d...` only.
3. Selectively reimplement the two Windows heartbeat-storm commits if current code still lacks their invariant.
4. Selectively reimplement the singleton evidence hardening if it remains non-duplicated.
5. Reconcile C0 restart-effect receipt semantics with the current DevOS effect journal.
6. Reconcile C5 post-lock transport/server-lease semantics and Workspace Manager runtime slices.
7. Add signed artifact provenance + Windows signing before any production promotion discussion.
8. Treat `integration/compute-unified-v1` as capability-source material, not a merge target.

## Safety invariants preserved

- no blind retry after ambiguous Browser effect;
- exact task/agent/tab/target/agent-generation/lease-generation binding;
- platform durability claims cannot exceed what the OS/runtime proves;
- no second scheduler loop;
- no page/model/repository text authority;
- no production mutation or release authorization from this checkpoint.
