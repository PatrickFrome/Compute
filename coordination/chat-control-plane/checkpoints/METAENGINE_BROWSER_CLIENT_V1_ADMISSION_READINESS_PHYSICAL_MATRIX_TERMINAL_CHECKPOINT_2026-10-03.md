# METAENGINE Browser — Client V1 Admission Readiness Physical Matrix Terminal Checkpoint

Date: 2026-10-03
Authority: evidence/checkpoint only
Release/tag/merge/user-install/promotion authority: false
Automatic physical rerun authority: false

## Exact candidate

Physical/source head:
- `219ebe989a4f7ce2adfeb205a394a47ee55037cf`

Package identity:
- `0.7.0-dev.37139234564.1`
- consumed; MUST NOT be rebuilt or rerun

Source qualification:
- Browser Agent Result Installer Source Qualification `37140337749` / #14 / attempt 1 — SUCCESS
- Linux contract — SUCCESS
- Windows contract — SUCCESS
- Windows R97 source visual flow — SUCCESS
- full Browser regression — SUCCESS on Linux and Windows
- isolated ME2 UI production build — SUCCESS
- one-producer/SLSA topology — SUCCESS
- exact-source unchanged — SUCCESS

## Terminal physical matrix

All entries are attempt 1:

- Package Smoke `37144386164` / #3160 — SUCCESS
- Installed Chat `37144386186` / #2438 — SUCCESS
- Final Runtime `37144386182` / #2019 — SUCCESS
- Autonomous Soak `37144386167` / #2690 — FAILURE
- Self Update E2E `37144386260` / #3609 — SUCCESS
- Shell `37144386185` / #3561 — SUCCESS
- Critical Audit `37144386165` / #2614 — SUCCESS
- Dirty Profile `37144386177` / #1047 — SUCCESS
- Host Resilience `37144386219` / #524 — SUCCESS
- Workspace Reincarnation `37144386171` / #576 — SUCCESS

Terminal result: 9/10 green. The candidate is NOT release-qualified.

No run may be rerun in place. Any source change requires a new source SHA and fresh package identity.

## Exact Package Smoke evidence

Package Smoke producer jobs:
- package identity preflight — SUCCESS
- windows NSIS producer — SUCCESS
- independent SLSA provenance verifier — SUCCESS

Immutable artifacts:
- version reservation id `11282081303`
  - digest `sha256:e307b8c8b95923fd30d22443dd4a5fd1c4350730630a9324b1af2f29a1246da1`
- package evidence id `11281962672`
  - digest `sha256:6527332a847f221cb7844f57e66660437607411f153bc733b3f633790c259055`
- SLSA verification id `11281817945`
  - digest `sha256:c4c5c81a4f261d8e1b4d607b450dcda082c94dc0cdf92850a685ce7555527213`
- immutable candidate id `11281762750`
  - digest `sha256:8692cca988d14251fd90309e650769adf1a0ab3d6ec41e0f517f46e8b8902bce`

Installer:
- `METAENGINE-Browser-Test-Setup-0.7.0-dev.37139234564.1-x64.exe`
- SHA-256 `08e7df73145490c26875aa7783f9ed81026c57488b1b5dde92e7deb494a40e17`

Build identity:
- `d6d352ed0acd6cf30f1cc8d6618fcd9e554d102380151470740a9a24f1cf6e92`
- dependency resolution `3b9dbf4fbbb2dcf025421374101271fab5e6ce29f7305271ef097cf389f64f5a`
- package-lock `aa694fe8ad0669821d3fd6fe416f4b8a918808a1e67be1361455f375f622a02d`
- npm `11.19.0`
- Bun `1.3.3`
- ME2 UI lock `a81d5c2c173747ba19a5461f16485895fabb7aa5f740b95645cb01891547ba81`

SBOM:
- npm semantic inventory `ccf166f761499f168c340ba183a7cd5cd7fe78c3ebc83a37563bea2659e7a150`
- npm raw `058e5e453da44ae3473ef88d6d307e36bc8439b717e27c1191110040c7f22a69`
- npm components 286
- composed semantic inventory `8cb1ed2c42d60dd003d132f57605e6643ebfdb89392472e960287478b07b46ce`
- composed raw `79fee85fd6b2526125501165e18146fe40aa85416bc23018531d09737bae6216`
- composed components 292; first-party 5
- aggregate remains `incomplete`
- authority_effect=false

SLSA:
- GitHub attestation id `52455621`
- subject exact installer SHA-256 above
- Public Good Sigstore certificate
- Rekor log index `3075496933`
- physical builder workflow/ref bound to `browser-windows-package-smoke.yml@refs/heads/physical/build-slsa-provenance-v1`

The package proof remains `signed=false`, `published=false`, `promotion_authorized=false`.

## Independent red: Autonomous Soak

Run:
- `37144386167` / #2690
- failed job `installed-ui-72-activation-race-soak`
- job id `111265484516`

All other soak workflow jobs were green:
- continuous Brain 100k
- fleet scale
- 1M-edge endurance
- all eight chaos seeds

Exact failure:
- `soak_activation_p95_budget_exceeded:1771.21`
- budget: 1000 ms

Failure artifact:
- id `11281663159`
- name `metaengine-browser-windows-autonomous-soak-219ebe989a4f7ce2adfeb205a394a47ee55037cf`
- digest `sha256:71dce1ba303ff4a57e9dc68700895a5acb30815ff4f791b172c5a0d1633b3b79`

Proof:
- 72/72 exact second-instance activations acknowledged
- duplicate Browser runtime observed: false
- concurrent burst: 426.37 ms
- working-set growth: 0 bytes / 64 MiB budget
- handle growth: 12 / 24 budget
- only sequential activation p95 violated

Historical physical control:
- source `b8f2f438bf3d9450a301ebb525eb95181f6d464d`
- Autonomous Soak run `37076381723` — SUCCESS
- p95 157.56 ms under the same 1000 ms budget
- same GitHub runner image `windows-2025-vs2026` version `20260925.250.1`

The core second-instance implementation files are byte-identical between the historical green source and this candidate:
- `src/main-entry.mjs`
- `src/browser-startup-observability.mjs`
- `src/primary-window-resurrection.mjs`
- `src/single-instance-guard.mjs`
- `src/host-resilience-runtime.mjs`

The current journal shows a localized six-activation latency burst around sequential samples 56–61, then recovery. This does not prove a specific root cause, but it falsifies a persistent single-instance protocol regression.

## New source-only successor

A source-only mitigation branch has been created from the consumed exact physical source:

- `work/guardian-observation-failure-backoff-v1`

Current implementation head at checkpoint preparation:
- `a942c4e8604b75c409c9527b07f5dca4940b4623`

Changes:
1. failed Guardian background status reads now establish a bounded one-TTL retry-not-before fence;
2. background heartbeat refresh cannot immediately re-enter the same failing pipe/filesystem observation every ~2 seconds;
3. explicit operator `force=true` reads still bypass the background backoff;
4. positive readiness semantics, owner/device proof, activation invalidation and all authority fences remain unchanged;
5. `automatic_retry_allowed=false` remains unchanged.

Deterministic test coverage proves:
- one failed background read does not repeat during the TTL;
- fail-closed HOLD remains current;
- explicit operator read can force one bounded read;
- exactly one background refresh becomes eligible after the TTL.

Source-only qualification:
- run `37147396254` / #15 / attempt 1
- terminal conclusion must be re-read before claiming qualification.

No fresh physical version has been allocated and the physical producer branch has NOT been advanced to this successor.

## Live control plane

Fresh read-only Supabase state before the successor:
- live installed Browser remains `0.7.0-dev.37103459439.1`
- DevOS environment state CLOSED
- generation floor 28
- keepalive PARKED
- 4 fleet agents BOUND_UNVERIFIED, 0 ACTIVE
- Guardian remains fail-closed on the installed Browser

No admission resume, Edge deployment, Guardian activation, user-machine install, release, merge or promotion was performed by this checkpoint.

## Next safe sequence

1. wait for source qualifier #15 to become terminal;
2. if red, diagnose and fix on a new source commit — never rerun the failed source run blindly;
3. if green, keep the consumed physical candidate immutable;
4. add/retain diagnostic soak evidence without relaxing the 1000 ms SLO;
5. reserve a fresh monotonic package identity only after the exact successor source is qualified;
6. perform one new physical attempt and compare activation distribution against both 157.56 ms historical green and 1771.21 ms failed candidate;
7. treat any next physical source change as requiring yet another package identity.
