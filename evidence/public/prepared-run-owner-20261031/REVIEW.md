# Prepared native execution and original Owner read closure

Classification: SOURCE_REPAIR / PARTIAL_PUBLICATION_INTEGRATION / NOT_INSTALL_QUALIFIED.
Date: 2026-10-31.
Public predecessor: c434cb3cad724abded54f2ff4569d5382440d823, Draft PR #1392.

## Implemented source behavior

- Inert `prepare` creates an exclusive immutable attempt and genuine callback HEADER before reservation, without broker, process or model dispatch. An instance-owned opaque handle is consumed once by `runPrepared`; JSON copies, other runners, concurrent reuse and abandoned handles are rejected.
- The existing executor and runtime wrapper now use prepare → describe → original own-PG reserve → runPrepared. They retain original scope, run identity and expiry; prior local evidence causes SQL readback only. ATTEMPTED → W30 RUNNING → bridge bind → resume ordering remains unchanged.
- Cancellation context reaches the real original reserve and every publication snapshot. Cancellation while the launch receipt is being published is checked again before spawn.
- A fixed read-only Owner facet supports six reads for initial reserve, six for publication and three for effect recheck. Actual RESERVE IPC now carries its six reads on the original physical ticket with maxInflight=1. The other two budgets are implemented as source phase contracts but are not yet mounted for production PUBLISH/AGENT.
- Main's direct W74 callback avoids nested IPC/global drain and checks current identity, Host and original scope before and after actual read work. The standalone diagnostic uses the same callback.
- Invalid, premature and replayed Owner cycle results fence both peers; pending native callback work remains owned until joined. A strict zero-cycle READBACK_ONLY projection cannot become a fresh reservation.
- Test fixture stats are correlated and bounded. Child cleanup requires actual exit; a false kill return while exit is in progress waits for its existing bounded exit event. Unknown exit retains evidence.
- Full-source CI now emits named TAP results and bounds a stuck test at ten minutes. Four-way test concurrency, full glob and the 45-minute job limit remain unchanged; no force-exit or continue-on-error was added.

## Verified checkpoints (not interchangeable)

1. Cancellation-context tree 370f37c8af86b595c9d523cc4511325f4da22dcc: real Windows/disposable PG17 selection 88 passed, zero failures/skips. Linux publication selection 76 passed; related Host/Owner selection 66; registration 18. Selections overlap.
2. Integrated local c05223481de8a8ed02fd985a47a2b55828ece348, tree 94f9a6380c07ce209f9e0d847848a16959d17a1d: nine affected Browser suites on Linux, 303 passed, seven platform skips, zero failures/cancellations. Actual disposable PG17 publication/control selection: 72 passed, zero failures/skips.
3. Direct original RESERVE IPC: nine tests passed, including six real parent/child read cycles, partial-budget refusal, strict historical readback, timeout ownership and asynchronous send failure.
4. Source syntax check: 274 passed. This check count does not substitute for execution tests.
5. The first Windows prepared-run selection failed: 205 passed, ten failed, one platform skip. Five failures were a missing prepared native helper in the new worktree; five were the now-fixed kill(false)/pending-exit fixture race. Its failed evidence is retained, not relabelled success. The helper was explicitly built using the existing reviewed source compiler path; release authority remains false. The repeated intermediate Windows selection on matching tree 94f9a6380c07ce209f9e0d847848a16959d17a1d passed: 310 passed, one platform skip, zero failures/cancellations, 254.08 seconds.

6. Final functional local source `83630839d9bd16b2517a364e51bc9548a61b7df4`, tree `c93cbefc524f2153c0083f37a67c1626a31f0c10`: nine affected Browser suites on Linux, **318 passed, seven platform skips, zero failures/cancellations**. The matching Windows source `c24d890da05c62d993f7a16545f5c8751356630e` passed **325 tests, one platform skip, zero failures/cancellations**, 270.12 seconds. These are affected-suite source checks, not the full Browser suite or installed acceptance.
7. Twelve held filesystem regressions reproduced failure before the final preparation-write fix. Cancellation/original permit expiry now fences each later preparation write while retaining any already-created evidence. Held issuer, ATTEMPTED-commit and W30-ACK cancellation tests also pass.

## Current-source CI interruption

The c434 Current Source run 41166546082 completed Ubuntu and ME2 successfully; its Windows job 124435239608 was cancelled after 45 minutes 15 seconds against a 45-minute limit. Browser output stopped for 17 minutes before cancellation. The exact cancellation annotation was not accessible, so timeout is an inference from timing/configuration, not an independently read annotation.

The complete available log was preserved (SHA-256 a272636dc4ea5277be5b5bc82c7d271a4c2ed7c4260d3722478befb8e98ab85e). The first suspected IPC file passed separately on Windows: 90/90, 58.96 seconds. Thus the original hang was not reproduced or proven fixed. Bounded fixture waits and named CI watchdog results improve diagnosis; fresh complete CI remains required.

## Still required before an installer can be accepted

- Split inert journal BOUND claim from dispatch custody and carry preparation through the runtime's original reserve adapter. That adapter currently does not consume the preparation descriptor.
- Initial actual PG publish plus independent committed readback must finish inside the same original RESERVE request. Mount fresh Owner facets for later PUBLISH and AGENT rechecks; retain private original-object handoff custody and both response/physical-settlement confirmation.
- Enforce a genuine initial PG anchor before signed job/ATTEMPTED, plus durable task-level cross-generation fences for IMPLEMENTER and CRITIC. Qualify directory-loss fail-stop behavior; keep DIRECTORY_DURABILITY_UNQUALIFIED honest. The publication SQL is still unregistered and the default execution gate stays closed.
- Complete historical effect settlement/recovery, first-run materialization and probe/runner policy equivalence.
- Bind the existing protected release signer and authenticated sidecar placement, reserve a new unique package identity, then build and independently verify the exact immutable package.
- Qualify clean install, upgrade with data preservation, own-PG restart/restore/rollback, and useful goal → worker → independent critic → checkpoint → next task. Preserve GLM-before-GPT ordering.

No installer was built, signed or installed by this source checkpoint. No main merge, new signing root, installed Guardian/PG mutation, OS-security change or model-provider call is implied by these tests.

## Release capability readback

The actual W77 capability probe on the final functional source returns BLOCKED with `EXISTING_PROTECTED_RELEASE_ROOT_SIGNING_CAPABILITY_NOT_WIRED`, `EXTERNAL_SIDECAR_INSTALLED_PLACEMENT_UNPROVEN` and `IMMUTABLE_VERIFIED_GH_ARTIFACT_BYTES_HANDOFF_NOT_WIRED`. Scoped repository/history review did not find a callable existing signer or authenticated placement contract. GitHub/SLSA attestation is a separate layer and cannot replace the pinned Ed25519 root signature. No private key material was read or created.
