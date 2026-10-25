# Native coding progress — updated 25 October 2026

The priority is installed continuous useful development: W30 goal/lease,
physical source changes, an independent Critic reviewing the exact artifact,
an own-PostgreSQL checkpoint, physical client restart and the next cycle without
replaying an earlier effect. This acceptance has **not yet been demonstrated**.

## Implemented source components

- Codex CLI runner using saved CLI authentication, explicit Windows sandbox,
  strict structured results, physical Git/artifact readback and separate Critic.
- Native suspended launch inside a kill-on-close Windows Job; absolute lease
  deadlines, bounded output, cancellation and descendant cleanup. The Job is
  process lifetime control, not the filesystem sandbox.
- A fresh private TEMP per job, outside the worktree, auth and receipt roots.
- Purpose-bound ES256 provider/job proofs using the existing enrolled device
  key. Private Host readers bind installed bytes, Windows SID/kernel birth,
  own-PG identity, managed worktree, live W30 claim, prompt and Critic artifact.
- An own-PG execution ledger consuming existing W30 claims. A synchronous
  ATTEMPTED commit precedes suspended-process resume; restart/unknown ACK paths
  only read durable state. No new scheduler, lease RPC or automatic replay.
- A bounded execution pool so model execution does not block the existing
  Supervisor heartbeat. Pending completion receipts retain their slot until
  the exact W30 completion is acknowledged.
- Packaged external PowerShell helper and explicit source-check registration.

The separate `LOCAL_OPERATOR_QA` namespace does not satisfy production W74,
Authenticode, release-root signatures or SLSA. The source now connects native
composition and admission; installed execution and project acceptance remain
unqualified.

## Targeted evidence

Contract tests cover proof scope/revocation, PID reuse, changed artifact/PG/
worktree, independent Critic identity and exact reviewed patch, ambiguous commit
readback, finite physical capacity and nonblocking heartbeat behavior.

The SQL migration and JS ledger were exercised against a fresh disposable
PostgreSQL 17 cluster: **11/11 PASS**, including concurrent reservations, lost
commit ACK, claim expiry, wrong host/reservation and same-generation rebind.
The test cluster was stopped; installed Keeper data was not used or migrated.
The ledger stores proof digests; signature/Critic validation is a separate Host
responsibility, not something a digest-shaped string proves.

After Windows boot at 2026-10-23 04:02:44.5 Moscow time, real writer and read-only
Critic sandbox canaries passed with the final runner environment and private
TEMP. Writer writes inside the project succeeded; outside writes were denied.
Critic writes both inside and outside were denied. Native processes used a
separate sandbox SID and exited with verified tree cleanup. No model was called.

The CLI updated across reboot to `0.163.0-alpha.11.1`; the independently hashed
current executable is `e757246b4de87359e660647fa9514955a0971ff6a30affdd8c145d1d5ece7b84`.
Historical proofs for the previous CLI or Windows boot are not current permits.
Private detailed logs/receipts remain in local ignored audit storage.

## Installed client boundary

The distinct, frozen .4588.1 installer was built from
`e450713ee609c4bd06f7e5423dd1f18026e19cbc` and installed with physical readback on
23 October. Its normal launch was observed; it does not contain this new backend.
An earlier Owner-directory ACL rejection was repaired before the successful
fresh qualification/publication/install/finalize sequence. Those completed
operations must not be replayed using their historical receipts.

The .4588 runtime subsequently stopped after health-query failures. On 25
October its runtime status was FAILED and the Browser process was absent;
Keeper/PostgreSQL and Guardian remained running. Installation is therefore
confirmed, while current runtime readiness and installed autonomy are not.

A separate .4589.1 health/ASAR repair is being built from frozen
`e4c88cdcf68d3c8002b1fa4274324299cc4f337d`. It reserves a physical SQL connection
for authenticated health requests, reuses one bounded continuity-inspector
connection and invalidates ASAR header caches across replacement. This package
does not include the native coding integration in this branch. Each future
artifact requires its own build hashes, fresh installation receipt and current
process/PG readback.

## Remaining integration

The source now binds protected operator-path/permit readers, an owned Host IPC
capability and enrolled-device signatures in main. The same W30 allocator and
heartbeat admit typed native providers, dispatch their existing leases and
collect protected results. Browser census/capacity and native physical slots
remain separate. IPC exposes six fixed operations, no credentials or SQL.

Provider preparation runs in one bounded background pass driven by that
heartbeat. A slow provider/Host does not block the heartbeat or start another
refresh concurrently. Native process creation commits ATTEMPTED before resume;
unknown acknowledgements fence the attempt and use exact durable readback.
Host SQL qualification uses a new disposable PG17 database with a real
state_owner LOGIN: 10/10 PASS, including joins, canonical digest constraints and
atomic job/result rollback. OS callbacks in that test are explicit fixtures,
so this is SQL evidence only. Source syntax checks cover 210 registered files.

Project reconciliation still accepts browser-specific result claims. It needs
a typed native independent-Critic verifier, a protected own-PG checkpoint and
bounded next-task admission. Host intentionally rejects CHECKPOINTED until that
verifier exists. No native permit has been published and no model execution has
been claimed in the installed client. After completing this remaining path,
build a distinct native-capable package and run the goal/restart trial.
No browser target/conversation proof may be forged to admit a CLI provider, and
an old ambiguous chat send must not be cleared or replayed by this integration.
