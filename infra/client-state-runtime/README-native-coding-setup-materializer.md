# Native setup materializer consumer

Base: `0e43a569ad52134bee65dea3182ee9a4c4bbc56f`, tree
`897948a6e65c980f560f97b71abaca96c91e4069`.

`createNativeCodingSetupMaterializer` consumes the existing managed project
command adapter. It performs `PROJECT_CREATE`, using the same canonical effect
key, durable journal, admission resolver and locked Git worktree implementation.
It does not allocate tasks or leases, launch a model, publish permits, construct
sandbox evidence, or report execution readiness. Original receipts remain in
the existing journal. A partial effect stays `AMBIGUOUS`; a lost terminal ACK is
recovered through the original receipt, without another Git add.

The setup service supplies a recursively frozen private worker scope containing
`operation_id`, `custody_id`, original `input`, authenticated `actor`, discovery
`observation`, cancellation `signal`, and `revalidate()`. That last function
performs fresh current-device/repository, own-PG17, filesystem and durable
custody checks through short SQL phases. It is not an Owner or lease proof.

## Main producer contract — pending

Main must bind the following constructor dependencies in private code. None is
a JSON/IPC request field or a new authority root:

- `readAdmittedRequest(scope)` selects **only** the request retained for this
  exact original signed setup operation and authenticated principal. Return
  `null` when it has not been admitted, otherwise
  `{request, source: {head, artifact_sha256}}`. `request` uses the existing
  `normalizeManagedProjectAuthorityRequest` fields: `idempotency_key`,
  `coordination_workspace_id`, `task_id`, `agent_id`, `claim_id`,
  `lease_generation`, `workspace_id`, `workspace_generation`. The source pin
  must come from the existing approved source observation; current HEAD alone
  cannot create approval. The consumer replaces the caller's idempotency key
  with the existing `managedProjectEffectKey`.
- `resolveProjectBinding(request)`, `journal`, `reserveBinding`, and
  `finalizeBinding` must be the existing own-PG admission and durable managed
  project components. The admission must belong to `scope.actor` and the exact
  registered repository. The consumer rechecks it at the physical boundary.
- `withOwnerCustody({scope, request, source}, effect)` must retain the existing
  native Main Owner custody until `effect` has joined. Invoke `effect` once,
  passing a synchronous `assertOwnerCurrent()` that throws on stop, replacement
  or lost custody and otherwise returns `undefined`. This is the actual custody
  closure, not a saved readback, boolean, `verified` flag or a new signature.
  Repeated, late, missing and asynchronous assertions are refused. The consumer
  independently joins any callback already started, including on lost ACK.
- `readSource({repo_root, signal})` must use the existing protected source/Git
  observer. Its `head`, `artifact_sha256`, and `clean` observation must match the
  retained source pin immediately before the fixed physical effect. Lease
  expiry and current local Owner custody are checked synchronously afterward.
- `executePlan(plan, {signal}?)` accepts only the existing fixed Git plans. It
  must join all native resources it starts on success, error and cancellation.
  If cleanup cannot be confirmed, it must preserve the private physical HOLD
  through `markNativePhysicalSettlementUnconfirmed`. The consumer selects no
  default executor. The current `createShellFreeGitExecutor` joins a child, but
  does not prove Windows descendant/Job Object settlement. Its use in generated
  Git fixtures is not installed Windows qualification.

The consumer uses the existing command adapter's `RESERVED` write-ahead barrier
before a mutation. Fresh admission, setup scope and source reads precede the
synchronous Owner assertion and the fixed Git create. No SQL transaction is
held across the long physical job. Cancellation permits readback inventory of
an already-started effect; it cannot authorize a second mutation.

## Default composition — still blocked

`runtime-host.mjs` currently receives neither an original Main-owned setup
admission selector nor a Main Owner custody capability nor a Windows executor
with joined descendant evidence. The setup BEGIN contract contains only the
operation/workspace and discovery hashes. The protected operator and workspace
stage files also contain no task/claim selector. Consequently default `runJob`
remains unbound. Mounting this consumer without those producers would invent
authority. Missing admission returns `EVIDENCE_REQUIRED`; it does not create
fake materialization or a prepared result.

Historical durable settlement/capacity release is owned by a separate workstream.
This change neither fabricates its proof nor releases ambiguous physical history.

## One-use original-job drain handoff

The returned `runJob` function has two **private constructor facets**, never IPC
actions: `takeJobDrain(originalScope)` and
`consumeJobDrain(token, originalScope, consumer)`. There is no public mint, no
identifier-only seal, and no serialized cleanup/readiness proof.

The optional native producer is `executePlan.joinOriginalDrain(original, job)`
on the very same constructor-bound executor function. The factory captures this
method once at construction. `original` is the actual object returned or thrown
by that executor invocation; `job` is the identical original frozen Host worker
scope. A producer must use its own private native registry to refuse a clone,
foreign result, identifier-only reconstruction or different job. Every native
invocation receives `originalJob: scope`; the source observer receives that
same private object too. The producer must own the complete original job's
helper/child/Job Object, stdout/stderr consumers, output writes and cancellation
work. Its method resolves with `undefined` only after all those joins, and
rejects/retains physical HOLD for uncertainty. Returned flags or receipt objects
are refused. The existing Git executor provides **no such facet**. Generated
test doubles exercising this interface remain explicitly unqualified.

After existing adapter effects, readback, journal/finalize and Owner callback
work have joined, the materializer awaits **all** original native drain calls,
even if another rejects. Any failed/nonempty drain return marks private physical
HOLD. An invocation that only reads an earlier receipt cannot produce a drain
handoff, even if its current inventory reads have a native facet. Re-entering
the same original job cannot mint another proof.

Only then can `takeJobDrain(originalScope)` issue an empty frozen opaque object,
bound through a private WeakMap to the exact original job. First it invokes the
Host's private synchronous `assertJobDrained()` veto, which requires the
original job callback to have finished, its physical custody to be confirmed,
and its independent physical-HOLD scope to be clear. Before service drain or
without the native producer, `takeJobDrain` returns `null`; historical release
must remain **HOLD**. SQL `cleanup_state=DRAINED`, worktree `PROVEN` and producer
`cleanup_confirmed` booleans cannot create the missing capability.

`consumeJobDrain` checks token and original-scope object identity and burns the
token synchronously **before** any consumer callback/await. The service veto is
checked again after burn. A lost ACK, consumer failure or later veto cannot
retry/recreate the token. Cloned/JSON tokens, another factory, equal identifiers
and process restart cannot recover it. The consumer receives only
`{scope, materialization_outcome:'UNKNOWN', automatic_retry_allowed:false,
authority_effect:false}` with the original private scope. A partial effect or
original AMBIGUOUS receipt stays UNKNOWN; physical settlement does not resolve
its outcome or permit replay.

The historical owner must call `sealSetup` **inside this one-use consumer**,
using its own current physical-scope/reviewed-origin checks. Independent original
SQL/IPC callback drain and durable lineage requirements remain separate. This
handoff alone cannot certify those lanes or grant capacity release. Default
runtime composition still has no qualified native completed-job producer, so
default historical setup resolution remains HOLD.
The old identifier-only seal/mint must independently be removed or disabled;
calling that public mint from inside this callback would leave other callers
able to bypass the handoff.

## Required clean-machine installer composition

Clean-machine deployment is mandatory. This consumer cannot depend on an
already installed Guardian, PostgreSQL, Node, Git, CLI, a global package/cache,
or earlier userData. Constructor dependencies are deliberately required; the
consumer creates no fallback executor, observer, tool discovery, credential or
scheduler. Default production mounting remains unavailable until the installer
and native producers below exist. A developer/hosted-runner PATH test or a
generated local fixture does not qualify a clean Windows installation.

The installer must deliver Browser, Guardian, **own PostgreSQL 17**, CLI and the
complete runtime/tool dependency closure through the existing verified release
trust chain. The existing offline runtime bundle layout enumerates Node/Deno/
PostgreSQL; this source contract does not prove delivery by a current release
artifact. It is also no evidence that Git, CLI and Guardian payloads have been
delivered. Their actual verified payloads and required DLL/helper files
must be included by their owning installer/package producers. This contract
adds no alternate signature root or `verified` field.

For this materializer the private installer-to-runtime contract is:

- `executePlan` must be the original native resource owner bound to an absolute
  **installer-owned, release-verified Git executable and complete helper/DLL
  closure**. The plan's logical `executable: 'git'` is a fixed operation label,
  never permission to resolve global PATH. Pin native file identity and expected
  bytes through the existing verified-payload/process-controller path before
  effects. Neither preinstalled Git nor a package manager/download-on-first-use
  fallback is allowed. The generic `createShellFreeGitExecutor()` default uses
  ambient Git and trusts repository hooks: it is a staging adapter, not an
  acceptable clean-machine production binding. Git hooks/filter/fsmonitor/SSH
  helpers must not introduce an executable outside the owned verified closure.
  That generic executor also removes inherited `GIT_*` variables, including
  parent configuration fences; setting a safer parent environment alone does
  not fix it. The actual native owner must construct its fixed environment at
  the spawn boundary, without global/tool discovery.
- `readSource` must bind the **same** verified absolute Git path and the same
  original native resource registry. `readNativeCodingGitProof` has a generic
  `gitExecutable='git'` default; the production binding must explicitly replace
  it. Source reads must not load global/system Git configuration, ambient
  credential helpers, profiles, proxy/module overrides or preinstalled tools.
  Use only the owned Git/helper paths and the necessary Windows OS environment;
  do not inherit executable/module search paths or `NODE_OPTIONS`/`NODE_PATH`.
- Host/observer/helper processes must use the installer's verified absolute
  runtime paths, including the owned Node executable. A protected operator file
  containing an absolute path is configuration, not proof of owned payload
  delivery or file identity. The existing OS observer currently consumes such
  operator Git paths; production composition must additionally bind them to
  the installer-owned verified payload. Its readers cannot borrow a developer
  machine's tools as acceptance evidence.
- The existing own-PG setup discovery must bind to this installation's protected
  configuration, distinct owned PG executable/data directory/port and original
  postmaster identity. Do not discover/adopt a user's installed PG or Guardian,
  modify their data/services, or select them because their binary names match.
  A new installation owns its own paths, service identities and ports. Fresh
  roles/schema/migrations or explicit verified restore and health checks are
  performed by the existing installer/bootstrap producers before admission.
- Generate protected operator/workspace configuration from this new verified
  installation and current device enrollment. Old userData, a copied old
  operator/stage/receipt, a prior Guardian service or an old postmaster cannot
  substitute for current discovery, Owner/source/lease custody or enrollment.
  Keep immutable original receipts for readback; do not adopt their physical
  authority for a new Host generation.
- Installer ordering is verified payload delivery, protected own configuration
  and own DB initialization/migrations, existing authenticated bootstrap/device
  enrollment/component binding, then current health and original private
  admission/Owner/native-drain capabilities. The setup consumer remains
  unavailable/HOLD for any missing producer. External GPT/Codex login and Windows
  UAC remain legitimate user steps; failed/missing login is not automatic
  authorization, prepared state or a successful clean-machine result.

Rollback must join the original owned effects/output/cancellation lanes and
use the installer's original ownership records. It may undo only this
installation's resources and must preserve unrelated PG/Guardian/user data and
all original ambiguous receipts. Unknown effect/cleanup stays UNKNOWN/HOLD;
neither a terminal SQL row nor a failed clean-machine installation permits
automatic replay or historical capacity release.

Real acceptance requires a disposable Windows image with documented absence
of METAENGINE services/config/data and no reliance on preinstalled Node/Git/CLI/
Guardian/PostgreSQL or old userData. Restrict executable/module search to the
owned verified payloads and required Windows OS components; verify the actual
process/helper paths, owned services/ports, bootstrap/enrollment, health,
original-job joins and rollback. A hosted runner's installed developer tools,
packaging/unit tests and this stream's Linux staging tests remain separately
labeled. This source contract authorizes no installation, credential creation,
service creation or OS security change on the user's PC; those actions require
their specific action-time approval.

## Verification

The staging tests use actual disposable Git worktrees and the existing FULL
SQLite journal, with explicitly generated admission/Owner fixtures. They cover
cold materialization, restart readback, changed caller keys, partial creation,
lost ACK, concurrent admission, cancellation/join, fresh source mutation, and
Owner callback lifetime/replay refusal. The PostgreSQL suite creates its own
local PostgreSQL 17 cluster and uses enrolled ES256 requests and the shipped
authority functions; its workers remain generated fixtures. It covers short
SQL phases, lost BEGIN/CLAIM/CANCEL ACK, stop/restart, grant/root/PG changes,
cleanup HOLD, immutable custody context and no replay. Linux results are not
Windows or installed-client results.

Run with an existing PostgreSQL 17 toolchain and postgres.js 3.4.7:

```sh
node --test --test-concurrency=1 \
  infra/client-state-runtime/native-coding-setup-materializer.test.mjs \
  apps/metaengine-browser/test/managed-task-project-runtime.test.mjs \
  apps/metaengine-browser/test/managed-task-project-command-adapter.test.mjs \
  apps/metaengine-browser/test/managed-task-project-host.test.mjs \
  apps/metaengine-browser/test/managed-task-project-sqlite-journal.test.mjs

METAENGINE_PG_TEST_BIN=/path/to/pg17/bin \
METAENGINE_PG_TEST_DRIVER=/path/to/postgres/src/index.js \
  node --test infra/client-state-runtime/native-coding-setup.pg17.test.mjs
```

Do not interpret a skipped PostgreSQL test, a clean source suite, or this
consumer's `cleanup_confirmed` return as installed readiness. The setup service
still enforces its independent private physical-HOLD scope.
