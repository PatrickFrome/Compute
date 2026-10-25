# QA fixture follow-up after the frozen native-readiness candidate

Date: 2026-10-25.

## Source and package boundary

The frozen QA candidate is `cf547d7e5f973517fa9bd1e206892e3a108ad1ea`, version
`0.7.0-dev.1269944506140.1`, in [PR #1348](https://github.com/PatrickFrome/Compute/pull/1348).
Its normal [Package Smoke run](https://github.com/PatrickFrome/Compute/actions/runs/40217087847)
has consumed that package identity. That commit and its installer bytes must not
be replaced by this follow-up.

Branch `work/qa-ci-fixture-followup-20261025` contains test/workflow corrections
found by that candidate's CI. Production runtime modules, SQL migrations,
Windows readers/controllers and their budgets are unchanged. The package version
and historical candidate/transition records are carried from the frozen parent;
they do not authorize packaging these different source bytes. A future physical
candidate requires a fresh unique version and its own qualification. The normal
immutable producer preflight remains responsible for rejecting a reused version.

Only the five reviewed changed entries in `current_tree_blobs` are refreshed.
All historical ledgers, qualification flags, version records and source assertions
remain intact. This follow-up does not qualify the frozen installer or clear an
ambiguous Supervisor/native effect.

## Hermetic Windows boot-observation fixtures

The [Ubuntu Current Source job](https://github.com/PatrickFrome/Compute/actions/runs/40217087702/job/121240465291)
sets POSIX `APPDATA` and `LOCALAPPDATA` paths for its isolated profile. The new
boot-observation unit tests selected fake Win32 transports but inherited those
real Linux paths. The production Windows-context validator correctly refused the
paths before the fake transport ran.

The generated tests now install an explicit fixed Windows profile/temp context
for each test and restore all prior context variables afterwards. The production
validator and physical Windows tests are unchanged. Running the boot-observation
tests together with the real environment-validation tests under the same POSIX
profile/temp inputs produced **15 PASS, 0 FAIL, 0 SKIP**.

## Display for the full Linux Current Source suite

The same job reached the real Electron main-process ASAR regression without an
X server. The earlier correction covered the separate Shell workflow; Current
Source also needs a display whenever the full suite has materialized Electron.

The complete Browser command is now one Bash array with the existing four-file
concurrency. Linux executes that command through `xvfb-run -a`; Windows executes
the array directly. No Electron mode, filter, skip, timeout, retry, sandbox or
`continue-on-error` setting changes. YAML parsing, Bash parsing and the preserved
full-suite command were checked locally. Actual Electron/Xvfb execution remains
a CI check because those binaries are absent from the local environment.

## PostgreSQL lease window and controlled expiry

The [W45 PostgreSQL job](https://github.com/PatrickFrome/Compute/actions/runs/40217087804/job/121240465402)
reported two successful acquisitions from eight concurrent requests. The test
used the minimum five-second lease but took 12.541 seconds before its assertion.
It assumed that every acquisition belonged to one still-active lease window.
That assumption is invalid when the test spans expiry; the immutable W26 SQL
explicitly permits a later incarnation to acquire the expired row.

The fixture now uses a 60-second test lease and independently reads back the
actual PostgreSQL row after all contenders settle. It still requires exactly one
successful acquisition, the same incarnation, generation one and an active lease.
If the race outlasts that window or changes generation, it fails. Bounded
diagnostics record the elapsed time and observed window without private data.

The separate lost-ACK/expiry path no longer relies on a wall-clock sleep. After
the real reservation commits and its ACK is deliberately lost, the fixture
expires only its exact generated owner/run/incarnation row while requiring
generation one, PREPARED and event sequence one. Readback proves that the fixture
did not reconcile or erase the pending wake. The unchanged W26 implementation
then performs the real generation-two transfer and must preserve AMBIGUOUS,
reject a new wake and reject a forged receipt. No production TTL or SQL changed.

### Local physical PostgreSQL evidence

`evidence/audits/metaengine-20261025-native-admission/lease-window-pg17.json`
records an actual PostgreSQL **17.6** experiment on a newly created private Unix
socket, with no TCP listener and fsync enabled. It executed the exact CAS/lost-ACK
subtest bodies extracted from the old and changed fixture, using the real W26
module from `6498c1596432ea9d9987f343c92505b273d1ac11`.

- With the final contender deliberately delayed 5.6 seconds, the old fixture
  produced two successful sequential acquisitions and failed its single-winner
  assertion as expected. This is a controlled counterexample, not proof of the
  precise internal scheduling in the earlier CI runner.
- With the same delay, the changed fixture passed: one acquisition, generation
  one, active lease, then the real lost-ACK and generation-two AMBIGUOUS path.
- An actual postmaster restart changed the PID and preserved the exact pending
  wake, incarnation, generation and event fields.
- The disposable postmaster was stopped and its private directory removed.

This is local generated-source evidence. It is not a run of the complete pinned
Docker-image W45 fixture, an installed client, production database qualification
or proof of autonomous agents.

## One native directory spelling for the capture fixture

The parent's [Windows Current Source job](https://github.com/PatrickFrome/Compute/actions/runs/40217087702/job/121240465073)
completed all 637 runtime contracts, then the Browser suite reported 5,931 PASS,
three FAIL and seven SKIP. Two test processes aborted at libuv's
`!_wcsnicmp(filename, dir, dirlen)` assertion in `src/win/fs-event.c:72`.
Both use the same owned capture helper. Its watcher previously received the
original temporary directory spelling, which can contain a Windows short-path
or directory alias. The [pinned Node 24.19.0 libuv source](https://github.com/nodejs/node/blob/v24.19.0/deps/uv/src/win/fs-event.c)
expands event filenames with `GetLongPathNameW` before comparing their prefix to
the stored watch directory.

The helper now native-resolves the existing parent directory once, before any
watcher or child is created. The watcher, child argument and nonce-bound ready
and stop files all use that exact directory spelling. Missing child files still
reach the original spawn-error path. The nonce, PID/HWND checks, file bounds,
real Electron main-process mode and close-before-remove behavior are unchanged.

A real directory-alias regression rejects the frozen helper at the path
assertion and passes with the correction. The focused capture/profile/computer
suite produced **50 PASS, 0 FAIL, 6 Windows SKIP**. Output with trailing whitespace removed, including the
expected original-helper negative control, is recorded in
`capture-alias-fixture-regressions.txt`. The exact watched path on the failed
Windows runner was not recorded; physical confirmation of this correction and
precise attribution of that runner's abort remain Windows CI work.

## Source preflight

The complete ten-file historical/current source preflight is recorded in
`qa-ci-fixture-source-preflight.txt`: **124 PASS, 0 FAIL, 0 SKIP** after the
capture-fixture correction. It verifies the immutable historical ledgers and
the refreshed current source hashes; it does not qualify native Windows
execution or authorize reuse of the frozen package version.

## Remaining boundary

The separate WinPS Add-Type startup failure remains open. On the parent SHA's
latest Windows Current Source run, the first and forced-output controllers
reached validated readiness at 28,500 and 28,700 ms, while the first boot read
closed at 12,035 ms after only SCRIPT_ENTER/ADD_TYPE_BEGIN. These observations
are recorded in `current-source-windows-observation.json`; they do not establish
why compilation was slow. The original 12-second boot and 30-second controller
budgets are unchanged, and the earlier ambiguous Supervisor wake is unresolved.
The user's Windows device was still reported Offline on the latest readback,
so installation on that device and a real goal/CRITIC/checkpoint/restart cycle
have not been performed.
