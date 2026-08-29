# A2 Browser R8C — Typed Extension CLICK Outcome — Post-Implementation Research

Date: 2026-08-29
Parent verified milestone: R8B `bd4b3c029fc4531d355ca181a0897d50e68268b3`
Initial candidate head: `f3f7cb0acb35d3619347af43b81e9e4fa7563f2d`
Initial candidate workflow: `33233814228` SUCCESS
First live-proof head: `fb95235f750d23b814eb4204ab7f5032b2c71a70`
First live-proof workflow: `33235471140` FAILED at runtime only

## Observed implementation results

The isolated typed-click path is green in the adversarial lab and deterministic MV3/CRX packaging gate. It preserves exact pinned-tab lookup, cached-perception binding, fresh live AX/DOM revalidation, backend-node replacement rejection, dangerous-node rejection and final hit-target checking. The implementation has exactly two physical dispatch sites: one press and one release. Failures before the first dispatch are `NO_EFFECT`; failures once dispatch has started are terminal `AMBIGUOUS`; automatic retry remains disabled.

The candidate gate also keeps R8A/R8B and legacy debugger/perception/OOPIF/semantic-action regressions green, changes no dependency manifest, produces deterministic extension packaging and emits provenance-attested evidence.

## Primary-source re-check

### Chrome DevTools Protocol Input

`Input.dispatchMouseEvent` is the browser input primitive and a click remains a sequence of distinct mouse events. A successful protocol response acknowledges the command, but the protocol does not provide a page-business-effect transaction or an arbitrary webpage idempotency key. Therefore an acknowledgement boundary must not be upgraded into an exactly-once page-effect claim.

### chrome.debugger

Manifest V3 `chrome.debugger.sendCommand()` is an asynchronous CDP transport. Its Promise resolves with the protocol response or rejects on command-posting failure. This supports the R8C transport classification but does not prove that a webpage application accepted or durably processed the resulting input.

### Extension-loading policy

The first live-proof run built the staged MV3 successfully and reached Chrome 151, but the extension page had no `chrome.storage` API. This was an environment/harness failure, not an actuator failure: official Chrome branded builds removed `--load-extension` starting in Chrome 137, and later also removed `--disable-extensions-except`. Chromium and Chrome for Testing retain these development/test flags. The existing project MV3 runtime canary already uses a pinned Playwright Chromium for this reason.

Therefore the live proof must run on a non-branded test engine that explicitly supports unpacked extension loading. It must not weaken production browser policy or alter the R8C actuator.

### OOPIF/session model

Frames do not map one-to-one to debugger targets and out-of-process frames can require child sessions. R8C deliberately remains a main-frame exact-hit click slice and does not broaden its claim into arbitrary OOPIF actuation. Existing perception/OOPIF regressions stay inherited; OOPIF physical actuation remains a separate future capability if needed.

## What changed after implementation

The candidate results confirm that the chosen state machine is smaller and safer than wrapping the legacy click path. No new source/runtime dependency or actuator abstraction is needed.

The remaining evidence gap is now specifically an end-to-end browser test: prove that the exact staged MV3 package, when loaded into a supported Chromium test engine, can use its trusted sidepanel -> perception -> typed-click path to create one observable page effect without the test harness sending `Input.*` itself.

A unit or VM-only lab is insufficient for this final claim because it can verify call counts while still missing extension loading, service-worker wiring, `chrome.debugger` attachment, real AX/DOM lookup and real browser hit testing.

## Verification decision

Keep the already-green actuator unchanged. Repair only the live-test engine selection by using exact-pinned Playwright `1.62.1` to provision its Chromium build, matching the repository's previously proven MV3 test pattern.

The canary must:

1. build the exact staged extension from the source commit;
2. load that staged MV3 into a fresh supported Chromium profile;
3. serve a local TLS fixture under the policy-recognized `chatgpt.com` hostname using test-only host resolution;
4. open the extension `sidepanel.html` as the trusted sender;
5. invoke the existing staged perception capture;
6. invoke `A2_OPERATOR_TYPED_CLICK_V1` using that fresh perception frame;
7. require `COMMITTED` and `physical_dispatch_started=true`;
8. observe exactly one monotonic fixture click effect;
9. prohibit any `Input.dispatchMouseEvent` call in the external canary harness;
10. retain the explicit non-claim that arbitrary webpages do not provide exactly-once semantics.

The remote-debugging endpoint used by this canary is test-only bootstrap/observation infrastructure. It is not a production Browser Operator transport and grants no new production capability.

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
- `BRANDED_CHROME_EXTENSION_LOADING_IS_NOT_A_TEST_ASSUMPTION`.

## Explicit non-claims

R8C still does not claim page-level exactly-once semantics, automatic retry, arbitrary OOPIF actuation, typing/select/navigation/download/WebMCP actuation, distributed authority, or production use of a DevTools TCP endpoint. Playwright Chromium is a CI verification engine only and is not promoted into the production browser policy.
