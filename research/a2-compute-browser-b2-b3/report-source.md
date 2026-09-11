# A2 Compute Browser B2/B3 — native pipe and incarnation research

Date: 2026-08-28 (project timezone)

Status: implementation decision for `work/a2-compute-browser-b2-b3`.

## Executive decision

The next bounded roadmap slice is a combined B2/B3 foundation:

1. replace the transitional loopback DevTools WebSocket and `/json/version`
   discovery with Chromium's inherited `--remote-debugging-pipe` transport;
2. give every browser-process start a fresh `process_incarnation_id` and bind
   every ephemeral CDP target mapping to that incarnation;
3. fail all in-flight CDP calls when the pipe or browser process closes;
4. persist target lifecycle intent before create/activate/close effects and
   leave ambiguous operations recovery-required rather than retrying them;
5. retain the existing typed local RPC boundary and keep raw CDP internal;
6. do not add general navigation, JavaScript evaluation, shell execution, or
   caller-controlled Chrome flags in this slice.

This is stronger than broadening the profile API first: it removes a listening
socket from the trusted execution kernel and gives all later B2/R4 features a
causal identity fence they can rely on.

## Primary-source findings

### Chromium pipe protocol is current and has two modes

Current Chromium `DevToolsPipeHandler` defaults to ASCIIZ framing: each protocol
message is followed by a NUL byte and the reader extracts all complete NUL-
delimited frames. Chromium now also accepts the explicit switch value `cbor`,
which selects a CBOR envelope mode. The default JSON/NUL mode remains supported.

Chromium's own receive buffer allows up to 100 MiB. A2 will deliberately use a
smaller daemon-owned 16 MiB frame ceiling. That is large enough for near-term
semantic perception payloads while bounding memory use. The limit is not an RPC
parameter.

Source: https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/devtools_pipe_handler.cc

### Descriptor direction is independently validated

Current Puppeteer provisions two additional child descriptors and consumes
`browserProcess.nodeProcess.stdio[3]` as the parent-writable stream and
`stdio[4]` as the parent-readable stream. It constructs `PipeTransport` directly
from those streams when `--remote-debugging-pipe` is present.

Source: https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/node/BrowserLauncher.ts

Node documents that each index in `options.stdio` corresponds to the same child
file descriptor and that extra descriptors may be created with `pipe`. Therefore
`['ignore', 'ignore', 'pipe', 'pipe', 'pipe']` gives A2 a writable parent endpoint
at index 3 and a readable parent endpoint at index 4, matching Chromium and
Puppeteer.

Source: https://nodejs.org/api/child_process.html#optionsstdio

### Dedicated profiles remain mandatory

Since Chrome 136, both remote debugging port and pipe switches require a non-
default `--user-data-dir` for normal Chrome. Chrome recommends custom data
directories for debugging isolation. A2 already creates daemon-owned dedicated
profiles and must never attach the pipe to the user's default Chrome profile.

Source: https://developer.chrome.com/blog/remote-debugging-port

### Profile identity and browser context are different layers

Playwright's `BrowserContext` and WebDriver BiDi user contexts provide isolated
storage partitions inside a browser process. They are useful future B2 building
blocks, but do not replace A2's durable on-disk profile identity or a browser-
process incarnation fence. A process crash invalidates the transport and all
engine target IDs even when the durable profile directory survives.

Sources:

- https://playwright.dev/docs/browser-contexts
- https://www.w3.org/TR/webdriver-bidi/#user-contexts
- https://chromedevtools.github.io/devtools-protocol/tot/Target/

## Comparison with strong analogues

| System | Strong idea retained | A2-specific strengthening |
|---|---|---|
| Puppeteer | inherited CDP pipe on child descriptors 3/4 | no external raw CDP; bounded parser; durable/ephemeral identity split |
| Playwright | browser-context isolation and persistent-profile support | daemon-owned profiles and explicit process-incarnation receipts |
| WebDriver BiDi | standardized user-context identity | deferred adapter; A2 keeps one typed protocol across extension/CDP/BiDi backends |
| Raw Chrome CDP | direct browser/target lifecycle primitives | no discovery HTTP, no TCP listener, no caller-controlled executable or flags |

## Failure model

- A truncated frame remains buffered only while it is within the limit.
- An oversized or malformed frame is a protocol failure, not an ignored event.
- A pipe read/write close rejects all pending calls exactly once.
- A browser exit invalidates the process incarnation and every target binding.
- Recovery may restart Chromium for the same durable profile, but never replays a
  navigation or physical effect.
- Target lifecycle states `PREPARING`, `ACTIVATING`, and `CLOSING` are durable
  pre-effect records. A timeout leaves the state pending and blocks blind replay.
- A logical target may be recreated only by an explicit typed operation; an old
  engine target ID is never silently rebound across incarnations.

## Verification matrix

1. parser: partial frame, multiple frames, UTF-8 JSON, empty frame, malformed
   JSON, oversized frame;
2. correlation: response success/error, timeout, unknown response ID;
3. closure: pipe end/error and browser exit reject pending calls;
4. launch contract: exact `--remote-debugging-pipe`; no debugging port/address;
5. runtime contract: fresh `process_incarnation_id` after crash/restart;
6. binding contract: target records carry the live incarnation only;
7. intent contract: create/activate/close state is durable before its CDP call
   and ambiguous completion blocks a same-target retry;
8. external boundary: raw CDP/eval/shell/arbitrary flags remain absent;
9. real Chromium: start, health, target list/create/activate/close, forced crash, recovery,
   fresh PID/incarnation, and zero transitional transport metadata;
10. CI: deterministic evidence archive and GitHub artifact attestation.

## Deferred work

- CBOR pipe mode: potentially useful after measurement, but not needed for the
  dependency-free B3 transport.
- multiple ephemeral contexts per durable profile: later B2 typed surface after
  lifecycle policy and receipts are specified.
- WebDriver BiDi: future remote/multi-browser adapter, not a replacement for the
  Chromium primary transport today.
- R4 Semantic Perception Compiler: next shared layer after this causal transport
  and incarnation boundary is proven.
