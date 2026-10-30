# Admission / presentation fixture repair

Base: `5d7ec74db1c72b15921a6e00a2826a09a72f4fb2` (published source).
**Two test files changed; no production, workflow, migration, release-seal or
installed files changed. Overall qualification remains incomplete.**

## Reproduced failures

The unchanged two-file run reproduced **12 PASS / 6 FAIL**. The same six failures
were observed in exact-head Browser contract CI, including
[Self Update source contracts](https://github.com/PatrickFrome/Compute/actions/runs/41113874633)
and [Browser Shell contracts](https://github.com/PatrickFrome/Compute/actions/runs/41113874024).

Five admission tests used a VM extraction of real Main code but omitted its
`nativeCodingRuntimeMountCustody` global, introduced by the custody fence. That
ReferenceError stopped the intended path before the durable send intent. The
fixture now supplies the neutral initial value, while added tests exercise a
failed mount and retained cleanup both before and after durable intent creation.
Original no-redirection, no-second-send, independent-readback and durable-pending
assertions remain. Each drift now also checks the precise intended refusal, so
an unrelated fixture exception cannot satisfy the negative case.

The R97 presentation test derived its expected Browser mode from descriptor
absence alone. Production correctly requires a separate read-only observation
that no applicable native setup is retained. The presentation fixture now
explicitly supplies generated no-intent/resolved-scope evidence; this is not
native authority or installed proof. Missing read, retained setup, unresolved
scope, failed authentication and effectful evidence still require HOLD and
cannot select Browser. Zero-argument, no-submit and progress assertions remain.

## Verification

- Focused repaired run: **27 PASS**, zero failures/skips.
- Full related Main/route/IPC/lifetime and presentation suite: **280 PASS**, zero
  failures/skips (includes the focused tests; counts must not be summed as unique).
- Source parser: **273 PASS**. Diff check clean. No dependencies installed.
- Commands and original log digests are in `CHECKS.json`; before-failure evidence
  is retained distinctly from the successful run.

This does not resolve the separate current source seal, fresh-schema current
inventory mismatch, Windows helper/native qualification, publication/Owner
binding, materializer, required socket or dependency qualification limits. No
CI rerun, gate relaxation, package release or installation is part of this fix.
The prior public export manifest remains unchanged as its frozen checkpoint.
