# METAENGINE e30 inert source-coverage audit — report-only draft

## Status and scope
Source-only inspection of a supplied GitHub-derived ZIP. **This PR contains a report, not the new coverage code.** The independent local source patch and narrow check-source integration hunk must be reconciled with a matching source tree before they can be proposed for merge. No Electron, installer, native Host/MCP process, PostgreSQL, services, network runtime, credentials, source pins, CI workflows, or installed client were changed.

## Source identity gate — FAILED
- ZIP SHA-256: `169f4dc6379605d68d34360c9d28d687b4da3dc856aea6fc1fb27e6bc6d3ba06` — **PASS**.
- Reconstructed Git tree using prescribed `git init; git -c core.autocrlf=false -c core.filemode=true -c core.excludesFile=/dev/null add -f --all; git write-tree`: `ff63a45316d8f2a474b708de503f538afffa1791`.
- Supplied expected tree: `90fa5633d7926dd71a7303266073e0625325e740` — **MISMATCH/FAIL**. Do not assert tree identity or apply stale patches as a verified merge.
- ZIP has 4,574 entries with no traversal/symlink entries; 4,272 file entries have unspecified Unix mode metadata and 74 explicitly mark executable. Root cause of tree mismatch is not proven.

## Verified coverage gap in the supplied ZIP
Existing `SOURCE_CHECK_FILES` has 302 entries. The following family coverage was measured directly:

| Family | Total | Already checked | Absent |
|---|---:|---:|---:|
| First-setup | 24 | 7 | 17 |
| RSI | 97 | 1 | 96 |
| MCP | 7 | 5 | 2 |
| Toolbelt | 1 | 0 | 1 |
| Repository search/configuration | 9 | 4 | 5 |

These represent **120 unique source files** not present in the original check-source list (families overlap).

## Independent inert tests — 7 PASS / 0 FAIL / 0 SKIP
A new local `coverage/native-source-coverage.v1.json` manifest plus test-only Node VM inspection:
- Parses **536 real source files** and rechecks **1,312 relative import/URL edges** under a disposable relocated `Compute/` layout.
- Validates `package.json.main` and the exact three-file MCP `extraResources` filter.
- Parses the three MCP companions from an independent resource directory and resolves the entrypoint's two local import edges.
- Negative tests reliably reject missing broker, invalid ESM grammar, and manifest inventory drift.
- A source fixture with deliberate top-level effects proves that parsing does **not** evaluate code.

This is **static grammar/path coverage**, not runtime import/export linking or ASAR qualification.

## Explicit non-qualifications
- Four computed dynamic imports are not linked: two in `local-runtime-host-controller.mjs`, one in `installed-fresh-provider-setup.mjs`, and one in `guardian-replacement-runtime-host-entry.mjs`.
- `guardian-replacement-runtime-host.node` is a native-addon path, not staged or executed.
- External bare imports: `electron`, `electron-updater`, `postgres`. Installation/export linkage not verified.
- Existing `native-coding-packaged-closure.test.mjs` was inspected but **NOT RUN** (it imports runtime and requires `@electron/asar`). Electron/Main/Host/MCP runtime, installer, real PG, services, native addon and workflows were **NOT RUN**.
- The standalone check-source integration hunk was syntax/dry-run checked against the ZIP baseline, **not applied**, because shared scripts/workflows are owned by the coordinator.

## Integration decision
**HOLD on source identity and matching base.** This report-only draft is based on the known published head `ff63318b0d29b3c8de93e2552ff78459745f1e01` of `work/integrate-streams-20261101`. That public head does not contain the same complete new modules as the e30 ZIP. Local source patch is not claimed CI-green or merge-ready against this public head. Do not merge this report as executable coverage.
