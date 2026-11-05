# Test results — 2026-11-05

All actions were source-only. No installed METAENGINE client, user profile,
PostgreSQL server, Windows service, installer, listener, or network port was
started or accessed. No real data was modified.

| Test group | Actual execution | PASS | FAIL | SKIP | Status |
|---|---|---:|---:|---:|---|
| GitHub text structural checks (public parent + integrated patch) | Connected GitHub source read, in-memory checks | 9 | 1 | 0 | **FAIL**: no common serialization around concurrent `beginSelfUpdateTransaction` |
| Five-surface disposable model fixtures | `node --test --test-reporter=tap tests/fixture-data-preservation.test.mjs` in isolated executor | 9 | 0 | 0 | **PASS — model only** |
| `source-contracts.manual.mjs` on full checkout | Not executed | — | — | — | **NOT RUN**: target source tree unavailable |
| `concurrent-begin.regression.manual.mjs` on real source module | Not executed | — | — | — | **NOT RUN**: target source tree unavailable |
| Reconstructed c265 archive SHA + tree + e30 integrated tree | Not executed | — | — | — | **NOT VERIFIED**: raw GitHub binary transfer unavailable |
| Physical Windows install / upgrade / restore | Not executed | — | — | — | **NOT RUN / NOT AUTHORIZED** |
| Disposable PostgreSQL 17 migration / backup / restore | Not executed | — | — | — | **NOT RUN** |

## Check names for GitHub text-only structural inspection

PASS: journal no automatic retry; write-ahead `INSTALLING` before handoff;
sequential unresolved-prior veto; fresh provider restart fence; refusal of
unregistered protected root without native parent custody; original PG17 custody
precedes source-pool binding; prior disposable restore attempt HOLD; portable
qualification does not claim physical proof; NSIS config test asserts no
AppData deletion.

FAIL: concurrent first `beginSelfUpdateTransaction` calls are **not** covered by
the same durable, cross-process read/validate/write lease as physical effect
marking. The assertion is a textual source invariant; the full behavioral race
was not executed against the exact resulting tree. Keep `HOLD` until fixed and
independently retested.

Synthetic fixture TAP output is included in the local result archive. No claim
of end-to-end project, message, result or PostgreSQL preservation is made.
