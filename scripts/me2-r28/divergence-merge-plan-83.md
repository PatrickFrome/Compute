# Divergence-Merge Plan — me2-os ↔ capsule (83/222 files), R28/R81 gate item
Generated: 2026-09-28 ~13:15 +08, Job 419718 cycle 1307. Owner: Principal Engineer (directive 0aa0957922d0f9d6).

## 0. Constraints (hard, from operator audit R80/R81)
- Trunk/authority: `release/self-update-ambiguity-live-v2` @ cf747798 (Browser source authority).
- `sandbox/me2-os` @ 56ba1b87 = UNRELATED history vs capsule — **git merge FORBIDDEN**; only semantic extraction (content-level patches).
- Capsule head 73c5021c intact; CI not wired on capsule side (blocker C-1 in R28 list).
- Any mutation of shared branches = policy T1 (dispatcher lease); release-branch touch = T2 (owner).

## 1. Regenerate divergence list (if artifact lost)
```bash
git -C <capsule-worktree> diff --name-status 73c5021c -- . > /tmp/div-capsule.txt   # capsule vs its base
git -C /home/z/my-project diff --name-status HEAD -- . > /tmp/div-me2os.txt          # me2-os working state
# join by path -> classify A/B/C (below); expect ~83 diverged of 222 tracked
```

## 2. Classification (per file)
- **A — capsule-only** (changed in capsule, identical in me2-os): capsule is canonical for its scope → take capsule content.
- **B — me2-os-only** (R-line work: phoenix scripts, browser-test artifacts, R28 modules): extract semantically onto trunk-side worktree branch.
- **C — both-modified**: highest risk → per-file semantic diff review, decision matrix (take trunk + port capsule intent, or vice versa), each decision logged in worklog batch section.

## 3. Execution order (batches)
1. **C-class first** (conflict risk; do while tree is quiet), batches of ≤15 files.
2. **B-class by roadmap priority**: R81 AUTHORITY FREEZE files first (supervisor/liveness paths), then R28 me2-r28/* modules, then tooling/tests.
3. **A-class last** (mechanical copy).
Each batch: branch `sandbox/merge-batch-N` → apply → run local smoke (policy engine 8/8, c3 reviewer 3/3) → commit → divergence count re-run.

## 4. Verification gates per batch
- Divergence count strictly decreases; target 0 unresolved C-class.
- No file crosses trust boundary with secrets (SEC rule: repo public; secret-scanning).
- CI: capsule CI wiring (C-1) must land BEFORE batches touching build/runtime paths; doc/tooling batches may proceed without CI.

## 5. Rollback
Worktree-only; no force-push; batches are disposable branches; failed batch → drop branch, divergence list unchanged (append-only journal).

## 6. Open dependencies
- (a) CI wiring on capsule (C-1) — prerequisite for runtime-path batches.
- (b) RESEARCHER eval-roadmap baseline (CRITIC-gate checks pending) — gates the REVIEW checklist for C-class decisions.
- (c) Operator rotation of secrets — before any batch touching env-adjacent files.
