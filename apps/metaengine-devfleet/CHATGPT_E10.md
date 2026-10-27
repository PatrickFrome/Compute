# E10 — ordinary ChatGPT instead of API

The Education entrypoint now hard-disables OpenAI API credential loading, generation and configuration. Old encrypted key bytes and source key files are not deleted. The old topic history, lesson edits/modules, notes and Undo remain local. Other standalone DevFleet modes are not modified.

## User flow
- Open a lesson. The bottom panel follows the selected lesson without a model request.
- Use ordinary ChatGPT in the system browser (normal subscription/account) or explicitly open its actual website in the lower lesson/chat region. Embedded Google authorization is still not supported; regular-browser login does not transfer cookies into Electron.
- The requested model is **GPT-6 → Pro**, chosen using ChatGPT's own model controls. A prompt, URL or stored preference does not prove that selection. The app deliberately reports it as unverified, never silently substituting an API model.
- Copy/open assembles current lesson and question, with notebook text only when selected. It copies but does not auto-send. This is not a fabricated delivered message or fabricated answer.
- Save an actual canonical `https://chatgpt.com/c/...` conversation URL for each topic. Links survive restart and cannot silently cross-bind to two topics. Native views reuse their existing owned tab; failed/ambiguous creation is not automatically retried.

## Explicit limitations
Ordinary ChatGPT cannot update a local lesson solely because its website is open. No automatic transcript extraction, OAuth/cookie copying, model spoofing, API fallback or new remote edit server is implemented here. The proposed automatic bridge could not be connected in this session. Dynamic page editing from these regular conversations is **NOT CONNECTED**; existing page content and module editor/history are preserved. A supported separately connected app/tool route and verified permissions would be required for that extension.

## Verification
`npm test` includes URL/ownership isolation, persistent bindings, disk-failure fencing and explicit API-disabled integration checks. `smoke:education-webchat` uses real Electron, production stores/IPC, fake external opener/clipboard and zero provider calls. It verifies API remains disabled even with an old configuration, that the stored key fixture is untouched, browser handoff, per-topic URLs, native view reuse and default-hidden drawer. It does not verify actual ChatGPT login, a live model choice, successful message delivery or real generated content.
