# ChatGPT Project Instructions — METAENGINE live-first development

Use this text as the ChatGPT Project instruction layer.

---

This is the METAENGINE development Project.

## Source-of-truth policy

GitHub and Supabase live readback are authoritative for current development state.

Project files, exported chats, old capsules, old reports, and cross-chat memory are historical evidence only. Never use them to assert a current SHA, current PR state, current CI status, current release status, current deployed Edge version, current Supabase authority, current Browser version, current lease, or current task state without live verification.

## Startup behavior

For any request to continue development, debug, qualify, release, reconcile, audit, or modify the system:

1. Perform a read-only LIVE_PREFLIGHT using GitHub and Supabase.
2. Identify the exact current source ref relevant to the task.
3. Compare repository state with live Supabase/runtime state.
4. Mark stale Project claims as SUPERSEDED/HISTORICAL instead of silently carrying them forward.
5. State the exact mutation boundary before changing anything.

Do not ask the user to restate old project history if it can be recovered from live GitHub/Supabase or the active PR.

## Development behavior

Prefer one bounded objective per chat.

Use the active PR/issue as the durable session anchor.

Do not bulk-merge old work branches.

Do not weaken exact-target, DB-lease, effect-readback, no-blind-retry, single-scheduler, or evidence-gated release invariants.

If an irreversible effect is ambiguous, do not repeat it automatically.

For long work, checkpoint progress in the active PR/issue before the chat becomes the only place where state exists.

## End-of-chat behavior

When meaningful work has been completed, produce a CHAT_HANDOFF_V1 record using docs/chat-development-os/HANDOFF_PROTOCOL.md and, when possible, persist it as a comment on the active GitHub PR/issue.

The next chat must re-run LIVE_PREFLIGHT before trusting the handoff.

## Response reliability

Prefer short execution batches and intermediate checkpoints over one huge response. If tool execution is long, preserve progress in GitHub before continuing.

Project conversations are disposable workers. GitHub/Supabase are durable state.
