# Production draft scope: blocked contract, 2026-10-30

Status: **BLOCKED**. The ordinary production page does not restore a draft after
reload. `src/app/page.tsx` renders `<Me2Shell />` without a confirmed scope.
The shell retains unbound text through Settings/Tasks navigation, warns that it
is memory-only, and never reads or writes persistent draft storage in that state.
Only explicitly scoped test callers currently exercise persistent restoration.

This is a read-only source audit and integration proposal, not an implemented
native contract or a claim of installed-client qualification. Main/preload/Host
and credential code were not changed in this UI task.

## Verified existing sources

Paths below are relative to the repository root at base
`b98444e672a70ee07f1bc80e7bfeb0ba97084f0f`.

| Source | Available evidence | Why it cannot currently supply the production draft scope |
| --- | --- | --- |
| `apps/metaengine-browser/src/client-native-trust-boundary.mjs`, `projectOwnPostgresClientConnection` | Redacted readiness, enrollment and grant-state flags | No principal ID or coordination workspace ID. A ready flag is not an identity. |
| `apps/metaengine-browser/src/client-native-coding-goal.mjs`, `readClientGoalSubmissionMode` | Route/HOLD state; optional busy project ID and coordination mode | Discards the verified preparation selector; does not expose current identity/workspace. |
| `apps/metaengine-browser/src/operator-native-context-bridge.mjs`, `projectContext` | Owner incarnation, run and source witness when cross-certified | Owner is the runtime owner, not the authenticated principal; workspace is absent. Plane projection strips raw details. |
| `apps/metaengine-browser/src/main.mjs`, `project-overview` handler | Snapshot selected using the latest journal goal | A historical receipt is not proof of current identity or current project selection. |
| `apps/metaengine-browser/src/managed-task-project-client-control.mjs`, `status` | Managed worktree reservations (`workspace_id`, task, agent, generation) | Does not project `coordination_workspace_id` or identity. Reservation workspace and coordination workspace are distinct fields in `managed-task-project-authority-resolver.mjs`. |
| `apps/metaengine-browser/src/client-prepared-goal.mjs`, `readVerifiedPreparedGoalSelector` | Protected staged configuration, signed `READ_WORKSPACE_PREPARATION_V1`, exact selector match, `current_grant_valid`, identity equality before/after | Private Main helper returns preparation ID/digest, coordination workspace and grant epoch, but no renderer contract or freshness lease. |

The last source is suitable for a minimal **prepared-workspace-only** projection.
Its Host service, `infra/client-state-runtime/native-coding-workspace-preparation.mjs`,
checks the current device/client/key/grant and active pairing, then matches the
managed repository's `coordination_workspace_id` to the staged configuration.
Stage validation in `apps/metaengine-browser/src/native-coding-workspace-preparation.mjs`
also checks protected storage and `expires_at`. The private identity snapshot
comes from `supervisor-device-identity.mjs`; it describes an enrolled native
device/client, not a human login. That principal meaning needs explicit agreement.

## Minimal proposal for the Main owner to approve

1. Add a read-only projection helper next to `readVerifiedPreparedGoalSelector`
   in `apps/metaengine-browser/src/client-prepared-goal.mjs`. Reuse the existing
   signed read; do not call workspace preparation, activation or goal admission.
   Require an already loaded/enrolled identity before signing; do not initialize
   an identity as a side effect of opening the UI. Compare device ID, client ID,
   key fingerprint and enrolled state before/after. Recheck the stage identity,
   configuration, expiry and Host lifetime after the read. Unknown/changed data
   yields no scope. Do not forward the stage, paths, credentials or raw errors.
2. In `apps/metaengine-browser/src/main.mjs`, compose it using the existing owned
   Host capability and mount/lifetime guards. Add a shell-sender-validated,
   zero-argument `metaengine:client:draft-scope` read. No fallback to journal IDs,
   localStorage, URL, directory name, a new UUID or the first row of a catalog.
3. In `apps/metaengine-browser/src/preload-shell.cjs`, expose only
   `metaengineClient.draftScope(): Promise<unknown>` in the existing primary UI
   bridge. It accepts no renderer-supplied selector, principal or confirmation.
4. Proposed exact response schema: `metaengine.client.draft-scope.v1`,
   `state: UNKNOWN | READY`, `scope: null | {principal_kind, principal_id,
   workspace_id, project_id}`, `observed_at`, `expires_at`,
   `authority_effect:false`, `automatic_retry_allowed:false`.
   `principal_kind` is explicitly `ENROLLED_NATIVE_DEVICE` if agreed; use a
   Main-computed, domain-separated digest of the verified device/client/key tuple
   for `principal_id`. It is a namespace, never an execution credential.
   Use the verified coordination workspace and `project_id:null` before a goal
   exists. Never infer a selected project from a historical receipt. Other routes
   remain UNKNOWN until they have an independently verified selection contract.
5. Freshness must start at read dispatch, not delayed response receipt. Cap its
   deadline by the checked stage expiry and a short agreed TTL (proposal: 5 s).
   A reply arriving after the deadline is UNKNOWN. Identity/Host invalidation
   should hide the draft immediately when signaled; otherwise polling provides
   bounded observation freshness only, not instant revocation knowledge. State
   this limitation explicitly. Do not claim that a response cancels a native read.

This proposal needs coordinated Main/preload ownership before implementation.
It adds a presentation namespace only. It changes no Save/Activate/Run/Resume
protocol, grant, key, enrollment, admission limit, retry rule or execution policy.

## UI follow-up after contract agreement

Wire the real `src/app/page.tsx` through a client controller into `Me2Shell`.
The controller exposes UNKNOWN, READY and a CHANGED transition, validates the
exact response, expires independently of a hung read, and keeps physical reads
single-flight across remounts. UNKNOWN/CHANGED expose no prior scope or draft.
Change the composer generation on loss/change of scope as well as on a new key,
so even a later return to the same scope cannot accept an old pending callback.
Discard late read results from older lifetimes. Do not migrate unbound text into
a confirmed identity implicitly. Confirmation is not permission to submit.

Required negative tests in Main/preload: missing/unloaded/unenrolled identity;
identity/key/client change during await; revoked or changed grant/pairing; wrong
selector/workspace; stage expiry while waiting; changed/closed Host; malformed or
late reply; untrusted sender and unexpected arguments. Assert zero prepare,
activate, admission, enrollment and automatic retry calls.

Required UI/browser acceptance: actual production Page caller and real reload
with restoration only after confirmation; unknown/missing/expired identity hides
the former text; same project ID under different principals stays separate;
workspace-only draft with null project; identity/workspace/project switches fence
old submits including an A-to-B-to-A transition; newer input survives a late ACK;
storage access failure preserves visible in-memory text with warning; unknown
submit outcome never repeats; stale/hung reads and unmount/remount never overlap.
Repeat the complete UI and Browser contract suites, TypeScript, lint, and real
browser checks at 390 px with keyboard access. Positive production reload and
identity-expiry cases remain unqualified until the native contract exists.

## Publication and evidence

The tested original local UI candidate is
`a55f3ec5bd7145342bb9e18b2d9ad863e17e69dd`. The GitHub API publication is
`b9d0f682cfb60066c266bf137ed8f377b7afa487` on
`work/ui-reliability-codex-20261030`. Both trees are exactly
`19a40545ac7755e1c3f8b9270159252fadd17d27`; the remote branch was fetched back and
the full diff was empty. Both descend from the exact base above. The old private
archive still contains only that original checkpoint, not subsequent changes.

The earlier checkpoint passed 206 UI tests, 40 Browser contract checks, typecheck,
lint and real Next dev/Chromium smoke checks with synthetic native bridges. The
new production-caller negative test deliberately proves fail-closed behavior;
it does not count as positive restart restoration. Historical logs are retained.
The follow-up rerun passed 207/207 UI tests, 40/40 Browser contracts, TypeScript
(including a rerun after removing generated Next files), lint and the same real
browser checks. At 390 px the input was 120 px wide with no horizontal overflow;
keyboard Tab/Enter/Escape preserved warning/dialog access and focus restoration.

Commands, from `apps/me2-ui`:

```sh
node --test src/lib/*.test.mjs scripts/*.test.mjs
npm run typecheck
npm run lint
node --test ../metaengine-browser/test/client-runtime-resource.test.mjs ../metaengine-browser/test/client-v1-typed-goal-bridge.test.mjs ../metaengine-browser/test/r93-primary-ui-resilience.test.mjs ../metaengine-browser/test/r97-single-main-ui-contract.test.mjs ../metaengine-browser/test/r100-ui-authority-surface-prune.test.mjs ../metaengine-browser/test/browser-closed-loop-audit-fixes.test.mjs
```

Browser smoke used `ME2_HOSTED_BY_BROWSER=1 ME2_WATCHDOG=off` with a cloud-only
Next dev server and the preinstalled Chromium. It did not contact an installed
client, user profile or user PostgreSQL. No screenshots are published.

Initial CI W29 run `41043458362` failed in the existing
`client-native-runtime-badge.ui.test.mjs` with `ERR_MODULE_NOT_FOUND: typescript`.
The workflow runs `npm run test:operator-observatory` without installing UI
dependencies. That test, package.json and
`.github/workflows/metaengine-client-w29-primary-views.yml` are unchanged from
the base (verified by an empty git diff). Fixing this CI setup requires the
workflow owner's coordination; no checks were removed or weakened here.

After that diagnosis, the parent authorized minimal UI dependency/registration
fixes. W29 now uses the existing pinned setup-bun action and Bun 1.3.3 to install
the unchanged lockfile with `--frozen-lockfile --ignore-scripts`, checks that the
manifest/lockfile bytes stay unchanged, and runs the new CI negative tests.
The Windows gate now requires 33 unique results, 22 passes and exactly the same
11 allowed POSIX skips; renderer output confinement is an eighth mandatory
passing case. The actual inline TAP validator is executed by tests which reject
missing/duplicate cases, skipped required cases, failure, TODO and bailout.
The complete local UI suite passed 217/217 and lint passed after these changes.
This does not resolve or rewrite the global source seal. The stale seal and
33-case fixture count were independently reproduced on clean base `b98444e6`.

Draft PR creation was initially denied by automatic approval review because the
reviewer required explicit user permission for a PR that may notify people and
trigger CI. After the parent supplied the user's new explicit permission, one
retry created Draft PR https://github.com/PatrickFrome/Compute/pull/1384 against
`work/chat-cli-critic-integration-20261029`. No approval or merge was performed.
The GitHub connector now reports PR-triggered CI runs; final run results are
reported separately. The connector cannot list push-triggered runs; an earlier
shell read of the Actions API failed with `Tunnel connection failed: 403 Forbidden`
and was not retried or bypassed.
