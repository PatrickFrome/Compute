# METAENGINE: Windows payload closure audit — verified historical e30 source

**2026-11-05 · Status: HOLD for Windows installation.** Independent source-only qualification of Node, Deno, PostgreSQL 17, Git and Codex. This report **supersedes** the earlier byte-access-blocked report in this draft PR. The restored archive has now been supplied via authorized ChatGPT Space Library; archive and Git tree have been independently verified. It is a **historical GitHub snapshot**, NOT the latest repository revision or a Windows-ready artifact. No installer, installed PC, real DB/services, listener, signing or CI execution was performed. No merge.

## Provenance and independently computed source identity

| Check | Evidence | Result |
|---|---|---|
| Source repository | `PatrickFrome/Compute`, transfer commit `accb28e72c87c059e780efb8e6681886b33e9b4f`, branch `work/source-transfer-c26565e-20261103` | PASS (GitHub metadata) |
| Integrated patch | `coordination/source-transfer/c26565e/integrated-c265-to-e30.patch` from `d53ccd4135f28206d91d6804cf0626095565e6af`; its parent is transfer commit | PASS (GitHub metadata) |
| Materialized historical source ZIP | Library file `libfile_67e248dedc1081918003c1514194a6f7`, `METAENGINE-e30-github-only-source.zip` | PASS (read-only) |
| Exact ZIP SHA-256 (bytes) | `169f4dc6379605d68d34360c9d28d687b4da3dc856aea6fc1fb27e6bc6d3ba06` | **PASS** |
| ZIP integrity and tracked sources | 4,346 files extracted from `Compute/`; no duplicates or noncanonical source file entries | PASS |
| Executable modes | 74 file entries, mode `100755`, preserved; all other tracked regular files `100644` | **PASS 74/74** |
| Final Git tree, independently recomputed | `90fa5633d7926dd71a7303266073e0625325e740`; Git 2.47.3 local `git write-tree`, independently recomputed using Python Git tree hashing | **PASS** |
| Earlier transfer parts SHA-256 | Original split archive `4200e492...d3636` not redownloaded by this stream; restored ZIP and tree verified independently | NOT RUN (original split byte identity) |
| Physical vendor archives or built Windows staging | Not included in restored historical source ZIP | **NOT RUN** |

Git index used a new disposable checkout with `core.filemode=true` and `core.autocrlf=false`. Original source and trust assertions were not rewritten. The original GitHub fetch size blocker was specific to binary transfer parts and is **no longer a blocker to historical source inspection**; it remains a limitation for independent redownload of those original split bytes.

## Per-component source → packaging → integrity → consumer contracts

**44 explicitly required files** are recorded with paths and source-level consumers in [PACKAGE_FILE_MATRIX.md](./PACKAGE_FILE_MATRIX.md). These are **minimum explicit requirements, not a complete staged-vendor-file manifest**. Static declarations and actual source bytes were verified; absence of vendor ZIP/TAR, frozen cache payload and final packaged resources means individual **physical staged SHA-256 are NOT RUN** for all five.

| Component | Version and source archive pin | Explicit files | Source producer / declared output | Consumer | Source contract | Actual vendor/staging |
|---|---|---:|---|---|---|---|
| **Node** | 24.21.0; ZIP SHA-256 `158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541` | 2 | `stage-client-state-runtime.mjs` → `resources/client-state-runtime/runtime/node/node.exe` and license | `runtime-host.mjs` → `launcher.mjs` | PASS | NOT RUN |
| **Deno** | 2.9.7; ZIP SHA-256 `a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238` | 3 | same → `runtime/deno/deno.exe`, license, locked `deno-cache/npm/.../postgres/3.4.7/package.json` | `runtime-host.mjs`, `launcher.mjs`, `DENO_DIR` | PASS | NOT RUN |
| **PostgreSQL** | 17.11.0; ZIP SHA-256 `6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3` | 13 | same → all `runtime/postgresql/{bin,lib,share}` plus license | `owned-postgres-process.mjs`, `fresh-pg17-initdb.mjs`, `pg17-native-recovery-process.mjs` | PASS | NOT RUN |
| **Git** | MinGit 2.56.0.windows.4; archive SHA-256 `e3bf78351fe777fba47ddee5950082f8a98bb0f02604fdc7ba3ee2cb68ffa877`; full inventory pin `4e4948e91d46854ebcdaee2ecfb91a7296429bc6a7af35814e65dcdade9bb513` | 13 | `private-native-tools.lock.json` → `stage-private-native-tools.mjs` → `resources/private-native-tools/git` | `private-native-tools-core.mjs`, `managed-task-project-runtime.mjs` | PASS | NOT RUN |
| **Codex** | 0.166.0; archive SHA-256 `d559bb88e74d471265857b93b7f19bc250dae527673b9191b33534478093f6bc`; full inventory pin `e1dd7e081c14a6d4c843ac650dba13dcf38183b558b1c25f382751ced5694bba` | 13 (9 archive members + 4 notices) | same → `resources/private-native-tools/codex` | `private-native-tools-core.mjs`, `native-coding-host-observers.mjs`, `prepare-codex-cli-job-runtime.mjs` | PASS | NOT RUN |

For Node/Deno/PG, `offline-runtime-bundle.mjs` inventories and SHA-256-checks staged bytes; for Git/Codex, `private-native-tools-core.mjs` verifies the locked full file inventories, per-file digests and runtime binding. `electron-builder.test.json` declares both resource destinations via `extraResources`. **Source presence of validators is not evidence that a built installer actually contains or executes the files.** All 4 checked Codex source-notice hashes matched exact historical Git tree bytes, but actual package notice staging remains NOT RUN.

Dynamic dependencies beyond explicit 44: full PostgreSQL `pgsql/bin`, `pgsql/lib`, `pgsql/share`; every selected locked Deno cache file; complete Git and Codex archives (existing test expectations: 375 and 50 files, respectively). Their authoritative physical listings and per-file original/staged hashes must be obtained from actual pinned vendor archives and a disposable Windows build; no vendor bytes were present here. Deno and PostgreSQL separately fetch license text from tagged source during build: no independent physical/online license-byte verification was done in this source-only stream.

## Reproduced fixture error — corrected only in isolated copy

The first targeted 7-source-file Node test selection had **69 tests: 49 PASS, 16 FAIL, 4 SKIP**. Of 16 FAIL, **15** were cascades from one old synthetic installed-binding fixture: it staged only 5 PG executables while the real offline bundle validator requires 10 (`postgres`, `psql`, `initdb`, `pg_ctl`, `pg_config`, `pg_isready`, `pg_controldata`, `pg_dump`, `pg_restore`, `pg_dumpall`). The other 1 FAIL was a runner import error because local `@electron/asar` was not installed, **not an observed source defect**.

Reproducible **fixture-only** diff: [fixture-pg10-regression.patch](./fixture-pg10-regression.patch). It adds 5 generated **inert** PG CLI placeholders and one negative test that deliberately deletes `pg_dump.exe` and retains the rejection `offline_bundle_required_file_missing`. On the *exact unmodified indexed historical source*: `git apply --cached --check` **PASS**; on the fixed working copy: `git apply --reverse --check` **PASS**. No production fixture/assertion weakening and no real executables launched.

After the fix, dedicated test **16 PASS / 0 FAIL**. Re-running the same targeted selection plus new negative regression yielded **70 total: 65 PASS, 1 FAIL (missing `@electron/asar`), 4 SKIP**. All 15 downstream fixture failures were resolved; original negative case preserved. The single remaining FAIL is environment dependency, not packaged artifact proof. User PC and real PostgreSQL were not touched.

## Auditors and inert regression results

| Check / command | Result |
|---|---|
| `python windows_payload_audit.py snapshot --archive METAENGINE-e30-github-only-source.zip` | 3 PASS / 0 FAIL (archive digest, 4,346 file/74 modes, Git tree) |
| `python -m unittest -v test_windows_payload_audit.py` | **10 PASS / 0 FAIL**; synthetic + one ZIP mode/tree regression |
| `python -m unittest -v test_e30_source_payload_audit.py` | **10 PASS / 0 FAIL**; exact source, altered bytes/modes, notice mismatch, missing consumers/resources, case/traversal negatives |
| Source-only declaration auditor `e30_source_payload_audit.py --archive ...` | PASS source contracts, exactly 44 explicit file paths |
| Prepared `inventory` without pinned vendor/staging bytes | **NOT RUN** (fail-closed; no pretend PASS) |
| Targeted Node suite after fixture patch | 65 PASS / 1 FAIL / 4 SKIP (70 tests) |
| Physical Windows payload, PE execution, clean install/upgrade, first task | **NOT RUN** |

Inputs: **Python 3.13.5**, **Git 2.47.3**, **Node 22.16.0** (below Browser's `>=24` requirement; these are diagnostic, not full target-environment qualification), Linux isolated container. No PG server, Deno binary, Windows installer, code-signing, real services, network listeners, cloud/Supabase/GLM or model/API billing was invoked. The exact restored historical ZIP was read-only.

## Acceptance and remaining gates

| Gate | Result | Remaining proof |
|---|---|---|
| Recovered archive SHA-256 / Git tree / 74 execute modes | **PASS** | No further source identity proof needed for this exact supplied ZIP |
| Source-level declared origin, destination, integrity verifier, and consumer (five components) | **PASS** | Explicit 44-file minimum only; no physical closure |
| PG fixture negative-case test and isolated corrective patch | **PASS** | Apply reviewed patch to target integration source if desired |
| Full PostgreSQL/Deno cache and Git/Codex vendor archive contents | **NOT RUN** | Pinned vendor distributions, all archive member paths, full manifest and digests |
| Origin → staged file-by-file SHA-256 closure | **NOT RUN** | Disposable Windows staging with real vendor bytes and independent file-level digests |
| Build/package gates including ASAR | **NOT RUN** | Restore build dependencies (local `@electron/asar` missing), Node >=24, full suites |
| Immutable package → clean install → upgrade → first useful task | **NOT RUN** | Separate authorized physical proof; not inferred from source tests |

**Decision: HOLD.** The former archive-access blocker is closed for the exact supplied historical source. The remaining obstacles concern actual pinned vendor package files, staging/packaging and physical Windows qualification, not the source ZIP. The reported fixture drift is fixed only in an isolated copy and represented as a reviewable patch. No trust gate was relaxed; no merge or deployment attempted.
