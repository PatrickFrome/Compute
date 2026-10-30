# Current fresh-schema inventory repair

Base: `5d7ec74db1c72b15921a6e00a2826a09a72f4fb2`.
**Current inventory and guard tests only. SQL bytes, migration registration,
production loader behavior and historical release seals are unchanged.**

Exact-head [Client State Runtime Contracts](https://github.com/PatrickFrome/Compute/actions/runs/41113874664)
failed four tests on Windows and Ubuntu with `fresh_schema_upgrade_plan_changed`.
The registered catalog already included `native-coding-capacity-v2.sql`, but its
current fresh-schema inventory ended at setup-operation. This is a source
integration omission, not the separate immutable historical source-seal failure.

The unchanged local reproduction was **4 PASS / 4 FAIL / 3 optional skips**.
The inventory now adds only that already-registered resource and its exact
SHA256 `7892d0fd3594ebaa115080402ced50b99d6c54940f75533e71fe262ae14d914c`,
derived from the existing `loadLocalRuntimeMigrationPlan()` catalog. Existing
entries and all SQL bytes are unchanged. In particular callback-publication SQL
remains UNREGISTERED; this fix does not grant publication or execution readiness.

New tests compare the full ordered catalog and exercise the actual loader in a
disposable source copy. Missing, duplicate, reordered, forged and extra
unregistered entries are rejected before SQL acquisition. No repository source,
running database or validation guard is modified by these negative fixtures.

## Verification

- Source tests: **10 PASS**, zero failures; three optional fixture skips before
  explicitly configuring the PG lane.
- Actual own-PG17 fresh/atomic application plus migration/replay: **13 PASS**,
  zero failures; only two supplemental WASM cases skipped. Actual PG cases ran.
- The message-addressed parent wake case that failed in the Windows checkpoint
  lane also passed against actual disposable PG17: **1 PASS**, no skips.
- Related source/packaging/byte-integrity/consent contracts: **106 PASS**, no skips.
- Changed test syntax and diff checks PASS. Counts overlap across lanes.

The real PG paths exercise fresh application, exact registered upgrades,
repeated no-change replay, privilege/partial-install/disabled-trigger refusal,
and the existing parent message-wake behavior. The existing pinned driver
fixture was copied with 37 file hashes verified; no dependency installation or
hosted/installed PostgreSQL was used. Linux PG results do not certify Windows
process, ACL or installed runtime behavior.

The checkpoint's original public-source manifest stays frozen. Current source
seal/global CI, separate Windows callback/helper failures, genuine Owner and
publication handoff, materializer, and other native qualification gaps remain
open. No workflow rerun, installation, release or gate waiver occurred here.
