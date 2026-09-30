# Client ADMIN.1 Connectivity Checkpoint — 2026-09-30

Status: FINAL_PHYSICAL_INSTALLED_QUALIFICATION_PENDING

PR: #1085
Branch: `work/client-v1-admin-connectivity-v1`
Parent UI candidate: `b1dc649b694bc60478b7b7021e68f1fa6e1d6271`

## Problem proven

The old top-bar `Data offline` indicator was driven by the legacy ME2 Socket.IO data feed on port 3040 and was not the Native Supervisor connection authority.

Separately, the Native Supervisor Edge used direct Postgres query sessions for ordinary enrollment/auth/heartbeat/RPC traffic. Live diagnostics had already observed PostgreSQL `53300` connection exhaustion.

## Implemented connection contract

The installed Browser now keeps four concerns distinct:

1. local Browser runtime readiness;
2. durable device identity readiness;
3. device-bound ADMIN grant readiness;
4. cloud control-plane connectivity/reconnect state.

The Client exposes typed `metaengine.client.connection-status.v1` and the primary UI shows:

- `Admin connected`
- `Admin reconnecting`
- `Enrollment`
- `Starting`

The legacy daemon feed remains diagnostic-only and is explicitly not connection authority.

## Device ADMIN authority

Existing Native Browser P-256 device identity remains the trust root.

Private key handling:

- generated locally;
- encrypted by Electron `safeStorage` / Windows DPAPI;
- decrypted only in Browser main;
- excluded from snapshots/renderer;
- infrastructure master secrets are not embedded in the EXE.

The device table now records a revocable ADMIN grant:

- `access_tier=ADMIN`
- bounded `admin_scopes`
- `admin_grant_epoch`
- independent `admin_revoked_at`

Every signed privileged Native Supervisor request requires the live ADMIN grant.

## Control-plane transport

Normal Edge database traffic was moved to Supabase PostgREST/Data API:

- enrollment request/status;
- device lookup;
- nonce RPC;
- heartbeat/state merge;
- command/result readback;
- DevOS/meta RPC calls.

Normal path reports:

`backend_transport=POSTGREST_RPC`

and:

`direct_postgres_query_plane=false`

Raw Postgres remains only for explicit DB-inspect diagnostics and the dedicated LISTEN/NOTIFY wake accelerator.

## Live canary evidence

The isolated `a2-browser-native-supervisor-v14-canary` has physically proven:

`signed enrollment -> ADMIN readback -> POSTGREST_RPC -> Client goal admission`

Signed canary run:

`36739933782`

Observed ADMIN scopes:

- CONTROL_PLANE
- DEVOS
- FLEET
- SUPERVISOR
- DIAGNOSTICS
- RECOVERY
- UPDATE
- ROADMAP

The run returned:

- `admin_status_validated=true`
- `access_tier=ADMIN`
- `backend_transport=POSTGREST_RPC`
- `direct_postgres_query_plane=false`

## Installed Electron gap found

Physical installed Windows qualification reached:

- packaged UI verified;
- packaged daemon verified;
- ME2 primary shell visible;
- Native Supervisor subsystem ready;
- clean-genesis control ready.

But the fresh GitHub-hosted machine remained:

`host_identity_state=WAITING_FOR_ENROLLMENT`

Therefore `ADMIN_CONNECTED` was correctly not claimed.

## OIDC qualification bootstrap

A dedicated backend-only qualification function is deployed:

`metaengine-client-installed-qualification-h205f22`

It verifies GitHub Actions OIDC plus live Actions run metadata and can approve only one fresh request matching:

`INSTALLED_ELECTRON + run_id + run_attempt + source_head + qualification_nonce_sha256`

The one-run correlation hash prevents another enrollment from racing the public run/SHA tuple.

The previous weaker three-argument qualification RPC is removed after the nonce upgrade.

GitHub OIDC minting credentials are cleared before Electron starts. The installed Browser receives neither the OIDC JWT nor any service-role/Cloudflare/master secret.

## Live DB state

Applied migrations:

- `client_v1_admin_connectivity_v1`
- `client_v1_installed_qualification_oidc_v1`
- `client_v1_installed_qualification_nonce_v1`

OIDC qualification Edge:

- slug: `metaengine-client-installed-qualification-h205f22`
- version: 2
- EZBR SHA-256: `4e7474f3c5519f83cb96abf79be0b157c0a4411cb16fdac779bd86333fc7f62d`

Rollback smoke proved:

- exact nonce-bound qualification request becomes APPROVED;
- pairing grant is created;
- the weak three-argument RPC is absent;
- only the nonce-bound four-argument RPC remains.

Security/performance advisors introduced no new ADMIN.1-specific critical finding.

## Current qualification state

Focused Client V1 ADMIN/OIDC contract suite is green.

The only remaining ADMIN.1 proof is one final exact-head Windows installed qualification where the installed EXE must itself emit:

- OIDC-correlated enrollment approved;
- `ADMIN_CONNECTED`;
- `access_tier=ADMIN`;
- `backend_transport=POSTGREST_RPC`;
- `direct_postgres_query_plane=false`;
- automatic reconnect enabled;
- no master/OIDC token exposure to Browser.

Do not promote the production Edge from this checkpoint alone. Final promotion remains evidence-gated.


## ADMIN.1 nonce transport repair

Readback of run `36753232589`, attempt 1, source `c8a0779cf6215bd5d911b8371d3578e62a25593f` found its exact enrollment PENDING with `nonce_present=false`. Installed logs ended with `installed_oidc_enrollment_qualification_not_proven`. This is independent of the earlier immutable OIDC subject correction.

The Native Browser already emitted the nonce, but the Edge enrollment metadata whitelist dropped it. The same omission existed in the candidate source, so redeploying it unchanged would not repair the gate.

The Edge now uses a small bounded metadata normalizer. It persists the nonce only under a valid installed-Electron run/attempt/head tuple, never spreads arbitrary metadata, and leaves nonce-bound OIDC/SQL approval mandatory. Behavioral tests exercise Native Browser metadata through this exact Edge normalizer and reject malformed/unqualified nonces.

Live rollback smoke on the selected Meta integration/project `jhriwwsryeqsvvvufkok` proved: exact four-argument tuple accepted; wrong attempt rejected; weak three-argument RPC absent; `service_role` EXECUTE allowed; `anon`/`authenticated` denied; all temporary records rolled back. No production device or pairing grant was committed.

Package identity advances to `0.7.0-dev.36753232676.1`; ADMIN.1 must not reuse the UI.1 version for different runtime bytes. Canary deployment and final installed proof must bind the next exact head. Stable production Edge remains the rollback authority until qualification is complete.
