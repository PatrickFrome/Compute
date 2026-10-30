# Reviewed source export — qualification incomplete

This public candidate is a new, separately reviewed source export rooted directly
at public commit `b98444e672a70ee07f1bc80e7bfeb0ba97084f0f`. Its executable,
test and configuration bytes are copied exactly from the reviewed source snapshot `cecffbd13633fa13c2faa9242f1ea8ba3bdb1288`.
One verification-script comment and the already-public UI report are explicitly
redacted without behavioral changes; their old/new hashes are mapped separately.
It does **not** reproduce that snapshot's Git tree or history: private historical
reports and raw operational logs are replaced by new public evidence summaries.
The original history and evidence remain preserved privately, unchanged.

## Provenance and manifest interpretation

Earlier activation work was reconstructed from incomplete retained source
material plus new implementation and tests. The complete original 41-file tree
was not recovered and byte-identical recovery is not claimed. Exact activation
SQL SHA256 `477be2175c6d0220c4ce1e1942301eca1280d18f5e96da8849d3683b832e8784`
and the earlier pending-goal SQL SHA256
`e891a02a63b95ba72d7ab5b7b717c45cf5ccb10cad01d2d19b8bccb5a0572dd9`
were corroborated historical pins; the latter is historical, not a promise about
the current evolved file. Current exported file hashes are in SOURCE_MANIFEST.
Missing original tests were rebuilt as new tests and freshly checked.

`SOURCE_MANIFEST.json` records current exported hashes: 162 exact source/script
files plus two explicitly mapped documentation-only redactions. Existing
public baseline files not listed there remain unchanged. `EVIDENCE_INDEX.json`
contains safe derived records for all 210 withheld private evidence artifacts,
including their original SHA256 and numeric test outcomes where encoded.
`EVIDENCE_MAPPING.json` maps every original artifact to the new index file and
its exact record digest. A derived record is not the original raw evidence.
Historical manifests are not rewritten or represented as current-tree seals.
No private historical ancestor or unreviewed Owner-read work is included.

## Implemented source scope

- Explicit same-root Save versus Activate, exact prepared project/profile/device
  binding, cancellation, lost acknowledgement/read-only recovery, and newer-goal
  UI fences. Activation does not seed a duplicate goal.
- Exact original IPC child/request/digest physical settlement, caller UNKNOWN
  separate from physical cleanup, rollback-unconfirmed HOLD, retained scope
  cleanup, and explicit-quit upgrade with native-worker drain before Host stop.
- Authenticated read-only predescriptor discovery and durable setup custody.
  Production materialization remains unavailable; no fake task/lease is created.
- Production native draft namespace and UI consumer, scoped draft persistence,
  monotonic freshness, roster stale-state handling and non-overlapping physical
  Observatory reads. The older UI review document retains its technical content; its historical
  pending integration status is superseded by
  the integrated source tests described here, not by installed qualification.
- Existing native admission owner plus additive v2 census/heartbeat guards,
  same-device uncertainty accounting, whole-history digest, exact PG birth and
  guarded first dispatch of retained never-attempted W30 work. Observation does
  not introduce physical first dispatch. No second task allocator is added.
- Pinned helper/controller source changes restrict inherited stdio handles and
  bind checked helper-tree/local-output cleanup. Windows behavior is not proven
  by Linux fixtures. Existing receipt scope is not all-effects settlement.
- Per-run callback custody in the existing IPC client and digest-only local
  journal. Local process-crash semantics are distinct from directory-entry or
  hardware power-loss durability; the unanchored chain cannot detect a coherent
  whole-history rewrite by itself.
- An UNREGISTERED, UNSHIPPED own-PG extension adds an immutable root and advancing
  CAS publication cursor to the existing execution row. Its private Host producer
  checks protected prefix, current bindings and exact postcommit readback. No
  new allocation ledger or authority root is introduced. v1 projections exclude
  the private column; whole-row capacity evidence deliberately changes with it.

## Current admission and qualification blockers

**Default agent-bridge admission is CLOSED:**
`DIRECTORY_DURABILITY_UNQUALIFIED`. The default private publication producer is
`OWNER_CUSTODY_UNBOUND`; constructor data or old permit epochs cannot replace a
current authenticated Owner/control reader. The publication SQL is not registered
or packaged and has no send capability or shared-ticket handoff.

- Local callback journal: `PROCESS_CRASH_ONLY`, `CHAIN_ROOT_UNANCHORED`.
- Callback candidate: `LINEAGE_UNBOUND`; Host callbacks are not durably attested.
- All-effects cleanup remains UNCONFIRMED; historical capacity release DISABLED.
- Production materializer and physical setup handoff remain UNBOUND.
- Required identity/socket lane: BLOCKED, not passed or waived.
- Prior UI dependency-security lane: **3 FAIL**; exact-toolchain reproduction
  BLOCKED. Successful source/UI tests do not qualify those dependencies.
- Windows native helper/handle inheritance, ACL, process identity, storage,
  signing and installed runtime qualification: UNKNOWN.
- Current source/release seal and global CI qualification remain incomplete.

No end-to-end autonomous chat→CLI→critic→repair→checkpoint→next-task or installed
readiness is claimed. This source export neither installs software nor authorizes
production effects, a merge, or release acceptance.

## Recorded reviewed-source verification

The following are recorded results for the reviewed source bytes, not fresh
Windows results and not results inferred merely from this public export:

| Lane | Passed executions | Skipped |
| --- | ---: | ---: |
| Protected-prefix/source contracts | 17 | 0 |
| Actual disposable PostgreSQL publication | 43 | 0 |
| Helper/protected-reader regressions | 310 | 13 native tests; 2 Windows suites |
| Protected receipt/authority actual PostgreSQL | 12 | 0 |
| Default composition/admission components | 322 | 0 |
| IPC/lifetime/journal/activation/draft contracts | 259 | 3 native tests |
| Capacity/service/setup actual PostgreSQL | 103 | 0 |
| Published-scope quit actual PostgreSQL/fork IPC | 2 | 0 |
| Registered full migration stack | 1 | 0 |
| **Total executions in these lanes** | **1,069** | **16 tests; 2 suites** |

These lanes reported zero failures; source parser 273 PASS and changed MJS syntax
15 PASS. Counts are executions, not unique tests across all historical runs.
Actual isolated own PostgreSQL17 and actual fork IPC are distinct from generated
Windows/Owner/ACL fixtures. PostgreSQL process-crash recovery is not hardware
power-loss proof. No new dependencies were installed for that checkpoint.

Initial failure outcomes are preserved as numeric derived records, not hidden by
the final green results. They include quit deadlocks, fixture binding/ordering,
held cleanup, missing test dependencies, SQL parameter encoding, privilege/replay
attestation, and environment startup failures. One initdb failure coincided with
a full temporary filesystem, but its missing stderr means no exact ENOSPC errno
is claimed. Unsupported ancestor identity remained refused; no physical guard
was relaxed by moving fixtures. Original logs and historical manifests remain
private and their exact hashes are listed for provenance.

## Reproduction and remaining native work

The twelve behaviorally unchanged verification scripts retain their original paths
under `evidence/audits/metaengine-20261030-reconstruction/`. They read source and
write new logs; withheld historical logs/manifests are not test inputs. Use
already qualified pinned dependencies and a disposable own PostgreSQL17 directory
when running the PG suites. Do not apply the unregistered publication SQL to an
installed database. `verify-callback-pg-publication.sh` is the latest combined
source/fixture command; its explicit blocker messages remain unchanged.

A separate public-export check record distinguishes tests actually rerun on this
public tree. Later native/dependency/Owner/publication work must be reviewed on
its own exact source and must not reinterpret these recorded limitations.

## Fresh public-tree reproduction

The unchanged latest combined verifier was also executed on this separate public
worktree: **1,069 passed executions, zero failures, 16 native test skips and two
Windows suites skipped; source parser 273 PASS**. `PUBLIC_EXPORT_CHECKS.json`
records each lane and raw-log digest separately from the historical results.
The first attempt recorded 17 source passes and one PG failure because the new
worktree lacked its ignored driver fixture. Copying the already present pinned
37-file driver fixture with matching hashes resolved that environment omission;
no dependency installation or network fetch occurred. That failure is retained
as a distinct record. No withheld historical evidence file was needed as test
input. The required socket, prior UI dependency and native qualification limits
above remain open and are not waived by this reproduction.
