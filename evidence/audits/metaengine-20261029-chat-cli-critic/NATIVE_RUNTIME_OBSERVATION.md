# Native runtime observation, source stage

The existing authenticated primary-shell connection-status read now projects the owned
native runtime snapshot into credential-free aggregate record counts. Supervisor fields
cannot substitute for the Main-owned runtime. No new IPC, command, scheduler or timer
is introduced. Failure of the snapshot does not invalidate the independent chat status.

The TopBar distinguishes unknown, unbound, observed records and closed admission.
Readback-required records receive attention. Counts are neither an OS process census
nor proof of execution, shutdown, independent critic acceptance or continuous autonomy.
Missing, malformed, stale or disconnected observations cannot imply zero workers.
Logical agent capacity remains unbounded; the displayed budget describes physical slots.

Local validation: 12 native projection/trust-boundary tests; 117 UI library and harness
unit tests; two Windows workflow registration tests. Full UI ESLint and TypeScript checks
are also required. The real renderer acceptance harness now checks native bookkeeping
and removes its old counts on disconnect. Hosted UI and Windows qualification remain
required for the published source; local tests do not qualify an installed Windows client.

Previous published source 88ce711f12bc39c858c29d49b8b9410f31f56a9b completed UI
run 40923639699 and Windows Source run 40923639503 successfully. Those results do
not qualify changes introduced in this stage.

## Observation lifetime regression

A reproducible UI deadline bug launched three reads while the first physical IPC
read remained unresolved. The shared resource now retains that read until it
settles; a timeout clears UI state but is not cancellation of IPC. A late success
cannot publish READY. The existing polling loop resumes with a fresh read after
settlement. Visibility changes and unsubscribe/resubscribe cannot bypass this
slot. The hook joins both connection and work-readiness reads even if one fails.

Regression was red (3 calls versus 1), then green. Seven resource lifetime tests,
120 UI/harness tests and full ESLint/TypeScript pass. Real native runtime fixtures
also project retained readback-required records and zero records after confirmed
completion without claiming execution proof. Runtime + dependency checks: 40/40.
Windows registration: 3/3. These are source results, not installed qualification.

The initial broad Browser run had 6935 tests: 6809 passed, 44 failed, 82 skipped.
The local Browser node_modules directory was absent. Frozen dependencies were
restored with npm ci --ignore-scripts using the unchanged lock; five dependency
security tests subsequently pass. A complete rerun is required before classifying
remaining failures. No lock pins, test requirements or sandbox permissions were
relaxed. Electron binary/installer execution was not performed by that install.

## Cross-suite and real-renderer lifetime coverage

The broad Browser run with frozen dependencies completed: 6961 tests, 6850 pass,
29 fail, 82 skip. One failure was an old UI contract expecting an overlapping
replacement read before the timed-out read settled. Its test now explicitly
requires no overlap, discards the late result, then requires fresh recovery.
It is additionally registered in the UI CI command, avoiding a coverage split.
The combined Browser/UI resource tests pass 17/17; the full UI/harness set passes
130/130 with lint and types clean. The real-browser fixture additionally holds
one connection invoke while work-readiness fails, observes two polling intervals
without overlapping reads, then releases it and requires fresh recovery.

The other broad-suite failures concern local native socket listen restrictions
(including a daemon attach consequence and sanitized MCP listen failures) and
a real Electron test without an X display / with denied D-Bus socket access.
They are not passes and are not skipped or bypassed. Windows source qualification
for 6b40ac24 passed component 447/448 (one baseline skip) and native PG17 47/47.
Its UI artifact 12920433350 has SHA256
714829a695be287089315d3d22ab99428163c39210bd79b08e92424860286113,
seven actual renderer scenarios PASS, and explicitly simulated bridge identity.
The native status screenshot was visually inspected. Those results predate the
read-lifetime repair and do not qualify the newer source.
