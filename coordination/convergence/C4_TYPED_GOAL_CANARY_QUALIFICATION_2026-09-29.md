# Client V1 C4 typed goal canary qualification — 2026-09-29

## Scope

This checkpoint records the first positive typed Client V1 product-control slice. It does not authorize release promotion and does not turn the Meta-Orchestrator into a second scheduler.

## Product source

- Product branch: `work/client-v1-c4-typed-goal-bridge-v1`
- Current product head at checkpoint: `94d8b6dcd97c1a0bb8cde264108f2269257a5f06`
- Durable Client roadmap baseline / canary semantic source pin: `1fde1e53549eafefd6c28b50cdcd384e86d14512`
- Frozen R109 remains immutable: `ff95e9c886fac35b9302ec5c04a4c6bf7b8e8551`

## Implemented typed surface

Primary ME2 renderer now receives a dedicated `metaengineClient` bridge with:
- `submitGoal(goal)`
- `selectAgent(agentId)`

The bridge does not expose the legacy generic `command()` multiplexer. Goal submission routes through dedicated Electron IPC and the existing device-signed Native Supervisor transport.

For `metaengine-client-v1`, Edge now returns a goal receipt only after one Postgres transaction has:
1. activated the next durable semantic plan generation; and
2. admitted the single dependency-free point through the existing canonical `devos_fleet_enqueue_v1` ingress.

The product readback requires `task_admission_state=ADMITTED`, one exact UUID `task_id`, `atomic_plan_and_admission=true`, and explicit false scheduler/browser/release authority.

## Fresh Supabase substrate

The fresh Client V1 project now contains only the required durable semantic plan/admission compatibility layer:
- roadmap authority
- plan state + CAS activation
- authoritative input projection
- task admission
- frontier admission
- scheduler capacity projection
- Client V1 one-point atomic goal-submit RPC

No legacy ME2 mirror, cron loop, second scheduler, lease allocator, Browser actuator, or automatic retry plane was introduced.

Live transactional DB qualification previously proved activation + canonical admission and rolled back the qualification task.

## Canary deployment

Project: `jhriwwsryeqsvvvufkok`

Canary:
- slug: `a2-browser-native-supervisor-v14-canary`
- version: `18`
- source pin: `1fde1e53549eafefd6c28b50cdcd384e86d14512`
- digest: `527aba183813cc68e52859c55ff17a2440900eef8669a1c5cca6689852005dd3`

Stable was intentionally not changed by this step.

R83 static equivalence is green after rebinding the manifest to the exact canary source pin.

Public health proof:
- workflow: `Client V1 Supabase Edge Live Probe`
- run `36579422826`: SUCCESS on stable and canary
- a later exact-head live probe also remained green.

## Signed canary goal proof

Workflow: `Client V1 C4 Signed Canary Goal Qualification`
Run: `36581251342`
Attempt: `1`
Conclusion: SUCCESS

Exact request:
- source head: `94d8b6dcd97c1a0bb8cde264108f2269257a5f06`
- client id: `client-v1-canary-94d8b6dcd97c-36581251342-1`
- enrollment request: `3b49f90c-216a-47c5-b770-7a3a84e497ca`
- device: `626a5ac6-b3a9-4a2f-a6cd-d14230e04f9b`

The request was explicitly approved only after the exact head/run/attempt binding was proven.

Signed goal result:
- roadmap: `metaengine-client-v1`
- plan generation: `1`
- point: `obj.c4-signed-canary-qualification-36581251342-attem.v1`
- task: `655d2460-9077-437c-848a-860b71e63791`
- task admission: `ADMITTED`
- atomic plan + admission: true
- automatic retry: false
- scheduler authority: false
- Browser authority: false
- release authority: false
- authority effect: false

## Qualification cleanup

The qualification task was still READY, lease generation 0, with no claim. Cleanup therefore:
- fenced only that task with `CLIENT_V1_SIGNED_CANARY_QUALIFICATION_COMPLETE`;
- retired the qualification plan as SUPERSEDED;
- revoked the temporary qualification device;
- disabled its pairing grant.

No live test identity or schedulable qualification task was left behind.

## Enrollment provenance repair

Physical installed-Browser enrollment already had a bounded correlation contract in source, but CI had not wired it into the launched installed process.

The installed qualification now injects:
- `METAENGINE_ENROLLMENT_QUALIFICATION_KIND=INSTALLED_ELECTRON`
- exact workflow run id
- exact workflow run attempt
- exact PR head SHA

Browser signs those fields inside the enrollment body; Edge independently revalidates them before persisting metadata. Ambiguous requests must not be auto-approved.

## Current open gates

At this checkpoint:
- signed canary goal transport is proven;
- static R83 and public health are proven;
- exact-head Package Smoke / Installed Chat / Final Runtime / remaining Soak/Self Update are still running for the latest product head;
- provenance-qualified installed Electron enrollment is expected from the current Installed Chat run and must be read back before stable C4 activation;
- stable C4 activation remains unauthorized until these exact-head physical gates terminate successfully.

## Research / design conclusion

The narrow typed Client path preserves the project convergence rule:
user intent -> one typed product API -> signed Native Supervisor transport -> one durable plan/admission transaction -> existing canonical scheduler queue.

Pause/resume/approve/intervene should follow the same rule: objective/task-scoped state transitions over the existing durable scheduler state, not a new renderer command bus and not a second scheduling loop.
