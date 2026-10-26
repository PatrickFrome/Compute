# Preinstall source-test profile isolation — 2026-10-27

## Disposition

An unintended installed runtime started during a Windows source-test run. That
run is **DISQUALIFIED** as a safe source qualification. Its process exit was
`4294967295`, with reported elapsed time `298.53 s`; it did not establish a
completed passing combined suite.

The coordinator contained the specifically identified test process tree. A
subsequent readback found no remaining members of the recorded descendant list.
The existing PostgreSQL processes and Guardian were not intentionally stopped
and remained running. **Effects on live database contents are
`NOT_DETERMINED`.** Process containment and a descriptor timestamp do not prove
that the database was unchanged. No rollback was performed or claimed.

Runtime-touching tests must now run only on disposable GitHub-hosted Windows.
Deterministic source fixtures may run in a newly isolated Linux scratch profile.
The user's PC, installed Owner, installed runtime and existing PostgreSQL are
not test targets.

## Observed incident scope

The observations in this section were supplied by the coordinator's private
incident JSON and native readback. This audit does not reproduce or independently
inspect the user's live database. Public evidence omits machine-specific paths,
process identifiers and descriptor contents.

| Observation | Recorded result |
| --- | --- |
| Windows checkout HEAD | `0822676cb6b5e9013a67b96ed24a1a68e875ccef` |
| Additional source state | Uncommitted Stream 3 P1 changes; the run was not an immutable exact-HEAD qualification |
| Root test process creation | `2026-10-26T23:23:48.497Z` |
| Installed runtime process creation | `2026-10-26T23:24:41.422Z` |
| Observed ancestry | Root Node test process → heavy test child → installed runtime host → db-api and Deno children |
| Relevant test | `apps/metaengine-browser/test/browser-parent-suspension-cycle.test.mjs` |
| Invocation boundary | Direct combined Node test command, bypassing the disposable-profile test runner |
| Containment admission | Exact recorded PID, parent and creation-time checks, followed by a stop request for the identified root test process |
| Subsequent containment readback | Exact known descendant list empty |
| Existing PostgreSQL / Guardian stop | `false`; six PostgreSQL processes and Guardian remained running and predated the incident |
| Owner descriptor metadata | Post-incident modification time `2026-10-26T18:41:56.4598884Z` |
| Owner descriptor contents | Not read for this incident; no content digest comparison established |
| Live database contents | Not checked; effects `NOT_DETERMINED` |
| Rollback | `false` |

The Owner timestamp is a metadata-only observation. It does not establish byte
identity, database integrity, absence of SQL effects or a successful rollback.
An empty recorded descendant list proves the bounded process observation only;
it is not evidence that prior runtime activity had no durable effect.

## Cause established from source

The suspension test statically imported `nativeSupervisorTransportState` from
`native-supervisor-client-base.mjs` merely to obtain `fleet.agents`. The static
import chain was:

1. `test/browser-parent-suspension-cycle.test.mjs` imported the client base.
2. `src/native-supervisor-client-base.mjs` imported
   `native-supervisor-endpoints.mjs`.
3. The endpoint module imported `local-state-provider-bootstrap.mjs`.
4. That module executed top-level
   `await bootstrapPersistentLocalProvider()` for the ordinary runtime mode.
5. On Windows, `localStateProviderOwnerFile()` selected the descriptor under
   `APPDATA/@metaengine/browser-shell/metaengine-state-provider-v1.json`.
6. A valid existing descriptor caused
   `startConfiguredLocalRuntimeHost()` to verify and spawn the descriptor's
   installed bundle Node executable and runtime-host entry point.

This happened during module evaluation, before the test callback and its
deterministic `signedRequest` / `projectRequest` adapters could run. Redirecting
only temporary files, or clearing only `METAENGINE_*`, cannot isolate the
descriptor selected by the inherited `APPDATA` value.

The existing `scripts/run-isolated-tests.mjs` already explains this import-time
risk and creates a disposable OS profile before starting the test child. Its
bytes were independently compared at Stream 3 head
`e077fbcba2a88134535a593dcd04ed16dabd4ba0` and Stream 7 head
`a836c9e81c17c9e48dab8aa7989937ddc5cf39b7`; they matched. The direct Windows
command did not use that boundary.

No production startup guard is disabled by the correction. No fake READY
marker, diagnostic argument bypass, alternative Owner or production retry
permission is introduced.

## Narrow test correction

Only the suspension test's unnecessary client-base import is replaced with the
existing production leaf projection `browserParentTelemetryFleet` from
`browser-parent-suspension-telemetry.mjs`. Its three census expressions now use
`browserParentTelemetryFleet(state().fleet).agents`.

This is the same fleet projection called by `nativeSupervisorTransportState`.
It retains the reservation, restoration and transport-proof checks exercised by
the suspension scenario. The leaf module imports only `node:crypto`; it has no
Owner bootstrap dependency. The complete cycle, journal, fleet and transport
fixture remain in the test. No production module is changed for this fix.

The prior P1 patch, handoff and RED/GREEN evidence remain unchanged. The new
leaf fix is a separate coordinator overlay.

## Windows CI isolation and acceptance

`client-checkpoint-reconciliation-qualification.yml` uses `windows-2025`, pinned
actions and Node `24.21.0`. It checks the exact PR/push source SHA, disables
checkout credential persistence and rejects source/index drift. Push is limited
to the two preinstall coordinator branches; PR execution uses same-repository
source and the relevant path filters.

Before each component/native test child imports any source, the workflow:

- Creates a new, separate canonical profile below its own `RUNNER_TEMP` work
  directory. Existing profile directories and aliases are refused.
- Sets `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, `HOME`, all four XDG profile
  roots, `TEMP`, `TMP`, `TMPDIR`, and coherent `HOMEDRIVE` / `HOMEPATH`.
- Constructs the child environment from an OS-necessities allowlist. Inherited
  METAENGINE, COMPUTE, PG, LOCAL_STATE, Node preload and Electron discovery
  inputs are absent. Only the measured Git test input and, for the native
  suite, explicit PostgreSQL fixture inputs are then appended.
- Checks the default Windows and XDG Owner descriptors and upgrade gates are
  absent. Existing ancestors are checked from the profile outward before
  following deeper paths. The checks are repeated after the suite.

The workflow does not use `run-isolated-tests.mjs` for the native invocation:
that runner currently removes the required reconciliation flag and source SHA.
The CI-specific explicit environment preserves
`METAENGINE_REQUIRE_RECONCILIATION_PG17=1` and the exact source SHA after clearing
inherited discovery inputs. The PostgreSQL binaries come from the reviewed
hash-pinned preparation helper; the driver comes from frozen runtime `npm ci`.
No default user profile or ambient database connection is accepted as a fixture.

All three Stream 3 P1 test files are registered in the component group. Named
required cases include `OLDER_PENDING`, `FOREIGN_PROJECT`, `UNRELATED_PENDING`
and the complete parent/child suspension regression. The only permitted
component skip is the explicitly separate historical BASE reproduction.
The three native suites require all named reconciliation, existing Host and
Windows profile cases, at least 15 tests, and zero SKIP/TODO outcomes.

The public artifact contains only sanitized TAP and source facts. Raw TAP,
stderr, PostgreSQL logs, connection configuration, generated receipts and
fixture data are excluded. `installed_keeper_used:false` is emitted only when
both fresh-profile isolation checks succeeded; otherwise the claim is unknown.
Its recorded basis is profile/Owner exclusion plus explicit native fixture
inputs. It is not a claim that the user's installed state was inspected.

## Verification completed for this correction

| Check | Result | Scope |
| --- | --- | --- |
| Three P1 suites in a fresh isolated Linux source copy | **73 PASS / 0 FAIL / 0 SKIP**, `1427.276815 ms` | Real deterministic cycle/runtime/SQLite/fleet fixtures; no PostgreSQL or installed runtime input |
| YAML parse and embedded JavaScript syntax | PASS | Static workflow checks |
| TAP validator/sanitizer controls | 8 grouped controls PASS | Reject missing/failed/skipped required cases and remove private diagnostics |
| Isolated-profile controls | 8 grouped controls PASS | Clear inherited discovery, preserve explicit native test inputs, separate profiles, reject reuse, Owner presence, alias and escaped profile paths |
| New hosted Windows component/native qualification | **NOT RUN in this handoff** | Must execute on the final integrated source |
| Earlier direct Windows combined run | **DISQUALIFIED / aborted**, exit `4294967295` | Unintended installed-runtime startup; no safe combined PASS |

The Linux run used a new copy of the prior P1 source handoff based on
`e077fbcba2a88134535a593dcd04ed16dabd4ba0`, with the five P1 source/test digests
checked and only this new leaf-import overlay applied. It does not qualify the
coordinator's later integrated Windows HEAD or uncommitted composition.
The real-runtime Windows failure is not reclassified by the Linux success.

| Artifact | SHA-256 |
| --- | --- |
| Original P1 suspension test, retained | `b24642959c9539a489838057bc4b85e32f945e79caab2ea68d937bbe089960a5` |
| Suspension test with leaf-import correction | `1ab434433d30476f7088494f8c328786d782e0e2290848d6a88368315be4625a` |
| Isolated Linux 73-case TAP | `6b418c0f6d6ad217dafc800badec2da35050cdc5a16ad535f702b63ac572f80b` |
| Revised Windows source qualification workflow | `1ed568e6e7d72c04db4cd9b207cd278a53ca8690652d45a1dc4efe6fb707f4f7` |

## Required next step

Review and integrate the separate leaf fix and workflow, then execute the
required source/component/native checks on disposable hosted Windows at the
actual final source SHA. Keep canonical empty-schema, Windows ACL, installed
autonomy, migration and release acceptance separate. This correction does not
authorize another runtime-touching test on the user's PC, installation,
database rollback, version reuse, merge or package promotion.
