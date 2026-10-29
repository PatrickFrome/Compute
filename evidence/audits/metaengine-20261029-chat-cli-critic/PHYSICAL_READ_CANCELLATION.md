# Cancel in-flight native admission observations

The seed service now forwards its private Host request context to individual
and batched native scope readers as a fourth argument. The existing third SQL
reader argument remains unchanged, preserving transaction/pool ownership.
The native scope checks cancellation/deadline before common reads, before each
agent, and after awaited physical reads. AbortSignal reaches Windows process
inventory, kernel boot inventory, protected operator/sandbox ACL reads, Git
rev-parse, and sandbox log streams. Cancellation never authorizes retry or
turns a dispatched SQL effect into a proven rejection.

Four regressions reproduced before the change. The focused suites pass 73 tests
with two Windows-only skips (75 total). Real disposable PostgreSQL seed admission
passes 17/17 including cancelled observation leaving no tasks/permits. Source
checks pass 244/244. Windows-native command execution itself remains unqualified
here; test doubles and portable child termination are not installed proof.

Cancellation diagnostics use fixed REQUEST_CANCELLED/REQUEST_DEADLINE_EXCEEDED
codes, never raw abort reasons, SQL, credentials or command stderr.
