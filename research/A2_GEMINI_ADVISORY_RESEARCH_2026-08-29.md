# A2 Gemini Pro advisory UI research — 2026-08-29

Status: **PREPARE_ONLY**. `authority_effect=false`.

## Goal

Prepare the installed A2 Browser Operator codebase to observe a signed-in `gemini.google.com` session as an additional advisory peer without granting Gemini command dispatch, browser authority, or any database mutation rights.

## Current web findings

Fresh public implementations observed in late August 2026 converge on these Gemini web UI hooks:

- composer: `div.ql-editor`, `rich-textarea [contenteditable="true"]`, prompt-labelled textbox fallbacks;
- user turns: `user-query`, `.query-text`, `.user-query`;
- assistant turns: `model-response`, `message-content`, `.model-response-text`, `.response-content`;
- generation: `aria-busy=true` and semantically labelled Stop controls;
- send controls are commonly exposed through accessible `Send message` labels.

A recent independent bug report also shows that `Input.insertText` or a synthetic input event may update Gemini DOM without activating the framework's send state. Real keyboard input or an accepted paste path is therefore required before any future trusted actuation path can be considered verified.

## Architecture decision

This slice implements **observation only**:

1. Manifest gets the minimum `https://gemini.google.com/*` host permission.
2. A Gemini-specific content observer extracts composer/messages/generation state and strong hashes.
3. A background bridge validates the sender tab origin and stores the snapshot only in trusted extension storage.
4. Existing ChatGPT/GLM command ordering and remote dispatch remain untouched and continue to reject unsupported platforms.
5. No `trusted-gemini` transport is introduced.
6. No Supabase platform constraint is changed or applied.

## Promotion requirements

Before Gemini can become a real UI peer:

- run the observer against the user's signed-in Gemini Pro page;
- verify selectors and message-count stability with readback;
- implement trusted keyboard actuation through the Debugger Broker, not synthetic DOM injection;
- add point-of-no-return receipts and post-send verification;
- extend remote command/platform contracts in a separate migration only after supervisor authorization;
- preserve `authority_effect=false` for peer reasoning unless a later explicit authority design says otherwise.

This document is research/provenance, not live evidence.
