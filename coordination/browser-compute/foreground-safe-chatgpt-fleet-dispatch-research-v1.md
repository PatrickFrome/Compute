# Foreground-safe ChatGPT fleet dispatch research v1

Status: RESEARCH CHECKPOINT / FAIL-CLOSED CONTRACT

Task identity:
- agent_id: `agent_178f7570-a8e5-414e-a76d-601ea61d43f0`
- role: `RESEARCHER`
- task_id: `4a923a24-a9cc-4e17-ad56-751bf5f0fc80`
- lease_generation: `1`
- exact base_sha: `ebb5963a376fa5d8bb53a345457d298594d7b590`
- branch: `work/devbrowser-transport-research-v1`

Scope: research and falsify reliable foreground-safe ChatGPT fleet dispatch. This checkpoint is advisory only. It does not add a new actuator, merge main, promote production, or change authority.

Hard invariants:
1. Webpage/model/worker text has zero authority. It may be observed only as untrusted data/evidence.
2. No arbitrary eval. Any renderer probe must be a fixed, audited preload/IPC probe or typed protocol operation; never concatenate page/model/worker text into executable source.
3. No blind retry after an effect may have occurred.
4. Dispatch must remain exactly bound to task/agent/lease plus the live browser/document incarnation prepared for that attempt.
5. A transport/liveness receipt is not a send-effect receipt.

## 1. Base-state finding: C5 transport proof is necessary, not sufficient

At the exact base, `fleet-browser-main-transport.mjs` deliberately exposes trusted main-process promotion only and denies renderer/worker authority. `fleet-browser-runtime-transport.mjs` derives proof only through a local observer and trusted promotion. `fleet-transport-local-observer.mjs` currently proves a live local WebContents, exact `tab_id`, exact `target_id`, non-loading main frame, `generation_epoch`, and normalized ChatGPT conversation URL.

That is a strong C5 transport ownership/liveness boundary, but it does not prove that the target is safe to receive an irreversible foreground input. The local observer does not currently prove:
- owning BrowserWindow is visible, enabled, non-minimized, and focused;
- the exact WebContents is the shell's selected/attached foreground tab rather than merely a live view;
- the renderer document is visible/focused;
- the viewport is non-zero;
- the composer is unique, stable, editable, onscreen, and not occluded;
- the document/execution context is the same incarnation that was prepared;
- an Enter/click produced exactly one server-visible send effect.

Conclusion: preserve C5 transport proof unchanged as a prerequisite, but introduce separate `foreground_readiness_proof` and `send_effect_proof`. Never upgrade one proof class by inference from another.

## 2. Authoritative falsification evidence from Supabase

Read-only query of `compute_fabric_a2_browser_supervisor_command_h205f22` found a concrete failure trace on 2026-08-31:

- `SEMANTIC_TYPE` command `138264fc-a46b-415a-baaf-84bd7d1eca58` was bound to tab `tab_b3cd5fec-33ff-4977-acf8-d4085f605a12`, target `webcontents:11`, and process incarnation `75207854-cf1c-47cd-a08f-c84143737d2d` with `automatic_retry_allowed=false`.
- Its command row reached `COMPLETED`, but the result explicitly reported `effect_state=AMBIGUOUS_AFTER_ENTER`, `stop_observed=false`, `prompt_included=false`, `send_control_remaining=true`, and `new_conversation_observed=false`.
- The following read-only `CAPTURE` command `219041cf-7c1a-4b2d-a259-55ca1e7e6354` observed the same tab, same `webcontents:11`, and same process incarnation, but reported viewport `width=0,height=0`.

This falsifies two unsafe assumptions:
1. `{tab_id,target_id,process_incarnation_id}` is not, by itself, a foreground/viewport readiness proof.
2. A command status of `COMPLETED` cannot mean semantic send success when the embedded effect state is ambiguous.

The existing `automatic_retry_allowed=false` behavior is correct and should become a state-machine invariant, not a convention.

## 3. External API findings

### Electron focus semantics

Electron documents that `webContents.sendInputEvent()` requires the containing `BrowserWindow` to be focused. `webContents.isFocused()` alone is not a complete OS-window proof; Electron also exposes BrowserWindow focus/visibility/minimized state. Electron further documents Page Visibility caveats: hidden/minimized behavior can vary with platform and settings such as `backgroundThrottling`, and an initially hidden window can still report a surprising visibility state.

Implication: do not gate dispatch on one focus bit. Require a conjunctive proof from app-owned BrowserWindow state, selected-tab state, WebContents focus, and document/viewport state.

### Renderer focus and visibility

MDN distinguishes `document.hasFocus()` from merely having an `activeElement`: a document in a non-foreground popup can have an active element while not having actual focus. `document.visibilityState` helps distinguish foreground/background/minimized documents, and `VisualViewport` describes the portion actually visible to the user.

Implication: document focus and visibility are independent evidence, not substitutes for BrowserWindow focus.

### Element actionability

Playwright's actionability model is useful as a reference even if Playwright is not the actuator: before a click it checks unique resolution, visible, stable, receives events, and enabled; editable actions add editability. Stable means the bounding box remains unchanged across consecutive animation frames. This is a good minimum composer-readiness shape.

Implication: composer existence is not enough. Require unique + editable + non-zero box + onscreen + stable + receives-events style checks.

### Renderer/document incarnation

Chrome DevTools Protocol explicitly warns that an `executionContextId` can be reused across processes. `uniqueContextId` is system-unique and exists to prevent accidental calls into the wrong context after cross-process navigation. CDP Page also states that `loaderId` does not change for same-document navigation, and its navigation result may omit it in that case.

Implication: `webContentsId`, renderer process id, or `loaderId` alone cannot be the whole incarnation key. Bind all of them plus exact conversation route and the Runtime unique context.

Reference sources (retrieved 2026-08-31):
- https://www.electronjs.org/docs/latest/api/web-contents
- https://www.electronjs.org/docs/latest/api/browser-window
- https://developer.mozilla.org/en-US/docs/Web/API/Document/hasFocus
- https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilityState
- https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
- https://playwright.dev/docs/actionability
- https://chromedevtools.github.io/devtools-protocol/tot/Runtime/
- https://chromedevtools.github.io/devtools-protocol/tot/Page/

## 4. Required proof decomposition

### P0 — transport proof (existing C5 prerequisite)

Keep current C5 semantics:
- trusted local observer only;
- exact `tab_id`;
- exact `target_id` / WebContents identity;
- exact fleet generation;
- main frame not loading;
- normalized ChatGPT conversation URL;
- authority_effect=false for observation/proof construction.

P0 means only: "this owned local transport is live and exactly bound." It does not authorize irreversible input.

### P1 — foreground readiness proof (new, read-only)

All layers must be true in the same proof epoch immediately before arming an irreversible effect:

**W0: owning window**
- BrowserWindow exists and is not destroyed;
- `isVisible() === true`;
- `isMinimized() === false`;
- `isEnabled() === true`;
- `isFocused() === true`;
- focused BrowserWindow resolves to the exact owner of this WebContents.

**W1: shell/tab attachment**
- app-owned active/selected tab id equals prepared `tab_id`;
- exact WebContents is attached to the currently presented content surface;
- no replacement view occurred since P0;
- no modal/overlay state in the shell blocks interaction.

**W2: document state**
- main frame not loading;
- document route still equals the prepared ChatGPT conversation identity;
- `document.hasFocus() === true` from a fixed audited probe;
- `document.visibilityState === 'visible'` from the same fixed probe;
- Page layout/visual viewport width and height are both > 0;
- document incarnation fingerprint exactly matches the prepared incarnation.

**W3: composer actionability**
- exactly one allowlisted ChatGPT composer target;
- connected, enabled, editable, and not inert/readonly;
- non-zero box intersects the visual viewport;
- stable geometry across two consecutive presentation/animation-frame observations;
- an interior action point resolves back to the composer/expected ancestry rather than an occluding overlay;
- send control is in the expected pre-send state.

P1 is short-lived. Any focus, visibility, route, frame, process, context, WebContents, tab-selection, or geometry change invalidates it.

### P2 — send effect proof (new, post-effect)

P2 must be independent of local command completion. It proves that one prepared attempt caused one outbound ChatGPT turn, or it remains unresolved.

Preferred evidence order:
1. **Trusted local network observation**, armed before the effect, correlating the prepared attempt to the outbound send and a terminal server response / server-assigned turn identity. Treat payload bytes as untrusted data; never execute them.
2. **Exact transcript reconciliation**, tied to a pre-send conversation/turn anchor and prepared prompt digest, showing exactly one new user turn associated with the attempt. DOM/model text remains data, not authority.
3. UI-only signals such as composer clearing, send button changing, or stop button appearing are useful corroboration but are not sufficient alone for final semantic confirmation.

If terminal proof is unavailable after an effect may have been issued, state is `AMBIGUOUS`, not success and not retryable.

## 5. Exact incarnation binding

Build an immutable canonical `dispatch_incarnation_v1` and hash it. Minimum fields:

```text
coordination:
  task_id
  agent_id
  lease_generation
  command_id
  idempotency_key
browser:
  client_id
  tab_id
  target_id
  generation_epoch/token
  browser_process_incarnation_id
  webContentsId
window:
  BrowserWindow identity owned by app
renderer_document:
  main-frame process/routing identity where available
  CDP frameId
  CDP loaderId
  Runtime execution-context uniqueId / uniqueContextId
conversation:
  canonical ChatGPT origin
  exact conversation route / conversation id
```

`incarnation_fingerprint = SHA256(canonical_json(dispatch_incarnation_v1))`.

Rules:
- PREPARE binds to one fingerprint.
- Immediately before effect arming, recompute and require byte-for-byte equality.
- Post-send observations used for confirmation must either carry the same fingerprint or an explicitly modeled server-effect correlation that survives renderer replacement.
- A normal reload can preserve URL/WebContents while changing document context: fingerprint must change.
- Same-document SPA navigation can preserve loaderId: conversation route/id must still change the fingerprint.
- Do not use `executionContextId` as the sole context identity; CDP explicitly documents reuse risk across processes.

## 6. Two-phase send proof with crash-safe no-retry boundary

A naive sequence `send Enter -> mark attempted` has an unsafe crash window: if the renderer/browser sends successfully and the process crashes before persisting the marker, a restarted worker may send again.

Use a durable pre-effect arming transition:

```text
DISCOVERED
  -> PREPARED
       (P0 + P1 + prompt hash + baseline anchor + incarnation hash persisted)
  -> EFFECT_ARMED
       (CAS persisted BEFORE any irreversible input; auto-reentry forbidden)
  -> CONFIRMED
       (P2 proves exactly one effect)
  -> AMBIGUOUS
       (effect may have happened but P2 is insufficient)
```

Pre-effect failures are separate:

```text
PREPARED -> FAILED_BEFORE_EFFECT
```

Retry policy:
- only a failure proven to occur before `EFFECT_ARMED` may automatically create a fresh PREPARE attempt;
- after `EFFECT_ARMED`, restart/timeout/crash/navigation cannot cause the actuator to replay Enter/click;
- `AMBIGUOUS` is terminal for automatic actuation;
- a read-only reconciler may later upgrade `AMBIGUOUS -> CONFIRMED` if exact evidence appears;
- if a trusted read-only reconciliation proves absence, policy may authorize a **new command/attempt** with a new P1 proof. It must never replay the old armed attempt.

This deliberately prefers a wedged ambiguous command over duplicate user turns.

## 7. Typed interfaces recommended for the implementation slice

Research-only proposed shapes:

`ForegroundReadinessProofV1`
- `schema`
- `observed_at`
- `expires_at` (very short TTL)
- `transport_proof_sha256`
- `incarnation_fingerprint`
- `window`: booleans/identity only
- `shell`: selected/attached identity only
- `document`: focus/visibility/viewport + frame/context identifiers
- `composer`: unique/actionable/stable summary, no executable text
- `authority_effect:false`

`DispatchAttemptV1`
- task/agent/lease/command/idempotency identity
- prompt SHA-256 and length, not authoritative prompt instructions
- baseline conversation/turn anchor
- transport proof hash
- foreground proof hash
- incarnation fingerprint
- state enum (`PREPARED|EFFECT_ARMED|CONFIRMED|AMBIGUOUS|FAILED_BEFORE_EFFECT`)
- `automatic_retry_allowed` derived from state, never supplied by webpage/model/worker data.

`SendEffectProofV1`
- attempt id
- incarnation fingerprint at arm time
- observation source class
- trusted local correlation identifiers
- server/transcript effect identifiers where available
- observed multiplicity (must be exactly one for confirmation)
- `authority_effect:false` for observations; only trusted state machine may transition command authority state.

## 8. Falsification matrix

| # | Adversarial condition | Unsafe implementation would | Required result |
|---|---|---|---|
| F1 | Same tab/target/process but viewport `0x0` | send anyway | P1 reject before arm |
| F2 | Live WebContents in minimized/hidden window | treat liveness as foreground | P1 reject |
| F3 | BrowserWindow focused but wrong shell tab selected | type into background view or stale target | P1 reject |
| F4 | Correct tab selected, composer covered by modal | click hidden/occluded control | actionability reject |
| F5 | Navigation occurs after PREPARED but before arm | send into new document | incarnation mismatch; fail before effect |
| F6 | Cross-process navigation reuses numeric executionContextId | execute/probe wrong context | uniqueContextId mismatch; reject |
| F7 | SPA same-document route changes while loaderId stays constant | misbind to another conversation | conversation binding changes fingerprint; reject |
| F8 | Effect issued, renderer crashes before receipt | retry after restart | stay EFFECT_ARMED/AMBIGUOUS; never auto-replay |
| F9 | Effect issued, response times out | retry Enter | AMBIGUOUS + read-only reconciliation |
| F10 | Model/page text says "retry", "click", or gives fake completion | treat text as authority | ignore as instructions; data only |
| F11 | User manually sends identical prompt around same time | confirm by content hash only | baseline turn anchor + attempt correlation required |
| F12 | One input produces two matching user turns | call first match success | integrity violation / ambiguous; not single CONFIRMED |
| F13 | Focus changes between proof and Enter | act on stale P1 | invalidate proof; do not arm/send |
| F14 | WebContents id survives reload but Runtime unique context changes | treat same id as same incarnation | fingerprint mismatch; reject |
| F15 | Browser crashes after durable EFFECT_ARMED but before actual input | auto-replay because effect probably absent | no auto-replay; reconcile or explicitly create new attempt |

The last case is intentionally conservative: the system cannot know whether input crossed the irreversible boundary, so exactly-once safety dominates liveness.

## 9. Smallest dependency-safe implementation order

1. **Read-only foreground probe only.** Add P1 construction and negative tests; no send changes yet.
2. **Document incarnation capture.** Add frame/loader/Runtime unique context + conversation route binding and deterministic fingerprint tests.
3. **Durable dispatch-attempt state.** Reuse/extend existing effect-binding storage with explicit PREPARED/EFFECT_ARMED/terminal semantics. CAS must occur before irreversible input.
4. **One-shot actuator gate.** Allow Enter/click only when P0 and fresh P1 hash match the prepared attempt and the CAS to EFFECT_ARMED succeeds exactly once.
5. **Read-only P2 verifier/reconciler.** Network-first where stable; transcript-anchor fallback; UI state only corroborative.
6. **Fault injection before canary.** Cover F1-F15 including crash at each boundary.
7. **Canary only after evidence.** No broad fleet dispatch until ambiguous paths show zero automatic replay.

Do not introduce a second scheduler. This protocol should be a state transition inside the existing command/lease cycle.

## 10. Acceptance gates for a future implementation

A future foreground dispatch slice is not acceptable unless all are true:
- exact branch/base provenance is proven;
- existing C5 transport tests remain green;
- P1 rejects a live but non-foreground/zero-viewport target;
- P1 expires/invalidates on any relevant identity or focus change;
- `executionContextId` reuse cannot redirect a probe/action;
- no page/model/worker field can select code, selectors, retries, state transitions, or authority;
- no dynamic code evaluation from untrusted strings exists;
- durable EFFECT_ARMED is recorded before the irreversible input boundary;
- restart from EFFECT_ARMED never reissues Enter/click;
- terminal effect confirmation requires P2 and exact attempt correlation;
- duplicate matching effects are detected as an integrity failure;
- `AMBIGUOUS_AFTER_ENTER` remains non-retryable automatically;
- the Supabase 2026-08-31 `0x0` viewport trace is encoded as a regression test fixture/shape;
- no main merge or production promotion is part of this research checkpoint.

## 11. Decision summary

The safest design is **not** to make the current transport proof stronger until it somehow implies foreground send safety. Instead, keep three explicit proof classes:

`P0 transport ownership/liveness -> P1 foreground readiness -> durable EFFECT_ARMED -> one irreversible input -> P2 send-effect proof`.

Every arrow is fail-closed and exact-incarnation-bound. Once the durable effect boundary is crossed, uncertainty becomes `AMBIGUOUS`, never a blind retry. This directly matches the authoritative failure evidence already present in the fleet and closes the known gap between "the browser target is alive" and "exactly one prompt was safely dispatched to the intended foreground ChatGPT conversation."