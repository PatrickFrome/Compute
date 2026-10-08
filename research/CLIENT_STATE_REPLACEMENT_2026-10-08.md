# Client State Replacement: Research and Progress

Date: 2026-10-08 (Europe/Moscow). Documentation accessed: 2026-10-08.
Baseline checkout: `b5b1e0ee6f1a98bf9911fa1e65d30f6290a38ddf`, with local changes.
This is a sanitized development checkpoint. Private database dumps, row data,
configuration files, credentials and detailed local verification receipts are
not included in this repository document.

Publication is a stacked candidate: `work/client-owned-state-runtime-v1` is
reviewed against `work/client-heartbeat-wire-budget-v1`, not current `main`.
This checkpoint does not claim that the historical heartbeat base is merged,
that this candidate is deployed, or that either branch is production-qualified.
The candidate's PR is excluded at seven historical hosted-probe or installed
hosted-default job boundaries: live health/redemption, installed OIDC enrollment,
package startup, Final runtime startup, package session soak, resident update
rehearsal and dirty-profile startup. Chromium proxy flags alone do not isolate
Node's supervisor transport. Other PRs, historical push branches and explicit
dispatch retain their prior behavior; contract/source-only jobs remain enabled.
No qualification labels or manual live workflows are part of publishing this
candidate. Published CI and installed local qualification remain separate gates.

## Result and Scope

The project can own its state runtime using PostgreSQL 17, a bounded local SQL
API, the existing device-signed supervisor and a client process launcher.
GitHub remains the source, CI and release distribution service. This separates
versioned development artifacts from the running transactional database.

The current implementation replaces the native supervisor's managed database
and HTTP transport dependencies for an explicit local profile. It does not yet
replace every legacy console, daemon, coordination, Auth or Storage caller.
Moving into another managed Supabase project remains paused; local development
does not implicitly resume that migration.

## Why GitHub Actions Is Not the Live Database

Official GitHub documentation defines finite execution, retention and storage
boundaries:

| Boundary | Documented behavior on access date | Architectural consequence |
| --- | --- | --- |
| Hosted job execution | A GitHub-hosted job is terminated after six hours [1] | A job cannot be an indefinitely running supervisor or database service |
| Workflow duration | A workflow run is limited to 35 days, including waiting and approvals [1] | Chaining waits does not create a permanent runtime |
| Hosted filesystem | Standard hosted jobs receive a new VM; the single-CPU runner uses a fresh container [2] | A runner checkout/data directory is not the persistent client database |
| Artifact retention | Default 90 days; configurable public repository retention 1-90 days, private repository retention 1-400 days [3] | Retained artifacts have lifecycle/deletion policy, not a database durability contract |
| Private plan artifact allowance | Free 500 MB, Pro 1 GB, Team 2 GB, Enterprise Cloud 50 GB; minute allowances also depend on plan [1][4] | Repeated state uploads consume finite/billed capacity; they do not remove resource limits |
| Artifact upload | `retention-days` cannot exceed repository/organization/enterprise limits [5] | Workflow YAML cannot bypass the owner's retention policy |

These are public documentation values, not a readback of this repository's
account plan or billing. Public-repository standard runner usage has a different
charging model; no unlimited private artifact storage is inferred.

Artifacts are appropriate for immutable build/test results. PostgreSQL provides
transaction snapshots and concurrency semantics [6] needed by leases, nonce
consumption, admission generations, command completion and receipt persistence.
Uploading a JSON file or dump as an Actions artifact does not make those updates
atomic and does not elect one command authority. A self-hosted runner can reach
an independently owned persistent database, but that database's availability,
backup, access control and lifecycle remain the operator's responsibility.

## Implemented Boundaries

| Component | Repository implementation | Verified boundary |
| --- | --- | --- |
| PostgreSQL API | `infra/client-state-runtime/db-api.mjs`, `db-api-core.mjs`, `db-api-grants.mjs` | Loopback-only HTTP; random launch key; explicit table/RPC allowlists; parameterized values; service-role transactions; bounded bodies and concurrency |
| Supervisor provider | `apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/self-hosted-config.mjs`, `index.ts` | Explicit local mode uses local PostgreSQL/API and retains device signature, nonce, enrollment and SQL authority checks |
| Lifecycle | `infra/client-state-runtime/launcher.mjs` | Owned or qualified attached PostgreSQL; child ownership and instance checks; fail-closed health/process changes; local network scope |
| Client profile | `client-local-provider.mjs`, Browser `native-supervisor-endpoints.mjs`, `explicit-local-supervisor-provider.mjs` | Explicit local endpoint and instance; cloud swaps refused; hosted sentinel omitted; no database/service credentials passed to client |
| Recovery environment | Browser `browser-sentinel.mjs`, `host-resilience-runtime.mjs` | Local identity survives validated recovery environment; bare login registration is held when it would lose the local profile |
| Vault adaptation | `local-vault-compat.sql`, `local-vault-key.mjs` | Local encryption/key lifecycle is explicit; original Supabase Vault source was empty; no claim of decrypting unknown managed ciphertext |
| Evidence | `evidence-archive.mjs`, `backup-verifier.mjs`, `runtime-verification-bindings.mjs` | Private content-addressed archive; measured backup/restore parity; distinct source-bound smoke evidence and loaded-process attestation |
| Legacy UI guard | `apps/me2-ui/src/lib/cloud.ts`, `fallback-console.ts` | Explicit local profile refuses cloud credentials/REST and returns a locked disabled fallback state; local console adapter remains unsupported |
| CI | `.github/workflows/client-state-runtime-contract.yml` | Exact candidate checkout, read-only permissions, pinned actions/Node, Ubuntu and Windows contract tests; no private dump upload |

The native API is a compatibility subset for the current supervisor. It is not
a general SQL endpoint or a full replacement for all PostgREST, GoTrue,
Supabase Storage and Realtime APIs. A local API key remains inside owned server
processes and is not a substitute identity for arbitrary renderers or agents.

## Measured Progress

The completed full snapshot was restored into an isolated local PostgreSQL
instance. All 80 physical source tables and 2,591 rows matched row counts and
deterministic content digests. The original 42 backup files were rechecked
without modification. Restore verification covered 144 application/Auth/
Storage/Realtime/GraphQL function definitions and all 13 policies, rather than
claiming every provider-extension function was identical.

Three declared portability adaptations remain: empty managed Vault replaced by
local pgcrypto; event-trigger ownership moved to the trusted local owner; and
Windows collation verified with explicit English ICU ordering. Three subsequent
local migrations add controller lease, frontier leader fence v2 and ambiguity
reconciliation v3. Their source digests were checked separately. These local
changes are not retroactively attributed to the original dump.

Local verification results completed before this checkpoint:

- Browser regression: 4,379 tests passed, zero failures/skips in the completed run.
- Runtime contracts: 46 tests passed at the recorded checkpoint.
- UI outbound guard: six focused production-body tests passed.
- Local device-signed supervisor smoke: 18 probes passed, including enrollment
  approval, replay/concurrent nonce, timestamp/signature/body/path rejection,
  revoked identities, closed admission and bounded inspection.

These are different test scopes and are not added together as one independent
qualification total. Subsequent startup/source-binding edits need their own
focused verification and receipts. The smoke producer records source/instance
bindings while keeping `process_code_attested:false`; capability health
matches a database capability contract, not every byte loaded into a process.
An installed Electron cold start, useful coding result, independent reviewer,
recovery drill and current published CI remain separate acceptance evidence.
The new workflow is prepared locally; a passing GitHub run for the eventual
published candidate is not assumed.

## Current Development Increment

Persistent owner configuration now loads before endpoint, heartbeat and
entrypoint imports, including bare login, updater successor and crash recovery
starts. Invalid or offline existing configuration remains local and blocks
startup; the provisioner requires an explicit external owner profile. No live
profile or Windows registration was changed. See
`docs/research/electron-local-provider-startup-2026-10-08.md`.

The launcher now records stable source/dependency/binary manifests before and
after startup, binds them to the actual runtime instance and uses a frozen Deno
lockfile with cached-only dependency loading. Server children strip loader
injection settings and unrelated service tokens. The main local cluster was
preserved across owned API/Edge restarts. See
`infra/client-state-runtime/RESEARCH-hardening-2026-10-08.md`.

Verification of this increment: 50 runtime contracts and 74 focused
provider/recovery/publication checks passed. The latest full Browser run passed
4,394 of 4,395 tests; the real Windows capture test timed out under concurrent
machine load. Its isolated rerun passed 36/36 and is recorded separately, not
presented as an all-green full run. That broad run began before the final
publication-guard tests were added; the separate focused run covers those late
additions. Browser syntax passed. Earlier 4,379/4,379 remains evidence
for the earlier checkpoint, not automatic proof of this increment.

The source candidate is published on `work/client-owned-state-runtime-v1`,
stacked on `work/client-heartbeat-wire-budget-v1` (PR #1142). The remote `main`
lineage differs substantially; no implicit merge or restoration of unrelated
project history is performed. GitHub CI results must refer to the published
head and remain distinct from local test observations.

Published head `dfb3d23a9bde7c1119bed628308a326912ebd46c` has a passing Linux
Client State Runtime Contracts job. Windows identified three temporary-fixture
path failures caused by the runner's short-name TEMP prefix; production alias
rejection remains intentionally strict. Corrections canonicalize owned test
roots, not production permissions. The public development receipt records this
initial failed run rather than rewriting its result.

That head's GitHub full Browser job passed 4,404 tests and failed one static
package-reservation assertion that assumed the `needs` line immediately follows
the job name. The local-only job guard changed the line layout, not the
dependency. The assertion now permits intervening job conditions/comments while
still requiring the same preflight dependency; guard tests separately enforce
the exact local-only condition. Test corrections passed 51 runtime contracts
locally and need fresh GitHub results for their own published head.

The existing Critical Audit job also passed exact UI typechecking and modified
UI-boundary lint for that head on GitHub, extending the earlier offline TS
guard checks. The historical R83 cloud canary-equivalence check fails because
this source differs from its deployed pin; that gate remains intact. No
production promotion or hosted deployment is inferred from other green jobs.

The subsequent head `1dd4304aaca88f9f1ea0e840c0dc44821ee3540e` passed
[runtime contracts on both Windows and Linux](https://github.com/PatrickFrome/Compute/actions/runs/37711625979)
for the PR, with a separate
[successful push run](https://github.com/PatrickFrome/Compute/actions/runs/37711621674).
Its [full Browser job](https://github.com/PatrickFrome/Compute/actions/runs/37711625943/job/113098712933)
passed 4,405 tests, zero failures and zero skips. The same run's
[UI quality](https://github.com/PatrickFrome/Compute/actions/runs/37711625943/job/113098713018)
and [focused authority contracts](https://github.com/PatrickFrome/Compute/actions/runs/37711625943/job/113098713045)
jobs passed. The
[historical cloud canary-equivalence job](https://github.com/PatrickFrome/Compute/actions/runs/37711626022/job/113098615299)
still fails its deployed-v14 source-equivalence step and remains unchanged.
These results qualify their exact source head, do not inherit the earlier
signed local smoke's head binding, and do not qualify later packaging changes.

## Next Increment: Source Packaging and Goal Protocol

The next prepublication worktree increment adds a bounded
[source/dependency staging tool](../infra/client-state-runtime/README-packaging.md).
It requires an independently pinned startup-source digest, preserves the exact
reviewed entrypoint closure and frozen Node PostgreSQL dependency, and rejects
private artifacts, unexpected files, aliases and changed bytes. Its fixture
imports the staged launcher/API outside the checkout without starting them.
The historical running instance's receipt correctly rejects the subsequently
changed `package.json`; no fresh physical bundle is attributed to that receipt.
This is not a portable binary runtime or a reviewed installed release.

Official Electron documentation distinguishes its resources directory from the
ASAR virtual archive [9][10]. Runtime working directories and executable
children require real filesystem resources. PostgreSQL's `pg_config` exposes
separate executable, library, extension and shared-resource directories [11],
with dependencies determined by build options [12]. Their binary closure and
the Deno dependency cache still require independent packaging qualification.

A new [opt-in goal fixture](../infra/client-state-runtime/README-goal-verification.md)
creates its own PostgreSQL cluster, verifies the pinned private dump, restores
schema only and confirms all 81 resulting tables are empty before synthetic
seeding. It never accepts an external database/supervisor URL or copies source
rows, role passwords or the installed profile. Real local API/Edge processes
then exercise signed goal submit, progress and negative execution-proof
readback, durable journal reload, lost-response reconciliation, scope/ID fences
and intent-collision rejection. Two synthetic tasks remain READY at lease
generation zero; no execution, claims, commands or runtime-control rows are
produced. The temporary owned processes and marked data directory are removed.
Four tests including this real fixture passed, recording 14 probes. This is
`ISOLATED_SCHEMA_FIXTURE_SMOKE`, not deployed-client qualification or useful
coding. Recovery reads the original request ID and never resubmits; universal
HTTP submission replay idempotency is not inferred.

The persistent-provider bootstrap now excludes exactly the five existing
non-runtime entrypoint modes (version, profile, goal-journal, singleton and
self-update smoke). They do not read the owner/runtime files, change provider
environment or probe health. Normal, updated and runtime-smoke starts remain
fail-closed, including lookalike diagnostic flags. The shared legacy UI SQL
query helper also rejects an explicit local provider before contacting the
unrelated Pigsty pool. No current UI consumer of `fleet-plane.ts` was found;
this is a dormant-library safeguard, not a claim of previously live unsigned
enqueue traffic. A signed local console adapter remains unfinished.

Local verification for this increment: 83/83 runtime contracts and 20/20
provider/UI guard checks passed. The latter production-body checks include
eight UI tests and 12 persistent-provider tests. The real fixture's three
configuration/cleanup guards also occur in the runtime total and are not
counted as separate independent coverage. Independent review found no blocking
issue in the changed guards or source staging. Full local UI typechecking was
unavailable because this checkout has no installed UI dependencies; current
GitHub UI quality results above apply only to their recorded earlier head.
Fresh published-head CI is required. Neither hosted database nor the installed
client/profile was changed. The pre-singleton normal boot health check, binary
release integration and automatic local stack startup remain open gates.

## Remaining Dependencies and Order

1. Complete client installation/startup qualification. Preserve existing device
   identity and user data, bind one runtime instance and source candidate, and
   establish the installed client's signed health/result readback before
   claiming that the user's live client switched successfully.
2. Port daemon evidence and SQL mirror boundaries. `apps/me2-daemon/evidence.ts`
   still expects Supabase management DDL, REST and Storage; `src/sqlmirror.ts`
   and `src/supabase-jwt.ts` still expect hosted mirror/Auth channels. The private
   evidence archive exists but is not automatically an outbox delivery adapter.
3. Add necessary signed console/bridge adapters. `apps/me2-ui/src/lib/cloud.ts`
   is held in local mode; `coordination/chat-control-plane/daemon/server.mjs`
   and `receipt-recorder.mjs` still use service-key REST/RPC. Holding unsupported
   paths avoids remote fallback but is not a feature-complete local console.
4. Resolve optional gateway-secret retrieval and coordination readers.
   `apps/me2-daemon/providers.ts` has a Supabase secret-RPC fallback;
   `coordination/read-plane/fingerprint.py` and `coordination/coordination-ci/digest.py`
   expect Storage objects. Use scoped local readers and existing owner key
   sources; do not distribute the server API key or dump private evidence to CI.
5. Replace active hosted qualification/recovery workflows only after defining
   the matching self-hosted evidence producer. Historical R83 manifests remain
   immutable; additional/removed/current imports require fresh qualification.
   Generic regression success does not authorize production promotion.

Database backups do not include the bytes of Storage API objects [7]. The current
source had zero users, buckets, objects and Vault secrets, which is a measured
empty source rather than a reason to assume future Storage/Auth can be omitted.
Existing Auth schema does not run GoTrue password/refresh/issuer services.
Secret metadata does not recover unknown secret plaintext or role passwords.

## Single-Host Tradeoffs

A client-owned runtime eliminates managed Supabase quotas on this execution
path and keeps private state local. It retains SQL atomicity and existing
protocols without duplicating scheduler authority. It also introduces one-host
availability: sleep, shutdown, disk loss or client-user access can make the
runtime unavailable. GitHub cannot accept live transactions while that machine
is offline.

Routine backups and actual restore drills are required. PostgreSQL documents
logical dumps, filesystem backups and continuous archiving as distinct backup
approaches [8]; a dump is a recovery checkpoint, not automatic WAL/PITR or an
independent off-host replica. The next backup policy must specify retention,
encryption, a second independent destination and measured restoration. Private
raw dumps, rows and keys must never be part of repository history, release
archives or Actions artifacts. Public release evidence needs its own sanitized
producer and trust validation.

For multiple machines or continuous availability, use an independently owned
always-on server with the same fenced authority and authenticated transport.
Simply adding a second database or using Git commits as leases creates a second
writer and does not solve coordination. R1 continuity, canonical C1/C2 execution
and verified self-improvement remain open until their physical evidence gates
are satisfied.

## Primary Sources

All URLs below were fetched read-only on 2026-10-08.

1. GitHub Actions limits: https://docs.github.com/en/actions/reference/limits
2. GitHub-hosted runners: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
3. Artifact/log retention: https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization
4. Actions billing: https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions
5. Storing workflow artifacts: https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-what-your-workflow-does/storing-and-sharing-data-from-a-workflow
6. PostgreSQL 17 transaction isolation: https://www.postgresql.org/docs/17/transaction-iso.html
7. Supabase database backup scope: https://supabase.com/docs/guides/platform/backups
8. PostgreSQL 17 backup and restore: https://www.postgresql.org/docs/17/backup.html
9. Electron resources path: https://www.electronjs.org/docs/latest/api/process#processresourcespath-readonly
10. Electron ASAR limitations: https://www.electronjs.org/docs/latest/tutorial/asar-archives
11. PostgreSQL 17 installation directories: https://www.postgresql.org/docs/17/app-pgconfig.html
12. PostgreSQL 17 build requirements: https://www.postgresql.org/docs/17/install-requirements.html
