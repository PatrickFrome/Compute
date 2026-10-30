# Native mount prerequisite diagnostics

The actual main mount previously returned null for absent owned Host or protected
operator configuration, and UI showed only "Native: not mounted". The existing
connection route now carries an optional credential-free last mount attempt.
The fixed reasons distinguish absent Host, missing protected configuration,
unavailable protected permits and unverified setup readback. Raw errors, paths,
Host identities, permit contents and credentials are never projected.

The diagnostic is bound privately to the same owned Host observation and drain
barrier. A new mount clears it; a new Host, active attempt, shutdown, generation
loss or changed drain barrier removes it from the public projection. Successful
mount clears the previous failure. Getter failure cannot take chat connection
status offline. Supervisor-supplied data cannot override this main-owned option.

The existing Native badge explicitly says "last setup blocked" and includes the
attempt timestamp and historical qualification. It never presents old failure as
current physical truth, zero workers, admission permission or proof of execution.
Unknown/malformed reasons and future timestamps are rejected. This diagnostic
does not provision a profile, install Codex, enroll credentials, add an IPC route,
change access, retry setup or enable a new scheduler.

Validation: 90 focused main mount/connection/trust-boundary/startup/badge tests
pass; all 113 UI library tests pass; TypeScript noEmit and targeted ESLint pass;
syntax and diff checks pass. Tests exercise extracted actual main functions and
actual UI badge code with generated private dependencies. They are source proof,
not installed first-run or Windows native execution acceptance. Automatic native
profile preparation remains open.
