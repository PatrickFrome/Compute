# A2 Browser R8C — Typed Extension CLICK Outcome — Pre-Implementation Research

Date: 2026-08-29
Parent verified milestone: R8B `bd4b3c029fc4531d355ca181a0897d50e68268b3`

## Problem

R8B provides a durable pre-effect intent fence and typed terminal outcomes, but it intentionally has no physical MV3/CDP actuator. The existing extension `CLICK_SEMANTIC` performs fresh semantic revalidation and a trusted mouse press/release, yet its errors are not expressed in the R8B `NO_EFFECT | COMMITTED | AMBIGUOUS` contract and its legacy release-error path attempts an additional cleanup release.

The first physical integration must not turn transport uncertainty into an automatic retry or false `NO_EFFECT` claim.

## Primary-source comparison

### Playwright

Playwright resolves locators against the current DOM for every action and performs actionability checks immediately before acting. Its trial/actionability-only facilities reinforce a clean separation between pre-dispatch validation and physical effect.

### Chrome DevTools Protocol Input

A click is represented by separate `Input.dispatchMouseEvent` events such as `mousePressed` and `mouseReleased`. There is no transaction that atomically proves both page observation and transport acknowledgement. Once the first physical dispatch is attempted, loss of acknowledgement cannot in general prove that no effect occurred.

### Transactional outbox / durable intent

Durable intent and ordered delivery prevent lost work, but exactly-once external effects still require an idempotent downstream consumer. An arbitrary webpage does not implement an A2 action-id idempotency contract.

### Existing A2 semantic actuator

The current extension already has the strongest reusable pre-dispatch checks: exact pinned tab, perception age/binding, unique cached AX match, fresh live AX match, backend-node replacement rejection, dangerous-node blocking, scroll/box calculation and exact hit-target revalidation. Reusing these invariants is safer than creating a second weaker browser-selection path.

## Options

### A. Replace legacy `CLICK_SEMANTIC` immediately

Security: potentially strong, but broad regression radius across existing sidepanel flows.
Reliability/testability: weaker because old callers would be migrated before the new outcome contract is independently proven.
Decision: reject for R8C.

### B. Wrap legacy click externally

Security: insufficient. The wrapper cannot know whether `mousePressed` started before a legacy exception and cannot prevent the legacy cleanup release.
Decision: reject.

### C. Add an isolated typed-click classic-worker module

Security: strongest incremental option. It can share the existing revalidation model while owning the exact dispatch state machine.
Reliability: legacy FOCUS/TYPE/CLICK remain unchanged until the new path is verified.
TCB/complexity: one bounded classic-worker module, one message type, no new dependency.
Packaging: explicit inclusion in `runtime-package-manifest.json` and `background-entry.js`; deterministic extension builder proves staged closure.
Decision: choose.

## Decision

Add `operator-typed-click-outcome.js` with trusted-sidepanel message `A2_OPERATOR_TYPED_CLICK_V1` and global test surface `A2_OPERATOR_TYPED_CLICK_V1`.

A request requires a bounded `action_id` used only for correlation. It grants no authority and is not treated as a webpage idempotency key.

The response surface contains only:

- `action_id`;
- `outcome`: `NO_EFFECT | COMMITTED | AMBIGUOUS`;
- stable `reason_code`;
- `physical_dispatch_started`;
- `automatic_retry_allowed=false`;
- `authority_effect=false`;
- `actuation_eligible=false`.

No tab/session/process/backend-node identifiers are returned.

## State machine

1. Snapshot all external request fields exactly once.
2. Validate action id, compatibility gates, platform, exact cached semantic candidate, pinned tab and fresh live AX/DOM/hit target.
3. Any failure before physical dispatch returns `NO_EFFECT` and sends zero `Input.dispatchMouseEvent` calls.
4. Immediately before the first `mousePressed` send, set `physical_dispatch_started=true`.
5. A rejection/throw from the press send returns `AMBIGUOUS`.
6. Press acknowledgement followed by release rejection returns `AMBIGUOUS`.
7. No cleanup/retry/third dispatch is allowed after ambiguity.
8. Press and release acknowledgements return `COMMITTED`.

## New invariants

- `NO_EFFECT_ONLY_BEFORE_FIRST_PHYSICAL_DISPATCH`.
- `POST_DISPATCH_FAILURE_IS_AMBIGUOUS`.
- `NO_CLEANUP_OR_RETRY_DISPATCH_AFTER_AMBIGUITY`.
- `ACTION_ID_IS_CORRELATION_NOT_PAGE_IDEMPOTENCY`.
- `FRESH_EXTENSION_REVALIDATION_BEFORE_CLICK`.
- `TYPED_CLICK_RESPONSE_EXPOSES_NO_ENGINE_IDENTITY`.
- `LEGACY_SEMANTIC_ACTION_PATH_UNCHANGED_IN_R8C`.
- `R8C_CLICK_ONLY`.

## Verification requirements

- VM/adversarial tests for pre-dispatch rejection, press rejection, release rejection, success, stateful getters, sender trust, duplicate/replaced/hit-changed targets and response privacy.
- Exact dispatch-count assertions: 0 / 1 / 2 / 2 respectively.
- Existing semantic-action and R8A/R8B regressions remain green.
- Deterministic MV3 build must include the new classic-worker file and import; packed CRX must succeed.
- Before VERIFIED, a controlled real-Chrome proof must demonstrate one typed click produces exactly one monotonic page effect and that the staged extension is the code under test.

## Explicit non-claims

R8C does not provide page-level exactly-once semantics, automatic retry, typing/select/navigation/download/WebMCP actuation, or distributed actuation authority.
