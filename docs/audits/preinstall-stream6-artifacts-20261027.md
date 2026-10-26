# METAENGINE Stream 6: producer-bound sidecar, 2026-10-27

## Review disposition

**STATUS: READY_FOR_REVIEW for the source implementation; PHYSICAL_BLOCKED.**

- Issue: [#1361](https://github.com/PatrickFrome/Compute/issues/1361).
- Coordination: [#1354](https://github.com/PatrickFrome/Compute/issues/1354).
- BASE_SHA: `9d7527683060e314eb1d39fec9ce2304a57103c4`.
- BRANCH: `work/preinstall-artifacts-20261027`.
- PR base: `work/preinstall-closure-20261027`.
- The exact published HEAD/PR and subsequent CI readback are recorded in the
  issue handoff. This report is part of that reviewed commit; it does not embed
  a self-referential future commit hash.

The task was claimed before edits in
[this comment](https://github.com/PatrickFrome/Compute/issues/1361#issuecomment-6429127543).
The checkout was created separately from the exact BASE_SHA and was clean.
The initial closure audit and five-stream protocol were read at that SHA, along
with the current seven-worker issue and its ownership exceptions.

No new package, reservation, version or installer was produced. No installation,
Owner/PGDATA/Guardian/registry effect, release action, merge or issue closure was
performed. The consumed `0.7.0-dev.1784381341133.1` was not reused or changed.

## Delivered source

| File | Result |
| --- | --- |
| `apps/metaengine-browser/scripts/qa-forward-candidate-evidence.mjs` | Hosted-producer capture after the existing successful installation; strict installer re-verification, immutable artifact binding, real tree comparison, generated uninstaller measurement and separate staging |
| `apps/metaengine-browser/scripts/qa-forward-candidate-sidecar.mjs` | Shared v1 schema, bounded stable inventory, cross-hash checks, complete artifact-cardinality checks and original terminal-SUCCESS binding |
| `apps/metaengine-browser/scripts/qa-forward-candidate-archive.mjs` | Bounded ZIP/ZIP64 reader and materializer, exact manifest/file checks, empty-directory reconstruction and semantic offline-runtime verification |
| `apps/metaengine-browser/test/qa-forward-candidate-evidence.test.mjs` | Producer fixture and CLI refusal controls |
| `apps/metaengine-browser/test/qa-forward-candidate-sidecar.test.mjs` | Schema/run/artifact/hash/path/strict-installer negative controls |
| `apps/metaengine-browser/test/qa-forward-candidate-archive.test.mjs` | ZIP structures, payload substitution, aliasing, limits and materialization controls |
| `.github/workflows/browser-windows-package-smoke.yml` | 62 additive lines: identify existing candidate upload, retain actual install result, capture/upload separate sidecar and report pins pending terminal completion |
| `docs/audits/preinstall-forward-sidecar-schema-v1.md` | Consumer-readable contract, APIs, pin template, limits and qualification order |
| This report | Evidence, limitations and coordinator handoff |

The shared `qualified-installer-consumer.ps1`, existing installer gates, package
manifests/locks, reservation/history, closure seals and migration implementation
are unchanged. Producer lifecycle changes are limited to the specifically
delegated capture/upload work; the single existing builder invocation remains.

## Contract and trust chain

Stream 2 proposed v1 in
[comment 6429076518](https://github.com/PatrickFrome/Compute/issues/1361#issuecomment-6429076518).
Stream 6 accepted it and published
[the empty-directory/runtime-digest clarification](https://github.com/PatrickFrome/Compute/issues/1356#issuecomment-6429169519).
Stream 2 acknowledged the same schema in
[comment 6429210007](https://github.com/PatrickFrome/Compute/issues/1361#issuecomment-6429210007).

The separate artifact is `metaengine-browser-windows-forward-sidecar-<source>`.
Its root manifest binds source/version, repository/workflow/run/number/attempt/
event, original candidate artifact ID/ZIP digest, original installer SHA-256,
ASAR SHA-256, semantic runtime bundle digest, complete runtime/PostgreSQL trees,
full image rows and the generated uninstaller. The original immutable candidate
is not amended. The uninstaller is measured only from the producer's fresh
installation and is absent from `win-unpacked`.

Capture calls the existing `compareQaInstalledImage` and the unchanged strict v3
installer verifier. The original `dist-test` installer, published named installer
and actual `candidate-setup.exe` must match. The sidecar's installed receipt is
also checked internally: exactly one additional file, a positive bounded
uninstaller size, and a reconstructed exact installed-tree digest.

The pure consumer binder requires independently supplied live GitHub metadata,
the complete paginated artifact collection, exact externally pinned artifact
IDs/digests, and actual evidence returned by the unchanged installer verifier.
A valid receipt cannot substitute for a failed, pending, missing or stale
producer. The materializer separately validates the original ZIP and actual
bytes; it does not assert terminal qualification.

The pinned uploader omits directory entries and defaults to excluding hidden
files. The new upload includes hidden files only from the vetted staging root.
The materializer recreates declared safe directories, including empty ones, and
requires an exact subsequent full-tree fingerprint. No unlisted payload is
accepted. Native Node ZIP handling checks raw names before any path normalization.

## Verification results

Environment: Linux, Node `v24.22.1`. All new executable-looking file bytes and
installation receipts in unit tests are explicitly synthetic and inert.
Tests invoke the real filesystem capture/comparison/materialization functions;
they do not constitute real NSIS, Windows, installed-runtime or migration proof.

| Executed set | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| New schema/producer/archive filesystem controls | 228 | 0 | 0 |
| Separate production CLI refusal control | 1 | 0 | 0 |
| Existing tree/snapshot/forward-policy/offline-runtime regression | 71 | 0 | 0 |
| Existing provenance/reservation/bounded-installer/topology regression | 69 | 1 | 1 |
| Total unique selected checks | **369** | **1** | **1** |
| Independent pristine-anchor topology reproduction, not added to total | 5 | 1 | 0 |

Thus **all 229 new checks passed**. The existing failed topology assertion and
the native-Windows skip remain explicitly non-PASS.

The one failed existing test is
`tests/browser-slsa-physical-topology.test.mjs`, “prepared source identity is
exact across package, lock and candidate without claiming physical reservation”.
It compares the current package `.1784381341133.1` with the historical prepared
identity `.1359740117434.1` in
`apps/metaengine-browser/CONVERGENCE_CANDIDATE.md`. The identical failure was
reproduced in another clean worktree at BASE_SHA, and those inputs/test were not
changed here. It is reported in
[the coordinator dependency](https://github.com/PatrickFrome/Compute/issues/1354#issuecomment-6429328143).
The worker does not change versions or loosen that equality to make it green.

The single regression SKIP is “Windows installer parent and descendant lifetime
are bounded without killing unrelated processes” in
`package-installer-bounded.test.mjs`. This host has no native Windows process/job
or PowerShell execution proof. YAML parsed successfully; source assertions
confirmed immutable upload settings and exactly one existing builder invocation.
All three new runtime modules passed `node --check`; `git diff --check` was clean.

### Exact commands

Run from the repository root. The temporary directory was a newly created
disposable task directory, not a user profile or installed state directory.

```sh
export TMPDIR=/workspace/scratch/ff3d588acf2c/test-tmp

node --test --test-isolation=none --test-reporter=tap \
  --test-skip-pattern='CLI cannot' \
  apps/metaengine-browser/test/qa-forward-candidate-evidence.test.mjs \
  apps/metaengine-browser/test/qa-forward-candidate-sidecar.test.mjs \
  apps/metaengine-browser/test/qa-forward-candidate-archive.test.mjs

node --test --test-isolation=none --test-reporter=tap \
  --test-name-pattern='CLI cannot' \
  apps/metaengine-browser/test/qa-forward-candidate-evidence.test.mjs

node --test --test-isolation=none --test-reporter=tap \
  apps/metaengine-browser/test/qa-installed-tree-fingerprint.test.mjs \
  apps/metaengine-browser/test/qa-installed-image-snapshot.test.mjs \
  apps/metaengine-browser/test/qa-operator-install-recovery.test.mjs \
  apps/metaengine-browser/test/qa-forward-install-policy.test.mjs \
  infra/client-state-runtime/offline-runtime-bundle.test.mjs

node --test --test-isolation=none --test-reporter=tap \
  apps/metaengine-browser/test/installer-provenance.test.mjs \
  apps/metaengine-browser/test/installer-provenance-v2.test.mjs \
  apps/metaengine-browser/test/installer-provenance-v3.test.mjs \
  apps/metaengine-browser/test/qualified-installer-consumer-contract.test.mjs \
  apps/metaengine-browser/test/package-build-reservation-workflow.test.mjs \
  apps/metaengine-browser/test/package-installer-bounded.test.mjs \
  tests/browser-slsa-physical-topology.test.mjs

node --check apps/metaengine-browser/scripts/qa-forward-candidate-evidence.mjs
node --check apps/metaengine-browser/scripts/qa-forward-candidate-sidecar.mjs
node --check apps/metaengine-browser/scripts/qa-forward-candidate-archive.mjs
git diff --check
```

The filesystem and CLI commands split execution contexts, not test coverage:
the sandbox disallows spawned Node, while its outer Linux overlay exposes a
negative signed inode for `/workspace`. Both the existing preserved-path guard
and the new physical-identity guard refuse that outer path. The actual CLI
refusal and provenance/loopback tests ran in the separately permitted subprocess
context. Every one of the 229 new checks executed; no identity guard was weakened.
Earlier incompatible-context runs failed and are not counted as passing runs.

Pristine-anchor reproduction:

```sh
git worktree add --detach ../compute-stream6-baseline \
  9d7527683060e314eb1d39fec9ce2304a57103c4
# In that worktree:
node --test --test-isolation=none --test-reporter=tap \
  tests/browser-slsa-physical-topology.test.mjs
```

### Local transcript digests

These are source-test log hashes, **not** installer/artifact qualification pins.
The source commands above are the reproducible evidence; exact-head CI URLs
are added in the GitHub handoff when observed.

| Transcript | SHA-256 |
| --- | --- |
| `new-sidecar-final.tap` | `595553c99ad6fb7b5178b18e6a0e4e5b40493c513c9dbbeaac91e9d777afe54f` |
| `producer-cli-final.tap` | `b503d6575ea1cfd57871f37f00134a9581a01e6b89196042ff2af62890c43117` |
| `tree-regression.tap` | `979d458e52e52c0d7c71fcfd8ba2b342b70422598413010c4a105acb0f9d00dc` |
| `provenance-regression.tap` | `1df8863e2397966651b47927251138820e2779411c9683f2567100fe298fd16e` |
| `baseline-topology.tap` | `e9c87d4666ed2e45aa07f1ff896b02131c7bc919a4941949f2600f399d4eeeaa` |

## Independent review and remaining limits

Independent source review found two defects that were corrected before the
final checks: Windows Unicode aliases missed by simple lowercase folding, and
a tightened depth limit applied one level too late. Both have negative controls.
The existing canonical hash format is unchanged. Final review found no remaining
blocking source defect in the reviewed producer/schema/archive implementation.

The archive reader has hermetic controls for stored/deflated entries, signed and
unsigned descriptors, ZIP64 end records, and the pinned writer's archive-only
and central-only ZIP64 representations. The exact writer dependency sources
were inspected. Executing the real external `archiver@7.0.1` writer was **NOT_RUN**:
automatic approval review rejected the optional networked dependency installation
outside the checkout. That action was stopped, with no bypass; source inspection
and dependency-free compatibility fixtures were used instead. A genuine hosted
artifact upload/download and native-Windows materialization are still unverified.

### Stream 2 integration dependency

The v1 fields match Stream 2's PR #1366. At its reviewed immutable
`043652d746392ada4ae60a7d7db09da8bd78446b`, four concrete consumer gaps remained:
empty-directory reconstruction, complete run-artifact uniqueness, invocation of
the unchanged strict installer verifier for **both** original installers before
NSIS, and semantic offline-runtime verification during materialization.
The exact paths, requested helper adoption and acceptance tests are posted in
[DEPENDENCY_REQUEST 6429241036](https://github.com/PatrickFrome/Compute/issues/1354#issuecomment-6429241036)
and linked in the consumer issue. This worker did not modify Stream 2's files.
Later Stream 2 commits/CI must be re-read during integration; this observation
does not claim review of an unobserved later revision.

### Physical qualification

| Required real evidence | Status |
| --- | --- |
| Final integrated/resealed source SHA and centrally issued fresh version | BLOCKED / coordinator |
| One terminal-success original Package Smoke run/attempt | BLOCKED |
| Real immutable installer + sidecar IDs, ZIP/manifest/installer/ASAR/runtime/uninstaller digests | BLOCKED; none claimed by this stream |
| Pinned modern offline predecessor and reviewed real zero-data schema dump | BLOCKED / coordinator |
| Native Windows artifact materialization and installed forward migration | BLOCKED / integrated consumer |
| Autonomous N-to-N+1 or user-PC installation | Not performed and not established by this sidecar work |

The safe next step is source review of this draft PR, compatible integration
with Stream 2, exact-source Windows/Linux checks and coordinator resealing/fresh
identity preparation. Only then may the coordinator run the one package producer
and use its same pinned artifacts for installed consumers. Later failure keeps
the sidecar unqualified. `DONE`/`ACCEPTED`, integration and release authority stay
with the coordinator.
