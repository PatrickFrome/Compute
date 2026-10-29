# Native preparation: composition map and startup lifetime repair

## Current source-owned entry path

The default Browser entry already attempts the installed attached provider and,
when no descriptor exists, the own-PG fresh provider path. This is not the same
as creating a native coding execution profile. Guardian activation remains a
separate authenticated administration path.

`infra/client-state-runtime/runtime-host.mjs` starts the verified own-PG/API
runtime. It creates the private native DB capability only after a protected
`native-coding-operator-v1.json` exists. It then creates the OS scope reader,
optional commit service, seed binding, service heartbeat and native authority.
`apps/metaengine-browser/src/main.mjs` also requires that descriptor before
mounting the native runtime; it independently binds the current Host generation,
current device/client, protected permits and CLI/sandbox pins.

The descriptor reader validates paths and canary pins. It is not the producer of
those pins or a grant of native execution. The seed profile and seed selector
are separate: `prepareNativeCodingSeedProfile` records an immutable profile under
state_owner, and `publishNativeCodingSeedOperator` validates its physical scope
and publishes its exact selector without overwrite. Tracked source callers of
these preparation/publication functions are currently tests only. The same is
true of `runCodexCliSandboxProbe`: its production function is present, but the
tracked installed composition does not call it to prepare first-run canaries.

## Inputs still missing from default preparation

A default producer cannot fill the fields with generated fixture values. It must
assemble the existing authenticated device/client/key fingerprint/admin epoch,
existing Owner/workspace epoch, installed EXE/ASAR/runtime bundle and CLI digests,
actual PG17 cluster/postmaster incarnation, managed clean worktree identity/base,
independent IMPLEMENTER/CRITIC roster, protected storage witness and actual
sandbox-canary receipts. The current v1/v2 seed profile is explicitly scoped to
LOCAL_OPERATOR_QA and does not claim production qualification.

The existing OS scope reader can independently read many of these physical
values, but currently consumes the protected operator paths and a profile/permit
for comparison; it is not an autonomous trust genesis. Worktree/canary creation,
CLI provisioning/authentication, profile generation and protected descriptor
publication need an explicit source-owned lifecycle linked to existing Owner
custody. No new credential, trust root, public renderer-supplied profile, or
hosted service is introduced by this change. The default producer remains OPEN.

Also, offline runtime packaging selects an import closure. An unimported helper
does not enter the packaged executable graph merely because an allowlist names
its source path. The release owner must qualify actual closure once default
composition is implemented.

## Fixed: terminal receipt raced optional native startup

Three regressions against the actual runtime-host composition showed that a
runtime exit could close native SQL and release the Host lock while an operator
read, seed preparation or authority acquisition was still pending. A terminal
receipt could therefore precede cleanup of resources acquired late by startup.

The existing optional startup is now one recorded promise, installed before its
first await. Finalization fences startup through the existing terminal state,
joins that exact attempt and its local cleanup, then closes native SQL and
releases ownership. A failed acquisition cannot restart preparation. Ordinary
cancellation can still stop the owned runtime children before waiting for native
startup to drain. No positive terminal receipt is issued while acquisition is
unresolved. The joined startup never awaits finalization, avoiding a cycle.

Test-only module hooks substitute generated acquisition dependencies while
executing the actual runtime-host file. They are not production hooks and cannot
establish real Windows, PG, Guardian or installed execution proof. Initial three
child-exit tests failed before the repair; afterward seven cases pass: child exit
and cancellation at all three acquisition stages, plus normal native startup and
shutdown. Final expanded Host/Guardian/seed-binding coverage was 58 total: 57 pass,
zero failures and one Windows-only ACL skip. Parent CI must run the
final registered cases on Windows before claiming Windows qualification.
