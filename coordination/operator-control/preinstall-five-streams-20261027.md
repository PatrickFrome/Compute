# METAENGINE: five-stream pre-install coordination, 2026-10-27

## Shared authority and source

The coordination issue is [#1354](https://github.com/PatrickFrome/Compute/issues/1354).
It publishes the immutable ANCHOR_SHA for all four worker branches after this
source repair commit exists. The integration branch is
`work/preinstall-closure-20261027`, based on
58fadfb354375ba8af4bd9249a459b5b2a8d9f46 (PR #1353).

All worker chats must fetch and check out that explicit SHA in separate
worktrees/checkouts. A moving branch name, an older local clone or the shared
user-PC installation is not a valid substitute. Existing worktrees with unrelated
changes must not be reset, cleaned or reused.

The user will launch four ordinary GPT-6 Pro chats manually. This protocol does
not claim that a chat has started merely because its GitHub issue exists. The
earlier six DevFleet tabs remain PREPARED_NOT_SENT, blocked by the observed model
usage limit; no task send was attempted.

## Work allocation

| Stream | Owner | Task | Branch |
| --- | --- | --- | --- |
| 0 | Main chat / coordinator | Integration, shared source contracts, package identity, one artifact producer, exact-source CI and acceptance | work/preinstall-closure-20261027 |
| 1 | User-launched worker chat 1 | [#1355](https://github.com/PatrickFrome/Compute/issues/1355): installed normal launch, activation and autonomous soak | work/preinstall-soak-20261027 |
| 2 | User-launched worker chat 2 | [#1356](https://github.com/PatrickFrome/Compute/issues/1356): disposable Windows forward migration, preserved PG/Owner and restart | work/preinstall-migration-20261027 |
| 3 | User-launched worker chat 3 | [#1357](https://github.com/PatrickFrome/Compute/issues/1357): useful native goal, independent Critic, checkpoint/successor continuity | work/preinstall-continuity-20261027 |
| 4 | User-launched worker chat 4 | [#1358](https://github.com/PatrickFrome/Compute/issues/1358): user-visible UI flow, immutable runtime and dependency applicability | work/preinstall-ui-20261027 |

Worker issue bodies define detailed scope and acceptance. Scope is exclusive
until the coordinator records an explicit handoff. Shared Browser startup/main
entrypoints, installer policy, Browser package manifests, version reservations,
closure seals, release/producer workflows and the integration branch stay with
the coordinator. A worker may propose a narrowly scoped patch to these files
through DEPENDENCY_REQUEST; it must not silently acquire shared-file ownership.

## Status and evidence protocol

Each worker posts a CLAIMED comment before editing, with BASE_SHA, branch and
planned files. Then it opens a draft PR targeting the integration branch and
links it in its issue. Use the same issue for progress at meaningful milestones,
a blocker, and the final evidence handoff. There is no automatic synchronization
between separate ChatGPT conversations.

Use this compact record:

```text
STREAM:
STATUS: CLAIMED | IN_PROGRESS | BLOCKED | READY_FOR_REVIEW
BASE_SHA:
HEAD_SHA:
BRANCH:
PR:
FILES:
TESTS: exact command, environment, PASS/FAIL/SKIP, evidence URL
ARTIFACT: source/version/producer run+attempt/artifact ID/SHA-256, if applicable
FINDING: observed facts; hypotheses explicitly labelled
DEPENDENCIES:
NEXT:
```

DEPENDENCY_REQUEST specifies the exact file or artifact, the requested change,
why it is necessary, and the acceptance check. A worker continues independent
source work while an artifact dependency is blocked. Do not change another
worker's branch, merge PRs, rewrite shared history or silently rebase another
chat's workspace.

The coordinator reviews every PR against its frozen base, integrates selected
changes in order, resolves shared-file changes and refreshes the current source
seal. Only the coordinator marks a task ACCEPTED and closes it, after the
required source/artifact/physical proof exists. READY_FOR_REVIEW does not mean
installed-qualified or production-ready.

## Integration and artifact sequence

1. Publish this functional source repair anchor, preserving historical audits and
   all frozen W43-W73 evidence.
2. Workers develop and verify isolated changes; the coordinator reviews their
   PRs and integrates compatible source changes.
3. Qualify the resulting exact source SHA. A prior SHA's CI green never qualifies
   newly changed bytes.
4. Plan and reserve a fresh package identity strictly above the consumed .178
   identity using a real live reservation observation. The retained .178 string
   in this source-only anchor does not authorize another build.
5. Run one Package Smoke producer for that exact source/version. All installed
   consumers use its immutable installer; no worker rebuilds a private candidate.
6. Run the required disposable Windows consumers and attach source-bound
   evidence. Review remaining blockers before any user-PC installation.

The coordinator supplies the migration stream's missing candidate-image inputs:
a producer-bound unpacked image inventory and uninstaller hash from the same
single producer. The consumer must cross-check source/version/run/attempt,
artifact identity and installer SHA. It must not derive its expected hash from
the untrusted installed successor and accept that value without comparison.

The migration harness must run its fixture PG executable and PGDATA outside
the old installed image and retirement/new-state directories. It needs a pinned
modern offline predecessor and a genuinely published predecessor Owner; a
manually fabricated Owner/STOPPED receipt is not a substitute. Manual migration
success cannot qualify the separate automatic self-update transition.

## Safety and completion boundary

The user's existing Browser/Owner/PGDATA/Guardian/registry are not test fixtures.
No worker installs or modifies them. Physical installation and migration tests
run only on disposable Windows. No broad process kills, old uninstaller,
automatic retry of an ambiguous external effect, fabricated receipt, weakened
RequireFreshInstall, or skip-to-PASS conversion.

Credentials and private runtime payloads are not issue/CI artifacts. Keep
diagnostics bounded and allowlisted. Source tests, fixture proof, installed
artifact qualification, useful autonomous work and production authorization are
separate claims. Record missing prerequisites explicitly.

The current local evidence is documented in
`docs/audits/preinstall-closure-20261027.md`: 189 focused Windows passes, zero
failures, one non-Windows-only skip, and all four mandatory Windows PG guards
actually executed. These are working-tree results; exact-anchor CI and all
later package/installed qualifications remain separate gates.
