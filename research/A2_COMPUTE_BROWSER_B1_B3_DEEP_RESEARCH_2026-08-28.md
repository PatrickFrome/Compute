# A2 Compute Browser — B1/B3 Deep Research 2026-08-28

Status: research checkpoint for `work/a2-compute-browser-b0-b1`.

## Questions

1. How should A2 isolate production browser profiles while retaining durable login state?
2. Should native control remain on a loopback DevTools WebSocket or move to `--remote-debugging-pipe`?
3. Which process/profile locks are authoritative?
4. How should crash recovery be modeled without accidentally replaying browser effects?

## Findings

### Chrome 136+ remote-debugging boundary

Chrome's security change for `--remote-debugging-port` and `--remote-debugging-pipe` requires a non-default `--user-data-dir` when debugging normal Chrome. This is a desirable security boundary for A2, not an inconvenience. Production A2 profiles remain dedicated A2-owned directories and the default personal Chrome profile is never imported or remote-debugged.

Source: https://developer.chrome.com/blog/remote-debugging-port

### Chromium ProcessSingleton is the inner profile-corruption fence

Chromium names `ProcessSingleton` by user-data directory and refuses unsafe concurrent ownership. Linux uses a Unix-domain-socket mechanism inside the user-data directory; Chrome aborts on lock error/profile-in-use rather than risking multiple writers to one profile.

A2 therefore keeps two layers:

- outer A2 daemon/state-root lock: prevents competing A2 control planes and local IPC takeover;
- Chromium ProcessSingleton: authoritative browser-engine fence for a specific user-data directory.

Sources:
- https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/process_singleton.h
- https://chromium.googlesource.com/chromium/src/+/master/chrome/browser/chrome_browser_main.cc

### Native DevTools pipe is the correct B3 transport

Chromium's remote debugging pipe is explicitly wired to FD 3 for browser reads and FD 4 for browser writes. Chromium performs an early check that both descriptors are open because accidentally reusing those descriptor numbers could corrupt unrelated files.

The legacy text pipe protocol uses NUL (`\0`) delimited JSON messages. This is enough to implement a dependency-minimal Node transport without exposing a TCP DevTools endpoint.

Sources:
- https://chromium.googlesource.com/chromium/src/+/main/components/devtools/devtools_pipe/devtools_pipe.h
- https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/devtools_pipe_handler.h
- https://chromium.googlesource.com/chromium/src/+/e972c575b9a075ab5dcadddf269d60bb23d4af35

### Puppeteer independently validates the pipe architecture

Current Puppeteer selects pipe transport when Chrome is launched with `--remote-debugging-pipe`; its browser launcher provisions dedicated pipe descriptors rather than discovering a WebSocket endpoint. This supports A2's decision to keep Playwright/Puppeteer optional adapters rather than runtime dependencies.

Source: https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/node/BrowserLauncher.ts

### Crash recovery must restart process state, not replay actions

A browser-process crash invalidates PID, CDP connection, and target bindings. Durable A2 identities (`browser_node_id`, `profile_id`, logical `target_id`, `conversation_epoch`) remain separate from those ephemeral bindings. B1 may restart the process and rebuild observation/bindings, but must not replay a physical/web action merely because process state disappeared.

This directly preserves A2's existing `NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT` invariant.

## Decisions

1. B1 keeps loopback TCP only as a transitional internal implementation.
2. B3 must replace loopback debugging with inherited FD3/FD4 pipe transport.
3. Raw CDP remains internal-only. External RPC stays typed.
4. Engine executable, headless mode, sandbox mode, and browser flags are daemon-owned configuration, never RPC parameters.
5. B1 target creation is restricted to `about:blank`; remote navigation becomes a later typed action under action-graph/lease policy.
6. Control capability token rotates per daemon session.
7. One live A2 daemon owns one state root.
8. Browser crash recovery invalidates ephemeral bindings and creates a fresh process incarnation; no action replay is implied.
9. Chrome for Testing remains CI/benchmark-only. Production uses an updated installed Chrome/Chromium with an A2-owned data directory.

## B3 implementation shape

```text
Node parent
  fd3 writable stream -> Chrome read FD3
  fd4 readable stream <- Chrome write FD4
       |
       +-- ASCIIZ JSON CDP transport
       +-- request-id correlation
       +-- bounded frame size
       +-- pending-call cancellation on process exit
       +-- no HTTP /json/version discovery
       +-- no TCP listening socket
```

## Required negative tests

- daemon lock cannot be stolen while owner PID is alive;
- stale daemon/profile lock can be recovered only after owner death;
- `profile.start` cannot supply executable/headless/sandbox/flags remotely;
- B1 cannot navigate to HTTPS/file/http URLs;
- raw CDP/eval/shell are absent from external protocol;
- browser crash does not retain old CDP target bindings;
- pipe parser rejects oversized or malformed frames;
- process exit rejects all pending CDP calls;
- B3 opens no DevTools TCP listener.
