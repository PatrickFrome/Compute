# DBR1 Research Accelerator — 2026-08-31

Status: branch-local evidence checkpoint  
Roadmap: `metaengine-development-browser-os-v1` / `DBR1_WORKSPACE_MANAGER`  
Authority effect: false

## Evidence-backed improvements

### Git worktree identity and cleanup

Current Git documentation recommends `git worktree list --porcelain -z` for stable machine parsing. Linked worktrees have a per-worktree Git directory plus a shared common Git directory; callers must not guess which administrative path is private vs shared. `git worktree add --lock --reason ...` can lock at creation without a race, preventing prune/move/delete until explicitly unlocked.

METAENGINE implications:

1. preflight and activation should use a stable porcelain inventory rather than trusting a caller-supplied worktree path;
2. activation must verify exact worktree path, branch ref and initial HEAD against the DBR1 binding;
3. materialization should eventually use atomic `--lock` when the unlock/remove sequence is separately evidence-gated;
4. cleanup must remain reference/dirty/ambiguity fenced and must not use `--force` as recovery.

### Browser fleet task transport

Live DBR1 evidence showed background ChatGPT worker views reporting zero viewport geometry and `submit_after_type` via Enter ending as `AMBIGUOUS_AFTER_ENTER`. Chromium CDP mouse coordinates are viewport-relative, while Electron documents that input delivery depends on focused contents for its native input API. The reliable sequence observed in Browser was: select exact tab -> revalidate nonzero viewport/exact controls -> type without submit -> typed Send click -> read-only proof of new conversation/generation.

METAENGINE implications:

1. background zero-viewport state must be a pre-effect blocker, not a post-effect ambiguity;
2. fleet dispatch should not press Enter as its first authority-bearing submit primitive;
3. send should be a separately fenced effect after exact foreground/view revalidation;
4. post-send proof must remain URL/generation/control based; response text has zero authority;
5. failed proof remains non-retriable until a separate read-only observation proves NO_EFFECT.

## Expected impact

- eliminates a known source of lease expiry into `LEASE_EXPIRED_EFFECT_UNKNOWN`;
- converts viewport/focus defects from ambiguous post-effects into deterministic pre-effect rejects;
- reduces duplicate work and lost worker capacity;
- strengthens worktree crash recovery and branch/worktree ownership verification;
- adds no scheduler, promotion plane, arbitrary eval or page/model authority.

## Next slices

- `work/devbrowser-workspace-git-hardening-v1`: stable worktree inventory/activation verifier and later atomic lock sequencing.
- `work/devbrowser-transport-foreground-v1`: foreground/nonzero-viewport submit readiness contract before runtime wiring.
