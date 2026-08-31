# DBR1 Workspace Manager Dependency Plan

Status: branch-local planning checkpoint only  
Roadmap: `metaengine-development-browser-os-v1` / `DBR1_WORKSPACE_MANAGER`  
Task: `44dc7e4f-35a6-4259-b021-21f61f5a0316`  
Planner: `agent_51d8cebc-c716-493a-8f66-abcd9a8fb802`  
Requested base: `ebb5963a376fa5d8bb53a345457d298594d7b590`  
Target branch: `work/devbrowser-workspace-plan-v1`  
Authority effect: false

## 1. Source-of-truth checkpoint

### GitHub

- Requested base exists and is the exact head of `work/c5-browser-fleet-composition-v1`.
- The base commit is `ci(c5): gate restricted browser fleet composition`.
- Exact-head C5 evidence is now terminal GREEN for:
  - C5 Browser Fleet Composition `33393862596`;
  - METAENGINE Browser Self Update E2E `33393862342`;
  - METAENGINE Browser Shell V1 `33393862365`.
- C5 composition intentionally exposes only lifecycle operations plus trusted `promoteAgentFromLiveBrowser({agent_id})`; it does not expose raw `FleetProvisioner`, proof input, eval, arbitrary execution, or worker/browser authority.
- `work/devbrowser-roadmap-v1` at `9a82c20a574a37e12ebd3e8d15d894eb2f1b5d96` defines DBR1 as the first post-C5 mutation boundary and requires exact identity:
  `workspace_id + repo + base_sha + branch + worktree + agent_id + task_id + lease_generation`.

### Supabase

The current durable fleet scheduler already owns task/claim leasing. `devos_fleet_lease_v1` binds a claim to:

`workspace_id + task_id + point_id + base_sha + role + claim_class + agent_id + tab_id + target_id + agent_generation_epoch + lease_generation + lease_expires_at`.

`devos_fleet_mark_running_v1` and `devos_fleet_complete_v1` reject any stale or mismatched task/agent/tab/target/agent-generation/lease-generation tuple. Expired LEASED/RUNNING tasks become `AMBIGUOUS` with `LEASE_EXPIRED_EFFECT_UNKNOWN`; `devos_fleet_reconcile_v1` requeues zero tasks and explicitly keeps automatic retry disabled.

Current planner task is durable `RUNNING`, lease generation `1`, on coordination workspace `2de9f84b-7c0a-4091-911c-894ff1d6eaf4`, exact base `ebb5963a376fa5d8bb53a345457d298594d7b590` and target branch `work/devbrowser-workspace-plan-v1`.

Important drift: `devos_roadmap_assert_alignment_v1('DBR1_WORKSPACE_MANAGER', requested_base)` currently raises `DEVOS_BASE_SHA_DRIFT`. `devos_roadmap_contract_v1()` is still the parent `metaengine-development-os-v1` contract with active milestone `DEVOS_IDE_V1` and baseline `84a71aa...`; the newer Development Browser OS roadmap exists in GitHub branch-local evidence but is not yet registered as the Supabase roadmap contract. This is a canonical-admission blocker, not a reason to weaken the fence.

The existing `compute_fabric_a2_workspace_h205f22` row used by DevOS coordination is a shared semantic workspace rooted at an older semantic base (`0d6bfd3...`). It is not a per-agent filesystem/worktree identity and MUST NOT be repurposed as the DBR1 mutation workspace.

## 2. Non-negotiable architecture decisions

1. **No second scheduler.** Workspace Manager consumes an already-issued `devos_fleet` mutating claim. It never leases tasks, owns no timeout loop, and has no autonomous requeue policy.
2. **Two workspace namespaces.** Existing `devos_fleet_task.workspace_id` is the durable coordination namespace (`coordination_workspace_id`). DBR1 introduces a per-mutating-agent `workspace_id`/workspace instance for the physical repository worktree.
3. **One mutating agent -> one active mutation workspace globally.** An agent cannot hold two active DBR1 workspaces, even across coordination workspaces.
4. **One branch/worktree -> one active workspace.** Branch and physical worktree identity are exclusive while a workspace is active or ambiguity-held.
5. **Exact base is immutable.** `base_sha` is the immutable creation anchor. Later branch HEAD movement is allowed only through authorized workspace operations and must remain on the recorded lineage.
6. **No renderer/page/model path authority.** Renderer/page/model/worker text may carry a `workspace_id` but cannot supply or override repo root, worktree path, gitdir, branch, base, claim identity or capability.
7. **Typed process invocation only.** Git operations use executable + argv + pinned cwd; never shell strings, eval, `executeJavaScript`, repository-provided hooks as authority, or arbitrary command templates.
8. **Ambiguity freezes.** Any crash after a potentially effective Git/filesystem mutation enters an ambiguity/frozen state and is resolved by read-only inspection; the mutation is never blindly replayed.
9. **Cleanup is fail-closed.** Cleanup cannot proceed while any task/claim, sandbox, candidate capsule, CI run, dirty state, branch ambiguity or unresolved effect references the workspace.
10. **Automatic branch deletion is out of DBR1.** Safe worktree removal may be automated after all fences pass; branch retention is evidence-preserving by default.

## 3. Exact identity model

### 3.1 Trusted claim binding

`MutationClaimBindingV1`

- `coordination_workspace_id: uuid`
- `task_id: uuid`
- `claim_id: bigint`
- `point_id: text`
- `claim_class: 'MUTATING'`
- `repo_id: canonical identifier`, initially `github:PatrickFrome/Compute`
- `base_sha: sha40`
- `branch_name: exact task branch`
- `agent_id: text`
- `tab_id: text`
- `target_id: text`
- `agent_generation_epoch: bigint`
- `lease_generation: bigint`
- `lease_expires_at: timestamptz`

The binding is accepted only when the durable task and active claim agree on every field and the live C5 Browser fleet reports the same ACTIVE agent/tab/target/generation incarnation.

### 3.2 Repository binding

`RepoBindingV1`

- `repo_id`
- `repo_remote_identity` (canonical normalized remote, not renderer supplied)
- `repo_root_id` (configured trusted root identity)
- `repo_root_realpath_sha256`
- `base_sha`
- `base_object_verified: true`

A repository is rejected if the configured repo identity, resolved realpath, Git common directory or remote identity does not match the trusted registry.

### 3.3 Worktree binding

`WorkspaceBindingV1`

- `workspace_id: uuid` — never reused
- `workspace_generation: bigint` — local lifecycle incarnation, not a scheduler lease
- full `MutationClaimBindingV1`
- full immutable `RepoBindingV1`
- `worktree_id: uuid` — never reused
- `branch_name`
- `relative_worktree_path` under a configured workspace root
- `worktree_realpath_sha256`
- `gitdir_realpath_sha256`
- `git_common_dir_realpath_sha256`
- `initial_head_sha` — must equal `base_sha`
- `last_verified_head_sha`
- `state`
- `ambiguity_code`
- `dirty_hold: boolean`
- `created_at`, `updated_at`
- `authority_effect: false`

The exact mutable capability tuple is therefore:

`workspace_id + workspace_generation + repo_id + base_sha + branch_name + worktree_id + worktree fingerprint + task_id + claim_id + agent_id + tab_id + target_id + agent_generation_epoch + lease_generation`.

## 4. Branch/worktree allocation rules

1. Advisory claims do not receive mutation worktrees.
2. MUTATING tasks without an explicit `branch_name` fail closed; DBR1 does not invent a branch at allocation time.
3. Before allocation, verify the exact `base_sha` object exists in the trusted repository and matches the durable task/claim.
4. Worktree paths are manager-derived under a configured root. User/model/repository text cannot choose an absolute path.
5. Resolve `realpath` and reject any symlink/junction/path traversal that escapes the managed workspace root.
6. Verify `git_common_dir` points to the registered repository.
7. If the branch does not exist, create it from exactly `base_sha` without force/reset behavior.
8. If the branch exists, rehydrate only when a durable binding proves it belongs to the same workspace incarnation and Git fingerprints match. Otherwise return `BRANCH_ALREADY_BOUND_OR_DRIFTED`.
9. Reject a branch already checked out by another active worktree.
10. Never use `checkout -B`, `reset --hard` or forced ref movement as allocation recovery.
11. Concurrent reservations for the same agent, branch, task or physical worktree are resolved by durable uniqueness/CAS; exactly one may become READY.

## 5. Persistence and interfaces

DBR1 should add a durable **binding registry**, not a scheduler. Recommended table family: `destruktion_meta.devos_workspace_binding_h205f22` with SECURITY DEFINER RPCs exposed from `public`.

Required uniqueness while nonterminal:

- unique active `agent_id`;
- unique active `(repo_id, branch_name)`;
- unique active `(repo_id, worktree_realpath_sha256)`;
- unique active `task_id`;
- unique `(task_id, lease_generation)` allocation result;
- immutable `base_sha`, task/claim and agent-incarnation fields after reservation.

Recommended typed RPC seams:

- `devos_workspace_reserve_v1(task, agent, lease_generation, tab, target, agent_epoch)`
  - reads existing task/claim under lock;
  - requires `claim_class=MUTATING`, current lease, exact tuple, explicit branch;
  - creates/returns idempotent RESERVED binding for exactly that lease generation;
  - owns no timer and does not renew the task lease.
- `devos_workspace_activate_v1(workspace_id, workspace_generation, local_attestation)`
  - CAS from MATERIALIZING/RESERVED to READY after local worktree fingerprints and initial HEAD are proven.
- `devos_workspace_freeze_v1(...)`
  - records drift/lease loss/ambiguous local effect; no retry side effect.
- `devos_workspace_release_v1(...)`
  - allowed only after terminal/releasable task evidence; transitions to QUIESCENT/CLEANUP_BLOCKED.
- `devos_workspace_mark_cleaned_v1(...)`
  - tombstones only after local removal and reference checks prove cleanup safe.
- `devos_workspace_snapshot_v1(...)`
  - read-only compact metadata; no repository content or prompt/page text.

Local Development Plane interfaces:

- `reserveMutationWorkspace(claimBinding)`
- `materializeReservedWorkspace(workspaceReservation)`
- `reconcileWorkspaceOnce(workspaceId)` — startup/recovery inspection only; not a polling scheduler
- `assertMutableWorkspace(context)` — called before every save/edit/git/PTY mutation
- `freezeWorkspace(context, reason)`
- `evaluateCleanup(workspaceId, references)`
- `removeWorkspace(workspaceId, exactExpectedFingerprint)`

## 6. Lifecycle

`RESERVED -> MATERIALIZING -> READY -> FROZEN | QUIESCENT -> CLEANUP_BLOCKED | CLEANUP_READY -> CLEANED`

Additional terminal-hold states/codes may be represented as FROZEN reasons rather than creating retry semantics.

### RESERVED
Durable exact task/claim/agent binding exists. No filesystem effect has occurred.

### MATERIALIZING
The manager has committed intent before invoking the typed Git worktree operation. If the process dies here, restart performs read-only discovery first. It never repeats `worktree add` until absence/non-effect is positively proven.

### READY
Exact repository, branch, base, worktree fingerprints and current durable lease are proven. Only READY can mint a local mutable capability.

### FROZEN
Entered on expired/stale lease, agent incarnation drift, tab/target drift, branch drift, repo drift, ambiguous local effect, dirty unexpected state or durable task ambiguity. FROZEN is read-only evidence; no automatic mutation or cleanup.

### QUIESCENT
Task is terminal/releasable and claim is no longer active. Mutation capability is revoked.

### CLEANUP_BLOCKED
At least one reference or dirty/ambiguity hold exists.

### CLEANUP_READY
All references are absent; task/claim terminal evidence is exact; worktree identity still matches; worktree is clean or explicitly preserved by accepted evidence policy.

### CLEANED
Physical worktree removal was positively observed and exact binding tombstoned. Workspace/worktree IDs remain permanently non-reusable. Branch is retained unless a later independent retention policy removes it.

## 7. Lease and drift behavior

- Workspace lifetime follows the existing task lease; DBR1 has no independent expiry clock.
- Stale `lease_generation` is always fenced even when all other fields match.
- Agent generation, tab and target changes revoke mutation immediately.
- Browser restart invalidates prior C5 transport proof; a DBR1 READY workspace cannot resume mutation until the new ACTIVE C5 incarnation matches the durable claim. If the durable claim still points at the old incarnation, freeze rather than rewrite it.
- External branch ref movement is detected by expected-head/lineage verification. Non-descendant or unexpected ref movement freezes the workspace.
- A reused filesystem path with a different gitdir/common-dir/workspace generation is an identity mismatch, not recovery.

## 8. Cleanup reference fence

Cleanup must reject while any of the following holds:

- active or nonterminal task/claim (`LEASED`, `RUNNING`, `RESULT_READY`, `BLOCKED`, `AMBIGUOUS` or equivalent unresolved state);
- active sandbox/snapshot referencing the workspace;
- candidate capsule/patch/evidence not durably read back;
- CI run or verifier referencing the worktree/commit and not terminal;
- unresolved ambiguous effect;
- dirty worktree without accepted preservation evidence;
- branch/worktree fingerprint drift;
- stale cleanup caller generation;
- another workspace binding references the same physical worktree or branch.

Reference scanning is a verifier invoked by cleanup. It must not become a second periodic scheduler.

## 9. DBR1 -> DBR2 mutable IDE boundary

Read-only Monaco/repository models may exist before DBR1, but mutation must consume an opaque main-process `MutableWorkspaceCapabilityV1` minted only from READY.

The renderer receives virtual workspace/file identifiers, never authoritative host paths. For `repo.save`/edit:

1. resolve `workspace_id` in the main/development plane;
2. re-read/verify durable lease tuple and C5 live incarnation;
3. verify workspace generation + repo/worktree fingerprints + branch lineage;
4. canonicalize the repo-relative path and reject traversal/symlink escape;
5. require an expected prior content/version hash for write CAS;
6. perform the typed write;
7. return deterministic evidence/hash; page/model text remains data only.

PTY is later than this gate. PTY startup additionally binds `process_id/process_generation` to the same READY workspace and derives cwd from `workspace_id`; renderer/model input never supplies an authoritative host cwd. Tree-sitter/LSP planning can proceed, but mutating integration waits for this boundary.

## 10. Acceptance matrix

| ID | Test | Required result |
|---|---|---|
| A01 | requested C5 base exists and C5 exact-head CI is terminal GREEN | PASS before DBR1 implementation admission |
| A02 | roadmap branch says DBR1 depends on C5 and DBR2 mutation depends on DBR1 | PASS |
| A03 | Supabase roadmap alignment rejects current DBR1/base | preserve `DEVOS_BASE_SHA_DRIFT`; do not bypass |
| A04 | advisory claim requests workspace mutation | reject; no worktree |
| A05 | MUTATING task has no explicit branch | reject before filesystem effect |
| A06 | task base != claim base or requested base | reject |
| A07 | repo remote/common-dir/realpath != trusted registry | reject |
| A08 | C5 agent is not ACTIVE with exact tab/target/generation | reject/freeze |
| A09 | stale lease generation with otherwise correct tuple | reject |
| A10 | tab mismatch | reject |
| A11 | target mismatch | reject |
| A12 | agent generation mismatch | reject |
| A13 | expired task lease | freeze; no retry/no cleanup |
| A14 | two concurrent reservations for one agent | exactly one wins; loser fenced |
| A15 | two concurrent reservations for one branch | exactly one wins; loser fenced |
| A16 | branch already checked out by another worktree | reject |
| A17 | new branch creation | initial HEAD exactly equals `base_sha` |
| A18 | existing branch belongs to another/unknown workspace | reject; never force/reset |
| A19 | manager-derived path contains traversal/symlink/junction escape after realpath | reject |
| A20 | worktree resolves to wrong Git common directory | reject/freeze |
| A21 | crash after MATERIALIZING intent but before local effect | read-only reconcile proves absence before any retry |
| A22 | crash after effective `worktree add` but before activation receipt | discover exact worktree and activate only if fingerprints match; no blind replay |
| A23 | same path is reused with different gitdir/workspace generation | reject as incarnation mismatch |
| A24 | external branch force-move/non-descendant HEAD | freeze |
| A25 | browser restart invalidates prior C5 incarnation | mutation revoked until exact current binding is proven; stale claim not rewritten |
| A26 | page/model/worker forges repo/base/branch/path/capability fields | ignored/rejected; no authority effect |
| A27 | arbitrary eval/shell-string interface search | no such API exists |
| A28 | Workspace Manager starts a polling lease/requeue loop | architectural test fails; forbidden second scheduler |
| A29 | cleanup while active claim/task exists | `CLEANUP_BLOCKED` |
| A30 | cleanup while task is AMBIGUOUS/BLOCKED/RESULT_READY | `CLEANUP_BLOCKED` |
| A31 | cleanup while sandbox/candidate/CI reference exists | `CLEANUP_BLOCKED` |
| A32 | cleanup dirty worktree without accepted preservation evidence | `CLEANUP_BLOCKED` |
| A33 | cleanup caller uses stale workspace generation or stale fingerprint | reject |
| A34 | exact terminal, unreferenced, clean worktree cleanup | remove exact worktree, verify absence, tombstone ID, retain branch |
| A35 | restart sees READY binding but local worktree missing | freeze LOST/DRIFT; do not silently recreate |
| A36 | restart sees worktree but durable binding missing/ambiguous | quarantine/read-only; do not adopt by pathname alone |
| A37 | DBR2 save/edit without READY capability | reject |
| A38 | DBR2 read-only model before DBR1 | allowed with typed repo read boundary only |
| A39 | repo save path escapes via `..`, absolute path or symlink | reject |
| A40 | save expected content/version hash mismatches | CAS reject; no overwrite |
| A41 | PTY tries to start without READY workspace | reject |
| A42 | PTY supplies renderer/model cwd instead of workspace-derived cwd | reject |
| A43 | automatic branch deletion as DBR1 cleanup side effect | forbidden |
| A44 | workspace/worktree UUID reused after CLEANED | reject permanently |

## 11. Smallest implementation order

1. **Contract-only slice** — shared types, validators, state machine and negative tests; no Git/DB mutation.
2. **Durable reservation slice** — binding table + exact `devos_fleet` claim-fenced RPCs; no independent expiry/requeue machinery.
3. **Typed Git identity adapter** — repo registry, realpath/common-dir/base/branch/worktree inspection using argv APIs only.
4. **Two-phase materialization** — RESERVED/MATERIALIZING/READY with crash-safe read-only reconciliation and no blind replay.
5. **Mutable capability gate** — local opaque capability + `assertMutableWorkspace` wired ahead of typed repo save/edit.
6. **Fail-closed cleanup** — reference verifier, dirty/ambiguity holds, exact remove + tombstone; branch retention.
7. **DBR2 handoff evidence** — all A01-A44 tests plus proof that renderer/model cannot create a mutable capability.

## 12. Admission blockers / handoff

- **B0 — Supabase roadmap registration drift:** current parent roadmap does not yet recognize DBR1/base. Do not weaken `devos_roadmap_assert_alignment_v1`; supervisor/integrator must reconcile authoritative roadmap registration before DBR1 is declared canonical.
- **B1 — Implementation must stack on exact trusted C5 boundary or a proven descendant:** C5 exact head at this checkpoint is `ebb5963...` and GREEN. If C5 head changes, re-run exact-head comparison/tests; do not assume descendant trust.
- **B2 — Existing A2 semantic workspace is not DBR1 mutation workspace:** introduce a distinct per-agent workspace instance/binding layer and retain `coordination_workspace_id` as parent coordination identity.
- **B3 — No mutable IDE before READY:** Monaco read-only can progress; save/edit/PTY authority cannot.

This checkpoint authorizes no production mutation, no main/integration merge, no task retry, no browser actuation, and no scheduler duplication.