# Codex account-ID protocol follow-up: observation exists, custody remains HOLD

The pinned upstream app-server can expose a non-secret backend account/workspace ID. METAENGINE still lacks the original authenticated process/home/session owner and its cancellation-aware handoff through BEGIN to Host. No new production source patch is provided in this follow-up.

## Version and source identity

METAENGINE's packaged private tools lock selects stable `0.166.0`, tag `rust-v0.166.0`, Windows release `428320524`, asset `689710836`, archive SHA256 `d559bb88e74d471265857b93b7f19bc250dae527673b9191b33534478093f6bc`. The official tag resolved to commit `6ff1e1ca3b30fc8b914720681fcf5fe62e95f856` (annotated tag object `593389380740f7b4762771573c447ccfdc59742f`). All upstream links in the evidence use that immutable commit.

The separate effective-policy overlay pins `rust-v0.159.0-alpha.3`, commit `3b01b36fa5eb96ba82a776bd3c2fc57f8969181f`, and remains a staging build; it is not the manifest-bound executable selected by loaded Main. Its rate-limit schema also has optional/nullable `accountId`. Neither this source comparison nor the user's locally observed `0.166.0-alpha.1` schema qualifies the installed Windows package. This isolated environment's `codex --version` reports `0.159.0-alpha.3`; no authenticated invocation was made with it.

METAENGINE qualification used verified source tree `2dbe253e97379532f6f4b52ef7edf26109a9266d` plus the previous fail-closed account patch. That patch is unchanged, SHA256 `c3407baa7a7ddef0e5440456efcd7ba163b778c9936c06fb65814990fe8e7514`.

## What the pinned protocol actually supplies

`account/rateLimits/read` returns `accountId` from the backend usage payload. It is a string or null and may be omitted according to JSON Schema; only `rateLimits` is required. This is the workspace/account associated with a usage snapshot. Backend `user_id` is separate and is not returned by this response. No home identity, auth owner generation, lifetime lease, METAENGINE operation binding or cancellation/join proof accompanies the ID.

Crucially, the implementation compares the backend workspace and user to current authentication only to filter `ordinaryUsageAllowed` and the banner. It forwards the raw `accountId` even for a mismatch. The upstream regression explicitly expects that behavior. A non-null ID is therefore insufficient evidence that the usage snapshot belongs to the currently selected authentication owner. Percentages, email, reset times and a positive usage flag cannot close the missing custody path.

There are stronger observation fields than usage:

- `account/read.workspaceRouting.chatgptAccountId` reports the selected workspace after routing discovery. This response field is experimental and omitted by default generated schema exports. The `account` subobject itself has no ID. Inspected runtime code emits the routing field; schema omission must not be mistaken for runtime absence or for a complete capability gate.
- Experimental `accountSession/list` returns the active managed-login `sessionId`, separate `userId` and `selectedWorkspaceAccountId`. `accountId` is a workspace identifier, not a user ID. Cached reads and membership-refreshing reads have different freshness semantics. External-auth/API-key/signed-out modes do not supply a managed session.

The selected-workspace reader observes auth owner changes, validates membership/routing and rejects stale owners during discovery. Account notifications recheck owner generation before enqueue, but remain snapshots; clients reread account and requirements. Notifications alone do not transfer authority to subsequent work. These are useful genuine upstream observations, not an existing METAENGINE custody producer.

See `protocol-agent/protocol-evidence.json` for 15 findings, exact source ranges and 21 full-source hashes. Its verifier checks the pinned source and schemas without compiling or starting Codex. The upstream Rust mismatch tests were inspected; they were not executed here.

## Exact missing producer and handoff

1. `apps/metaengine-browser/src/main.mjs:1311` still defines `const readCodexAuth = async () => null;`. The private reader at `native-coding-initial-setup-composition.mjs:79-104` receives no original auth-home/session/process capability or account-lifetime cancellation signal.
2. The selected `CODEX_HOME` is the app-owned `stateDirectory/codex-home-v1`, created only during explicit BEGIN root preparation. There is no existing authenticated pre-BEGIN owner for that same home, no single-instance/auth generation custody and no verified transfer from another home. Reading an ambient user's Codex context would observe a different object.
3. The native controller retains genuine process handles for its supported one-shot launch protocols, but has no existing persistent app-server JSON-RPC transport owner. A PID, pathname, copied process record, JSON-RPC response or new arbitrary callback cannot substitute for that owner. Timeout/cancel/reconnect must revoke the same process/session, discard late responses and physically join original I/O/process work; this path is absent.
4. `initialNativeSetupProviderChoices` carries configuration and policy. Signed `initialNativeSetupBeginInput` and Host `validateNativeSetupInput` carry repository/source preparation, without account/session/home custody. The exact contract rejects added account JSON. Main's later asynchronous signature wait checks device, Host and app lifetime, without a genuine account-revocation fence; no such producer is available to bind there.

The minimum missing component is a Main-owned retained authentication capability for the exact selected app-controlled Codex home, original verified app-server process/stdio and managed login/workspace generation, with a scoped pre-BEGIN origin, synchronous revocation plus joined cancellation, and one-way private handoff/revalidation in the existing Host setup scope. Copying an ID into signed JSON would not provide it. Introducing a new trust root, bypassing native gates or treating a usage observation as that capability is not justified.

Consequently production remains `PRODUCER_UNAVAILABLE` / `native_initial_selection_codex_account_producer_unavailable`. The previous patch's checks close its tested readback windows, but do not establish continuous account custody. No claim of a working Main, authentication producer or ready installation is made.

## Tests and deliverables

The audit contains reproducible protocol/source checks, audit-only negative checks against actual METAENGINE modules, and logs from existing setup/custody contracts. Generated observations and simulated native suppliers are explicitly labeled; passing contract tests are not real authentication or Windows evidence. Exact commands/results are recorded by each agent's JSON report.

Results: **7/7** read-only protocol/source assertions (including **21** source hashes), **7/7** audit-only negative tests, and **243/243** existing contract tests (**50** initial-setup + **193** custody/transport). No failures or skips in the final Node runs. The retained first-run audit log records one corrected test assertion label; no production implementation was changed to make it pass.

To reproduce, run `python3 protocol-agent/verify_protocol.py --codex-repo <official-source-at-pinned-commit> --metaengine-repo <verified-METAENGINE-source>` beside this report. Run `node --test <path-to-this-audit>/custody-agent/absent-interface-negative.test.mjs` with the METAENGINE repository as the working directory, or set `METAENGINE_SOURCE_ROOT` to that repository. Neither test invokes a real app-server or backend. Upstream Rust tests, the exact installed Windows binary and real authenticated session/cancellation/handoff qualification are **NOT RUN**.

Audit-only tests reject raw usage snapshots as private authentication facts, account/home/session additions to Host BEGIN, copied public process records as original custody, and an invented RPC input protocol. A matching claimed usage ID does not turn a missing producer into an authenticated one.

No production source file changed in this follow-up. No installation, login, token/auth-file inspection, account switching, authenticated backend request, credit request/consumption, inference/model call, DB/service/PC modification, protection weakening, merge or shared-branch update occurred. The official source was fetched only for read-only inspection.
