# METAENGINE A2 Compute Browser

`A2 Compute Browser` is the standalone execution surface for Browser Operator. The Chrome extension remains a compatibility adapter; this runtime owns a dedicated browser process and profile.

## B0–B3 typed runtime scope

This first slice is deliberately small and fail-closed:

- zero third-party runtime dependencies (Node.js >= 22);
- browser executable is daemon-owned configuration and cannot be supplied through RPC;
- always uses an A2-owned non-default `user-data-dir`;
- never imports/copies the user's default Chrome profile or cookies;
- Chromium's own `ProcessSingleton` remains the inner profile-corruption fence; A2 adds a state-root/daemon ownership fence above it;
- B3 uses inherited `remote-debugging-pipe`: the daemon writes to Chromium FD3 and reads Chromium FD4; no DevTools TCP listener or `/json/version` discovery exists;
- the internal JSON/NUL pipe parser has a daemon-owned 16 MiB frame ceiling and fails closed on malformed, truncated or oversized frames;
- local control uses a Unix socket / Windows named pipe plus a fresh 256-bit capability token for every daemon session;
- RPC exposes only typed lifecycle/target methods, never raw CDP, JavaScript evaluation, shell, arbitrary browser flags, executable-path overrides, or sandbox/headless overrides;
- persistent logical targets are separate from ephemeral CDP target IDs and every binding carries a fresh `process_incarnation_id`;
- the B2 context manager exposes a logical non-disposable `default` context and explicitly-created ephemeral contexts, each bound to exactly one browser process incarnation;
- context lifecycle persists `PREPARING`/`CLOSING` intent before CDP, never exposes engine context IDs or proxy/universal-access controls, and records an old-incarnation context as `LOST` instead of silently recreating it;
- context disposal requires all of its logical targets to be explicitly retired first;
- target create/activate/close writes a durable `PREPARING`/`ACTIVATING`/`CLOSING` intent before the CDP effect; an ambiguous operation remains recovery-required and is not blindly retried;
- B1 target creation is restricted to `about:blank`; remote navigation is not yet an enabled capability;
- browser-process failure rejects all pending CDP calls, invalidates ephemeral bindings and may restart the process with a new incarnation, but never implies replay of a browser/web action;
- no click/type/submit actuation is exposed in B1.

## Engine policy

Production uses an installed, security-updated Chrome/Chromium with a dedicated A2 profile. Chrome for Testing is pinned only for CI/benchmark reproducibility. See `engine-lock.json`.

## Run

```bash
A2_CHROME_EXECUTABLE=/absolute/path/to/chrome node src/cli.mjs serve
```

The daemon prints the local socket/pipe path and the path of the token file, but never prints the token itself. The token is deleted on clean RPC shutdown and rotated at the next daemon start.

For a destructive-free smoke test (headless `about:blank` only):

```bash
A2_CHROME_EXECUTABLE=/absolute/path/to/chrome node src/cli.mjs self-test
```

The self-test verifies real Chromium startup over the inherited pipe, negative remote-navigation policy, browser-process restart after `Browser.close`, PID/incarnation rotation, old-binding invalidation, explicit `LOST` context recovery with epoch rotation, isolated target creation, context disposal, target retirement and clean shutdown.

`--no-sandbox` is not accepted in normal operation. The runtime permits it only when both `CI=true` and `A2_CI_ALLOW_NO_SANDBOX=1` are set by the CI smoke environment.

## Current typed RPC

- `runtime.health`
- `profile.start`
- `profile.stop`
- `profile.list`
- `context.create`
- `context.list`
- `context.close`
- `target.create`
- `target.list`
- `target.activate`
- `target.close`

Method effects are explicitly classified as `READ_ONLY`, `LOCAL_LIFECYCLE`, or `LOCAL_UI`; all responses retain `web_authority_effect=false`.

There is intentionally no `cdp.call`, `Runtime.evaluate`, `exec`, generic browser-argument RPC, or remote navigation capability.

## Research

See `research/A2_COMPUTE_BROWSER_B1_B3_DEEP_RESEARCH_2026-08-28.md`, `research/a2-compute-browser-b2-b3/report-source.md`, and `research/a2-compute-browser-b2-contexts/report-source.md` for the Chromium profile-lock, remote-debugging security, native-pipe, process-incarnation, and context-recovery decisions.
