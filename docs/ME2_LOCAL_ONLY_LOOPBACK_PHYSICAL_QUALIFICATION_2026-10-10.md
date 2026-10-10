# METAENGINE local-only ME2 loopback qualification — 2026-10-10

Status: **SOURCE PATCH TESTED, NEW PACKAGED RUNTIME NOT YET PHYSICALLY QUALIFIED**.

## Exact physical finding

On the owner's authorized Windows computer, physical Browser test candidate
`0.7.0-dev.37781000047.1` installed from exact CI workflow run
`38050675960` (source `7eb24910823cb15a200959f1c82906941ca05440`).
NSIS returned 0. The installed file version changed from `.41.1` to
`.47.1`; the separately Windows-kept PostgreSQL 17.6 postmaster retained PID
`12976` and its original start-time incarnation.

Normal Browser boot had a visible read-only
`METAENGINE - Local runtime unavailable` window (owner file not yet registered).
ME2 daemon and UI became HEALTHY. Read-only HTTP GETs responded 200.

Independent OS socket readback of the live installed processes:

| Component | Address |
| --- | --- |
| PostgreSQL | 127.0.0.1:55432 |
| ME2 daemon | 127.0.0.1:3041 |
| ME2 UI gateway | 127.0.0.1:8137 |
| **Next standalone UI (defect)** | **0.0.0.0:3000** |

Root cause verified against packaged `resources/me2-ui/server.js`:
`const hostname = process.env.HOSTNAME || '0.0.0.0'`.
Browser-owned UI process configuration did not override `HOSTNAME`.
This exposed a potentially reachable LAN listener although the gateway was
loopback-only. A successful HTTP health probe alone cannot qualify address
ownership or locality.

The newly started physical Browser was closed through its existing primary
window. Readback confirmed that ports 3000, 3041 and 8137 were released,
while the independent PostgreSQL on 55432 remained listening at PID 12976.
**Do not leave `.47.1` running until a fixed successor is installed.**

## Implemented code changes

- `me2-ui-host.mjs` forces `HOSTNAME=127.0.0.1` after any inherited or
  launch-supplied environment; validates the child port and pins it for both
  installed standalone and script launch modes.
- `main-entry.mjs` marks the intentionally unprovisioned, inert local
  status boundary as a non-authority state before deferring startup.
- `final-runtime-entry.mjs` does not attempt a nonexistent full-Browser
  `activate` handler in that status-only mode. It reports delegation
  without claiming Browser readiness, provider authority, or an activated
  primary window.
- Node regression exercises hostile inherited `HOSTNAME=0.0.0.0`, launch
  patch `HOSTNAME=::`, port safety, no-owner recovery fencing, and existing
  singleton/shutdown invariants.

## Independent physical proof of proposed binding

Executed the **same installed** Next standalone `server.js` using the
locally installed embedded Node runtime with
`HOSTNAME=127.0.0.1`, `PORT=33347`. OS readback reported **only**
`127.0.0.1:33347`; HTTP GET returned 200. The test subprocess was
terminated, and the original local PostgreSQL was untouched.

## Remaining blocking gates

1. Immutable successor package must build from exact corrected source, pass
   Windows installer provenance, source regression and physical socket readback
   with the normal packaged Browser; never reuse `.47.1` package identity.
2. Existing PostgreSQL still exposes 40/50 required RPCs. The two required
   migrations passed a transaction-with-ROLLBACK dry run and a hash-verified
   backup exists, but a remote tool safety gate **blocked applying them**.
   Do not claim the schema is migrated or bypass the denial.
3. Owner config absent. No successful restricted API admission, registered
   owner, full Native Supervisor, signed task execution, persistent projects,
   ME2 full UI, or end-to-end self-update has yet been demonstrated on the
   physical owner PC. Preserve fail-close and the external PostgreSQL Keeper.

The static and isolated tests are not substitutes for step 1. The correct
state remains **CANDIDATE**, not production-ready.
