# Browser Guardian Durable Owner Enrollment Architecture V1

## Status

Decision record for the first durable `expected_owner_sid` adapter after the proven named-pipe / impersonated-token evidence boundary and the pure CAS planner.

This slice is deliberately narrower than WTS/session execution. It creates one machine-local immutable owner record only when the record is absent. It never replaces an existing owner, never persists a transient Windows session id, never launches a process, never changes SCM state, never mutates the Browser effect journal, and never introduces a timer/retry scheduler.

The final V1 commit shape is based on a real `windows-2025` runtime CAS test, not only source inspection or successful compilation. An earlier handle-relative rename variant compiled cleanly and passed adversarial source contracts but failed at runtime with `ERROR_INVALID_PARAMETER (87)`. The runtime gate is therefore part of the architecture contract.

## Decision

Use a native Windows store under `%ProgramData%\METAENGINE\Guardian\owner-enrollment-v1.record` with these properties:

1. The root directory must already exist and resolve exactly to the expected ProgramData path. This store does not create or repair the root.
2. Root and record security are verified from opened handles: no reparse point, exact final path, machine-trusted owner, and no write-like DACL grants to non-machine principals.
3. A verified root handle is held for the full read/CAS/commit/readback transaction **without `FILE_SHARE_DELETE`**. The trust root therefore cannot be renamed or deleted through another compatible open while this transaction relies on its identity.
4. The record is staged in that same verified directory with an explicit SYSTEM+Administrators DACL, `CREATE_NEW`, `FILE_FLAG_WRITE_THROUGH`, and no sharing.
5. The staged payload is fully written and flushed with `FlushFileBuffers` before the commit barrier.
6. Commit is performed from the still-open stage handle with `SetFileInformationByHandle(FileRenameInfo)`, `RootDirectory=NULL`, an absolute final path underneath the still-fenced verified root, and `ReplaceIfExists=FALSE`. A concurrent winner therefore produces a CAS conflict; it is classified by exact readback and is never overwritten.
7. Strict post-commit readback must match owner SID and both provenance hashes before this caller can claim its commit succeeded.
8. Durable identity is the canonical Windows SID plus immutable enrollment/device evidence hashes. `TokenSessionId` remains an observation and is never persisted as owner identity.
9. Exact-head Windows CI must execute the native CAS against a real machine-secure `%ProgramData%\METAENGINE\Guardian` root and prove first-commit, same-owner level-triggered readback, and different-owner fail-closed behavior.

This is a create-if-absent CAS, not a general-purpose database and not an effect journal.

## Security correction: path validation is not commit authority

The first implementation validated the root from an opened handle but then closed that handle and later committed with path-based `MoveFileExW`. It also opened the root with `FILE_SHARE_DELETE`. That was insufficient: on Windows, delete access can be used to rename an object, and `FILE_SHARE_DELETE` permits compatible opens requesting delete access. A checked directory could therefore have changed identity after validation but before the path-based commit.

The corrected contract keeps the verified root object alive without delete sharing across the complete transaction. The destination path is resolved while that root object remains pinned, and the rename is initiated from the exclusive staged-file handle. String paths are assertions and names; the no-delete-share root handle is the identity fence.

### Why the final V1 does not use `FILE_RENAME_INFO.RootDirectory`

Microsoft documents `RootDirectory` as `NULL` in the common case and allows a directory handle when `FileName` is relative. The first hardened implementation followed that documented relative form. On the actual GitHub-hosted Windows Server 2025 runner, however, the exact native probe returned `ERROR_INVALID_PARAMETER (87)` on the first commit despite `/W4 /WX` compilation and all source contracts passing.

The gate was not weakened. V1 now uses the documented common form: `RootDirectory=NULL` plus an absolute destination path, while keeping the separately verified root handle alive without `FILE_SHARE_DELETE` across the entire transaction. This preserves the root-identity fence and gives us a behavior demonstrated by the real Windows runtime test.

This is the same architectural rule used elsewhere in Guardian: validate identity from an OS object, retain the relevant incarnation/lease through the effect boundary, and classify conflicts from readback rather than guessing or retrying.

## Durability boundary

The store intentionally does not claim filesystem-wide crash guarantees stronger than Windows documents for the selected primitives. The staged file uses `FILE_FLAG_WRITE_THROUGH`, receives an explicit `FlushFileBuffers`, and its metadata rename is issued from that still-open write-through handle. Success still requires exact post-commit readback.

If future requirements demand a formal power-loss guarantee spanning several correlated records, the design should move to a storage engine with a documented transactional durability model rather than layering another custom journal around this file. SQLite's atomic-commit protocol is the reference threshold for that future decision.

## Why not reuse the generic Node durable JSON helper

The existing helper is useful for its current journal domains, but its Windows path performs rename and final-file flush while intentionally reporting `directory_synced=false`. Enrollment additionally needs fail-if-exists commit semantics, machine ACL/final-path verification, a root-identity lease across the commit, and exact post-commit classification. Reusing the generic helper would broaden its authority and make enrollment depend on semantics it does not currently promise.

## Why not TxF, Registry, or SQLite in V1

- **Transactional NTFS (TxF):** Microsoft recommends alternatives rather than creating new dependencies on TxF. Guardian needs an even smaller state transition: create-if-absent with no replacement.
- **Registry:** it can hold machine state, but a multi-field record is easier to reason about as complete-or-absent when committed as one bounded file, with the same file ACL/final-path readback model already used by Guardian machine bootstrap.
- **SQLite:** its atomic commit model is excellent, but a database engine is unnecessary operational surface for one immutable record. Reconsider it only if Guardian gains multiple correlated mutable records that truly require transactions.

## External analog and design matrix

| System / source | Useful property | METAENGINE consequence |
| --- | --- | --- |
| Microsoft `CreateFileW` | share flags remain effective for the lifetime of an open handle; fail-if-exists creation is OS-enforced | Keep a no-delete-share trust-root handle alive through the transaction |
| Microsoft `FILE_RENAME_INFO` / `SetFileInformationByHandle` | `ReplaceIfExists=FALSE` preserves fail-if-exists; absolute path with `RootDirectory=NULL` is the common documented form | Rename the exclusive staged source handle; do not replace a concurrent winner |
| Microsoft `FlushFileBuffers` / write-through | explicit file-buffer and write-through boundaries | Flush the staged payload before the rename barrier and require readback after it |
| Microsoft `GetFinalPathNameByHandleW` | resolves the opened object | Reject path/reparse escape instead of trusting strings |
| Microsoft security APIs | owner and DACL can be read from the opened handle | Machine trust is handle-bound readback |
| Microsoft TxF alternatives | TxF is not the preferred new design | Avoid a transaction-manager dependency |
| SQLite atomic commit | complete transaction or rollback and explicit durability protocol | If state grows beyond one immutable record, adopt a real transactional store rather than custom multi-file choreography |
| Consul KV transactions | CAS / check-not-exists preconditions | Treat absence as a commit precondition |
| etcd transactions | compare → atomic then/else | Model create-if-absent as one guarded transition, not a pre-check plus overwrite |
| Redis `WATCH` / `SET NX` / `MSETNX` | optimistic conditions and no-partial-write conditional creation | Concurrent winner causes readback, not overwrite |
| FoundationDB transactions | unknown commit result can duplicate non-idempotent effects on blind retry | Ambiguous outcomes must reconcile before replay |
| CockroachDB serializable transactions | conflicts can become explicit retry errors | Classify conflict separately from effect replay |
| Kubernetes controllers | desired/current control loops with narrow controllers | Build Guardian as level-triggered reconcilers with narrow adapters |
| AWS State Manager | declared desired state and drift correction | Machine-root provisioning should be declarative/readback-driven |
| NixOS generations | declarative, versioned state and rollback | Prefer immutable/versioned machine artifacts and explicit promotion |
| Docker restart policies | warns against combining restart policy with another host process manager | One recovery owner only; no second restart scheduler |
| Nomad restart policy | bounded attempts/interval and explicit failure mode | Recovery intensity is explicit policy, never an accidental infinite loop |
| Fly Machines restart policy | bounded `on-failure` retry budget | Encode retry budget where retry is actually safe |
| DBOS durable transactions | durable progress can be coupled to application state | If Guardian gains correlated mutable state, couple state/effect receipt instead of adding ledgers |
| Cadence workflows | durable history survives worker failure; retry is explicit | Durable intent and retry authority remain explicit |
| Dapr Workflow | durable retry state survives process restarts | Recovery policy belongs to a durable controller, not ad-hoc local timers |
| ZooKeeper recipes | coordination is assembled from small auditable primitives | Prefer small primitives over monolithic coordination |
| TUF | rollback/freeze and arbitrary-update resistance | Provenance and freshness fences belong before promotion |
| Uptane | compromise-resilient update architecture | Keep recovery/update authority separate from Browser/page authority |
| Sigstore | identity-bound signing plus transparency evidence | Bind release/evidence hashes to independently verifiable signer identity |
| SLSA | provenance and hardened hosted-build levels | Strengthen builder trust while retaining exact-build provenance |
| OCI descriptors | digest + byte size are content-identity fences | Preserve digest-and-size-bound artifacts/readback |
| in-toto | step metadata binds authorized materials/products | Treat build/install transitions as typed attestable steps |
| OpenTelemetry | structured lifecycle telemetry data model | Emit typed reconciliation/effect transitions, not free-form-only logs |
| Raft | safety improves when state transitions and invariants are explicit | Keep owner enrollment a tiny explicit state machine |
| Litestream | replication can remain an external concern | Do not embed backup/replication scheduling inside Guardian by default |
| Google Omaha | machine updater authority is separated from user client concerns | Preserve user-evidence vs LocalSystem-authority split |

## Architecture conclusions from the research

The qualitative jump is not a larger autonomous loop. It is a smaller trusted computing base with stronger evidence boundaries:

- **Handle/incarnation-bound trust:** security-sensitive authority must retain the verified OS object or incarnation through the effect boundary. A validation performed earlier is not a lease.
- **Runtime proof over API-shape assumptions:** source contracts and `/W4 /WX` compilation are necessary but insufficient for security-sensitive Win32 paths. Every new native effect primitive needs an exact-head runtime probe on the supported Windows image.
- **Level-triggered reconciliation:** planners consume durable desired/current state and emit bounded candidates; they never own retry loops or physical effects.
- **One typed effect ledger:** PROCESS, MACHINE_COPY, SCM_CONFIG and future machine-root provisioning remain domains of the existing Guardian journal. Owner enrollment is immutable configuration state, not a second execution ledger.
- **Ambiguity is a state:** after a non-idempotent effect barrier, recovery proves exact positive effect or `NO_EFFECT`; it does not infer success from generic booleans and does not timer-retry `AMBIGUOUS`.
- **Single recovery owner:** SCM/native recovery owns service restart. A second Browser/task/process-manager loop is prohibited because competing recovery managers create conflicting state machines.
- **Artifact identity is transitive:** exact source → hosted build provenance → release digest/size → installed digest/readback should be one verifiable chain. Sigstore/SLSA/in-toto/TUF/Uptane can strengthen this beyond today’s GitHub-bound evidence without changing Guardian authority.
- **Externalize replication and observability:** telemetry, backup, and audit export may observe durable transitions, but they do not become scheduling or effect authority.

## Sources

- https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-createfilew
- https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle
- https://learn.microsoft.com/windows/win32/api/winbase/ns-winbase-file_rename_info
- https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers
- https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew
- https://learn.microsoft.com/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo
- https://learn.microsoft.com/windows/win32/fileio/deprecation-of-txf
- https://www.sqlite.org/atomiccommit.html
- https://developer.hashicorp.com/consul/api-docs/txn
- https://etcd.io/docs/v3.6/learning/api/
- https://redis.io/docs/latest/develop/using-commands/transactions/
- https://redis.io/docs/latest/commands/set/
- https://redis.io/docs/latest/commands/msetnx/
- https://apple.github.io/foundationdb/developer-guide.html#transactions
- https://www.cockroachlabs.com/docs/stable/transactions
- https://kubernetes.io/docs/concepts/architecture/controller/
- https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-state.html
- https://wiki.nixos.org/wiki/Nixos-rebuild
- https://docs.docker.com/engine/containers/start-containers-automatically/
- https://developer.hashicorp.com/nomad/docs/job-specification/restart
- https://fly.io/docs/machines/guides-examples/machine-restart-policy/
- https://docs.dbos.dev/typescript/tutorials/transaction-tutorial
- https://cadenceworkflow.io/docs/concepts/workflows
- https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-features-concepts/
- https://zookeeper.apache.org/doc/current/recipes.html
- https://theupdateframework.io/docs/security/
- https://uptane.org/docs/2.0.0/standard/uptane-standard
- https://docs.sigstore.dev/cosign/verifying/verify/
- https://slsa.dev/spec/v1.2/
- https://specs.opencontainers.org/image-spec/descriptor/
- https://in-toto.io/docs/getting-started/
- https://opentelemetry.io/docs/specs/otel/logs/data-model/
- https://raft.github.io/raft.pdf
- https://litestream.io/how-it-works/
- https://github.com/google/omaha

## Next slices

1. Provision/repair `%ProgramData%\METAENGINE\Guardian` as a **typed machine-state effect** through the existing Guardian effect/journal authority, with owner/DACL/final-path readback. The owner store itself stays unable to repair its trust root.
2. Wire proven enrollment evidence + pure planner + native store behind the SCM host, preserving create-if-absent semantics and an explicit owner-replacement protocol.
3. Only after durable owner readback exists, add non-blocking `SERVICE_CONTROL_SESSIONCHANGE` notification + startup reconciliation into the existing controller path.
4. Only after that, allow one journal-gated WTS broker attempt for exactly one ACTIVE session matching the durable SID. No timer-driven retry scheduler is introduced.
