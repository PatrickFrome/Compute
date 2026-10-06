# CHAT_HANDOFF_V1

The handoff exists to let a new short-lived chat resume development without needing the full previous conversation.

Persist it on the active PR/issue whenever practical.

## Required shape

```text
CHAT_HANDOFF_V1

task:
objective:
repo: PatrickFrome/Compute

base_ref:
base_sha:
working_branch:
head_sha:
pr_or_issue:

source_status:
ci_status:

supabase_project:
supabase_authority_summary:
live_runtime_summary:
active_actuation_lease:

changed:
verified:
not_verified:
live_mutations:
ambiguous_effects:

invariants_preserved:
blockers:
next_safe_action:

truth_readback_at:
handoff_created_at:
```

## Rules

### 1. Handoff is not authority

The handoff is a navigation aid. A new chat must refresh all mutable facts before acting.

### 2. Exact identities

Use full Git SHAs where available. Do not use only branch names for source identity.

For live effects include exact client/process/incarnation/lease identities when they are relevant.

### 3. Explicit non-claims

If CI is still running, write `IN_PROGRESS`.

If a package is built but not physically qualified, say so.

If a PR is physically qualified but not production-promoted, record both facts separately.

If no live useful-work proof exists, do not infer it from unit tests, package smoke, or heartbeat.

### 4. Ambiguous effects

Record any ambiguous irreversible effect explicitly. The next chat must reconcile it before attempting another effect.

### 5. Checkpoint cadence

Create/update a handoff when:
- a PR/source head changes materially;
- a live migration/deployment changes;
- an irreversible effect is attempted;
- a qualification matrix reaches a new evidence boundary;
- the current chat is becoming long or unreliable;
- the task is handed to a fresh chat.

Do not create a new file per conversational turn. Prefer one PR/issue thread per development objective.
