# METAENGINE A2 Compute Browser

`A2 Compute Browser` is the standalone execution surface for Browser Operator. The Chrome extension remains a compatibility adapter; this runtime owns a dedicated browser process and profile.

## B0/B1 scope

This first slice is deliberately small and fail-closed:

- zero third-party runtime dependencies (Node.js >= 22);
- browser executable is daemon-owned configuration and cannot be supplied through RPC;
- always uses an A2-owned non-default `user-data-dir`;
- never imports/copies the user's default Chrome profile or cookies;
- Chromium's own `ProcessSingleton` remains the inner profile-corruption fence; A2 adds a state-root/daemon ownership fence above it;
- CDP is bound to a random `127.0.0.1` port only in B1; B3 replaces it with inherited `remote-debugging-pipe` FD3/FD4 transport;
- local control uses a Unix socket / Windows named pipe plus a fresh 256-bit capability token for every daemon session;
- RPC exposes only typed lifecycle/target methods, never raw CDP, JavaScript evaluation, shell, arbitrary browser flags, executable-path overrides, or sandbox/headless overrides;
- persistent logical targets are separate from ephemeral CDP target IDs;
- B1 target creation is restricted to `about:blank`; remote navigation is not yet an enabled capability;
- browser-process failure invalidates ephemeral bindings and may restart the process, but never implies replay of a browser/web action;
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

The self-test verifies real Chromium startup, negative remote-navigation policy, browser-process restart after `Browser.close`, logical target binding, target retirement and clean shutdown.

`--no-sandbox` is not accepted in normal operation. The runtime permits it only when both `CI=true` and `A2_CI_ALLOW_NO_SANDBOX=1` are set by the CI smoke environment.

## Current typed RPC

- `runtime.health`
- `profile.start`
- `profile.stop`
- `profile.list`
- `target.create`
- `target.list`
- `target.activate`
- `target.close`

Method effects are explicitly classified as `READ_ONLY`, `LOCAL_LIFECYCLE`, or `LOCAL_UI`; all B1 responses retain `web_authority_effect=false`.

There is intentionally no `cdp.call`, `Runtime.evaluate`, `exec`, generic browser-argument RPC, or remote navigation capability.

## Research

See `research/A2_COMPUTE_BROWSER_B1_B3_DEEP_RESEARCH_2026-08-28.md` for the Chromium profile-lock, remote-debugging security and native-pipe decisions that drive B1/B3.
