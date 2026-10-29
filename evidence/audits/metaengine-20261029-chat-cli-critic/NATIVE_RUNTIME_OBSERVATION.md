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
