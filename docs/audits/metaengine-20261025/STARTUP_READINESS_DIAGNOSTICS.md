# Startup readiness diagnostics — 2026-10-25

## Source and scope

Source: public repository `PatrickFrome/Compute`, commit
`9a19ae7153f1213f3f43682a24aa0ba3bb105586` on
`work/metaengine-operator-autonomy-20261022`.
The tested `apps/metaengine-browser/src/main.mjs` matches Git blob
`cd0e7bbee01d3ad83a092380ca87550683d7cf20`.

This change adds diagnostic characterization only. It does not change production
behavior, fix an installed client, or prove autonomous agents are operational.
Only selected public source files were materialized, not a complete checkout.

## Findings

- The degradable startup helper catches rejection but does not bound an operation
  that never settles (`src/main.mjs:2583–2593`).
- Awaited Fleet initialization prevents scheduling Development Plane, RSI, and
  Native Supervisor; a pending shell snapshot is another native scheduling
  barrier even after Fleet settles (`src/main.mjs:2625–2646`).
- Fleet becomes globally visible before initialization completes and before
  boot-target reconciliation (`src/main.mjs:1447–1468`).
- Fleet construction installs defaults; initialization awaits durable load before
  replacing them and later persisting
  (`src/fleet-provisioner-core.mjs:285–290,322–324`). Object existence is not
  evidence that durable state is ready.
- Native startup awaits interrupted-setup recovery. Recovery requires both
  objects, snapshots Fleet, and supplies its archive operation. Recovery failure
  sets a native fence (`src/main.mjs:2415–2421,3205–3231`).
- Device/client-bound protected permits, a single executable hash, and sandbox
  pins remain required (`src/main.mjs:2391–2406`). No permission or recovery
  boundary is weakened.

## Safe design prerequisites

Native startup independence is not established. Do not simply detach Fleet or
add a generic timeout: recovery could observe fresh defaults while durable state
loads, and reconciliation could overlap native command processing.
A follow-on design must distinguish loaded-state readiness from optional
reconciliation, keep dependent operations fenced until ready, and account for
late completion, cancellation, recovery, and generation ownership.
A timeout alone does not cancel the underlying operation. Rejected Fleet startup
and still-running Fleet startup are different safety cases.

## Verification and limitations

Node `v24.22.1`; run from repository root:

```sh
node --test apps/metaengine-browser/test/startup-independence-diagnostic.test.mjs apps/metaengine-browser/test/shell-first-startup-boundary.test.mjs
```

Result: **9 passed, 0 failed** — five new diagnostics and four unchanged shell
boundary tests. Source slice and ordering assertions explicitly require present
markers, preventing an `indexOf(...) === -1` false pass in the new diagnostics.

The diagnostic executes unchanged helper/bootstrap function bodies extracted
from `main.mjs` in a VM, replacing only effect boundaries and capturing the
`setImmediate` queue. It characterizes pending/rejection control flow and owner
ordering. The dependency/permit case is a static source contract check, not
execution of the native supervisor or recovery subsystem.

Full repository tests, build, Electron integration, Windows/native runtime,
installed-client verification, and live external effects were **not run**.
Focused success is not a full-suite pass or proof of runtime independence.
No workflow rerun, merge, deployment, permission grant, or agent send is part of
this diagnostic synchronization.
