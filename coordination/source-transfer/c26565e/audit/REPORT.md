# METAENGINE / Windows toolchain payload audit — historical GitHub transfer

**Status:** **HOLD** — exact-source byte retrieval blocked. Not an installation-ready qualification. Date: 2026-11-05. This is an independent, source-only stream report for Node, Deno, PostgreSQL, Git, Codex; no safety review, production module change, installed client/PC activity, DB, service, installer, listener, CI publication, or merge.

## Scope and immutable source identifiers

| Item | Verified GitHub evidence / expected value | Status |
|---|---|---|
| Repository | `PatrickFrome/Compute` | PASS — metadata |
| Transfer branch | `work/source-transfer-c26565e-20261103`, HEAD `accb28e72c87c059e780efb8e6681886b33e9b4f` | PASS — GitHub branch lookup |
| Archive provenance | `coordination/source-transfer/c26565e/` from `accb28e...`; 3 parts | PASS — filenames, per-file sizes and Git blob object IDs only |
| Part 00 | 7,200,000 bytes; Git blob SHA1 `485ca6ce2d467f9e577aaf263626af52154425ab` | PASS — GitHub metadata; byte hash NOT RUN |
| Part 01 | 7,200,000 bytes; Git blob SHA1 `a02e1d8217d878fdabbf01ff7f7c04b883158407` | PASS — GitHub metadata; byte hash NOT RUN |
| Part 02 | 1,657,953 bytes; Git blob SHA1 `b0b280633fff1e794d6b6079e313412b6e2ca04e` | PASS — GitHub metadata; byte hash NOT RUN |
| Archive SHA256 | Pinned by GitHub README: `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636` | NOT RUN — bytes not available |
| Original source commit and tree | `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6` / `2dbe253e97379532f6f4b52ef7edf26109a9266d` | NOT RUN — source is inside archive |
| Integrated patch commit | `d53ccd4135f28206d91d6804cf0626095565e6af`, parent `accb28e...` | PASS — GitHub metadata |
| Published patch | `coordination/source-transfer/c26565e/integrated-c265-to-e30.patch`, 1,269,917 bytes, Git blob SHA1 `79d40bf024a6553656b86fb1a29c1313dd458a0e` | PASS — GitHub metadata; patch content NOT RUN |
| Expected patched Git tree | `90fa5633d7926dd71a7303266073e0625325e740` (user-provided expected value) | NOT RUN — patch application and `git write-tree` unavailable |

**Historical base only.** Neither GitHub commit nor expected tree is described as the latest METAENGINE version.

## Required physical file-level inventory (five components)

| Component | Exact required-files enumeration | Provenance of each byte file | Windows package path | SHA-256 origin and staged file | Source consumer | Verdict |
|---|---|---|---|---|---|---|
| Node | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | **NOT RUN** |
| Deno | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | **NOT RUN** |
| PostgreSQL | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | **NOT RUN** |
| Git | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | **NOT RUN** |
| Codex | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | **NOT RUN** |

This is **not** an assertion that these files are absent or broken: the source catalog, vendor artifacts and staged tree cannot be read on this run. Checking only `node.exe`, `deno.exe`, `postgres.exe`, `git.exe`, `codex.exe` would be insufficient: support DLLs, companion binaries, config, schemas, executable shims and dependent assets must be enumerated by exact authoritative package declarations before physical closure may pass.

## Reproduced access blockers (no bypass)

1. GitHub `fetch_file` on `archive.part02` with `encoding=base64` returned `content:""` while retaining metadata SHA `b0b280...` — no byte stream for independent hash. No assumptions made about archive content.
2. GitHub `fetch_file` on integrated patch returned `content:""` with blob SHA `79d40b...`; even with `start_line:1,end_line:80`, content was empty.
3. GitHub raw `fetch` for integrated patch returned **HTTP 400**, `GitHub Fetch could not read file contents; the file may be too large or unsupported`.
4. GitHub Git tree API for unpacked tree SHA `2dbe253e...` and postpatch SHA `90fa5633...` returned **422**, `Invalid object requested. SHA must identify a commit or a tree.` The archive-contained source tree objects are not addressable through the repository's exposed Git object graph.
5. Isolated container attempting HTTPS to the GitHub raw hostname failed with DNS `Temporary failure in name resolution`. No remote desktop or other system was used.

**Root cause for NOT RUN:** authorized source bytes cannot currently be reconstructed in this environment; downstream missing catalog/staging/consumer verification is cascading inability, not five independent observed packaging defects. No source-code mismatch was reproduced, hence no production fix was invented.

## Local inert tests

`python -m unittest -v test_windows_payload_audit.py` — **9 PASS, 0 FAIL, 0 SKIP** on **Python 3.13.5**, Git **2.47.3**, isolated Linux container. Tests cover ordered part hash success, reordering and corruption, missing part, local patch/tree positive+negative with original checkout unchanged, independent manifest and all-five synthetic closure, missing staged file, wrong SHA and missing consumer evidence, missing catalog membership, no staging, and case-insensitive collision. These are **fixture tests**, not physical Windows/binary qualification.

`windows_payload_audit.py` is a new standalone source-only helper. Existing production trust checks and foreign files are unchanged. No GitHub CI or installer was invoked.

## Acceptance matrix

| Gate | Result | Needed proof |
|---|---|---|
| GitHub transfer refs and metadata | PASS | Named commit, part names/sizes/blob IDs, patch commit parent |
| Source archive SHA256 | NOT RUN | Download exact three parts and hash assembled bytes |
| Original source tree match | NOT RUN | Inspect exact restored bundle/check out `c265...` |
| Apply published patch, final tree 90fa... | NOT RUN | `git apply` in disposable copy + Git tree computation |
| Node complete packaging source → stage → consumer | NOT RUN | Full authoritative package manifest, physical bytes, static/runtime consumers |
| Deno complete packaging source → stage → consumer | NOT RUN | Same |
| PostgreSQL complete packaging source → stage → consumer | NOT RUN | Same, including bundled support files and scripts |
| Git complete packaging source → stage → consumer | NOT RUN | Same |
| Codex complete packaging source → stage → consumer | NOT RUN | Same |
| Inert verification harness tests | PASS | 9/9 synthetic fixture tests |
| Windows PE/installer/signing, clean install, upgrade, real DB/service, first useful task | NOT RUN | Out of scope; separate authorized physical proof |

**Decision: HOLD.** Do not infer installation readiness or weaken trust assertions. To proceed, first provide the exact archive bytes and integrated patch through an *authorized supported GitHub download route* to a disposable sandbox; then rerun archive/tree verification and derive a complete catalog from the exact source. A passing manually prepared manifest by itself is insufficient. No secrets or user data included.
