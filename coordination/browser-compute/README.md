# METAENGINE A2 Compute Browser

`A2 Compute Browser` is the standalone execution surface for Browser Operator. The Chrome extension remains a compatibility adapter; this runtime owns a dedicated browser process and A2-owned profile.

## Implemented runtime layers (B0–B3 and R4 semantic perception)

### B1 — Managed Chromium Runtime

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

### B3 — Native CDP Broker transport

- Chromium is launched with `--remote-debugging-pipe`;
- parent Node process owns inherited FD3/FD4 DevTools pipes;
- CDP JSON is NUL-framed, bounded and request-correlated by the internal `CdpPipeClient`;
- no `--remote-debugging-port`, no `--remote-debugging-address`, no `/json/version` discovery and no DevTools TCP listener;
- raw CDP remains internal-only and is never an external RPC method.

### B2 — Profile / Context Manager

A2 now separates three identities:

```text
profile_id  -> persistent disk/auth/storage boundary
context_id  -> logical isolated task/agent browser session
target_id   -> logical page/worker target
```

`context_id` is protocol-owned. On Chromium it maps internally to CDP `browserContextId`; a future WebDriver BiDi adapter can map the same logical identity to a BiDi UserContext without changing supervisor/task graph contracts.

B2 exposes lifecycle-only context operations:

- `context.create`
- `context.list`
- `context.close`

The first B2 slice permits only `EPHEMERAL_ISOLATED` context creation. The process default context is represented as `default` / `PERSISTENT_DEFAULT` and cannot be disposed through context RPC.

No cookie/storage-state export/import, proxy override, permission override, insecure-certificate override, navigation, click, type or submit authority is added by B2.

## Context lifecycle safety

Context physical bindings are ephemeral and are never written to `contexts.json`. Durable metadata contains only logical IDs, kinds, epochs and lifecycle state.

`context.close` uses a two-phase lifecycle:

```text
ACTIVE
  -> durable CLOSING
  -> Target.disposeBrowserContext
       -> RETIRED on confirmed success
       -> CLOSE_AMBIGUOUS on uncertain result
```

`CLOSE_AMBIGUOUS` forbids both blind close retry and recreation with the same `context_id` until reconciliation. This applies A2's no-blind-retry invariant to browser lifecycle effects, not only clicks/Enter.

Context creation compensates a persistence failure by disposing the just-created physical context; if cleanup itself becomes uncertain, it fails with an explicit ambiguous-cleanup error.

## R4 — Semantic perception

R4 adds a perception-only semantic snapshot capability (`target.semantic_snapshot`) built on the B3 native-pipe transport. It compiles an accessibility/AX + DOM-snapshot observation into a bounded semantic frame that is explicitly marked `tainted_page_data: true` and `authority_effect: false`, with no page-script evaluation and no raw CDP exposed to the caller. Semantic frames are cached per target in the runtime and support structural rebinding/continuity across observations.

## Engine policy

Production uses an installed, security-updated Chrome/Chromium with a dedicated A2 profile. Chrome for Testing is pinned only for CI/benchmark reproducibility. See `engine-lock.json`.

## Run

```bash
A2_CHROME_EXECUTABLE=/absolute/path/to/chrome node src/cli.mjs serve
```

The daemon prints the local socket/pipe path and token-file path, never the token value. The token is deleted on clean RPC shutdown and rotated at the next daemon start.

For a destructive-free smoke test (`about:blank` only):

```bash
A2_CHROME_EXECUTABLE=/absolute/path/to/chrome node src/cli.mjs self-test
```

The self-test verifies real Chromium native-pipe startup, remote-navigation denial, default-context protection, two isolated browser contexts, exact target-to-context physical binding, cross-context non-mutation, process restart and zero DevTools TCP exposure, plus the R4 semantic snapshot (perception-only, tainted, bounded, structurally-reboundable) and explicit `LOST` context recovery with epoch rotation.

`--no-sandbox` is not accepted in normal operation. It is permitted only when both `CI=true` and `A2_CI_ALLOW_NO_SANDBOX=1` are set by the CI smoke environment.

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
- `target.semantic_snapshot`
- `target.activate`
- `target.close`

Method effects are explicitly classified as `READ_ONLY`, `LOCAL_LIFECYCLE`, or `LOCAL_UI`; all responses retain `web_authority_effect=false`.

There is intentionally no `cdp.call`, BiDi raw command, `Runtime.evaluate`, shell/exec, generic browser-argument RPC, credential-state export, or remote navigation capability.

## Research

- `research/A2_COMPUTE_BROWSER_B1_B3_DEEP_RESEARCH_2026-08-28.md`
- `research/a2-compute-browser-b2-b3/report-source.md`
- `research/a2-compute-browser-b2-contexts/report-source.md`
- `research/A2_COMPUTE_BROWSER_B2_PROFILE_CONTEXT_DEEP_RESEARCH_2026-08-28.md`
- `research/A2_SEMANTIC_PERCEPTION_R4_DEEP_RESEARCH_2026-08-28.md`
