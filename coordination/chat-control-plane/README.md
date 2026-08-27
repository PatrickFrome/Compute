# METAENGINE A2 Chat Bridge v0.5

Browser bridge for two long-lived project chats:

- GPT: one exact `https://chatgpt.com/c/...` conversation.
- GLM: `https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db` by default.

## Default architecture: remote-first

v0.5 no longer requires a local Node.js daemon or `START_A2_BRIDGE_WINDOWS.cmd` for normal operation.

1. **Chrome extension** (`extension/`) reads live DOM state, keeps a local restart-safe Send journal, writes an exact continuation prompt into the exact pinned composer, and invokes the real visible **Send** button.
2. **Supabase Edge Function** (`supabase/functions/a2-chat-bridge-remote/index.ts`) is the always-on scheduler/API at:

   `https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-chat-bridge-remote`

3. The Edge Function reads the current A2 mailbox, macroblock and peer-relay contracts using the existing project RPCs. It applies the SAME_POINT visibility fence, identifies an eligible stalled peer and returns a bounded command.
4. Full browser snapshots are supplied transiently in the request that calculates the command. Persistent remote runtime state contains only hashes, counts, booleans and command/result metadata. Raw DOM/chat text and raw prompts are not columns in the remote runtime tables.

The browser transport is never project authority. All remote commands use `WEB_CHAT_INTERACTIVE_REMOTE` and `authority_effect=false`. A2 hard gates, claims, directives, pair-seal visibility and persisted project verification remain authoritative.

## Remote security boundary

- The Supabase backend credential exists only inside the Supabase Edge Function runtime. It never enters Chrome, Git, prompts or browser storage.
- The extension authenticates with a separate high-entropy **scoped pairing token**. Production stores only its SHA-256 in `compute_fabric_a2_chat_bridge_remote_pairing_h205f22`.
- The repository version of `extension/bootstrap-config.js` deliberately contains an empty pairing token. Personalized release ZIPs may inject a scoped token only during packaging; that token is not committed to Git.
- Extension storage is restricted to `TRUSTED_CONTEXTS`, so page content scripts cannot read the pairing token or durable Send journal.
- Incognito execution is disabled.
- Host permission is limited to ChatGPT, `chat.z.ai`, the exact METAENGINE Supabase project origin and loopback fallback origins. The auth wrapper signs only loopback requests or the exact remote bridge path.
- Remote runtime tables have RLS enabled, direct grants revoked from `public`, `anon` and `authenticated`, plus explicit deny policies for browser roles. Only the server-side `service_role` principal can operate them.
- The global extension badge remains a manual kill switch. `OFF` means no real composer write or Send click can execute. v0.5 never auto-arms itself.
- If A2 reports `pending_payloads_exposed != true`, other-peer DOM text is redacted from the generated prompt.
- Current-main filtering learns only explicit `current_main_sha` / `main_sha` evidence. Historical `base_github_sha` is used only as relay ancestry to compare against the learned current main; it is never accepted as the current-main source.

## Remote persistent state

Applied migrations:

- `20260825213000_a2_chat_bridge_remote_runtime_v1.sql`
- `20260825215000_a2_chat_bridge_remote_runtime_rls_deny_v1.sql`

Tables:

- `compute_fabric_a2_chat_bridge_remote_pairing_h205f22` — pairing-token hashes and lifecycle timestamps.
- `compute_fabric_a2_chat_bridge_remote_peer_h205f22` — assistant/target URL hashes, message count and generating/composer metadata.
- `compute_fabric_a2_chat_bridge_remote_command_h205f22` — command/idempotency/prompt hashes, target/A2 lineage and result metadata.

The command table enforces `authority_effect=false` with a database check constraint. Raw prompts, raw chat text, cookies, browser tokens and Supabase backend credentials are not persisted there.

## Install / upgrade the extension

A repository CI artifact is generic and has an empty pairing token. A personalized release bundle can carry a scoped remote pairing token in `bootstrap-config.js` so the user does not have to enter backend credentials or run any local process.

For a personalized v0.5 bundle:

1. Keep the intended ChatGPT conversation and the pinned Z.AI conversation open.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Replace/reload the unpacked extension from the v0.5 directory whose root contains `manifest.json`.
4. On install/update, if exactly one ChatGPT `/c/...` conversation is open, v0.5 binds it automatically. If zero or multiple ChatGPT conversations are open, it stays fail-closed until an exact chat is selected in **Extension options**.
5. The Z.AI project conversation is preconfigured.
6. Click the extension toolbar icon only when ready for real sends. Badge `ON` arms the Send path; badge `OFF` keeps observation/polling non-mutating.

No local daemon, Node.js, PowerShell, Windows DPAPI, localhost dashboard or Supabase backend key is required for the normal v0.5 remote path.

## Runtime behavior

The extension obtains fresh DOM snapshots on meaningful mutations and periodic pulls. It also sends the latest two snapshot envelopes transiently with `POST /v1/commands/next`.

The remote scheduler can issue a command only when the target peer:

- has a fresh snapshot;
- is not generating;
- has a visible composer;
- has an empty composer;
- has stopped making visible progress for the idle threshold;
- has no active unexpired command lease;
- is permitted by the current blind/reveal A2 relay state.

Before returning a command, the Edge Function builds a deterministic idempotency key from the target platform, last assistant hash, message count, A2 head and pending duel. Only `prompt_sha256` and command metadata are persisted; the returned prompt itself exists only in request/response memory.

The extension validates the exact target URL again before sending. The content script resolves a composer/Send pair fail-closed, writes the prompt, invokes `sendButton.click()`, and reports verification strength. Strong `SENT_AND_DOM_VERIFIED` results are written into the trusted extension-side durable journal **before** the network acknowledgement, so an Edge Function retry/restart cannot cause a second real Send for the same idempotency key.

## Live acceptance evidence

The deployed Edge Function is version 2. Server-to-server canaries from the project database verified:

- authenticated `/v1/status` → HTTP 200;
- missing pairing token → HTTP 401 `bridge_pairing_required`;
- A2 readback online;
- `current_main_sha=acc7d60e09bc110f9cf1301532497d680e4510d1`, matching the actual GitHub `main` at the acceptance point;
- transient `POST /v1/commands/next` with both peers marked `generating=true` → HTTP 200 with `command=null`;
- peer-state persistence contains only hashes/counts/booleans;
- canary peer rows and canary pairing tokens were removed after the test.

## Receipt persistence remains separate and OFF

The older prepared bridge-receipt migration `20260825050000_a2_chat_bridge_receipts_v1.sql` is **not** applied to production by the remote runtime work. Remote scheduler metadata is not a substitute for the prepared receipt contract.

The local fallback still supports `A2_BRIDGE_RECEIPTS_MODE=OFF|BEST_EFFORT|REQUIRED`, but normal v0.5 remote operation does not enable receipt persistence and never promotes browser transport into project authority.

## Local fallback only

`daemon/secure-entry.mjs`, the localhost dashboard, `START_A2_BRIDGE_WINDOWS.cmd` and `start-windows.ps1` remain in the repository as an optional fallback/test surface. Direct `daemon/run.mjs` execution still fails closed unless `A2_BRIDGE_INTERNAL=1`; normal users should not set that flag.

If the remote bridge is unavailable and an operator deliberately chooses loopback mode, use `secure-entry.mjs` so localhost pairing is enforced. The Windows launcher keeps receipt persistence forced to `OFF`.

## CI / contract gates

The `Chat Control Plane Contract` workflow verifies:

- Chrome MV3 v0.5 manifest and bundle root layout;
- repository bootstrap has no pairing secret;
- exact remote endpoint scoping;
- trusted-only pairing storage;
- transient remote snapshot POST path;
- remote Edge Function non-authority/static persistence contract;
- explicit browser-role RLS deny policies;
- current-main learning excludes historical `base_github_sha`;
- full DOM readback and exact Z.AI pin;
- real visible Send `.click()` path and ambiguity fail-closed behavior;
- restart-safe command/idempotency fences, including remote Edge Function base-path preservation;
- A2 blind visibility behavior;
- prepared receipt contract tests remain green without applying its DDL.

A final real-browser acceptance still requires Chrome itself to load/reload the unpacked extension and, before any real send is allowed, a user gesture to change the badge from `OFF` to `ON`. CI or a cloud backend cannot truthfully replace Chrome's local extension installation/security boundary.
