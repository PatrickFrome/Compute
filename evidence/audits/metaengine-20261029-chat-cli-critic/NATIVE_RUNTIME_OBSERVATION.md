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
