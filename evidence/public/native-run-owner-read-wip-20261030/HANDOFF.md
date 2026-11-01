# Incomplete Owner-read source overlay — not qualified

This overlay preserves partial work for continued implementation. It is not an
accepted Owner reader and is not part of the reviewed public source checkpoint.
Its only parent is the separate sanitized public source export. No private
historical ancestor or original operational report is included.

## Implemented, but incomplete

- Loaded-only Guardian signing uses the existing canonical signing bytes and
  already-loaded identity. The fixed OWNER read transport joins its original
  socket close and cancellation. Existing update/enrollment behavior is retained.
- A loaded-only W74 reader reuses the original complete sealed-record validator
  without ensure, create, reseal or global W74 rebinding. Source evidence remains
  `loaded_runtime_code_attested:false`, `production_qualified:false`.
- A fixed per-run read-phase contract binds original request/body/child identity,
  exact current control and complete original sealed-record digest. It is NOT
  mounted in the IPC client/server, Host SQL or Main default composition.
- Existing W68 sidecar and final lstat groups now join all original observations
  before propagating failure. The two held-sibling regressions failed before
  this repair; their original log digest is recorded, not published as raw data.

Fresh overlay tests: 62 PASS, zero failures/skips across Guardian, W74, W68 and
phase-contract suites. These are generated/source fixtures, not Windows, DPAPI,
real Guardian or signed installed-source qualification. No new PG test has been
run for this partial reader. Existing publication gate remains CLOSED and the
publication SQL remains UNREGISTERED.

## Required continuation (not yet implemented)

1. Add a fixed loaded signer for `READ_RUN_OWNER_CUSTODY_V1`. Reuse canonical
   device-signature implementation; never ensure, load/create keys or enroll.
2. Mount the fixed additive phase in the SAME Phase1B IPC client/server original
   pending/physical maps, shared maxInflight and child/request/digest binding.
   No new broker, separate capacity pool or nested Host request is allowed.
3. Build the read-only Host producer from actual current SQL: exact execution
   reservation, task/claim/permit, activated project/root/seed, device grant,
   immutable `native_coding_pending_activation_h205f22.sealed_owner_sha256`,
   and protected original Owner and activation intents. Missing anchor or old
   lineage remains HOLD; never infer authority from caller JSON/null columns.
4. Bind actual current runtime-control generation_floor, workspace, enabled
   flags, reset_at and updated_at before/after. A repeated read must not hide a
   concurrent committed stop in an old transaction snapshot. Use one existing
   connection and existing authority; no extra control or Owner ledger.
5. Default private Main composition must use actual Electron W68 and W60/native
   providers with already-loaded identity, not weaker cached image evidence.
   Original sealed-record timestamp stays immutable; observation time is fresh
   and separate. The current phase parser checks ISO shape; the real producer
   must enforce age/expiry and before/after native/PG/control stability.
6. Classify HOST_SCOPE before dispatch, retain original callback promises and
   keep explicit quit order: fence/drain physical workers, sole original Host
   stop, then remote callback join. Ordinary close must not stop the Host.
7. Add actual activated-project disposable PG tests, default Main/Host mounting,
   complete seal forgery, control changes/revocation, two concurrent runs, zero
   ensure/writes, IPC timeout/late/forged/duplicate responses, physical poison,
   and ordinary/concurrent quit lifetime coverage.

Do not connect this incomplete reader to publication `readOwnerControl` yet.
That remains null/unbound until a separately reviewed integration. No renderer
endpoint, shared ticket, send capability, receipt upgrade, historical capacity
resolution, materializer, setup effects, installation or security changes.
Missing genuine Guardian/W68/native evidence remains HOLD. Required socket
qualification and prior dependency/native limitations are not waived.
