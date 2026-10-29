# Rejected native review is a visible blocker

A native writer and its CRITIC can both remain RESULT_READY after REJECT. The
old project snapshot then reported WAITING_CHILDREN indefinitely: neither task
was FAILED, and a checkpoint was correctly unavailable. The new readonly SQL
projection binds the exact independent writer/critic receipts, subject, source,
artifact and retained worktree fence before reporting one rejection reference.
It walks only the selected task's project subtree. A different branch cannot
inherit this rejection. No task is completed, permit renewed, root released,
checkpoint created or code retried by the observer.

The project snapshot shows BLOCKED with a bounded rejection reference. A
suspended parent's projection shows BLOCKED_CHILDREN. Browser coordination uses
its existing child-blocked handling, while the goal journal/UI retain the actual
root state and show 'CRITIC rejected result · repair required'. SUSPENDED has an
explicit waiting label. Malformed references, different projects, ACCEPT or
forged authority fields are refused.

Evidence: actual disposable PG17 chat/native pair runs ACCEPT through checkpoint,
permit rotation and next child admission; a second pair returns REJECT and keeps
its HELD root, with no extra commit. The snapshot reports the exact rejected pair.
Focused source/journal tests:124 pass. Full fresh schema plus suspension tests:
18 pass, one supplemental WASM skip. TypeScript noEmit passes. Native/Windows
process and Git receipt witnesses in this fixture remain generated.

This removes silent waiting and false completion. It does NOT yet implement an
automatic repair after rejection. Such a repair must preserve old receipts,
verify native quiescence and current dirty bytes, and use an explicit existing
project/custody transition; it cannot simply clear HELD or replay the old run.
