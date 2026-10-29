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
