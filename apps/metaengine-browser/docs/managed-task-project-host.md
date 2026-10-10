# Managed task project host

`main.mjs` installs a single private project host in the Supervisor command
executor, authenticated loopback CLI requests and the dedicated shell product controls.
The host uses the existing device-signed transport for PostgreSQL admission,
repository provisioning and binding receipts. SQLite records local write-ahead
intent and physical Git readback; it does not grant task or lease authority.

Configure the repository with `scripts/configure-managed-project-repository.mjs`.
The owner supplies an existing exact Git root, coordination workspace UUID and
private managed root. Configuration replay must match exactly; renderer commands
cannot provide these roots. An admitted current MUTATING claim and matching fresh
device fleet evidence are required before materialization.

All entry points use the host-owned effect key
`project:<workspace_id>:g<workspace_generation>:l<lease_generation>`, derived by
`managedProjectEffectKey` after strict request normalization. CREATE and OPEN share
this key. A caller-supplied idempotency key is bounded metadata and cannot select
a second durable effect for the same binding. The CLI and product control use the
same helper, and the host recomputes the key regardless of caller behavior.

A repeated command or process restart reads the same SQLite receipt and verifies
the exact locked Git worktree before returning PROVEN. Another claim, task, agent,
repository or binding identity under that key is rejected. Lease renewal within
the same generation is supported. A new lease generation represents a different
effect and requires a separately admitted binding; project ownership transfer is
not implemented by this host.

An intent committed before Git creation with no physical readback requires
explicit reconciliation. Ambiguous effects are frozen instead of blindly retried.
Journals produced by earlier development code under arbitrary caller keys are not
rewritten or silently adopted; their existing worktrees require explicit
reconciliation before use by this key scheme.

The shell controls materialize or open an already registered workspace. They do
not create a new task, mint a claim, expose private filesystem paths, implement
project-wide action history or qualify the installed autonomous client. Host READY
describes the private local storage and journal; fresh signed admission remains
the authority for each requested effect.

The completed source path is local loopback/CLI and dedicated shell IPC. The
standard remote PostgreSQL issuer `h205f22_a2_browser_supervisor_issue_native_v1`
and `CHAT_COMMAND_ACTIONS` still exclude `PROJECT_CREATE` and `PROJECT_OPEN`.
Mounting the shared executor does not make remote queue issuance available.
The existing runtime capability attestation also does not advertise a separate
managed-project feature.

The admission migration is registered in `LOCAL_RUNTIME_MIGRATIONS`, and the
edge route module is included by the default sealed runtime source closure.
That closure follows module imports; it does not include
`local-runtime-migrations.mjs` or its dynamically read migration SQL. Therefore
the default offline runtime package does not distribute or attest the managed
project schema-upgrade tool and SQL bytes. The checked-in migration and disposable
source fixture are not evidence that a deployed or user-owned database has this
schema. Existing databases have not been migrated by this development slice.

Before claiming installed feature readiness, implement and verify a reviewed,
isolated migration packaging and schema-upgrade path, then qualify the installed
client against that prepared schema. The disposable PostgreSQL composition test
already proves route/SQL admission, one real locked Git worktree, durable SQLite
receipt, loopback bearer authentication and host restart. Its remote signed-device
identity remains a synthetic post-authentication fixture; remote signature
verification, deployment and installed-client qualification remain separate.
