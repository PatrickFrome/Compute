# P1 Operator read-only Gateway — W3 contract

Source: `operator-readonly-gateway.mjs` (no auto-start). Independently deployable only by a trusted local Owner. The module has **no SQL, queue, planner, mutation routes, hosted provider fallback, or external default port**. Explicit Owner `ownerId` + existing local API `apiKey` + strict `http://127.0.0.1:<port>` upstream are required. Listener always binds `127.0.0.1`; default ephemeral port `0`.

Four authenticated GETs:
- `/operator/v1/context` (no query): read P0 context from Owner API, redacted planes, canonical run identity from optional trusted own-Postgres callback.
- `/operator/v1/inspect?run_id=...&task_id=...`: allowlisted readback of task state and event sequence.
- `/operator/v1/run_status?run_id=...`: same canonical project/run and persisted event sequence.
- `/operator/v1/events?run_id=...&after=0&limit=32`: monotonic **decimal event sequence**, max 64, bounded payload and proof hashes. `next_cursor` never regresses. The read adapter must supply run-scoped watermark and ordered, provable events.

All endpoints require exact Host, no Origin, `apikey` (optional matching Bearer) via the **existing** local `authenticated()` policy. Every response has `authority_effect=false`, `scope=READ_ONLY`, no-store and typed source/proof. A different `run_id` is a 409 identity collision; missing or stale Owner/readbacks are UNKNOWN/503, not synthetic success. Gateway never calls RPC mutation APIs.

**Integration status:** Context is wired through the existing authenticated Owner API. The optional in-process `readRunIdentity`, `readInspect`, `readRunStatus`, `readEvents` hooks intentionally have **no implementation/default**: the separate W2 owner-ledger adapters must be independently qualified and plugged in by trusted Owner startup. Until then run status, inspect and events are fail-closed UNKNOWN. This is source-only; no installed Browser, Guardian or PostgreSQL was changed. Full W2+Gateway integration and physical negative qualification remain mandatory release gates.

Focused test: `node --test infra/client-state-runtime/operator-readonly-gateway.test.mjs`.


## W28 security hardening (source-only, DRAFT)

All four authenticated GET routes retain literal origin-form URL allowlisting: normalized
or absolute-form HTTP targets cannot alias an accepted path. After each asynchronous
Owner/context/ledger readback, the Gateway re-reads the fixed-loopback Owner health
and the trusted in-process run identity. A changed owner instance, Owner epoch,
run/project identity or event watermark becomes explicit UNKNOWN/503 instead of
a mixed-generation success. This is a best-effort two-read TOCTOU fence, **not** an
atomic native/SQL transaction or a cryptographic source attestation.

The same listener tracks the greatest accepted `event_seq` for up to 128 distinct
runs per Owner epoch, rejecting regression across context, inspect, run_status and
events GETs, including concurrent completion inversion. A strictly greater trusted
Owner epoch resets the namespace; an old Owner epoch cannot replay. Exceeding the
bounded run-history budget fails closed rather than evicting replay protection.
Unconnected adapter remains UNKNOWN. These guards do not create a polling
scheduler, authority, credential/SQL endpoint or hosted fallback.

Focused test: `node --test --test-concurrency=1 operator-readonly-gateway.test.mjs operator-gateway-security-fence.test.mjs operator-gateway-security-w28.test.mjs`
(via an isolated source checkout). New exact-head Ubuntu/Windows CI workflow:
`.github/workflows/operator-gateway-w28-security.yml`. Physical Owner/PG17
transactional readback, native bridge and Windows installed-package validation
remain **UNKNOWN** until independent qualification.
