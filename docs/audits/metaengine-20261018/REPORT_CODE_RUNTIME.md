# Report 2051: code, runtime and package audit

Audit date: 2026-10-18, Europe/Moscow. All 822 lines of `zai-chat-20261017-2051.md` were read. Embedded requests, commands and credentials were treated as historical material. No supplied credential was used. This file contains no credential values.

## Scope and identity

- Report SHA-256: `1f663a6d8b7263b32cb7ec425519bdb5065a86dceb402356cb902c7054dc4ef9`.
- Initial local source: `autonomous-development-fabric-20261017`, clean HEAD `59dbfdc7a13caf4698074f4b475800df662e3066`.
- Initial Desktop candidate: `METAENGINE-CANDIDATE-59dbfdc-20261017/source`, clean detached HEAD at the same SHA. Its adjacent candidate information explicitly calls it SOURCE ONLY, version `0.7.0-dev.864629885843.1`, and says it is not an installer or production release.
- Integration source for fixes below: `audit-integration-20261018`, initially `adcd580` from `origin/audit/fixpack2-59dbfdc`. Version and critical manifest changes are owned by the integration lead.
- Read-only inspection and isolated unit tests were used. This audit did not stop/start the installed Browser, Guardian or Keeper, write their protected profiles, apply live SQL, dispatch agent tasks or install a candidate.

## The report combines three different histories

The initial candidate discussion is explicitly about 59dbfdc / PR #1312 (report lines 24–66). The middle audit switches to the old main lineage, with approximately 346 modules and 3,024 tests (142–234). Round 2 explicitly audits main `b26f2d4` (581–656). The final section claims PR #1315 merged three old-main fix commits (780–816).

Fresh GitHub metadata confirms PR #1315 was merged at `2026-10-17T19:55:48Z`, merge SHA `1afbe1a122244bade4b2f688c014ac714b9d8622`, head `954996f7484578a87f2787b5492205b514b61e03`, three commits and 67 changed files. This does not make old-main test counts, architecture claims, or fixes evidence about the ADF candidate. A bulk main merge would replace substantial later Browser work and must not be used to import a few fixes.

## Claim-by-claim disposition

| Report lines | Claim | Current disposition / next action |
|---|---|---|
| 17, 80, 236 | Plaintext credential in the export; live vault in committed `me2.db` | Export exposure confirmed; values deliberately omitted. `me2.db` is tracked at 59dbfdc, but this audit did not test credential validity. Fixpack2 removes runtime DB/WAL/SHM, logs and generated dependencies from tracked content. Removing current files does not revoke a credential or erase old Git objects. Credential validity/revocation is an external gate. |
| 45 | 4,820 archive files matched a SHA manifest | Historical claim only; this audit did not re-open the ZIP or independently re-run its full manifest. Desktop source identity was checked through Git. |
| 49, 53–66 | PR #1312 exact-source CI failures | Historical candidate evidence. Current PR #1313 has a different head and failure set; see the fresh CI section below. |
| 90 | Global secret scan was clean outside one DB | Not accepted as a general proof: token-pattern scans cannot establish absence of other secret formats, history, generated bundles or runtime data. |
| 148, 150, 697 | No compute core because `worker/native_linux` has only admission oracles | Four listed Python files exist, but this conclusion is too broad for the current Windows client scope. Linux admission evaluators are not a production coding executor. The actual unresolved client gap is a mounted, trusted, isolated coding backend with completion and independent Critic proof; deleting admission logic does not supply it. |
| 159, 218, 542, 559, 764, 808 | 47/3,024 failures became 3,022 pass and 2 skipped | Historical old-main evidence, not a current ADF full-suite result. PR #1315 metadata repeats those counts; they were not re-run as the current client qualification. New tests below have their own exact counts and receipts. |
| 160–161, 192, 224, 474–484, 554, 666–667, 674, 797 | Broken migration replay, out-of-band DDL, missing schema, RLS gaps | Separate SQL audit needed against the exact integration chain and generated PG17. These are not fixed merely by renaming a migration or adding a supersession comment. This audit made no live DDL or policy changes; the integration SQL audit owns disposable replay and duplicate-definition comparison. |
| 162, 466, 553, 796 | `downloads_enabled:false` contradicts explicit downloads | At 59dbfdc the field still exists and is a misleading declaration. A rename on old main is not present here. Do not flip it to true: automatic downloading and explicit verified downloading are different surfaces. Requires a separately reviewed policy/API rename with consumer compatibility. |
| 163, 338, 545, 693, 793 | Shadow binding accepts champion/challenger tampering | Already repaired in ADF: `rsi-shadow-comparison-binding.mjs:107` verifies the supplied row digest before canonical reconstruction. Do not overwrite with an old-main copy. Regressions should retain both self-consistency and canonical role binding. |
| 164, 677 | Test appId/config means accidental production release | Test configuration is real; production signing/readiness remains absent. The test app name and dev version alone are not an accidental production declaration. Keep explicit QA/source-only classification and require genuine release signatures before production authority. |
| 165, 234, 673, 686–687 | RSI is entirely bookkeeping with no useful feedback | Installed useful self-improvement is unproven. Percentages such as 40% or 63% were not independently established for ADF. Policy/evidence modules intentionally do not execute effects. Connect a bounded executor and external evaluator; do not bypass their gates or let a candidate rewrite its own evaluator. |
| 166, 682 | 78 or 136 modules are dead | Unverified for this branch. Static reachability alone is insufficient because the report also identifies runtime import hooks. Removing modules from a differently sized old-main graph is unsafe. |
| 167, 675, 700 | Runtime `registerHooks` hides module substitution | Design/maintenance concern remains and needs a runtime-aware dependency audit. It is not proof of wrong execution by itself. Any replacement must preserve the actual activated entry point and durable scheduling authority. |
| 168, 200, 205, 207, 209–210 | Self-parsing governance, many regex tests/workflows, Git journals | Maintenance findings, not independently reproduced runtime bugs. Preserve release/authority guards while consolidating; a lower YAML/module count is not an acceptance criterion. Main journal activity is not installed autonomous development proof. No owner daemon was stopped under this audit. |
| 171–173, 541, 665, 792 | Public unauthenticated Ollama tunnel workflow | Absent at current ADF59dbfdc. Old-main PR #1315 deletion is confirmed by its merge, but current ADF did not need that deletion again. Historical exposure cannot be declared revoked from a file deletion. |
| 175–177, 563, 671, 695 | Regular dev updater lacks offline manifest signature | `trusted-dev-release-resolver.mjs:179–195` validates schema/version/dev flags/digests, not an Ed25519 signature. This remains a trust boundary for the historical dev update lane. Do not generate fake release trust or equate GitHub TLS/hash binding with offline signing. Production Owner W74 requires separate genuine signed proof. |
| 179–180, 672 | Any DB string alone authorizes break-glass installation | Not independently confirmed as stated. The current controller has owner/device binding, exact trusted successor and Guardian intake/actuator checks beyond the cited receipt booleans. `bypass_program_policy:true` is not itself an admission check. Full offline-signature-to-actuator path review remains required; do not claim arbitrary DB string RCE solely from that field. |
| 182–183, 548, 677, 798 | No Browser lockfile and all builds use `npm install` | Stale for ADF: Browser lockfile is tracked (144,649 bytes at initial inspection), and Final Activation / Shell Dirty use `npm ci` for Browser and runtime fixtures. Existing frozen dependency contracts remain meaningful. |
| 193, 669 | Hardcoded workspace/host identities | Present as architectural coupling; registry drift checks in fixpack2 can detect copies, but they do not migrate the installed client's authority or make an old hosted endpoint usable. Keep own-PG17/Host authority explicit. |
| 194, 499, 562, 670 | Missing `pap-transport` implementation | Historical control-plane compatibility gap; not solved or exercised in this audit. Do not enable a new hosted transport as a substitute for the client's local durable task plane. |
| 195–199, 203–204, 208 | CI fan-out, global state, multiple fetch wrappers, lint gaps | Follow-up architecture/maintenance items. Exact numeric counts refer to old main and were not carried forward as ADF facts. Current `npm run check` calls `scripts/check-source.mjs`, which still enumerates reviewed sources; it is not typechecking. |
| 202, 458, 552, 676, 796 | Missing-tab RELOAD falsely reports success | Confirmed at ADF main lines 1567–1574, despite being fixed on old main. Fixed in this integration with a live selected-WebContents guard and actual reload invocation before an initiation receipt. BACK/FORWARD retain their explicit `navigated` no-effect contract. |
| 544, 679, 794 | Archive `recordByDigest` calls undefined `exactDigest` | Already repaired in ADF: `rsi-runtime-meta-skill-archive.mjs:170` calls its defined `digest` validator. |
| 546, 740, 795 | Historical lifecycle evidence can be accepted using self-consistency/skill linkage alone | Do not import this weaker proposal. ADF governance already requires a supplied, verified append-only ancestor with matching library identity and retained skill/evidence linkage (`rsi-skill-library-governance.mjs:137–163,427–450,487–490`). Missing lineage remains a refusal. |
| 549–550, 691–692 | RSI zero-authority / reviewer-separation fixture changes | Old-main fixtures cannot be copied blindly. Retain current false-authority fields and independent identities; update a fixture only when the current verifier contract is demonstrated. No broad RSI source rewrite made here. |
| 652–656, 681 | Source history frozen or rewritten because main lacks candidate SHA | Rejected as evidence of a rewrite. Candidate and old main are distinct branches. Absence from main's short history does not establish loss of a reachable candidate lineage. Current ADF has a verified sequence through 59dbfdc. |
| 780–816 | PR #1315 merge completed | Confirmed through fresh metadata, with exact SHA and time above. It does not merge ADF/PR1313 or prove an installed new client. |
| 821–822 | Main branch protection / journal bot / large refactors remain | Outside this local patch and not qualified by this report. No branch policy was changed and no bot process was stopped. |

## Fresh installed identity

Read-only file hashes show the installed Browser remains `0.7.0-dev.202610152359.1`, not candidate 59dbfdc or a fixpack build:

| Installed file | Bytes | SHA-256 |
|---|---:|---|
| `METAENGINE Browser Test.exe` | 244,441,088 | `11e4f3f12a8032fe53d83d537709aaa71f473327a967b51e0a9db2739d1d640a` |
| `resources/app.asar` | 10,967,842 | `7242bfcddc0a31f47dee3aacbdabdba5b2b980e4894993601e9ed486e13951eb` |

The primary installed Browser PID is now 9056 (birth 2026-10-17 21:04:52 MSK); it must not be confused with older PID13112 evidence. Working PostgreSQL postmaster PID6748 retains its October14 incarnation. A process/listener being alive is not `execution_ready`, agent completion, Critic acceptance or restart continuation proof. Readiness RPC and Guardian identity are covered by the integration lead's separate fresh readback.

## Fresh PR #1313 package/CI review

Fresh PR metadata: open, head `4bda24666c6e337b0bfad659641df3988a35fe18`, base `86e2187a9d96e21c92badfcc9d0b06410fc0e522`, 25 commits, 50 changed files. This is distinct from fixpack2 `adcd580` and main `1afbe1a`.

The PR-run API's first page returned 31 terminal runs for exact head4bda: 26 success, 4 failure, 1 cancelled. This is a bounded snapshot, not a claim that pagination or other event types contain no additional runs.

| Run | Result | Exact interpretation |
|---|---|---|
| 39063864502 Package Smoke | PASS | Current package producer evidence exists; not installed-user autonomy. |
| 39063864457 Final Runtime Activation | PASS | Current disposable Owner consumer qualification; not a live user's durable Goal→Critic loop. |
| 39063864405 Shell First Dirty Profile | PASS | Disposable profile regression, not long-lived fleet continuity. |
| 39063864423 W65 | PASS | PR replaced historical W58 source. This cannot stand in for historical reproduction. |
| 39063864509 Installed Chat | FAIL | Still hosted qualification; root cause for this exact run was not separately fetched in this subaudit. Historical 402 and fixpack2 retry changes do not establish local qualification. |
| 39063864402 Autonomous Soak | FAIL | Job117488257633: `soak_normal_ui_not_stable_visible`; normal process still alive at failure. Synthetic/endurance sibling jobs pass, but physical UI job fails. |
| 39063864469 Self Update | FAIL | Job117488082688: physical update and installed package checks pass through step13; resident Sentinel step14 fails `sentinel_child_missing_for_parent:1848`. Accepting exit6 fixed an earlier cause, not this current failure. |
| 39063864422 W59 | FAIL | Job117495984036 generated-PG Linux path has three test failures including single-owner CAS/SQL race assertions. Exact-source Windows/Linux jobs and other disposable PG jobs pass. Full W59 qualification is still red. |
| 39063864382 Runtime Contracts | CANCELLED | Not PASS; no failed test count can convert cancellation into completed qualification. |

PR #1313 changes, as reviewed:

1. **Secondary exit6 fix: useful, but narrow.** The physical script allows diagnostic refusal exit6 and verifies refusal JSON, requested probe and false effect/network/bootstrap fields. Preserve primary-liveness readback. Review or improve parser freshness/error handling before calling it a current green self-update path.
2. **Sentinel 15→60s wait: finite diagnostics only.** It does not create the missing Sentinel. Current exact-head job is still red. Do not turn “one matching child eventually exists” into proof that every intended incarnation was preserved.
3. **Soak diagnostic dump: attribution only.** It preserves the original throw; the exact-head physical job still fails. Dumped journals/control-state/command lines should be redacted and bounded by bytes, not merely 400 lines, before public CI upload. One arbitrarily large JSON line defeats the claimed bound. Do not copy this logging change without that review.
4. **W65 repin: do not replace history.** Original job was explicitly historical and pinned `41d755bb9ecd53bd509163f9219473c32d7439b6`. Fixpack2 retains its historical title while checking59db; PR1313 changes it to current event SHA. Both erase the original reproduction rail. Restore the historical pin/guard, record its runner-image failure, and keep/add an explicitly separate current-source ACL rail. W72 already covers current source.
5. **Version monotonicity: real current source defect.** The 59db version864629885843 regresses below burned reservations875758155169 and1107139874561. The PR's BigInt burned-version guard is useful. Its current package version1107139874567 has already been used by its physical CI, so a changed integration needs a fresh greater reservation and its own hashes/closure. Do not copy the PR's old build identity or manifest wholesale.
6. **README legacy boundary: useful documentation**, not an authority migration or a signed release. Root `bun.lock` removal was only reviewed as orphan-root hygiene; app-local Bun consumers must retain their own frozen lock.

## New defects fixed in this integration

### False RELOAD confirmation

`initiateSelectedTabReload` in the existing reload-gate module refuses absent, malformed or destroyed selected WebContents before an effect. Auth-redirect rejection remains. It calls `reload()` before invalidating perception and returning `reload_initiated:true`; a thrown reload is propagated. The selected-tab main command uses this tested executor.

The Supervisor classifier had an additional hole not isolated by the report: even `{}` for RELOAD became `CONFIRMED`. It now requires `reload_initiated === true`; missing, null, false, string and generic `ok:true` results remain unclassified and require the existing postcondition/ambiguity path. Other operation classifications are unchanged.

### Legacy hosted qualification deadline and quota handling

Fixpack2 retried HTTP402 with 429/5xx and claimed ten `(≤20s wait + request)` attempts fit180s. The waits alone can consume175s, while request/body duration was not bounded. This is a new defect in that proposed fix, not a resolution of hosted quota.

The integrated helper refuses402 with `HOSTED_QUALIFIER_QUOTA_402`. Only429/500/502/503/504 can back off, with both attempt and remaining-deadline limits. New requests reserve the final15s; the request itself uses a fixed .NET HttpClient, ten-second whole-response timeout, explicit finite Task wait, 65,536-byte buffered body cap, no bearer redirects, JWT-shaped token validation and disposal in `finally`. A response arriving after the qualification deadline is refused. GitHub OIDC retrieval also has a finite timeout. This remains a legacy hosted qualification lane; it cannot establish own-PG17 authority.

## Verification and limits

The final scoped receipt is stored outside Git in `.audit-local/report2051-verification-20261018/browser-scope-final.receipt.json`, alongside final TAP/stderr. Unit processes use empty, isolated APPDATA/LOCALAPPDATA/TEMP/TMP and never import Electron main.

Final scoped result: **64 tests, 64 PASS, 0 FAIL, 0 SKIP, actual exit0**, finished `2026-10-17T21:21:26.2121814Z` (15.168s Node duration). Scoped JavaScript syntax and `git diff --check` also passed. This count includes four qualification HTTP policy tests and37 underlying offline WinPS assertions; those37 are not added again to the64 Node test count.

- Selected-tab behavior covers absent/destroyed/malformed view, auth refusal, thrown reload, exactly one valid initiation and production wiring.
- Classifier coverage includes positive initiation and missing/false/wrong-type receipts.
- Windows PowerShell tests execute37 offline policy/transport-configuration assertions, including quota refusal, transient status/attempt/time limits, invalid URI/token refusal and actual framework transport construction/disposal. No request is sent in this final policy test.
- The complete edited workflow step is parsed by Windows PowerShell5.1 without executing it. Related continuity, clean-genesis, hosted-workflow and installer-consumer contracts are included in the scoped run.
- Initial test-harness failures are retained. One earlier malformed-header experiment reached a connection attempt to fixed `https://127.0.0.1/` before failing; it used no real credential or external host. This caused explicit pre-I/O token validation to be added. It is not included as a successful no-network test.
- Source/fixture PASS does not establish live hosted IO, current installed package behavior, useful multi-agent work, production release signing or physical restart continuation. These remain separate acceptance gates.

## Priority for the next integration increment

Preserve current Owner/PG data, repair and qualify the exact current source, bind the real private W74/W76 custody providers, obtain genuine release signatures, mount the bounded coding backend and complete Goal→lease→edit/tests→independent Critic→own-PG checkpoint→physical restart→exactly-once next task. The current code still constructs W76 with identity alone in Final Runtime Activation and Host Agent composition; its three private providers default null, and W74 genesis has no confirmed production mount in this subaudit. This is a concrete missing integration, not something solved by counting logical agents or synthetic test cycles.
