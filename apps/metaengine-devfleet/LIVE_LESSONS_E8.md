# E8 — GPT connected to the selected lesson, with reversible page updates

## Delivered behaviour
Selecting any of the 120 material topics switches the in-app tutor to that topic automatically. The displayed lesson, conversation history, draft message, revision number and Undo control follow its immutable `material_id`. Selection is local: it does not generate a response, contact OpenAI or incur usage.

The student submits a question directly inside Education. The official Responses API receives the current version of that one lesson, recent messages from that topic, subject practice counts, and optionally selected topic/linked-tab notebook excerpts. A valid response is displayed in the tutor. If the student enabled page editing, its allowed text changes are applied immediately to the local topic page, saved as a new revision and reflected in the center pane. Other topics do not change, even when the student switches away while a response is pending.

Examples: “Explain voltage more simply and rewrite the example”, “Add an exercise using 9 V and 1 kΩ”, or “Test my understanding without changing the page”. The edit checkbox overrides model behaviour: suggested changes are ignored in discussion-only mode.

## What this does NOT claim
- This is an app-owned API conversation, not a connection to an existing chatgpt.com thread. Google browser sign-in/cookies are not used or transferred.
- No real paid OpenAI generation was performed during this development pass. Electron tests use a deterministic fake API through the production transport and IPC. These tests prove app mechanics, not the quality or availability of a model on the user's account.
- The 120-topic curriculum is retained. This increment does not claim a completed deep-research rewrite of every topic; source checking and per-topic research remain separate work.
- Model-generated educational text is explicitly unverified. The model has no web tool in this implementation. Source links inherited from the original lesson are not proof that new statements were checked.
- The package is a development candidate, not a signed standalone Windows installer. E7 and METAENGINE remain separate.

## First connection
Use the secure OpenAI Platform key-setup flow; never paste a key into a chat message or a lesson. In Education's API settings, specify a model available to the project that supports Responses structured outputs. Accept the separate-API-billing notice, and use the operating-system file picker to import the downloaded key file. A native confirmation explains the data sent and separate charges. No request is made merely by importing a key; the first submitted message tests the connection.

API billing is separate from ChatGPT billing. The current model ID is chosen by the user; there is no guessed or silently substituted default model. Credentials are retained encrypted with Electron `safeStorage` in this Education profile, not in lesson data, renderer state, Git, logs or the clipboard. On Windows this protects against other users, not all software running under the same Windows user. The pinned Electron 44 implementation uses the synchronous safeStorage API; future Electron upgrades must revisit its deprecation. A Linux `basic_text` fallback is refused.

## Persistence and revision rules
- `education-live-state.json`: per-topic messages, request receipts, changed text fields and prior versions; bounded to 20 MiB.
- `education-openai-key.bin`: OS-encrypted imported key, main-process only.
- `education-openai-config.json`: chosen model and explicit billing consent, no key.
- Notebook and practice data remain in the existing Education store. Model responses cannot alter those records.
- Only `theory`, `example`, `exercise`, `check` and `extension` may change. Text is rendered with `textContent`; HTML-shaped output is inert.
- Stable source hashes prevent silently rebasing edited content on a different base lesson. A future base-content migration needs an explicit reviewed migration; mismatches fail closed.
- Each submission has a unique request ID and expected page revision. Replays and stale versions are rejected. Pending requests are not resent after restart; their remote outcome becomes UNKNOWN.
- A disk-save failure fences further mutations until restart/recovery. A response is not presented as committed when local durable storage failed.
- Undo restores prior page text and retains conversation history. It cannot run concurrently with a request on the same topic.

## Data and request bounds
The client uses `https://api.openai.com/v1/responses`, redirects disabled, `store:false`, strict structured text output, no tools, no automatic retries, a 120-second request timeout and a bounded response body. `store:false` is not a claim of zero retention across all provider safety systems. History and notebook excerpts have explicit size limits; this is not unlimited memory. An already submitted request can finish after disconnecting, which is disclosed in the interface.

Provider failures, refusals, incomplete responses and malformed edits do not change page text. Error messages exposed to the renderer are fixed codes rather than raw remote bodies or library exceptions.

## Verification
Run `npm test` for the complete Node suite. Run `npm run smoke:education-live` with the pinned Electron binary installed. The live smoke uses a fresh temporary profile and a synthetic non-credential encrypted by the OS, injects a deterministic API transport, and performs no internet requests. It exercises actual Electron DOM, production IPC authorization, production request serialization, automatic topic selection, a delayed reply after switching topics, preservation of the other topic's draft, page updates, Undo, explicit notebook inclusion, inert HTML-like output, persisted history reopening and disconnect. It also creates a screenshot and a receipt under the system TEMP directory.

The development run passed 22 new Node tests (15 topic/journal and 7 transport tests), in addition to the 148 prior tests. The native smoke passed with two simulated provider responses and zero real API calls. Rerun on the exact source revision before promotion.

## Official implementation references (checked 2026-10-27)
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI billing distinction: https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform
- Electron OS storage semantics: https://www.electronjs.org/docs/latest/api/safe-storage

## Remaining acceptance
Connect a user-authorized API project, choose an available compatible model, and verify one real pedagogical exchange plus one controlled page rewrite. That step may incur API charges and was not performed automatically. Then review educational correctness, current-source citations and the signed installer separately.
