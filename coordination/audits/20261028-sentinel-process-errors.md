# Sentinel asynchronous process errors

Base: c332bf509f430d121f0c4acc4807da276bf116b1.

A real Node subprocess with a nonexistent Sentinel executable terminated with
exit1 and an unhandled ChildProcess error. The surrounding await/start catch
could not catch this EventEmitter error. HostResilience's intended degraded
bootstrap path therefore never received control.

The worker factory now owns error events for every returned child, including
launches without a PID. A WeakSet binds failure to the exact child object.
Snapshot reports PROCESS_ERROR and refuses healthy status even if an earlier
matching heartbeat is fresh. waitUntilHealthy reports a fixed sanitized error
through its existing rejection path. Existing spawn-return/retry authority is
unchanged; no retry, kill, service, or new relaunch path is added.

Evidence:
- Real missing-executable regression failed before (child exit1/unhandled error).
- After: focused Sentinel suite9/9 passes, including fresh-heartbeat negative.
- Related Sentinel/incarnation/HostResilience/recovery suite23/23 passed before
  adding the second test. Full exact-source suite pending.
- Logs in windows-lab/evidence/sentinel-spawn-error-{before,after,focused}.log.

Linux execution only; no current Windows installed-client qualification.
