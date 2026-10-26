# METAENGINE: stream 5 disposable recovery bundle, 2026-10-27

## Status and scope

**Implementation complete; focused Linux source checks passed. Windows physical
qualification is pending at the time this source report is authored.**
This document describes the review boundary and reproducible checks for
[issue #1360](https://github.com/PatrickFrome/Compute/issues/1360), coordinated
through [#1354](https://github.com/PatrickFrome/Compute/issues/1354). It is not a
record of a successful Windows execution. Results must be attributed to the
exact tested commit and, for CI, its run and attempt before review handoff.

| Identity | Value |
| --- | --- |
| BASE_SHA / ANCHOR_SHA | `9d7527683060e314eb1d39fec9ce2304a57103c4` |
| Worker branch | `work/preinstall-recovery-20261027` |
| PR base | `work/preinstall-closure-20261027` |
| HEAD_SHA | Exact committed SHA is recorded in the issue handoff and each receipt |
| Draft PR | Linked from issue #1360 after publication |
| Source verification | 70 PASS / 0 FAIL / 1 Windows-only SKIP, Linux Node 24.22.1, working tree |
| Disposable Windows physical qualification | PENDING |
| Installed backup / installed runtime qualification | Not established by this work |

The baseline logical-restore test establishes a limited generated-table
roundtrip. Its `rollback-preserved.bin` is a fixture marker. It does not prove
recovery of the external vault key, vault decryption, sequence state or SQL
privileges. This is a gap in the existing evidence, not an observed loss of
user data.

The new qualification is limited to two freshly initialized disposable
PostgreSQL 17 clusters and newly generated fixture material. A successful run
must establish the relationship between a custom-format logical dump, a
separately protected fixture key and an independently pinned manifest. The
source cluster, restored cluster and both target process incarnations are
measured independently.

## Authority boundary

All exported evidence has `evidence_class=SYNTHETIC/STAGING`. Even a successful
physical fixture run must retain:

```text
installed_owner_touched=false
installed_backup_verified=false
upgrade_authorized=false
production_authorized=false
automatic_retry_allowed=false
physical_restore_proven=false
authority_effect=false
```

Here `physical_restore_proven` is the production-gate authority field. The
fixture's separate observations describe what actually ran without changing
that field. Receipt consistency alone is not independent physical evidence.

The installed backup gate must continue to reject synthetic/staging evidence,
and the existing restore gate must remain unable to authorize an upgrade from
a caller-supplied JSON receipt. A real backup of the user's Keeper and its
independent verification remain separate prerequisites before installation.

No existing user Browser, Owner, Keeper, Guardian, PostgreSQL directory or
registry is a test resource. This stream does not build an installer, consume
or reserve a package version, change RequireFreshInstall, or update a source
seal. It does not merge its own PR. The coordinator retains integration and
acceptance authority.

## Implementation surfaces and shared modules

New stream-owned files:

- `infra/client-state-runtime/test/disposable-recovery-bundle.mjs`: disposable
  physical harness and private SQL/process orchestration.
- `infra/client-state-runtime/disposable-recovery-bundle.integration.test.mjs`:
  Windows physical entrypoint.
- `infra/client-state-runtime/test/disposable-recovery-bundle-guard.mjs` and
  `infra/client-state-runtime/disposable-recovery-bundle-guard.test.mjs`: bundle
  integrity, independent manifest binding and physical path isolation.
- `infra/client-state-runtime/test/disposable-recovery-bundle-receipt.mjs` and
  its sibling `.test.mjs`: strict receipt export allowlist and required physical
  TAP result verification.
- `.github/workflows/client-disposable-recovery-bundle.yml`: exact-source
  disposable Windows qualification and sanitized artifacts.
- This audit report.

Shared modules are reused with their existing authority:

| Existing module | Use and retained boundary |
| --- | --- |
| `owned-postgres-process.mjs` | Claim, verify, stop and restart only the new owned postmasters; never perform a broad process kill. |
| `local-vault-key.mjs` | Generate the source fixture key using the existing mechanism, outside the repository. A missing restore key is an error, not permission to generate a replacement. |
| `local-vault-compat.sql` | Existing pgcrypto vault schema/functions and fixed-file key reader; no migration changes are required. |
| `attached-postgres-onboarding.mjs` | Its exported `secureAttachedPrivateFile` protects newly created private files before sensitive bytes are written. |
| `private-windows-storage-acl.mjs` | Protect new directories and obtain actual Windows DACL readbacks. A POSIX mode or injected positive receipt cannot substitute for Windows evidence. |
| `pg17-backup-effect-barrier.mjs` | Publish and cross the durable backup fence once. A lost acknowledgment never permits an automatic second effect. |
| `pg17-one-shot-disposable-dump-executor.mjs` | Execute the real custom-format dump and independently read its archive/TOC; preserve its fixture-only result. |
| `upgrade-backup-gate.mjs` and `upgrade-backup-restore-gate.mjs` | Demonstrate that fixture evidence cannot become installed backup or production restore authority. |
| `.github/prepare-runtime-contract-pg17.mjs` | Stage the existing pinned Windows PG17 origin outside the checkout; preparation alone does not start or qualify a database. |

Changes to shared files, migration files, autonomous host, UI, producer,
package manifests, versions or closure seals require the coordination protocol
and are outside this stream's implementation scope.

## Required positive observations

The pinned origin is PostgreSQL `17.11`; its archive SHA-256 is
`6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3`.
Preparation uses the existing origin/hash/extraction checks. The harness then
rehashes the actual pinned ZIP and compares every extracted bin/lib/share file,
including pgcrypto and dependent DLLs, with its ZIP entry. Qualification
must bind the executed `initdb`, `postgres`, `pg_ctl`, `pg_isready`, `psql`,
`pg_dump` and `pg_restore` binaries and record their measured digests. Merely
hashing an arbitrary untrusted executable does not establish origin.

| Stage | Required independent evidence |
| --- | --- |
| Isolation | Fresh private root, disjoint PGDATA/bundle/key directories, new loopback ports, distinct source/target system identifiers and PIDs. Installed fixed ports are excluded. |
| Fixture | SQL readback covers Unicode, NULL and binary values; generated plaintext is encrypted through the existing vault mechanism. |
| Sequence | Nontrivial sequence parameters, `last_value` and `is_called` are compared independently. Expected next values are checked without silently changing the source baseline. |
| Backup | Exactly one dump through the existing effect fence; real custom-format signature, byte count, SHA-256 and independent TOC checks. |
| Key custody | Only this run's newly generated key is copied into a separate protected directory and then into the target. Source, saved and restored key bytes are bound by digest and real DACL readbacks. |
| Restore | One restore into the separately initialized target, followed by independent content, sequence and vault-decryption checks. Row count alone is insufficient. |
| Cold restart | The target stops with confirmed cleanup, starts with a new process incarnation, retains its own system identifier/PGDATA/port, and repeats content, sequence and vault checks. |
| Source preservation | Source SQL contents and sequence state, source identity and source key remain unchanged by the recovery procedure. Archive and saved key are rechecked. |
| Final cleanup | Both owned postmasters are confirmed stopped and both loopback ports released before PASS. Unknown process or cleanup state cannot qualify. |

Any intentional target `nextval` or content-corruption control must be ordered
and recorded so it is not confused with the baseline cold-restart comparison.
The source sequence is inspected without consuming values.

## Manifest and integrity trust model

The manifest binds source SHA and source cluster identity, archive/key file
names, sizes and SHA-256 digests, plus content and sequence commitments. Its
schema and authority fields are strict. It contains neither key bytes nor
plaintext, passwords, SQL rows or raw private paths.

The expected manifest SHA-256 is retained outside the mutable bundle, from
creation through restore. Verification must receive that independent pin and
the expected source SHA. It must not learn a new expected hash from the bundle
after a corruption control. Coordinated replacement of a dump and its manifest
therefore fails against the previously retained pin.

This proves consistency with the run's retained commitment. It does not provide
a signature, external archival custody, authenticity of an arbitrary imported
bundle, or protection against an attacker who can replace both the verifier
and its expected inputs. Those properties are outside the disposable fixture
claim.

Bundle files must be regular, single-link files with stable identity and
digest readbacks. Junctions, symlinks, reparse ancestors, hardlinks, containment
between resource directories and unknown filesystem identity fail closed.

## Required negative controls

Each required negative is an observed rejection, not a skipped check or an
asserted boolean. Missing prerequisites leave its evidence unqualified.

| Negative control | Expected result |
| --- | --- |
| Truncated dump | Integrity verification rejects it before restore. |
| Substituted dump | A same-size replacement is rejected by its digest; a rewritten manifest cannot override the retained expected pin. |
| Missing key | Recovery fails; no key-generation fallback creates a replacement. |
| Substituted key | Key integrity or actual decrypt verification rejects it; source key is not silently used as fallback. |
| Invalid manifest | Invalid schema, authority, source binding or digest is rejected. |
| Source PGDATA target | Restore admission rejects it before any target mutation. |
| Source port target | Restore admission rejects source endpoint reuse, regardless of a different directory spelling. |
| Junction | An actual disposable Windows junction/reparse alias is rejected. Lack of junction coverage cannot become physical PASS. |
| Hardlink | An actual multiply linked critical file is rejected. This does not substitute for the separate junction control. |
| Lost backup ACK | A completed/maybe-started effect remains durably fenced; re-entry cannot cause a second dump. |
| Equal count, changed contents | A one-cell change with unchanged row count fails the content comparison. |
| Unknown cleanup | Missing/unknown cleanup prevents overall PASS and does not cause automatic retry or a generic PID kill. |

Portable guard/receipt tests exercise admission and export contracts. They
cannot replace the real Windows filesystem, DACL, PostgreSQL or restart
observations required by the physical entrypoint.

Every intact negative-control copy first passes the same validator. Each
corruption then requires its specific denial code; native readback timeouts,
unknown filesystem state and unexpected errors fail the entire harness. The
missing-key control requires a directly observed ENOENT; no generic read error
is accepted as evidence of absence.

The ACK-loss case deliberately discards the return value after one real dump;
it is injected acknowledgment loss, not an observed natural network failure.
Independent file/SQL readback can qualify this fixture's restoration while the
backup effect remains `EFFECT_UNKNOWN` and re-entry remains forbidden. The
unknown-cleanup control removes a witness from the real run's receipt and
checks rejection. It proves the classification of missing cleanup evidence;
it does not claim to have physically created an orphan postmaster. Actual
cleanup failures also block PASS and retain the private directory without an
automatic stop or utility retry.

## SQL ownership and ACL limitations

The existing executor uses `--no-owner --no-acl`; restore explicitly retains
both options. For a custom-format archive, `pg_dump --no-owner` is ignored;
the harness's `pg_restore --no-owner` is what prevents assignment of the
original object owners. `--no-acl` excludes GRANT/REVOKE commands, and this
single-database dump does not supply global role definitions or passwords.
These limits follow the PostgreSQL 17 documentation for
[pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) and
[pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).
Successful decryption as the disposable administrator is not proof that an
application role can decrypt, or that an unauthorized role cannot do so.

In particular, source REVOKEs from `local-vault-compat.sql` must not be presumed
to have survived the dump. This qualification records
`sql_acl_policy=NOT_TRANSFERRED_NO_OWNER_NO_ACL`. Filesystem key DACL proof is a
separate claim from SQL privilege restoration. Any future SQL ACL restoration
claim needs a distinct provisioning procedure and independent SQL readback.

## Secret and artifact policy

Sensitive seed SQL is provided through child stdin, never command-line
arguments. PostgreSQL statement/parameter/error-statement logging is disabled
for that fixture operation. The existing vault reads its key from the fixed
file; key bytes are never interpolated into SQL. Decrypt comparison uses a
digest or private in-process comparison; raw plaintext and rows are not logged.

The public receipt is an exact-field allowlist, including fixed diagnostics,
hashes, run/source identity, cluster identifiers, boolean observations and
negative verdicts. Unknown fields are rejected. Private path strings,
credentials, key bytes, plaintext, SQL rows, raw stderr, dump files and raw TAP
are excluded from uploaded artifacts.

The workflow uploads only schema-validated `receipt.json` and sanitized
`physical-proof.tap` under artifact name
`disposable-recovery-bundle-<EXPECTED_SHA>-<run_id>-<run_attempt>`, with a
14-day retention period. The raw TAP remains in runner temporary storage.
A passed JSON receipt without the required successful, unskipped physical TAP
test does not qualify. Failed, canceled, skipped, TODO, duplicated or absent
physical evidence is not converted into PASS.

## Reproduction

Run from the reviewed committed worker checkout. The physical entrypoint
requires matching HEAD and an entirely clean tracked/untracked working tree;
ignored dependencies are permitted. This prevents uncommitted new helpers
from emitting evidence attributed to the anchor SHA.

Source contract checks:

```sh
node --test --test-concurrency=1 --test-reporter=tap infra/client-state-runtime/disposable-recovery-bundle-guard.test.mjs infra/client-state-runtime/test/disposable-recovery-bundle-receipt.test.mjs
git diff --check
```

Physical qualification requires a disposable Windows x64 environment. The CI
workflow is `Client Disposable Recovery Bundle`, job `recovery-bundle`, on
`windows-2025`; it checks out the exact PR head/source SHA. Its entrypoint uses
Node 24 and the already pinned PG preparation helper.

For a manual run, set `EXPECTED_SHA` to the reviewed full worker commit, verify
that the checkout matches it, and use a new temporary directory outside the
checkout. Execute the preparation once and use its returned binary directory:

```powershell
$env:EXPECTED_SHA = '<reviewed full 40-character worker HEAD_SHA>'
if ((git rev-parse HEAD).Trim() -ne $env:EXPECTED_SHA) { throw 'source_mismatch' }
$work = Join-Path ([IO.Path]::GetTempPath()) ('metaengine-recovery-entry-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -ErrorAction Stop | Out-Null
$env:RUNNER_TEMP = $work
$preparedJson = & node .github/prepare-runtime-contract-pg17.mjs prepare
if ($LASTEXITCODE -ne 0) { throw 'pg17_preparation_failed' }
$prepared = ($preparedJson -join "`n") | ConvertFrom-Json
$env:LOCAL_STATE_TEST_PG_BIN_DIR = $prepared.bin_directory
$env:RECOVERY_BUNDLE_REQUIRE_PHYSICAL = '1'
$env:RECOVERY_BUNDLE_RECEIPT_PATH = Join-Path $work 'receipt.json'
$privateTap = Join-Path $work 'private.tap'
$proofTap = Join-Path $work 'physical-proof.tap'
& node --test --test-concurrency=1 --test-reporter=tap infra/client-state-runtime/disposable-recovery-bundle.integration.test.mjs *> $privateTap
$physicalExit = $LASTEXITCODE
& node infra/client-state-runtime/test/disposable-recovery-bundle-receipt.mjs verify $env:RECOVERY_BUNDLE_RECEIPT_PATH $privateTap $proofTap
if ($physicalExit -ne 0 -or $LASTEXITCODE -ne 0) { throw 'recovery_qualification_failed' }
```

Do not retry an ambiguous backup/restore attempt using the same directories or
fence. Review its recorded state first. A later explicitly selected disposable
qualification is a new run with new resources, not recovery of a lost effect
acknowledgment. Keep private files out of the report and GitHub artifacts.

## Evidence ledger and remaining work

| Check | PASS | FAIL | SKIP | Evidence |
| --- | --- | --- | --- | --- |
| Guard source tests | 22 | 0 | 0 | Linux Node 24.22.1; includes fixed native-diagnostic and spoofed-error controls |
| Receipt/export source tests | 9 | 0 | 0 | Linux Node 24.22.1; includes real CLI subprocesses |
| Existing focused fence/backup/restore regression tests | 39 | 0 | 0 | Existing shared authority unchanged |
| Physical integration entrypoint on Linux | 0 | 0 | 1 | Explicit Windows prerequisite SKIP, not qualification |
| Required physical mode on Linux | 1 | 0 | 0 | Meta-check observed exit 1, prerequisite error and zero skips |
| Syntax / `git diff --check` | PASS | 0 | N/A | New modules parsed and diff checked |
| Windows physical recovery | PENDING | PENDING | PENDING | Exact-source run/attempt and artifact links required |
| Sanitized receipt/TAP verification | PENDING | PENDING | PENDING | Bound receipt and artifact hashes required |

First Windows source run on `c88a5e1adcde159d8cca26fc384f72b516b5939b`,
[40416312433 / attempt 1](https://github.com/PatrickFrome/Compute/actions/runs/40416312433),
returned **57 PASS / 10 FAIL / 0 SKIP** in source controls. All ten failures
were native path-readback UNKNOWN; no PG preparation or physical database
operation ran. The existing fence/backup/restore tests passed. The native
guard's environment is now pinned to Windows PowerShell system modules and
its diagnostics are restricted to fixed phase/category identifiers. The
original log did not establish the underlying native cause; successful
execution on the corrective source is still required.

Exact combined local command (temporary files outside the checkout):

```sh
TMPDIR=/workspace/scratch/91950bee7b7b/recovery-test-tmp node --test --test-concurrency=1 --test-reporter=tap infra/client-state-runtime/disposable-recovery-bundle-guard.test.mjs infra/client-state-runtime/test/disposable-recovery-bundle-receipt.test.mjs infra/client-state-runtime/pg17-backup-effect-barrier.test.mjs infra/client-state-runtime/upgrade-backup-gate.test.mjs infra/client-state-runtime/upgrade-backup-restore-gate.test.mjs infra/client-state-runtime/disposable-recovery-bundle.integration.test.mjs
```

The first combined Linux run found a signed-inode representation in the
execution host's overlay filesystem: a nonzero uint64 inode was presented as
a negative bigint. The guard now normalizes the inode to uint64 while
retaining zero, identity, link-count and stability checks. A rerun passed all
67 applicable tests. Independent review also found and corrected broad
negative-error matching and the untracked-source attribution gap.

No CI success or artifact identity is inferred from these Linux checks.
Remaining work is to execute the full disposable Windows entrypoint on a
published exact commit and record its actual outcomes, run/attempt and hashes.
Any unavailable physical prerequisite remains explicitly PENDING/BLOCKED/SKIP,
as applicable; source readiness and physical qualification are separate.

The final issue handoff must include `STATUS`, `BASE_SHA`, `HEAD_SHA`, `BRANCH`,
`PR`, changed files, exact commands, PASS/FAIL/SKIP counts, CI/artifact links and
remaining unknowns. Only the coordinator assigns DONE/ACCEPTED.
