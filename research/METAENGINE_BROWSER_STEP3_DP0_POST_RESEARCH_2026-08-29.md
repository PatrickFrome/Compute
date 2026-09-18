# METAENGINE Browser Step 3 — DP0 post-research

Date: 2026-08-29

## Implemented boundary

DP0 is a managed Electron UtilityProcess with an exact capability handshake. It exposes only HEALTH, CAPABILITIES, PROCESS_METRICS and filesystem-only REPO_HEAD_READ. It receives no browser Session, no user cookies, no page messages, no shell command runner, no arbitrary arguments and no promotion capability.

The parent passes only `METAENGINE_REPO_ROOT`, rather than inheriting the browser's complete environment, to reduce accidental credential inheritance.

Process loss rejects pending requests and moves the plane to LOST. There is no automatic restart. This follows the same ambiguity discipline used by browser actuation: recovery is explicit, not a blind replay.

## Post-research conclusions

Electron's UtilityProcess API has the process lifecycle primitives required by this architecture: spawn, message, exit, pid and kill. The child side exposes `process.parentPort`, whose queued message events give a typed local transport without a listening TCP socket.

Sources:
- https://www.electronjs.org/docs/latest/api/utility-process
- https://www.electronjs.org/docs/latest/api/parent-port

The next safe progression is not to grant arbitrary build execution. DP1 should introduce an isolated workspace broker with a closed command catalogue and build/test recipes committed in the repository. Candidate generation must remain separate from candidate promotion.

## Next proof target

DP1_ISOLATED_DEVELOPMENT_WORKSPACE:
- exact repo/worktree identity
- allowlisted test/build recipes
- bounded patch application
- output/artifact digesting
- no current-runtime overwrite
- canary launch as a separate process/profile
