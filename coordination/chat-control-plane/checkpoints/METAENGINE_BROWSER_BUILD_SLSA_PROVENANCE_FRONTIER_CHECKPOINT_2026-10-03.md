# METAENGINE Browser Build/Release Checkpoint — SLSA Provenance Frontier

Date: 2026-10-03
Authority: evidence only
Promotion authority: false
Automatic retry allowed: false

## Implementation line

PR #1098: `Build: self-verify release attestation bundles`
Branch: `work/build-release-attestation-verification-v1`
Exact head: `72dec6367e89a2cbde24f3bd057e7e7eb6a320e5`
Base: `work/build-release-attestation-v1 @ c95606cb09e81f509b4ee371fcd4cedca84a0bc8`

Exact-head checks:
- Source Qualification push run `37065847144`: SUCCESS
- Source Qualification PR run `37065851353`: SUCCESS
- Admission Qualification run `37065851339`: SKIPPED by stacked-base guard

Net diff is five release-evidence files only; no `apps/metaengine-browser/**` product change remains.

## Research line

Branch: `analysis/build-release-attestation-verification-v1`
Current head after donor census:
`8c5838aa807fa80c4c825973d52b52be6370a39c`

Research:
`research/BUILD_RELEASE_AUTHORITY_SLSA_INTEGRATION_RESEARCH_2026-10-03.md`

Key decision:
do not invent a second canonical release manifest. Integrate with existing:

- `verified-self-update-manifest.json`
- `metaengine.browser.self-update-e2e-manifest.v2`
- `metaengine.trusted-dev-release.v1`
- `metaengine.browser-fabric.release-authority-gate.v1`
- `metaengine.browser-fabric.provenance-evidence.v1`

## Absorbed historical donors

Reviewed:
- R86 `work/r86-build-once-provenance-v1 @ 865ef8fad91e054659e52c6f112fbd272ee1705d`, PR #990
- R90 `work/r90-build-once-overlap-convergence-v1 @ 1ca341fc3e6f03d34bade36c8960754791a444c8`, PR #994

Their useful semantics — one NSIS producer, immutable early artifact, exact producer binding, parallel consumers, terminal producer-success gate — are already absorbed by the current Package Smoke / qualified-installer-consumer architecture.

They are donor/evidence lines, not merge targets.

## Physically-qualified subject remains immutable

- source `694b106925cb7a1ce9b4d7918962821b152c0583`
- package `0.7.0-dev.37006000001.1`
- installer SHA-256 `631dc5751e9ea731d3575a3263b0d54ce264564a060133002d9f38130d7ebc14`
- Package Smoke producer run `37006158040` / #3149 / attempt 1
- physical matrix 10/10 SUCCESS

No new installer has been built.

## Missing evidence class

Current Browser Fabric release authority gate explicitly requires:

`predicate_type=https://slsa.dev/provenance/v1`

with:
- verified provenance;
- trusted builder;
- builder id;
- exact physical source SHA;
- exact installer name;
- exact installer SHA.

Current qualified installer predates that build-time GitHub/Sigstore provenance evidence.

It must not be retroactively represented as having been built by the later release-attestation workflow.

## Next physical implementation gate

Only after the current source-only attestation-verification line is accepted as stable, create a new physical candidate with a fresh package identity.

Required sequence:

1. fresh source SHA + unused package version;
2. package-version reservation;
3. one Package Smoke physical build;
4. emit SLSA `https://slsa.dev/provenance/v1` for the installer from the actual producer path;
5. retain portable Sigstore bundle in immutable candidate evidence;
6. independent read-only provenance verifier;
7. emit exact `metaengine.browser-fabric.provenance-evidence.v1`;
8. full physical qualification matrix on the same bytes;
9. no automatic release/promotion;
10. later feed existing release-authority gate, which may emit only an authority-advance candidate.

## Future hardening horizon

GitHub documents ordinary artifact attestations as a SLSA Build Level 2 path and reusable build workflows as the stronger path toward Build Level 3.

Therefore:
- P0: integrate honest provenance into the current Package Smoke producer model;
- P1: separately evaluate moving build+attest into a pinned reusable workflow.

Do not mix the P1 architecture refactor into P0 unless required by a demonstrated blocker.

## Hard fences

- no current installer rebuild;
- no consumed package-version reuse;
- no fake retroactive provenance;
- no duplicate scheduler/release-manifest/authority plane;
- no merge/tag/release publication in this checkpoint;
- no production Edge/DB write;
- no user-machine install/update;
- no fleet/Supervisor/Guardian/task effect;
- no blind retry.
