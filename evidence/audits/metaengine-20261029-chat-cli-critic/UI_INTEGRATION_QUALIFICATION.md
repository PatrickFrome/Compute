# UI integration qualification

The existing full UI lint/type/test/build/package workflow ran only for pull
requests. Direct updates of the integration branch therefore did not execute
that gate. Added a narrowly scoped push trigger for the existing integration
branch and UI/workflow paths. Both checkout and ME2_BUILD_SHA now use the actual
push or PR source SHA, with the existing identity assertion and frozen Bun lock.
No lint, test, build, package or provenance assertion is removed. A registration
regression checks these requirements in the existing UI test command.

Also removed a presentation-only depth ceiling of one million. Task depth stays
a nonnegative safe integer; the flat task view does not allocate by depth. A
valid PostgreSQL integer depth no longer breaks the entire UI page. Negative,
fractional, nonfinite and unsafe integer values are still rejected. This does
not change execution policy, physical concurrency or database authority.

Fresh local evidence:102 UI library tests, full UI ESLint and strict TypeScript
pass;13 focused task/CI-registration cases pass. Clean frozen dependency build
and CI qualification remain pending for this new candidate. No visual installed
client or Windows installer readiness is claimed.

## Clean build and physical source acceptance

Bun1.3.3 installed602 packages from the frozen lock into a clean dependency tree.
Next production compilation, strict types, static generation and standalone
packing succeeded (54.2MiB).103 UI/registration tests and full lint pass with the
clean dependencies. Tracked sources remained unchanged.

The existing acceptance harness started the real standalone server, passed its
HTTP matrix, verified unchanged runtime inventories and confirmed owned graceful
shutdown. Local Chromium could not start because this execution environment
forbids the process-singleton Unix socket. Renderer acceptance is therefore NOT
claimed; the restriction is not bypassed or relaxed.

The authorized GitHub UI workflow now invokes the existing real-server/browser
acceptance harness using pinned Playwright1.62.1 and its disposable Chromium.
It retains source-only screenshots/report/inventories and requires unchanged
tracked sources. Node24.21.0 is pinned to the packaged runtime generation.
The fixture bridge is explicitly inert; none of these artifacts is an installed
Owner, live PostgreSQL, real agent execution or installer acceptance receipt.

## Real renderer qualification and evidence stability

GitHub UI run40918858111 on f8a6730405ca3476d1d0f200c71ebb932c095581 passed
clean build/package and five actual browser scenarios with the inert bridge.
Artifact12917786548 SHA2563521ecde5bc0f2d62a7c2e0bd63d6ff47d2c96578d88e827c5fd1a866131c054
contains the report, inventories and three screenshots. Owned graceful shutdown
and unchanged post-exit inventories were verified; installed_owner remains false.

Visual inspection found one capture during the dialog's finite entrance fade/
zoom, while the later dialog capture is fully opaque. This is not established as
a product stacking defect. Capture now finishes finite animations only for the
snapshot and checks final dialog opacity. Production animation behavior is not
changed. Added actual Escape/Enter/Close focus restoration and no-submit checks
for the next renderer run. Unit coverage also refuses screenshot path escape.
