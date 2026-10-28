# Native seed admission repair, 29 October 2026

Base source: ad965a15fbf130461349877edc1d6e6651024caa. Installed source during measurement: 3d2a191d45d9aa7798d4d3639749727b6e18d31c (.217).

Two installed trial requests were independently rejected before dispatch. No seed, worker result, CRITIC or checkpoint was proven. Historical request diagnostics did not preserve the original reason; the following measurement reproduces one failure mode, not attribution to either request.

Read-only physical observation of both native roles: before change 29,587 ms (25,000 ms budget); all artifact/PG/user/worktree/sandbox identities matched. After a request-scoped cohort: 15,998 ms with the same identity matches. Separate cold image preparation took 36,523 and 11,330 ms respectively and is outside the physical observation window. These are two observations on a variable-load host, not a benchmark or an installed fix.

The cohort reads common PG/Browser/operator/boot state once per call; each agent retains its own image/worktree/sandbox checks. No completed observations are cached across calls or transactions. Bounded private failure diagnostics do not replace rejection evidence or permit retries. Physical timestamps now retain observation start and include profile revalidation in the freshness budget.

Fresh runtime status still permits the native idle cycle (authoritative generation 28, OPEN) despite the old chat WAKE_AMBIGUOUS. Do not conflate that chat state with interruptedSetupRecoveryHold or change global control without live evidence.

Targeted scope and seed tests: 24/24 PASS. Live installation, provider registration, useful Writer work, independent CRITIC, message pickup and restart continuation still require physical evidence. See architecture-research.md for official comparisons and staged scaling boundaries.
