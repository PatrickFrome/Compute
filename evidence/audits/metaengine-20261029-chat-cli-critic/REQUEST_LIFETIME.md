# Native seed request lifetime

Base: 49cef0a0b7c5e81cd5db9caa18255e16c5ace5bc. Its history includes all
15 published recovery fixes ending3d6e3b9a.

The real IPC server already aborted a timed-out row, but the Host authority
and authenticated seed binding discarded its context, and the seed service
never checked it before later SQL dispatch. A timed-out write must remain
UNKNOWN at the transport, but it must not start a new admission effect after
its private request lifetime expired.

Changes preserve the same AbortSignal through authority and authenticated
binding, add a server-owned deadline, and check cancellation before entry,
after awaited observation and immediately before admission SQL. No signed
payload field can extend the private deadline. Post-dispatch uncertainty still
requires durable readback; no automatic retry or optimistic absence is added.

Four regressions failed before: pre-cancelled service invocation, cancellation
during physical observation, context loss through authenticated binding, and
pre-cancelled binding invocation. Focused suite after fixes:71pass0fail, including
real child-process IPC deadline delivery and authority context forwarding.

This slice does not yet interrupt every individual native PowerShell read or
eliminate repeated ACL checks. It does not prove the installed .225 request's
outcome, actual agent work, or the whole chat/CLI/critic cycle. User PC was not
modified. Windows VM is cancelled by user.
