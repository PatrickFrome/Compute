# Checkpoint — Workspace authority recovery and truthful work readiness

Base: `work/client-v1-admin-connectivity-v1 @ 93c64424525e00444a97abc151ef05bd386da3d7` (#1085).
Slice: `work/client-v1-work-readiness-recovery-v1`.
Existing roadmap scope: distributed reconciliation and typed native UI observation; no new scheduler.

## Proven changes

- Fresh Meta had no workspace control row, getter manufactured floor zero, resume RPC was absent, and DB lease omitted admission fencing.
- Atomic server qualification passed 22/22 with all fixtures rolled back. Four deployed function bodies matched checked-in SQL SHA-256.
- Real approved profile bootstrapped CLOSED at its exact durable floor 28. Installed signed heartbeat accepted authoritative CLOSED. Old eight FENCED tasks and zero claims remained unchanged; no external effect was retried.
- Main runtime projection now supplies actual lifecycle/DevOS/accepted-heartbeat to SYSTEM_TELEMETRY.
- Primary UI has a read-only readiness capability, current target/Agent digest checks, one shared observation resource, a bounded IPC deadline and no cached green after failure/backgrounding.
- Runtime Settings removes two unavailable legacy panels and their pollers; shows existing Native facts. Main native geometry remains unchanged.

Audit: `research/METAENGINE_CLIENT_CRITICAL_AUDIT_2026-10-01.md`.
Evidence: `coordination/client-v1/evidence/WORKSPACE_AUTHORITY_RECOVERY_2026-10-01.json`.
Complete branch census: `coordination/client-v1/evidence/WORK_READINESS_BRANCH_AUDIT_2026-10-01.json` (752 branches).
Server source and atomic qualification: `coordination/client-v1/sql/WORKSPACE_AUTHORITY_RECOVERY*_V1.sql`.

## Verification / limits

113 focused cases PASS, including shared-resource concurrency/timeout/late response, exact bindings, negative origin proof, missing authority and durable floor restart. Node source parse and whitespace checks PASS.

Local full suite has ten Unix socket failures due sandbox EPERM; Windows exact-head full regression and compiled/package/install gates are required. They must not be inferred from local partial success.

First published candidate `763732b4a951e081d5205a948560a688042602a1` compiled the production Next UI successfully. Shell, Critical Audit, dirty-profile, typed-workspace, desktop, orchestrator and goal-contract workflows passed. Package producer `36796496836` failed at physical visual qualification: its harness had no typed connection/readiness fixtures and still awaited the removed legacy daemon banner. Installer creation was skipped; four consumer workflows therefore had no qualified producer. This was not a qualified package or four independent runtime failures.

The follow-up preserves every existing geometry, selection, goal, focus, IME and palette gate. It adds real Electron captures of connected/BLOCKED, READY and connected/PAUSED fixture states, then deliberately rejects the observation IPC and verifies that both the badge and Runtime Settings remove previous positive readback. Eleven captures are required; evidence explicitly identifies controlled Native IPC fixtures, not live z.ai execution. Source parse, whitespace and 73 directly related regressions passed before publication. The new exact-head package/consumer matrix remains mandatory.

Follow-up `458421dea254502bb6ff3b3ccbbe183597d42967` passed all eleven physical visual captures, Windows full Node regression 3776/3776 (zero skips) and focused Windows authority checks 90/90. Before exposing its installer, source review found that it still inherited the installed 93c package version. The next candidate uses monotonic `0.7.0-dev.36797279067.1`, above the user's `0.7.0-dev.36760350225.1`. The version counter is distinct from the eventual producer run/attempt identity; provenance continues to bind actual producer metadata and bytes. Requalification on the versioned exact head is required; previous installer bytes are not promoted as an update.

Stable/canary Edge and installed 93c binary are not changed by this slice. SQL recovery is live; new renderer/native code is not yet installed on the user's machine. Current Supervisor remains ROLLOVER_AMBIGUOUS at cycle 2109 and Agent execution remains unproven. Closed initialization is deliberately distinct from resume.

Next proof: terminal/ambiguity reconciliation of the old Supervisor binding → one genuine z.ai Agent-origin session → useful task/verified result, followed by restart/update continuation. No freeze reset, forced Agent activation, ordinary Chat fallback or blind resend.
