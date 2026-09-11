# METAENGINE Browser Guardian Supervision V1

Status: branch-local implementation design + pre-code branch audit
Branch: `work/browser-guardian-supervision-v1`
Base: `integration/metaengine-development-os-v1@1053e848a1f3810f915e6c3411b9fa02764a1d76`
Authority effect: false

## Goal

Move Browser process/release liveness above the Electron failure domain without creating a second task scheduler, Browser authority plane, or effect-retry authority.

The Guardian owns only process and release lifecycle. Browser keeps Browser effects. Supabase keeps durable task/claim/evidence scheduling. Supervisor lifecycle keeps semantic-cycle continuation.

## Pre-code audit

All 139 repository branches containing `browser` were inventoried and classified by branch family plus semantic delta against the authoritative integration line. Sequential branch generations were covered by their terminal family heads; diverged side experiments were inspected separately when their unique delta could contain a missing mechanism.

### Semantically absorbed in current integration

- supervisor same-cycle terminal -> successor continuation;
- foreground Send revalidation and positive readback fencing;
- continuous sentinel worker recovery using the existing host resilience tick;
- self-update successor qualification/recovery;
- bounded worker observation and exact agent/tab/target/generation binding;
- elastic backlog-driven fleet provisioning with capacity backpressure;
- exact workspace/worktree binding, lock, inventory readback and ambiguity freeze;
- Development Plane restart and provenance/evidence boundaries;
- C5 target persistence/revalidation and transport proof semantics.

These mechanisms must not be reimplemented by Guardian.

### Missing or incomplete P0 mechanisms

1. **External Guardian failure domain.** Current Browser host-resilience and sentinel logic still lives below the Browser process boundary. A Windows SCM service must eventually own Browser process/release lifecycle.
2. **Runtime compatibility/readiness gate.** `work/browser-runtime-compatibility-v2` contains a fail-closed capability/protocol-generation contract that is absent from current integration and should be recovered semantically.
3. **Sentinel exact-child incarnation transition fence.** `fix/browser-sentinel-incarnation-race-v1` contains Browser Sentinel 1.6.1 with exact owned-child exit proof plus transition latch. Current integration remains Sentinel 1.6.0.
4. **Meta Control Plane source/live convergence debt.** Renewable meta lanes, fairness/snapshot semantics and related live Supabase behavior require canonical source recovery rather than branch replay.

### Recovered principles, not merge candidates

Historical A2 Browser/Compute Browser work supplied useful invariants that remain valid:

- route executors only in PRE_EFFECT state;
- bind leases and observations to process incarnation;
- persist durable effect intent before actuation and terminalize as COMMITTED / NO_EFFECT / AMBIGUOUS;
- never convert timeout into replay permission;
- capability/readiness is distinct from liveness;
- local restart storms escalate to a higher supervisor instead of spinning forever in one failure domain.

### Explicitly superseded / do not merge wholesale

- old shell branches that removed Development Plane/evidence layers;
- legacy Go sentinel convergence branch;
- obsolete dev-channel/build snapshots;
- old UI/control experiments unrelated to liveness;
- historical remote-browser/fleet stacks whose safe principles are already represented by current DevOS.

## Supervision hierarchy

```text
Windows SCM
  -> METAENGINE Guardian service
      -> METAENGINE Browser process
          -> HostResilienceRuntime
              -> Browser Sentinel worker
          -> Supervisor runtime
          -> Development Plane
          -> Elastic Fleet
```

No layer inherits Browser/task authority from the layer above it.

## Guardian V1 decision boundary

`src/browser-guardian-core.mjs` is intentionally pure. It performs no process, Browser, task, release, network or filesystem effect.

Inputs are desired release state plus observed child/release/heartbeat/effect-journal state. Outputs are one of:

- `NOOP`
- `START_CHILD`
- `HOLD_STARTUP`
- `HOLD_UNREADY`
- `RESTART_EXACT_CHILD`
- `ESCALATE_TO_SCM`
- `ACTIVATE_CANDIDATE`
- `ROLLBACK_CANDIDATE`

Every output preserves:

```text
actuation_eligible = false
automatic_retry_allowed = false
browser_authority = false
task_authority = false
scheduler_authority = false
page_model_text_authority = false
release_authority = false
authority_effect = false
```

A process-effect action is only a candidate for a future durable external executor. That executor must persist intent, revalidate exact process/release incarnation, perform at most one physical effect, and persist positive readback or AMBIGUOUS.

## V1 safety rules

- External stop suppresses restart planning immediately.
- Child start requires positively proven child absence.
- An unresolved ambiguous process effect suppresses automatic replay.
- Restart intensity is bounded locally; excess escalates to SCM.
- Startup grace is distinct from liveness and readiness.
- Heartbeat must bind to exact PID + process incarnation + release id + artifact digest.
- Readiness requires minimum protocol generation, required capabilities and zero-authority safety flags.
- Candidate activation requires exact ready compatibility proof.
- Release version epoch is monotonic; rollback requires an explicit proven rollback-eligibility bit.
- Expired release metadata freezes activation/restart planning.

## Next slices

1. Recover the Sentinel 1.6.1 incarnation/transition fix onto current integration with current self-heal semantics preserved.
2. Recover runtime capability reporting/compatibility as the Browser readiness contract consumed by Guardian.
3. Add a durable Guardian process-effect journal and pure executor contract; no SCM service yet.
4. Implement Windows SCM service wrapper with bounded local restart intensity and SCM failure escalation.
5. Add release candidate activation/rollback physical proof using exact artifact identity and monotonic signed metadata.
6. Prove crash/reboot/no-login recovery on packaged Windows artifact before enabling live Guardian authority.

## Non-goals

Guardian V1 does not send prompts, click pages, lease DevOS tasks, create Browser agents, decide roadmap work, merge branches, bypass owner gates, or replay ambiguous Browser effects.
