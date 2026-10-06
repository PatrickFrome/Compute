# METAENGINE Chat Development OS

Purpose: make ordinary ChatGPT project chats reliable enough for long-running METAENGINE development without treating a single conversation, Project file, or memory summary as the source of truth.

## Core rule

**Live GitHub + live Supabase are the current source of truth.**

Project chats, exported chats, handoff capsules, uploaded documents, and memory are **historical evidence / retrieval hints only** unless a live readback re-validates the claim.

Do not infer current branch heads, CI state, installed Browser version, roadmap authority, Edge versions, leases, task state, release status, or deployment status from Project files.

## Truth precedence

1. Exact live GitHub refs, PR metadata, CI/workflow evidence, release/package artifacts.
2. Exact live Supabase schema, migrations, Edge functions, rows, authority/readback state.
3. Current repository contracts and tests at the exact source ref being changed.
4. Structured handoff attached to the active PR/issue.
5. Project chats/files/capsules as historical context only.

A lower layer may explain *why* a state exists, but it must not override a conflicting higher layer.

## Session model

Use **one chat = one bounded development objective**.

Good chat scopes:
- one bug / root cause;
- one PR qualification;
- one architecture slice;
- one live reconciliation;
- one release gate;
- one code-review or branch-reconciliation task.

Do not keep a single general development chat alive indefinitely. When a task finishes or the conversation becomes large, write a structured handoff to GitHub and continue in a fresh Project chat.

## Mandatory LIVE_PREFLIGHT

Before any repository, database, deployment, release, Browser, or other authority-bearing mutation:

1. Resolve the current relevant GitHub branch/PR and exact SHA.
2. Resolve terminal/in-progress CI state for that exact SHA.
3. Read current Supabase roadmap/authority metadata relevant to the task.
4. Read current live migrations/Edge/function state when the task touches them.
5. Read current Browser/Supervisor/task/lease state when the task touches live execution.
6. Build an explicit drift table: SOURCE / LIVE / EVIDENCE / STATUS.
7. Classify every old Project-file claim as CURRENT, SUPERSEDED, HISTORICAL, or UNVERIFIED before relying on it.

If live sources are unavailable, fail closed and state exactly which fact cannot be refreshed.

## Mutation discipline

- Never bulk-merge divergent historical branches.
- Never promote a stale handoff SHA just because it appears in a Project file.
- Never repeat an irreversible or non-idempotent effect after an ambiguous outcome without positive NO_EFFECT evidence or a new explicitly authorized generation.
- Keep exact target/incarnation/source identity on every physical or production effect.
- Do not create a second scheduler, hidden retry loop, shadow authority plane, or alternate ledger merely to make chat orchestration easier.
- Prefer read-only audit first; mutate only the smallest justified surface.

## Where state should live

Stable architecture and workflow rules live in this directory.

Current code and implementation state live in GitHub.

Current runtime/control-plane state lives in Supabase and the Browser's durable readback surfaces.

Development-session continuity lives as a structured GitHub PR/issue handoff, not in a giant conversation.

Project files should be minimized. Keep at most a small router/instructions file in the ChatGPT Project; do not upload periodic snapshots as if they were live truth.

See:
- PROJECT_INSTRUCTIONS.md
- HANDOFF_PROTOCOL.md
- LIVE_AUDIT_2026-10-06.md
