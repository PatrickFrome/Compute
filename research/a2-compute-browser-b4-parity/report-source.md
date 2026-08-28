# A2 Compute Browser B4 — Extension / Compute-Browser Parity (research index)

Date: 2026-08-28 (project timezone)
Status: research + architecture plan for `work/a2-compute-browser-b4-parity`.

## What was read (via `git show <ref>:<path>`)

Base branch refs (origin):
- `work/a2-compute-browser-b2-b3` — rpc-server.mjs, chrome-process.mjs, runtime.mjs, security.mjs, protocol-v1.json, package.json, addendum, operator-perception.js, B1/B3 + B2/B3 research.
- `work/a2-compute-browser-b2-contexts` — context-manager.mjs (ProfileContextManager: durable pre-effect intent + reconciliation pattern).
- `work/a2-compute-browser-r4-semantic-perception` — semantic-capture-adapter.mjs, semantic-perception-compiler.mjs (shared), context-manager.mjs, cdp-pipe-client.mjs, R4 research.

Key upstream:
- `coordination/chat-control-plane/A2_COMPUTE_BROWSER_ARCHITECTURE_ADDENDUM_V1.md` (B4 definition + hard invariants).

Existing analogs:
- `research/A2_COMPUTE_BROWSER_B1_B3_DEEP_RESEARCH_2026-08-28.md`
- `research/A2_SEMANTIC_PERCEPTION_R4_DEEP_RESEARCH_2026-08-28.md`
- `research/a2-compute-browser-b2-b3/report-source.md`

## What the plan covers

- B4 definition quoted from the addendum.
- The four contracts: Target (existing), Perception (R4, existing), Action (NEW guarded actuation: navigate/click/type/submit), Receipt (NEW durable lease-bound effect evidence).
- Six fail-closed invariants mapped to concrete code enforcement.
- Code plan: new `browser-shared/action-contract.mjs`, `browser-shared/receipt-contract.mjs`, `browser-compute/src/action-kernel.mjs`, `browser-compute/src/receipt.mjs`; extensions to `protocol-v1.json`, `rpc-server.mjs`, `security.mjs`; extension parity in `chat-control-plane/extension/operator-action.js`.
- Analog comparison vs Playwright / Puppeteer / raw CDP Input domains (no durable receipt, no lease, synchronous in-session effects).
- Implementation sequence + offline/fail-closed/adversarial test list.
- Explicit non-claims (research only; perception authority_effect=false; lease-derived receipt authority only; no secrets).

## Open questions

1. Exact Action Arbiter + Lease minting/revocation protocol (Supervisor-side) — modeled here only as the `LeaseEnvelope` the kernel validates.
2. Whether `submit` should additionally support file-input via `DOM.setFileInputFiles` as a first-class kind, or stay within TYPE.
3. Receipt retention/rotation policy (`receipts.json` growth) for long-lived daemons.
4. Whether extension adapter should also gate on `chrome.debugger` detachment races the same way Compute Browser gates on `process_incarnation_id`.
5. The union base (b2-b3 + b2-contexts + r4-semantic-perception) had merge conflicts in `cli.mjs`, `rpc-server.mjs`, `runtime.mjs`, `contracts.test.mjs`; the base merge is left unresolved in this branch.
