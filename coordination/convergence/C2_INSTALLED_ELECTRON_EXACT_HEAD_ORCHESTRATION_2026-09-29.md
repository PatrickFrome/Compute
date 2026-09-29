# C2 INSTALLED ELECTRON EXACT-HEAD ORCHESTRATION — 2026-09-29

## Product head
Frozen for physical qualification:
`00d7c814213a97ac17504d5c598818bd99c588cb`

Branch:
`work/client-v1-c2-new-supabase-rehome-v1`

## Defects closed in this cycle
1. R83 source-binding regression oracle still required literal `postgres_notify_wake:true`.
   It now validates session-aware behavior:
   - `postgres_notify_wake:Boolean(DB_SESSION_URL)`;
   - wait transport is one of Realtime, Postgres LISTEN, or bounded DB polling.
2. R83 canary was stale relative to installed-Electron correlation source.
   Canary was redeployed as v12 and rebound to exact source.
3. Installed-Electron qualification could be skipped by a later manifest/test/empty commit.
   The workflow now runs on every push to the Client V1 convergence branch.
4. The installed qualification now runs the enrollment-correlation regression test before consuming an installer.

## Research conclusion
Current Supabase guidance recommends transaction pooling for serverless/Edge query traffic and explicitly notes that transaction mode does not preserve session-level state such as LISTEN/NOTIFY. Direct or session mode is required for those features.

Therefore the correct architecture is:
- durable lease/query traffic remains authoritative and serverless-safe;
- session LISTEN/NOTIFY is an accelerator only;
- when the dedicated session URL is unavailable, bounded DB polling is the explicit fallback;
- absence of the accelerator must not fail physical release qualification if durable lease and terminal receipt readback are proven.

## Current exact-head gates
Already SUCCESS:
- R83 Edge Canary Qualification
- Live Control Recovery
- Meta Orchestrator
- Cognitive Ingest
- Control Plane Fast Lane
- Developer Emergency Update
- Supabase Edge Live Probe

Running:
- Windows Package Smoke
- Installed Electron Live Qualification
- Critical Audit
- Self Update E2E
- Final Runtime Activation
- Installed Chat Qualification
- Windows Autonomous Soak
- Browser Shell

## Promotion boundary
R83 `live_qualification.completed` remains false.
Do not promote until the exact installed Electron created from the exact Package Smoke artifact proves:
- correlated enrollment;
- explicit approval;
- signed state/status;
- one durable READ_ONLY command round trip;
- terminal receipt readback;
- exact installer provenance;
- no checkout drift.
