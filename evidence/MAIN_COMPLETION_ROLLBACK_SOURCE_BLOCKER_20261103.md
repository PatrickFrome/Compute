# Main completion, cancellation and rollback source blocker

Date: 2026-11-03. Status: **HOLD / SOURCE UNAVAILABLE**.

The requested source-only work covers completion of original external operations, cancel/restart, and safe update rollback, including an uncertain Main launch barrier result. No implementation patch has been produced and no behavioral tests have run.

## Original baseline

The required baseline is `metaengine-main-guardian-e6bdd05-source.zip`, with expected SHA256:

`b79322b6e3a43bb863235052801f9d68d867b22de172a3a446d92dd131a153da`

Required patch order: e6→cd, cd→d790, d790→b524, b524→c265. The requested resulting tree is `2dbe253e97379532f6f4b52ef7edf26109a9266d`.

These values are task inputs, **not verified observations**. The archive was not materialized, its SHA256 was not checked, no patch was applied, and the resulting tree was not reproduced. The repository's public default branch has not been substituted for the required baseline.

## Observed access failure

The authorized Library preparation returned all six requested files without an authorization denial. The current standard Library transfer helper failed for each with exit code 1 and `library file transfer failed: download failed`. One archive transfer with expanded permission also failed.

Independent local DNS diagnostics returned `socket.gaierror: [Errno -3] Temporary failure in name resolution`. This was reproduced under default, expanded, and explicitly network-enabled execution. A control-host lookup failed in the same environment. The local input directory contained zero regular files.

The GitHub connector was subsequently available and is available for publishing this report. Its availability does not materialize the original Library archive or establish the requested source tree. No DNS configuration, trust root, or protection was changed.

## Verification status

- Source checks, native lifecycle models with and without sanitizers, Node protocol/enrollment tests, and the general source checker: **NOT RUN — SOURCE UNAVAILABLE**.
- Repository `.agents/skills` for the required archived baseline: **NOT READ — SOURCE UNAVAILABLE**.
- Windows compilation/linking and real process, pipe, Job, WTS, ACL, and filesystem qualification: **NOT RUN**. The local environment was Linux.
- Previous snapshot test counts are not results for this task.

The source-access diagnostics comprised file preparation, failed transfer attempts, DNS diagnostics, and the empty-input check. They are access diagnostics, not tests of METAENGINE behavior.

## Review gates once source is available

Independent requirements reviews identified these acceptance gates; none is a claim about the unavailable implementation:

- Track effect outcome, physical settlement, and durable barrier state separately. `DISPATCHED`, cancellation requested, worker joined, or an empty Job must not be treated as proof that Main never ran.
- Bind settlement to the original attempt, worker, requester/token, process/thread, Job descendants, outstanding I/O, and protected barrier identity. Do not reconstruct authority from a PID.
- Fence cancellation, completion, restart, update, and rollback by operation generation. An old completion must not clear a newer attempt's barrier.
- Keep HOLD/UNKNOWN after ambiguous dispatch, a lost reply, crash, or uncertain durable transition. Physical quiescence alone cannot undo or disprove an earlier external effect. Do not automatically relaunch or replay an unknown effect.
- Require the original authoritative completion/recovery handoff before resolving the barrier, with revocation, physical join, protected file identity, and qualified durable transition semantics.
- Test cancellation on both sides of dispatch, late completion, concurrent stop, failed join, surviving Job descendants, crash without original handles, stale generations, lost replies, and fault injection at durable write/flush/readback/finalization.

## Scope and continuation

No Main launch, installation, user-PC change, database mutation, new trust root, or protection weakening was performed. This report advances no implementation or readiness acceptance criterion.

Continuation requires authorized materialization of the original bytes, SHA256 verification, the four patches in order, exact resulting-tree verification, repository instruction review, implementation, and actual tests. Windows guarantees require separate isolated Windows qualification. Missing source must remain a blocker; another baseline or a synthetic success flag cannot replace it.
