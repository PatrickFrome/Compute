# W1 DEV-CYCLE-001 — persisted-readback admission compositor

Status: **DB-NATIVE COMPOSITOR LIVE / NON-AUTHORITY / LIVE C1 EVIDENCE INCOMPLETE**

Canonical Level-1 milestone: **C1 — First Real Linux Worker**  
Level-2 milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`

## Security recheck

A later adversarial pass found a trust-boundary defect in the original Python compositor. `worker/native_linux/admission_candidate.py` accepted caller-provided objects and treated a string field `source=SUPABASE_PERSISTED_READBACK` as if it authenticated database provenance. A fully forged but internally consistent JSON bundle could therefore produce `ADMISSION_CANDIDATE_NON_AUTHORITY` without any actual database read.

The real database schema also does not match that synthetic projection exactly: for example, probe receipts derive worker identity through enrollment rather than storing the caller's projected `worker_id`. This proved that the Python shape was an offline model, not a production persisted-readback path.

## Corrected authority topology

Production composition now lives in:

`public.h205f22_w1_admission_candidate_readback_v1(uuid, uuid, bigint, bigint)`

Live migrations:

- `20260823141025_w1_persisted_admission_candidate_readback_v1`
- `20260823141042_w1_admission_candidate_readback_volatility_fix`

The function accepts only four immutable identifiers:

1. safety verification UUID;
2. reboot receipt UUID;
3. pre-reboot probe receipt ID;
4. post-reboot probe receipt ID.

It does not accept caller-provided safety, backend, reboot or probe rows. It selects each persisted object itself and revalidates their bindings using database time.

Because freshness uses `clock_timestamp()`, the final function volatility is `VOLATILE`; this is an observation of changing database time, not a write side effect.

## Persisted planes revalidated in DB

The DB-native compositor checks:

- exact current `VERIFIED` Linux safety verification and recomputed verification receipt digest;
- enrollment identity, `PROBED` state, `probe_verified=true`, latest probe SHA binding;
- current node-class required capabilities;
- non-ephemeral `NATIVE_LINUX|SELF_HOSTED_VM` backend binding, observed/probed execution state, exact provider endpoint identity, non-authority flags;
- exact immutable reboot receipt for the same worker/provider instance;
- `SIGNED_PROVIDER_IDENTITY` with verified pinned AWS IID evidence;
- provider reboot semantics remain `ASYNC_REBOOT_REQUEST_ACCEPTED`, never reboot-completion authority;
- signed-reboot evidence is revalidated through `compute_fabric_validate_signed_reboot_identity_h205f22` and its stored digest is recomputed;
- exact pre/post probe-v2 PASS rows for the same enrollment;
- probe payload and receipt digests are recomputed;
- current node-class capabilities are still satisfied;
- Linux architecture remains stable;
- `boot_id` is well-formed and changes;
- strict ordering `pre < request <= provider-event < post <= DB-now`;
- safety verification is at/after the post-reboot probe and binds its SHA.

Only after those persisted checks can the function emit:

`ADMISSION_CANDIDATE_NON_AUTHORITY`

with `source=SUPABASE_PERSISTED_READBACK`.

Hard nonclaims remain:

- `worker_admitted=false`;
- `persistent_worker_proof=false`;
- `w1_verified=false`;
- `canonical=false`;
- `authority_effect=false`;
- provider request acceptance is not reboot-completion authority.

## Probe-writer hardening

The same migration revokes direct `service_role` INSERT on:

`destruktion_meta.compute_fabric_worker_probe_receipt_h205f22`

The service role retains the guarded probe-v2 writer RPC. This prevents production composition from depending on probe rows that the service role could fabricate by bypassing the probe validation function.

Backend binding, safety verification and reboot-receipt tables already expose only SELECT to `service_role`; their write paths remain separately guarded.

## Python role after the fix

`worker/native_linux/admission_candidate.py` is now explicitly an **offline oracle only**. Caller-provided bundles may be shape-checked for tests, but the module always returns:

- `ADMISSION_COMPOSITION_ORACLE_NON_AUTHORITY`;
- `input_provenance_verified=false`;
- `admission_candidate=false`.

A `SUPABASE_PERSISTED_READBACK` string inside caller JSON is only an asserted label and never grants provenance.

## Research

The design follows the same persisted-readback lesson established by the F1 adversarial loop: a self-consistent object is not provenance. Trust comes from independently constrained persistence and readback, with immutable identifiers and server-side recomputation.

PostgreSQL function volatility was also rechecked: a function whose result depends on `clock_timestamp()` must not be declared STABLE merely because it does not mutate tables. The live follow-up migration changes the function to VOLATILE so CURRENT/HISTORICAL decisions reflect actual database time.

## Live boundary

This migration does not fabricate C1 evidence. At deployment time there was still no live persistent backend binding, no live signed reboot receipt and no dedicated current post-reboot safety verification that could satisfy the DB compositor. Existing probe rows remain audit data only.

The remaining external sequence is still:

1. independently provision/read back the exact SSM document in AWS;
2. prove an Online Linux EC2 managed node;
3. capture genuine IID bytes and verify them off-host with the pinned AWS certificate contract;
4. persist a real non-ephemeral backend binding;
5. persist a real signed provider reboot-request receipt;
6. persist ordered pre/post probe-v2 rows with changed boot ID;
7. create the dedicated post-reboot safety verification;
8. invoke the DB-native compositor by those immutable IDs;
9. submit only that persisted candidate to Supervisor review.

No worker admission, W1 verification, canonical checkpoint or mainline seal is performed here.
