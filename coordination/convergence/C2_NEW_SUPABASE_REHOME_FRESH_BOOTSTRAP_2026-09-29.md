# C2 NEW SUPABASE REHOME + FRESH BOOTSTRAP — 2026-09-29

## Authority / scope
- Frozen R109 source remains `ff95e9c886fac35b9302ec5c04a4c6bf7b8e8551`; it was not mutated.
- Successor implementation branch: `work/client-v1-c2-new-supabase-rehome-v1`.
- Current successor head at checkpoint: `39c4aa74832f8ce7f0b35c9f43ea2e30952c24e8`.
- Draft PR: #1074, based on `work/client-v1-db-outage-backoff-v1`.
- New Supabase recovery project: `jhriwwsryeqsvvvufkok` (ACTIVE_HEALTHY, Free tier).
- Old project `xpeibufgzjknrhbhpffp` remains recovery/archive; no deletion or authority promotion was performed.

## Fresh-project defect discovered
The R109 `supabase/migrations` ledger is not a self-contained zero-to-current bootstrap.
Several migrations assume historical `destruktion_meta` / DevOS / supervisor mesh objects that are absent in a blank project.
Blind replay was stopped rather than inventing historical state.

## Implemented repair
Commit `dddc8d92d6798fde988921ef566a135e552d62ff` adds
`20260929010000_client_v1_fresh_project_bootstrap_v1.sql`.
It recreates only the Client V1 durable Browser/DevOS substrate:
- DevOS task / claim / event / runtime-control state
- enqueue / reconcile / snapshot / lease / mark-running / complete lifecycle
- supervisor mesh registry and shared actuation lease
- least-authority RLS + service-role execution boundary

It intentionally does NOT recreate historical ME2 mirrors, old Compute Fabric roadmap/checkpoint planes, or a second scheduler.

Commit `2a9c7f56fb45fd8b72980a936b847a5f3229acd6` adds a static contract test fencing that scope.

## Exact R109 migrations applied successfully on the new project
The new DB now contains the required Browser control-plane lineage plus exact R109 deltas including:
- owner-gate mesh lease
- DevOS reconcile + priority aging
- precise rate-limit/backpressure v2
- supervisor mesh terminal freshness
- native supervisor mesh-sync Edge authority
- Browser pulse trigger reattach
- Agent-origin receipt v1 (`agent_surface_sha256`)
- DevOS runtime capability contract

Live transactional smoke succeeded:
`enqueue -> lease -> Agent-origin PROVEN_CONVERSATION -> RUNNING -> complete`.
The transaction was rolled back after assertions, leaving no test task.

## Edge migration
Exact R109 v14 canary was deployed to the new project first with old proven digest
`780b6537584d96edc754bf389956e9c405a6713a823b6f9ef7995e954c116911`.

A live deployment-path defect was then discovered:
the Edge source parsed requests using the hard-coded stable marker
`/a2-browser-native-supervisor-v1`, which is a prefix of the canary slug
`/a2-browser-native-supervisor-v14-canary`.
Hosted canary paths could therefore be misparsed before route dispatch.

Successor commit `13026826606b9514851121b8dd54b50a2bde8bad` makes hosted
`/functions/v1/<deployment-slug>/...` routing slug-agnostic while retaining the stable
v1 canonical signed-request identity.
Commit `39c4aa74832f8ce7f0b35c9f43ea2e30952c24e8` adds a contract test.

New canary deployment:
- function: `a2-browser-native-supervisor-v14-canary`
- version: 2
- status: ACTIVE
- bundle digest: `30e21275f1ca319c4b853d9ed0c70ad789938a6d925b26d59df17a4467f35006`
- ten project module imports remain pinned to frozen R109 source; npm postgres is the additional non-project import.

Supabase hosted Edge Functions provide `SUPABASE_DB_URL` by default, so no copied DB password / chat token is required for the canary.

## Advisor-driven hardening
Supabase security advisors exposed public EXECUTE on:
- `h205f22_a2_browser_self_update_observe_v1`
- `h205f22_a2_supervisor_mesh_heartbeat_v1`
and mutable search_path on `glm_browser_pulse_notify_v1`.

Commit `4035617a8086166fabc96ae7466907bcb78a7804` adds
`20260929013000_client_v1_fresh_project_security_hardening_v1.sql`.
Applied live successfully.

Post-hardening readback proves mesh heartbeat:
- anon EXECUTE = false
- authenticated EXECUTE = false
- service_role EXECUTE = true

All WARN-level Supabase security advisor findings are now cleared.
Remaining security findings are INFO-only RLS-enabled/no-policy notices, intentionally representing deny-by-default user access with service-role backend access.
The missing owner-gate FK index was added; remaining performance advisor notices are unused-index INFO on the newly created, not-yet-loaded project.

## Current gate
C2 source/DB rehome is materially advanced but not yet promotion-complete.
PR #1074 CI is running on exact successor head. No installed Browser has yet been repointed to the new project and no physical release qualification has been claimed.

Next:
1. wait for exact-head #1074 CI terminal evidence;
2. perform GitHub = DB = Edge reconciliation;
3. stage the stable Edge slug in the new isolated project;
4. move active Browser endpoint configuration in the successor branch from old project to new project;
5. run package + installed physical qualification;
6. only then promote/release and proceed to stable baseline / repository reset.
