# Guardian status semantic hardening checkpoint — 2026-10-02

Branch: `work/guardian-status-semantic-hardening-v1`  
Stacked base: `work/guardian-heartbeat-observation-v1 @ 1f6902daeae8bc201d1c493e8a413f320a80aeec`  
Reserved package identity: `0.7.0-dev.36965253139.1`

## Why this successor exists

The heartbeat observer was already fail-closed at the top-level state: expired READY becomes HOLD and activation invalidates an old generation. A deeper audit found that the stale object still spread the cached launcher response before overriding state/ready.

A real READY response contains:
- `guardian_service_ready=true`
- `owner_binding_proven=true`
- `device_binding_proven=true`

Therefore an expired READY could say `state=HOLD` while still carrying current positive proof booleans. Current Supervisor admission does not consume this diagnostic, so no live authority gap was observed. The representation was nevertheless unsafe for future consumers and UI semantics.

A second gap was schema-light validation: an object with the correct launcher schema and zero authority bits could claim READY without exact owner/device proof.

## Implemented hardening

### Stale proof scrubbing

Expired current state now:
- `state=HOLD`
- `reason=GUARDIAN_OBSERVATION_STALE`
- `ready=false`
- `guardian_service_ready=false`
- `owner_binding_proven=false`
- `device_binding_proven=false`
- `explicit_user_action_required=true`
- `uac_consent_required=false`

Historical positives are preserved only as explicitly historical fields:
- `last_confirmed_state`
- `last_confirmed_at`
- `last_confirmed_guardian_service_ready`
- `last_confirmed_owner_binding_proven`
- `last_confirmed_device_binding_proven`

They are evidence, not current proof.

### Activation invalidation clears current proof

`invalidate()` now snapshots bounded last-confirmed metadata and clears the current cached status. During activation the observer publishes `HOLD / GUARDIAN_ACTIVATION_STARTED` instead of projecting a stale cached proof.

The old in-flight generation remains fenced. A late response from it cannot restore current state or increment the accepted observation revision.

### Positive-state semantic validation

Observer input now validates:
- launcher state allowlist;
- `ready === (state === READY)`;
- explicit-action and UAC flags match state;
- fixed packaged bootstrap;
- caller path/arguments unused;
- arbitrary shell unused;
- no retry/authority bits;
- READY requires service + owner + device proof;
- non-READY states cannot carry owner/device proof;
- OWNER_ENROLLMENT_REQUIRED requires service-ready with explicit negative owner/device proof;
- ACTIVATION_REQUIRED requires service-not-ready.

Malformed or contradictory input becomes observer failure/HOLD, never positive state.

## Tests

Added/strengthened regressions for:
- concurrent Settings + heartbeat single-flight;
- stale READY proof scrubbing and historical projection;
- late pre-activation READY rejection;
- invalidation after an already cached READY;
- hung observation deadline;
- malformed schema;
- false READY with missing owner/device proof;
- contradictory non-READY with positive owner proof;
- monotonic process-local observation revision;
- shared heartbeat/realtime host-resilience merge;
- unchanged Edge/canary source.

## Authority

No change:
- Guardian heartbeat remains diagnostic-only.
- Supervisor admission is not opened.
- No UAC is triggered by heartbeat.
- No enrollment is triggered by heartbeat.
- No automatic physical retry is added.
- R83 Edge source stays unchanged.
- `automatic_retry_allowed=false`.
- `authority_effect=false`.

## Parent evidence

Parent exact head `1f6902da…` has already passed Package Smoke #3126 with:
- package: `0.7.0-dev.36965151413.1`
- installer: `METAENGINE-Browser-Test-Setup-0.7.0-dev.36965151413.1-x64.exe`
- installer bytes: `159810130`
- installer SHA-256: `ebbd8c281cd5b2eb2b1434657b90d5518f0637aa7bb89fc0c41abf58a7806c92`
- blockmap SHA-256: `30048e11c42e57f7d550a47fe3e5adfa0443f39501639b6a3d65ba550db472b4`
- builder config SHA-256: `02e569d4797baad6252f86972d0f0a87db0d0b410c1a7d80d5cc9021d9194731`
- candidate artifact id: `11209696186`
- candidate artifact ZIP SHA-256: `a23cd7f86c807bbb06e2af0a6522675331d8300ac19205bceb0e48905288fb6e`
- package evidence artifact id: `11210230865`
- evidence ZIP SHA-256: `436de1926fe7cbb4fb824b2a2017774bbfe283740dfde81ad04384691b187185`
- normal UI boot: PASS
- second-instance activation: PASS
- startup grace survival: 190 seconds
- same primary PID/sentinel token across grace: PASS
- Guardian physical bootstrap test: PASS

At checkpoint creation, all parent exact-head workflows except Self Update were terminal SUCCESS; Self Update remained in progress. This successor must qualify independently and must not inherit promotion authority from the parent.

## Related research

- `research/GUARDIAN_STATUS_SEMANTIC_HARDENING_AUDIT_2026-10-02.md` on analysis branch `analysis/build-identity-provenance-1f6902da`
- `research/GUARDIAN_HEARTBEAT_OBSERVABILITY_RESEARCH_2026-10-02.md`
- separate Build Identity V2 research/checkpoint on `analysis/build-identity-provenance-1f6902da`

## Next gate

Open as a stacked draft PR only after source/version/checkpoint are frozen. Require exact-head CI and a new one-built installer. Do not reuse the parent package identity.
