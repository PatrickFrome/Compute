# METAENGINE Browser Checkpoint — SLSA Runtime Proof + One-Producer Physical Prep

Date: 2026-10-03
Authority: evidence only
Promotion authority: false
Automatic retry allowed: false

## SLSA runtime probe

Branch:
`work/build-slsa-attest-runtime-probe-v1`

Latest exact head:
`ebf7affadd85832cf295283b844a14624b241b9c`

Workflow:
`Browser SLSA Attest Runtime Probe`

Run:
`37074940435` — SUCCESS

Both jobs:
- `probe` on Ubuntu — SUCCESS
- `probe-windows` on windows-2025 — SUCCESS

Windows attestation:
`52309904`

Windows subject SHA-256:
`420dbcb36613459b379fb498c765fabe106de26c573c10a3e66fd19942e627c0`

Windows evidence artifact:
- id `11256585039`
- digest `sha256:50a24a828de4011610b0a3c2b4a7500de030d69aca244c351c36cd3c4b38836d`

Observed GitHub CLI:
`2.101.0`

The runtime path proved:
- immutable `actions/attest` pin;
- GitHub OIDC-backed SLSA provenance;
- Public Good Sigstore signing;
- Rekor transparency log upload;
- portable bundle;
- local `gh attestation verify`;
- exact repo/signer workflow/source SHA/source ref;
- self-hosted runner denial;
- semantic projection into `metaengine.browser-fabric.provenance-evidence.v1`;
- `authority_effect=false`.

No Browser installer was built by this probe.

## One-producer convergence

Branch:
`work/build-one-producer-dirty-profile-v1`

Exact head:
`8a03e0f8f2e70dcf6d3870ef050ceed49aaccf8b`

Source qualification:
`37074686671` — SUCCESS

Shell-First Dirty Profile no longer runs a second `electron-builder` NSIS build.

It now:
- acquires the Package Smoke installer;
- binds exact producer identity and event;
- tests those exact bytes;
- waits for exact Package Smoke terminal success.

Package Smoke trigger closure includes Dirty Profile.

No physical package identity was consumed.

## Physical SLSA preparation

Branch:
`work/build-slsa-physical-prep-v1`

Exact qualified head:
`d45b0f0b8d40320f4b0c3ad5646541ecccf73d46`

Source qualification:
`37075932409` — SUCCESS

Current package version is still:
`0.7.0-dev.37006000001.1`

No new package identity has been reserved or built.

The future activation branch is:

`physical/build-slsa-provenance-v1`

All ten physical Browser workflows now contain a push path for that branch:
1. Browser Windows Package Smoke
2. Browser Windows Installed Chat Qualification
3. METAENGINE Browser Final Runtime Activation V1
4. METAENGINE Browser Windows Autonomous Soak V1
5. METAENGINE Browser Self Update E2E
6. METAENGINE Browser Shell V1
7. METAENGINE Browser Critical Audit V1
8. METAENGINE Browser Shell-First Dirty Profile V1
9. METAENGINE Browser Host Resilience Login Start V1
10. Browser Workspace Reincarnation V1

The activation package-version commit will therefore fan out the same source SHA across the full physical matrix.

## Package Smoke SLSA contract

On the dedicated physical push only, Package Smoke is prepared to:

- reserve fresh source + package identity first;
- build NSIS once;
- resolve exactly one installer subject;
- create GitHub SLSA provenance with pinned `actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6`;
- require OIDC/GitHub SHA to equal the physical source SHA;
- persist portable Sigstore bundle + receipt in the immutable candidate artifact;
- complete existing physical package/installed checks;
- run an independent `slsa-provenance-verify` job;
- verify the local bundle with exact signer workflow, source digest and source ref;
- reject self-hosted provenance;
- emit exact Browser Fabric provenance evidence.

Downstream shared installer consumers automatically require producer event `push` on this physical branch.

Package Smoke still contains exactly one physical NSIS builder invocation.

## Source-preparation defects and recovery

The source qualifier deliberately exposed several preparation defects before any package identity was consumed.

Run `37075389886`:
- failed two stale/over-broad test assertions;
- implementation behavior around event fencing was already present.

Runs `37075483276` and `37075528798`:
- progressively isolated assertion/static-checker mistakes;
- no physical package effect.

An exact-subject workflow edit then triggered JavaScript replacement-string `$'` expansion and corrupted the Package Smoke YAML.

GitHub invalid-workflow evidence:
- `37075682592`
- `37075850189`
- `37075896292`

These had zero jobs. Therefore:
- no reservation step started;
- no installer build started;
- no package identity was consumed;
- no blind rerun was performed.

Package Smoke was reconstructed from the last known-good physical-prep source, the exact-subject edit was reapplied safely, and exact head `d45b0f0...` qualified green.

## Existing physical candidate remains untouched

- source `694b106925cb7a1ce9b4d7918962821b152c0583`
- package `0.7.0-dev.37006000001.1`
- installer SHA-256 `631dc5751e9ea731d3575a3263b0d54ce264564a060133002d9f38130d7ebc14`
- Package Smoke `37006158040` / #3149 / attempt 1
- previous physical matrix 10/10 SUCCESS

## Next evidence-gated step

The source-only prerequisites for the first SLSA physical Browser candidate are now green.

Before activation:
- choose a fresh unused dev package version;
- update both `package.json` and root package entry in `package-lock.json` atomically;
- create the exact `physical/build-slsa-provenance-v1` branch from `d45b0f0...`;
- make one activation commit;
- allow Package Smoke reservation preflight to be the fail-close authority on source/version freshness;
- never rerun a failed physical producer attempt;
- if the producer fails after reservation, advance both source SHA and package version before another physical attempt.

Success requires:
- Package Smoke with SLSA verifier terminal SUCCESS;
- all nine downstream physical workflows terminal SUCCESS on the same source;
- one-built installer identity preserved across consumers;
- exact SLSA evidence bound to that installer and source.

## P1 after P0 physical proof

GitHub documents artifact attestations alone as SLSA Build Level 2.

Reusable build workflows plus artifact attestations can support the stronger Build Level 3 architecture.

Do not mix that builder-isolation refactor into the first P0 physical proof.

## Hard fences

- no reuse of `0.7.0-dev.37006000001.1` for a new physical source;
- no retroactive/fabricated SLSA provenance;
- no second installer producer;
- no blind physical retry;
- no release/tag/merge;
- no production Edge/DB write;
- no user-machine install/update;
- no fleet/Supervisor/Guardian/task authority.
