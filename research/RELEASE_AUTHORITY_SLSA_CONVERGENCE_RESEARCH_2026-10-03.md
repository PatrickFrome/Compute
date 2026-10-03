# METAENGINE Browser — Release Authority / SLSA Convergence Research

Date: 2026-10-03
Scope: source/evidence architecture only
Authority effect: false

## Freshly proven boundary

The exact physical candidate `a68774eb6ad5a0fe8014501163b0c67f608bed09` has:
- 10/10 terminal physical qualification;
- one Package Smoke installer producer;
- producer-side SLSA provenance with an independent verifier;
- a release-attestation SLSA binding implementation source-qualified on Linux/Windows;
- a separate read-only admission proof that reacquires the exact installer, downloads the exact immutable producer SLSA artifact, reconstructs the exact Sigstore bundle, re-verifies it cryptographically and rechecks builder/source/run/subject semantics.

This closes the pre-release SLSA evidence chain without publishing a release.

## Existing release-authority gate

The canonical Browser gate is:
`apps/metaengine-browser/src/browser-fabric-release-authority-gate.mjs`

It already requires four distinct proof classes:
1. `metaengine.trusted-dev-release.v1` — the canonical published-release resolver result;
2. `metaengine.browser-fabric.immutable-release-evidence.v1` — locked tag/assets/attestation and exact manifest/installer/installed-executable digests;
3. `metaengine.browser-fabric.provenance-evidence.v1` — SLSA v1, verified, trusted builder, exact source and installer subject;
4. `metaengine.browser-fabric.source-ancestry-evidence.v1` — independent fast-forward proof from current authority SHA to candidate SHA.

Even after all four pass, the gate returns only:
`AUTHORITY_ADVANCE_CANDIDATE`

with:
- `requires_separate_journaled_promotion_effect=true`;
- `release_authority=false`;
- `automatic_retry_allowed=false`;
- `authority_effect=false`.

Therefore release attestation or SLSA evidence alone must never be interpreted as live release/promotion authority.

## Gap found

The release-authority gate validates that provenance evidence contains:
- `verified=true`;
- `builder_trusted=true`;
- a syntactically safe `builder_id`;
- exact SLSA predicate type/source/subject;
- zero authority effect.

It does not itself pin `builder_id` to the canonical Package Smoke workflow.

The freshly qualified producer evidence *does* bind the builder cryptographically to:
`https://github.com/PatrickFrome/Compute/.github/workflows/browser-windows-package-smoke.yml@refs/heads/physical/build-slsa-provenance-v1`

and the new read-only release admission independently checks that exact builder, source SHA, run/attempt and subject.

This makes the current evidence chain strong before the gate, but the gate's local contract is more generic than the evidence producer.

## Recommendation

Do not change the already physically-qualified Browser candidate merely to tighten this post-release gate before a release exists.

Instead:
- keep `a68774eb...` frozen as the physical candidate;
- keep the release-attestation SLSA binding branch source-only;
- when the project is explicitly authorized to create a release, generate the existing canonical published-release assets without rebuilding the installer;
- independently derive immutable-release and ancestry evidence from that exact published release;
- then run the existing pure release-authority gate read-only;
- before any actual promotion effect, consider a source-only successor that pins the canonical builder id in the release-authority gate and physically qualify that successor as a separate package identity.

This preserves convergence and avoids invalidating a 10/10 physical candidate for a post-publication hardening that is not required to prove the present pre-release chain.

## Non-effects

This research does not authorize or perform:
- GitHub Release/tag creation;
- manual release-attestation dispatch;
- release publication or promotion;
- user-machine installation;
- Guardian enrollment;
- Supervisor admission;
- task dispatch;
- physical package retry/rebuild.
