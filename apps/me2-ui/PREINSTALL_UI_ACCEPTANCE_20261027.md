# Stream 4: UI pre-install source acceptance, 2026-10-27

**Source work is READY_FOR_REVIEW; installed UI / real Owner qualification is BLOCKED.**

- Task: [#1358](https://github.com/PatrickFrome/Compute/issues/1358).
- Coordination: [#1354](https://github.com/PatrickFrome/Compute/issues/1354).
- BASE_SHA: `9d7527683060e314eb1d39fec9ce2304a57103c4`.
- Exact application source built and executed: [`ff91a1d8fa2df70e33e35d6267ae4194c32ca7da`](https://github.com/PatrickFrome/Compute/commit/ff91a1d8fa2df70e33e35d6267ae4194c32ca7da).
- Branch: `work/preinstall-ui-20261027`; draft PR base: `work/preinstall-closure-20261027`.
- The later handoff commit adds the source acceptance harness, its tests and these reports/evidence. It does not relabel either local standalone payload as a new application source or a central installer. Exact final HEAD/PR and post-commit checks are recorded in #1358.

## Confirmed repairs

1. **Journal and receipt correlation.** After admitted A, rejected-before-dispatch B has a real valid journal entry with `receipt:null`. The old UI kept A's receipt, displayed A's Task/Project beside B's Request and refreshed A. The repaired observer replaces the journal/receipt pair, including null, validates receipt/progress/proof request correlation and prefers the current journal request. Failed reads retain old observations with an explicit stale warning instead of falsely clearing the error. Late responses and unmounted callbacks remain fenced; readback never replays submit.
2. **Local runtime readiness.** A work projection saying READY can no longer override a separately observed `local_runtime_ready:false`. Valid explanatory BLOCKED states still render. The Host retains its own effect checks; no authority bypass is claimed.
3. **Complete runtime inventory.** A new acceptance-only `path-kind-mode-content-link-v1` snapshot covers root/directory/file modes, empty directories, links and their targets, all file bytes, and the original manifest. The existing production file-content scheme and shared Browser verifier remain unchanged. Concurrent replacement/change controls fail closed. Windows ACL/ADS/reparse metadata and transient writes between sampled observations are not implied by POSIX snapshots.
4. **Acceptance shutdown accuracy.** The new source harness requires a running owned Node child, its own successful SIGTERM and an allowed terminal readback. Unexpected pre-existing exit (even zero), exit 1 and forced cleanup cannot become PASS. Real inert child regressions cover this guard.

## Evidence and source boundaries

[Machine-readable summary](evidence/preinstall-20261027/source-summary.json) and
[complete evidence archive](evidence/preinstall-20261027/source-proof-ff91a1d8.zip)
contain exact commands, source-file hashes, TAP, build and syscall logs, original manifests, all before/running/after snapshots, renderer screenshots and the rejected reused-staging observation. Archive entries are checksummed in `SHA256SUMS`.

Archive SHA-256: `7b66786cbac0db3d67d68275643d24e270ae3b7e8bf6f401d49946a5598d302b`.
Archive bytes: `1552029`; entries: `67`.

The final executed harness SHA-256 is `e506f94236fc10eb4aa3f2f7104a7771dec16709c05ca253a56914f8392fbff4`.
The first two probes used the preserved earlier harness; their observed requested SIGTERM / exit 143 also satisfies the subsequently tightened guard. The final fresh-staging probe executes the tightened harness itself.

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Exact application-source UI suite | 110 PASS / 0 FAIL / 0 SKIP | Clean detached worktree at ff91a1d8; includes installed dependency/config canaries |
| Existing focused Browser contracts | 43 PASS / 0 FAIL / 0 SKIP | Same source; content/host/loopback/local-profile/journal/read-model tests |
| Handoff UI suite including new shutdown tests | 117 PASS / 0 FAIL / 0 SKIP | Source file hashes retained; 7 extra actual-child harness tests |
| TypeScript and ESLint | PASS | Complete UI; no dependency refresh |
| Independent source review | 39 PASS / 0 FAIL / 0 SKIP; no blocker found | New inventory/journal/readiness tests and actual Browser journal contracts |
| Two clean offline builds | Both terminal exit 0 | Node 24.22.1 / Next 16.4.1; frozen dependencies provisioned beforehand |
| Writable + readonly first payload probes | PASS | Real Node/Chromium; each compares full tree before/running/after |
| Final fresh second payload, readonly | PASS | Hardened harness; read-only write probe returns EROFS |
| Current-source closure seal | 16 PASS / 1 FAIL / 0 SKIP | Expected stale seal for the changed me2-shell.tsx; coordinator owns reseal |
| Central Windows installer / actual Owner / embedded Node binary | BLOCKED | No artifact or disposable Windows consumer was supplied |

Counts from overlapping reruns/reviews are not added to invent a larger unique test total. Regression evidence is retained: journal 3 PASS/14 FAIL before repair -> 17/0 after; readiness 2/2 -> 4/0; shutdown 3/4 -> 7/0.

## User-visible source acceptance

The real standalone server serves HTML, a nonempty static JS asset, RSC and the actual 404 path. Chromium loads and hydrates the real UI. Five renderer scenarios pass:

- No native bridge visibly yields unavailable connection, roster and admission.
- A simulated received result remains `Received · review pending` and explicitly requires independent verification.
- Simulated native disconnection clears the previously READY badge.
- A real UI Run click against an explicitly synthetic native bridge changes admitted A into rejected B; the dialog retains no old request/task/project identity.
- Failed journal read remains visible; Refresh targets B; only the single explicit Run called submit.

The bridge is **inert synthetic test input**. These screenshots and assertions are not actual Owner connection, useful-work execution, independent Critic, installed acceptance or autonomous continuation evidence. The central disposable Windows consumer must still verify those paths using genuine observations.

## Offline and immutable-runtime results

Bun 1.3.3 was used only for frozen-lockfile dependency provisioning with lifecycle scripts disabled. Each clean `next build` then ran via Node in its own Linux network namespace, with loopback enabled and no external interface/default route. Syscall tracing records one loopback worker connection and zero external connect attempts for each build. Existing effective-config canaries additionally exercise Next's upgrade assessment/nudge functions with zero fetch calls, plus actual fetch/image cache implementations with no disk cache writes. Telemetry is disabled; the explicit `agentUpgrade:false` policy is retained.

This is repeatable offline build from an already provisioned exact dependency tree. Cold-cache offline installation and byte-identical build output are not claimed: Next assigns a new Build ID. No bulk audit, metadata submission to a bulk advisory endpoint, version change or mass dependency update was performed.

| Local source payload | Build ID | Content files | Content SHA-256 |
| --- | --- | ---: | --- |
| First build, writable + readonly | `N6XW-kLDlbj0ZmLzmodKV` | 1254 | `65b1f4c49e4783bfebff345a5e1b70db835fbb027979581e36ca9dd2638051a7` |
| Second build, fresh staging + hardened readonly probe | `ZoItmCaxunmNlwbN7iHJw` | 1254 | `32039d2bb797fb5bb45cc5847ecebc6183ab21d5a8f40f0ccb4d56aad2e1cf22` |

First payload full-tree hash before/running/after both probes: `b54442f0b8149c5b023bff26980388ce6e0ca8eed53174b24f3828d556e38bf3`.

Final fresh payload has **1495 entries**, including directories and manifest, **57,111,241 bytes**, with identical before/running/after full-tree hash:

`5bf0ee2cc7cb8da4f4efd28a26ab7884abd2ee32e04c1fe3b44b3da1354623ce`.

Its original manifest SHA-256 is `f901dd7452451f71666860214c9957fcdc8d3341e59d2b949e05f7f807e3937e`.
The full snapshot JSON file SHA-256 is `796bf4d77293883fb0997bcbe8afbcc9a4228de8da885e123f69a7e38b201aef` in all three phases.

### Runtime network attribution

In the final traced run, the standalone Node process and all 11 traced descendants make **zero connect/sendto/sendmsg calls**; they bind/listen once on loopback. Page-origin external requests and page errors are empty. Node's actual HTTP replies use other write operations; this is not a claim that the server emits no network data.

The separate Chromium Network Service makes **38 non-loopback connect attempts**, all rejected with ENETUNREACH by the isolated namespace. Its raw sendto/sendmsg counts are retained without inventing a destination classification. One unidentified terminal Chromium syscall and one raw send with unknown completion are explicitly retained; no such unresolved call belongs to the standalone Node family. Therefore the report does **not** claim zero external attempts for the entire browser process tree. This observation is consistent with browser background/proxy activity; the underlying cause was not independently changed or isolated.

### Rejected reused-staging observation

The initial second-build pack succeeded, but later inventory verification observed 1257 files against the manifest's 1254: three old first-Build-ID static manifests appeared after the second manifest had been written. Their old bytes and restored old mtimes, later ctimes, missing/current-file counts and manifest hash are retained in `postpack-2-mutation-observation.json`. Current `.next/standalone/.next/static` contained only the second Build ID. Both default and escalated readers saw the same mismatch.

The invalid payload was rejected and preserved; it was not resealed or accepted. The writer is unknown. External workspace restoration is a hypothesis, and no packer defect is asserted from that hypothesis. Copying the second standalone into a previously unused staging root was content-compared, then the **unchanged** packer created a distinct source payload. It passed verification both before/after executor return and the final readonly browser probe. This successful fresh payload does not turn the earlier failed observation into PASS.

## Default runtime and dependency disposition

The existing production host selects direct standalone `server.js` with its embedded Electron-as-Node when `ME2_UI_BIN` is absent. Focused host tests and source inspection confirm that selection; local source execution here used standalone Node 24.22.1. The actual embedded Electron binary is still part of the unperformed Windows consumer.

Explicit Bun override / Bun package start remains the separately documented Bun 1.3.3 / Next 16.4.1 CommonJS-wrapper limitation. It is not the default packaged Node path, was not silently replaced, and was not requalified by these Node runs.

See [bounded dependency applicability](DEPENDENCY_APPLICABILITY_20261027.md) for exact pins, production/development paths and primary advisory sources. No confirmed dependency-specific blocker was found in that reviewed set. Prisma/deepmerge-ts/effect/defu are absent; existing pins address the named Babel/flatted/nanoid/source-map and other reviewed findings. The historical 37-entry audit JSON is unavailable, so this is not a fresh complete audit or a guarantee of zero advisories.

| Disposition | Item | Next action / source |
| --- | --- | --- |
| Actual blocker | One integrated-source installer, producer identity/digests and disposable Windows UI/Owner consumer absent | [Artifact dependency request](https://github.com/PatrickFrome/Compute/issues/1354#issuecomment-6428953242) |
| Integration dependency | Current source seal must be refreshed after coordinator review/merge | Existing guard retained; [coordination observation](https://github.com/PatrickFrome/Compute/issues/1354#issuecomment-6429074935) |
| Closed in source | Cross-request receipt/readback, hidden failed read, inconsistent local READY | Actual callback/resource regressions and Chromium renderer cases |
| Closed evidence gap | File-only inventory misses dirs/modes/link changes; new helper covers them | 18 full-tree regressions plus original manifests and readonly source probes |
| Not applicable to current UI graph | Removed Prisma chain and its former findings | Pinned graph + primary advisory matrix |
| Maintenance / evidence limit | Explicit Bun override, unavailable old 37-entry audit, POSIX vs Windows metadata | Separate qualification; no speculative dependency changes |
| Retained unknown observation | Reused staging acquired three old static files after packing | Writer unproven; payload rejected, fresh-stage result separately bound |

## Coordinator handoff

Changes are confined to `apps/me2-ui/**`. Browser startup/package manifests, release/version reservation/history, producer workflows, integration branch and shared/frozen seals were not modified. No Browser installer was built or installed, and no existing Owner/PGDATA/Guardian/registry was used. The consumed `.178` identity is not a candidate for rebuilding.

The shared PR package workflow currently matches UI changes. Its existing exact-source guard runs before reservation/physical packaging and demonstrably rejects this changed source until coordinator reseal; it was not disabled or skipped. A source-only draft PR is requested by the stream protocol, with any resulting expected seal failures reported rather than relabelled as source or package success.

After review and integration, the coordinator must qualify the final exact SHA, reserve a fresh identity, issue one installer and run the real disposable Windows consumer against that same artifact. It must capture normal UI opening, genuine Owner state/error/useful-result readback, default embedded runtime, outbound observations and complete inventory before/running/after exit. READY_FOR_REVIEW here is not installed-qualified, production-ready or permission to touch the user PC.
