# A2 Browser R8C — Typed Extension CLICK Outcome — Post-Implementation Research

Date: 2026-08-29
Parent verified milestone: R8B `bd4b3c029fc4531d355ca181a0897d50e68268b3`
Candidate head before live-proof addition: `f3f7cb0acb35d3619347af43b81e9e4fa7563f2d`
Candidate workflow: `33233814228` SUCCESS

## Observed implementation results

The isolated typed-click path is green in the adversarial lab and deterministic MV3/CRX packaging gate. It preserves exact pinned-tab lookup, cached-perception binding, fresh live AX/DOM revalidation, backend-node replacement rejection, dangerous-node rejection and final hit-target checking. The implementation has exactly two physical dispatch sites: one press and one release. Failures before the first dispatch are `NO_EFFECT`; failures once dispatch has started are terminal `AMBIGUOUS`; automatic retry remains disabled.

The candidate gate also keeps R8A/R8B and legacy debugger/perception/OOPIF/semantic-action regressions green, changes no dependency manifest, produces deterministic extension packaging and emits provenance-attested evidence.

## Primary-source re-check

### Chrome DevTools Protocol Input

`Input.dispatchMouseEvent` is the browser input primitive and a click remains a sequence of distinct mouse events. A successful protocol response acknowledges the command, but the protocol does not provide a page-business-effect transaction or an arbitrary webpage idempotency key. Therefore an acknowledgement boundary must not be upgraded into an exactly-once page-effect claim.

### chrome.debugger

Manifest V3 `chrome.debugger.sendCommand()` is an asynchronous CDP transport. Its Promise resolves with the protocol response or rejects on command-posting failure. This supports the R8C transport classification but does not prove that a webpage application accepted or durably processed the resulting input.

### OOPIF/session model

Chrome documents that frames do not map one-to-one to debugger targets and that out-of-process frames can require child sessions. R8C deliberately remains a main-frame exact-hit click slice and does not broaden its claim into arbitrary OOPIF actuation. Existing perception/OOPIF regressions stay inherited; OOPIF physical actuation remains a separate future capability if needed.

## What changed after implementation

The candidate results confirm that the chosen state machine is smaller and safer than wrapping the legacy click path. No new dependency or abstraction is needed.

The remaining evidence gap is narrower than the original implementation gap: prove that the exact staged MV3 package, when loaded into real Chrome, can use its trusted sidepanel -> perception -> typed-click path to create one observable page effect without the test harness sending `Input.*` itself.

A unit or VM-only lab is insufficient for this final claim because it can verify call counts while still missing extension loading, service-worker wiring, `chrome.debugger` attachment, real AX/DOM lookup and real browser hit testing.

## Verification decision

Add an independent real-Chrome canary rather than changing the already-green actuator.

The canary must:

1. build the exact staged extension from the source commit;
2. load that staged MV3 into a fresh Chrome profile;
3. serve a local TLS fixture under the policy-recognized `chatgpt.com` hostname using test-only host resolution;
4. open the extension `sidepanel.html` as the trusted sender;
5. invoke the existing staged perception capture;
6. invoke `A2_OPERATOR_TYPED_CLICK_V1` using that fresh perception frame;
7. require `COMMITTED` and `physical_dispatch_started=true`;
8. observe exactly one monotonic fixture click effect;
9. prohibit any `Input.dispatchMouseEvent` call in the external canary harness;
10. retain the explicit non-claim that arbitrary webpages do not provide exactly-once semantics.

The remote-debugging endpoint used by this canary is test-only bootstrap/observation infrastructure. It is not a production Browser Operator transport and grants no new production capability.

## Decision

Keep the R8C actuator unchanged. Add only the real-Chrome verification harness/workflow and seal R8C after both the existing candidate gate and the new live canary are green on the exact same source head.

## Confirmed invariants

- `NO_EFFECT_ONLY_BEFORE_FIRST_PHYSICAL_DISPATCH`.
- `POST_DISPATCH_FAILURE_IS_AMBIGUOUS`.
- `NO_CLEANUP_OR_RETRY_DISPATCH_AFTER_AMBIGUITY`.
- `ACTION_ID_IS_CORRELATION_NOT_PAGE_IDEMPOTENCY`.
- `FRESH_EXTENSION_REVALIDATION_BEFORE_CLICK`.
- `TYPED_CLICK_RESPONSE_EXPOSES_NO_ENGINE_IDENTITY`.
- `LEGACY_SEMANTIC_ACTION_PATH_UNCHANGED_IN_R8C`.
- `TEST_HARNESS_DOES_NOT_DISPATCH_BROWSER_INPUT`.
- `REAL_PAGE_EFFECT_IS_A_CANARY_NOT_AN_EXACTLY_ONCE_CLAIM`.

## Explicit non-claims

R8C still does not claim page-level exactly-once semantics, automatic retry, arbitrary OOPIF actuation, typing/select/navigation/download/WebMCP actuation, distributed authority, or production use of a DevTools TCP endpoint.
