# METAENGINE Browser Build/Release Checkpoint — Attestation Trust Split + Authority Integration

Date: 2026-10-03
Authority: evidence only
Promotion authority: false
Automatic retry allowed: false

## Current source-only implementation

PR: #1098 — Build: self-verify release attestation bundles
Branch: `work/build-release-attestation-verification-v1`
Exact head: `72dec6367e89a2cbde24f3bd057e7e7eb6a320e5`
Base: `work/build-release-attestation-v1 @ c95606cb09e81f509b4ee371fcd4cedca84a0bc8`
PR: open / draft / mergeable

Net diff contains exactly five files and no Browser product subtree changes.

## Exact-head qualification

- Source Qualification push `37065847144`: SUCCESS
- Source Qualification PR `37065851353`: SUCCESS
- Admission Qualification `37065851339`: SKIPPED by intended stacked-base guard

No physical Browser workflow was triggered by the final path-isolated head.

## Trust split now encoded

Top-level workflow permissions: `{}`.

Signer job:
- actions read
- contents read
- id-token write
- attestations write
- artifact-metadata write

Independent verifier job:
- actions read
- contents read
- no OIDC/signing permission

Signer material is transferred via pinned download/upload artifact actions and immutable artifact id.

Verifier enforces:

- exact repository;
- exact signer workflow;
- exact signer digest;
- exact source digest;
- exact source ref;
- explicit GitHub Actions OIDC issuer;
- deny self-hosted runners;
- local bundle;
- custom trusted-root snapshot;
- exact custom qualification predicate;
- exact CycloneDX predicate;
- semantic statement binding.

Final verification result remains zero-authority.

## Existing Browser release authority discovered

Do not create a new release manifest.

Existing release line already has:

- `verified-self-update-manifest.json`
- `metaengine.browser.self-update-e2e-manifest.v2`
- `metaengine.trusted-dev-release.v1`
- `metaengine.browser-fabric.release-authority-gate.v1`
- `metaengine.browser-fabric.provenance-evidence.v1`
- `metaengine.browser-fabric.immutable-release-evidence.v1`
- `metaengine.browser-fabric.source-ancestry-evidence.v1`

The release gate requires SLSA predicate:
`https://slsa.dev/provenance/v1`.

## Important integrity decision

The current physically-qualified installer was built by Package Smoke run `37006158040` without a GitHub/Sigstore SLSA build-provenance attestation.

Do not create retroactive build provenance in the later release-attestation workflow.

SLSA build provenance describes the build platform/process that actually produced the subject. A later qualification workflow may attest facts about an existing subject, but it must not impersonate the producer.

Therefore current exact physical subject remains:

- source `694b106925cb7a1ce9b4d7918962821b152c0583`
- package `0.7.0-dev.37006000001.1`
- installer SHA `631dc5751e9ea731d3575a3263b0d54ce264564a060133002d9f38130d7ebc14`
- physical matrix 10/10 SUCCESS

but is not promoted to "SLSA build provenance proven."

## Next physical slice — not yet executed

On a future fresh source/package identity:

`Package Smoke actual build → SLSA provenance generation → immutable one-built artifact + bundle → full physical matrix → independent SLSA verification → metaengine.browser-fabric.provenance-evidence.v1`.

No physical build has been started for this next slice.

## Research document

`research/BUILD_RELEASE_AUTHORITY_SLSA_INTEGRATION_RESEARCH_2026-10-03.md`

## Hard fences

- no rebuild of current installer;
- no package identity reuse;
- no retroactive/fake provenance;
- no duplicate release manifest;
- no auto-promotion;
- no merge/tag/release publication in this checkpoint;
- no production Edge/DB write;
- no user-machine install/update;
- no fleet/Supervisor/Guardian/task effect;
- no blind retry.
