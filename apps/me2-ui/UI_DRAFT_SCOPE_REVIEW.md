# Production draft scope consumer, 2026-10-30

Status: **frontend implemented; integrated Main/preload verification pending**.
The real `src/app/page.tsx` now consumes `metaengineClient.draftScope()` through
`useDraftScope` and passes the confirmed namespace and generation guard to
`Me2Shell`. Reload restoration has been verified through this actual caller in
Chromium with an injected native bridge. The native implementation is owned by
the parent/main thread and is absent from this UI branch. This is not installed
end-to-end qualification. Missing native support remains UNKNOWN.

## Agreed native contract

`draftScope()` accepts zero renderer arguments and returns exactly these fields:

```ts
{
  schema: 'metaengine.client.draft-scope.v1',
  state: 'READY' | 'UNKNOWN',
  scope: null | {
    principal_kind: 'ENROLLED_NATIVE_DEVICE',
    principal_id: string, // 64 hex SHA-256; opaque native-device namespace
    workspace_id: string, // verified coordination workspace UUID
    project_id: null
  },
  observed_at: string, // canonical ISO timestamp at native dispatch start
  expires_at: string | null, // READY: dispatch + 5000 ms; UNKNOWN: null
  authority_effect: false,
  automatic_retry_allowed: false
}
```

UNKNOWN requires null scope; it retains the dispatch observation timestamp.
The parent agreed that Main uses an already loaded enrolled identity, a fixed
read-only signer for `READ_NATIVE_SETUP_ROUTE_V1`, the current verified repository
configuration and signed ADMIN/Host/PG observation. It does not enroll, ensure,
load or create keys. This description is the integration contract, not evidence
that those Main paths were executed by this UI branch. The earlier proposal to
project `READ_WORKSPACE_PREPARATION_V1` is superseded by this agreement.

`principal_id` is not a human login or an execution credential. Before creation
of a goal the namespace is workspace-scoped: no project ID is fabricated. The
consumer rejects non-null project IDs. Namespace confirmation does not grant
submission authority, replace admission checks, or protect localStorage from
arbitrary same-origin JavaScript. There is no journal/status/localStorage/URL/
directory/random-ID fallback for identity or workspace.

## Implemented behavior

- The strict validator rejects extra/missing fields, wrong types, malformed hash
  or UUID, noncanonical/future/pre-request timestamps, flags granting authority
  or retries, non-null projects and inconsistent TTL. Effective expiry is capped
  at renderer dispatch + 5000 ms as well as native expiry; receipt cannot renew it.
- A monotonic deadline from dispatch independently bounds the wall-clock lease.
  Frozen or rolled-back wall time cannot preserve READY, admit a late response,
  or accept an old ACK before overdue timers run. Expiry callbacks are bound to
  the specific observation, so an older queued callback cannot expire a renewal.
- The controller exposes UNKNOWN, READY and a CHANGED transition. A separate
  expiry timer hides old scope during a hung read. One physical native read is
  retained through timeout and Page unmount/remount; no cancellation is claimed.
  Late or replaced-bridge responses cannot populate a newer lifetime. Polling is
  every 2 seconds while mounted. Freshness is bounded observation, not immediate
  knowledge of revocation between observations or while JavaScript is suspended.
- Scope loss/change increments generation and remounts the shell. A to UNKNOWN
  to A and A to B to A therefore invalidate old submit callbacks even when the
  draft key and revision are unchanged. Pure freshness guards also fence overdue
  callbacks before expiry timers run. Admission reads and submit/ACK paths check
  that generation without changing the existing admission protocol.
- `useGoalDraft` checks the generation before storage subscription/read/write or
  clearing a submitted revision. Unknown text remains memory-only and is never
  migrated automatically into a confirmed namespace. Storage denial preserves
  visible in-memory text with a keyboard-accessible warning.
- Successful ACK clears only the submitted revision. Newer input survives;
  an unknown submit outcome never automatically sends the goal again. Existing
  roster freshness and Observatory physical-flight fixes remain in place.

## Verification and integration boundary

`draft-scope.test.mjs` covers exact parsing, conservative TTL, hung read expiry,
continuous confirmation, scope transitions, bridge errors/replacement and
unmount/remount without overlapping reads. `ui-reliability.ui.test.mjs` imports
and executes the real Page/hook/shell rather than relying only on a test scope
prop. It checks restart restoration after confirmation, navigation, unbound
isolation, invalid/expired evidence, distinct principals/workspaces with null
project, storage refusal, and older ACKs across scope transitions. The submit
observer suite checks scope loss while admission readiness is pending.

The cloud Chromium run uses the real Next Page, an injected synthetic bridge,
a real browser reload and localStorage, and controlled time. It verifies
Settings/return/reload, UNKNOWN/missing/malformed/expired evidence, principal and
workspace changes, hung/late reads, old ACKs, storage refusal, lost response with
one explicit send, keyboard Tab/Enter/Escape and a 390 px viewport (120 px input,
no input/button overlap or horizontal overflow). No user client/profile/PG or
real native signer was used. Screenshots remain local and are not published.
An initial run failed its immediate Escape-focus assertion; an unchanged stable
rerun passed. Both logs are retained, and this is not claimed as a product fix.

Commands from `apps/me2-ui`:

The corrected consumer checkpoint passed 238/238 UI tests, 40/40 Browser contract checks,
TypeScript (also after removing dev-generated files), lint and the browser cases
above. The final browser harness waits for dialog closure and restored focus
instead of assuming both happen synchronously after Escape. The monotonic fix
first reproduced four failures with independent clocks, then passed those cases
and the queued-old-expiry regression. Chromium also verified frozen/rolled-back
wall time and a late ACK before timer delivery through the real Page.

```sh
node --test src/lib/*.test.mjs scripts/*.test.mjs
npm run typecheck
npm run lint
node --test ../metaengine-browser/test/client-runtime-resource.test.mjs ../metaengine-browser/test/client-v1-typed-goal-bridge.test.mjs ../metaengine-browser/test/r93-primary-ui-resilience.test.mjs ../metaengine-browser/test/r97-single-main-ui-contract.test.mjs ../metaengine-browser/test/r100-ui-authority-surface-prune.test.mjs ../metaengine-browser/test/browser-closed-loop-audit-fixes.test.mjs
```

W29 now registers the full UI suite after its frozen dependency install, including
these production-caller and controller cases. Existing UI/native checks are
retained. Historical global source seals, package/installed-client gates and
Main/preload/Host code are unchanged by this consumer commit.

Safe integration: review the UI delta independently; combine it with the parent's
separately checked native contract; reconcile shell activation changes owned by
the parent; rerun the complete UI/contracts and native negative tests; then test
the actual integrated native dispatch to Page and real restart. Required native
negatives include absent/changed identity, revoked/changed grant/pairing,
configuration/workspace mismatch, Host lifetime changes, untrusted sender,
unexpected arguments and late replies. Until that succeeds, ordinary apps on
this UI-only branch correctly cannot persistently restore without a native
`draftScope` implementation.

## Historical checkpoints

The following describes prior commits and results, not the newer consumer bytes.

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

The UI changes are published in Draft PR
https://github.com/PatrickFrome/Compute/pull/1384 against
`work/chat-cli-critic-integration-20261029`. The reviewed UI head is
`05993760e0c8bc27deee546bab12af24eec30d31`; it remains a draft, unmerged PR.
Its five targeted UI CI lanes passed. No PR approval or merge was performed.
These UI results do not resolve the separate current-source/global qualification
limits described in the public source qualification report.
