2026-10-10 current local candidate 0.7.0-dev.37781000035.1, continuation of PR #1176. Prior .34 source identity was reserved for ab0728d; its packaged PG17 cold-restart passed but managed-project authority fixture failed because direct postgres.exe refuses administrator runner tokens. This successor runs both disposable project integrations through the verified pg_ctl restricted-token owner process with exact PID/creation-time fencing. Local real PG17 integration tests pass 2/2. Prior .33 identity is reserved for f9d393e and its Windows package attempt failed the stale hard-coded RPC count 40 versus canonical allowlist 50. This successor compares the physical PG17 catalog to RPC_ALLOWLIST.length instead of hardcoding the older schema. Previous .32 source identity is already reserved for d3d715e and cannot be reused. The Linux host fixture now provisions owner-only 0700 storage without weakening production verification. The .30 identity belongs to predecessor exact source head 1406e3a and cannot be reused with this source. This successor mounts the private managed-project host, signs device-bound PostgreSQL admission and receipts, exposes typed create/open controls in the Code page, and unifies CLI/UI restart idempotency. Git executor environment and actual CONTROL heartbeat identity are fenced. Disposable PostgreSQL 17, real Git, Windows private ACL, loopback bearer, SQLite and host restart are tested together. Build reservation, physical packaging and installed-client qualification remain pending for this changed source. Project-wide history, automatic project admission for new goals, durable recursive fan-out and a qualified isolated verifier remain incomplete. Historical notes below describe earlier heads.
2026-10-09 immutable diagnostics successor 0.7.0-dev.37781000024.1 to .23 (which failed Win32 ACL physical test on 15s powershell_timeout despite pinned trusted PSModulePath). This build preserves sealed offline PostgreSQL/Vault directory DACL and exclusive inherited copies but adds FIXED nonsecret phase markers to the internal PowerShell ACL script, then reports at most the last fixed stage identifier (never raw stdout/stderr or a Windows profile path) if it fails/times out. It also passes a strict whitelist of standard Windows PowerShell startup environment keys (APPDATA, LOCALAPPDATA, HOMEDRIVE, HOMEPATH, PATH, PATHEXT, COMSPEC, TEMP/TMP etc) while PINNING PSModulePath to the immutable trusted SystemRoot modules, blocking arbitrary user modules; no shell or script interpolation. Physical owner-only ACL and real PG17 staged clone/start/query/stop MUST pass on exact Windows head before promotion. No existing PGDATA or Vault modified. Previous .21/.22/.23 version IDs are consumed, not reused. Unresolved: user's actual private restored PGDATA and ChatGPT direct pairing, hosted Supabase legacy and signed release.

2026-10-09 immutable candidate 0.7.0-dev.37781000024.1. Real .21 Windows PostgreSQL 17 auto-prepare DACL qualification FAILED with a 30-second PowerShell/ACL confirmation timeout, so no .21 Windows package promotion was authorized. .22 introduced regression-fixture repairs, but production Win32 environment is unchanged. This .23 successor gives the fixed -NoProfile/-NonInteractive/-EncodedCommand OS PowerShell invocation an explicitly PINNED trusted Windows system PSModulePath and minimal TEMP/TMP/USERPROFILE environment for System module auto-loading; no user module/PATH script injection, no raw errors or paths in logs. Timeout is now explicit fixed category with no unsafe retry, and tests prove exact module path, no credentials inherited or caller paths embedded in code. The code still protects dedicated new PG17 state before copy, verifies inherited file ACL and streams files under the sealed parent, preserving old DB and Vault. Real Windows ACL and physical PostgreSQL start/stop, Browser Critical Audit, full Node suite and NSIS package smoke all MUST pass exact head before promotion. No installed private owner PostgreSQL/ChatGPT pairing/Supabase final replacement claim. Earlier .21 and .22 package identities remain consumed and immutable.

2026-10-09 immutable next candidate 0.7.0-dev.37781000024.1: the earlier .21 source was physically reserved, and test-fixture corrections cannot reuse that version. This successor preserves Win32 owner/SYSTEM/Administrators DACL readback and exclusive inherited stream copies for restored PG17 private state, fixes mock verification to distinguish VERIFY_DIRECTORY from VERIFY_FILE, and makes the negative Vault ACL test allow directory protection before refusing file access. Fresh Linux/Windows exact-head tests and real Windows PostgreSQL/NSIS package smoke are REQUIRED before claiming physical qualification. Never alter original PGDATA/Vault/config; no automatic retries or secret exports. Real owner PC, client remote pairing and Supabase removal remain separately unqualified.

2026-10-09 immutable next candidate 0.7.0-dev.37781000024.1, derived from fully Windows/PG17/NSIS qualified .20 exact commit 645a3ea0cc68da05982a044a458c34b16e596141, which MUST NOT be rebuilt with changed source. New first-run security hardening: owner-only Windows DACL is applied and read back on the dedicated new permanent PostgreSQL state before copying any private data. No Windows chmod/mode assumption. Exact current Windows owner, LocalSystem and Administrators have inheritable full control; unknown inherited/explicit grants fail closed, no private file is committed until secure directory. Restore copy uses exclusively created NEW streams, not Windows CopyFile which can carry original TEMP file security ACLs. Staging and final data directories and new private config/Vault/global pg_control/proof inherit and undergo DACL readback. Failure leaves existing partial state for deliberate local reconcile, never automatically retries, never touches old PGDATA/Vault/private config, never uploads credentials. Direct adversarial ACL test and real Windows PowerShell ACL test; inherited physical PG17 clone/initdb/SQL tests in Windows Package Smoke. Historical Supabase runtime migration, installed user's private DB/owner hot/cold boot, signed publisher release and live ChatGPT GitHub pairing still NOT proven by CI. Only describe this candidate as qualified after exact-head Windows smoke and critical tests success.

2026-10-09 UNIQUE immutable successor 0.7.0-dev.37781000024.1. This release candidate adds a strict GitHub-chat result egress projector: a private GitHub issue is NOT a credential archive. Outbound STATUS/COMMAND_RECEIPT/GOAL_PROOF and other result payloads retain only typed metadata, hashed IDs and validated private-repository artifact paths; all secrets, DB URLs, paths, environment, process output, browser titles, arbitrary page/goal/agent text and unbounded/cyclic data are scrubbed or fail-closed. Existing on-device journal retains raw result for owner-only reconciliation. Unit tests and actual mocked GitHub issue publishing test now exercise disclosure prevention. Predecessor .19 physically qualified Windows PostgreSQL AUTO-prepare is separate immutable exact SHA 9013c689; .20 inherits code with egress patch but must repeat full critical regression and Windows Package Smoke. Screenshot PNG pixels may contain sensitive information and are intentionally not content-redacted; require owner awareness and future image retention controls. Physical user installed private PG17/Vault, local paired GitHub issue and actual ChatGPT initiated PC command are NOT proven by public CI.

2026-10-09 — immutable local PG17 physical qualification candidate 0.7.0-dev.37781000024.1.

Earlier .18 source head a65f87d3… was correctly blocked by Windows Package Smoke because the version had already been reserved on older commit 458e9f12…; NEVER replace/reuse previously reserved package identity. This new .19 source includes safe config/SQL role-port-state/timeouts validation, clean per-device locale-stable pg_controldata, real Windows PG17 integration that starts the AUTO-PREPARED durable CLONE using sealed PostgreSQL, reads SQL server_version and pg_control_system identity, stops cleanly and checks Vault unchanged. Host-owned immutable source and reviewed per-file copy, original PGDATA/Vault/config read-only, no cloud fallback, no automatic retry on ambiguous effects. Includes independent original-clone identity checks, anti-self-attestation, independent restore receipt pin and isolated one-shot restored provider handoff. Stop before making any state change when old config/report/clone/pid/role/port state does not satisfy local contract. Exact source SHA and Windows package CI are required before this version may be described as a qualified unsigned installer. No user's private Windows PGDATA or running ChatGPT GitHub control is included or claimed verified.

2026-10-09 new immutable 0.7.0-dev.37781000024.1: distinct from .17 already reserved by its earlier physical producer source. Added real Windows PostgreSQL 17 integration test in browser-windows-package-smoke: initialize a disposable genuine checksum/SCRAM PG17 using sealed bundled initdb, make a stopped TEMP clone, run auto-prepare on the clone, verify SHA-256 copied files, Vault, global/pg_control, old config immutability and new installed-bundle private config; refuse repeat. Runs with physical PG durability tests serially to avoid resource contention. Includes earlier self-attestation original-identity fix and tests verifying the one-shot reviewed operator handoff. Required next: all source critical audits and exact-head Windows Package Smoke GREEN; *installed owner's real PGDATA, ChatGPT pairing, and physical agent execution remain unproven*. No stored private credentials or real PGDATA included in package.

2026-10-09. Fresh unique candidate 0.7.0-dev.37781000024.1: .16 source identity was already reserved by prior source head a151c908 before the final exact head and was properly rejected with PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED. This successor also closes source/self-attestation: TEMP selected PGDATA MUST be independent of the original pg_data_directory recorded in prior private config before comparing Vault and PostgreSQL system identifier. Adds full installed operator handoff integration tests to show auto prepare receives independent restore pin and staged new config before reviewed CLI, with denied operator start on copy failure. Full source/Windows critical and NSIS physical tests MUST be rerun on this exact SHA. Prior .16 had green source/Browser suites but Windows package identity failure. No user-PC private restored DB/cold boot/remote GitHub chat live claim.

2026-10-09. DISTINCT immutable 0.7.0-dev.37781000024.1 successor: .15 physical CI producer had started before stronger original-cluster identity check was added, therefore .15 is consumed and MUST NEVER be silently relabeled. The copied cleanly shut-down TEMP PGDATA now must match BOTH the original read-only Vault key bytes and PostgreSQL system identifier obtained from bundled pg_controldata on the exact old-config PGDATA. The original can report 'in production' and is never started, stopped, cleaned or copied; the TEMP source and staged clone must each report 'shut down' and the same system identifier. Tested mismatched Vault/system ID fail before writing target state. Other controls unchanged: independent restore-report SHA verified before copy; full file/directory SHA comparison; installed bundle pin and new private config; no overwrite or retry. Physical on-owner-PC PGDATA and ChatGPT pairing remain unqualified.

2026-10-09. New immutable 0.7.0-dev.37781000024.1 installed Windows local-only PG17 owner onboarding successor of #1169. With owner-provided existing private runtime config and independently pinned restore report, the first-run wizard verifies the exact reviewed offline bundle, discovers ONE cleanly shut-down PG17 clone under the local TEMP compute-restored-provider-* family, checks PG_VERSION/global/pg_control/Vault/external tablespace boundary and pg_controldata, then copies to absent %LOCALAPPDATA%/METAENGINE/restored-postgres-17/data, including empty PostgreSQL directories. Each file is SHA-256 checked source→destination and source rehashed after copying; original PGDATA, Vault and old config untouched. A NEW private runtime-host-config.json in the protected per-user durable state points at the current installed bundle digest and persistent PGDATA. Only after independent pre-copy restore report verification does the previously reviewed operator start and stop this exact PG17 and write a previously absent owner descriptor, permitting Browser READY. Existing target, ambiguous candidates, source drift, symlink/hardlink, stale pid, failed shutdown, external tablespaces, report/digest mismatch all stop before owner registration; no automatic retry or cloud fallback. Standalone offline CI is NOT proof of the user's currently installed private DB, original source identity beyond the pinned report or ChatGPT pairing. Source-only change with full source-check tests and Windows Package Smoke. A later package identity must replace 0.7.0-dev.37781000024.1 if physical build starts and source changes.

2026-10-09. Source-only grant hardening successor 0.7.0-dev.37781000024.1 of PR #1168: the exact current .13 immutable installer candidate is consumed. The GitHub inbox REVOKE operation must remain executable by its authenticated paired operator even with OBSERVE-only permission. Every other operation preserves its existing scope checks. New regression asserts preemption of pending observations and persistent revocation after process restart. Existing Supabase-hosted R83 v14 canary equivalence mismatch is pre-existing source drift, NOT proof of an installed LOCAL_POSTGRES failure; never change the deployed pin to turn the gate green. Private owner PostgreSQL and on-PC ChatGPT/GitHub pairing still require physical qualification. GitHub relay result egress privacy remains a separately open security review; avoid promoting this test candidate to a production release.

2026-10-09. Complete-suite CI recovery: .12 / 0efcffe96ebe93941669c8ed752ae16afece3f59 produced an immutable Windows candidate in Package Smoke run 37827731973, so that identity is consumed. Full-suite jobs stalled on a remote-support MCP stdin listener after an invalid UNC-path assertion; the RSI source test also crossed into unrelated chat functions. Successor `0.7.0-dev.37781000024.1` requires explicit drive-rooted provider paths, separates programmatic MCP requests from CLI stdio, releases transport listeners on close and revokes grants on disconnect. Regressions cover late observation suppression, queued effect denial and all three provider path fields. The RSI check is bounded to the attribution function without weakening its assertions. No CI timeout is increased and no test or release gate is disabled. Fresh exact-head CI/package evidence is required; restored owner-PC qualification remains separate.

2026-10-08. Windows CI follow-up: the .11 source identity is consumed. The new short syntax-check entry preserves the complete reviewed file catalog and spawns one Node check per file without cmd.exe concatenation. The local-provider entrypoint fixture now exports the inert BrowserWindow/ipcMain bindings required by the inherited installed setup wizard; production startup gates are unchanged. Exact successor identity `0.7.0-dev.37781000012.1` requires fresh source and package qualification.

2026-10-08. GitHub chat control successor of PR #1167, new package identity `0.7.0-dev.37781000012.1`. An installed local-provider client can pair an existing private GitHub repository from Settings / Runtime. A dedicated inbox delivers authenticated chat requests, observations, screenshots, native commands and existing Client V1 goals. Device-signed admission uses the existing local PostgreSQL issue/lease/effect/receipt path; no second scheduler or hosted fallback is added. Local and chat revocation are persistent and rechecked before queued chat command execution. Delivery claims prevent replay after uncertain admission or restart; credentials remain encrypted in the local profile. Public Compute contains source only. This is a source candidate, not evidence of a connected owner PC, installed release, physical restored-PG17 qualification, final-runtime promotion, or Windows control of privileged/secure desktops. See research/CLIENT_GITHUB_CHAT_CONTROL_HANDOFF_2026-10-08.md.

2026-10-08. New distinct package identity 0.7.0-dev.37781000010.1: replaces consumed .09.1 physical producer after CI exposed stale direct-bootstrapState static assertion in test/persistent-local-provider-boot.test.mjs. The source requires a second local owner admission after the consented installed first-run wizard, and MUST NOT bypass requirePackagedLocalProviderAdmission or launch the Browser before READY. Test now checks dynamic bootstrapState and imported order while preserving original fail-closed guard. Existing .09 package identity is consumed. No live private database or MCP ChatGPT pairing claim.

2026-10-08 first-run local owned PG17 setup successor PR #1166; 0.7.0-dev.37781000010.1. Windows packaged NORMAL launch without owner descriptor opens isolated offline Electron setup dialog before any Browser, HostResilience or default Supervisor imports. Owner chooses private runtime-host JSON and reviewed restore report JSON and enters independently recorded SHA-256, confirms in a second native local dialog. The protected ASAR verifies immutable bundled offline runtime and selects its Node and reviewed restored-client-provider CLI. This never embeds PGDATA/passwords/Vault keys or falls back to hosted Supabase, never initdb/pg_restore, and never overwrites a pre-existing owner. The private config must ALREADY be bound to the exact selected immutable bundle, and selected PGDATA must be stable and stopped, otherwise the operator fails closed; the original cluster with stale PID is not eligible. A previously stopped %TEMP% snapshot is not production PGDATA until independently copied to a protected durable directory. A successful profile attach is followed by normal local-provider health bootstrap. All local setup effects are one-shot; no automatic retry on ambiguous result. This does NOT prove live connectivity to the owner's private Windows PostgreSQL nor a ChatGPT-to-PC MCP tunnel; neither is established by hosted CI alone. Pre-existing installed package versions remain immutable. Updated first-run installed setup tests and offline Windows package qualification.

2026-10-08 NEW candidate 0.7.0-dev.37781000010.1 — one-shot locally double-approved restored PostgreSQL 17 provider operator over the EXISTING owner-launched MCP stdio server. It is NOT a ChatGPT-connected remote MCP tunnel, auto-copier of original PGDATA, installed boot qualification or released installer. No secrets or private state are packaged. DB_CONNECT is 10-minute isolated session; second DB_CONNECT_COMMIT consent displays selected config/AppData and is required before the reviewed restored-client-provider operator starts/stops an existing selected PostgreSQL and writes an absent owner descriptor. Revocation and partial effect are AMBIGUOUS and NEVER retried automatically. Requires existing private runtime-host config, full restore report with independent digest, correct pinned offline bundle, stopped PGDATA and Vault. New source closure and tests include operator dependencies. Original stale postmaster PID forbids direct use; user must independently select qualified stopped permanent clone. Source-only package smoke validates offline resources, not live private DB or ChatGPT remote tool invocation. All required physical private tests and secure ChatGPT MCP tunnel remain blockers tracked in #1159.

2026-10-08 offline package qualification successor of PR #1164: source change for a NEW immutable candidate 0.7.0-dev.37781000010.1. The selected restored PostgreSQL PGDATA and original Vault key remain private and excluded from NSIS. Current Windows Package Smoke failure was normal_ui_stable_window_timeout because an unprovisioned GitHub CI profile correctly fail-closed with local_state_packaged_owner_not_ready. The local-only successor MUST run full offline package/resource/profile/Guardian verification, but MUST NOT assert hosted/default-cloud normal UI boot or historical cloud enrollment against a runner without the owner's restored PostgreSQL. Offline profile probe is retained; physical installed LOCAL_POSTGRES boot, MCP remote pairing/transport and automatic DB attach remain UNQUALIFIED and require separate tests on owner's Windows machine. Tests guard that physical package producer is still enabled while legacy hosted jobs are held only for this exact PR head.

# METAENGINE Browser convergence candidate

2026-10-08 owner-requested MCP PostgreSQL discovery successor of PR #1163. Exact locally consented FILES scope (metadata-only) and CONTROL scope can search accessible Windows fixed-drive directory/file names to locate candidate existing PGDATA by PG_VERSION + global/pg_control. The search has bounded directory/entry/time/result caps, excludes reparse links, has generation/expiry/revocation fencing, never reads file contents, secret keys, passwords or executes arbitrary shell. It does not mutate/initialize/connect to an existing PostgreSQL, automatically create owner config or invent remote transport. Root scope is all ready fixed drives that the installed user's Windows token can access; inaccessible or excluded directories and truncated scans are explicitly reported. VIEW scope cannot perform file searches, FILES scope cannot view screen or control OS. Windows owner approval explains scope. Earlier `0.7.0-dev.37781000005.1` was physically built; it failed installed UI qualification due to missing owner config and is consumed. New distinct `0.7.0-dev.37781000010.1` must complete source and physical qualification before installer rollout. Preserve restored PGDATA and Vault. Remote ChatGPT-to-PC MCP tunnel remains unconnected.


2026-10-08 follow-up of PR #1161 / issue #1162: source-only remote support MCP consent and revocation race hardening. New generation/epoch fence prevents a late Windows approval, private observation or image from surviving stop/expiry; a dispatched possible mutation that races with stop is classified AMBIGUOUS with automatic retry denied. The stdio stop tool bypasses an unrelated in-flight request queue to revoke immediately, but cannot cancel an already-running OS effect. Added deterministic deferred-promise and stdio-preemption regressions. Previous `0.7.0-dev.37781000004.1` Windows Package Smoke producer was started and is consumed; this change requires fresh `0.7.0-dev.37781000005.1` exact-source physical qualification. No remote tunnel, private restored PGDATA/Vault change, production rollout or user-machine installation is claimed.


2026-10-08 successor of PR #1160: exact reviewed Windows MCP source closure fix. Runtime source bundling previously rejected the three approved browser/src support modules with `bundle_unexpected_source_record`; both Windows/Linux contract jobs and the NSIS producer failed before package creation. This candidate permits *only* the named support entry, Windows executor, and computer authority module, retaining digest pinning, import-closure matching and unexpected-source rejection. Added positive/negative closure tests. Previous 0.7.0-dev.37781000003.1 package reservation and failed CI are consumed, not release evidence. Hosted CI cannot prove real ChatGPT-to-PC connectivity or restored private-PGDATA UI readiness.


Candidate package identity is `0.7.0-dev.37781000035.1`; the physical build reservation remains pending for this head. The prior `.30` source identity is consumed; its Windows package job was cancelled. No changed source may reuse a predecessor identity.

Remote support MCP source regression follow-up: an unselected host source bundle with the new remote support entry is correctly rejected at `bundle_unexpected_source_record`, before the former `reviewed_source_closure_mismatch` guard. Update the exact negative test to accept either fail-closed branch; keep all source-hash and manifest enforcement unchanged. `0.7.0-dev.37781000002.1` was reserved by Windows Package Smoke and is permanently consumed.

Scoped remote support MCP successor: explicitly started stdio tool exposed only via a separately configured private secure tunnel. One on-PC VIEW or CONTROL approval starts a maximum 60-minute session, then **no per-action confirmation popups**. A CONTROL grant also permits observation; after expiry or support_stop all effects fail closed and renewal requires a new locally launched process. Existing computer-authority DB lease, agent, target identity, readback and ambiguity fences are not relaxed. This MCP host neither auto-starts on Electron boot nor listens publicly or executes arbitrary shell. Tested source packaging includes its audited full import closure in the pinned offline runtime bundle. Earlier `0.7.0-dev.37781000001.1` has already been built and consumed; this source requires the fresh package identity.

Restored PostgreSQL successor: continue from PR #1157 using the owner's previously restored PostgreSQL 17 database and original Vault key. Fresh initdb remains an optional experimental action and is never invoked on existing PGDATA. Align the packaged first-run source closure with runtime startup verification; qualify Windows PostgreSQL using the actual restricted-token postmaster identity rather than the short-lived pg_ctl helper PID. Explicit restored-provider preparation independently checks the existing schema, local health and shutdown before exclusively publishing a credential-free owner profile. Private dumps, PGDATA, passwords and keys are excluded from GitHub and installers. Hosted enrollment/upgrade/soak jobs remain held for this local-only branch; public package CI does not have the private restored database and cannot establish normal client readiness. Source, resource, fresh synthetic durability and package checks remain active.

Read-only PG17 schema readiness inventory: the already-bundled db-api-core now checks catalog rows for 40 RPCs, 5 table shapes, service_role and pgcrypto, never granting initialization or readiness even if catalog entries are present. Windows physical cold-restart requires the new cluster to report BASELINE_SCHEMA_MISSING. Earlier `0.7.0-dev.37780000019.1` reserved source identity consumed; this new head must pass exact CI.

First-run physical durability successor: Windows Package Smoke runs a fresh, pinned offline PG17+Vault initdb followed by a real loopback postmaster write→stop→cold restart→SQL readback and immutable Vault-key check, on a disposable owned CI cluster. Clean cluster intentionally lacks native supervisor SQL baseline, so this proves database durability only, not installed client READY. Earlier `0.7.0-dev.37780000018.1` identity consumed.

Complete Browser SBOM/ASAR fixture for new explicit first-run entry: stage and checkout now contain identical synthetic fresh PG17 initdb source and hash/manifest binding. This retains the production offline source gate rather than weakening it. `0.7.0-dev.37780000017.1` CI had seven test fixture failures and is superseded.

Reviewed runtime source manifest now binds fresh-PG17-plus-Vault initializer and static closure. Offline bundle rejects source missing entry. This only stages trusted source; normal Browser boot does not invoke initdb, SQL schema and local owner onboarding remain blockers. Prior .16 identity consumed.

First-run PG17 and Vault key in same exclusive owner transaction, Windows physical test: correctly validate private 64-digit key plus LF terminator; previous code accidentally double-escaped newline in test regex. Prior 0.7.0-dev.37780000015.1 candidate consumed.

Optional fresh-PG17-plus-Vault transaction: exact explicit action creates a private Vault key only inside the already-exclusive fresh initdb transaction after structural validation, before lock release. Failure retains a review lock and partial PGDATA; full Windows physical test validates key absence from outputs and key file. `0.7.0-dev.37780000014.1` is consumed, cannot qualify this head.

Windows regression: synthetic SCRAM password path, like binary path, must compare physical file identity rather than 8.3/long-name spelling. Prior .13 source/identity is consumed; exact Windows contracts and physical initdb need fresh qualification.

Physical initdb Windows CI job restored to a unique step in proven valid workflow. Earlier workflow YAML was duplicated and was rejected before GitHub could schedule it.

Restore complete Windows CI physical initdb workflow step (a previous YAML write was truncated), retain exact source-cleanliness gate, and reserve a new source identity. `0.7.0-dev.37780000011.1` is consumed and invalid for this source.

Windows first-run test portability repair: compare realpath identities of verified initdb executable, not short-name spelling; accept Windows PG_VERSION newline normalization. Predecessor `0.7.0-dev.37780000010.1` was reserved and cannot qualify this changed head.

Physical first-run PostgreSQL 17 qualification: the Windows Package Smoke producer now runs real bundled initdb.exe from the independently pinned staged offline resource tree on a disposable synthetic cluster before building the installer. It checks SCRAM settings, exclusive no-overwrite/retry semantics and no owner/profile writes. `0.7.0-dev.37780000009.1` is consumed; synthetic tests on that earlier head do not qualify the new exact source.

Explicit fresh-PG17 initdb successor: separate owner-reviewed command can exclusively create a new SCRAM/UTF8/checksummed PostgreSQL 17 data directory after pinned offline-resource verification and repeated clean layout checks; never adopts an existing cluster or cleans partial data. The result is UNPROVISIONED, not Browser-ready, and source has no normal-startup caller. `0.7.0-dev.37780000008.1` package identity is consumed and cannot qualify these bytes.

First-run read-only preflight successor: a private-state/layout classifier rejects PGDATA/owner/config collisions and ancestor reparse points, reporting safe bounded state WITHOUT authorizing initdb or storing secrets. Includes Windows/Linux tests in Client State Runtime Contracts. Prior `0.7.0-dev.37780000007.1` candidate source/bytes may not qualify this new version; packaged-first-run activation remains blocked pending trusted provisioning.

Hardening follow-up: even idempotent ALREADY_CONFIGURED owner admission now checks the entire physical directory ancestry before acceptance; a symlink/junction parent cannot masquerade as the existing safe owner. Added an installed-platform portable regression. `0.7.0-dev.37780000006.1` is consumed; prior green CI cannot be reused on this source.

Owner-file non-overwrite successor: invalid or conflicting local provider configuration can no longer be replaced via a weak `replaceExisting` path; a reviewed migration CAS is required. Adds same-owner idempotence, symlink/hardlink/corrupt file negative tests and concurrent exclusive publication. No database/owner profile is migrated by this code. `0.7.0-dev.37780000005.1` is consumed and cannot be reused.

Local-only packaged successor: the admitted normal/updated packaged primary must have an attested persisted LOCAL_POSTGRES owner before it imports HostResilience or main; absent config fails to a local diagnostic rather than choosing hosted fallback. Existing developer, diagnostic and smoke modes retain their compatibility behavior. This is a source-only first-run fence, **not** an automatic PostgreSQL initializer or proof of usable installed onboarding. The prior `0.7.0-dev.37780000004.1` identity is consumed; new source requires independent exact Windows, local-host and physical evidence.

Runtime-host physical-boundary successor: enforce realpath-based disjointness of immutable offline resources/source vs private PostgreSQL PGDATA/config after rejecting reparse-point ancestors. The previous `0.7.0-dev.37780000003.1` identity is consumed; do not reuse it for new bytes. This is a new exact-source candidate requiring Windows/Linux contracts and physical package/self-update qualification, not a published or installed release.

Client-owned offline runtime successor (2026-10-08):
- Continues source `9241f4566ee7bb9ab54a1da5ef98de27cb36c56b` from PR #1143 with whole-stack restart qualification, singleton admission before provider health, and a managed local runtime host.
- Bundles reviewed source, pinned Node 24.21.0, Deno 2.9.7, PostgreSQL 17.11 and the locked postgres dependency cache. Private DB data, credentials and owner configuration are excluded from package resources.
- Package metadata binds the runtime resource manifest and the trusted verifier inside app.asar. Normal primary boot can start the explicitly provisioned local host; secondary launches and installer control avoid starting another host.
- The previous installer `0.7.0-dev.37628000001.1` is a consumed identity. This new version requires its own source qualification and physical Package Smoke build. No installed upgrade, canonical C1/C2 result or release publication is asserted by the reservation.

Pre-install critical audit successor (2026-10-07):
- Runtime source `83aaafaf485e2bca50cadaaf058f87837e8d002f` passed source qualification run `37623582505`: 4351/4351 Browser tests on Windows, six isolated Bun RSI lifecycle tests, locked UI TypeScript and boundary lint.
- Intermediate source `4570959b89c46f5084d3ae056f1751e2f725a76e` reserved `0.7.0-dev.37624000001.1` in Package Smoke run `37624314402` and reached physical NSIS build with `0.7.0-dev.37624000001.1`; its reservation is consumed. It is withdrawn as a final candidate because the top convergence ledger still named the previous package, correctly failing the full contract gates.
- This atomic successor changes package.json, both package-lock root version fields, this authoritative reservation and the audit report together. Runtime code, dependencies and behavior tests remain byte-identical to the qualified source.
- Confirmed source repairs cover local relay boundaries, sidecar ownership, read-only root bootstrap before effect fences, budget/freshness routing, truthful readiness, shared UI observations, memory request races and immutable advisory RSI drafts.
- All source and installed-package consumers must qualify this exact successor. Package Smoke remains the sole physical producer; never rerun or relabel the consumed intermediate.
- No user-machine install, canonical C1/C2 success, continuous-autonomy result or evaluated self-improvement is asserted by this reservation.

The bootstrap predecessor `d71307ad6d4340b11d9be16942766166a2f90e5d` consumed `0.7.0-dev.37597000001.1`. Its PostgreSQL 17.11 qualification passed, but Browser recovery jobs failed before tests because depth-2 checkout omitted immutable regression subject `45d73aa24b852d9de93e9af9c62808e65136c33b`. Full history now makes that pinned comparison independent of descendant depth; no old installer identity is rebuilt.

This successor adds a device-bound bootstrap lease for the approved installed client when supervisor mesh is empty. It shares the existing client actuation lane, validates active ADMIN device grants and fresh exact fleet bindings, and never creates a synthetic mesh member. Prior source `8300ff4249546ec254fddc9866157a257ff0ab54` / `0.7.0-dev.37593000001.1` passed its recovery mechanics and Windows package workflows; that identity is consumed. Physical qualification of this successor remains required.

This successor prevents advisory worker captures from starving the scheduler-owned DevOS turn. Advisory capture has one independent in-flight read slot; an admitted DevOS turn excludes a new maintenance pass, while remote command admission and authoritative task fences remain first. Regression CI replays the prior immutable wiring and requires the observed starvation assertion before qualifying this successor.

The prior `45d73aa24b852d9de93e9af9c62808e65136c33b` / `0.7.0-dev.37592000001.1` passed full mechanics and produced installer SHA256 `39318750775fa20d7612b0edb0cb331741eaeb42c57e511b63ece035ef403379`; that identity is consumed and is not offered as the final live successor. Rich-text placeholder and honest actual-insert accounting fixes are inherited.

Current live mechanics recovery successor (2026-10-07):
- Previous installed package identity is `0.7.0-dev.37493000001.1`.
- Previous qualified package identity is `0.7.0-dev.37597000002.1` from frozen source `43f2bb8d5e1090bad68ce9942eac40d2deab4b66` / Package Smoke run `37608920991`.
- Candidate `0.7.0-dev.37590000001.1` was reserved for #1139 head `ee91bc3efb755bac6dc9ff34908b532ecc9d95b4`; its CI is in flight and that identity is consumed for any future source change.
- This successor fixes package reservation consistency, includes event-triggered recovery from a repaired cognitive HTTP route, preserves READ_ONLY Meta tasks and inherits the state-plane single-writer repair.
- Full prior-head Windows mechanics: 4268 PASS / one reservation mismatch / zero skips. Linux: 4264 PASS / the same reservation mismatch / four platform skips. Both require exact successor-head requalification.
- No installed successor, autonomous task completion, Guardian ownership, release publication or sandbox execution is asserted.

The following sections record earlier consumed convergence identities and their historical qualification scope.

Installed observer successor after full dark-workspace retirement (2026-10-06):
- exact predecessor `0f9b2aeca26c145163d92dbb32a3961a18e1dac5` / `0.7.0-dev.37491000001.1` successfully produced immutable Windows candidate bytes in Package Smoke run `37492085860`; that source/version identity is consumed and MUST NOT be rebuilt or relabelled;
- Installed Chat run `37492085738` and Autonomous Soak run `37492085795` both consumed those exact bytes and failed only in stale physical observers that still accessed removed field `legacy_shell_is_normal_path`;
- diagnostic runtime output proved the current healthy event contract instead: `ME2_PRIMARY_SHELL_VISIBLE`, `shell_mode=ME2_PRIMARY`, `deprecated_shell_bundle_present=false`, `recovery_surface_authority=false`, followed by `ME2_R97_UI_CONTRACT_CONFIRMED` and ChatGPT preconnect;
- observers now bind to those current fields and explicitly fail if the deprecated shell bundle is present or recovery authority is enabled;
- source regression coverage forbids reintroduction of `legacy_shell_is_normal_path` in those installed observers;
- this SAME atomic successor reserves fresh package identity `0.7.0-dev.37493000001.1`; no runtime authority, provider mutation, release publication or canonical C2 promotion is granted.

DevOS bounded source snapshot successor after legacy-shell retirement (2026-10-06):
- exact predecessor head `92f9967324d5da2103c5c9d3f4b63e2b89e421f1` entered Package Smoke run `37490042782` under `0.7.0-dev.37490000001.1`; identity preflight, duplicate protection, immutable reservation publication and reservation seal all succeeded, so that source/version pair is consumed and MUST NOT be rebuilt or relabelled;
- immutable reservation artifact `11424936946`, digest `sha256:a0ed8df6d7ba487de23d931a9ced8b82b7807f6e2c807b8f7148cc25552c6f1d`;
- full Browser source regressions, C4 contracts, Shell, PRE-LIVE evidence and fleet/brain stress gates were green, but physical Windows package job `112360142997` failed at NSIS beforePack with `ENOENT: apps/metaengine-browser/ui/app.js`;
- root cause was a hidden host-fixed source dependency in `scripts/devos-source-snapshot-builder.cjs` and the matching read-only DevOS repo model, both still naming the retired legacy renderer after `apps/metaengine-browser/ui/` had been deleted;
- this successor keeps the bounded two-file source contract but rebinds it to `apps/metaengine-browser/src/main.mjs` plus the current primary ME2 shell `apps/me2-ui/src/components/me2/shell/me2-shell.tsx`; no arbitrary renderer path selection or authority is added;
- stale DevOS/RSI fixtures are updated and the source-only convergence workflow now runs these snapshot/read-model contracts before any Windows package reservation can be accepted;
- this SAME atomic successor advances Browser package metadata and convergence evidence to fresh identity `0.7.0-dev.37491000001.1`;
- any later source mutation after `0.7.0-dev.37491000001.1` preflight begins requires another fresh monotonic package identity; no rerun/relabel of `0.7.0-dev.37490000001.1` is permitted.


YAML validation correction before physical reservation (2026-10-06):
- commit `a5628c46c9632ef97ba9b1236be964fc40a12125` attempted the PE metadata correction, but GitHub rejected workflow `browser-windows-package-smoke.yml` at validation time in run `37487828226`; there were **zero jobs**, no package preflight and no reservation artifact;
- follow-up run `37488295856` also had **zero jobs and zero artifacts**, so package identity `0.7.0-dev.37490000001.1` was never physically reserved and remains eligible;
- exact root cause: a JavaScript replacement-string edit corrupted the embedded PowerShell/YAML block before workflow validation;
- the repaired workflow is reconstructed from the last valid source and validates Electron PE metadata without launching the GUI-subsystem binary as a CLI probe: ProductVersion is parsed as PowerShell `[version]` with exact Major/Minor/Build checks, binary presence and SHA-256 requirements.

Electron runtime materialization correction (2026-10-06):
- exact source `540f83c48501ca27a893cfcc4b62ea28e7c4f228` / package `0.7.0-dev.37485000001.1` passed package identity preflight and published+sealed immutable reservation artifact `11424395709` (digest `sha256:b370faf8f67ebfeca9c0ecab65825bc41479db5c2d4175389be4cd867cdea1c1`) in Package Smoke run `37487078168`;
- that run then failed at `Materialize exact Electron runtime for physical UI evidence`: `electron.exe --version` exited successfully but PowerShell captured no stdout from the Windows GUI-subsystem executable, leaving `$binaryVersion` null; no visual evidence, NSIS build or candidate artifact was accepted;
- the successor keeps materialization fail-closed without launching the GUI binary as a CLI probe: exact Electron package version `44.0.0`, binary presence, PE `FileVersionInfo.ProductVersion` matching `44.0.0(.0)`, and a valid SHA-256 of `electron.exe` are all required;
- regression contract forbids returning to `& $electron --version` / nullable stdout semantics;
- because `0.7.0-dev.37485000001.1` was already reserved and sealed, this SAME atomic commit advances package.json + package-lock + convergence/report metadata to fresh identity `0.7.0-dev.37490000001.1`;
- no further source mutation is permitted after physical Package Smoke begins; any later fix requires another fresh monotonic identity.


Final ChatGPT/ME2 physical reservation (2026-10-06):
- exact source `dc76192e9a8ed269c62355464c36b96048a67732` passed source-only convergence run `37484297121` / job `112340249904` SUCCESS with full Browser Node regression, frozen Bun install, full Next build, compiled-output legacy-provider scan and source immutability proof;
- deprecated `metaengine-dark-workspace-v2` and the entire `apps/metaengine-browser/ui/` renderer are absent; `metaengine://shell/` remains forbidden; packaged ME2 is the sole product UI and generated `metaengine://recovery/` is GET-only/non-authoritative;
- previous identity `0.7.0-dev.37437000001.1` is consumed: PR Package Smoke run `37477684780` succeeded through package identity preflight, duplicate source/version check, immutable reservation publication and reservation seal before later failing at then-stale visual evidence; that identity MUST NOT be rebuilt or rebound to this newer source;
- this atomic successor changes only package identity/ledger/report metadata and reserves `0.7.0-dev.37485000001.1` for exact source bytes already qualified at `dc76192e9a8ed269c62355464c36b96048a67732`;
- no further source mutation is permitted after physical Package Smoke begins; any source change requires another fresh monotonic identity;
- reservation grants no provider effect, production trust, release publication, scheduler authority or canonical C2 promotion.


C4 stale branding assertion correction (2026-10-06):
- exact source `2440c869b54bf96904f0a3e198a3a352854c9242` passed the ChatGPT UI source-convergence gate, but Client V1 C4 Goal Contracts run `37476944921` failed 87/88 because one test still required the retired presentation string `Verified z.ai Agent`;
- this is a stale assertion against user-visible branding, not a rollback of the historical internal wire token `ZAI_AGENT_SURFACE_CAUSAL_V1`;
- Package Smoke run `37476944927` had already accepted identity preflight for `0.7.0-dev.37436000001.1`; its Windows job then failed closed at duplicate source/version protection before dependency install or NSIS build, so no installer from that run is accepted, and `0.7.0-dev.37436000001.1` is consumed for governance purposes;
- this SAME atomic successor changes the stale assertion to `Verified ChatGPT Agent` and advances package.json + package-lock + convergence/report metadata to fresh identity `0.7.0-dev.37437000001.1`;
- the deprecated `metaengine-dark-workspace-v2` source bundle remains absent, `metaengine://shell/` remains forbidden, and packaged ME2 remains the sole product UI with generated read-only recovery only;
- any later source mutation after Package Smoke begins requires another fresh monotonic package identity.

Workspace projection test retirement correction (2026-10-06):
- predecessor identity `0.7.0-dev.37435000001.1` passed Package Smoke identity preflight on exact source `498a244a0484d0566bc91fa81fa1119175fb4eb0`; therefore it is consumed for governance purposes and MUST NOT be reused after any source change;
- Browser Typed Workspaces run `37435008436` exposed one stale falsification test that still opened deleted `apps/metaengine-browser/ui/app.js`; 23/24 tests passed and the sole failure was ENOENT at `shell-workspace-projection-wiring.test.mjs`;
- the repaired test preserves the original authority boundary by validating bounded DevOS projection acceptance in `preload-shell.cjs` and proving the current ME2 store does not reconstruct `workspace_bindings`, `lease_current`, exact binding identity or current command payload;
- source-only ChatGPT UI convergence now includes this workspace wiring test before any physical producer is accepted;
- fresh package identity is `0.7.0-dev.37436000001.1`; it is the only identity eligible for the repaired exact source, and any later source mutation after Package Smoke begins requires another monotonic version;
- no live provider effect, production trust, release publication, scheduler authority or canonical C2 promotion is authorized.


Legacy shell retirement successor reservation (2026-10-06):
- intermediate ChatGPT UI candidate `0.7.0-dev.37434000001.1` reached Package Smoke preflight on PR #1133 before the deprecated `metaengine-dark-workspace-v2` renderer was fully removed; that identity is treated as potentially consumed and MUST NOT represent the final source even if its Windows producer never emits an artifact;
- the final source removes the entire `apps/metaengine-browser/ui/` renderer bundle, all obsolete legacy-shell visual/UI tests, old Package Smoke visual capture, package inclusion `ui/**/*`, and runtime routing to `metaengine://shell/`;
- packaged ME2 is now the only product UI. ME2 failure routes only to an inline GET-only `metaengine://recovery/` document with CSP `default-src 'none'`, no script/form/input/button/network path, and `recovery_surface_authority=false`;
- `npm run check` no longer references deleted `ui/app.js` or `browser-shell-visual-evidence.mjs`; source-only convergence now runs full Browser parse checks plus ChatGPT/retirement/startup/policy contracts before any physical package is accepted;
- final fresh package identity is `0.7.0-dev.37436000001.1`. Any source mutation after its physical producer begins consumes this identity and requires another monotonic version;
- old package `0.7.0-dev.37416000001.1` remains the immutable installed LIVE-development baseline; no production trust, provider effect, release publication, scheduler authority or canonical C2 promotion is granted here.


ChatGPT primary UI convergence reservation (2026-10-06):
- parent LIVE-development candidate `e2e8f20e5d6abf0f84bf163066ed3ec15b69298a` / `0.7.0-dev.37416000001.1` remains immutable and physically qualified; it MUST NOT be rebuilt or relabelled with this UI correction;
- source-only ChatGPT UI convergence run `37433550089` / job `112169785397` is SUCCESS after one fail-closed predecessor run `37433449834` exposed a remaining command-palette z.ai label;
- primary ME2 UI now uses stable `ChatGPT` / `Agent` presentation without hard-coded model version; historical `ZAI_AGENT_SURFACE_CAUSAL_V1` remains only as a wire/readback compatibility token;
- legacy `GET /glm` telemetry remains read-only; UI `probe` / `upgrade fleet` mutations and `mcxOp("glm", ...)` are removed;
- unused `z-ai-web-dev-sdk` and dead GLM/vault `agent-factory/bootstrap.ts` are removed from the ME2 source/dependency surface;
- compiled Next output is fail-closed scanned for legacy provider branding/mutation strings;
- fresh Browser package identity is `0.7.0-dev.37436000001.1`; Package Smoke remains the sole physical producer and all installed/runtime/self-update consumers must qualify the same immutable candidate before this slice is considered physically proven;
- no production trust, provider mutation, canonical C2 promotion, scheduler authority, release authority or automatic retry is granted by this reservation.


LIVE development physical exit-observation correction (2026-10-06):
- predecessor exact source `ca98e9475102d8e0f4a16f8134fec8e2f85f3a38` atomically reserved `0.7.0-dev.37415000001.1` and Package Smoke run `37414725136` successfully produced immutable candidate artifact `11389839261`; installer SHA-256 `d3d0847e2623b0025330c6c36f80ede0fa9f849cb5bc76ab3cd0d3b197e8a433` and package/build provenance were verified by multiple installed consumers, so that source/version pair is consumed and MUST NOT be rebuilt or relabelled;
- the same predecessor passed Installed Chat, Autonomous Soak, Final Runtime Activation, Shell, Critical Audit, C5 trust-root/evidence verification and the integrated LIVE-development audit, but Self Update E2E run `37414725143` failed at the published-baseline version probe with `baseline_version_probe_exit_code_unavailable`;
- forensic logs prove the qualified installer was acquired and verified before the failure; the defect is the PowerShell `Start-Process`/adapted `Process.ExitCode` observation path used by short physical probes, not target package corruption;
- this successor replaces those short probe launches with direct `System.Diagnostics.ProcessStartInfo` capture, `UseShellExecute=false`, asynchronous stdout/stderr drain, bounded `WaitForExit` and direct integer ExitCode verification; non-zero exits and timeouts remain fail-closed;
- regression coverage rejects a return to the old unstable probe pattern, and the LIVE-development candidate audit now watches the physical harness/tests explicitly;
- because source changed after `0.7.0-dev.37415000001.1` was physically built, this SAME atomic commit advances package.json, both package-lock root version fields, the convergence reservation and audit report to fresh identity `0.7.0-dev.37416000001.1`;
- Package Smoke remains the sole physical producer. This exact successor must pass attempt-1 Package Smoke plus Self Update E2E, Installed Chat, Final Runtime, Autonomous Soak, Dirty Profile, Critical Audit, Shell, restart continuity and provenance consumers before it can be used for LIVE development;
- this reservation grants no production trust, provider effect, release publication, canonical C2 promotion, scheduler authority or automatic retry.


LIVE development candidate atomic reservation correction (2026-10-06):
- predecessor source `59d16b69d264a013b17eff8fa7a91139a1329280` advanced package metadata to `0.7.0-dev.37413841825.1` and started the sole Package Smoke producer run `37414052914`; immutable reservation artifact `11391010236` (digest `sha256:ffda3a411cc696be2c2ccebaee9623af5386481bfafc581ac3a911a77eae418b`) exists, so that identity is consumed and MUST NOT be rebuilt or relabelled;
- the predecessor trust/readiness implementation itself passed integrated two-VM LIVE-development audit run `37413951857`, but broader PR fan-out exposed one governance/source-contract defect: package metadata had advanced while the top authoritative reservation in this file still named `0.7.0-dev.37399755569.1`;
- Critical Audit run `37414052847` full Browser suite failed exactly one package-identity assertion, Shell run `37414052767` failed the same convergence assertion, and Self Update run `37414052831` failed its contract fan-out before any successor may be accepted as final;
- this successor changes package.json, both package-lock root version fields and this top convergence reservation in ONE Git commit to `0.7.0-dev.37415000001.1`, eliminating the half-updated identity state without changing runtime/trust code;
- `0.7.0-dev.37415000001.1` is fresh and monotonic above every Actions run id observed before this reservation; Package Smoke remains the single physical producer and attempt 1 only; any later source change after its producer starts consumes this identity and requires another version;
- the exact successor must re-pass integrated PRE-LIVE audit, full Browser suite, Shell, Self Update, Package Smoke, installed-process restart, Final Runtime, Dirty Profile, Autonomous Soak and downstream provenance consumers before it is called the LIVE-development client;
- this reservation authorizes no provider/Agent effect, production trust claim, release publication, canonical C2 promotion, scheduler authority, Browser authority or automatic retry.

Reserved package identity is `0.7.0-dev.37399755569.1`.

Client C5 exact-head installed restart evidence correction (2026-10-06):
- predecessor candidate `cd5b06a0862288b46c5d300972af0829d5cd0e61` / package `0.7.0-dev.37398594087.1` completed Package Smoke run `37398731953` successfully, including exact NSIS install, normal UI + 190-second Sentinel startup-grace, two distinct installed journal probe processes and stale-binding rejection;
- reservation artifact `11384267256` (digest `sha256:8d53727fac2330ee2a48b9182153699c27d8d1ad9d8b5c3a7bd74f4ed2657570`), candidate artifact `11383947839` (digest `sha256:ffc0fea330e39494ed08158118565d268474024b5324988945fc9982eede18d5`) and evidence artifact `11384780209` (digest `sha256:2f1f755f4565e938e0e1658ac0c3ff99443724b0a9e324684b8e84f7577b1ca2`) make that package identity consumed and immutable;
- post-run artifact audit rejected that run as final C5 installed-restart evidence because `client-c5-installed-restart-continuity.json.source_head` and synthetic fixture `baseline_sha` used GitHub's PR merge SHA `1574090ef5de4baec41b3c74f1068ff876f24a27`, not the proven package source head `cd5b06a0862288b46c5d300972af0829d5cd0e61`;
- source successor `150cf1885d33e10f0bf010905ea7fb9fb54082c6` binds both fixture modes and the continuity receipt to `windows-package-proof.json.source_head`, re-checks that package proof against `${{ github.event.pull_request.head.sha || github.sha }}` inside the Client restart step, and adds a regression test forbidding merge-ref/GITHUB_SHA rebinding;
- source-only preflight run `37399755569` / job `112064064882` is SUCCESS before any new version reservation;
- this atomic reservation advances package.json, package-lock and this convergence record together to `0.7.0-dev.37399755569.1`;
- this remains PREPARE_ONLY / NON-LIVE: controlled SYNTHETIC journal evidence only; Client C5 LIVE=false, canonical C2 promotion=false, provider/Supabase/release/scheduler authority=false.

Reserved package identity is `0.7.0-dev.37398594087.1`.

Client C5 installed restart continuity correction (2026-10-06):
- predecessor source `0ca9f67c2a0d4901bdf4caa571170b82707782ae` started the sole Package Smoke producer run `37397781819` with `0.7.0-dev.37396852910.1`; immutable version reservation artifact `11384036085` and candidate artifact `11383882427` were created, so that identity is consumed and MUST NOT be rebuilt or relabelled;
- the predecessor physically built and installed the exact NSIS package, passed the normal packaged UI + second-instance gate and survived the 190-second Sentinel startup-grace, then failed before the new Client journal probe could execute because PowerShell parsed `$stem:` inside a double-quoted diagnostic as invalid scoped-variable syntax;
- Shell, Critical Audit and Self Update independently exposed the stale top convergence reservation: package metadata had advanced to `0.7.0-dev.37396852910.1` while this file still named `0.7.0-dev.37350000001.1`; Installed Chat also observed an unrelated Electron download HTTP 500 before installed qualification;
- source-only successor `aea4124017f6543bdd7f815da8e2356ce17aec6f` replaces the ambiguous PowerShell interpolation with a parser-safe format expression and adds a regression fence that rejects `installed_restart_probe_exit:$stem:` in the canonical physical workflow;
- exact successor preflight run `37398594087` / job `112060370013` is SUCCESS, including parse checks, journal/restart contracts, package-workflow ownership and clean checkout;
- this atomic reservation advances package.json, both package-lock root version fields, this top convergence reservation and the preflight expected identity together to `0.7.0-dev.37398594087.1`;
- Package Smoke remains the single physical installer producer. The next PR head must use attempt 1 and every installed consumer must bind the same exact source/version/installer digest; a later source change after producer start consumes this identity and requires another monotonic version;
- this correction is PREPARE_ONLY / NON-LIVE: no live Client goal, provider effect, Supabase mutation, scheduler authority, release publication, canonical C2 promotion or automatic retry authority is granted.

Reserved package identity is `0.7.0-dev.37350000001.1`.

Computer proof convergence physical-promotion staging reservation (2026-10-05):
- current physical producer parent is `5aebd807e81e40371e19459635fb392570fd1966`; this promotion commit is a strict fast-forward descendant and preserves the one-producer lineage;
- qualified native proof source is `ecebc30a47bdd8e60ed29e88afd0fafd8351bbfe`; source-only staging SHA `04a7c4026162274e28ee42649b2c134c040092a7` passed Browser Agent Result Installer Source Qualification run `37357335723` / #58 on Ubuntu 24.04 and Windows 2025, including Windows R97 physical visual flow;
- this commit semantically ports the exact 13 proof/audit-source files from the qualified fix onto the current physical producer lineage, adds only this promotion branch to the source-qualification allowlist, and advances package metadata to `0.7.0-dev.37350000001.1`;
- prior identity `0.7.0-dev.37340000001.1` is consumed by source `5aebd807e81e40371e19459635fb392570fd1966` and MUST NOT be rebuilt or relabelled;
- repository code/issue collision search found no use of `0.7.0-dev.37350000001.1` before this commit; immutable artifact reservation is NOT YET PROVEN and remains delegated to Package Smoke;
- this exact promotion SHA must pass Ubuntu and Windows source qualification before `physical/build-slsa-provenance-v1` may fast-forward to it;
- no live DB migration replay, main update, user-machine install, automatic retry authority, scheduler authority or milestone promotion is authorized by this commit.

Reserved package identity is `0.7.0-dev.37340000001.1`.

Atomic Computer Authority V2 Windows boundary hardening build reservation (2026-10-05):
- exact runtime/source predecessor `71201d7634a8acb504e75680044c7efb9107437b` passed Browser Agent Result Installer Source Qualification run `37303167521` on Ubuntu 24.04 and Windows 2025, including full Browser regression, physical fixed-bridge STATUS and exact-window capture, R97 source visual flow, updater verification and exact-source cleanliness;
- this successor contains the complete typed-readback/effect-barrier/visual-freshness ancestry plus commit `b5689a915ef578f0629322e33309824efb422fb2`: missing or non-boolean Windows bridge effect boundaries are terminal `AMBIGUOUS_NO_RETRY`, and only explicit boolean `false` can retain `NO_EFFECT_PROVEN`;
- predecessor package `0.7.0-dev.37330000001.1` was consumed by pull-request producer run `37300742509` at source `43758774f0829900d82486645413172c2133f46c` and MUST NOT be rebuilt, relabelled or represented as canonical physical-push SLSA evidence;
- fresh GitHub code, pull-request, issue, tag and immutable-reservation-artifact searches found no use of `0.7.0-dev.37340000001.1` immediately before this atomic reservation;
- this commit changes only package.json, both package-lock root version fields and this convergence checkpoint; runtime and authority source remain byte-identical to the terminal-green predecessor above;
- staging branch `work/computer-authority-plane-v2-typed-readback-build-r1` has no pull request and runs source qualification only. The versioned exact head MUST pass that source gate before one fast-forward push to `physical/build-slsa-provenance-v1`;
- Package Smoke remains the sole physical installer producer. All ten physical workflows MUST bind the same exact source head, version, producer run/attempt and installer digest; any later source change consumes this identity and requires a new monotonic version;
- no automatic retry, second scheduler, arbitrary shell/eval, live database migration, release, production promotion or live user installation is authorized by this reservation.

Reserved package identity is `0.7.0-dev.37330000001.1`.

Atomic Computer Authority Plane V2 strict effect-proof reservation (2026-10-05):
- exact runtime/source predecessor `1ce05a384aef388b00d94e9114a5876fef5d2033` is terminal-green in Critical Audit run `37288856630` and Shell run `37288856632`; focused authority/causal/wake contracts are 90/90 PASS and full Browser Node regression is 4121/4121 PASS;
- predecessor visual-fence package `0.7.0-dev.37300000001.1` is fully physically qualified at source `7492ab1a0ce6459537b0377cdc71fd6dd03b1c78` and MUST NOT be rebuilt or relabelled;
- this successor fixes effect semantics: UIA_INVOKE, KEY_PRESS and POINTER_CLICK dispatch confirmation can no longer masquerade as EFFECT_PROVEN; TYPE_TEXT requires exact UIA ValuePattern readback and rejects unprovable append mode before dispatch;
- this commit changes only package.json, both package-lock root version fields and this convergence reservation; runtime source is otherwise byte-identical to the terminal-green predecessor above;
- Package Smoke remains the sole physical producer; Installed Chat / Final Runtime / Autonomous Soak / Self Update must consume the exact same source head, version and installer digest;
- no automatic retry, second scheduler, raw shell, eval or new authority plane is introduced.

Reserved package identity is `0.7.0-dev.37300000001.1`.

Atomic Computer Authority Plane V2 visual-fence final qualification reservation (2026-10-05):
- runtime code is unchanged from visual-fence source head `dbfecbfe1f8f99590db3002a219070f316918289`, which passed exact-head Critical Audit and Shell with 4117/4117 full Browser Node tests and 90/90 focused authority/causal/wake contracts;
- successor commits after that proof changed only package identity/convergence metadata and the source-qualification workflow allowlist so this branch and additive migration are covered explicitly;
- package identity `0.7.0-dev.37290000001.1` was already reserved to the prior exact head and MUST NOT be rebuilt for this successor;
- this commit atomically advances package.json, both package-lock root version fields and this convergence reservation to a fresh monotonic identity; no runtime or authority code changes are included;
- final acceptance still requires exact-head Critical/Shell plus Package Smoke as sole producer and Installed Chat / Final Runtime / Dirty Profile / Autonomous Soak / Self Update consuming the same installer digest;
- live Supabase migration/Edge promotion remains blocked until authorized apply/readback is available.

Reserved package identity is `0.7.0-dev.37290000001.1`.

Atomic Computer Authority Plane V2 visual-fence reservation (2026-10-05):
- visual-fence source qualification re-arm: the dedicated source workflow now explicitly includes this successor branch and migration path; this note intentionally changes no runtime code and exists to obtain an exact-head source proof before the next package identity is reserved;
- exact runtime/source predecessor `dbfecbfe1f8f99590db3002a219070f316918289` passed Critical Audit run `37285151841` and Browser Shell run `37285151942`; all compute-only Autonomous Soak jobs (1M Brain, 100k continuous, 2000-task/2048-peer scale and every chaos seed) also passed;
- the predecessor physical consumers failed only because package identity `0.7.0-dev.37280000001.1` was already immutably reserved to source `c13c7c3b2c607afb4a40e7fa83f0b16e887e5dcb`, so Package Smoke correctly rejected rebuilding that version for a new source head;
- this successor reserves a new monotonic identity after hardening visual POINTER_CLICK fallback to require a fresh exact-window capture, exact target identity, unchanged window geometry, V2 executor attestation and the existing DB lease/effect binding;
- this reservation changes package.json, both package-lock version fields and this convergence reservation together; runtime source is otherwise unchanged from the source-qualified predecessor above;
- Package Smoke remains the sole physical producer; Installed Chat / Final Runtime / Autonomous Soak installed phase / Self Update must consume the exact same source head, version and installer digest;
- the additive Supabase visual-fence migration remains source-only until an authorized live apply/readback is available.

Reserved package identity is `0.7.0-dev.37280000001.1`.

Atomic Computer Authority Plane V2 fast-action reservation (2026-10-05):
- exact runtime/source predecessor `71358abedf3730543e2452a21eba19e3620b6561` is terminal-green in Browser Agent Result Installer Source Qualification run `37275711465` on Ubuntu and Windows; full Browser regression, Root Transport, OpenAI/ME2 contracts, Windows R97 visual source proof, SLSA/source-only checks and exact-source readback all passed;
- V2 adds provider-neutral multi-display/foreground/exact-window observation and direct UIA Value/Toggle/SelectionItem/ExpandCollapse/Scroll execution while preserving the V1 semantic->UIA->visual routing order;
- predecessor package identity `0.7.0-dev.37270000001.1` is already immutably reserved for source `265583211e05d1ee5faf2b7bae0e9ef715a1c8ce` and MUST NOT be rebuilt or relabelled;
- this successor changes package.json, both package-lock version fields and this convergence reservation in ONE Git commit; runtime source is otherwise unchanged from the terminal-green predecessor above;
- Package Smoke remains the sole physical producer; Installed Chat / Final Runtime / Dirty Profile / Autonomous Soak / Self Update must consume the exact same source head, version and installer digest;
- V2 DB migration and live Edge/source-binding convergence remain closed until the new exact-head package is terminal-green.
Reserved package identity is `0.7.0-dev.37270000001.1`.

Atomic Computer Authority Plane physical reservation (2026-10-05):
- exact runtime/source predecessor `fd93231d2704320353747948092274859cc05ca7` is terminal-green in Browser Agent Result Installer Source Qualification run `37269153179` on Ubuntu and Windows; full Browser regression, Root Transport, OpenAI/ME2 contracts, Windows R97 visual source proof, SLSA/source-only checks and exact-source readback all passed;
- predecessor package identity `0.7.0-dev.37230000001.1` is already immutably reserved by producer run `37205884480` for source `8c216ee0c67b247c7d80253836de2948d386aae4` and MUST NOT be rebuilt or relabelled; PR Package Smoke correctly fail-closed with `PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED`;
- this successor changes package.json, both package-lock version fields and this convergence reservation in ONE Git commit; runtime source is otherwise unchanged from the terminal-green predecessor above;
- Package Smoke remains the sole physical producer. Every Installed Chat / Final Runtime / Dirty Profile / Autonomous Soak / Self Update consumer must bind the same exact source head, version and installer digest;
- live Supabase migration/deployment and production promotion remain closed until the new exact-head package is terminal-green and Computer Authority Plane runtime evidence is proven on Windows.
Reserved package identity is `0.7.0-dev.37230000001.1`.

Atomic Root Transport contract correction and fresh physical reservation (2026-10-04):
- runtime source is unchanged from qualified `59f24cf78faf6fe38fa2b9b2d00b68c9149ce445`, Linux/Windows source qualification `37204436247`, and full local Browser 4087 PASS;
- predecessor candidate `0634bed33afa150f2f8f29af123b292ce2c63cde` is NOT qualified: Root Transport behavioral tests passed 25/25, but its stale inline static contract demanded the retired GLM Enter lane;
- `0.7.0-dev.37220000001.1` is consumed by producer `37204978252`, immutable reservation artifact `11304666555`, and MUST NOT be rebuilt or relabelled;
- the replacement static fence verifies active ChatGPT type -> fresh exact draft readback -> one Send and legacy read-only dispatch; it is also included in Linux/Windows source qualification;
- focused Root Transport 25/25 tests, new static fence, both changed workflow YAML parses and source-only authority checks pass locally;
- public reservation lookup returned HTTP 200 and zero existing artifacts for `0.7.0-dev.37230000001.1`; producer reservation remains mandatory;
- workflow repair, all three package version fields and this authoritative reservation change in ONE commit. Package Smoke remains the sole physical producer;
- all physical consumers must prove this exact head/version/digest. No release/promotion or fresh live fleet qualification is implied.

Reserved package identity is `0.7.0-dev.37220000001.1`.

Atomic fenced ChatGPT-only installer reservation (2026-10-04):
- source qualification: `59f24cf78faf6fe38fa2b9b2d00b68c9149ce445`, run `37204436247`, attempt 1, terminal SUCCESS on Linux and Windows including Windows source visual proof;
- full local Browser proof: 4087 PASS, zero failures/skips; isolated OpenAI ME2 and PRIMARY/CRITIC policy/transport/context tests are green;
- includes exact legacy-root retirement `3a67fedd42568f8f4923fac1a53d1081f98d53a2` on qualified predecessor `3782b73b3f00a9d7eacaa42a4017010cfb374ba6`;
- `0.7.0-dev.37210000001.1` remains consumed by predecessor producer `37198104703` and MUST NOT be rebuilt or relabelled;
- new version, both lockfile version fields and this first authoritative reservation change atomically, without runtime changes after source qualification;
- public GitHub artifact readback found zero existing reservations for `0.7.0-dev.37220000001.1` immediately before this source commit; the producer MUST repeat its real reservation gate;
- Package Smoke is the sole physical producer. Every consumer MUST bind the same immutable source head, version and installer digest; do not rerun a consumed producer or add a second physical push;
- PR qualification does not imply canonical push-only SLSA attestation. Release/promotion remains closed until the relevant supply-chain gate and real authenticated ChatGPT useful-work/critic outcome are proven;
- this reservation does not itself authorize cloud deployment or mass-closing USER tabs.

Reserved package identity is `0.7.0-dev.37210000001.1`.

Atomic ChatGPT live-client package reservation (2026-10-04):
- exact predecessor: `1b5b602f3560f50e67213cb9e63715cd44e78b79`;
- `0.7.0-dev.37200000001.1` was consumed by intermediate source `9d932186e9a563161c53398b655e86e2fcb1ea5e` before package-lock/convergence metadata were aligned; it MUST NOT be rebuilt;
- this successor changes package.json, package-lock.json and convergence metadata in ONE Git commit so Package Smoke cannot reserve a half-updated source identity;
- fresh one-build identity: `0.7.0-dev.37210000001.1`; Package Smoke is the sole physical producer and every physical consumer must bind this exact head and installer digest;
- live Client remains on the older installed runtime until exact-head Package Smoke + Installed Chat + Final Runtime + Self Update evidence is terminal green;
- promotion/release remains fail-closed until real ChatGPT fleet activation and useful-work readback are proven.

Reserved package identity is `0.7.0-dev.37200000001.1`.

ChatGPT live-client qualification successor (2026-10-04):
- exact source predecessor before this identity-only reservation: `7bb994e8b384965141b90426dd78e95247587f4f`;
- `0.7.0-dev.37195000001.1` is consumed by an earlier Package Smoke producer source and MUST NOT be rebuilt or relabelled for this source;
- live Client `2a60d6a2-c7c2-4dcc-b4c9-99de768443c9` is enrolled ADMIN and currently reaches the source-bound v27 canary through the stable one-client forwarder, while the installed Browser remains the older `0.7.0-dev.37153249506.1` runtime;
- fresh Client DB now contains the typed Workspace Binding registry, snapshot projection and reincarnation transition; live workspace-snapshot readback changed from HTTP 503 to HTTP 200 AVAILABLE without scheduler/browser authority;
- exact build target: `0.7.0-dev.37200000001.1`, above the observed Actions namespace used during this convergence cycle;
- Package Smoke remains the sole physical producer; Installed Chat, Final Runtime, Dirty Profile, Autonomous Soak and Self Update MUST consume the same exact-head immutable installer;
- release/promotion remains forbidden until exact-head physical gates prove real ChatGPT fleet activation and a harmless useful-work cycle with zero active GLM leases/effects.

ChatGPT-only hardening successor reservation (2026-10-04):
- exact predecessor before this identity-only reservation: `13bd9712db490f1f29571cef59999559b3da1699`;
- Package Smoke run `37193954391` proved `0.7.0-dev.37191000001.1` was already reserved by prior source `a10af067c85e13a3c9d44cb1a6fd42062e85cb96` (artifact `11298721325`), so rebuilding or relabelling it is forbidden;
- current source adds physical-command GLM/Z.ai quarantine, fresh-project bridge routing, modern Supabase secret-key compatibility, DB active-GLM fencing, fail-closed missing-frontier behavior, role-only sovereign endpoints, and regression/falsification coverage;
- fresh monotonic one-build identity: `0.7.0-dev.37195000001.1`, chosen above current observed Actions run namespace `37193954391`;
- Package Smoke remains the sole physical producer; every downstream physical workflow must consume the same exact-head installer and fail closed if the producer is not terminal SUCCESS;
- this reservation is non-authoritative and does not itself authorize Edge deployment, release, live installation, database migration application, fleet dispatch, or production promotion.

Installed Chat qualification successor reservation (2026-10-04):
- exact predecessor before this identity-only reservation: `77d4244f2b47aacce84ab97203ad4e3b746ea969`;
- predecessor `0.7.0-dev.37185000001.1` was already physically consumed by Package Smoke on source `07fb59c16f4f1224a95673734979d8f8e51d468f`;
- the successor corrects installed ChatGPT preconnect evidence from legacy `https://chat.z.ai/` to active `https://chatgpt.com/` and adds a regression fence rejecting Z.ai as ChatGPT evidence;
- fresh monotonic one-build identity: `0.7.0-dev.37191000001.1`, chosen above the latest observed Actions run id `37190157197`;
- Package Smoke remains the sole physical producer; downstream Installed Chat / Final Runtime / Soak / Self Update must consume the exact immutable installer for the successor source;
- reservation alone grants no production, release, live-install, fleet or database mutation authority.

ChatGPT-Only Agent Fleet V1 physical-qualification reservation (2026-10-04):
- source-qualified predecessor before the identity-only reservation: `b4688d5ae7318fed58fa5e898e867e974ae28915`; Critical Audit, Shell, Chat Control Plane, Meta Orchestrator, Root Transport Bootstrap, Live Control Recovery and R84 Desktop Convergence were terminal SUCCESS on that exact source;
- Package Smoke on that predecessor correctly refused the already-consumed `0.7.0-dev.37153249506.1` before dependency install/NSIS, so no exact-head candidate installer was produced and all downstream physical consumers failed only at immutable-installer acquisition;
- the ChatGPT-only migration changes Browser/ME2/coordination/provider runtime bytes, therefore the qualified predecessor package identity MUST NOT be rebuilt or relabelled;
- fresh monotonic one-build identity: `0.7.0-dev.37185000001.1`, chosen above latest observed repository Actions run id `37184549035`;
- Package Smoke remains the sole physical producer and its reservation preflight must independently prove that both the version artifact name and the exact source candidate artifact are unused before any physical build;
- this reservation alone does not authorize release, production promotion, live installation, Guardian/admission mutation or task dispatch.

Admission recovery convergence successor (2026-10-03):
- exact predecessor `219ebe989a4f7ce2adfeb205a394a47ee55037cf` already consumed package identity `0.7.0-dev.37139234564.1` in physical Package Smoke run `37144386164`;
- this successor changes Browser runtime bytes (ordered keepalive persistence, admission recovery freshness/restart HOLD semantics), so the predecessor identity MUST NOT be rebuilt;
- failed reservation probe on source `38b9fc0e26a8e970cb9ec34da94433e30a551476` correctly refused reuse with `PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED`;
- intermediate source `b414203f3fab105f9eb21cf9a32c17c53fab7615` reserved `0.7.0-dev.37152993016.1` in Package Smoke run `37153032303` (artifact `11285061323`), so that identity is consumed and MUST NOT be reused by the final source;
- final atomic candidate identity is `0.7.0-dev.37153249506.1`; it must be proven from one exact source head once and all physical workflows must consume that one-built installer;
- deployed R83 Edge/canary source remains byte-identical; no production deployment or live admission effect is part of this candidate.

Client admission-readiness submit-fence successor on the qualified ADMIN.1/UI.1/R109/C4.6 authority base. Reserved package identity is `0.7.0-dev.37139234564.1`.

Admission readiness successor (2026-10-03):
- physical predecessor `d9aab89f55d119f9fb9f5660872c8627104fc591` consumed `0.7.0-dev.37136054065.1` and failed before NSIS packaging in R97 visual qualification because GoalComposer cached BLOCKED readiness kept Run disabled after the authoritative fixture had become READY;
- source-only successor `ba5ce72775186fa79995728261ddf4e1f8644549` fixes the race by requiring a fresh typed work-readiness read immediately before submit; exact source qualification `37139234564` passed Linux and Windows including the ME2 production build;
- `0.7.0-dev.37136054065.1` MUST NOT be retried or rebuilt; this successor advances to fresh identity `0.7.0-dev.37139234564.1`;
- the fresh versioned source must itself be source-qualified before the canonical physical branch is advanced once.

Agent result installer successor (2026-10-03):
- user explicitly requested a new installer containing all current changes;
- qualified implementation `3123af9eb17f810c4c08f599040637f1cc5bed01` includes canonical SLSA Package Smoke builder validation from `29d76d8f51bbb307d74f55a306223445516875d1`, bounded transcript census/tail harvesting, size-drift guards and non-claim prompt templates;
- source qualification `37103459439` passed Linux and Windows; its namespace reserves fresh monotonic version `0.7.0-dev.37103459439.1` before any physical build;
- predecessor `a68774eb6ad5a0fe8014501163b0c67f608bed09` / `0.7.0-dev.37086632570.1` is consumed and must not be rebuilt;
- qualify this versioned source first, then fast-forward the canonical physical SLSA branch once; Package Smoke remains the sole producer and all ten workflows must consume the same source/version/installer;
- generic AX assistant authorship and positive generation-completion proof remain separate useful-work gates; packaging does not close C4/C5 live Agent qualification.

Guardian observation successor: Settings and Native Supervisor heartbeat now share one bounded single-flight status observer. A cached positive result becomes fail-closed STALE after 10s; activation invalidates the prior observation generation before any physical owner/bootstrap path, so a late pre-activation READY cannot overwrite the newer state. Guardian is carried inside the already-qualified `host_resilience` plane in both ordinary heartbeat and realtime observation pushes, so no Edge/canary source drift is required. This is diagnostic only: it does not open Supervisor admission or add retry/execution authority.

Pipe response candidate `f799cbef` physically built `0.7.0-dev.36907623240.1`; that identity is consumed. The native enrollment deadline successor reserves higher observed workflow namespace `36908273822`.

Pipe classification candidate `1379e0c3` reserves `0.7.0-dev.36891107801.1`; this attempted identity is conservatively consumed. The malformed-receipt/deadline successor reserves higher observed workflow namespace `36907623240`.

Qualified Guardian candidate `5b585ae3` physically built `0.7.0-dev.36832190273.1`; that identity is consumed and now installed live. The pipe-observation successor reserves the higher observed workflow namespace `36891107801`, preserving monotonic installer identity.

Candidate `11a3857e` physically built `0.7.0-dev.36814827922.1`; this identity is consumed. The SCM policy readback/physical-drift successor advances again.

Guardian UAC candidate `06c8ef64` reached physical NSIS build with `0.7.0-dev.36832129848.1`; these bytes are consumed. The bounded UAC acknowledgement/identity successor advances again.

Source-binding attempt `ec20a79e` reserves `0.7.0-dev.36814563379.1` and is consumed. The final native/Edge-oracle successor advances again.

Bootstrap source `5aaae3e6` reserves `0.7.0-dev.36812444308.1`; its package attempt is treated as consumed. The source/deployment binding successor has a distinct higher identity.

The Guardian enrollment-only predecessor `c1e93e7c` already built `0.7.0-dev.36811827764.1`; this identity is consumed. The current successor adds a separately elevated, embedded-asset machine bootstrap and correct durable enrollment readback.

Previous installed package identity is `0.7.0-dev.36760350225.1`. Previous qualified package identity is `0.7.0-dev.36806234662.1` (719febc trusted prerelease installer SHA-256 `dd646b69c14031a84e89118a4c8cdfcc8455c320c8c086f1bb8cb4fe2de9814d`). Earlier qualified predecessors remain historical evidence. An intermediate a7ee919c runner also physically built (but did not publish/upload) `0.7.0-dev.36800636112.1`; those ephemeral NSIS bytes are treated as consumed and the final recovery identity advances again. A later 3c7d37c runner reached physical NSIS build with `0.7.0-dev.36801335283.1` before the final read-only-prefetch oracle fix; that identity is also consumed. Release seal `214681b` reached physical NSIS build with `0.7.0-dev.36801826934.1` before Installed Chat exposed the release-push OIDC admission gap; that identity is consumed as well. Release-policy candidate `a1c87d` reached physical NSIS build with `0.7.0-dev.36804801205.1` before the legacy PR-only OIDC source oracle was updated; that identity is consumed as well. The 719febc package line and successor dcbbb17d both reached physical NSIS build with `0.7.0-dev.36805822180.1`; that package identity is consumed and MUST NOT be reused for Guardian bootstrap bytes. The recovery candidate changes packaged runtime/UI bytes and must advance above both identities. It restores CLOSED workspace authority and truthful execution readiness; it does not claim that Supervisor rollover, Agent-origin execution or useful-work completion is already qualified live.

Historical ADMIN.1 changed packaged runtime bytes above UI.1 `0.7.0-dev.36719340135.1`, R109 `0.7.0-dev.36516587173.1` and R97/live `0.7.0-dev.36336130139.1`. The current candidate reserves a higher observed workflow namespace with the canonical `.1` suffix before building; the final producer run, installer SHA-256 and released artifact identity must still be recorded separately on the exact final source SHA.

Canonical production authority:
- one Native Browser Supervisor/Fleet task and Agent lifecycle authority;
- real authenticated ChatGPT Web UI sessions, with durable Agent-origin/session provenance; GLM/Z.ai is legacy read compatibility only and cannot authorize new actuation;
- one geometry-independent Browser effect path with readback and no blind retry;
- Browser Brain and durable memory remain Native Browser-owned;
- Browser-packaged ME2 is a standalone read-only, zero-authority compatibility probe;
- legacy ME2 Mission Control scheduler, Browser/Agents/Command/Compute authority pages and daemon task-mutation UI are retired;
- historical managed-model/API coordination is quarantined from production Agent execution.

Primary UI contract:
- one persistent Chat Fleet workspace;
- supervisors and fleet agents on the left;
- exact selected native Agent/Chat WebContents on the right;
- advanced observation surfaces are non-authoritative unless explicitly bound to canonical DevOS mutations;
- no second scheduler, executor, browser-command authority, retry plane or model API fallback in the renderer/runtime.

Release safety invariants:
- ambiguous external effects are reconciled, never blindly replayed;
- no authority widening or bypass of Guardian/Sentinel, self-update receipts, installer barriers or successor qualification;
- source qualification does not imply live Edge equivalence: exact stable/canary source binding and deployment qualification remain separate mandatory evidence;
- tested source SHA, built installer and released installer must be identical in the final release chain;
- full Self Update E2E consumes and re-verifies the same Package Smoke installer, records zero consumer target builds and waits for its exact producer terminal success;
- concurrent fresh startup shares one durable device identity initialization and never changes the signing key under an enrollment request;
- promotion requires terminal-green exact-head critical gates plus physical clean/upgrade/self-update and post-update ChatGPT Agent E2E evidence, including an explicit negative proof that no active GLM/Z.ai command, lease, navigation or inference effect occurred.


Attempted successor identity `0.7.0-dev.36909837122.1` was consumed by the first CI matrix (Package Smoke #3111 started). R83 static canary correctly rejected its temporary Edge-source drift. The correction reuses the existing qualified `host_resilience` plane and reserves `0.7.0-dev.36963586969.1`; no canary manifest or deployed Edge is advanced by this client-only diagnostic slice.


Identity discipline correction: `0.7.0-dev.36963586969.1` was already physically produced by Package Smoke #3117 on `3bf5583b…` (installer SHA-256 `62d01c10f5dfb9456036cb7f25edfccee449f87e4609d789e51a40e704e67b91`). Subsequent source head `c9207919…` inherited the same package string and started Package Smoke #3119 before the reservation advanced; those bytes are therefore collision-contaminated and must never be promoted or relabelled. The next clean source reserves `0.7.0-dev.36964688887.1`, higher than every observed workflow id at reservation time.

Final reservation discipline before the next qualification: `0.7.0-dev.36964688887.1` was superseded while Package Smoke runs #3123/#3124 were cancelled and #3125 was still queued during rapid source/checkpoint commits. It is retired conservatively. The post-research exact source now reserves `0.7.0-dev.36965151413.1`; no further source/checkpoint commits should land before this identity reaches a terminal exact-head matrix, otherwise the identity must advance again.


Guardian semantic-hardening successor: stale/invalidated observations no longer carry current positive service/owner/device proof, historical proof is explicitly namespaced as last-confirmed evidence, and observer validation rejects contradictory or proof-less READY states. This remains diagnostic-only and adds no admission/retry authority. Parent heartbeat source `1f6902da…` physically produced `0.7.0-dev.36965151413.1`; that identity is consumed and is never reused by this successor.


Build Identity V2 successor (2026-10-02):
- stacked qualified base: `bf21d71b6dc674c376bd396487b5efc134d0a3e9` / Guardian semantic hardening PR #1090;
- frozen implementation source before reservation: `5a75a4129e305752b868f1d0604319e9b30122e1`;
- reserved one-build package identity: `0.7.0-dev.36970010001.1`, chosen above the latest observed repository workflow id `36968682903`;
- deterministic `metaengine.browser.build-identity.v2` binds repository/repository-id, exact source, Package Smoke workflow, run id + rerun attempt, package version, platform/arch, builder config, installed dependency-resolution digest, electron-builder version and Node version;
- Package Smoke computes an expected identity before packaging, beforePack recomputes/injects it, afterAllArtifactBuild independently reads it back from packaged app.asar, and installer-provenance v2 binds it to installer/blockmap bytes;
- downstream Installed Chat / Final Runtime / Soak / Self Update continue consuming the single exact Package Smoke artifact and now require v2 build/dependency proof;
- dependency resolution currently proves the actual installed npm name/version tree, not byte-level reproducibility; a reviewed lockfile + npm ci remains the next supply-chain hardening boundary;
- Build Identity is evidence only: `authority_effect=false`, no release/promotion/admission/Guardian authority.

Seven malformed-workflow push records (#3128-#3134, run ids 36968517070..36968682903) occurred during the editing incident before the workflow was reconstructed. Every one completed FAILURE with zero jobs and zero artifacts, so no installer/package physical build occurred on those heads. They are retained as parser-failure evidence, not as consumed physical package identities. After repair, branch pushes no longer created Package Smoke runs because the valid push filter does not include this branch.


Build Identity V2 first qualification correction:
- frozen PR #1091 head `04fce17d3b6de1b8a5399962887bad8070d2b740` started Package Smoke #3135 / run `36970396272` with reserved identity `0.7.0-dev.36970010001.1`;
- the runner failed at the new read-only dependency-resolution step **before** expected identity computation, packaging, candidate upload or installer execution;
- exact root cause: Node 24 on Windows returned a null spawn status when the helper attempted to execute `npm.cmd` directly through `spawnSync`; the diagnostic was `dependency_resolution_npm_ls_failed:null`;
- no Package Smoke candidate artifact was produced on that head, but the identity is retired conservatively because the physical Package Smoke runner had started;
- Windows npm invocation now goes through the trusted OS command processor (`ComSpec /d /s /c npm.cmd ...`) with only fixed internal npm arguments; spawn errors are explicit and bounded;
- corrected successor reserves `0.7.0-dev.36972000001.1`; no bytes from the failed attempt may be relabelled as this version.


Build Identity V2 second qualification correction:
- PR #1091 head `53fe4cb128fd4dc7cb525201d80a23924f8a997d` started Package Smoke #3136 / run `36970617815` with `0.7.0-dev.36972000001.1`; that identity is retired conservatively and will not be reused.
- Package Smoke reached only dependency observation / expected-identity preparation. It produced no candidate installer artifact and did not run NSIS because the expected identity rejected two concrete proof defects first.
- defect 1: recursive dependency validation accidentally added the returned object instead of its numeric `.count`, so every non-empty tree failed `dependency_resolution_count_mismatch`;
- defect 2: npm's installed-tree JSON can contain unresolved optional placeholders such as `bufferutil` / `utf-8-validate` with no installed version. Those placeholders are now excluded from the installed name/version tree rather than accepted with an empty synthetic version;
- auxiliary Windows package workflows (for example Dirty Profile) are no longer forced to provide Package-Smoke-only provenance inputs. Build Identity V2 is mandatory only when `ME2_BUILD_IDENTITY_REQUIRED=true`; the official Package Smoke producer sets that flag and still fails closed if any identity input/readback is missing.
- the convergence reservation at the top of this file is now authoritative and matches package.json; the stale first reservation was the direct cause of the convergence package-identity regression.
- corrected successor reserves `0.7.0-dev.36973000001.1`, above all workflow ids observed before this commit. Any later source change after its Package Smoke runner starts must retire it and advance again.


Build Identity V2 Self Update harness correction:
- exact source `2a0022d1e0119620f7badff4621cb5ff1ed5ab7c` physically produced Package Smoke #3137 / run `36971539452` with `0.7.0-dev.36973000001.1`; installer SHA-256 `28c3199c1accb761a412bca2eecfcb3e323fe74baa63fda263d7d8de0dd9893d`, Build Identity `2e8c125f036ee27566a5857ab5c94fe65c2d400cf7ba0af1204fee4c79ae1ee1`, dependency-resolution `e37879804789c4354b0c732f2ac7a05fdfb70bf5c82a3c6849d79265200dc7f5`;
- 9/10 exact-head workflows passed; Self Update #3594 failed before installer acquisition/effect because the negative-test fixture correctly caught a native refusal but left its non-zero `$LASTEXITCODE` visible to the GitHub Actions PowerShell wrapper;
- Microsoft PowerShell semantics explicitly preserve the last native exit code across directly invoked scripts unless another native/script exit replaces it; the fixture now clears only the handled expected-refusal status and asserts that no stale native exit leaks out;
- no updater/installer failure was observed on that head and no Self Update physical effect started;
- `0.7.0-dev.36973000001.1` is consumed because Package Smoke produced bytes; the corrected exact source reserves `0.7.0-dev.36974000001.1`.


One-physical-producer fence successor (2026-10-02):
- qualified Build Identity V2 base `4c3dd26f9d89bb5e5b04c1eb4a21a5c434dba86b` physically produced and fully qualified `0.7.0-dev.36974000001.1`; installer SHA-256 `f37a5a9604c0dfbb5bf86fba2042ba2e211ac5064a9ac3efeb8e5896a37638bd`; Build Identity `52d075fee4a9fe9729836481743857f75dc90566150b15d93137dc829290eeb2`; that version is consumed and is never reused;
- Build Identity V2 embeds GitHub run id/attempt into packaged bytes, so an Actions rerun of an unchanged source/version could otherwise manufacture different bytes under the same updater version;
- Package Smoke now refuses any `GITHUB_RUN_ATTEMPT != 1`, serializes the physical producer job by package version without canceling an in-progress producer, queries immutable GitHub artifact history for prior version/source evidence, and fails closed on API ambiguity;
- an immutable `metaengine-browser-package-version-<version>` reservation marker is uploaded and its artifact id/digest sealed before dependency install and electron-builder;
- old PR/ref-level `cancel-in-progress:true` was removed from Package Smoke because canceling a physical producer is incompatible with one-build evidence;
- early workflow-parser attempts #3139-#3142 had zero jobs and zero artifacts due a duplicate YAML `timeout-minutes` key; no physical bytes were created by those records;
- corrected workflow source after parser repair produced no push-triggered runner on this non-matching branch, confirming the valid trigger filter is restored;
- upload-artifact digest output is normalized from its documented raw SHA-256 form into canonical `sha256:<hex>` reservation evidence;
- frozen successor reserves `0.7.0-dev.36977000001.1`, chosen above latest observed repository Actions run id `36975111718`; once its Package Smoke runner starts this identity is consumed even if the run fails before NSIS.


Frozen npm dependency material successor:
- qualified one-producer predecessor is `8409fb249887dd4636b3bd6fab40bfe30fa4b085` / `0.7.0-dev.36977000001.1`;
- this branch adds a package-lock material verifier before wiring any physical build;
- `0.7.0-dev.36980000001.1` is reserved but unconsumed until a Package Smoke producer starts;
- no PR/physical Package Smoke should start until a committed lockfile and clean npm-ci proof exist.


Build Identity V3 physical-qualification correction (2026-10-02):
- draft PR #1093 exact head `245920c1a45851a1d30c25341ce2ca33457bc5c7` started Package Smoke #3144 / run `36988305577` with `0.7.0-dev.36980000001.1`; immutable package-version reservation artifact `11218079311` was created, so this identity is consumed and will never be reused.
- Self Update #3597 failed in the read-only qualified-installer compatibility fixture before installer acquisition or update effect. Under `Set-StrictMode -Version Latest`, the shared consumer's Verify path dereferenced V3-only `package_lock_sha256` fields on a valid historical V2 binding that intentionally does not contain them.
- V3 verification remains strict, but V2 historical compatibility now avoids all V3-only field dereferences; the terminal producer-gate projection likewise emits V3 lock/Bun fields only for V3 provenance.
- the exact PowerShell V2 compatibility fixture is now part of the source-only Windows qualification, so this class of regression must fail before another physical PR is opened.
- corrected successor reserves `0.7.0-dev.36990000001.1`, above all Actions run ids observed before this correction. No further source/checkpoint commit may land before its source qualification completes; after its next Package Smoke runner starts, this identity is consumed.


SBOM evidence successor line:
- predecessor `d283150bc8a3338a76b98c369b67fb7e846b207b` / `0.7.0-dev.36990000001.1` is terminal V3-qualified 10/10;
- branch `work/build-sbom-evidence-v1` adds evidence-only npm SBOM inventory before release-boundary attestation;
- `0.7.0-dev.36991000001.1` is reserved but remains physically unconsumed until a future Package Smoke producer starts;
- SBOM digest is not Build Identity authority and does not authorize promotion.


Composed SBOM physical-successor correction (2026-10-02):
- exact source `5d3c8ac80934df60db9753cf709bf6eba2daeb33` started Package Smoke #3148 / run `37005013624` with `0.7.0-dev.37002000001.1`; the immutable reservation artifact was created, so that identity is consumed and MUST NOT be reused even though the broader matrix exposed a source-contract failure;
- Shell/Critical/Self Update contract gates correctly found that `CONVERGENCE_CANDIDATE.md` still reserved the predecessor `0.7.0-dev.36991000001.1` while package.json had advanced. This is an evidence/governance mismatch, not permission to relabel the running physical producer;
- the isolated source-only successor reserves `0.7.0-dev.37006000001.1`, updates package.json + package-lock + this convergence reservation together, and must complete source qualification before it can replace the physical PR head;
- no automatic retry, release, promotion, live install, Guardian enrollment, Supervisor admission, or task dispatch is authorized by this correction.


SLSA physical closure successor (2026-10-03):
- consumed predecessor: `b8f2f438bf3d9450a301ebb525eb95181f6d464d` / `0.7.0-dev.37076000001.1`; never rerun or reuse that source/version;
- functional source: `fae5eae066576a6cdd30f4f336769c2b1b4787ac`, source qualification run `37084599153`, full Linux and Windows Browser Node suites SUCCESS;
- fresh monotonic package reservation: `0.7.0-dev.37084599153.1`, using that observed qualification run namespace; producer reservation preflight remains mandatory before packaging;
- installed qualification backend: Meta `jhriwwsryeqsvvvufkok`, function V8 pinned to the qualified source; exact physical push workflow/ref/source/run/attempt binding, nonce approval unchanged;
- one Package Smoke producer, existing Sigstore/Rekor attestation and independent verifier, exact downstream producer event fencing retained;
- new source qualification and all ten physical workflows must pass on this successor before it is offered for installation; no claim of production release or real z.ai Agent task/result closure follows from packaging evidence.


Self Update V3 physical closure successor (2026-10-03):
- consumed predecessor: `c80e0fb46dc8c701462beb7f74dd8ff45867ac74` / `0.7.0-dev.37084599153.1`; Package Smoke and 8 other workflow families passed, while Self Update #3605 / run `37085197258` failed before installer acquisition/effect in the local re-verification fixture;
- exact failure: under PowerShell StrictMode, ambient physical-branch auto-fencing inferred `ExpectedProducerEvent=push` during `Mode Verify`, then dereferenced the synthetic legacy fixture's intentionally absent `producer_event` property;
- V3 fix keeps automatic physical push event fencing for `Acquire` and `Wait`, while local `Verify` remains branch-agnostic unless a caller explicitly supplies an event;
- source-fix head `e91b483c0bca90a2f7699b2553b11720b37fc06a` passed Linux and Windows source qualification run `37086632570`, including the exact PowerShell fixture under simulated physical push environment plus full Browser Node regression;
- Installed Chat on the predecessor physically proved Supabase installed-qualification function V8: function logs show the expected 202 waiting response followed by 200 approval on deployment `jhriwwsryeqsvvvufkok_add28328-d282-4942-9fa1-c2302da1e23f_8`;
- fresh monotonic package reservation: `0.7.0-dev.37086632570.1`, derived from the final qualified source run namespace and never previously physically started;
- the next exact candidate must source-qualify at its own versioned head before `physical/build-slsa-provenance-v1` is advanced; all ten workflows must again consume one Package Smoke installer and run at attempt 1;
- no rerun of the consumed predecessor, release, promotion, live user install, Guardian enrollment, Supervisor admission, or task dispatch is authorized by this reservation.


Admission recovery no-replay successor (2026-10-03):
- source implementation `6e859e109fe50e242859af5d2bd715d15afccb92` passed Browser Agent Result Installer Source Qualification run `37136054065` on Ubuntu 24.04 and Windows 2025, including the full Browser regression, SLSA topology/version-reservation checks, Windows updater verification, exact source cleanliness and an isolated Bun 1.3.3 ME2 UI production build;
- the Client now exposes one explicit `Resume execution` control for authoritative `WORKSPACE_EXECUTION_PAUSED`, but success is accepted only after a fresh independent `/v1/devos/environment-state` readback; a mutation receipt alone is never shown as success;
- the durable local recovery journal persists `SEND_INTENT_DURABLE` before the server effect and never automatically replays an ambiguous attempt. A later explicit user action performs readback-only reconciliation first;
- `a2-browser-native-supervisor-v1` deployment V11 preserves the V10 source except the exact `devos-routes.mjs` import pin, now bound to qualified source `6e859e109fe50e242859af5d2bd715d15afccb92`; the deployment is ACTIVE and existing signed heartbeat/command traffic remains healthy;
- current authoritative workspace state remains CLOSED at generation floor 28; this source/package reservation does not reopen admission, promote an Agent, activate Guardian, dispatch a task, publish a release or install on the user machine;
- fresh monotonic package reservation: `0.7.0-dev.37136054065.1`. It is physically unconsumed until Package Smoke creates its immutable reservation artifact. Move the physical branch only after this versioned source itself is source-qualified; then all ten physical workflows must consume the one Package Smoke installer at attempt 1.

Computer Authority V2 typed-readback source qualification re-arm (2026-10-05):
- successor branch `work/computer-authority-plane-v2-typed-readback-r1` is now included in the dedicated source-qualification workflow after the effect-proof / effect-barrier / visual-freshness stack;
- the source gate must prove the exact current head before any fresh package identity is reserved; inherited `0.7.0-dev.37310000001.1` remains consumed and MUST NOT be reused for a physical build;
- this metadata-only re-arm adds no runtime, scheduler, retry, DB, release, install, or authority effect.

Computer Authority V2 typed-readback physical reservation (2026-10-05):
- exact runtime/source predecessor `df2fe05f9ca09e7ce1d204bb42f2b13ad47aae73` passed Browser Agent Result Installer Source Qualification run `37299883365` on Ubuntu 24.04 and Windows 2025, including full Browser regression, Windows physical fixed-bridge STATUS + exact-window capture, R97 source visual flow, updater verification and exact-source cleanliness;
- inherited `0.7.0-dev.37310000001.1` was previously consumed by another exact source and remains permanently non-reusable;
- fresh repository search found no code, pull request or issue use of `0.7.0-dev.37330000001.1` before this reservation;
- this atomic commit changes only package.json, the two package-lock root version fields, and this convergence checkpoint; runtime/authority source remains byte-identical to the terminal-green predecessor above;
- Package Smoke remains the sole physical producer. Any new runtime/source change after this reservation retires `0.7.0-dev.37330000001.1` and requires a new monotonic identity; no blind retry, release, live install, scheduler authority, DB authority or promotion is authorized by this reservation.
` sequence as the special unmatched-suffix token, duplicating most of the workflow and truncating the intended PE block; GitHub rejected it before any job existed, so this was not a runtime/installer failure;
- this successor replaces the fragile regex with PowerShell `[version]` parsing and exact Major/Minor/Build checks while retaining binary presence and SHA-256 requirements.

Electron runtime materialization correction (2026-10-06):
- exact source `540f83c48501ca27a893cfcc4b62ea28e7c4f228` / package `0.7.0-dev.37485000001.1` passed package identity preflight and published+sealed immutable reservation artifact `11424395709` (digest `sha256:b370faf8f67ebfeca9c0ecab65825bc41479db5c2d4175389be4cd867cdea1c1`) in Package Smoke run `37487078168`;
- that run then failed at `Materialize exact Electron runtime for physical UI evidence`: `electron.exe --version` exited successfully but PowerShell captured no stdout from the Windows GUI-subsystem executable, leaving `$binaryVersion` null; no visual evidence, NSIS build or candidate artifact was accepted;
- the successor keeps materialization fail-closed without launching the GUI binary as a CLI probe: exact Electron package version `44.0.0`, binary presence, PE `FileVersionInfo.ProductVersion` matching `44.0.0(.0)`, and a valid SHA-256 of `electron.exe` are all required;
- regression contract forbids returning to `& $electron --version` / nullable stdout semantics;
- because `0.7.0-dev.37485000001.1` was already reserved and sealed, this SAME atomic commit advances package.json + package-lock + convergence/report metadata to fresh identity `0.7.0-dev.37490000001.1`;
- no further source mutation is permitted after physical Package Smoke begins; any later fix requires another fresh monotonic identity.


Final ChatGPT/ME2 physical reservation (2026-10-06):
- exact source `dc76192e9a8ed269c62355464c36b96048a67732` passed source-only convergence run `37484297121` / job `112340249904` SUCCESS with full Browser Node regression, frozen Bun install, full Next build, compiled-output legacy-provider scan and source immutability proof;
- deprecated `metaengine-dark-workspace-v2` and the entire `apps/metaengine-browser/ui/` renderer are absent; `metaengine://shell/` remains forbidden; packaged ME2 is the sole product UI and generated `metaengine://recovery/` is GET-only/non-authoritative;
- previous identity `0.7.0-dev.37437000001.1` is consumed: PR Package Smoke run `37477684780` succeeded through package identity preflight, duplicate source/version check, immutable reservation publication and reservation seal before later failing at then-stale visual evidence; that identity MUST NOT be rebuilt or rebound to this newer source;
- this atomic successor changes only package identity/ledger/report metadata and reserves `0.7.0-dev.37485000001.1` for exact source bytes already qualified at `dc76192e9a8ed269c62355464c36b96048a67732`;
- no further source mutation is permitted after physical Package Smoke begins; any source change requires another fresh monotonic identity;
- reservation grants no provider effect, production trust, release publication, scheduler authority or canonical C2 promotion.


C4 stale branding assertion correction (2026-10-06):
- exact source `2440c869b54bf96904f0a3e198a3a352854c9242` passed the ChatGPT UI source-convergence gate, but Client V1 C4 Goal Contracts run `37476944921` failed 87/88 because one test still required the retired presentation string `Verified z.ai Agent`;
- this is a stale assertion against user-visible branding, not a rollback of the historical internal wire token `ZAI_AGENT_SURFACE_CAUSAL_V1`;
- Package Smoke run `37476944927` had already accepted identity preflight for `0.7.0-dev.37436000001.1`; its Windows job then failed closed at duplicate source/version protection before dependency install or NSIS build, so no installer from that run is accepted, and `0.7.0-dev.37436000001.1` is consumed for governance purposes;
- this SAME atomic successor changes the stale assertion to `Verified ChatGPT Agent` and advances package.json + package-lock + convergence/report metadata to fresh identity `0.7.0-dev.37437000001.1`;
- the deprecated `metaengine-dark-workspace-v2` source bundle remains absent, `metaengine://shell/` remains forbidden, and packaged ME2 remains the sole product UI with generated read-only recovery only;
- any later source mutation after Package Smoke begins requires another fresh monotonic package identity.

Workspace projection test retirement correction (2026-10-06):
- predecessor identity `0.7.0-dev.37435000001.1` passed Package Smoke identity preflight on exact source `498a244a0484d0566bc91fa81fa1119175fb4eb0`; therefore it is consumed for governance purposes and MUST NOT be reused after any source change;
- Browser Typed Workspaces run `37435008436` exposed one stale falsification test that still opened deleted `apps/metaengine-browser/ui/app.js`; 23/24 tests passed and the sole failure was ENOENT at `shell-workspace-projection-wiring.test.mjs`;
- the repaired test preserves the original authority boundary by validating bounded DevOS projection acceptance in `preload-shell.cjs` and proving the current ME2 store does not reconstruct `workspace_bindings`, `lease_current`, exact binding identity or current command payload;
- source-only ChatGPT UI convergence now includes this workspace wiring test before any physical producer is accepted;
- fresh package identity is `0.7.0-dev.37436000001.1`; it is the only identity eligible for the repaired exact source, and any later source mutation after Package Smoke begins requires another monotonic version;
- no live provider effect, production trust, release publication, scheduler authority or canonical C2 promotion is authorized.


Legacy shell retirement successor reservation (2026-10-06):
- intermediate ChatGPT UI candidate `0.7.0-dev.37434000001.1` reached Package Smoke preflight on PR #1133 before the deprecated `metaengine-dark-workspace-v2` renderer was fully removed; that identity is treated as potentially consumed and MUST NOT represent the final source even if its Windows producer never emits an artifact;
- the final source removes the entire `apps/metaengine-browser/ui/` renderer bundle, all obsolete legacy-shell visual/UI tests, old Package Smoke visual capture, package inclusion `ui/**/*`, and runtime routing to `metaengine://shell/`;
- packaged ME2 is now the only product UI. ME2 failure routes only to an inline GET-only `metaengine://recovery/` document with CSP `default-src 'none'`, no script/form/input/button/network path, and `recovery_surface_authority=false`;
- `npm run check` no longer references deleted `ui/app.js` or `browser-shell-visual-evidence.mjs`; source-only convergence now runs full Browser parse checks plus ChatGPT/retirement/startup/policy contracts before any physical package is accepted;
- final fresh package identity is `0.7.0-dev.37436000001.1`. Any source mutation after its physical producer begins consumes this identity and requires another monotonic version;
- old package `0.7.0-dev.37416000001.1` remains the immutable installed LIVE-development baseline; no production trust, provider effect, release publication, scheduler authority or canonical C2 promotion is granted here.


ChatGPT primary UI convergence reservation (2026-10-06):
- parent LIVE-development candidate `e2e8f20e5d6abf0f84bf163066ed3ec15b69298a` / `0.7.0-dev.37416000001.1` remains immutable and physically qualified; it MUST NOT be rebuilt or relabelled with this UI correction;
- source-only ChatGPT UI convergence run `37433550089` / job `112169785397` is SUCCESS after one fail-closed predecessor run `37433449834` exposed a remaining command-palette z.ai label;
- primary ME2 UI now uses stable `ChatGPT` / `Agent` presentation without hard-coded model version; historical `ZAI_AGENT_SURFACE_CAUSAL_V1` remains only as a wire/readback compatibility token;
- legacy `GET /glm` telemetry remains read-only; UI `probe` / `upgrade fleet` mutations and `mcxOp("glm", ...)` are removed;
- unused `z-ai-web-dev-sdk` and dead GLM/vault `agent-factory/bootstrap.ts` are removed from the ME2 source/dependency surface;
- compiled Next output is fail-closed scanned for legacy provider branding/mutation strings;
- fresh Browser package identity is `0.7.0-dev.37436000001.1`; Package Smoke remains the sole physical producer and all installed/runtime/self-update consumers must qualify the same immutable candidate before this slice is considered physically proven;
- no production trust, provider mutation, canonical C2 promotion, scheduler authority, release authority or automatic retry is granted by this reservation.


LIVE development physical exit-observation correction (2026-10-06):
- predecessor exact source `ca98e9475102d8e0f4a16f8134fec8e2f85f3a38` atomically reserved `0.7.0-dev.37415000001.1` and Package Smoke run `37414725136` successfully produced immutable candidate artifact `11389839261`; installer SHA-256 `d3d0847e2623b0025330c6c36f80ede0fa9f849cb5bc76ab3cd0d3b197e8a433` and package/build provenance were verified by multiple installed consumers, so that source/version pair is consumed and MUST NOT be rebuilt or relabelled;
- the same predecessor passed Installed Chat, Autonomous Soak, Final Runtime Activation, Shell, Critical Audit, C5 trust-root/evidence verification and the integrated LIVE-development audit, but Self Update E2E run `37414725143` failed at the published-baseline version probe with `baseline_version_probe_exit_code_unavailable`;
- forensic logs prove the qualified installer was acquired and verified before the failure; the defect is the PowerShell `Start-Process`/adapted `Process.ExitCode` observation path used by short physical probes, not target package corruption;
- this successor replaces those short probe launches with direct `System.Diagnostics.ProcessStartInfo` capture, `UseShellExecute=false`, asynchronous stdout/stderr drain, bounded `WaitForExit` and direct integer ExitCode verification; non-zero exits and timeouts remain fail-closed;
- regression coverage rejects a return to the old unstable probe pattern, and the LIVE-development candidate audit now watches the physical harness/tests explicitly;
- because source changed after `0.7.0-dev.37415000001.1` was physically built, this SAME atomic commit advances package.json, both package-lock root version fields, the convergence reservation and audit report to fresh identity `0.7.0-dev.37416000001.1`;
- Package Smoke remains the sole physical producer. This exact successor must pass attempt-1 Package Smoke plus Self Update E2E, Installed Chat, Final Runtime, Autonomous Soak, Dirty Profile, Critical Audit, Shell, restart continuity and provenance consumers before it can be used for LIVE development;
- this reservation grants no production trust, provider effect, release publication, canonical C2 promotion, scheduler authority or automatic retry.


LIVE development candidate atomic reservation correction (2026-10-06):
- predecessor source `59d16b69d264a013b17eff8fa7a91139a1329280` advanced package metadata to `0.7.0-dev.37413841825.1` and started the sole Package Smoke producer run `37414052914`; immutable reservation artifact `11391010236` (digest `sha256:ffda3a411cc696be2c2ccebaee9623af5386481bfafc581ac3a911a77eae418b`) exists, so that identity is consumed and MUST NOT be rebuilt or relabelled;
- the predecessor trust/readiness implementation itself passed integrated two-VM LIVE-development audit run `37413951857`, but broader PR fan-out exposed one governance/source-contract defect: package metadata had advanced while the top authoritative reservation in this file still named `0.7.0-dev.37399755569.1`;
- Critical Audit run `37414052847` full Browser suite failed exactly one package-identity assertion, Shell run `37414052767` failed the same convergence assertion, and Self Update run `37414052831` failed its contract fan-out before any successor may be accepted as final;
- this successor changes package.json, both package-lock root version fields and this top convergence reservation in ONE Git commit to `0.7.0-dev.37415000001.1`, eliminating the half-updated identity state without changing runtime/trust code;
- `0.7.0-dev.37415000001.1` is fresh and monotonic above every Actions run id observed before this reservation; Package Smoke remains the single physical producer and attempt 1 only; any later source change after its producer starts consumes this identity and requires another version;
- the exact successor must re-pass integrated PRE-LIVE audit, full Browser suite, Shell, Self Update, Package Smoke, installed-process restart, Final Runtime, Dirty Profile, Autonomous Soak and downstream provenance consumers before it is called the LIVE-development client;
- this reservation authorizes no provider/Agent effect, production trust claim, release publication, canonical C2 promotion, scheduler authority, Browser authority or automatic retry.

Reserved package identity is `0.7.0-dev.37399755569.1`.

Client C5 exact-head installed restart evidence correction (2026-10-06):
- predecessor candidate `cd5b06a0862288b46c5d300972af0829d5cd0e61` / package `0.7.0-dev.37398594087.1` completed Package Smoke run `37398731953` successfully, including exact NSIS install, normal UI + 190-second Sentinel startup-grace, two distinct installed journal probe processes and stale-binding rejection;
- reservation artifact `11384267256` (digest `sha256:8d53727fac2330ee2a48b9182153699c27d8d1ad9d8b5c3a7bd74f4ed2657570`), candidate artifact `11383947839` (digest `sha256:ffc0fea330e39494ed08158118565d268474024b5324988945fc9982eede18d5`) and evidence artifact `11384780209` (digest `sha256:2f1f755f4565e938e0e1658ac0c3ff99443724b0a9e324684b8e84f7577b1ca2`) make that package identity consumed and immutable;
- post-run artifact audit rejected that run as final C5 installed-restart evidence because `client-c5-installed-restart-continuity.json.source_head` and synthetic fixture `baseline_sha` used GitHub's PR merge SHA `1574090ef5de4baec41b3c74f1068ff876f24a27`, not the proven package source head `cd5b06a0862288b46c5d300972af0829d5cd0e61`;
- source successor `150cf1885d33e10f0bf010905ea7fb9fb54082c6` binds both fixture modes and the continuity receipt to `windows-package-proof.json.source_head`, re-checks that package proof against `${{ github.event.pull_request.head.sha || github.sha }}` inside the Client restart step, and adds a regression test forbidding merge-ref/GITHUB_SHA rebinding;
- source-only preflight run `37399755569` / job `112064064882` is SUCCESS before any new version reservation;
- this atomic reservation advances package.json, package-lock and this convergence record together to `0.7.0-dev.37399755569.1`;
- this remains PREPARE_ONLY / NON-LIVE: controlled SYNTHETIC journal evidence only; Client C5 LIVE=false, canonical C2 promotion=false, provider/Supabase/release/scheduler authority=false.

Reserved package identity is `0.7.0-dev.37398594087.1`.

Client C5 installed restart continuity correction (2026-10-06):
- predecessor source `0ca9f67c2a0d4901bdf4caa571170b82707782ae` started the sole Package Smoke producer run `37397781819` with `0.7.0-dev.37396852910.1`; immutable version reservation artifact `11384036085` and candidate artifact `11383882427` were created, so that identity is consumed and MUST NOT be rebuilt or relabelled;
- the predecessor physically built and installed the exact NSIS package, passed the normal packaged UI + second-instance gate and survived the 190-second Sentinel startup-grace, then failed before the new Client journal probe could execute because PowerShell parsed `$stem:` inside a double-quoted diagnostic as invalid scoped-variable syntax;
- Shell, Critical Audit and Self Update independently exposed the stale top convergence reservation: package metadata had advanced to `0.7.0-dev.37396852910.1` while this file still named `0.7.0-dev.37350000001.1`; Installed Chat also observed an unrelated Electron download HTTP 500 before installed qualification;
- source-only successor `aea4124017f6543bdd7f815da8e2356ce17aec6f` replaces the ambiguous PowerShell interpolation with a parser-safe format expression and adds a regression fence that rejects `installed_restart_probe_exit:$stem:` in the canonical physical workflow;
- exact successor preflight run `37398594087` / job `112060370013` is SUCCESS, including parse checks, journal/restart contracts, package-workflow ownership and clean checkout;
- this atomic reservation advances package.json, both package-lock root version fields, this top convergence reservation and the preflight expected identity together to `0.7.0-dev.37398594087.1`;
- Package Smoke remains the single physical installer producer. The next PR head must use attempt 1 and every installed consumer must bind the same exact source/version/installer digest; a later source change after producer start consumes this identity and requires another monotonic version;
- this correction is PREPARE_ONLY / NON-LIVE: no live Client goal, provider effect, Supabase mutation, scheduler authority, release publication, canonical C2 promotion or automatic retry authority is granted.

Reserved package identity is `0.7.0-dev.37350000001.1`.

Computer proof convergence physical-promotion staging reservation (2026-10-05):
- current physical producer parent is `5aebd807e81e40371e19459635fb392570fd1966`; this promotion commit is a strict fast-forward descendant and preserves the one-producer lineage;
- qualified native proof source is `ecebc30a47bdd8e60ed29e88afd0fafd8351bbfe`; source-only staging SHA `04a7c4026162274e28ee42649b2c134c040092a7` passed Browser Agent Result Installer Source Qualification run `37357335723` / #58 on Ubuntu 24.04 and Windows 2025, including Windows R97 physical visual flow;
- this commit semantically ports the exact 13 proof/audit-source files from the qualified fix onto the current physical producer lineage, adds only this promotion branch to the source-qualification allowlist, and advances package metadata to `0.7.0-dev.37350000001.1`;
- prior identity `0.7.0-dev.37340000001.1` is consumed by source `5aebd807e81e40371e19459635fb392570fd1966` and MUST NOT be rebuilt or relabelled;
- repository code/issue collision search found no use of `0.7.0-dev.37350000001.1` before this commit; immutable artifact reservation is NOT YET PROVEN and remains delegated to Package Smoke;
- this exact promotion SHA must pass Ubuntu and Windows source qualification before `physical/build-slsa-provenance-v1` may fast-forward to it;
- no live DB migration replay, main update, user-machine install, automatic retry authority, scheduler authority or milestone promotion is authorized by this commit.

Reserved package identity is `0.7.0-dev.37340000001.1`.

Atomic Computer Authority V2 Windows boundary hardening build reservation (2026-10-05):
- exact runtime/source predecessor `71201d7634a8acb504e75680044c7efb9107437b` passed Browser Agent Result Installer Source Qualification run `37303167521` on Ubuntu 24.04 and Windows 2025, including full Browser regression, physical fixed-bridge STATUS and exact-window capture, R97 source visual flow, updater verification and exact-source cleanliness;
- this successor contains the complete typed-readback/effect-barrier/visual-freshness ancestry plus commit `b5689a915ef578f0629322e33309824efb422fb2`: missing or non-boolean Windows bridge effect boundaries are terminal `AMBIGUOUS_NO_RETRY`, and only explicit boolean `false` can retain `NO_EFFECT_PROVEN`;
- predecessor package `0.7.0-dev.37330000001.1` was consumed by pull-request producer run `37300742509` at source `43758774f0829900d82486645413172c2133f46c` and MUST NOT be rebuilt, relabelled or represented as canonical physical-push SLSA evidence;
- fresh GitHub code, pull-request, issue, tag and immutable-reservation-artifact searches found no use of `0.7.0-dev.37340000001.1` immediately before this atomic reservation;
- this commit changes only package.json, both package-lock root version fields and this convergence checkpoint; runtime and authority source remain byte-identical to the terminal-green predecessor above;
- staging branch `work/computer-authority-plane-v2-typed-readback-build-r1` has no pull request and runs source qualification only. The versioned exact head MUST pass that source gate before one fast-forward push to `physical/build-slsa-provenance-v1`;
- Package Smoke remains the sole physical installer producer. All ten physical workflows MUST bind the same exact source head, version, producer run/attempt and installer digest; any later source change consumes this identity and requires a new monotonic version;
- no automatic retry, second scheduler, arbitrary shell/eval, live database migration, release, production promotion or live user installation is authorized by this reservation.

Reserved package identity is `0.7.0-dev.37330000001.1`.

Atomic Computer Authority Plane V2 strict effect-proof reservation (2026-10-05):
- exact runtime/source predecessor `1ce05a384aef388b00d94e9114a5876fef5d2033` is terminal-green in Critical Audit run `37288856630` and Shell run `37288856632`; focused authority/causal/wake contracts are 90/90 PASS and full Browser Node regression is 4121/4121 PASS;
- predecessor visual-fence package `0.7.0-dev.37300000001.1` is fully physically qualified at source `7492ab1a0ce6459537b0377cdc71fd6dd03b1c78` and MUST NOT be rebuilt or relabelled;
- this successor fixes effect semantics: UIA_INVOKE, KEY_PRESS and POINTER_CLICK dispatch confirmation can no longer masquerade as EFFECT_PROVEN; TYPE_TEXT requires exact UIA ValuePattern readback and rejects unprovable append mode before dispatch;
- this commit changes only package.json, both package-lock root version fields and this convergence reservation; runtime source is otherwise byte-identical to the terminal-green predecessor above;
- Package Smoke remains the sole physical producer; Installed Chat / Final Runtime / Autonomous Soak / Self Update must consume the exact same source head, version and installer digest;
- no automatic retry, second scheduler, raw shell, eval or new authority plane is introduced.

Reserved package identity is `0.7.0-dev.37300000001.1`.

Atomic Computer Authority Plane V2 visual-fence final qualification reservation (2026-10-05):
- runtime code is unchanged from visual-fence source head `dbfecbfe1f8f99590db3002a219070f316918289`, which passed exact-head Critical Audit and Shell with 4117/4117 full Browser Node tests and 90/90 focused authority/causal/wake contracts;
- successor commits after that proof changed only package identity/convergence metadata and the source-qualification workflow allowlist so this branch and additive migration are covered explicitly;
- package identity `0.7.0-dev.37290000001.1` was already reserved to the prior exact head and MUST NOT be rebuilt for this successor;
- this commit atomically advances package.json, both package-lock root version fields and this convergence reservation to a fresh monotonic identity; no runtime or authority code changes are included;
- final acceptance still requires exact-head Critical/Shell plus Package Smoke as sole producer and Installed Chat / Final Runtime / Dirty Profile / Autonomous Soak / Self Update consuming the same installer digest;
- live Supabase migration/Edge promotion remains blocked until authorized apply/readback is available.

Reserved package identity is `0.7.0-dev.37290000001.1`.

Atomic Computer Authority Plane V2 visual-fence reservation (2026-10-05):
- visual-fence source qualification re-arm: the dedicated source workflow now explicitly includes this successor branch and migration path; this note intentionally changes no runtime code and exists to obtain an exact-head source proof before the next package identity is reserved;
- exact runtime/source predecessor `dbfecbfe1f8f99590db3002a219070f316918289` passed Critical Audit run `37285151841` and Browser Shell run `37285151942`; all compute-only Autonomous Soak jobs (1M Brain, 100k continuous, 2000-task/2048-peer scale and every chaos seed) also passed;
- the predecessor physical consumers failed only because package identity `0.7.0-dev.37280000001.1` was already immutably reserved to source `c13c7c3b2c607afb4a40e7fa83f0b16e887e5dcb`, so Package Smoke correctly rejected rebuilding that version for a new source head;
- this successor reserves a new monotonic identity after hardening visual POINTER_CLICK fallback to require a fresh exact-window capture, exact target identity, unchanged window geometry, V2 executor attestation and the existing DB lease/effect binding;
- this reservation changes package.json, both package-lock version fields and this convergence reservation together; runtime source is otherwise unchanged from the source-qualified predecessor above;
- Package Smoke remains the sole physical producer; Installed Chat / Final Runtime / Autonomous Soak installed phase / Self Update must consume the exact same source head, version and installer digest;
- the additive Supabase visual-fence migration remains source-only until an authorized live apply/readback is available.

Reserved package identity is `0.7.0-dev.37280000001.1`.

Atomic Computer Authority Plane V2 fast-action reservation (2026-10-05):
- exact runtime/source predecessor `71358abedf3730543e2452a21eba19e3620b6561` is terminal-green in Browser Agent Result Installer Source Qualification run `37275711465` on Ubuntu and Windows; full Browser regression, Root Transport, OpenAI/ME2 contracts, Windows R97 visual source proof, SLSA/source-only checks and exact-source readback all passed;
- V2 adds provider-neutral multi-display/foreground/exact-window observation and direct UIA Value/Toggle/SelectionItem/ExpandCollapse/Scroll execution while preserving the V1 semantic->UIA->visual routing order;
- predecessor package identity `0.7.0-dev.37270000001.1` is already immutably reserved for source `265583211e05d1ee5faf2b7bae0e9ef715a1c8ce` and MUST NOT be rebuilt or relabelled;
- this successor changes package.json, both package-lock version fields and this convergence reservation in ONE Git commit; runtime source is otherwise unchanged from the terminal-green predecessor above;
- Package Smoke remains the sole physical producer; Installed Chat / Final Runtime / Dirty Profile / Autonomous Soak / Self Update must consume the exact same source head, version and installer digest;
- V2 DB migration and live Edge/source-binding convergence remain closed until the new exact-head package is terminal-green.
Reserved package identity is `0.7.0-dev.37270000001.1`.

Atomic Computer Authority Plane physical reservation (2026-10-05):
- exact runtime/source predecessor `fd93231d2704320353747948092274859cc05ca7` is terminal-green in Browser Agent Result Installer Source Qualification run `37269153179` on Ubuntu and Windows; full Browser regression, Root Transport, OpenAI/ME2 contracts, Windows R97 visual source proof, SLSA/source-only checks and exact-source readback all passed;
- predecessor package identity `0.7.0-dev.37230000001.1` is already immutably reserved by producer run `37205884480` for source `8c216ee0c67b247c7d80253836de2948d386aae4` and MUST NOT be rebuilt or relabelled; PR Package Smoke correctly fail-closed with `PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED`;
- this successor changes package.json, both package-lock version fields and this convergence reservation in ONE Git commit; runtime source is otherwise unchanged from the terminal-green predecessor above;
- Package Smoke remains the sole physical producer. Every Installed Chat / Final Runtime / Dirty Profile / Autonomous Soak / Self Update consumer must bind the same exact source head, version and installer digest;
- live Supabase migration/deployment and production promotion remain closed until the new exact-head package is terminal-green and Computer Authority Plane runtime evidence is proven on Windows.
Reserved package identity is `0.7.0-dev.37230000001.1`.

Atomic Root Transport contract correction and fresh physical reservation (2026-10-04):
- runtime source is unchanged from qualified `59f24cf78faf6fe38fa2b9b2d00b68c9149ce445`, Linux/Windows source qualification `37204436247`, and full local Browser 4087 PASS;
- predecessor candidate `0634bed33afa150f2f8f29af123b292ce2c63cde` is NOT qualified: Root Transport behavioral tests passed 25/25, but its stale inline static contract demanded the retired GLM Enter lane;
- `0.7.0-dev.37220000001.1` is consumed by producer `37204978252`, immutable reservation artifact `11304666555`, and MUST NOT be rebuilt or relabelled;
- the replacement static fence verifies active ChatGPT type -> fresh exact draft readback -> one Send and legacy read-only dispatch; it is also included in Linux/Windows source qualification;
- focused Root Transport 25/25 tests, new static fence, both changed workflow YAML parses and source-only authority checks pass locally;
- public reservation lookup returned HTTP 200 and zero existing artifacts for `0.7.0-dev.37230000001.1`; producer reservation remains mandatory;
- workflow repair, all three package version fields and this authoritative reservation change in ONE commit. Package Smoke remains the sole physical producer;
- all physical consumers must prove this exact head/version/digest. No release/promotion or fresh live fleet qualification is implied.

Reserved package identity is `0.7.0-dev.37220000001.1`.

Atomic fenced ChatGPT-only installer reservation (2026-10-04):
- source qualification: `59f24cf78faf6fe38fa2b9b2d00b68c9149ce445`, run `37204436247`, attempt 1, terminal SUCCESS on Linux and Windows including Windows source visual proof;
- full local Browser proof: 4087 PASS, zero failures/skips; isolated OpenAI ME2 and PRIMARY/CRITIC policy/transport/context tests are green;
- includes exact legacy-root retirement `3a67fedd42568f8f4923fac1a53d1081f98d53a2` on qualified predecessor `3782b73b3f00a9d7eacaa42a4017010cfb374ba6`;
- `0.7.0-dev.37210000001.1` remains consumed by predecessor producer `37198104703` and MUST NOT be rebuilt or relabelled;
- new version, both lockfile version fields and this first authoritative reservation change atomically, without runtime changes after source qualification;
- public GitHub artifact readback found zero existing reservations for `0.7.0-dev.37220000001.1` immediately before this source commit; the producer MUST repeat its real reservation gate;
- Package Smoke is the sole physical producer. Every consumer MUST bind the same immutable source head, version and installer digest; do not rerun a consumed producer or add a second physical push;
- PR qualification does not imply canonical push-only SLSA attestation. Release/promotion remains closed until the relevant supply-chain gate and real authenticated ChatGPT useful-work/critic outcome are proven;
- this reservation does not itself authorize cloud deployment or mass-closing USER tabs.

Reserved package identity is `0.7.0-dev.37210000001.1`.

Atomic ChatGPT live-client package reservation (2026-10-04):
- exact predecessor: `1b5b602f3560f50e67213cb9e63715cd44e78b79`;
- `0.7.0-dev.37200000001.1` was consumed by intermediate source `9d932186e9a563161c53398b655e86e2fcb1ea5e` before package-lock/convergence metadata were aligned; it MUST NOT be rebuilt;
- this successor changes package.json, package-lock.json and convergence metadata in ONE Git commit so Package Smoke cannot reserve a half-updated source identity;
- fresh one-build identity: `0.7.0-dev.37210000001.1`; Package Smoke is the sole physical producer and every physical consumer must bind this exact head and installer digest;
- live Client remains on the older installed runtime until exact-head Package Smoke + Installed Chat + Final Runtime + Self Update evidence is terminal green;
- promotion/release remains fail-closed until real ChatGPT fleet activation and useful-work readback are proven.

Reserved package identity is `0.7.0-dev.37200000001.1`.

ChatGPT live-client qualification successor (2026-10-04):
- exact source predecessor before this identity-only reservation: `7bb994e8b384965141b90426dd78e95247587f4f`;
- `0.7.0-dev.37195000001.1` is consumed by an earlier Package Smoke producer source and MUST NOT be rebuilt or relabelled for this source;
- live Client `2a60d6a2-c7c2-4dcc-b4c9-99de768443c9` is enrolled ADMIN and currently reaches the source-bound v27 canary through the stable one-client forwarder, while the installed Browser remains the older `0.7.0-dev.37153249506.1` runtime;
- fresh Client DB now contains the typed Workspace Binding registry, snapshot projection and reincarnation transition; live workspace-snapshot readback changed from HTTP 503 to HTTP 200 AVAILABLE without scheduler/browser authority;
- exact build target: `0.7.0-dev.37200000001.1`, above the observed Actions namespace used during this convergence cycle;
- Package Smoke remains the sole physical producer; Installed Chat, Final Runtime, Dirty Profile, Autonomous Soak and Self Update MUST consume the same exact-head immutable installer;
- release/promotion remains forbidden until exact-head physical gates prove real ChatGPT fleet activation and a harmless useful-work cycle with zero active GLM leases/effects.

ChatGPT-only hardening successor reservation (2026-10-04):
- exact predecessor before this identity-only reservation: `13bd9712db490f1f29571cef59999559b3da1699`;
- Package Smoke run `37193954391` proved `0.7.0-dev.37191000001.1` was already reserved by prior source `a10af067c85e13a3c9d44cb1a6fd42062e85cb96` (artifact `11298721325`), so rebuilding or relabelling it is forbidden;
- current source adds physical-command GLM/Z.ai quarantine, fresh-project bridge routing, modern Supabase secret-key compatibility, DB active-GLM fencing, fail-closed missing-frontier behavior, role-only sovereign endpoints, and regression/falsification coverage;
- fresh monotonic one-build identity: `0.7.0-dev.37195000001.1`, chosen above current observed Actions run namespace `37193954391`;
- Package Smoke remains the sole physical producer; every downstream physical workflow must consume the same exact-head installer and fail closed if the producer is not terminal SUCCESS;
- this reservation is non-authoritative and does not itself authorize Edge deployment, release, live installation, database migration application, fleet dispatch, or production promotion.

Installed Chat qualification successor reservation (2026-10-04):
- exact predecessor before this identity-only reservation: `77d4244f2b47aacce84ab97203ad4e3b746ea969`;
- predecessor `0.7.0-dev.37185000001.1` was already physically consumed by Package Smoke on source `07fb59c16f4f1224a95673734979d8f8e51d468f`;
- the successor corrects installed ChatGPT preconnect evidence from legacy `https://chat.z.ai/` to active `https://chatgpt.com/` and adds a regression fence rejecting Z.ai as ChatGPT evidence;
- fresh monotonic one-build identity: `0.7.0-dev.37191000001.1`, chosen above the latest observed Actions run id `37190157197`;
- Package Smoke remains the sole physical producer; downstream Installed Chat / Final Runtime / Soak / Self Update must consume the exact immutable installer for the successor source;
- reservation alone grants no production, release, live-install, fleet or database mutation authority.

ChatGPT-Only Agent Fleet V1 physical-qualification reservation (2026-10-04):
- source-qualified predecessor before the identity-only reservation: `b4688d5ae7318fed58fa5e898e867e974ae28915`; Critical Audit, Shell, Chat Control Plane, Meta Orchestrator, Root Transport Bootstrap, Live Control Recovery and R84 Desktop Convergence were terminal SUCCESS on that exact source;
- Package Smoke on that predecessor correctly refused the already-consumed `0.7.0-dev.37153249506.1` before dependency install/NSIS, so no exact-head candidate installer was produced and all downstream physical consumers failed only at immutable-installer acquisition;
- the ChatGPT-only migration changes Browser/ME2/coordination/provider runtime bytes, therefore the qualified predecessor package identity MUST NOT be rebuilt or relabelled;
- fresh monotonic one-build identity: `0.7.0-dev.37185000001.1`, chosen above latest observed repository Actions run id `37184549035`;
- Package Smoke remains the sole physical producer and its reservation preflight must independently prove that both the version artifact name and the exact source candidate artifact are unused before any physical build;
- this reservation alone does not authorize release, production promotion, live installation, Guardian/admission mutation or task dispatch.

Admission recovery convergence successor (2026-10-03):
- exact predecessor `219ebe989a4f7ce2adfeb205a394a47ee55037cf` already consumed package identity `0.7.0-dev.37139234564.1` in physical Package Smoke run `37144386164`;
- this successor changes Browser runtime bytes (ordered keepalive persistence, admission recovery freshness/restart HOLD semantics), so the predecessor identity MUST NOT be rebuilt;
- failed reservation probe on source `38b9fc0e26a8e970cb9ec34da94433e30a551476` correctly refused reuse with `PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED`;
- intermediate source `b414203f3fab105f9eb21cf9a32c17c53fab7615` reserved `0.7.0-dev.37152993016.1` in Package Smoke run `37153032303` (artifact `11285061323`), so that identity is consumed and MUST NOT be reused by the final source;
- final atomic candidate identity is `0.7.0-dev.37153249506.1`; it must be proven from one exact source head once and all physical workflows must consume that one-built installer;
- deployed R83 Edge/canary source remains byte-identical; no production deployment or live admission effect is part of this candidate.

Client admission-readiness submit-fence successor on the qualified ADMIN.1/UI.1/R109/C4.6 authority base. Reserved package identity is `0.7.0-dev.37139234564.1`.

Admission readiness successor (2026-10-03):
- physical predecessor `d9aab89f55d119f9fb9f5660872c8627104fc591` consumed `0.7.0-dev.37136054065.1` and failed before NSIS packaging in R97 visual qualification because GoalComposer cached BLOCKED readiness kept Run disabled after the authoritative fixture had become READY;
- source-only successor `ba5ce72775186fa79995728261ddf4e1f8644549` fixes the race by requiring a fresh typed work-readiness read immediately before submit; exact source qualification `37139234564` passed Linux and Windows including the ME2 production build;
- `0.7.0-dev.37136054065.1` MUST NOT be retried or rebuilt; this successor advances to fresh identity `0.7.0-dev.37139234564.1`;
- the fresh versioned source must itself be source-qualified before the canonical physical branch is advanced once.

Agent result installer successor (2026-10-03):
- user explicitly requested a new installer containing all current changes;
- qualified implementation `3123af9eb17f810c4c08f599040637f1cc5bed01` includes canonical SLSA Package Smoke builder validation from `29d76d8f51bbb307d74f55a306223445516875d1`, bounded transcript census/tail harvesting, size-drift guards and non-claim prompt templates;
- source qualification `37103459439` passed Linux and Windows; its namespace reserves fresh monotonic version `0.7.0-dev.37103459439.1` before any physical build;
- predecessor `a68774eb6ad5a0fe8014501163b0c67f608bed09` / `0.7.0-dev.37086632570.1` is consumed and must not be rebuilt;
- qualify this versioned source first, then fast-forward the canonical physical SLSA branch once; Package Smoke remains the sole producer and all ten workflows must consume the same source/version/installer;
- generic AX assistant authorship and positive generation-completion proof remain separate useful-work gates; packaging does not close C4/C5 live Agent qualification.

Guardian observation successor: Settings and Native Supervisor heartbeat now share one bounded single-flight status observer. A cached positive result becomes fail-closed STALE after 10s; activation invalidates the prior observation generation before any physical owner/bootstrap path, so a late pre-activation READY cannot overwrite the newer state. Guardian is carried inside the already-qualified `host_resilience` plane in both ordinary heartbeat and realtime observation pushes, so no Edge/canary source drift is required. This is diagnostic only: it does not open Supervisor admission or add retry/execution authority.

Pipe response candidate `f799cbef` physically built `0.7.0-dev.36907623240.1`; that identity is consumed. The native enrollment deadline successor reserves higher observed workflow namespace `36908273822`.

Pipe classification candidate `1379e0c3` reserves `0.7.0-dev.36891107801.1`; this attempted identity is conservatively consumed. The malformed-receipt/deadline successor reserves higher observed workflow namespace `36907623240`.

Qualified Guardian candidate `5b585ae3` physically built `0.7.0-dev.36832190273.1`; that identity is consumed and now installed live. The pipe-observation successor reserves the higher observed workflow namespace `36891107801`, preserving monotonic installer identity.

Candidate `11a3857e` physically built `0.7.0-dev.36814827922.1`; this identity is consumed. The SCM policy readback/physical-drift successor advances again.

Guardian UAC candidate `06c8ef64` reached physical NSIS build with `0.7.0-dev.36832129848.1`; these bytes are consumed. The bounded UAC acknowledgement/identity successor advances again.

Source-binding attempt `ec20a79e` reserves `0.7.0-dev.36814563379.1` and is consumed. The final native/Edge-oracle successor advances again.

Bootstrap source `5aaae3e6` reserves `0.7.0-dev.36812444308.1`; its package attempt is treated as consumed. The source/deployment binding successor has a distinct higher identity.

The Guardian enrollment-only predecessor `c1e93e7c` already built `0.7.0-dev.36811827764.1`; this identity is consumed. The current successor adds a separately elevated, embedded-asset machine bootstrap and correct durable enrollment readback.

Previous installed package identity is `0.7.0-dev.36760350225.1`. Previous qualified package identity is `0.7.0-dev.36806234662.1` (719febc trusted prerelease installer SHA-256 `dd646b69c14031a84e89118a4c8cdfcc8455c320c8c086f1bb8cb4fe2de9814d`). Earlier qualified predecessors remain historical evidence. An intermediate a7ee919c runner also physically built (but did not publish/upload) `0.7.0-dev.36800636112.1`; those ephemeral NSIS bytes are treated as consumed and the final recovery identity advances again. A later 3c7d37c runner reached physical NSIS build with `0.7.0-dev.36801335283.1` before the final read-only-prefetch oracle fix; that identity is also consumed. Release seal `214681b` reached physical NSIS build with `0.7.0-dev.36801826934.1` before Installed Chat exposed the release-push OIDC admission gap; that identity is consumed as well. Release-policy candidate `a1c87d` reached physical NSIS build with `0.7.0-dev.36804801205.1` before the legacy PR-only OIDC source oracle was updated; that identity is consumed as well. The 719febc package line and successor dcbbb17d both reached physical NSIS build with `0.7.0-dev.36805822180.1`; that package identity is consumed and MUST NOT be reused for Guardian bootstrap bytes. The recovery candidate changes packaged runtime/UI bytes and must advance above both identities. It restores CLOSED workspace authority and truthful execution readiness; it does not claim that Supervisor rollover, Agent-origin execution or useful-work completion is already qualified live.

Historical ADMIN.1 changed packaged runtime bytes above UI.1 `0.7.0-dev.36719340135.1`, R109 `0.7.0-dev.36516587173.1` and R97/live `0.7.0-dev.36336130139.1`. The current candidate reserves a higher observed workflow namespace with the canonical `.1` suffix before building; the final producer run, installer SHA-256 and released artifact identity must still be recorded separately on the exact final source SHA.

Canonical production authority:
- one Native Browser Supervisor/Fleet task and Agent lifecycle authority;
- real authenticated ChatGPT Web UI sessions, with durable Agent-origin/session provenance; GLM/Z.ai is legacy read compatibility only and cannot authorize new actuation;
- one geometry-independent Browser effect path with readback and no blind retry;
- Browser Brain and durable memory remain Native Browser-owned;
- Browser-packaged ME2 is a standalone read-only, zero-authority compatibility probe;
- legacy ME2 Mission Control scheduler, Browser/Agents/Command/Compute authority pages and daemon task-mutation UI are retired;
- historical managed-model/API coordination is quarantined from production Agent execution.

Primary UI contract:
- one persistent Chat Fleet workspace;
- supervisors and fleet agents on the left;
- exact selected native Agent/Chat WebContents on the right;
- advanced observation surfaces are non-authoritative unless explicitly bound to canonical DevOS mutations;
- no second scheduler, executor, browser-command authority, retry plane or model API fallback in the renderer/runtime.

Release safety invariants:
- ambiguous external effects are reconciled, never blindly replayed;
- no authority widening or bypass of Guardian/Sentinel, self-update receipts, installer barriers or successor qualification;
- source qualification does not imply live Edge equivalence: exact stable/canary source binding and deployment qualification remain separate mandatory evidence;
- tested source SHA, built installer and released installer must be identical in the final release chain;
- full Self Update E2E consumes and re-verifies the same Package Smoke installer, records zero consumer target builds and waits for its exact producer terminal success;
- concurrent fresh startup shares one durable device identity initialization and never changes the signing key under an enrollment request;
- promotion requires terminal-green exact-head critical gates plus physical clean/upgrade/self-update and post-update ChatGPT Agent E2E evidence, including an explicit negative proof that no active GLM/Z.ai command, lease, navigation or inference effect occurred.


Attempted successor identity `0.7.0-dev.36909837122.1` was consumed by the first CI matrix (Package Smoke #3111 started). R83 static canary correctly rejected its temporary Edge-source drift. The correction reuses the existing qualified `host_resilience` plane and reserves `0.7.0-dev.36963586969.1`; no canary manifest or deployed Edge is advanced by this client-only diagnostic slice.


Identity discipline correction: `0.7.0-dev.36963586969.1` was already physically produced by Package Smoke #3117 on `3bf5583b…` (installer SHA-256 `62d01c10f5dfb9456036cb7f25edfccee449f87e4609d789e51a40e704e67b91`). Subsequent source head `c9207919…` inherited the same package string and started Package Smoke #3119 before the reservation advanced; those bytes are therefore collision-contaminated and must never be promoted or relabelled. The next clean source reserves `0.7.0-dev.36964688887.1`, higher than every observed workflow id at reservation time.

Final reservation discipline before the next qualification: `0.7.0-dev.36964688887.1` was superseded while Package Smoke runs #3123/#3124 were cancelled and #3125 was still queued during rapid source/checkpoint commits. It is retired conservatively. The post-research exact source now reserves `0.7.0-dev.36965151413.1`; no further source/checkpoint commits should land before this identity reaches a terminal exact-head matrix, otherwise the identity must advance again.


Guardian semantic-hardening successor: stale/invalidated observations no longer carry current positive service/owner/device proof, historical proof is explicitly namespaced as last-confirmed evidence, and observer validation rejects contradictory or proof-less READY states. This remains diagnostic-only and adds no admission/retry authority. Parent heartbeat source `1f6902da…` physically produced `0.7.0-dev.36965151413.1`; that identity is consumed and is never reused by this successor.


Build Identity V2 successor (2026-10-02):
- stacked qualified base: `bf21d71b6dc674c376bd396487b5efc134d0a3e9` / Guardian semantic hardening PR #1090;
- frozen implementation source before reservation: `5a75a4129e305752b868f1d0604319e9b30122e1`;
- reserved one-build package identity: `0.7.0-dev.36970010001.1`, chosen above the latest observed repository workflow id `36968682903`;
- deterministic `metaengine.browser.build-identity.v2` binds repository/repository-id, exact source, Package Smoke workflow, run id + rerun attempt, package version, platform/arch, builder config, installed dependency-resolution digest, electron-builder version and Node version;
- Package Smoke computes an expected identity before packaging, beforePack recomputes/injects it, afterAllArtifactBuild independently reads it back from packaged app.asar, and installer-provenance v2 binds it to installer/blockmap bytes;
- downstream Installed Chat / Final Runtime / Soak / Self Update continue consuming the single exact Package Smoke artifact and now require v2 build/dependency proof;
- dependency resolution currently proves the actual installed npm name/version tree, not byte-level reproducibility; a reviewed lockfile + npm ci remains the next supply-chain hardening boundary;
- Build Identity is evidence only: `authority_effect=false`, no release/promotion/admission/Guardian authority.

Seven malformed-workflow push records (#3128-#3134, run ids 36968517070..36968682903) occurred during the editing incident before the workflow was reconstructed. Every one completed FAILURE with zero jobs and zero artifacts, so no installer/package physical build occurred on those heads. They are retained as parser-failure evidence, not as consumed physical package identities. After repair, branch pushes no longer created Package Smoke runs because the valid push filter does not include this branch.


Build Identity V2 first qualification correction:
- frozen PR #1091 head `04fce17d3b6de1b8a5399962887bad8070d2b740` started Package Smoke #3135 / run `36970396272` with reserved identity `0.7.0-dev.36970010001.1`;
- the runner failed at the new read-only dependency-resolution step **before** expected identity computation, packaging, candidate upload or installer execution;
- exact root cause: Node 24 on Windows returned a null spawn status when the helper attempted to execute `npm.cmd` directly through `spawnSync`; the diagnostic was `dependency_resolution_npm_ls_failed:null`;
- no Package Smoke candidate artifact was produced on that head, but the identity is retired conservatively because the physical Package Smoke runner had started;
- Windows npm invocation now goes through the trusted OS command processor (`ComSpec /d /s /c npm.cmd ...`) with only fixed internal npm arguments; spawn errors are explicit and bounded;
- corrected successor reserves `0.7.0-dev.36972000001.1`; no bytes from the failed attempt may be relabelled as this version.


Build Identity V2 second qualification correction:
- PR #1091 head `53fe4cb128fd4dc7cb525201d80a23924f8a997d` started Package Smoke #3136 / run `36970617815` with `0.7.0-dev.36972000001.1`; that identity is retired conservatively and will not be reused.
- Package Smoke reached only dependency observation / expected-identity preparation. It produced no candidate installer artifact and did not run NSIS because the expected identity rejected two concrete proof defects first.
- defect 1: recursive dependency validation accidentally added the returned object instead of its numeric `.count`, so every non-empty tree failed `dependency_resolution_count_mismatch`;
- defect 2: npm's installed-tree JSON can contain unresolved optional placeholders such as `bufferutil` / `utf-8-validate` with no installed version. Those placeholders are now excluded from the installed name/version tree rather than accepted with an empty synthetic version;
- auxiliary Windows package workflows (for example Dirty Profile) are no longer forced to provide Package-Smoke-only provenance inputs. Build Identity V2 is mandatory only when `ME2_BUILD_IDENTITY_REQUIRED=true`; the official Package Smoke producer sets that flag and still fails closed if any identity input/readback is missing.
- the convergence reservation at the top of this file is now authoritative and matches package.json; the stale first reservation was the direct cause of the convergence package-identity regression.
- corrected successor reserves `0.7.0-dev.36973000001.1`, above all workflow ids observed before this commit. Any later source change after its Package Smoke runner starts must retire it and advance again.


Build Identity V2 Self Update harness correction:
- exact source `2a0022d1e0119620f7badff4621cb5ff1ed5ab7c` physically produced Package Smoke #3137 / run `36971539452` with `0.7.0-dev.36973000001.1`; installer SHA-256 `28c3199c1accb761a412bca2eecfcb3e323fe74baa63fda263d7d8de0dd9893d`, Build Identity `2e8c125f036ee27566a5857ab5c94fe65c2d400cf7ba0af1204fee4c79ae1ee1`, dependency-resolution `e37879804789c4354b0c732f2ac7a05fdfb70bf5c82a3c6849d79265200dc7f5`;
- 9/10 exact-head workflows passed; Self Update #3594 failed before installer acquisition/effect because the negative-test fixture correctly caught a native refusal but left its non-zero `$LASTEXITCODE` visible to the GitHub Actions PowerShell wrapper;
- Microsoft PowerShell semantics explicitly preserve the last native exit code across directly invoked scripts unless another native/script exit replaces it; the fixture now clears only the handled expected-refusal status and asserts that no stale native exit leaks out;
- no updater/installer failure was observed on that head and no Self Update physical effect started;
- `0.7.0-dev.36973000001.1` is consumed because Package Smoke produced bytes; the corrected exact source reserves `0.7.0-dev.36974000001.1`.


One-physical-producer fence successor (2026-10-02):
- qualified Build Identity V2 base `4c3dd26f9d89bb5e5b04c1eb4a21a5c434dba86b` physically produced and fully qualified `0.7.0-dev.36974000001.1`; installer SHA-256 `f37a5a9604c0dfbb5bf86fba2042ba2e211ac5064a9ac3efeb8e5896a37638bd`; Build Identity `52d075fee4a9fe9729836481743857f75dc90566150b15d93137dc829290eeb2`; that version is consumed and is never reused;
- Build Identity V2 embeds GitHub run id/attempt into packaged bytes, so an Actions rerun of an unchanged source/version could otherwise manufacture different bytes under the same updater version;
- Package Smoke now refuses any `GITHUB_RUN_ATTEMPT != 1`, serializes the physical producer job by package version without canceling an in-progress producer, queries immutable GitHub artifact history for prior version/source evidence, and fails closed on API ambiguity;
- an immutable `metaengine-browser-package-version-<version>` reservation marker is uploaded and its artifact id/digest sealed before dependency install and electron-builder;
- old PR/ref-level `cancel-in-progress:true` was removed from Package Smoke because canceling a physical producer is incompatible with one-build evidence;
- early workflow-parser attempts #3139-#3142 had zero jobs and zero artifacts due a duplicate YAML `timeout-minutes` key; no physical bytes were created by those records;
- corrected workflow source after parser repair produced no push-triggered runner on this non-matching branch, confirming the valid trigger filter is restored;
- upload-artifact digest output is normalized from its documented raw SHA-256 form into canonical `sha256:<hex>` reservation evidence;
- frozen successor reserves `0.7.0-dev.36977000001.1`, chosen above latest observed repository Actions run id `36975111718`; once its Package Smoke runner starts this identity is consumed even if the run fails before NSIS.


Frozen npm dependency material successor:
- qualified one-producer predecessor is `8409fb249887dd4636b3bd6fab40bfe30fa4b085` / `0.7.0-dev.36977000001.1`;
- this branch adds a package-lock material verifier before wiring any physical build;
- `0.7.0-dev.36980000001.1` is reserved but unconsumed until a Package Smoke producer starts;
- no PR/physical Package Smoke should start until a committed lockfile and clean npm-ci proof exist.


Build Identity V3 physical-qualification correction (2026-10-02):
- draft PR #1093 exact head `245920c1a45851a1d30c25341ce2ca33457bc5c7` started Package Smoke #3144 / run `36988305577` with `0.7.0-dev.36980000001.1`; immutable package-version reservation artifact `11218079311` was created, so this identity is consumed and will never be reused.
- Self Update #3597 failed in the read-only qualified-installer compatibility fixture before installer acquisition or update effect. Under `Set-StrictMode -Version Latest`, the shared consumer's Verify path dereferenced V3-only `package_lock_sha256` fields on a valid historical V2 binding that intentionally does not contain them.
- V3 verification remains strict, but V2 historical compatibility now avoids all V3-only field dereferences; the terminal producer-gate projection likewise emits V3 lock/Bun fields only for V3 provenance.
- the exact PowerShell V2 compatibility fixture is now part of the source-only Windows qualification, so this class of regression must fail before another physical PR is opened.
- corrected successor reserves `0.7.0-dev.36990000001.1`, above all Actions run ids observed before this correction. No further source/checkpoint commit may land before its source qualification completes; after its next Package Smoke runner starts, this identity is consumed.


SBOM evidence successor line:
- predecessor `d283150bc8a3338a76b98c369b67fb7e846b207b` / `0.7.0-dev.36990000001.1` is terminal V3-qualified 10/10;
- branch `work/build-sbom-evidence-v1` adds evidence-only npm SBOM inventory before release-boundary attestation;
- `0.7.0-dev.36991000001.1` is reserved but remains physically unconsumed until a future Package Smoke producer starts;
- SBOM digest is not Build Identity authority and does not authorize promotion.


Composed SBOM physical-successor correction (2026-10-02):
- exact source `5d3c8ac80934df60db9753cf709bf6eba2daeb33` started Package Smoke #3148 / run `37005013624` with `0.7.0-dev.37002000001.1`; the immutable reservation artifact was created, so that identity is consumed and MUST NOT be reused even though the broader matrix exposed a source-contract failure;
- Shell/Critical/Self Update contract gates correctly found that `CONVERGENCE_CANDIDATE.md` still reserved the predecessor `0.7.0-dev.36991000001.1` while package.json had advanced. This is an evidence/governance mismatch, not permission to relabel the running physical producer;
- the isolated source-only successor reserves `0.7.0-dev.37006000001.1`, updates package.json + package-lock + this convergence reservation together, and must complete source qualification before it can replace the physical PR head;
- no automatic retry, release, promotion, live install, Guardian enrollment, Supervisor admission, or task dispatch is authorized by this correction.


SLSA physical closure successor (2026-10-03):
- consumed predecessor: `b8f2f438bf3d9450a301ebb525eb95181f6d464d` / `0.7.0-dev.37076000001.1`; never rerun or reuse that source/version;
- functional source: `fae5eae066576a6cdd30f4f336769c2b1b4787ac`, source qualification run `37084599153`, full Linux and Windows Browser Node suites SUCCESS;
- fresh monotonic package reservation: `0.7.0-dev.37084599153.1`, using that observed qualification run namespace; producer reservation preflight remains mandatory before packaging;
- installed qualification backend: Meta `jhriwwsryeqsvvvufkok`, function V8 pinned to the qualified source; exact physical push workflow/ref/source/run/attempt binding, nonce approval unchanged;
- one Package Smoke producer, existing Sigstore/Rekor attestation and independent verifier, exact downstream producer event fencing retained;
- new source qualification and all ten physical workflows must pass on this successor before it is offered for installation; no claim of production release or real z.ai Agent task/result closure follows from packaging evidence.


Self Update V3 physical closure successor (2026-10-03):
- consumed predecessor: `c80e0fb46dc8c701462beb7f74dd8ff45867ac74` / `0.7.0-dev.37084599153.1`; Package Smoke and 8 other workflow families passed, while Self Update #3605 / run `37085197258` failed before installer acquisition/effect in the local re-verification fixture;
- exact failure: under PowerShell StrictMode, ambient physical-branch auto-fencing inferred `ExpectedProducerEvent=push` during `Mode Verify`, then dereferenced the synthetic legacy fixture's intentionally absent `producer_event` property;
- V3 fix keeps automatic physical push event fencing for `Acquire` and `Wait`, while local `Verify` remains branch-agnostic unless a caller explicitly supplies an event;
- source-fix head `e91b483c0bca90a2f7699b2553b11720b37fc06a` passed Linux and Windows source qualification run `37086632570`, including the exact PowerShell fixture under simulated physical push environment plus full Browser Node regression;
- Installed Chat on the predecessor physically proved Supabase installed-qualification function V8: function logs show the expected 202 waiting response followed by 200 approval on deployment `jhriwwsryeqsvvvufkok_add28328-d282-4942-9fa1-c2302da1e23f_8`;
- fresh monotonic package reservation: `0.7.0-dev.37086632570.1`, derived from the final qualified source run namespace and never previously physically started;
- the next exact candidate must source-qualify at its own versioned head before `physical/build-slsa-provenance-v1` is advanced; all ten workflows must again consume one Package Smoke installer and run at attempt 1;
- no rerun of the consumed predecessor, release, promotion, live user install, Guardian enrollment, Supervisor admission, or task dispatch is authorized by this reservation.


Admission recovery no-replay successor (2026-10-03):
- source implementation `6e859e109fe50e242859af5d2bd715d15afccb92` passed Browser Agent Result Installer Source Qualification run `37136054065` on Ubuntu 24.04 and Windows 2025, including the full Browser regression, SLSA topology/version-reservation checks, Windows updater verification, exact source cleanliness and an isolated Bun 1.3.3 ME2 UI production build;
- the Client now exposes one explicit `Resume execution` control for authoritative `WORKSPACE_EXECUTION_PAUSED`, but success is accepted only after a fresh independent `/v1/devos/environment-state` readback; a mutation receipt alone is never shown as success;
- the durable local recovery journal persists `SEND_INTENT_DURABLE` before the server effect and never automatically replays an ambiguous attempt. A later explicit user action performs readback-only reconciliation first;
- `a2-browser-native-supervisor-v1` deployment V11 preserves the V10 source except the exact `devos-routes.mjs` import pin, now bound to qualified source `6e859e109fe50e242859af5d2bd715d15afccb92`; the deployment is ACTIVE and existing signed heartbeat/command traffic remains healthy;
- current authoritative workspace state remains CLOSED at generation floor 28; this source/package reservation does not reopen admission, promote an Agent, activate Guardian, dispatch a task, publish a release or install on the user machine;
- fresh monotonic package reservation: `0.7.0-dev.37136054065.1`. It is physically unconsumed until Package Smoke creates its immutable reservation artifact. Move the physical branch only after this versioned source itself is source-qualified; then all ten physical workflows must consume the one Package Smoke installer at attempt 1.

Computer Authority V2 typed-readback source qualification re-arm (2026-10-05):
- successor branch `work/computer-authority-plane-v2-typed-readback-r1` is now included in the dedicated source-qualification workflow after the effect-proof / effect-barrier / visual-freshness stack;
- the source gate must prove the exact current head before any fresh package identity is reserved; inherited `0.7.0-dev.37310000001.1` remains consumed and MUST NOT be reused for a physical build;
- this metadata-only re-arm adds no runtime, scheduler, retry, DB, release, install, or authority effect.

Computer Authority V2 typed-readback physical reservation (2026-10-05):
- exact runtime/source predecessor `df2fe05f9ca09e7ce1d204bb42f2b13ad47aae73` passed Browser Agent Result Installer Source Qualification run `37299883365` on Ubuntu 24.04 and Windows 2025, including full Browser regression, Windows physical fixed-bridge STATUS + exact-window capture, R97 source visual flow, updater verification and exact-source cleanliness;
- inherited `0.7.0-dev.37310000001.1` was previously consumed by another exact source and remains permanently non-reusable;
- fresh repository search found no code, pull request or issue use of `0.7.0-dev.37330000001.1` before this reservation;
- this atomic commit changes only package.json, the two package-lock root version fields, and this convergence checkpoint; runtime/authority source remains byte-identical to the terminal-green predecessor above;
- Package Smoke remains the sole physical producer. Any new runtime/source change after this reservation retires `0.7.0-dev.37330000001.1` and requires a new monotonic identity; no blind retry, release, live install, scheduler authority, DB authority or promotion is authorized by this reservation.
