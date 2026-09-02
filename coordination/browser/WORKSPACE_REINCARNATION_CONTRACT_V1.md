# METAENGINE Browser Workspace Reincarnation Contract V1

Status: **SOURCE DESIGN CHECKPOINT — NO RUNTIME/DB AUTHORITY**

Base evidence line: `work/browser-typed-workspaces-v1`.

## Problem

Self-update/session continuity can reconstruct browser tabs and can emit a local `prior_tab_id -> tab_id` relation. That relation is user-session continuity only. It is not sufficient to re-authorize a durable Workspace Binding because:

- restore may match an already-open tab by URL;
- multiple tabs can have the same URL;
- a replacement `WebContents` has a new physical target incarnation;
- Fleet restart intentionally clears stale target/transport proof and advances `generation_epoch`;
- a Workspace Binding is fenced to exact `task_id + agent_id + tab_id + target_id + agent_generation_epoch + lease_generation`;
- FROZEN bindings retain the active agent/branch/worktree/task fences.

Therefore URL, title, page/model content, prior logical tab identity, or a continuity capsule alone **must never authorize Workspace rebind**.

## Smallest safe successor proof

A future DB-native reincarnation transition may be considered only when one trusted transaction can bind all of:

1. Exact predecessor Workspace Binding identity:
   - `binding_id`
   - `workspace_id`
   - `workspace_generation`
   - `coordination_workspace_id`
   - `task_id`
   - `claim_id`
   - `agent_id`
   - predecessor `tab_id`
   - predecessor `target_id`
   - predecessor `agent_generation_epoch`
   - predecessor `lease_generation`
   - exact `branch_name`, `worktree_path`, `base_sha`
2. Exact local successor incarnation proven by the Browser/Fleet trust boundary:
   - successor `tab_id`
   - successor `target_id`
   - successor `agent_generation_epoch`
   - target is a live local WebContents/target at readback time
   - Fleet lifecycle is `BOUND_UNVERIFIED` or stricter source-defined admission state, never inferred from page content
3. Fresh scheduler authority:
   - fresh active `claim_id`
   - fresh `lease_generation`
   - lease is not expired
   - exact task/agent binding remains current
4. Workspace filesystem continuity readback:
   - exact same `branch_name`
   - exact same managed `worktree_path`
   - current verified HEAD equals the expected source-controlled head
   - worktree is not dirty/ambiguous
5. Explicit predecessor/successor relationship:
   - successor generation is exactly `workspace_generation + 1`
   - durable reincarnation receipt is written before the active binding identity changes
   - receipt contains no URL, title, page text, model text, credentials, prompt or executable content

## Required failure semantics

- Any missing predecessor field: `FENCED`.
- Old lease still active but successor identity differs without a transition lease: `FENCED`.
- Successor target not locally proven: `FENCED`.
- Successor Fleet generation does not exactly match: `FENCED`.
- Fresh claim/lease missing or stale: `FENCED`.
- Worktree/branch/HEAD drift: `FROZEN` or equivalent durable hold.
- Ambiguous DB response after transition intent/effect barrier: `AMBIGUOUS`; never repeat transition blindly.
- Duplicate URL/title match: no effect; URL/title have zero authority.

## Scheduler and authority boundaries

The reincarnation transition is not a scheduler and cannot allocate work. It must consume an already-existing fresh DevOS claim/lease and the existing Fleet local-target revalidation path. It cannot create a second polling loop, lease worker tasks, perform Browser actuation, execute shell text, or promote a transport proof.

## Integration order

1. Finish Typed Workspaces V1 read-only projection and physical N→N+1 evidence.
2. Add pure predecessor/successor proof validator and negative tests.
3. Add source-only append-only reincarnation receipt schema/RPC with exact-CAS semantics.
4. Test in disposable database, including stale claim/lease/generation/target/worktree failures and ambiguous commit readback.
5. Only after separately authorized deployment may Browser observe successful successor binding through the existing workspace snapshot path.

## Explicit non-solutions

- rebind by URL;
- rebind by tab title;
- rebind by ChatGPT conversation text;
- rebind by `prior_tab_id -> tab_id` continuity receipt alone;
- overwrite an active binding without predecessor exact-CAS;
- retire FROZEN binding merely to free uniqueness fences;
- create a new scheduler/retry loop for workspace recovery.
