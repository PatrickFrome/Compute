# METAENGINE Browser convergence candidate

This file describes the current **source-convergence candidate**, not a production release.

Current convergence lineage is the cumulative successor line through the hardened Host Agent replay/restart fences, pure Verified Execution Fabric v1, and the first leased BrowserPlan → VEF consumer. The active stacked review line is PR #498 → PR #499 → PR #501. Historical branch/PR names are not release authority and must not be used as evidence that a fix is present; final adoption is determined by exact ancestry, source-contract proof, and exact-SHA physical qualification.

The source-composition gate is `metaengine.browser-final-convergence.v1`. `SOURCE_READY` only means that Command Fabric v2, stateless Fast Control, the worktree-aware read model, hardened Host Agent IPC/replay/session-key fences, Leased BrowserPlan v1, VEF v1, Sentinel successor fencing, and the exact-SHA physical release gate are present at the same source candidate. It does **not** authorize production promotion.

Package identity remains `0.7.0-dev.2.1` until an explicitly qualified successor version is selected. A final release must bind one exact qualifying git SHA and pass the existing physical Windows package, installed-chat, self-update, autonomous-soak, critical-audit, bootstrap/autostart, and release-gate chain for that same SHA.

Safety invariants remain fail-closed: no automatic retry of ambiguous browser effects, no authority widening, no raw shell/eval/CDP pass-through from the Host Agent, no page/model text authority, no bypass of self-update receipts or installer barriers, no silent replay-window weakening, no reuse of one-shot Host session keys across process restart, and no bypass of successor qualification or Sentinel recovery fences.