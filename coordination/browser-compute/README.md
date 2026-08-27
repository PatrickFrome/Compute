# METAENGINE A2 Compute Browser

`A2 Compute Browser` is the standalone execution surface for Browser Operator. The Chrome extension remains a compatibility adapter; this runtime owns a dedicated browser process and profile.

## B0/B1 scope

This first slice is deliberately small and fail-closed:

- zero third-party runtime dependencies (Node.js >= 22);
- launches only an explicitly selected Chrome/Chromium executable;
- always uses an A2-owned non-default `user-data-dir`;
- never imports/copies the user's default Chrome profile or cookies;
- CDP is bound to a random `127.0.0.1` port in B1; B3 will replace it with `remote-debugging-pipe`;
- local control uses a Unix socket / Windows named pipe plus a 256-bit local capability token;
- RPC exposes only typed lifecycle/target methods, never raw CDP, JavaScript evaluation, shell, or arbitrary Chrome flags;
- persistent logical targets are separate from ephemeral CDP target IDs;
- no click/type/submit actuation is exposed in B1.

## Engine policy

Production uses an installed, security-updated Chrome/Chromium with a dedicated A2 profile. Chrome for Testing is pinned only for CI/benchmark reproducibility. See `engine-lock.json`.

## Run

```bash
A2_CHROME_EXECUTABLE=/absolute/path/to/chrome node src/cli.mjs serve
```

The daemon prints the local socket/pipe path and the path of the token file, but never prints the token itself.

For a destructive-free smoke test (headless `about:blank` only):

```bash
A2_CHROME_EXECUTABLE=/absolute/path/to/chrome node src/cli.mjs self-test
```

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

There is intentionally no `cdp.call`, `Runtime.evaluate`, `exec`, or generic browser-argument RPC.
