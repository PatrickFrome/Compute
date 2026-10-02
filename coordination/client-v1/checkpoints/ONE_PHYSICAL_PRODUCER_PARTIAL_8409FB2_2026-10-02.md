# One physical producer partial qualification — 2026-10-02 07:06 UTC

Exact runtime source under qualification: `8409fb249887dd4636b3bd6fab40bfe30fa4b085`  
Runtime branch: `work/build-one-physical-producer-fence-v1`  
Draft PR: #1092  
Evidence branch: `analysis/one-physical-producer-qualification-8409`

This checkpoint is evidence-only. It does not modify the runtime source, live Browser installation, release authority, Guardian authority, or Supervisor/task admission.

## Source correction accepted

The Package Smoke workflow parser incident was corrected before this exact source:
- duplicate YAML `timeout-minutes` mapping removed;
- package-version job concurrency remains valid;
- immutable reservation artifact digest accepts the upload-artifact output in either raw hex or `sha256:<hex>` form and normalizes it to `sha256:<hex>`;
- package identity advanced to `0.7.0-dev.36977000001.1`.

The four earlier parser records #3139–#3142 had zero jobs and zero artifacts; they did not create physical package bytes.

## Exact-head CI status at this checkpoint

Terminal SUCCESS:
- Browser Shell #3548
- Critical Audit #2601
- Shell-First Dirty Profile #1036
- Host Resilience Login Start #513
- Workspace Reincarnation #565

Still in progress:
- Package Smoke #3143 / run `36975915572`
- Installed Chat #2425 / run `36975915671`
- Final Runtime #2008 / run `36975915543`
- Autonomous Soak #2677 / run `36975915656`
- Self Update #3596 / run `36975915484`

No failed exact-head workflow is known at this checkpoint.

## One-producer reservation evidence

Package Smoke preflight job:
- `package_identity_preflight`: SUCCESS

The physical producer has already created the immutable package-version reservation:

- artifact id: `11212813280`
- name: `metaengine-browser-package-version-0.7.0-dev.36977000001.1`
- ZIP bytes: `861`
- ZIP SHA-256: `334ba15e096123c28842fbb1019dd6a1fc26676cce2ebf3c79bd512e6bd40631`
- created: `2026-10-02T06:56:37Z`

This means semantic version `0.7.0-dev.36977000001.1` is now **consumed** and must not be rebuilt after any source change.

## Physical candidate now exists

Package Smoke #3143 has already published the exact source-scoped candidate:

- artifact id: `11213553858`
- name: `metaengine-browser-windows-candidate-8409fb249887dd4636b3bd6fab40bfe30fa4b085`
- ZIP bytes: `161278075`
- ZIP SHA-256: `8c69d3fa50dfdfd1ecc6b78032375104b7929f5f3d0a362e46453dd194b896d8`
- created: `2026-10-02T07:04:07Z`

At this checkpoint Package Smoke is still performing installed physical qualification; therefore the artifact is **not yet terminally qualified**.

Downstream physical consumers are waiting/acquiring this one producer artifact. No second candidate was created.

## Live user Browser boundary

Fresh Supabase readback at `2026-10-02T07:06:08.895183Z`:

- installed version: `0.7.0-dev.36908273822.1`
- Supervisor mode: `CONTROL`
- armed: true
- Compute: `HEALTHY`
- Development Plane: `READY`
- Host Resilience: `ACTIVE`
- `host_resilience.guardian = null`

Fleet:
- ACTIVE: 0
- BOUND_UNVERIFIED: 4
- LOST: 0
- readiness contract: `TRANSPORT_PROOF_REQUIRED`

The live installed Browser remains older than the new Guardian heartbeat/producer-fence work. Null Guardian is still absence of the newer diagnostic, not proof that Guardian service is absent or failed.

No live install, fleet promotion, task dispatch, enrollment, UAC, or retry effect was issued while taking this checkpoint.

## Parallel research checkpoint

A separate analysis branch now contains the next supply-chain plan:
`analysis/npm-ci-lockfile-rollout-v1`

Research:
`research/BROWSER_FROZEN_NPM_DEPENDENCY_ROLLOUT_2026-10-02.md`

It maps the next safe stage:
- committed Browser package-lock;
- Node 24/npm 11 generation;
- `npm ci`;
- lockfile SHA bound into Build Identity successor;
- existing installed dependency-resolution SHA retained as independent post-install evidence;
- physical-chain workflows converged only after lockfile qualification.

## Next gate

Do not modify `work/build-one-physical-producer-fence-v1` while #3143 has produced physical bytes.

Next safe actions:
1. wait for exact-head Package Smoke terminal result;
2. if success, require Installed Chat / Final Runtime / Soak / Self Update to finish against exact producer run #3143;
3. inspect terminal artifacts and producer/consumer Build Identity bindings;
4. seal final qualification checkpoint;
5. only then open the next implementation branch for frozen dependencies.

Promotion/release/live installation remain unauthorized.
