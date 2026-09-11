# A2 Compute Browser — B4 EXTENSION / COMPUTE-BROWSER PARITY — Deep Research + Architecture Plan

Status: RESEARCH + CODE PLAN (read-only toward upstream; no promotion; `authority_effect=false` for perception, durable `authority_effect=true` only for the Action Receipt contract, never derived from page data).
Date: 2026-08-28 (project timezone)
Branch: `work/a2-compute-browser-b4-parity` (created from `origin/work/a2-compute-browser-b2-b3`; the union merges of `b2-contexts` and `r4-semantic-perception` did NOT complete — see "Branch state" at the end).

Upstream authority: `coordination/chat-control-plane/A2_COMPUTE_BROWSER_ARCHITECTURE_ADDENDUM_V1.md` (the addendum). This document is a research + implementation plan, not a spec change. No secrets are read or written.

## B4 definition (quoted from the addendum)

From `coordination/chat-control-plane/A2_COMPUTE_BROWSER_ARCHITECTURE_ADDENDUM_V1.md`, roadmap table:

> `B4_EXTENSION_COMPUTE_BROWSER_PARITY` | same Target/Perception/Action/Receipt contracts across both surfaces

The addendum's target architecture places an `ACTION ARBITER + LEASE` directly beneath the `DURABLE TASK / ACTION GRAPH` and above the `A2 BROWSER PROTOCOL`, with three surfaces hanging off that protocol:

1. **A2 Compute Browser** (primary long-term local browser-compute node).
2. **A2 Chrome Extension** (compatibility surface for a user's existing Chrome session).
3. **Remote Browser Node** (later, B6).

B0–B3 + R4 delivered Target (logical identity + lifecycle) and Perception (`R4_SEMANTIC_PERCEPTION_COMPILER_V1`, shared, non-actuating, `authority_effect=false`). **B4 adds the guarded Action (actuation) and Receipt (durable effect evidence) contracts and ports them to BOTH surfaces**, plugging into the supervised Action Arbiter + Lease.

Hard invariants the addendum requires of every actuating surface (verbatim names):

- `MANY_AGENTS_MAY_THINK_ONE_ACTUATOR_MAY_EFFECT`
- `ONE_RESOURCE_ONE_ACTUATION_LEASE`
- `NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT`
- `PRE_ACTUATION_DURABLE_BEFORE_EFFECT`
- `PAGE_DATA_HAS_ZERO_AUTHORITY`
- `TARGET_BINDING_IS_EXACT`
- `LIVE_REVALIDATION_BEFORE_ACTUATION`
- `REMOTE_CODE_IS_NEVER_EVALLED_IN_BROWSER_KERNEL`

## The four contracts

All four contracts are typed, durable-identity-first, and shared via `coordination/browser-shared/`. Target and Perception already exist; Action and Receipt are new in B4.

### 1. Target (existing, B1/B2/B3)

Logical browser target. Durable identity `target_id`, `profile_id`, `context_id`, `browser_node_id`, `conversation_epoch`; ephemeral binding `cdp_target_id` + `process_incarnation_id`.

Methods (already in `protocol-v1.json` / `rpc-server.mjs`): `target.create`, `target.list`, `target.activate`, `target.close`. Lifecycle is a **durable pre-effect intent** then a CDP effect (see `runtime.mjs` `createTarget`/`closeTarget`): state is persisted as `PREPARING`/`ACTIVATING`/`CLOSING` before the CDP call, then `ACTIVE`/`RETIRED` after.

Invariants: `TARGET_BINDING_IS_EXACT` (binding carries a single `process_incarnation_id`; stale incarnation => `target_binding_stale`, see `runtime.mjs` `#liveBinding`), `PRE_ACTUATION_DURABLE_BEFORE_EFFECT` (lifecycle intent is durable before the effect).

### 2. Perception (existing, R4 SemanticFrame)

`R4_SEMANTIC_PERCEPTION_COMPILER_V1`, defined in `coordination/browser-shared/semantic-perception-compiler.mjs`, produced by two adapters:
- Compute Browser: `coordination/browser-compute/src/semantic-capture-adapter.mjs` (native CDP pipe, no `Runtime.evaluate` for the core path).
- Extension: `coordination/chat-control-plane/extension/operator-perception.js` (chrome.debugger, identical AX/DOM/layout capture).

`SemanticFrame` carries `tainted_page_data=true`, `authority_effect=false`, a bounded `nodes[]` list, each node with `semantic_id` (a *locator* identity, not authority), `binding_evidence` (`backend_dom_node_id`, `ax_node_id`, `source_frame_id`), `binding_epoch`, and continuity `EXACT_BINDING` / `STRUCTURAL_REBIND` / `NEW_NODE` / `AMBIGUOUS`. Ambiguous rebinding never auto-binds an action (`research-r4` security model #6).

### 3. Action (NEW, guarded actuation) — B4

A typed, lease-bound, fail-closed actuation contract. Four methods:

- `action.navigate({ target_id, lease, url })` — guarded navigation to an `https:` URL only (reuse `validateNavigationUrl`), via the live `cdp_target_id` session (`Page.navigate`). Invalidates prior physical bindings for that target (new `document_epoch`).
- `action.click({ target_id, lease, semantic_id, frame_path })` — guarded click on the element currently bound to `semantic_id`. Resolves the live `backend_dom_node_id`, revalidates it is still the exact same element, then dispatches a bounded `Input.dispatchMouseEvent` (down+up) at the layout bounds from the binding evidence. No coordinate guessing from screenshots.
- `action.type({ target_id, lease, semantic_id, text })` — guarded text entry into the focused/resolved editable element. Uses `Input.insertText` (or `DOM.setFileInputFiles` for file inputs) against the live, revalidated binding. Never `Runtime.evaluate` to set value.
- `action.submit({ target_id, lease, semantic_id })` — guarded form submission: focus the resolved control, dispatch a guarded `Enter` (`Input.dispatchKeyEvent`) or a form `requestSubmit` via the exact element handle (no script eval).

Action params (common envelope):

```text
ActionIntent {
  action_id: uuid                      // durable, pre-effect
  target_id: string                    // durable logical identity (exact)
  profile_id: string
  context_id: string
  lease: LeaseEnvelope                 // from Action Arbiter + Lease
  kind: 'NAVIGATE'|'CLICK'|'TYPE'|'SUBMIT'
  locator: { semantic_id, frame_path } // for CLICK/TYPE/SUBMIT
  payload: { url?, text? }             // never free-form page text
  requested_at: iso8601
}
LeaseEnvelope {
  lease_id: uuid
  resource_id: string                  // MUST equal target_id
  actor_id: string                     // supervisor-issued
  not_after: iso8601
  hmac: hex                            // over (lease_id|resource_id|actor_id|not_after) with per-daemon session key
}
```

Invariants enforced by the Action Kernel (`action-kernel.mjs`):
- `ONE_RESOURCE_ONE_ACTUATION_LEASE` — at most one live actuation lease per `target_id`.
- `LIVE_REVALIDATION_BEFORE_ACTUATION` — re-attach and re-read AX/DOM; the `semantic_id` must resolve to the *same* `backend_dom_node_id` + `document_epoch` as when the supervisor planned the action; else fail closed.
- `PRE_ACTUATION_DURABLE_BEFORE_EFFECT` — the `ActionIntent` with `status=PENDING` is durably written before any CDP effect.
- `TARGET_BINDING_IS_EXACT` — effect uses the live `cdp_target_id` + `process_incarnation_id` of the exact `target_id`; an ephemeral id can never stand in for durable identity.
- `PAGE_DATA_HAS_ZERO_AUTHORITY` — `payload` carries only a lease + a locator; page text/ARIA/screenshots are never read to *authorize* an action.
- `REMOTE_CODE_IS_NEVER_EVALLED_IN_BROWSER_KERNEL` — click/type/submit use CDP Input/DOM domains only; no `Runtime.evaluate`.

### 4. Receipt (NEW, durable lease-bound effect evidence) — B4

A durable, append-only record that an actuation occurred, bound to the lease and the exact target/incarnation. Written by the compute kernel AND the extension adapter under the identical schema (`coordination/browser-shared/receipt-contract.mjs`), so the Supervisor/Action Arbiter treats both surfaces uniformly.

```text
ReceiptRecord {
  schema: 'metaengine.a2-browser-operator.receipt.v1'
  receipt_id: uuid
  action_id: uuid                     // links to the durable ActionIntent
  lease_id: uuid                      // proves lease-bound actuation
  resource_id: string                 // target_id
  profile_id, context_id
  process_incarnation_id: string
  kind: 'NAVIGATE'|'CLICK'|'TYPE'|'SUBMIT'
  status: 'EFFECTED'|'FAILED_NO_EFFECT'|'AMBIGUOUS'
  effect_evidence: {
    document_epoch_after,             // for NAVIGATE
    bound_backend_dom_node_id,        // for CLICK/TYPE/SUBMIT (re-validated)
    input_sha256,                     // for TYPE (committed text, not plaintext)
    dispatched: true
  }
  authority_effect: true              // this record IS the durable effect evidence
  created_at: iso8601
  receipt_sha256: hex                 // over the canonical record (audit/replay)
}
```

Receipt methods: `receipt.get({ receipt_id })`, `receipt.verify({ receipt_id })` (recompute `receipt_sha256`, confirm `lease_id` matches the authoritative lease store, confirm incarnation still valid or explicitly retired). A Receipt with `status=AMBIGUOUS` blocks blind retry of the same resource (`NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT`).

## Fail-closed invariants for Action / Receipt (enforcement in code)

| Invariant | How it is enforced in B4 code |
|---|---|
| `ONE_RESOURCE_ONE_ACTUATION_LEASE` | `action-kernel.mjs` keeps a `liveLeases: Map<target_id, lease_id>` updated at intent-accept time. A new `action.*` whose `lease.resource_id` already has a live actuation lease is rejected (`actuation_lease_conflict`) until the prior Receipt is written and the lease released. |
| `NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT` | `receipt.mjs` index keyed by `target_id`; if the latest Receipt for the resource is `AMBIGUOUS` (or a PENDING `ActionIntent` exists with no Receipt), new actuation is refused (`ambiguous_effect_recovery_required`). Only an explicit supervisor reconciliation (a new lease with `reconcile=true`) clears it. Mirrors `context-manager.mjs` `context_close_reconciliation_required`. |
| `PRE_ACTUATION_DURABLE_BEFORE_EFFECT` | Same pattern as `runtime.mjs` `createTarget`: `atomicJsonWrite` of the `ActionIntent{status:PENDING}` to `actions.json` *before* the CDP call. On CDP failure, the record is durably moved to `FAILED_NO_EFFECT` (never left PENDING, never claimed-effect). The CDP effect is invoked only after the intent is durable. |
| `LIVE_REVALIDATION_BEFORE_ACTUATION` | Before `click`/`type`/`submit`, the kernel re-attaches (`Target.attachToTarget`), re-runs a minimal `Accessibility.getFullAXTree` + `DOMSnapshot` slice, and re-matches `semantic_id` via `semantic-perception-compiler` `assignIdentity`. Mismatch or `AMBIGUOUS` => `live_revalidation_failed`, no CDP Input dispatched. `navigate` re-reads `Page.getFrameTree` after dispatch to capture `document_epoch_after`. |
| `TARGET_BINDING_IS_EXACT` | Reuse `runtime.mjs` `#liveBinding(entry, targetId)`: binding must exist and `binding.process_incarnation_id === entry.processRef.processIncarnationId`; otherwise `target_binding_stale`. All effects go to `binding.cdp_target_id` of the exact durable `target_id`. `cdp_target_id`/PID/URL never substitute for `target_id` (addendum identity model). |
| `PAGE_DATA_HAS_ZERO_AUTHORITY` | `action-contract.mjs` `validateActionIntent` rejects any `payload` containing raw page text/ARIA/HTML as an authority source. Only `lease` + `locator.semantic_id` (a compiled, supervisor-approved locator) are accepted. SemanticFrame remains `tainted_page_data=true`/`authority_effect=false`; the kernel never trusts page content to drive an effect. |

## Architecture / code plan

New and extended modules (all paths under `coordination/`):

- `browser-shared/action-contract.mjs` (NEW) — pure, browser-free contract module (mirrors `semantic-perception-compiler.mjs`). Exports:
  - `ACTION_KINDS` (frozen), `validateActionIntent(intent)` (throws on bad lease/resource/locator), `validateLeaseEnvelope(lease, sessionKey)` (HMAC check, `not_after` expiry, `resource_id` equals `target_id`), `canonicalActionBytes(intent)`.
  - `compileActionEnvelope({ target_id, lease, kind, locator, payload })` -> normalized `ActionIntent`.
- `browser-shared/receipt-contract.mjs` (NEW) — pure contract module. Exports:
  - `RECEIPT_STATUS` (frozen), `validateReceipt(record)`, `canonicalReceiptBytes(record)`, `receiptSha256(record)`, `isEffectEvidence(record)` (`status==='EFFECTED'`).
- `browser-compute/src/action-kernel.mjs` (NEW) — `class ActionKernel { constructor({ runtime, cdp, receipts, leases, sessionKey }) }` with:
  - `async navigate({ target_id, lease, url }) -> ReceiptRecord`
  - `async click({ target_id, lease, semantic_id, frame_path }) -> ReceiptRecord`
  - `async type({ target_id, lease, semantic_id, text }) -> ReceiptRecord`
  - `async submit({ target_id, lease, semantic_id }) -> ReceiptRecord`
  - internal `#acceptLease`, `#writePendingIntent`, `#liveRevalidate`, `#performEffect`, `#writeReceipt`.
- `browser-compute/src/receipt.mjs` (NEW) — `class ReceiptStore { constructor({ profileDir }) }` with `append(receipt)`, `get(receipt_id)`, `latestForResource(target_id)`, `verify(receipt_id)`. Persists `receipts.json` via `atomicJsonWrite` (from `security.mjs`).
- `browser-compute/protocol-v1.json` (EXTEND) — add to `methods`: `action.navigate`, `action.click`, `action.type`, `action.submit`, `receipt.get`, `receipt.verify`. Add `method_effects` entries: `action.* => ACTUATION`, `receipt.* => READ_ONLY`. Keep `web_authority_effect` policy; receipts carry `authority_effect=true` only as the durable effect record. Add `forbidden_external_capabilities` entries: `raw_cdp`, `runtime_evaluate`, `arbitrary_navigation`, `page_text_authority` (already effectively covered; make explicit).
- `browser-compute/src/rpc-server.mjs` (EXTEND) — add the six methods to `RPC_METHODS`; add `ACTUATION` to `RPC_METHOD_EFFECTS`; add `dispatch` cases that route to `ActionKernel` (after lease validation) and `ReceiptStore`; add `validateActuationParams` + lease verification; responses set `effect_class:'ACTUATION'`, include `receipt_id`, and `authority_effect` per receipt.
- `browser-compute/src/security.mjs` (EXTEND) — add `validateContextId` (already referenced by `context-manager.mjs` on the merged refs; add it to base), `validateLeaseHmac(lease, key)`, `validateActionKind`.
- `chat-control-plane/extension/operator-action.js` (NEW, parity) — mirrors `ActionKernel` using `chrome.debugger.send` of `Input.dispatchMouseEvent` / `Input.insertText` / `Input.dispatchKeyEvent` / `Page.navigate`, and writes the **identical** `ReceiptRecord` schema to `chrome.storage.session` (`a2OperatorReceipt:*`). It must reject the same conditions (lease conflict, ambiguous, stale binding, expired lease) so the Supervisor/Action Arbiter path is surface-agnostic.
- `chat-control-plane/extension/operator-perception.js` (EXTEND, minor) — expose the captured `semantic_id`/binding evidence to the action path and mark frames `authority_effect=false` (already does).

The Action Arbiter + Lease lives ABOVE the surfaces (Supervisor side, out of scope for this repo's compute-browser module) and is modeled here only as the `LeaseEnvelope` the kernel validates. The kernel never mints leases; it only consumes and binds them.

## Analog comparison (EXTEND existing research) — Playwright / Puppeteer / raw CDP

Existing research (`research/A2_COMPUTE_BROWSER_B1_B3_DEEP_RESEARCH_2026-08-28.md`, `research/a2-compute-browser-b2-b3/report-source.md`) already compares Puppeteer/Playwright pipe + context isolation favorably and notes A2 keeps raw CDP internal. B4 extends that comparison to *actuation*:

- **Playwright**: `locator.click()`, `locator.type()/fill()`, `page.goto(url)`. Locators are snapshot-stable but *regenerated after page changes* (Playwright docs); `fill` sets value through the browser's input pipeline. There is **no durable receipt**, **no lease/arbiter**, and effects are **synchronous, in-session, and non-auditable** — a crash mid-`fill` leaves no machine-readable proof of whether the keystroke landed, and no external authority gate before the call.
- **Puppeteer**: `elementHandle.click()`, `elementHandle.type()`, `page.goto()`. Same shape: direct, unguarded actuation; no receipt; no lease; no revalidation gate beyond the handle's liveness at call time.
- **Raw Chrome CDP**: `Input.dispatchMouseEvent`, `Input.insertText`, `Input.dispatchKeyEvent`, `Page.navigate`. Lowest level, entirely **unguarded** — no binding revalidation, no lease, no durable evidence, and trivially abusable if exposed (which is why A2 keeps raw CDP internal-only, `raw_cdp_external:false` in `protocol-v1.json`).

A2's distinguishing design: actuation is **fail-closed, lease-bound, and revalidation-before-effect**, and every actuation produces a **durable, lease-bound Receipt** (`authority_effect=true`) that the Action Arbiter can audit, replay-verify, and use to block blind retries. This is the property Playwright/Puppeteer/CDP lack: durable causal evidence + a pre-effect authority gate. B4 ports exactly this to the extension surface so both are indistinguishable to the Supervisor.

## Improvements found during research, and how B4 addresses them

1. **No actuation authority existed below the extension.** B0–B3+R4 were non-actuating (`authority_effect=false`). B4 introduces the first guarded, auditable actuation path for the Compute Browser and mirrors it to the extension.
2. **Action identity was browser-internal only.** Adding `semantic_id` as a compiled locator (R4) gives B4 a stable, revalidated handle for `click`/`type`/`submit` instead of raw coordinates or JS handles.
3. **Lifecycle intent was durable but effect was not evidenced.** `runtime.mjs` already persists pre-effect `PREPARING`/`CLOSING`; B4 generalizes that to `ActionIntent{PENDING}` + `ReceiptRecord`, giving actuation the same causal-incarnation discipline.
4. **One actuator / many agents was unenforced at actuation.** `ONE_RESOURCE_ONE_ACTUATION_LEASE` + the `liveLeases` map makes `MANY_AGENTS_MAY_THINK_ONE_ACTUATOR_MAY_EFFECT` concrete for actions.
5. **Crash/ambiguity could invite blind replay.** `NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT` + `AMBIGUOUS` receipts make retry require explicit supervisor reconciliation, matching the recovery-required pattern already used for target/context lifecycle.

## Implementation sequence (ordered)

1. `browser-shared/action-contract.mjs` + `browser-shared/receipt-contract.mjs` (pure, deterministic, no browser) with unit tests on synthetic fixtures.
2. `browser-compute/src/security.mjs`: add `validateContextId`, `validateLeaseHmac`, `validateActionKind`.
3. `browser-compute/src/receipt.mjs` (persistent store; reuse `atomicJsonWrite`).
4. `browser-compute/src/action-kernel.mjs`: implement `navigate` first (lowest revalidation need), then `click`/`type`/`submit` with `#liveRevalidate` reusing `semantic-perception-compiler` matching.
5. Wire `rpc-server.mjs` `RPC_METHODS`/`dispatch`/`RPC_METHOD_EFFECTS` + `protocol-v1.json` (`action.*`, `receipt.*`).
6. `chat-control-plane/extension/operator-action.js` parity adapter writing the identical `ReceiptRecord` to `chrome.storage.session`.
7. End-to-end offline tests (kernel + store) without a live browser using a fake CDP pipe.

## Tests to write (offline, fail-closed, adversarial)

- **Offline contract tests**: `validateActionIntent` rejects missing/expired/foreign-resource lease; `validateLeaseHmac` rejects tampered HMAC; `receiptSha256` round-trips.
- **Fail-closed**: 
  - ambiguous effect -> next actuation on same `target_id` is refused (`ambiguous_effect_recovery_required`);
  - stale binding (incarnation mismatch) -> `target_binding_stale`, no CDP Input dispatched;
  - replayed/forged receipt -> `receipt.verify` fails (HMAC/receipt_sha256 mismatch or unknown lease);
  - page-data-as-authority attempt -> `validateActionIntent` rejects payload carrying raw page text/ARIA/HTML;
  - expired `not_after` lease -> rejected before any effect;
  - second concurrent lease on same resource -> `actuation_lease_conflict`.
- **Pre-effect durability**: assert `ActionIntent{PENDING}` is durable before the (faked) CDP call; on simulated CDP failure, assert `FAILED_NO_EFFECT` and no `EFFECTED` receipt.
- **Live revalidation**: simulate navigation between plan and act -> `live_revalidation_failed` (binding no longer exact).
- **Parity**: identical `ReceiptRecord` schema validated by the same `receipt-contract.mjs` from both the Compute Browser kernel and the extension adapter.
- **Adversarial**: ARIA/prompt-injection text in page content must never alter `semantic_id` selection or authorize an action (`tainted_page_data=true`, `authority_effect=false`).

## Explicit non-claims

- This document is **research + a code plan**, not an upstream change; it does not modify the authoritative addendum or any shipped module.
- `authority_effect=false` for all Perception output; durable `authority_effect=true` applies **only** to the Action Receipt contract, and that authority is derived from the Supervisor-issued lease + exact binding, **never from page data**.
- No secrets are read or written; the lease HMAC uses a per-daemon session key already present in `security.mjs` (`rotateControlToken`), not any external credential.
- This is not a product/promotional claim; it describes internal safety architecture only.
- The three-way merge that would form the full B4 base did not complete (conflicts in `cli.mjs`, `rpc-server.mjs`, `runtime.mjs`, `contracts.test.mjs`); this research was grounded by reading those files via `git show <ref>:<path>` on the three source refs. The branch therefore sits at the `b2-b3` base plus this research doc only.
