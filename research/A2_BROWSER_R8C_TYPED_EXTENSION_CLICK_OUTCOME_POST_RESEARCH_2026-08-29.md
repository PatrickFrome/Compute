# A2 Browser R8C — Typed Extension CLICK Outcome — Post-Implementation Research

Date: 2026-08-29
Parent verified milestone: R8B `bd4b3c029fc4531d355ca181a0897d50e68268b3`
Initial candidate: `f3f7cb0acb35d3619347af43b81e9e4fa7563f2d`, workflow `33233814228` SUCCESS

## Runtime evidence progression

1. `fb95235f750d23b814eb4204ab7f5032b2c71a70` / run `33235471140`: staged MV3 build passed, but branded Chrome 151 did not load the unpacked extension. Classification: `RUNTIME/ENVIRONMENT`.
2. `00ce324fda68ba4a800d6de081536052fe1fcf9c` / run `33235572188`: Playwright-provisioned Chrome for Testing loaded the exact staged MV3. The production actuator failed closed with `NO_EFFECT / typed_click_target_hit_changed` before `mousePressed` because the native `<input type=button>` fixture exposed a user-agent shadow hit node. Classification: `TEST_FIXTURE`, security fence correct.
3. `b9ba26eccdae98d3b9ae20decce4022846e38507` / run `33235863858`: exact staged MV3 loaded; trusted sidepanel captured real perception; `A2_OPERATOR_TYPED_CLICK_V1` returned `COMMITTED`; `physical_dispatch_started=true`; the real page observed exactly one click; `automatic_retry_allowed=false`; `authority_effect=false`. The run then failed only during temporary Chrome-profile deletion with `ENOTEMPTY` after the proof was already emitted. Classification: `TEST_TEARDOWN`.
4. The current candidate keeps the actuator unchanged and hardens only the canary: bounded CDP calls, bounded browser-process shutdown, outer wall-clock watchdog, retry/best-effort cleanup for ephemeral CI profile files.

## Observed implementation results

The isolated typed-click path is green in the adversarial lab and deterministic MV3/CRX packaging gate. It preserves exact pinned-tab lookup, cached-perception binding, fresh live AX/DOM revalidation, backend-node replacement rejection, dangerous-node rejection and final hit-target checking. There are exactly two physical dispatch sites: one press and one release. Failures before the first dispatch are `NO_EFFECT`; failures once dispatch has started are terminal `AMBIGUOUS`; automatic retry remains disabled.

The candidate gate keeps R8A/R8B and legacy debugger/perception/OOPIF/semantic-action regressions green, changes no source dependency manifest, produces deterministic extension packaging and emits provenance-attested evidence.

## Primary-source re-check

### Chrome DevTools Protocol Input

`Input.dispatchMouseEvent` is a browser input primitive. A successful protocol response acknowledges the input command; it is not an arbitrary webpage transaction or idempotency receipt. R8C therefore does not convert transport acknowledgement into a page-level exactly-once claim.

### chrome.debugger

Manifest V3 `chrome.debugger.sendCommand()` is an asynchronous CDP transport. Its resolved Promise is a protocol response boundary, not proof that an application durably processed a business action.

### Extension service-worker lifetime

Manifest V3 service workers are intentionally terminable and must tolerate unexpected shutdown. Durable action history therefore must not depend on service-worker globals. This reinforces the R8 architecture rule that MV3 is an executor, not the durable brain.

### Extension-loading policy

Official branded Chrome removed command-line unpacked-extension loading for normal builds. Chromium / Chrome for Testing are the appropriate supported CI engines for an unpacked staged-MV3 canary. The test engine choice is verification infrastructure only and does not modify production browser policy.

### Exact hit testing

CDP `DOM.getNodeForLocation` can surface user-agent shadow DOM when requested. The native-input fixture therefore could not prove exact backend-node equality. Replacing only the test fixture with a leaf ARIA button preserved the production exact-hit fence and produced the one-click physical-effect proof.

### OOPIF/session model

Frames and debugger targets are not one-to-one; out-of-process iframes may require child sessions. R8C remains a main-frame exact-hit CLICK slice. OOPIF physical actuation is an explicit non-claim rather than an accidental implied capability.

## Decision

Keep the R8C actuator unchanged. Verification is split into two exact-source gates:

- typed/adversarial/package/provenance gate;
- real Chromium staged-extension physical-effect canary.

R8C may be promoted only when both gates are green on the exact same final source commit. The real canary must prove one observable page click while the external harness itself contains no `Input.dispatchMouseEvent` call.

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
- `EXACT_BACKEND_HIT_FENCE_IS_NOT_WEAKENED_FOR_TEST_GREEN`.
- `TEMP_PROFILE_TEARDOWN_IS_NOT_PART_OF_BROWSER_AUTHORITY_OR_EFFECT_PROOF`.

## Explicit non-claims

R8C does not claim page-level exactly-once semantics, automatic retry, arbitrary OOPIF actuation, typing/select/navigation/download/WebMCP actuation, distributed authority, or production use of a DevTools TCP endpoint. Playwright Chromium is CI verification infrastructure only.
