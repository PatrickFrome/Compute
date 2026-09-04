# Browser Guardian Durable Owner Enrollment Architecture V1

## Status

Decision record for the first durable `expected_owner_sid` adapter after the proven named-pipe / impersonated-token evidence boundary and the pure CAS planner.

This slice is deliberately narrower than WTS/session execution. It creates one machine-local immutable owner record only when the record is absent. It never replaces an existing owner, never persists a transient Windows session id, never launches a process, never changes SCM state, never mutates the Browser effect journal, and never introduces a timer/retry scheduler.

## Decision

Use a native Windows store under `%ProgramData%\METAENGINE\Guardian\owner-enrollment-v1.record` with these properties:

1. The root directory must already exist and resolve exactly to the expected ProgramData path. This store does not create or repair the root.
2. Root and record are opened as handles; reparse state, final path, owner and DACL are verified from the opened object. Owner must be LocalSystem or Builtin Administrators and low-privilege principals must not have write-like rights.
3. The record is staged in the same directory with an explicit SYSTEM+Administrators DACL and `CREATE_NEW | FILE_FLAG_WRITE_THROUGH`.
4. The staged payload is flushed with `FlushFileBuffers`.
5. Commit is `MoveFileExW(..., MOVEFILE_WRITE_THROUGH)` without `MOVEFILE_REPLACE_EXISTING`. If the final record exists, the write loses the CAS race and the winner is classified from readback instead of overwritten.
6. Strict post-commit readback must match owner SID and both provenance hashes before this caller can claim its commit succeeded.
7. Durable identity is the canonical Windows SID plus immutable enrollment/device evidence hashes. `TokenSessionId` remains an observation and is never persisted as owner identity.

This is a create-if-absent CAS, not a general-purpose database and not an effect journal.

## Why not reuse the generic Node durable JSON helper

The existing helper is useful for its current journal domains, but its Windows path performs rename and final-file flush while intentionally reporting `directory_synced=false`. Enrollment additionally needs fail-if-exists commit semantics, machine ACL/final-path verification, and a native write-through move. Reusing the generic helper would broaden its authority and make enrollment depend on semantics it does not currently promise.

## Why not TxF, Registry, or SQLite in V1

- **Transactional NTFS (TxF):** Microsoft discourages new use and documents simpler alternatives. Guardian needs an even smaller state transition: create-if-absent with no replacement.
- **Registry:** it can hold machine state, but a multi-field record is easier to reason about as complete-or-absent when committed as one bounded file, with the same file ACL/final-path readback model already used by Guardian machine bootstrap.
- **SQLite:** its atomic commit model is excellent, but a database engine is unnecessary operational surface for one immutable record. Reconsider it only if Guardian gains multiple correlated mutable records that truly require transactions.

## External analog and design matrix

| System / source | Useful property | METAENGINE consequence |
| --- | --- | --- |
| Microsoft `CreateFileW` | `CREATE_NEW` is an OS-enforced fail-if-exists primitive | Use OS CAS instead of pre-check-then-write |
| Microsoft `MoveFileExW` | write-through move exists; replacement is a separate flag | Commit same-directory stage with write-through and no replace |
| Microsoft `FlushFileBuffers` | explicit file-buffer flush boundary | Flush staged payload before positive commit evidence |
| Microsoft `GetFinalPathNameByHandleW` | resolves the opened object | Reject path/reparse escape instead of trusting strings |
| Microsoft security APIs | owner and DACL can be read from the opened handle | Machine trust is handle-bound readback |
| Microsoft TxF alternatives | TxF is not the preferred new design | Avoid a transaction-manager dependency |
| SQLite atomic commit | complete transaction or rollback | Preserve complete-or-absent state semantics |
| Consul KV transactions | `cas` / `check-not-exists` | Treat absence as a commit precondition |
| Redis `WATCH` | optimistic locking detects changed state | Concurrent winner causes readback, not overwrite |
| FoundationDB transactions | optimistic conflicts fail at commit | Exact-current-state proof belongs at commit boundary |
| CockroachDB serializable transactions | conflicts are explicit transaction failures | Classify conflict separately from effect replay |
| Kubernetes controllers | level-triggered desired/current reconciliation | Re-read durable owner and keep controller narrow |
| AWS State Manager | declared-state drift correction | Later trust-root provisioning should be declarative/readback-based |
| NixOS generations | declarative, versioned system state | Prefer immutable/versioned machine artifacts |
| Docker restart policies | warns against competing process managers | Do not create a second restart scheduler |
| Nomad restart policy | bounded attempts and escalation | Recovery intensity is policy, not an unbounded loop |
| Fly Machines restart policy | explicit bounded retry modes | Keep restart authority separate from persistence |
| DBOS transactions | app state and durable workflow progress can be coupled | If Guardian grows multi-record state, couple state/effect receipt instead of adding journals |
| Cadence workflows | durable state survives worker restarts; retry is explicit | Durable intent and retry authority remain explicit |
| ZooKeeper recipes | large coordination patterns are built from small primitives | Prefer small auditable primitives over monolithic coordination |
| TUF | rollback/freeze resistance | Provenance/freshness fences belong before promotion |
| Uptane | compromise-resilient update architecture | Keep recovery/update authority separate from Browser/page authority |
| Sigstore | identity + signature + transparency verification | Bind evidence hashes to independently verifiable identity evidence |
| SLSA | signed provenance and hardened builds | Retain exact-build provenance for native Guardian artifacts |
| OCI descriptors | digest + size are content-identity fences | Preserve digest-bound exact artifacts/readback |
| in-toto | signed step metadata binds materials/products | Treat build/install transitions as typed attestable steps |
| OpenTelemetry events | structured lifecycle event model | Emit typed reconciliation/effect transitions, not free-form-only logs |
| Raft | safety benefits from decomposition and reduced state space | Keep owner enrollment a tiny state machine |
| Litestream | replication can be an external concern | Never embed a backup/replication loop in Guardian by default |
| Google Omaha | privileged machine updater is separated from UI/client concerns | Preserve user-evidence vs LocalSystem-authority split |

## Sources

- https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-createfilew
- https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-movefileexw
- https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers
- https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew
- https://learn.microsoft.com/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo
- https://learn.microsoft.com/windows/win32/fileio/deprecation-of-txf
- https://www.sqlite.org/atomiccommit.html
- https://developer.hashicorp.com/consul/api-docs/txn
- https://redis.io/docs/latest/develop/using-commands/transactions/
- https://apple.github.io/foundationdb/developer-guide.html#transactions
- https://www.cockroachlabs.com/docs/stable/transactions
- https://kubernetes.io/docs/concepts/architecture/controller/
- https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-state.html
- https://nixos.org/manual/nixos/stable/
- https://docs.docker.com/engine/containers/start-containers-automatically/
- https://developer.hashicorp.com/nomad/docs/job-specification/restart
- https://fly.io/docs/machines/guides-examples/machine-restart-policy/
- https://docs.dbos.dev/typescript/tutorials/transaction-tutorial
- https://cadenceworkflow.io/docs/concepts/workflows
- https://zookeeper.apache.org/doc/current/recipes.html
- https://theupdateframework.io/security/
- https://uptane.org/
- https://docs.sigstore.dev/cosign/verifying/verify/
- https://slsa.dev/spec/v1.0/levels
- https://github.com/opencontainers/image-spec/blob/main/descriptor.md
- https://in-toto.io/
- https://opentelemetry.io/docs/specs/otel/logs/event-api/
- https://raft.github.io/raft.pdf
- https://litestream.io/how-it-works/
- https://github.com/google/omaha

## Next slices

1. Provision/repair `%ProgramData%\METAENGINE\Guardian` as a **typed machine-state effect** through the existing Guardian effect/journal authority, with owner/DACL/final-path readback. The owner store itself stays unable to repair its trust root.
2. Wire proven enrollment evidence + pure planner + native store behind the SCM host, preserving create-if-absent semantics and an explicit owner-replacement protocol.
3. Only after durable owner readback exists, add non-blocking `SERVICE_CONTROL_SESSIONCHANGE` notification + startup reconciliation into the existing controller path.
4. Only after that, allow one journal-gated WTS broker attempt for exactly one ACTIVE session matching the durable SID. No timer-driven retry scheduler is introduced.
