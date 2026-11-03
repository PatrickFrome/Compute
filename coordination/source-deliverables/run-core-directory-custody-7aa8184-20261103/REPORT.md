# RunCore directory custody — private source component, genuine issuer HOLD

The original `MetaengineCodexJob.RunCore` now contains the private acquisition,
stopped-worker transfer and retained cleanup mechanics in the same prepared C#
assembly that owns the Job. **This closes an internal source component, not the
production issuer. Public Run/RunPolicy still supply null, both original private
facets have zero constructor call sites, and both existing recovery HOLDs remain.**

No external Job holder, new trust root, positive wire permit, installation,
Windows execution or real database operation was introduced.

## Exact incremental patch

- Base tree: `7aa8184e89a4ca3754275e81bf3f83a61276837b`, verified #1445 result.
- Result tree: `9163f18f17bbcb5ffdb0af6169028afe8e454998`.
- Patch: `run-core-directory-custody.patch`, 109192 bytes.
- SHA256: `466d5acb63737d643322709b1a12bb13f5e1da36fabf92e785706215830dbcf3`.
- Nine changed files; public PowerShell prefix/suffix and reflection signatures
  are byte-unchanged. A single Add-Type remains.

A fresh detached base passed `git apply --check`, `git apply --index`, exact
result-tree comparison and 95 tests with one Windows skip. `BASE.md` identifies
the original archive and complete verified patch chain. Local synthetic commit
`37786581dfdc74de7371aa6a553a9c204793d4f9` is bookkeeping; the tree is portable.

The parent supplied local integration HEAD
`1103decb0d691bb72593caf10b47b5317abac755`. Standard authorized Git fetch failed:
`fatal: remote error: upload-pack: not our ref 1103decb0d691bb72593caf10b47b5317abac755`
(exit128). It was not retried or bypassed. Its tree is unverified here, so the
patch explicitly targets the verified #1445 tree. This is a missing remote ref,
not an approval denial or an uncertain mutation.

## Implemented source component

1. The private scope is acquired inside RunCore after Job creation/limits and
   before either native CreateProcess call. It consumes borrowed original
   directory/anchor handles, duplicates and compares exact native opens, and
   performs object-relative ReOpenFile. The same helper keeps the original Job;
   no Job duplicate or debugger detach transfers its lifetime elsewhere.
2. Necessary local checks require local volume GUID paths, native file/birth
   identities, no reparse/case-sensitive state, direct-child nonempty anchors,
   distinct directory rows and complete represented ancestry. Fixed backup-root
   parent/leaf and disjoint PGDATA are checked. These mechanics do not establish
   original Owner, ACL or authenticated namespace provenance.
3. A private DEBUG_PROCESS/CREATE_SUSPENDED branch retains an actual stopped
   CREATE event and exact process object. It transfers and compares all held
   directory/anchor opens into that observed worker before Resume/Continue.
   Debug calls stay on the creating OS thread; no PID-based OpenProcess exists.
4. Immutable invocation/worker/slot references, monotonic generations, process
   birth and consumed-slot/PID tombstones reject replay and late reuse. Partial
   transfer and unknown events revoke and quarantine. Cancellation cannot admit
   another CREATE event or later input. A completed original control reader
   revokes before reading commands or creating a replacement reader.
5. Cleanup distinguishes termination requests, continued exit events, signaled
   independently retained process objects, Job accounting and every original
   I/O task. Pending control readers are not discarded to claim a join. Unknown
   completion retains opens in the same helper until its actual exit; checked
   termination of the exact pending event process only fences cleanup Continue,
   and is not counted as physical exit.
6. A security-relevant defect in the earlier dormant C++ mechanics and new C#
   port was corrected: attributes-only opens do not participate in the required
   sharing checks. Retained and exclusively created opens now require
   FILE_READ_DATA / FILE_LIST_DIRECTORY, without an attributes-only fallback.
   The synthetic model's previous unconditional share rule was too strong and
   is corrected. The old access mask now produces an explicit counterexample.

The shared native veto, producer, adapter and selector are byte-unchanged; their
hash evidence is in `hold-preservation.json`. Selector creation still refuses
before REGISTERING/mkdir without original parent custody. This patch does not
add a selector/parent creation permit.

## Exact remaining producer and mount obligations

The five nonnull object fields in the private unissued bundle are placeholders,
not an authenticated native lifetime. The current authenticated service facet
and controller process registry have no original native bridge that acquires
backup-root, PGDATA, identity-store/state and ancestor custody before namespace
effects and hands those exact objects into RunCore. No constructor/export/wire
record was invented to substitute for that producer.

Observed CREATE events give a local pre-user-mode stop. They do not cover every
effectful descendant: nested DEBUG_PROCESS chains and broker-created processes
can escape observation. Post-exit Job totals cannot prove they never ran.
Transferred worker handles can also be closed/reused by the worker between
readbacks. Neither sampling nor Job membership supplies continuous custody.
Those are prerequisites for the still-unissued OriginalRecoveryBirthCoverage,
not properties established by this implementation.

Before production mount can remove HOLD, the existing authority must supply:

- An original authenticated Job/request/phase/Owner/Host lifetime and original
  native namespace acquisition, including safe relative selector/parent creation.
- Enforceable complete worker/descendant birth coverage before execution and
  continuous per-worker descriptor retention through true process/Job/I/O joins.
- A qualified original loader/debug-event policy. This component preserves
  exceptions as unhandled; it does not fabricate a loader-breakpoint attestation.
- A cancellable original control reader with physical cleanup joins. An
  indefinitely pending reader remains quarantined rather than falsely joined.
- Windows C# compilation, ABI, filesystem/Job/debugger/crash qualification and
  the existing signed package preparation/inventory binding of the exact bytes.

No debug-event process rights are assumed as an authorization source: required
native duplicate/query/terminate failures refuse and quarantine, with no PID
reopen fallback. The detailed Host-service contract is `HOST_SERVICE_MOUNT.md`.

## Verification and limits

- Final compatible profile: **942 tests, 941 PASS, 0 FAIL, 1 Windows SKIP**.
- Fresh applied patch: **96 tests, 95 PASS, 0 FAIL, 1 Windows SKIP**.
- Source checks: **302 PASS**.
- New runner source checks: **63 PASS**. They extract actual scalar expressions
  and execute one straight-line CREATE branch with synthetic call boundaries,
  plus structural contracts and weakened counterfactuals. They do not compile
  or execute C#, implement Windows or establish provenance.
- Actual C++ core compiled with `-std=c++20 -Wall -Wextra -Werror` against the
  explicit synthetic boundary: **36 mechanics PASS, 4 counterexamples confirmed**.
  The four are external Job-holder lifetime extension, descriptorless descendant
  after holder/parent crash, worker self-close after last readback and the old
  metadata-only sharing bypass. Every case rejects architecture acceptance,
  production issuance and physical authority. Modeled termination and actual
  modeled process exit are distinct.
- Independent bounded final review: **93 PASS, 0 FAIL, 1 Windows SKIP**, including
  the corrected core model. The complete compatible command and raw logs are
  retained. No new broad tests were added for unchanged production JS paths.

The existing job-birth source test initially expected only one CreateProcess
statement. It was updated for the explicit null/private branches and passes
15/15; the legacy branch keeps its exact original flags. This was an obsolete
source marker, not a successful C# execution check.

Three earlier prerequisite-dependent profiles remain excluded explicitly:
runtime-host.test.mjs, runtime-host-native-compositions.test.mjs and
startup-source-manifest.test.mjs. Pinned postgres@3.4.7 is absent; the preceding
stage reproduced their 11 failures on its exact baseline. No dependency was
installed or fetched here. This is not a claim that every repository test ran.

**C# compilation, Windows native build/execution, signing, installation, genuine
issuance and physical recovery are NOT RUN/unproven.** No real DB, installed PC,
service, shared branch or trust root was changed. Source contracts and Linux
models cannot upgrade this stage into production authority.

## Persistence

Deliverables are saved locally and published only in an authorized separate
artifact branch/draft PR. The earlier private Space action on
`page_3309b52967c88191aa5e6441c2badb1e` failed with
`auto-permission-review timeout`; readback confirmed old content. That action
was not retried or bypassed in this stage, and Space persistence is not claimed.
