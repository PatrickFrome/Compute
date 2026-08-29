# A2 Compute Browser B2 Context Manager research

Date: 2026-08-27  
Base commit: `d927d2da8e4984886f828c07779c737de19d310a`  
Scope: source-only B2 slice; no provider, DDL, merge, or web-authority action.

## Decision

Implement a typed ephemeral context manager above the existing native CDP pipe.
The durable A2 profile remains the on-disk browser boundary. Each non-default
logical context maps to one Chromium `BrowserContext` for exactly one browser
process incarnation. Contexts are never silently recreated after process loss.

The external surface is intentionally narrow:

- `context.create({ profileId, contextId? })`
- `context.list({ profileId, includeRetired? })`
- `context.close({ profileId, contextId })`
- `target.create` gains only an optional logical `contextId`, defaulting to
  `default`.

No RPC parameter can select a proxy, bypass list, universal-network-access
origin, engine context identifier, executable, browser flag, sandbox policy,
or raw CDP method.

## Primary-source findings

### Chromium DevTools Protocol

The Target domain defines `Target.createBrowserContext` as an empty context
similar to an incognito profile and permits more than one. The command returns
an engine-owned `browserContextId`. `Target.createTarget` accepts that ID, and
`Target.disposeBrowserContext` deletes the context and closes its pages without
running `beforeunload`.

`createBrowserContext` also exposes experimental `proxyServer`,
`proxyBypassList`, and `originsWithUniversalNetworkAccess` parameters. Those
materially broaden authority and must not cross the trusted runtime boundary.
The runtime sends exactly `{ disposeOnDetach: true }`.

Source: <https://chromedevtools.github.io/devtools-protocol/tot/Target/>

### WebDriver BiDi user contexts

BiDi models a user context as a distinct storage partition. The default user
context has the stable identifier `default` and cannot be removed. Removing a
non-default context closes its top-level traversables without unload prompts.
This supports A2's logical `default` context and explicit non-default lifecycle,
while A2 deliberately adds a stricter guard: a context with live logical
targets must be drained explicitly before close.

Source: <https://www.w3.org/TR/webdriver-bidi/>

### Playwright isolation model

Playwright's browser contexts are independent, incognito-like sessions; its
non-persistent contexts do not write browsing data to disk. This is the closest
high-level analogue to B2, but A2 adds durable logical identity, exact browser
incarnation binding, pre-effect intent records, and fail-closed ambiguity.

Source: <https://playwright.dev/docs/browser-contexts>

### Chromium lifecycle concurrency

A recent Chromium fix addresses a use-after-free while contexts could be
destroyed during iteration. It is additional evidence for serialized context
lifecycle at the A2 broker boundary, rather than concurrent create/dispose
against mutable engine state.

Source: <https://chromium.googlesource.com/chromium/src/+/7aafca3e8c40a59540cd2bbc4dc7af446024d0a8^!/>

## Invariants

1. `profile_id + context_id + context_epoch` is durable logical identity.
2. `browserContextId + process_incarnation_id` is ephemeral engine identity.
3. The default context is synthesized, always logical, and never disposable.
4. A non-default binding is valid only for the exact running incarnation.
5. Restart marks non-default contexts from an older incarnation `LOST`; it
   never replays context creation or target creation.
6. `PREPARING` and `CLOSING` are persisted before the corresponding CDP effect.
7. An ambiguous create/close stays recovery-required and cannot blind-retry.
8. Context close is rejected before CDP if it owns any non-retired target.
9. A target record carries its logical `context_id`; engine IDs are never
   exposed through RPC or persisted as durable identity.
10. RPC frames remain sequential and the runtime exposes no raw CDP.

## Recovery state machine

`PREPARING -> ACTIVE -> CLOSING -> RETIRED`

Process loss converts an `ACTIVE` non-default context to `LOST`. `PREPARING`
and `CLOSING` remain ambiguous recovery states because the CDP effect may have
occurred before the transport failed. Reusing a `LOST` or `RETIRED` logical ID
requires an explicit `context.create` and increments `context_epoch`.

## Why not silent restoration

An ephemeral context may contain authenticated or otherwise security-relevant
state. Recreating only the container after a crash would look healthy while its
storage and targets were gone. Replaying targets would introduce duplicate or
misdirected effects. `LOST` makes that boundary observable and forces the
supervisor to choose recovery explicitly.

## Verification matrix

- exact RPC method/effect surface
- forbidden authority-broadening parameter absence
- default-context close rejection
- pre-effect create/close intent persistence
- ambiguity blocks retry
- live-target close guard before CDP
- target-to-context binding and persistence
- crash/restart invalidates bindings and records `LOST`
- explicit reuse increments epoch
- real Chromium create target in context, close target, dispose context

