# Qualification follow-up, 29 October 2026

The immutable unsigned QA candidate is source `59eb7f33e5e87aabbb02b0c8fbf3eecd5aa9c49c`, version `0.7.0-dev.2257027431866.1`. Windows Package Smoke run `40783415257`, job `123150571155`, completed successfully, including isolated installed Owner/UI and journal restart qualification. Installer SHA-256: `70f2f9b3107e1e26878c598fb43cd447c3a61453559265d97605cef4756a4f47`.

The full source CI at that exact SHA failed seven transaction-scope cases because its test VM did not expose Node's `structuredClone`. Passing the real global to the fixture reproduced then resolved all seven failures. Corrected local runtime suite: 731 PASS, 13 SKIP, 0 FAIL (744 total); exact transaction suite: 10 PASS. The fixture is excluded from the packaged runtime. These are subsequent test corrections, not a relabeling of the original CI result or installed artifact.

The first local forward qualification stopped with `runtime_health_failed` after three `postgres_inspection_connection_timeout` observations; its surface failure was the later Windows listener query. Host/API/Edge reported stopped and PostgreSQL retained its original incarnation. Subsequent read-only identity probes succeeded. This does not establish that cold-start timing is fixed.

An explicit `resume-after-stopped-readback` operator path now permits one new qualification only after exact plan/Owner/configuration checks, no installer attempt, absent Host/API/Edge and ports, and unchanged PostgreSQL continuity. It preserves the prior status/stderr and reserves the attempt durably. It never converts the failed generation to READY, retries an installer, or replays an agent task. The new qualification must independently establish readiness and cleanup. Focused forward policy/schema/predecessor/readback tests: 101 PASS, 0 FAIL.

Both current-boot Codex CLI sandbox canaries passed (IMPLEMENTER workspace-write, CRITIC read-only); no model was called by those canaries. Installation, useful agent work, independent review, durable Git successor, message pickup, and restart continuation are separate acceptance stages. At this follow-up commit, local qualification is still running and installed autonomy is not proven.

## Installed observation at 2026-10-28 23:51:58 UTC

The explicit stopped-generation readback permitted a fresh local qualification, which passed and stopped cleanly. Its proof SHA-256 is `c7a87ae523225bb5ec0d2b711a75aa10147ddf828c74d8872db3dc9ea3b71ffd`. The NSIS installer was invoked once and returned exit code 0; final installed-image/registration/Owner checks returned `INSTALLED_VERIFIED`, version `.225`, source `59eb7f33e5e87aabbb02b0c8fbf3eecd5aa9c49c`, launch allowed. The original PostgreSQL and Guardian remained alive.

The installed Browser opened and its own runtime reported READY with no last health failure. A fresh six-hour LOCAL_OPERATOR_QA profile for IMPLEMENTER and independent read-only CRITIC was published. The UI selected native Host admission and enabled Run for the prepared JSONL ledger task. Read-only profile-scoped DB observation still showed zero seeds, tasks, executions, jobs, checkpoints and commits at the timestamp above: no agent execution or autonomy claim follows from installation.

Current external interaction blocker: the desktop automation could read accessibility and fill the task, but clicking returned `coordinate input geometry is unavailable`, screenshot capture timed out, and keyboard attempts did not produce a submission. One user Run click was requested. The legacy ChatGPT wake remains ambiguous and was not replayed or cleared; its global header currently obscures the separate available native admission path.

Performance finding for a later change: successful `finalizeForwardPayload` performs 17 complete application-tree hashing passes (5 candidate, 12 installed), in addition to two installer hashes and independent bundle checks. This explains substantial verification work; paging and antivirus effects were not measured. No verification boundary was bypassed during this installation.
