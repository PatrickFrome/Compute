# METAENGINE Browser Build/Release Checkpoint — Verification Source Qualified V3

Date: 2026-10-03
Authority: evidence only
Promotion authority: false
Automatic retry allowed: false

## Exact implementation frontier

PR: #1098 — Build: self-verify release attestation bundles
Branch: `work/build-release-attestation-verification-v1`
Exact head: `2a423b549168efe54ece5d688ba2ed9a2d11514f`
Base: `work/build-release-attestation-v1 @ c95606cb09e81f509b4ee371fcd4cedca84a0bc8`
PR state: open / draft / mergeable

Final net diff from base contains exactly five files:

- `.github/workflows/browser-release-attestation-admission-qualification.yml`
- `.github/workflows/browser-release-attestation-source-qualification.yml`
- `.github/workflows/browser-release-attestation-v1.yml`
- `scripts/release-attestation-verification.mjs`
- `tests/release-attestation-verification.test.mjs`

No net `apps/metaengine-browser/**` change remains.

## Exact-head CI

Source Qualification:
- run `37065335507`
- event `pull_request`
- exact head `2a423b549168efe54ece5d688ba2ed9a2d11514f`
- conclusion `SUCCESS`

Admission Qualification:
- run `37065335533`
- exact head `2a423b549168efe54ece5d688ba2ed9a2d11514f`
- conclusion `SKIPPED`
- reason by contract: stacked PR base is `work/build-release-attestation-v1`, not the physical candidate `work/build-composed-sbom-v1`.

On reopen, no Browser Package Smoke, Installed Chat, Self Update, Autonomous Soak, Critical Audit, or Shell run was created. The path-isolation repair therefore removed the unintended physical CI fan-out from the final PR diff.

## Earlier fan-out evidence retained

The first PR layout on head `dab7cb29b103f579db16f37f858f55cc7b817cfe` intentionally remains part of audit history.

Package Smoke run `37064866854` failed safely at the package identity fence:

`PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED`

with:
- requested package `0.7.0-dev.37006000001.1`
- source `dab7cb29...`
- prior artifact id `11225991366`
- prior producer `37006158040`
- prior physical source `694b106925...`

All downstream build/install steps in that run were skipped.

This proves the package identity fence prevented a source-only successor from silently creating a second physical binary under a consumed version.

## Physically-qualified subject remains unchanged

- source: `694b106925cb7a1ce9b4d7918962821b152c0583`
- package: `0.7.0-dev.37006000001.1`
- installer SHA-256: `631dc5751e9ea731d3575a3263b0d54ce264564a060133002d9f38130d7ebc14`
- Build Identity V3: `c06711d023ffb4fd3c35d827fdd9d3ca4b44f869d659e524fffb7f901c330201`
- composed SBOM raw SHA-256: `09d456784fa9a469b13d6081041f423f756f4cdfc0a74c7019472000095ac663`
- composed semantic inventory SHA-256: `8173986ff547f418c5c1ee6d572bbb5732450f80380f329d5c43fd87097c93df`
- physical matrix: 10/10 SUCCESS
- Package Smoke producer: `37006158040` / run number `3149` / attempt `1`

## Verification policy now encoded

The manual release-attestation workflow now requires local-bundle verification against:

- exact repository;
- exact signer workflow;
- exact signer digest;
- exact source digest;
- exact source ref;
- explicit GitHub Actions OIDC issuer;
- denial of self-hosted runners;
- dated trusted-root snapshot;
- exact custom qualification predicate type;
- exact CycloneDX predicate type;
- repository-owned semantic predicate/SBOM verifier.

Proof remains zero-authority:
- `automatic_promotion=false`
- `promotion_authorized=false`
- `release_published=false`
- `authority_effect=false`

## Still not performed

- no manual release-attestation workflow invocation;
- no signed release attestation generated;
- no GitHub Release/tag;
- no merge/promotion;
- no production Edge/DB deployment;
- no Browser install/update on user machine;
- no Supervisor/Guardian/fleet task effect.

## Next safe frontier

Do not add another Browser feature generation.

Next research should focus on the minimal canonical release-evidence manifest that can bind:
physical source + package identity + installer digest + Build Identity + composed SBOM + physical qualification matrix + verified attestation proof.

The manifest must be evidence only until an explicit, separate release-authority gate exists.
