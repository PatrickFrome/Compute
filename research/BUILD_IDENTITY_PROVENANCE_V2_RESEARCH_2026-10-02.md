# METAENGINE Browser build identity & provenance research — 2026-10-02

Base runtime source: `1f6902daeae8bc201d1c493e8a413f320a80aeec`  
Research branch only: `analysis/build-identity-provenance-1f6902da`  
Authority: analysis only. No release, updater, admission, or production mutation.

## Incident motivating this research

PR #1089 exposed a build-identity weakness during rapid source iteration. A package version can be committed before a GitHub Actions run starts, then a later source commit can accidentally retain the same version. If both sources reach Package Smoke, the same semantic package identity can refer to different source bytes. Current fail-close handling marks the later bytes collision-contaminated, but hand-advancing package.json on every source change is operationally expensive and easy to race.

The design objective is stronger:

> One physical package identity must map to exactly one source commit, build invocation and artifact digest. Re-running the same invocation may reproduce equivalent bytes, but a different source or invocation must never silently reuse the identity.

## Primary-source findings

### GitHub Actions run identity

GitHub documents:
- `GITHUB_RUN_ID`: unique for each workflow run in the repository and unchanged by a rerun.
- `GITHUB_RUN_ATTEMPT`: starts at 1 and increments for each rerun of that workflow run.
- `GITHUB_RUN_NUMBER`: unique only within a particular workflow.
- `GITHUB_SHA`: commit SHA associated with the triggering event.

Reference:
https://docs.github.com/en/actions/reference/workflows-and-actions/variables

Implication: `run_id + run_attempt + source_sha` is a much safer invocation identity than a manually reserved number copied into package.json. `run_number` alone is insufficient as a repository-global build namespace because it is scoped to one workflow.

### electron-builder supports build-time metadata

electron-builder v26 supports:
- `extraMetadata`, deep-merged into packaged package.json;
- CLI config overrides such as `-c.extraMetadata.foo=bar`;
- `buildNumber` and `buildVersion`;
- artifact file-name macros including `${version}`, `${env.ENV_NAME}`, `buildVersion` and `buildNumber`.

References:
https://www.electron.build/v26/docs/configuration/
https://www.electron.build/v26/docs/file-patterns/
https://www.electron.build/docs/cli/

Implication: exact source SHA, GitHub run id/attempt, workflow identity and a computed build identity can be injected at package time without rewriting the repository source commit. This is preferable to mutating package.json in the checked-out exact source merely to reserve an identity.

### SLSA provenance separates build definition from run details

SLSA provenance v1.2 defines:
- `buildDefinition` for inputs/parameters/dependencies;
- `runDetails` for the actual execution;
- build metadata including an `invocationId`;
- artifact subjects identified by digests.

References:
https://slsa.dev/spec/v1.2/
https://slsa.dev/spec/v1.2/build-provenance

Implication: METAENGINE should treat source identity, build definition/config digest, invocation identity and output artifact digest as distinct bound fields. Version strings are labels, not sufficient provenance.

### GitHub artifact attestations

GitHub artifact attestations can establish where/how binaries were built and can be verified later. Public repositories can use build provenance attestations; verification is available through GitHub CLI. GitHub also supports immutable releases, locking tags/assets after publication and generating release attestations.

References:
https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations
https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases

Implication: for public METAENGINE builds, GitHub attestation is a useful external provenance layer. It should supplement, not replace, the existing internal installer/blockmap/config/source digest binding.

## Recommended architecture: Build Identity V2

### A. Separate application version from build invocation identity

Keep a semantic product version for updater ordering and user display, but add an immutable build identity:

```
build_identity = sha256(
  schema
  || repository_id
  || source_sha
  || workflow_id
  || github_run_id
  || github_run_attempt
  || platform
  || arch
  || builder_config_sha256
  || package_lock_or_dependency_digest
)
```

Properties:
- exact source-bound;
- invocation-bound;
- config/toolchain-bound;
- no wall-clock dependence;
- no random UUID needed;
- different source cannot produce same identity;
- rerun attempt is distinguishable.

### B. Inject immutable build metadata during packaging

Use electron-builder `extraMetadata` or a generated build-manifest resource to package:

```json
{
  "schema": "metaengine.browser.build-identity.v2",
  "source_sha": "...",
  "repository_id": "...",
  "workflow_id": "...",
  "github_run_id": "...",
  "github_run_attempt": 1,
  "builder_config_sha256": "...",
  "build_identity_sha256": "...",
  "semantic_version": "...",
  "authority_effect": false
}
```

The installed Browser heartbeat can expose a bounded copy of this metadata. The cloud should then be able to distinguish:
- semantic version;
- exact source;
- exact package invocation;
- installer digest.

### C. Artifact names should include immutable invocation context

Recommended candidate filename form:

`METAENGINE-Browser-Test-Setup-<semantic-version>-run<GITHUB_RUN_ID>-a<GITHUB_RUN_ATTEMPT>-<short-source>-x64.exe`

This is primarily an evidence/debugging improvement. The actual trust anchor remains the digest + manifest binding.

electron-builder allows artifact-name macros from environment variables, so this can be introduced without source-version mutation.

### D. Enforce a one-to-one registry

Package Smoke should write/verify an append-only evidence record:

```
semantic_version
source_sha
build_identity_sha256
github_run_id
github_run_attempt
installer_sha256
blockmap_sha256
builder_config_sha256
artifact_id
```

Fail closed when:
1. the same semantic version was previously observed with another source SHA;
2. the same build identity appears with a different installer digest;
3. the same installer digest claims a different build identity;
4. package metadata does not match the exact checkout SHA;
5. downstream consumers use a producer other than the one bound in the record.

No record should grant release authority by itself.

### E. Consumer workflows should consume, not rebuild

Installed Chat, Final Runtime, Autonomous Soak and Self Update should consume the single Package Smoke artifact and verify:
- producer workflow/run/attempt;
- exact source SHA;
- build identity;
- semantic version;
- installer SHA;
- blockmap/config digests;
- producer terminal SUCCESS.

The project already follows much of this model. Build Identity V2 mainly removes the remaining ambiguity around package version allocation and makes the invocation identity first-class.

### F. GitHub attestation as external corroboration

After Package Smoke produces the binary, optionally generate a GitHub artifact attestation for the installer digest. Downstream qualification can verify the attestation subject digest and repository/source identity.

This is corroborating evidence, not an authority shortcut. Existing local physical tests, updater behavior, Guardian safety, and user-machine proof remain independent gates.

## Version allocation options

### Option 1 — recommended: semantic version + run-derived immutable build metadata

Keep updater-facing semantic version allocation relatively coarse and make uniqueness/provenance depend on Build Identity V2. Reject any semantic-version/source collision in Package Smoke.

Pros:
- minimal disruption to updater ordering;
- removes reliance on manually unique package labels;
- source stays clean;
- provenance is explicit.

Cons:
- if updater requires every candidate version to be globally unique, the semantic version allocator still needs an automated monotonically increasing component.

### Option 2 — derive prerelease sequence from Package Smoke run id

Generate effective package version at build time, for example:
`0.7.0-dev.<GITHUB_RUN_ID>.1`.

electron-builder can receive build-time package metadata. This makes every Package Smoke run globally unique inside the repository.

Pros:
- eliminates package-version collision by construction.

Risks:
- the source tree no longer contains the exact runtime package version;
- existing tests/contracts that expect package.json version to equal produced installer version must be redesigned around the injected build manifest;
- updater and self-update source/version assumptions need careful migration;
- reruns need defined semantics: same run id but different run attempt, so either include attempt or prove rerun equivalence.

### Option 3 — dedicated durable version allocator

Use a DB/GitHub durable monotonic allocator before build.

Pros:
- explicit stable semantic version before packaging.

Cons:
- introduces a new mutable coordination service and allocation effect;
- allocation can be consumed by cancelled runs;
- more operational complexity;
- does not replace provenance binding.

Conclusion: prefer Option 1 first, then consider Option 2 after updater contracts are adapted. Avoid creating a new version-allocation authority unless evidence shows it is necessary.

## Rerun semantics

A rerun has the same `GITHUB_RUN_ID` and a higher `GITHUB_RUN_ATTEMPT`.

Policy:
- attempt must be part of build provenance;
- if rerun output digest matches the original attempt under identical resolved dependencies/toolchain, record it as reproducibility evidence;
- if digest differs, do not silently replace the first artifact; preserve both attempt identities and classify the difference;
- promotion must bind one exact attempt.

## Release immutability

For a future signed/published release:
1. create draft release;
2. attach exact already-qualified assets;
3. verify hashes/attestations;
4. publish immutable release;
5. lock release/tag/assets.

Do not rebuild during promotion.

## Bounded successor implementation plan

After PR #1089 reaches terminal exact-head green:

1. New successor branch only; do not destabilize the Guardian qualification branch.
2. Add `metaengine.browser.build-identity.v2` manifest generator/verifier.
3. Inject source SHA, repository id, workflow id, run id, attempt and config digest at Package Smoke.
4. Add artifact-name invocation suffix.
5. Add collision tests:
   - same semantic version + different source => reject;
   - same build identity + different bytes => reject;
   - stale producer attempt => reject;
   - consumer rebuild => reject.
6. Update downstream artifact consumers to bind exact build identity.
7. Add GitHub artifact attestation if repository/workflow permissions support it.
8. Run full Windows qualification and one resident self-update using one artifact.
9. Only after evidence, remove manual per-source package-number reservation from ordinary development flow.

## Safety constraints

- Build identity evidence has no release/promotion authority.
- No package bytes are trusted merely because their name/version is unique.
- No source mutation after a package is qualified.
- No rebuild during release promotion.
- A collision is terminal for that package identity; never relabel bytes.
- Failed/cancelled physical build effects remain evidence, not justification for blind retries.
