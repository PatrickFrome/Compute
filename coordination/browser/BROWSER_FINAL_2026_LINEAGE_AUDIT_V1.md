# METAENGINE Browser Final 2026 — Lineage Audit V1

Status: **development-only convergence checkpoint**. This document is not production or release authority.

## Canonical source-candidate lineage

Current source-candidate stack is the cumulative convergence line through:

1. hardened Host Agent replay/restart/session-key fences;
2. pure Verified Execution Fabric v1;
3. the first Leased BrowserPlan → VEF consumer;
4. `metaengine.browser-final-convergence.v1` source-composition gate.

At audit time the stacked review sequence is PR #498 → PR #499 → PR #501. The exact release candidate SHA must still be selected only after physical qualification; branch names and this document are not release evidence.

## Lineage disposition

| Lineage / branch family | Disposition | Evidence / rationale |
| --- | --- | --- |
| `work/browser-command-fabric-v2-p0` | ALREADY_INCLUDED | Exact ancestry to the current convergence tip; do not re-merge. |
| `work/browser-host-agent-p0` | ALREADY_INCLUDED | Exact ancestry; current successor additionally hardens replay epochs and restart/session-key handling. |
| `work/browser-final-convergence-v1` | ALREADY_INCLUDED | Exact ancestry. |
| `work/browser-final-shell-v1` | ALREADY_INCLUDED | Exact ancestry. |
| `work/browser-successor-convergence-all-fixes-v1` | ALREADY_INCLUDED | Exact ancestry. |
| `work/browser-sovereign-fabric-convergence-hardening-v1` | ALREADY_INCLUDED | Exact ancestry. |
| `work/browser-self-update-bootstrap-recovery-current-v1` | ALREADY_INCLUDED | Exact ancestry. |
| `work/browser-self-update-double-handoff-recovery-v1` | ALREADY_INCLUDED | Exact ancestry. |
| `work/browser-guardian-owner-enrollment-current-v2` | ALREADY_INCLUDED | Exact ancestry. |
| `work/browser-guardian-session-broker-effect-gate-current-v1` | ALREADY_INCLUDED | Exact ancestry. |
| `release/metaengine-browser-final-candidate-e089d` | HISTORICAL_INCLUDED | Exact ancestor; current convergence line is hundreds of commits ahead. |
| `work/browser-final-integration-v1` | SUPERSEDED_STRONGER | Divergent two-commit Sentinel-incarnation fix is superseded by the current successor-bound journal with predecessor evidence archival and fail-closed no-retry semantics. |
| `work/browser-final-optimization-v1` | SUPERSEDED_EQUIVALENT | Old single-pass workspace counter optimization is already present in current projection/admission logic and current performance contracts. |
| `work/browser-self-update-successor-recovery-v2` | SUPERSEDED_STRONGER | Current successor recovery is later and stronger (transaction/SHA/version qualification and explicit quarantine/diagnostics). |
| `work/browser-self-update-heartbeat-liveness-v2` | SEMANTIC_REVIEW | Historical divergent commits; no wholesale merge. Review only for unique invariants not already covered by current heartbeat/restart/successor qualification. |
| `work/browser-continuous-autonomy-release-v1` | SEMANTIC_REVIEW | Historical divergent DevOS/supervisor lifecycle changes; current source is far ahead. Review unique contracts, never merge wholesale. |
| `browser-dev-channel` | RELEASE_CHANNEL_SIDECAR | Far behind source lineage; unique diff is dev-autopublish/release-channel metadata. Rebind only after exact Final SHA qualification. |

## Final source contract

A source candidate may report `SOURCE_READY` only when all of these are simultaneously proven in the same tree:

- Command Fabric v2;
- stateless Fast Control;
- worktree-aware Development Plane read model;
- Host Agent replay fence v2;
- one-shot Host session keys with restart rotation;
- Leased BrowserPlan v1;
- Verified Execution Fabric v1;
- Sentinel successor fencing;
- exact-SHA physical release gate.

`SOURCE_READY` is deliberately weaker than `RELEASE_QUALIFIED`. It never authorizes production promotion, automatic retry, authority widening, or release publication.

## Remaining convergence work

- finish exact-head Windows Package / Installed Chat / Self Update / Autonomous Soak / Critical Audit for the current PR #501 source head;
- finish semantic review of the small set of divergent historical Self-Update / continuous-autonomy lines and adopt only genuinely unique invariants;
- rebind dev-channel/autopublish metadata only after one exact Final SHA is qualified;
- then create one final release-candidate branch from that exact SHA and run the existing bootstrap/autostart → self-update → physical release chain without bypasses.
