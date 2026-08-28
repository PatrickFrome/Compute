# A2 Compute Browser B3/R4 session and perception research

Date: 2026-08-28  
Base: `c50dd08650a81305c42ab8369e0e519df35ff321`

## Decision

The next implementation slice is an internal-only flattened CDP session
scheduler plus a read-only semantic snapshot primitive. It must not add
navigation or actuation.

1. Attach to a logical target with `Target.attachToTarget({flatten:true})`.
2. Bind every session to logical `target_id`, `conversation_epoch`,
   `process_incarnation_id`, and an internal session generation.
3. Route calls with the top-level CDP `sessionId`; never expose raw session IDs.
4. Invalidate the binding on `Target.detachedFromTarget`, target crash/destroy,
   pipe close, or process-incarnation change.
5. Queue calls per logical target and bound total in-flight calls per browser.
6. Produce a read-only snapshot from `DOMSnapshot.captureSnapshot` plus
   `Accessibility.getFullAXTree`; do not use `Runtime.evaluate`.
7. Compile only bounded, allowlisted fields into backend-neutral semantic nodes.

## Evidence

CDP says flattened sessions are addressed by `sessionId` on commands and that
non-flattened mode is planned for retirement. Auto-attach covers related targets
such as iframes and workers, but must be applied recursively; attach/detach
events are therefore lifecycle facts, not durable identity.

Source: <https://chromedevtools.github.io/devtools-protocol/tot/Target/>

`DOMSnapshot.captureSnapshot` returns a flattened full DOM including iframes,
template content and flattened shadow DOM, with layout data and a shared string
table. Its computed-style input is an explicit whitelist, which is suitable for
a bounded perception compiler. Paint order and DOM rectangles are opt-in and
should remain daemon-owned policy.

Source: <https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/>

The generated protocol schema describes `StringIndex` only as an integer, but
the Chromium producer has a stricter implementation detail that a consumer must
honor: `InspectorDOMSnapshotAgent::AddString` returns `-1` for an empty string.
The producer uses that function for node values, layout text, document metadata,
and attribute values. The parser must therefore decode `-1` as empty only in
fields where empty content is valid, while retaining non-negative bounds for
node names, attribute names, and the selected computed styles. A real Chrome
151 run exposed this gap after all 39 transport/compiler unit contracts passed.

Source: <https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/inspector/inspector_dom_snapshot_agent.cc>

The Accessibility domain supplies the semantic accessibility tree without page
script execution. It complements, rather than replaces, DOM/layout evidence.
`AXNode.backendDOMNodeId` is the exact join key for
`NodeTreeSnapshot.backendNodeId`; layout rows in turn point at DOM rows by
`nodeIndex`. This permits a causal join without selectors, URLs, or page code.
Both domains are experimental, so protocol failure is a hard compatibility
failure and never triggers an eval-based fallback.

Source: <https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/>

Puppeteer's current connection implementation is a useful transport analogue:
it separates root connection callbacks from session routing and disposes
session state on detach. A2 adds durable logical identity and stricter external
typing instead of exposing its generic CDP session surface.

Source: <https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/cdp/Connection.ts>

Playwright independently uses the same lifecycle shape: it routes messages by
the top-level `sessionId`, owns callbacks per `CRSession`, and rejects those
callbacks when the session is disposed. This is stronger evidence for
session-local failure than treating the browser pipe as one undifferentiated
request channel.

Source: <https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/crConnection.ts>

WebDriver BiDi is the preferred future cross-browser adapter. It standardizes
user contexts and bounded node location (including accessibility locators), but
does not currently expose an equivalent atomic DOM + layout + accessibility
snapshot. Replacing this Chromium kernel with BiDi now would lose the bounded
layout evidence needed by R4; exposing both transports externally would widen
authority. The protocol boundary must therefore remain backend-neutral while
the B3 implementation stays internal CDP.

Source: <https://www.w3.org/TR/webdriver-bidi/>

## Evidence-gap matrix

| Claim | Evidence | Confidence | Implementation consequence |
|---|---|---:|---|
| Flattened session routing uses top-level `sessionId` | CDP Target + Puppeteer + Playwright | High | Implement internal flattened scheduler. |
| Detach must fail only that session's pending work | Puppeteer + Playwright source | High | Add session-local rejection; keep other sessions alive. |
| AX nodes can be joined to DOM/layout without selectors | CDP AX `backendDOMNodeId`; DOMSnapshot `backendNodeId` and layout `nodeIndex` | High | Compile exact backend-ID join internally; redact engine IDs externally. |
| Snapshot covers same-process iframe and flattened shadow DOM | CDP DOMSnapshot contract | High | Unit-test flattening compiler and real same-process fixture. |
| One root snapshot is sufficient for every OOPIF | No authoritative proof found | Low | Do not claim or merge OOPIF yet; require explicit attached-session fixture in a later gate. |
| BiDi can replace the current semantic snapshot | BiDi has contexts and locators, but no equivalent layout snapshot | Low | Keep backend-neutral public schema; defer BiDi adapter. |
| Every DOMSnapshot string index is non-negative | Chromium producer returns `-1` for empty strings | High | Decode the sentinel only for producer-defined empty fields; reject it for names/styles and reject every value below `-1`. |

## Hard boundaries

- No external `cdp.call`, `sessionId`, backend node ID, remote object ID, eval,
  JS injection, shell, arbitrary domain/method, or arbitrary computed style.
- Page content and snapshot strings have zero authority.
- Snapshot limits are daemon-owned: frame/node/string/byte/deadline ceilings.
- A snapshot receipt is exact to target epoch + process incarnation + session
  generation and is unusable for actuation after any of them changes.
- DOMSnapshot and AX are sequential read-only observations, not an atomic page
  transaction. This slice therefore emits `actuation_eligible: false`; later
  node-bound input must perform its own immediate perception/action validation.
- OOPIF sessions are separate exact bindings; data is merged only by explicit
  frame/parent relationships, never by URL guessing.
- This slice does not claim OOPIF completeness. A root-only snapshot reports
  `scope: MAIN_TARGET`; OOPIF support requires a later real cross-origin
  attach/detach fixture and explicit frame relationship proof.
- Detach during capture yields `SNAPSHOT_STALE`, never partial success.

## Planned verification

- response correlation across root and two flattened sessions
- detach rejects every pending session call
- stale incarnation/session generation rejection
- per-target FIFO plus bounded global in-flight work
- attach/detach registry with OOPIF completeness explicitly unclaimed
- DOMSnapshot string-table and sparse-array bounds
- real Chromium empty-string sentinel plus wrong-field and below-sentinel rejection
- accessibility/DOM merge without eval
- deterministic snapshot hash and exact causal receipt
- real Chromium main-target fixture; cross-origin OOPIF is a separate gate
