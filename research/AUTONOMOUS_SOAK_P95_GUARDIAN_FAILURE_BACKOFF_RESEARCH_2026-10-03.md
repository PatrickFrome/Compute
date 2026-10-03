# METAENGINE Browser — Autonomous Soak P95 / Guardian Failure Backoff Research

Date: 2026-10-03
Plane: research / source-only mitigation
Authority effect: false
Physical retry authority: false

## Research question

Why did the exact physical candidate `219ebe989a4f7ce2adfeb205a394a47ee55037cf` preserve 72/72 activation correctness, zero duplicate Browser runtimes and healthy resource budgets, but violate the sequential second-instance p95 latency SLO with 1771.21 ms?

This note separates proven observations from hypotheses. It does not justify weakening the 1000 ms SLO or rerunning the consumed physical identity.

## Proven physical evidence

Current failing physical soak:
- run `37144386167`
- package `0.7.0-dev.37139234564.1`
- 72/72 activations proven
- p95 1771.21 ms, budget 1000 ms
- concurrent burst 426.37 ms
- working-set growth 0
- handle growth 12, budget 24
- duplicate runtime false

Historical green control:
- source `b8f2f438bf3d9450a301ebb525eb95181f6d464d`
- soak run `37076381723`
- p95 157.56 ms
- same 1000 ms budget
- 72/72 activations
- concurrent burst 406.75 ms
- working-set growth 0
- handle growth 5
- duplicate runtime false

Both runs used:
- Windows Server 2025
- GitHub runner image `windows-2025-vs2026`
- image version `20260925.250.1`
- runner version `2.337.0`

Thus runner-image version drift is falsified. Different Azure regions still mean the hosted VM environment is not an identical physical machine, so environmental latency remains possible but unproven.

GitHub's current hosted-runner documentation states that standard jobs run on fresh GitHub-hosted VMs with label-specific CPU/RAM/storage specifications:
https://docs.github.com/en/actions/reference/runners/github-hosted-runners

That controls the advertised machine class but is not evidence of deterministic sub-second process-launch latency across separate VMs.

## Activation protocol did not change

The following exact source blobs are identical between the 157.56 ms historical green candidate and the 1771.21 ms red candidate:

- `src/main-entry.mjs`
- `src/browser-startup-observability.mjs`
- `src/primary-window-resurrection.mjs`
- `src/single-instance-guard.mjs`
- `src/host-resilience-runtime.mjs`

Electron's documented single-instance contract matches the METAENGINE path:
- the losing process calls `requestSingleInstanceLock(additionalData)`;
- the primary receives `second-instance`;
- applications normally restore/focus the primary window;
- the event is delivered after `ready`.

Official reference:
https://www.electronjs.org/docs/latest/api/app

The physical proof confirms the protocol remained correct: every exact launch nonce got a durable activation ACK and no duplicate runtime appeared. The regression is therefore latency, not correctness.

## Latency shape

The current startup journal is not uniformly slow.

Sequential activations are mostly in the approximate 107–262 ms range, with a localized burst around samples 56–61:
- ~1036 ms
- ~1771 ms
- ~1721 ms
- ~2181 ms
- ~1781 ms
- ~1884 ms

Then latency returns to roughly 349/110/111 ms before the concurrent phase.

A six-sample localized stall is enough to move p95 above the one-second budget. The later 8-way concurrent burst still completes in 426.37 ms.

This is evidence against a simple permanent degradation in the activation algorithm.

## New main-process work introduced since the historical green control

Although the activation core is unchanged, `src/main.mjs` has changed substantially.

One important addition is the shared Guardian status observation path used by native Supervisor heartbeat and Settings:
- `nativeSupervisorState()` calls `guardianObserver.refreshIfDue()`;
- NativeSupervisor heartbeat interval is 2000 ms;
- Guardian positive observation TTL is 10,000 ms.

The intended design is bounded single-flight observation. However the failure path had no negative/backoff timestamp.

Before the successor fix:

1. Guardian observation fails;
2. `lastError` is recorded;
3. no valid cache timestamp is established;
4. `isFresh()` remains false;
5. after the single in-flight promise clears, the next heartbeat can immediately start another observation.

With a 2-second supervisor heartbeat this converts a persistent Guardian transport failure into repeated background status work rather than a 10-second bounded observation cadence.

## Why the current live Guardian failure makes this relevant

Fresh installed Browser readback reports:

`guardian_update_actuator_pipe_error:connect EPERM \\.\pipe\METAENGINEBrowserGuardianUpdateV1`

The separate Guardian research established that this is a real transport contract mismatch, not a positive service/owner result.

Current status preparation also verifies fixed packaged Guardian material before owner observation. The packaged bootstrap verification includes synchronous local file reads and SHA-256 verification. Re-entering this failure path from the Electron main process every heartbeat is therefore unnecessary work exactly where UI activation latency is measured.

This remains a contributor hypothesis, not a proven one-to-one cause of the six observed outliers. The correct engineering response is to remove the independently identified retry storm and then measure a fresh physical identity.

## Named-pipe evidence

The existing Guardian DACL intentionally avoids generic write authority.

Microsoft documents that for named pipes `FILE_GENERIC_WRITE` includes append access, and because `FILE_APPEND_DATA` and `FILE_CREATE_PIPE_INSTANCE` share the same definition, granting generic write can grant pipe-instance creation. Microsoft explicitly recommends individual rights to avoid that:
https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights

libuv's Windows client implementation first opens a named pipe with:

`GENERIC_READ | GENERIC_WRITE`

and on access denied falls back to other generic combinations:
https://github.com/libuv/libuv/blob/v1.x/src/win/pipe.c

Therefore the long-term Guardian EPERM repair should preserve the narrow DACL and use an exact-rights native client rather than weakening the pipe ACL.

The p95 mitigation in the current successor is intentionally separate: it only prevents repeated failed background observation attempts.

## Source-only mitigation

Successor branch:
`work/guardian-observation-failure-backoff-v1`

Initial mitigation commits:
- `2430a36f2e36ce473dcc54371a5c1f8fe55c9651` — bounded failed background-read backoff
- `bb3a1c433c45cd565a33ea7bf3f216cafb39e186` — deterministic contract tests
- `a942c4e8604b75c409c9527b07f5dca4940b4623` — source qualifier wiring

Semantics:
- a failed automatic Guardian read sets a retry-not-before fence for one observation TTL;
- background `refreshIfDue()` cannot re-enter the failure path during that interval;
- ordinary non-forced reads return the existing fail-closed projection;
- explicit operator `force=true` can still request one fresh bounded diagnostic read;
- a successful valid read clears the backoff;
- activation invalidation clears it;
- no positive Guardian proof is fabricated;
- no owner/device/enrollment/UAC authority is added;
- automatic effect retry remains false.

## Why this is safer than increasing the latency budget

Changing the soak budget from 1000 ms to 2000+ ms would make the observed failure disappear without removing any causal load.

That would be test accommodation, not a product fix.

The current approach keeps the SLO fixed and removes a concrete main-process retry pathology first. A future physical successor must still pass the original 1000 ms p95 gate.

## Deterministic qualification added

The observer test now simulates a persistent EPERM-like failure while heartbeat checks occur every 2 seconds.

It proves:
- first failure performs one read;
- repeated background refresh checks within 10 seconds perform zero additional reads;
- projection remains HOLD / not-ready / zero owner-device proof;
- explicit operator force read is allowed exactly as a manual diagnostic;
- after the backoff TTL expires, one background refresh becomes eligible;
- `automatic_retry_allowed=false`.

This turns the mitigation from a timing guess into a source-level invariant.

## Next measurement plan

If source-only qualification is green:

1. do not touch the consumed physical source/version;
2. allocate a fresh package identity only after the exact successor is frozen;
3. run the full one-producer physical matrix once;
4. compare:
   - sequential p50/p95/max,
   - number of >1000 ms samples,
   - concurrent burst elapsed,
   - working-set and handle growth,
   - duplicate-runtime invariant;
5. preserve the 1000 ms p95 SLO;
6. if p95 still fails, inspect other main-process periodic work rather than hiding the regression.

A useful future instrumentation improvement is to persist all 64 sequential activation samples or a bounded histogram in the soak proof so localized stalls do not require journal reconstruction.

## Separate long-term Guardian repair

The background backoff does not resolve the underlying EPERM.

The long-term source-only successor remains:
- fixed native exact-rights pipe client;
- fixed compiled pipe name;
- specific `CreateFileW` access mask compatible with the current least-privilege DACL;
- bounded request/response size and deadline;
- no arbitrary path, URL, command, shell, or process target;
- helper hash included in Build Identity;
- physical proof that the narrow DACL remains intact.

Do not combine that larger native change into the latency mitigation candidate until the current convergence path is measured.
