# METAENGINE Compute Unified V1 — Falsifier V1 checkpoint

Date: 2026-08-29
Branch: `work/convergence-falsifier-v1`
Base: `integration/compute-unified-v1` @ `03684f0731e6d12dc477c09f217ea2bca3aa29db`
Scope: browser fleet, Native Supervisor, DP2 sandbox, self-update, branch closing, R16 router.
Production/main mutation: **none**.
Authority effect: **false**.

## Method

Adversarial review against live GitHub state, live Supabase schema/RPC grants/function definitions, divergent Native Browser lineage, and external guidance from OWASP Prompt Injection Prevention, AWS Builders' Library idempotent retry guidance, The Update Framework (TUF), Chrome remote-debugging security guidance, and GitHub branch/ruleset documentation.

The goal was falsification, not architecture endorsement: every boundary was treated as unsafe until a concrete fail-closed property was found.

## Severity-ranked findings

### F-01 — HIGH — Native Supervisor command freshness/replay is not independently enforced at the client actuation boundary

`apps/metaengine-browser/src/native-supervisor-client.mjs` on `work/metaengine-browser-native-supervisor-v1` records `issued_at` and `expires_at`, but `#runCommand()` / `#executeLocalOrRemote()` do not locally reject expired commands, duplicate `command_id`, missing/invalid lease identity, or a stale process/tab incarnation before ARM/DISARM/mode changes or delegated physical actions.

The Supabase command broker is materially stronger: `h205f22_a2_browser_supervisor_lease_control_v4` expires stale PENDING/LEASED rows with no retry, and `h205f22_a2_browser_supervisor_complete_v5` accepts completion only for a current lease held by the matching `client_id`. This reduces normal-server risk but leaves the endpoint fail-open to a stale/replayed command if the control-plane response path is buggy or compromised.

Smallest safe fix: make the Native client reject before actuation unless `command_id` is unseen in a bounded durable replay ledger, `expires_at > now`, `issued_at <= now + skew`, and the command carries the exact current device/process/browser/tab incarnation and lease token/generation expected by the actuator. Server checks remain authoritative; client checks are an independent last fence.

### F-02 — HIGH — CAPTURE_VIEW creates a durable screenshot privacy path without redaction/TTL semantics in the client contract

`captureViewThumbnail()` returns JPEG bytes as base64 together with URL/title. Native Supervisor command results are posted as a receipt, and the Supabase supervisor command model persists command receipts. No redaction class, sensitive-region mask, retention TTL, purpose binding, or `durable=false` marker is present in this capture result contract.

This is not an arbitrary remote-debugging exploit by itself, but it enlarges the blast radius of any supervisor/database/operator compromise. Chrome's 2025 remote-debugging hardening explicitly calls out cookie/credential extraction risk and recommends isolated non-default profiles for automation/debugging.

Smallest safe fix: default screenshots to ephemeral in-memory transport; persist only digest + dimensions + redacted metadata. Durable image retention must require an explicit privacy class, bounded TTL, encrypted object reference, access audit, and a redaction policy. Never persist cookies/storage/DevTools protocol dumps.

### F-03 — HIGH — Accidental `main` promotion is not mechanically prevented by current GitHub policy

Live GitHub state on 2026-08-29: `main` is protected, but its reported required-status-check set is empty and enforcement is `non_admins`; the only repository ruleset is `enforcement: disabled`. The convergence integration branch is unprotected.

This does not prove an admin will accidentally promote code, but it disproves the stronger claim that autonomous branch closing/main promotion is mechanically fail-closed.

Smallest safe fix: active default-branch ruleset with required PR, required named CI checks bound to trusted GitHub Apps, no force push/delete, signed commits where practical, and no broad admin bypass. Autonomous fleet credentials must not have bypass rights or direct main write permission.

### F-04 — MEDIUM — R12 taint semantics and R16 routing are individually strong but not cryptographically/protocol-bound together

R12 correctly makes `PAGE_DATA`, `MODEL_OUTPUT`, `TOOL_OUTPUT`, external files/messages non-authoritative and propagates taint through derivation. R16 is pre-effect only and non-authoritative. However, R16's exact request schema has no required taint-assessment/provenance digest, so a caller can construct a syntactically valid `PRE_EFFECT` routing request without proving that R12 assessed the source graph.

Because R16 emits `authority_effect=false` and `actuation_eligible=false`, this is not direct actuation authority. It is nevertheless a convergence hazard: a future adapter could accidentally treat "routed" as "safe" and launder taint at the R12→R16 boundary.

Smallest safe fix: bind routing to an immutable `trust_assessment_digest`/`authority_proof_digest` produced by R12 (or enforce a single wrapper API that cannot call R16 without that assessment), and require the same digest again at the fresh authority/lease actuation gate.

### F-05 — MEDIUM — Fleet persistence accepts previously bound tab/target identity without transport proof

`FleetProvisioner` correctly sets `browser_authority=false`, `automatic_work_retry=false`, and marks new workers `BOUND_UNVERIFIED`. It also increments `generation_epoch` when tabs are lost. However, loaded state may retain a `tab_id`/`target_id` as long as `tabExists(tab_id)` is true; the init path does not prove that the current physical tab belongs to the recorded agent generation, and `BOUND_UNVERIFIED` is counted as live capacity.

Smallest safe fix: persisted state must contain an unforgeable browser-process/tab incarnation tuple and transport challenge receipt. On restart, every preexisting binding becomes `BOUND_UNVERIFIED` and cannot count as ready/work-eligible until challenge-response proves the exact current target/incarnation/generation.

### F-06 — MEDIUM / UNPROVEN — Self-update security is not yet a converged source-line property

No `self-update` / `self_update` path was found in the current `integration/compute-unified-v1` tree snapshot used for this checkpoint. Therefore secure autonomous self-update cannot be claimed from the convergence line yet.

Before C5/C6 autonomy, require a TUF/Uptane-like update contract: signed target metadata, hash/length verification, monotonic version/release counter, metadata expiry/freeze protection, rollback rejection by default, device/channel binding, staged health check, and recovery that cannot silently downgrade to an older vulnerable build.

### F-07 — MEDIUM — Branch closing remains policy text rather than an enforced closure transaction

`COMPUTE_UNIFIED_V1.md` correctly says historical branches close only after unique code/evidence is integrated, archived as superseded evidence, or rejected with a recorded reason. Current GitHub protection does not enforce that disposition record or CI proof before a privileged actor closes/merges a branch/PR.

Smallest safe fix: make branch disposition a machine-readable manifest keyed by branch head SHA; a closure workflow must verify exact head, disposition kind, required evidence/checks, and `main` promotion authority separately. Closing a historical PR must never imply code promotion.

## Proven negatives / attacks that did NOT falsify the current controls

1. **R16 blind post-effect reroute:** blocked. R16 rejects every effect state except `PRE_EFFECT`, emits `automatic_retry_allowed=false`, requires fresh authority + lease, binds exact executor incarnation, and emits no actuation authority.
2. **R16 metadata smuggling:** blocked by exact request fields. Attempted `authority_effect`, `actuation_eligible`, retry override, and ad-hoc taint metadata are rejected rather than silently accepted.
3. **Simple taint laundering by summarization/derivation:** blocked. Combining trusted policy with page data derives `UNTRUSTED`, non-authoritative output; tainted data cannot itself be used as the browser-authority node.
4. **DP2 candidate gaining production authority from provider self-report:** blocked in the inspected binding layer. Initial network is deny-all, secrets/credential brokering are disabled, host repo mount is forbidden, provider observation remains `PROVIDER_OBSERVED_UNATTESTED`, and execution/promotion authority stays false.
5. **Supabase direct RPC takeover by anon/authenticated:** blocked for the inspected supervisor/chat-bridge/worker enrollment and capability-attestation functions. Live ACL inspection showed EXECUTE only for `postgres` and `service_role`, not `anon` or `authenticated`.
6. **Browser device nonce replay at the DB uniqueness layer:** blocked by unique `(device_id, nonce_sha256)` plus expiry index.
7. **Supervisor duplicate idempotency key in a workspace:** blocked by unique `(workspace_id, idempotency_key)` when non-null.
8. **Remote bridge same-target duplicate lease / ambiguous-effect retry:** materially fenced. The lease RPC takes a transaction advisory lock per target platform, refuses an active target lease, recognizes existing completed/active/`AMBIGUOUS_NO_RETRY` idempotency state, and has a one-consumer predecessor constraint for the GPT-after-GLM path.
9. **Worker enrollment RPC privilege escalation from public roles:** not reproduced; inspected worker enrollment/admission/attestation RPCs are service-role only.

## Added branch-local negative guards

`tests/convergence_falsifier_guards.test.mjs`

Guards cover:
- post-effect / ambiguous-effect R16 routing rejection;
- authority/retry/taint field-smuggling rejection;
- exact R16 executor-incarnation binding and non-authoritative receipt;
- tainted PAGE_DATA derivation remaining non-authoritative at the R12 privileged sink.

GitHub did not automatically schedule an Actions run for this branch immediately after the test commit (`workflow_runs=0`). A container-side checkout could not be performed because that runtime had no DNS/network access to GitHub, so this checkpoint does **not** falsely label the new test file as CI-proven. The source guard is committed; CI execution remains an explicit follow-up gate.

## External research constraints applied

- OWASP: indirect/remote prompt injection requires separation of untrusted content from privileged tool authority, least privilege, and action screening against original intent.
- AWS Builders' Library: retries with side effects need idempotent request semantics; late/duplicate requests and same-token/different-intent cases must be handled explicitly.
- TUF/Uptane: update clients need rollback, freeze, mix-and-match and replay defenses using signed/versioned/expiring metadata and monotonic state.
- Chrome: remote debugging has been actively abused to extract cookies; automation/debugging should use isolated profiles rather than default user data.
- GitHub: required status checks/rulesets only protect promotion when they are enabled and configured; bypass actors must be deliberately restricted.

## Falsifier disposition

**No confirmed CRITICAL unauthenticated takeover primitive was found.**

The convergence architecture has strong local invariants in R12, R16, durable effect fencing, DP2, and Supabase lease/idempotency functions. The largest remaining risks are boundary-composition failures rather than missing primitives: Native client freshness/incarnation verification, durable screenshot privacy, mechanical main-promotion protection, mandatory R12→R16 proof binding, and transport-proved fleet identity.

Do not close historical Native/Self-update/Fleet branches as "safe and autonomous" until F-01 through F-06 have explicit disposition and CI evidence.
