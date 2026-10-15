# W55 — Native source-sync Windows repair and bounded provider hook

Status: **SOURCE / SYNTHETIC-STAGING only**, never installed or LIVE.

## Exact initial ancestry
- Work branch: `work/metaengine-client-wave9-w55-20261015`
- Direct parent: W50 PR #1276 `adde7d726dd7272aaa84806add559aaaba371482`.
- W50 parent: W38 PR #1267 `2e9018d14cfe55256ddc5a94693ff0a288b90318`.
- Inspected separately, **not merged**: W43 #1273 `b24e240b3a273a9622a3983a1029faa53d6a6576`; W49 roadmap #1272 `241f1ed06dc6063e95806e6965c7a17a8bd91cfa`.
- main `b26f2d4693e7bab3648e0930b7a9e2c75baef58e`; integration/compute-unified-v1 `a23b647220c6bdeaa4340f804575dc2009e434cb` at initial remote read.
- Other coordinator pins #1269 `8628b9dd35e1e918d045e45fd0b6d405d30786d8`, #1270 `8f2515719a009a0cec05fbbf84a6857ba1ece34a`, #1271 `f0935e0b5027304cdc2ba20d2cc58b14dfd67ab1`, #1274 `67d67a0b7eca53d3a8bf42550affdd99404ccae7`, #1275 `56ba9d7ebedd3805e778cbee4fdcb46ce07e574d`.

## Scope and limits
- W50 Windows failure in GitHub job `116142863934` / run `38648999503`: source Git worktree test line 213 returned UNSYNCED rather than SYNCED_SOURCE. Source-level case-insensitive matching is constrained to Windows physical path spelling (not Linux and not path traversal). It is not an authority upgrade; exact locked worktree, SHA, upstream, clean tracked/untracked status and GitHub current API ref remain mandatory. The assertion now reports bounded reason for any remaining CI failure.
- Existing `createShellFreeGitExecutor` accepts only three additional typed fixed read-only Git plans; removes all inherited GIT_* vars and disables optional Git locks/prompting for observation.
- Existing managed Host exposes an **in-process-only** read method bound to its existing runner and current privately stored fixed repository config, not a second scheduler/IPC route.
- New `createClientSourceSyncNativeServiceW55` reads native Supervisor workspace observation and a W52-supplied `readVerifiedOwnerBinding`, verifies physical roots and runs W50 preflight through the managed Host. Without verified Owner it stays UNKNOWN. W51 exclusively owns eventual main.mjs assembly.
- New GitHub current ref reader refreshes the existing installed repository connection and secure credential, and performs one fixed, no-store, no-redirect authenticated GET for the exact current `refs/heads/<bound-branch>` via api.github.com. Cached origin and arbitrary endpoint/ref, renderer, token or URL remain ineligible.
- Generated local Git worktrees and synthetic API responses are **not** real installed native/Owner trust, API-provider deployment, self-hosted PostgreSQL, production GitHub credential, physical Windows installer or LIVE Agent-origin proof.

## Remaining gates
Exact Linux+Windows source CI on **this** head; W52 genuine Owner verifier and service wiring; W51 integrated candidate at one reviewed SHA; disposable own-PG17, Windows package/SelfUpdate, signed artifact/provenance and physical installed readback; independent critic. No source-only green can promote canonical R1/C1/C2 acceptance.
