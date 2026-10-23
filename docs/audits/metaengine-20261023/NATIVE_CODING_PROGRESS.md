# Native coding progress — 23 October 2026

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
Authenticode, release-root signatures or SLSA. Readiness remains closed until
real native composition and admission are connected and qualified.

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

The distinct, frozen .4588.1 installer is still built from
`e450713ee609c4bd06f7e5423dd1f18026e19cbc`; it does not contain this new backend.
An earlier guarded publication stopped before Owner/image mutation because the
Owner directory inherited an unapproved read grant. The directory DACL was
backed up and repaired through the existing native Owner-only ACL helper.
Owner contents retained their exact original SHA-256.

The machine rebooted between attempts. The old qualified receipt cannot be
reused because Keeper incarnation changed. A fresh prepare/install sequence
uses the same exact installer, full installed-image readback and final admission
marker. Installation, normal launch and execution readiness must be reported
separately from this source work.

## Remaining integration

Connect genuine protected operator-permit readers and the native Host producer
in installed main; add the typed native provider branch to the existing W30
admission/routes/capacity projection; connect dispatch/observation to the same
heartbeat and pool; verify independent Critic acceptance and own-PG checkpoint.
Then build a distinct package version and run the installed goal/restart trial.
No browser target/conversation proof may be forged to admit a CLI provider, and
an old ambiguous chat send must not be cleared or replayed by this integration.
