# Guardian status semantic hardening audit — 2026-10-02

Runtime source reviewed: `1f6902daeae8bc201d1c493e8a413f320a80aeec`  
Analysis only; no change to PR #1089 while its exact-head CI is running.

## Finding 1 — stale projection can retain positive proof fields

`createBrowserGuardianStatusObserver().projected()` currently builds the stale projection by spreading the last cached status and overriding only:
- state -> HOLD
- reason -> GUARDIAN_OBSERVATION_STALE
- ready -> false

A real READY status from the launcher also carries:
- `guardian_service_ready: true`
- `owner_binding_proven: true`
- `device_binding_proven: true`

Therefore the stale diagnostic can be internally contradictory: state/ready are fail-closed, but current proof booleans can remain positive.

Today this does **not** open Supervisor admission because Guardian heartbeat state is diagnostic-only. Still, it is an unsafe future affordance: a later consumer could accidentally key on `owner_binding_proven` rather than the top-level state.

Recommended repair:
- a stale projection must never retain current positive proof booleans;
- move any historical positives to explicit `last_confirmed_*` fields;
- current `guardian_service_ready`, `owner_binding_proven`, `device_binding_proven` should be false in stale/invalidated HOLD.

## Finding 2 — invalidation should remove the cached current proof

`invalidate()` advances the observation generation and zeroes observedAt, but leaves `cached` intact. If a cached result exists, projected state becomes generic STALE rather than the more precise invalidation reason and can retain the old proof fields.

Recommended repair:
- on activation invalidation, snapshot only bounded historical metadata if useful;
- clear the current cached proof;
- publish `HOLD / GUARDIAN_ACTIVATION_STARTED` until a new accepted observation/result is recorded.

This also makes the generation fence easier to reason about: an invalidated observation is not current state.

## Finding 3 — observer validation is schema-light

`validateStatus()` currently checks only:
- launcher schema;
- `authority_effect === false`;
- `automatic_retry_allowed === false`.

A structurally malformed object could therefore claim `state: READY` without the launcher’s required owner/device proof flags and be cached as a positive diagnostic.

The current source is local trusted code, so this is not a remote-input exploit. It is still a robustness gap at a safety boundary.

Recommended invariant validation:
- allowlist state values;
- `ready === (state === READY)`;
- READY requires:
  - guardian service ready;
  - owner binding proven;
  - device binding proven;
  - no UAC requirement;
  - no explicit user action requirement;
- OWNER_ENROLLMENT_REQUIRED requires service ready and no owner/device proof;
- ACTIVATION_REQUIRED requires UAC consent and no owner/device proof;
- fixed packaged bootstrap / no caller path / no caller arguments / no arbitrary shell remain mandatory;
- all non-READY states remain non-authoritative and non-retry.

## Qualification plan

Do not modify current PR source until exact head `1f6902da…` reaches terminal CI, because Package Smoke has already started and uploaded an immutable source-scoped artifact.

If current matrix is green:
1. record it as evidence for the heartbeat-writer fix;
2. conservatively consume the current package version;
3. advance package identity;
4. implement the three semantic hardenings as one bounded successor source change;
5. add adversarial tests for false READY, stale READY proof scrubbing, and invalidation after a cached READY/OWNER_ENROLLMENT_REQUIRED state;
6. rerun exact-head qualification.

No admission or physical-effect authority changes are proposed.
