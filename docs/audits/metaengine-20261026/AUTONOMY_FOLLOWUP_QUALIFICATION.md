# Independent local followups to frozen source 19694ae2

These changes are separate from the 82-file candidate awaiting publication approval. They have not been published, merged to main, or installed on the user's computer.

## Durable pending-effect fairness

Retirement scans use prefix-filtered keyset pagination over existing SQLite custody. UNKNOWN entries are retained; page iteration does not issue model/tool effects. Parent spawn recovery scans exact project/task/claim/generation state fairly across stale leases. It validates complete pages before effects and pins the initial authoritative claim/project through recovery, including callers without an explicit claim ID. Three review-discovered race/validation gaps were reproduced and fixed before integration. No fixed logical agent-count or recursion-depth limit is introduced.

Independent stress fixture: 257 stale same-parent UNKNOWN entries are scanned in 33 calls at eight entries per call. The original immutable batch is read back once; stale custody is not deleted or replayed. Restart resets advisory cursors safely. This is source/SQLite fixture evidence, not live model execution.

## PostgreSQL concurrency

The test factory optionally reserves a second independently authenticated backend in its own disposable PostgreSQL17 cluster. Twelve deterministic interleavings verify actual `pg_blocking_pids`, ungranted locks, distinct transaction IDs, final committed/aborted status, and persisted outcomes. Coverage includes suspension/resume conflicts and replay, allocator exclusion, rollback, Owner-stop ordering, generation fences and late transport denial. Both handles and the owned cluster are cleaned on callback failure. Independent failure probes include terminated backends and detached in-flight SQL.

Combined local native-PG17 and supplemental-PG18-WASM source suite: 38 passed, zero failed/skipped. These tests use synthetic authority/Owner-stop data and do not qualify signed transport or arbitrary production schedules.

## Inspection database identity

Privileged inspection and restricted API connections must name the same actual database, not merely the same cluster/host/port. The initial alias-tolerant proposal failed independent review because pinned postgres.js uses the raw URL database path while psql receives its decoded name. The corrected implementation rejects encoded/empty/malformed/control-containing database names rather than guessing equivalence; plain identical names allow separate credentials and either PostgreSQL scheme. Encoded Unicode/space database names are deliberately unsupported by this launcher boundary.

Independent full launcher/runtime-host checks: 49 passed, zero failed, one Windows-only DACL skip. This is not Windows DACL proof.

## Browser dependency and resolver updates

Electron 44.9.3, fast-uri3.1.9, http-cache-semantics4.3.0, and undici6.29.1/7.30.1 preserve supported parent ranges and product version. Exact Electron version, official tarball and SHA-512 are shared by W78 and the qualified resolver; a different well-formed digest is rejected before package-code execution. Real previous-version controls reproduce URI scheme activation, incorrect SRI acceptance and response-decoding process crashes; updated dependencies reject/survive those cases.

Earlier authorized-tool audit snapshot reported zero remaining Browser findings; independent repeat audit was denied pending permission to transmit dependency names/versions to npm and was not retried. The http-cache-semantics advisory is disputed upstream; clearing the reported range is not claimed as a demonstrated semantic exploit fix. Source tests do not prove the new Electron binary or Windows installer.

## Boundaries

- Frozen source 19694ae2 and its pending publication decision remain separate.
- No bulk registry audit is repeated while metadata-transmission permission is pending.
- Native Guardian redemption still requires an independently authenticated local installed-code bridge. Backend SQL capability or ADMIN status alone cannot provide that authority.
- New immutable package identity, exact-head remote CI, installed Windows/DPAPI/Guardian proof and end-to-end continuous autonomous operation remain outstanding.

## Integrated local regression readback

On the followup integration after the reviewed Browser and parent-recovery changes, the full Browser suite in its standard app working directory terminates naturally: 6,146 tests, 6,054 passed, 27 failed, 65 skipped. The same 27 baseline socket-related failure names remain; no new failure names. A preliminary invocation from repository root produced five additional fixture-path errors and is not used as the standard-suite result. No assertions were changed to hide that invocation mistake.

The separately reviewed UI dependency refresh preserves all 72 direct resolved versions and all declared requirements. Its existing exact-code-commit build/test evidence remains in UI_DEPENDENCY_REFRESH.md; it does not qualify a newly rebuilt integrated installer. The two Prisma advisories remain explicit pending orphan-dependency verification or a compatible upstream repair.


## Subsequent reviewed closure

The unused UI Prisma starter chain and 33 exclusive dependency records are
removed after independent consumer/graph review. Both remaining previously
reported advisory packages are absent from the retained graph; this is a cached
advisory comparison, not a new registry audit. Effective Next configuration
disables its implicit background registry assessment; explicit audits remain
separate. The revised offline UI build, pack and 1,254-file hash verification
passed with source-attributed receipts.

The separate no-hosted Guardian gate removes the old native WinHTTP redemption
and orphan JavaScript issuer adapter. Existing proven OWNER_BOUND readback is
preserved; new enrollment holds before ticket issuance, second probe, network
or owner CAS. The portable deny consumer compiled and ran locally; the full
Windows actuator/service and genuine local native bridge remain unqualified.
