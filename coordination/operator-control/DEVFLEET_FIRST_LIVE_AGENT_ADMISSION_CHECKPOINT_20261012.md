# DevFleet Chat Fleet: first real agent admission checkpoint

Date: 2026-10-12. Status: **BLOCKED ON MODEL SELECTION PROOF**, not dispatched.

## Exact installed identity

- Separate METAENGINE DevFleet **0.1.0-dev.5** installed on authorized Windows host, PID **6156** at last live readback.
- Installed EXE SHA-256: `5BDB6FD6A3FB4BB6CCE9D1D429F045F3414EBA8184E336267809B202F1EA1353`.
- QA NSIS SHA-256: `32B56AB2F048CFCF7E9BB632B50A6AF18DED912D6948F4AD91651CC0EA9AA7E5`, unsigned.
- Source implementation commit: `69ed43c4ab284e9a66718f9de0e8a6893d10e650`.
- Roadmap tasks commit: `981b76925c96970ae8ad2c708b8d68e42e7c3460`.
- Isolated branch: `work/devfleet-model-menu-v5`, draft PR #1187.
- Source suite 27/27 PASS; packaged Electron live-UI hot-swap smoke PASS.
- Private user profile backup: `%APPDATA%\METAENGINE DevFleet Backups\pre-0.1.0-dev.5-20261012`, 720/720 files with exact byte counts and operator-state SHA equality before upgrade.
- Main METAENGINE Browser, Guardian and self-hosted PostgreSQL unaffected. Supabase prohibited.

## Physical first Chat admission

Executed:
`node apps/metaengine-devfleet/scripts/qualify-first-roadmap-chat.mjs --execute`

- Idempotent one-chat create request `devfleet-first-clean-20261012-v5`: `CREATED`
- Exact tab: `tab_655ca932-21a9-47c8-85a8-cd3458e87e31`
- Mode: `CHAT`; input readback `unique_composer=true, unique_send=true, composer_nonempty=false`
- `GPT-6` selected: **NOT PROVEN**
- High selected: **NOT PROVEN** (the native accessibility tree shows a collapsed `High` staticText, which by itself is insufficient to prove the selected model and effort)
- Menu click readback oscillated between `MODEL_PICKER_NOT_UNIQUE` during first-page initialization and `MODEL_MENU_INSPECTED_UNVERIFIED` after page loaded; no uniquely selected GPT-6 option emerged.
- **No Send attempted**. No agent replies or code delivery are claimed.
- Live own-profile state: **10 sessions** (9 previous + 1 new), **2 historical AMBIGUOUS** tasks unchanged, **0 confirmed SENT assignments**. Live UI slot remained ACTIVE generation 4.

The existing seven prepared assignments are located under:
`coordination/operator-control/devfleet-prompts/`
The guarded dispatcher:
`apps/metaengine-devfleet/scripts/dispatch-verified-roadmap.mjs`

Safety rules: GPT sessions must be in **Chat** not Work; no overwriting nonempty drafts; no blind retries of AMBIGUOUS Send; no new hosted DB; do not claim GPT-6 High from prompt text or a generic High label. The native send path now refuses a nonempty composer *before* write-ahead, and tests prove that such refusals create no phantom AMBIGUOUS.

## Next action

1. Obtain real selected-model proof from ChatGPT's multi-level model menu, taking care that page loading and submenu structure may vary by tab. A versioned, host-verified semantic adapter descriptor would avoid further full installer rebuilds for these UI-only lookup changes.
2. Only once GPT-6 High is confirmed in the exact new Chat tab and its composer remains empty, rerun the **same idempotent** qualification, then obtain `SENT` readback and the first independently inspected agent reply.
3. After success, expand the fleet in bounded batches, one agent worktree/branch per task, with deduplicated request IDs and critique/CI evidence.
4. Continue own-PostgreSQL P0/P1 roadmap implementation independently of GPT Chat availability. Never use Supabase.
