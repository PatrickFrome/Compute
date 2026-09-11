# A2 Compute Browser — B2 Profile / Context Deep Research — 2026-08-28

## Research result

A2 must model three different identity/lifetime layers instead of using Chrome profiles or tabs for everything:

```text
profile_id   = persistent on-disk authentication/storage/security boundary
context_id   = cheap isolated task/agent browser session inside a browser process
target_id    = logical page/worker target inside a context
```

## Evidence

### CDP

Current Chrome DevTools Protocol exposes `Target.createBrowserContext`, `Target.getBrowserContexts`, and `Target.disposeBrowserContext`. A created context is described as similar to an incognito profile and multiple contexts can coexist. `Target.createTarget` accepts a `browserContextId`, so pages can be bound explicitly to a context. Disposing a context closes all pages in it without running `beforeunload`.

Source: https://chromedevtools.github.io/devtools-protocol/tot/Target/

### WebDriver BiDi

The current W3C WebDriver BiDi specification defines the same architectural layer as `browser.UserContext` with `browser.createUserContext`, `browser.getUserContexts`, and `browser.removeUserContext`. Removal closes all navigables without running `beforeunload`.

This means A2 should not expose the CDP-specific `browserContextId` as durable protocol identity. A logical A2 `context_id` can map to CDP today and to BiDi UserContext later.

Source: https://www.w3.org/TR/webdriver-bidi/

### Playwright

Playwright BrowserContexts are independent, cheap, incognito-like sessions; non-persistent contexts do not write browsing data to disk. Playwright explicitly separates them from `launchPersistentContext(userDataDir)`, where the user data directory stores persistent cookies/local storage and only one process may own that directory.

Sources:
- https://playwright.dev/docs/api/class-browsercontext
- https://playwright.dev/docs/api/class-browsertype
- https://playwright.dev/docs/next/browser-contexts

## Security implications

1. Persistent A2 profiles may contain high-value authentication state and must never be copied into logs, Git, generic evidence bundles, or remote RPC payloads.
2. Ephemeral contexts should be the default for research/testing workers that do not require persistent login state.
3. Context creation must not automatically inherit arbitrary stored authentication from another profile/context.
4. `storageState`-style export/import is intentionally NOT a B2 capability. Playwright documents that such files can contain impersonation-grade cookies and credentials; A2 should add this only later behind an explicit secret/export authority boundary.
5. Context disposal is a local lifecycle effect, not proof that any prior web action did or did not occur.
6. Crash recovery may rebuild a context/target binding, but must never replay an ambiguous browser action.

## B2 protocol decision

Add durable/logical:
- `context_id`
- `context_kind`: `PERSISTENT_DEFAULT | EPHEMERAL_ISOLATED`
- `profile_id`

Keep ephemeral/internal:
- `cdp_browser_context_id`
- future `bidi_user_context_id`

Initial B2 external methods should remain lifecycle-only:
- `context.create`
- `context.list`
- `context.close`

No cookie export/import, storage-state export/import, proxy override, permission override, insecure-certificate override, or navigation is enabled in the first B2 slice.

## B2 persistence rules

- `PERSISTENT_DEFAULT`: uses the process default context backed by the A2-owned profile directory; cannot be disposed by `Target.disposeBrowserContext`.
- `EPHEMERAL_ISOLATED`: created with CDP `Target.createBrowserContext`; normally `disposeOnDetach=true`; not treated as durable authentication storage.
- A target record stores logical `context_id`, never only raw `browserContextId`.
- Context registry survives runtime restarts as metadata, but ephemeral CDP context bindings do not. On restart an ephemeral context gets a new physical binding/epoch and its old targets remain unbound until explicitly reconstructed by a safe higher-level workflow.

## Portability decision

A2 Browser Protocol owns `context_id`; CDP and BiDi are adapters. CDP remains the Chromium implementation because it currently exposes the low-level browser/runtime/network primitives A2 needs, but B2 avoids baking CDP identifiers into higher layers.

## Required tests

- two ephemeral contexts get different physical context IDs;
- targets created in context A never bind to context B;
- closing context A does not mutate B;
- default persistent context cannot be disposed;
- restart invalidates ephemeral physical bindings without deleting durable logical metadata;
- no storage/cookie material enters context registry JSON;
- no context API creates a remote navigation in B2;
- raw CDP/BiDi identifiers never replace logical `context_id` in external receipts.
