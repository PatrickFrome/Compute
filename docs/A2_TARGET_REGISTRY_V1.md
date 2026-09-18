# A2 TARGET_REGISTRY_V1

Status: R3 implementation contract (code/CI verification; live browser verification deferred).

## Goal

Remove the architectural assumption that a browser target is identified by `CHATGPT`, `GLM_ZAI`, one configured URL, or one Chrome tab ID. The stable address is now `target_id`.

## Identity model

A logical target persists in `chrome.storage.local`:

- `target_id` — stable logical identity.
- `provider` — current provider (`OPENAI`, `ZAI`).
- `platform` — compatibility/runtime surface (`CHATGPT`, `GLM_ZAI`); this is a type/policy attribute, not identity.
- `surface` — `WEB_CHAT`.
- `role` — scheduler-facing logical role.
- `conversation_epoch` — monotonically advances when the conversation URL changes.
- `conversation_url` — exact normalized current conversation URL.
- `status` — `UNBOUND | ACTIVE | IDLE | GENERATING | STALLED | EXHAUSTED | ROLLOVER | RETIRED`.

A physical browser binding persists only in `chrome.storage.session`:

- `target_id`
- `tab_id`
- `conversation_epoch`
- exact `conversation_url`
- per-browser-session nonce
- bind/validation timestamps

`tab_id` is deliberately absent from the persistent logical target record.

## Legacy compatibility

Existing settings remain valid during migration:

- `chatgptUrl` projects into logical target `gpt_primary`, legacy alias `CHATGPT`.
- `zaiUrl` projects into logical target `glm_primary`, legacy alias `GLM_ZAI`.
- changing a legacy URL updates the same logical target and advances its conversation epoch.
- updating the conversation through the registry mirrors the URL back to the legacy setting for old consumers.

This keeps `STRICT_GLM_FIRST_ACTUATED_V1` and current `target_platform` command contracts intact while the scheduler/dispatch layer migrates in R4.

## Safety invariants

1. `target_id != tab_id != conversation_url != platform`.
2. Chrome metadata (`sender.tab`, `chrome.tabs.get/query`) is authoritative for physical binding; DOM/page text has zero binding authority.
3. A live conversation URL may belong to at most one non-retired target.
4. One physical tab may be bound to at most one logical target.
5. Rollover keeps `target_id`, increments `conversation_epoch`, and invalidates the old tab binding.
6. Browser restart destroys all prior tab bindings because they are session-scoped.
7. `CHAT_SNAPSHOT` observation is passive; `runtime-core` remains the sole owner of the existing snapshot response contract.
8. Registry operations do not evaluate arbitrary JavaScript and do not introduce remote selectors or page-derived authority.
9. Existing no-blind-retry and pre-actuation durability invariants remain unchanged.

## Why this shape

Chrome documents that a tab ID is unique only within a browser session, so it cannot be a durable address:
https://developer.chrome.com/docs/extensions/reference/api/tabs

AutoGen uses a logical `AgentId(type, key)` as the address of an agent instance inside a runtime, separating identity from the concrete process/runtime instance:
https://microsoft.github.io/autogen/dev/reference/python/autogen_core.html

Browserbase similarly separates persistent Context IDs from individual browser sessions, a useful analogue for separating logical continuity from ephemeral execution sessions:
https://docs.browserbase.com/platform/browser/core-features/contexts

## R3 acceptance tests

`tests/a2_v070_target_registry_lab.mjs` verifies:

- deterministic legacy target migration;
- multiple GPT targets can coexist;
- duplicate active URL rejection;
- exact live tab resolution and session binding;
- no tab ID in the persistent registry;
- rollover identity preservation and epoch advancement;
- legacy URL compatibility;
- retirement;
- browser-restart persistence of logical identity with loss/recreation of physical binding.

`tests/a2_v070_release_contract_lab.mjs` verifies package/runtime/security invariants.

## Next milestone

R4 should move dispatch and snapshots from platform-addressed records to `target_id` while retaining a compatibility translation boundary for existing `target_platform` commands. Only after that should fleet scheduling create many GPT worker targets dynamically.
