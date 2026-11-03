# Installed recovery composition — source stage, native issuer still HOLD

The fixed installed service composition, authenticated job binding, real Host
Owner/own-PG observation adapter and prepared runner package selection are
implemented. **The genuine directory issuer inside the original Job owner is
still unavailable. Backup/restore effects and selector creation remain HOLD.**
No new trust root, positive directory-custody wire flag, installation, Windows
execution, merge or real database operation was introduced.

## Exact incremental patch

- Base tree: `23e4cd10df4817505f8dc3e276cc7688753992e3` — verified #1443 result.
- Result tree: `7aa8184e89a4ca3754275e81bf3f83a61276837b`.
- File: `installed-recovery-composition.patch`, 201178 bytes.
- SHA256: `83fc15b9c9100f2dca110b07497ca3df3754b725d69e8e4da630ca764572e4bf`.
- Previous artifact: [#1443](https://github.com/PatrickFrome/Compute/pull/1443),
  commit `f58fa33bec83a8a73b57532b274ef11c391b6975`; its patch SHA256 is
  `5567ec3d20da83cb260426f6b9ed32599e60a6b0184d535f8bac591859631bdd`.

Check the actual starting source tree, run `git apply --check`, then apply the
incremental patch. A fresh detached copy of the exact base passed
`git apply --index`, whitespace validation, exact result-tree comparison and
88 focused tests. Local synthetic commit metadata is not an upstream identity;
the tree is the portable baseline. Original source/archive identities are in
`source-base.json`.

The parent supplied local HEAD `49386b65adfc00b607434fd84399f5dd53bd7816`.
The authorized standard Git fetch failed with exit128:
`fatal: remote error: upload-pack: not our ref 49386b65adfc00b607434fd84399f5dd53bd7816`.
It was not retried or bypassed. Its tree is unverified here, so this patch
explicitly targets the verified #1443 tree above, rather than asserting identity
with that inaccessible commit. This was a missing remote ref, not a tool-policy
approval denial.

## Source stage completed

1. `runtime-host.mjs` now imports a fixed installed recovery composition.
   It selects only an original verified offline package and original Host OS
   reader/pool pairing. Bundles without the prepared pair, substituted verifier
   results and supported ordinary attached configurations outside the recovery
   profile keep recovery unmounted while preserving their existing PG/API.
2. Recovery service publishes an inert eight-field original authenticated-job
   facet only after its existing ES256/current ADMIN verification, original root
   phase acquisition and lifetime take succeed. No registration export exists.
   Cancel, close, expiry or finish permanently retire lookup while original
   cleanup remains retained. Pre-auth server dispatch and factory-created jobs
   cannot supply this provenance.
3. The Host observer is a branded local object, not a fabricated W76 facade.
   It requires the same service actor, request, phase, pool and PGDATA references,
   reads actual original Main root observations and uses the existing monitored
   W61 read-only transactions. It checks currentness around each query and joins
   pending reads; retirement during the birth query prevents the epoch query.
   Producer validation and final ACL callbacks use this explicit Host observer.
4. Offline resources admit exactly helper+manifest together or neither at
   `runtime/native-coding/{codex-cli-job-runner.ps1,manifest.json}`. Immutable
   original verifier snapshots retain their pins and seven PG tool hashes.
   The existing offline file table and protected ASAR binding cover these
   first-party resources. The two-component private-native-tools contract is
   unchanged. Staging prepares once; beforePack validates source/C# pins,
   embedded assembly/render equality and exact byte reuse without recompiling.
5. Installed Node controller selection requires that original registry object,
   its fixed module/Node placement and exact resource pins. It checks before
   launch and after READY. Foreign registry instances, copied metadata,
   transplanted contexts, explicit helper pins and readable legacy fallback
   paths cannot select the installed branch. The ASAR branch is preserved.
6. Both real native-effect refusals remain. The selector still refuses before
   REGISTERING/mkdir without original parent custody. The actual C++ mechanics,
   C# runner and shared custody-veto module are byte-unchanged from the base.

## Exact missing native producer

The Job is created, limited and closed by `MetaengineCodexJob.RunCore` inside
`apps/metaengine-browser/scripts/codex-cli-job-runner.ps1`. Its explicit process
inheritance list contains only three stdio handles. The new C++ directory core
is compiled in Electron Main, with no caller or bridge into that C# Job-owner
process. A Host/SCM wrapper around that core would put the holder in the wrong
process. Duplicating the helper-owned Job into a surviving process changes
kill-on-last-close behavior; it is not a substitute for worker custody.

The missing producer must be implemented inside that SAME prepared assembly
(or another authenticated in-process part of the same original owner), as a
fixed retained recovery session. It must:

- Resolve the original authenticated service job/controller session and current
  Host/phase/Owner/own-PG objects. A passed actor record, hash, numeric handle,
  callback or positive wire flag cannot establish this binding.
- Acquire and retain the original backup-root, PGDATA and complete parent/ACL
  custody before any recovery effect; acquire identity-store/state ancestry
  before REGISTERING or creating selector/parents. Use original relative
  creation, retain returned objects, and refuse collisions/orphans.
- Observe each effectful worker AND descendant at original suspended birth,
  transfer/compare the same original directory and anchor opens before first
  execution/input, and preserve kill-on-crash in the original Job owner.
  Job membership and initial-worker handles do not prove descendant transfer.
  Every command, including version probes, needs this coverage.
- Revoke synchronously on cancellation, expiry and authority loss. Retain
  per-worker custody until actual process/Job exit, pipes, SQL, filesystem and
  callback/send joins complete. Unknown completion remains quarantined;
  holder death, cancellation, ACK/CLOSE or a late callback are not a join.

These are requirements for an absent producer, not newly available exports.
No caller-facing positive issuer was invented to fill the gap. Source composition
and package availability do not qualify Windows semantics or authorize effects.
`HOST_SERVICE_MOUNT.md` contains the detailed remaining contract and primary API
references.

## Verification and limits

- Final compatible profile: **862 tests, 861 PASS, 0 FAIL, 1 Windows-only SKIP**.
- Clean applied patch: **88 PASS, 0 FAIL, 0 SKIP**.
- JavaScript source checks: **302 PASS**.
- Native model: actual unchanged C++ compiled with strict warnings; **35
  mechanical cases PASS and 2 counterexamples confirmed**. One counterexample
  demonstrates that a surviving external Job duplicate suppresses last-close
  termination. The other demonstrates the descriptor-less descendant gap after
  holder/parent death. Every result rejects architecture acceptance and native
  authority. Model termination requests are separate from physical exit.
- New installed reader tests use the actual copied controller and its actual
  original offline registry, with synthetic process context and no real spawn.
- Four integrated tests run the actual composition, fixed signature verifier,
  lifetime, producer, root provider and shared veto with explicit registry/OS
  boundary fixtures. Valid BEGIN reaches exact native HOLD even after the final
  root, parent or PGDATA swap. Signed READ says HOLD/cleanup DRAINED; source
  connections/reservations/transactions stay zero and tree identities/bytes
  remain unchanged.
- Static selected Host closure: **283 files**, all reviewed, including service,
  observer and actual effect veto; no test loaders. Base closure remains88.
  Both keep exact `npm:postgres@3.4.7` selection.

Three existing dependent profiles cannot qualify the assembled Host/package:
`runtime-host.test.mjs`, `runtime-host-native-compositions.test.mjs`, and
`startup-source-manifest.test.mjs`. Pinned `node_modules/postgres@3.4.7` is absent.
Their prerequisite failure was reproduced on the exact baseline:11 failures
across the dependency profiles. No installation or dependency fetch was tried.
The final compatible command records these exclusions explicitly.

The initial expanded run had25 failures:11 baseline dependency failures,
13 newly exposed substituted-verifier composition regressions and one obsolete
beforePack compile assertion. The latter14 were fixed; the native Host
compatibility rerun passed19/19, the packaging test rerun passed, and the final
compatible profile passed with no failures. Logs are retained rather than
claiming the initial run was green.

**Windows build, native execution, signing, installation, genuine issuance and
physical recovery are NOT RUN/unproven.** No real DB, installed PC, shared branch,
service or trust root was changed. Independent source review found no additional
concrete auth/custody defect in this stage.

## Persistence

Deliverables are saved locally and on a separately authorized public artifact
branch. The earlier private Page update to
`page_3309b52967c88191aa5e6441c2badb1e` failed with
`auto-permission-review timeout`; readback confirmed old content. That failed
Space action was not bypassed or retried for this stage and is not reported as
successful.
