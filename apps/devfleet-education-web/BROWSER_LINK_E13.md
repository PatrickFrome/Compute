# E13 — ordinary ChatGPT conversations beside lessons

## Scope
Website and optional browser companion only. No Electron/desktop application files, processes, credentials, profiles or PostgreSQL are changed. The E12 light lesson/notebook UI and IndexedDB journal remain unchanged in format. No OpenAI API client is introduced.

## Architecture
The official OpenAI sidebar has no documented website-controlled conversation-switch method. This implementation instead uses Chrome's native Split View (`tabs.createSplit` / `tabs.unsplit`, Chrome 155+) to place two actual top-level pages side by side: the Education site and a ChatGPT page in the user's normal browser account. This companion is our own extension, not an OpenAI extension. It does not frame ChatGPT or remove browser security headers.

The site asks for pairing only after an explicit click. Each source site tab owns a separate ChatGPT tab per lesson. A different topic selects another owned tab; it never overwrites one conversation by navigating its tab to a different topic. Returning to a topic reuses the previous tab. Closing an owned chat tab does not erase its saved conversation URL; reopening uses that saved URL. Up to 24 live chat tabs are supported per source site tab, with persistent mappings for all 120 topics.

A root ChatGPT tab is not claimed to be a persisted conversation. The first observed canonical `https://chatgpt.com/c/...` URL is recorded to its topic. If an already observed chat is manually changed to another conversation or a new blank chat, pairing is suspended for that tab instead of silently relabelling it. The user can close that tab and reopen the original bound conversation. Duplicate cross-topic URL bindings are refused. Uncertain tab-creation outcomes are persisted as unknown and never blindly retried. Rapid selection is serialized and fenced by the latest requested topic. Unrelated split views are not dismantled.

## Privacy and permissions
The extension has only storage permission and host access to the Education origin and ChatGPT origin for URL metadata. Its only content script runs on Education. It has no cookie, debugger, scripting, broad tabs-reading, network interception, credential, transcript-reading or API permission. It never types or sends prompts, reads answers, selects a model or edits lesson content. Chat model selection remains user-controlled and explicitly unverified. Login and payment are never automated.

The app's existing explicit Copy action still assembles lesson text and optional notebook content. This text is copied locally by the website, not passed to the extension. The user pastes/sends it in the genuine ChatGPT page. URL mappings in site/extension storage are navigation records, not proof that a reply was generated or a model chosen.

## Installation
Download the generated `/downloads/education-chat-link.zip`, unpack to a permanent folder, visit `chrome://extensions`, enable Developer Mode, load the unpacked folder, then reload Education. Press `Подключить рядом`, sign into ChatGPT yourself, and select the required available model. Developer Mode/unpacked installation is needed because this extension has not been published/reviewed in the Chrome Web Store. No enterprise policy or hidden browser-profile modification is used.

## Verification
- Node regression suite: 44 passing tests, including isolation, explicit enablement, URL validation, binding persistence, uncertain-create no-retry, unsupported-browser refusal, unrelated-tab protection and permission checks.
- `scripts/pair-browser-smoke.mjs` uses real native Chrome 156 Split View with disposable test profile and explicit local fixture chats. It verifies two-topic switching and return, native split IDs, reuse, persistent URL bindings and disconnect without closing tabs. No real ChatGPT request or user account is used.
- `scripts/pair-relay-smoke.mjs` exercises the actual site, trusted pointer events, isolated content relay and production worker using an explicit fixture adapter for chat navigation. Its native Chrome 156 receipt is PASS: real trusted button events, website-to-content-to-worker requests, two-topic switching and return, no duplicate tabs, and disconnect. Synthetic untrusted clicks are refused. The fixture adapter means no real account or ChatGPT response is claimed.
- E12 light browser regression remains available; it covers notes/drafts, responsive layouts and offline reading.

## Remaining boundaries
Real user login, GPT-6 Pro selection and a persisted ordinary account conversation are not tested by fixtures. The companion cannot guarantee model availability. It does not provide live GPT-to-lesson editing or notebook synchronization. It requires desktop Chrome's Split View; a narrow/mobile browser can still use the existing external-chat flow. An account change can make saved URLs inaccessible because account identities are intentionally not read.

Primary references checked during implementation:
https://developer.chrome.com/docs/extensions/reference/api/tabs
https://developer.chrome.com/docs/extensions/reference/api/storage
https://developer.chrome.com/docs/extensions/develop/concepts/messaging
https://learn.chatgpt.com/docs/chrome-extension
