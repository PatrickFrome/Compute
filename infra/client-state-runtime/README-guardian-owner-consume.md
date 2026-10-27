# Private owned-runtime Guardian ticket consume (source slice only)

This slice consumes an existing own-local ticket. It does **not** enroll a
Guardian owner, create access, grant ADMIN, change the native hosted redeem
endpoint, or authorize execution. Native Guardian enrollment remains **HOLD**:
there is not yet an independently authenticated installed-package/runtime bridge
for the native actuator to trust. A device signature and same Windows SID are
not substitutes for that code-authentication boundary. W74/W76/QA descriptors
are not used as first-enrollment authority.

## Private composition

The verified runtime Host alone lazily acquires this backend on its existing
parent ChildProcess IPC channel. Ordinary startup creates no extra connection.
There is no renderer IPC handler, HTTP endpoint, caller-selected SQL/URL/DSN,
credentials, signer/verifier hook, or automatic caller from main/Guardian.
`createOwnedGuardianTicketConsumer` has only trusted Host runtime/config/signal
inputs; it obtains the actual config location and generation from its real
launch environment, revalidates config bytes, Windows DACLs and actual object owner SID against
the existing current-user/SYSTEM/Administrators allowlist,
and opens its own reserved connection. It is not a sandbox for arbitrary code
already executing inside the trusted Host.

Only explicitly `owned`, cluster-pinned PG17 profiles with `state_owner` current
and session identity and the original admitted `postgres` database qualify.
Attached/legacy/unprotected profiles remain unavailable; no migration, ACL
repair, key generation or credential creation is attempted. Current config,
PGDATA, canonical paths, host/parent OS process incarnations and owner SID,
cluster ID, postmaster PID/start, PID-file bytes, port and reserved backend are
checked before/after consumption. The parent OS SID is **not** evidence that a
native Guardian authenticated this request.

The strict private schema binds host/parent PID, instance, launch generation,
request ID, challenge digest, ticket digest, SID digest, fingerprint and ADMIN
epoch under the existing enrolled device ES256 HTTP-signature profile at fixed
`/private/guardian/owner-ticket/consume`. Challenge digest is only correlation;
there is no claim of an authenticated native challenge producer yet. The exact
unexpired ticket and current device/client/key/ADMIN/CONTROL_PLANE/pairing are
locked and rechecked before invoking the existing consume SQL function. Grant
readback is also checked after commit. No public RPC/table allowlist changes.

Success is `DB_TICKET_CONSUMED`, with `guardian_ready:false` and
`native_bridge_authenticated:false`. It is not native acceptance. Unknown
commit/post-commit outcomes or repeated correlation IDs return `UNKNOWN` and
never retry/reissue. Plaintext ticket, SID, credentials and SQL are not returned
or logged. Close/Owner-stop fences admission synchronously and drains the
reserved connection. SQL session limits and 30-second acquisition/operation
deadlines fence stalled requests; pool termination is armed independently of
the active query. A bounded drain failure still stops owned runtime children,
retains the ownership lock and never emits a clean terminal. Failed acquisition
cannot reopen within that generation.

## Evidence limits

`guardian-owner-consume.integration.test.mjs` uses a newly created disposable
native PG17 cluster, actual first-owner enrollment and Edge signature/ticket
issuance, real separate restricted API login, existing SQL consume, live
reserved-backend/cluster checks and an independent-backend row-lock race. It
covers current-grant revocation/epoch/scopes, wrong key/client/SID, stale/reused
signature, expiry, replay/generation mismatch, stop, lost commit response and
post-commit grant/custody changes. **OS SID/DACL inputs to the transaction fixture
are synthetic**, not Windows, DPAPI, signed installed-package or native service
qualification. The production Windows acquisition has no injection hooks.

Run with `METAENGINE_PG_TEST_BIN` pointing to a disposable PG17 toolset and
`METAENGINE_PG_TEST_DRIVER` to the established local postgres.js dependency:

```
node --test infra/client-state-runtime/guardian-owner-consume.test.mjs \
  infra/client-state-runtime/guardian-owner-consume.integration.test.mjs \
  infra/client-state-runtime/guardian-owner-host-lifecycle.test.mjs \
  infra/client-state-runtime/runtime-host.test.mjs
```

The dedicated lifecycle test substitutes only acquisition and runtime children
in a test-process loader, proving pending acquisition/drain cannot prevent child
cleanup or emit clean terminal proof. That loader never ships. The explicit test
command above is the source-slice gate; package npm scripts are parent-owned and
must include these gates during integration.

Native tests skip when that toolset is absent; a skip is not native evidence.
Packaging source inventory and future authenticated bridge review are separate
release gates. Do not treat this source slice as installed Guardian readiness.

## No hosted enrollment while native bridge is unavailable

The separate Browser/native deny-only gate preserves a proven existing
`OWNER_BOUND` read-only challenge. New enrollment returns
`GUARDIAN_LOCAL_OWNER_BRIDGE_REQUIRED` before requesting a local ticket or
sending a second native probe. The native ticket consumer itself has no
network dispatch or accepting path, so even a direct ticket-bearing request
cannot contact the previous hosted authority or reach owner-store CAS. It does
not substitute localhost or trust this DB-only backend. The now-unreferenced Browser JS issuer adapter and its isolated test were
removed; the real local Edge issue/consume API and SQL contracts remain. The
actuator rejects stale ticket-provider/fetch options, and its existing emergency
controller caller no longer passes them. Existing issuer and current ADMIN/device
validations are not relaxed.

The actual portable C++ deny-only consumer is compiled and exercised on Linux
without network libraries. This is not Windows actuator/service compilation,
signed installation, existing-owner native readback or end-to-end enrollment
qualification; those remain distinct CI/installed gates.
