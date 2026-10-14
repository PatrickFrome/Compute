# W18 — Native DevFleet SPA hydration diagnostics (source candidate)

Scope: read-only developer-authenticated `dev.hydration.inspect {tab_id}` for an **OPEN**, already owned standalone DevFleet WebContents. This is distinct from the existing conversation mount witness and does not start a scheduler, open a tab, select a hidden tab, navigate, reload, reconcile a receipt or submit anything.

## Native sampling contract

- The native in-process adapter binds `process_epoch`, `webcontents:<id>`, `getOSProcessId()`, renderer loss generation and navigation generation **before and after** every bounded CDP observation. Native `render-process-gone` increments renderer generation; navigation events increment navigation generation. A changed ID, renderer PID, generation, URL or ownership map returns `UNKNOWN`. These are app-process-scoped observation IDs, **not an OS process creation-time attestation**.
- Native Electron `isLoading()`, `isLoadingMainFrame()`, `isWaitingForResponse()` and `isCrashed()` are sampled. Missing methods/signals are `UNKNOWN`, not false. In-document `aria-busy` / progress nodes are distinguished from outer-document loading.
- CDP is limited to `Network.enable`, `Network.disable`, `DOM.enable`, `DOM.getDocument` and three fixed `DOM.querySelectorAll` expressions. The observer listens to bounded counts of **up to 128** native network events over a brief, fixed window. It reduces only request starts, failures, blocked requests and HTTP 4xx/5xx buckets. Late/failed CDP readbacks fail closed.
- **No raw URL**, request headers, cookies, tokens, body, resource name, DOM/AX text, prompt, errorText, page JavaScript, `Runtime.evaluate`, `Input`, network replay or Send authority can leave the reducer. Only exact native process/generation identifiers, booleans and bounded diagnostic counters leave it. A sampling error returns `UNKNOWN`.
- `Network.disable` is best-effort scoped cleanup after an enabled window. Concurrent diagnostics on the same target are **not independently qualified**, and extra runtime serialization may be needed if other network-domain consumers are introduced. Treat incomplete native event coverage as `coverage:UNKNOWN`, never claim absence of errors.
- Result state is always `UNKNOWN` for actual hydration/ChatGPT delivery/readiness. More specific `reason` values identify `NATIVE_DOCUMENT_LOADING`, `NATIVE_RESPONSE_WAIT`, `SPA_BUSY_AFTER_DOCUMENT_LOAD`, `CHAT_BODY_UNMOUNTED`, `NETWORK_FAILURE_BUCKET_OBSERVED` and strict identity/coverage failures. A composer or user turn alone is diagnostic, never healthy/completed or SENT.

## Qualification boundary

Source-only tests use fake Electron WebContents and CDP event emitters to falsify PID reuse, renderer/navigation rollover, owner changes during async sampling, malformed counters, origin changes, missing loading signals, CDP failure, privacy leaks, event-budget overflow and forged positive Send flags. These do **not** prove the installed DevFleet v15 executable contains the feature, nor that ChatGPT hydration has recovered. Existing historical AMBIGUOUS receipts stay UNKNOWN and untouched.

This lane is **DRAFT / SOURCE ONLY**. No installed DevFleet, METAENGINE Browser/Guardian, own PostgreSQL, Supabase, production ChatGPT send, or main branch was changed.
