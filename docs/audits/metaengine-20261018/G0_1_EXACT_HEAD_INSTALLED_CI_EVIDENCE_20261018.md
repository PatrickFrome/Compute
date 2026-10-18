# METAENGINE G0.1 — exact-source / installed-Windows / CI evidence ledger

- **Ledger class:** G0.1 READ-ONLY PHYSICAL SNAPSHOT / REVIEW REQUIRED / NOT PRODUCT ACCEPTANCE
- **Observed:** 2026-10-18 10:15–10:17 UTC, Windows `DESKTOP-5DUKPG2`; GitHub data fetched in this audit turn.
- **Source baseline:** `980bd4bff7aa016c738dac9ce52269e3a1e36830` (`work/audit-closure-register-20261018`, Draft PR #1319); source implementation ancestor `7eaa00f0c4f618ece008968dd606fb648c157c4e` (Draft PR #1318).
- **Installed QA package's historical source:** `b4caa18c1a1e255dd8ae43a1825692989e97c74a` (PR #1316, earlier local build); it is **not** the new source SHA.
- **Status:** EVIDENCE_RECORDED, independent acceptance PENDING. G0 overall remains IN_PROGRESS; G1 remains BLOCKED. No new package, Owner rebind, Guardian/PG change or live startup was attempted.
- **Evidence limits:** GitHub commit-runs provider returns PR-triggered runs only. Windows CIM/service/process availability is not native trust/custody readback. An installed file hash is not a release signature. Uninspected properties are UNKNOWN, not FALSE.

## A. Git/source identity

| Subject | Readback | Inference permitted |
| --- | --- | --- |
| Plan source | 980bd4bff7aa016c738dac9ce52269e3a1e36830 | Git worktree clean; remote tracking previously confirmed; PR #1319 open/Draft |
| Plan CI | 3/3 retrieved PR workflow runs SUCCESS: W65 run 39087025669, W72 run 39087025701, W57 run 39087025668 | A subset of checks on a docs-only SHA; **not** installed/readiness acceptance |
| Implementation source | 7eaa00f0c4f618ece008968dd606fb648c157c4e | PR #1318 is still Draft/open; not a package |
| Implementation CI (PR-only provider) | 12 retrieved runs: 3 SUCCESS, 8 FAILURE, 1 CANCELLED | This is a filtered result, not necessarily all events. Earlier copied progress text reported 13/3/8/2: missing 13th run unverified; do not silently reconcile |

**Successful implementation SHA workflows:** R97 source-only #39085411628; W66 exact integration #39085411875; W59 exact qualification #39085411724.

**Failures (8 exact source SHA workflow IDs):**

| CI run | Failure / scoped evidence |
| --- | --- |
| [39085411714](https://github.com/PatrickFrome/Compute/actions/runs/39085411714) Package Smoke | `PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED`; version `0.7.0-dev.1107139874568.1` tied to prior source `b4caa18`, prior artifact 12120040573, prior run 39082519253. Correct refuse; do not bypass or reuse package version. |
| [39085411679](https://github.com/PatrickFrome/Compute/actions/runs/39085411679) Installed Chat | Cannot acquire provenanced installer because Package Smoke stopped. Installed behavior NOT TESTED on this SHA. |
| [39085411716](https://github.com/PatrickFrome/Compute/actions/runs/39085411716) Autonomous Soak | 11 non-installed subjobs succeeded, but installed UI gate blocked acquiring installer. No physical installed soak proof. |
| [39085411708](https://github.com/PatrickFrome/Compute/actions/runs/39085411708) Self Update | Contract stage failed; physical target skipped. |
| [39085411670](https://github.com/PatrickFrome/Compute/actions/runs/39085411670) Browser Shell | Three development-plane jobs passed; shell contract failed. |
| [39085411632](https://github.com/PatrickFrome/Compute/actions/runs/39085411632) Current Source | Win2025 and Ubuntu source/transport suites failed. |
| [39085411769](https://github.com/PatrickFrome/Compute/actions/runs/39085411769) Critical Audit | Full Browser Node suite failed. |
| [39085411738](https://github.com/PatrickFrome/Compute/actions/runs/39085411738) Live Mechanics | Windows and Ubuntu Browser mechanics suites failed. |

The Browser Node suites in these workflows report **three recurring contract failures**: Guardian staging test seeks the old `Get-FileHash` source pattern while reviewed code uses a .NET SHA-256 helper; DevOS ambiguity test seeks the old textual SQL representation of `automatic_retry_allowed=false`; R99 ME2 probe test seeks the old GET path predicate while the implementation now distinguishes qualified POST. These are observed assertion mismatches, **not** independently proven equivalent security behavior. Require semantic/negative-case tests before modifying fixtures. Failure logs: jobs 117550789339, 117550789372, 117550789512, 117550789116, 117550789207.

**Cancelled/not accepted:** State Runtime Contracts run 39085411775 has one cancelled Windows job, two successes; no aggregate PASS. Do not fabricate missing terminal result.

## B. Physical installed Windows evidence — read-only

| Entity | Exact local observation | Acceptance |
| --- | --- | --- |
| Browser EXE | `METAENGINE Browser Test.exe`, 244440576 bytes, SHA-256 `7121b92291d4c67cabe9f3cbc3f764ff1c3896ca1abf352c915700c96b046153`; Authenticode `NotSigned` | **BLOCKED**: no production signature/source-to-installer attestation |
| Installed ASAR | `resources/app.asar`, SHA-256 `a11d2d9e906c3ed8a20cade5f14b2caa9f59f1e7d718456cf0e84a85462077d9`; matches local `b4caa18` staged ASAR byte-for-byte | Locally reproduced byte identity only; stage-to-NSIS provenance UNKNOWN |
| Offline bundle manifest | `compute.runtime-offline-bundle.v1`; file SHA-256 `9862a1ccb30a66da2836cd958a2eddceab6d2e6b5ab1a2c20223225aba9d647a`, bundle digest `a9becd9d764d743080ca24b7eaa319e88f505c63254e20572b5f340131446392` | Manifest present, release trust UNKNOWN |
| Preserved Owner descriptor | schema `metaengine.browser.local-state-provider-config.v1`, profile `CLIENT_LOCAL_POSTGRES_V1`; file SHA-256 `9cabbc29cca5fb99cd38598fc05de26e99c1e3906a12abe12850642137a526a1`; last modified 2026-10-16 18:27:04Z; runtime pin `8e72494a924d4cc271f2b8861914a278cc2eb42f69ff5e88c4a3ba7cad8c4df5` | **BLOCKED**: OWNER PIN != NEW BUNDLE; file not touched |
| Owner referents | Runtime directory points to installed resource location; config and identity files exist; no symlink on checked descriptor; Windows `Get-Acl` read reports `AreAccessRulesProtected=False`, 3 access rules | Presence / coarse ACL metadata only. Actual native Owner binding, security invariants, exact physical file ID and DACL negative suite **UNKNOWN** |
| Browser processes | Main PID 13040; child PIDs 20164, 23976 observed (no restart/termination attempted) | Running process tree ≠ healthy UI / persistent work |
| Guardian | Service `METAENGINEBrowserGuardian`: Running/Auto, PID 3396; binary 554496 bytes, SHA-256 `6f7d98183b9ba8373ca14ad4da9cc106d41577d6db00dcf8059970a6d07ebce5`, `NotSigned` | Service alive only; protected binding, signed challenge, Owner epoch, native exact 100ns birth, trusted release **UNKNOWN** |
| Own PostgreSQL | Six `postgres.exe` processes, primary PID 6748, listener `127.0.0.1:55432`; binary reports PostgreSQL **17.6**, SHA-256 `54e7e05939e61f3462e3fd295bc12292623ad3cf010c02ae9cc3295a64b0770f` | Port and executable identity only; SQL server version readback, schema/roles/RLS/owner epoch/lease state/postmaster 100ns birth **UNKNOWN** |
| Installer receipt | local proof SHA-256 `321bb1ad97af03856ed67ea6fe2c4fd71651d95dea1e3fd98b9e47c0f49074e8`; expected version `0.7.0-dev.1107139874568.1`; `install_exit_code=0`, `browser_visible=true`, `runtime_import_verified=false`, `version_probe_verified=false`, `authority_effect=false`, `automatic_retry_allowed=false` | Physical installer effect occurred earlier, **NOT** stable imported runtime, auth/readiness or installed task continuity |

## C. Explicit unknown / no-go decisions

1. **UNKNOWN: secrets rotation and historical Git leakage closure.** No credential contents or private config values were printed or committed by this audit. Confirmation of revocation requires a separately authorized source.
2. **UNKNOWN: genuinely release-signed binary/installer provenance.** Neither self-reported manifest values nor unsigned QA artifacts can authorize Owner/runtime upgrade.
3. **UNKNOWN: native Owner/Guardian before/after exact birth and protected identity, project/epoch/generation/source custody.** Windows PID/service state cannot satisfy W74–W76.
4. **UNKNOWN: SQL state, AMBIGUOUS effects, W30 leases, W39 durable completions, and PG17 backup/restore readback.** No SQL call was made against user's attached DB.
5. **UNKNOWN: complete GitHub CI count beyond retrieved PR-triggered runs**; earlier 13-run statement vs current provider's 12 remains unresolved.
6. **BLOCKED: current installed client and next signed release promotion.** The old Owner pin and new bundle mismatch must not be bypassed. Release version is already reserved to older SHA.
7. **BLOCKED: code deletion or RSI advancement.** Static graph classifications are still heuristic and no complete physical coding-loop evidence exists.

## D. Next action / independent acceptance

- **G0.2 / independent evidence review:** Verify source-to-staged-to-installed provenance, inspect relevant *existing authenticated* native Owner/Guardian readers and fixed scoped own-PG17 read-only provider with full trust boundary. Obtain a fresh exact native PID+100ns birth and project/Owner/epoch before/after readback; if authorization is unavailable keep UNKNOWN rather than weakening the gate. Verify secret revocation separately without disclosing keys. Reconcile the missing CI run through a full authorized GitHub Actions source (the current API is PR-filtered).
- Only when a disjoint verifier accepts the evidence ledger and all essential G0 gaps are adequately enumerated can G0 move to VERIFIED; G1 remains independently blocked by signer/authenticated upgrade trust.
- **No live mutations performed in this readback:** no Browser/Guardian/PostgreSQL restart, no installer invocation, no OS policy/ACL change, no Owner config rewrite, no SQL query, no secret disclosure, no promotion and no `main` merge.

## E. Source relationships

- [Binding execution register](../../../coordination/operator-control/AUDIT_CLOSURE_EXECUTION_REGISTER_20261018.md)
- [Unified roadmap](../../../coordination/operator-control/ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md)
- [ADF ADR](../../METAENGINE_AUTONOMOUS_DEVELOPMENT_FABRIC_V1.md)
- [Earlier incident recovery plan](./OWNER_RUNTIME_RECOVERY_PLAN.md)
