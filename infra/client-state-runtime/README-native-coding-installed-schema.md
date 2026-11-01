# Private installed publication-schema prerequisite

`createNativeInstalledPublicationSchemaVerifier` is mounted only as an asynchronous
**read-only Host diagnosis**, after minimal signed setup/capacity is available. It
is **not mounted in Main or any effect/admission path**. It proves a bounded
installed SQL predicate, not Owner,
process custody, loaded executable code, effect authority or release readiness.
No migration SQL/preflight DO runs here, and no grants/credentials are provisioned.

The verifier reads the reviewed function metadata/body hashes from the shipped
callback and initial-anchor/task-fence SQL and checks them against the shipped
function definitions. Startup and each original-operation recheck inspect the
installed functions, ACLs, tables, callback column/check, exact publication/fence
triggers, unique task index/constraint and retained duplicate task history. The
existing authenticated direct API login must still be the exact original role,
connection and database incarnation. OWNER_ONLY onboarding is not a fallback.

## Exact private lifetime

- Reuse the existing Host-owned owner pool and monitor through
  `bindNativeCodingPublicationTransactionPool`; no extra pool/scheduler/service.
- The fixed shared **session** migration lock is acquired on that exact reserved
  connection **before BEGIN**. A first-SELECT transaction advisory lock would be
  too late: its snapshot can predate lock acquisition. Busy fails before BEGIN.
- Startup uses only the fixed repeatable-read/read-only mode. `recheck(tx)` uses
  the exact original live serializable transaction; it never starts another one.
  The first recheck must precede its other SQL. Repeated checks reuse that scope.
- Canonical migration exclusivity lasts through actual COMMIT/ROLLBACK. Verified
  unlock must precede release. Unknown lock/settlement/unlock quarantines the
  reservation under the existing pool/Host teardown and physical-HOLD semantics.
- Required `assertCurrent()` is a synchronous private Host lifetime/pathname-lock
  assertion, returning no value. `signal` closes on Host cancellation. Neither is
  a public JSON readiness option. Source bytes and actual SQL PG identity are
  rechecked, not accepted from a marker. A catalog/identity failure closes this
  verifier; there is no retry or reopening.
- `close()` fences immediately. `drain()` joins retained verifier reads only;
  the caller still must join its original transactions, pool and native shutdown.
  It does not attest physical settlement or stop an installed service.

## Host diagnostic ownership (no execution admission)

The actual runtime-host keeps its existing raw owner pool and regular service
facade, plus a diagnosis-only fenced facade over the same pool/monitor. One
restricted API connection uses the existing protected configuration; the Host
owns its opening, reads and end. Unsupported profiles and missing/changed SQL do
not remove minimum ADMIN/setup/capacity services. Status contains only fixed
schema-only categories and always `execution_admitted:false`.

Fresh bundle/source and SQL/PGDATA continuity observations bracket the diagnosis.
Its synchronous lifetime guard rechecks the existing Host lock against its
original wx-handle bigint identity, runtime generation and cancellation.
PG birth is compared in SQL against the original timestamp passed through the
text serializer, preserving microseconds (not the legacy proof's millisecond wire).
An unexpected API connection loss invalidates the diagnosis; there is no reconnect/retry or readiness promotion.
These are on-disk/source observations, not loaded-code proof.

Stop closes/aborts the verifier before awaiting anything. The original runtime
can stop owned PG before a blocked diagnostic read joins. API ending starts
without waiting on its own read; read/drain and API end are all joined before
owner-pool disposal/ownership release. A fixed 6.5s cleanup bound returns HOLD,
retains the exact pending work, owner pool and lock, and cannot become late
success. Attached PG is never stopped or borrowed as owned-children proof. Only
actual existing owned-children shutdown can resolve disconnected own-PG reads,
after joins; drain/API-end/ownership errors remain HOLD. Raw API read failures
retain their own physical uncertainty before downstream sanitization or delayed
onclose. They never stand in for death of an unrelated reserved owner connection:
that live owner transaction must still confirm ROLLBACK, unlock and release.

## Remaining production effect mount requirements

Keep the existing Host runtime pathname/control lifetime and signed-source pins,
use its real protected owner/API connections, and pass actual cancellation. All
canonical migrations must respect the same existing advisory/pathname locks.
This prerequisite does **not** protect against privileged out-of-band DDL that
ignores those locks, nor attest the rest of the runtime schema dependency graph.
Startup success is not a cached permission: every original execution transaction
must enter this guard, then the existing Owner/control/native/publication checks.

The direct Main Owner callback, original prepared custody consumption and exact
Host composition are still unmounted. Fresh W74/W68/PG/native observations and
genuine loaded-release/code-custody proof, followed by joined Windows validation,
remain necessary before changing the closed default publication gate or installer
activation. Disposable PG tests use registered real SQL but generated identities;
unit/source success cannot substitute for that release evidence.
