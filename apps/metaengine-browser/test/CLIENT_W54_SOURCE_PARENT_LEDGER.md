# W54 — Windows visual/self-update source repair (not a frozen package)

Request: `metaengine-client-wave9-w54-20261015-001`. W54 owns this
isolated branch; **W43 #1273 at b24e240b3a273a9622a3983a1029faa53d6a6576**
is the exact source parent. The W46 #1270 package version
`0.7.0-dev.842024784850.1` has an immutable reservation and MUST NOT
be rebuilt or used for W54. W46 does not contain W43's native/Owner
convergence; W51 must be independently pinned and integrated before any
distinct W13 version/NSIS attempt.

Diagnosed immutable failing CI:
- W46 PackageSmoke 38647016017: source preflight green, Windows
  `Capture R97 primary chat-fleet visual evidence` failed
  `ui1_admin_connection_masquerades_as_execution_ready`; no EXE/SLSA
  subject was created.
- W46 SelfUpdate 38647015839: contract 60/5015 failures. Failures include
  retired UI/hosted endpoint tests, no-Owner `null/v1/commands/wait-batch`
  URL errors and unrelated Browser rollover tests. **NOT PASS**. This
  partial repair does not change the 4xx/5xx redelivery or signature
  contracts, nor claim that other 60 failures are green.

Source repair:
- A single pure, bounded badge projection differentiates ADMIN transport
  from verified CHAT_DISPATCH; missing/inconsistent trust returns
  `UNAVAILABLE`, ambiguous supervisor stays `Recovery required`,
  CLOSED authority stays `Execution paused`. No green continuous-autonomy
  display without chat, coding, Guardian, verifier capability readbacks.
- The existing TopBar consumes this projection. Its previous unconditional
  `Connected` badge obscured a separate execution state. This changes the
  UI truth, not the screenshot assertion to force a PASS.
- Replaces stale `cloud-first` native endpoint tests with offline,
  fail-closed no-Owner/loopback-path/hosted credential and traversal
  negatives. Offline test mode is explicit `--metaengine-version-probe` to
  prevent accidental installed Host/PG boot during contract validation.
- New `client-visual-readiness-w54.test.mjs` uses actual work readiness
  and checks lost Owner, ambiguous effect, forged flags, paused control,
  chat-only READY and presentation authority/effect segregation.

This PR is **SOURCE/STAGING REVIEW_REQUIRED**, no installed or live
claim. Next gates: exact-head W54 source CI, W51 integrated ancestry +
all broad Client/SelfUpdate/visual tests, W13 distinct package reservation,
one ordinary Windows PackageSmoke/SelfUpdate attempt, real artifact digest,
SLSA/signature, rollback and physical installed Owner proof. Any red gate
blocks package/installation readiness.
