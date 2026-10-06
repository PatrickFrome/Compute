# METAENGINE Client V1 C5 — Installed Restart Continuity Evidence

Date: 2026-10-06  
Status: **EVIDENCE_READY — PREPARE_ONLY / NON-LIVE**  
Qualified physical source: `eee637fcba41906dc21e8d2dc44d214257fabae5`  
Package: `0.7.0-dev.37399755569.1`  
Physical PR: #1127

## Roadmap reconciliation

This checkpoint advances the Client-side C5 continuity evidence needed before a live first serial coding loop can be trusted across process restart.

Canonical ownership remains:

`R1 → C1 First Real Linux Worker → C2 First Serial Coding Loop`.

This evidence is a **C2 continuity preparation gate**, not canonical C2 completion.

Current claims:

- Client C5 verifier contract: EVIDENCE_READY / PREPARE_ONLY.
- Client C5 physical useful-work reference loop: EVIDENCE_READY / SYNTHETIC.
- Client C5 durable journal restart contract: EVIDENCE_READY / PREPARE_ONLY.
- Client C5 installed-process restart continuity: **EVIDENCE_READY / PREPARE_ONLY**.
- Client C5 LIVE useful work: **NOT_PROVEN**.
- Canonical C2: **NOT_PROVEN**.
- Canonical promotion authority: **false**.

## Physical environment

Workflow:

`Browser Windows Package Smoke`

Run:

`37399897839`

Jobs:

- package identity preflight: `112064515864` — SUCCESS
- Windows NSIS package smoke: `112064744269` — SUCCESS

Runner:

`windows-2025`

GitHub documents standard hosted Windows jobs as fresh virtual machines provisioned per job. This makes the qualification a physical Windows VM execution rather than a Linux compatibility shim or static source-only assertion.

Reference:

https://docs.github.com/en/actions/reference/runners/github-hosted-runners

## Exact package identity

Package version:

`0.7.0-dev.37399755569.1`

Source head:

`eee637fcba41906dc21e8d2dc44d214257fabae5`

Installer:

`METAENGINE-Browser-Test-Setup-0.7.0-dev.37399755569.1-x64.exe`

Installer SHA-256:

`4ba511e25a1ad4131a1e5b8071cb6ff844fb3a61ee3eb05f36b9136454239565`

Build Identity SHA-256:

`b50932528c541719234625a3e56516b17f0b3abcda0c0f557b2ea47d7d1004ab`

Package-lock SHA-256:

`70323a3fec62a59f3c1be8330d5bc26dcad5565e77a2253d5e842869090dccae`

Dependency-resolution SHA-256:

`4bfec45b02d0872864df50812b9241f8e64aa04b5078a63f8a84174c06854b09`

## Immutable artifacts

Package reservation:

- artifact id: `11384463753`
- name: `metaengine-browser-package-version-0.7.0-dev.37399755569.1`
- digest: `sha256:956c6215a8fe3c3eb894ffd1a94b4e403b1091b09ec1395539331a14181b457e`

Exact-head candidate:

- artifact id: `11385111851`
- name: `metaengine-browser-windows-candidate-eee637fcba41906dc21e8d2dc44d214257fabae5`
- digest: `sha256:32435ade57b5b631619c85be800f286899719ea90c59305fef2f770d4edc1bcb`

Windows qualification evidence:

- artifact id: `11385346571`
- name: `metaengine-browser-windows-package-evidence-eee637fcba41906dc21e8d2dc44d214257fabae5`
- digest: `sha256:b8b7ce66474a73a92fa161127a0481112540da2bd91a236d2d4740b654e5e146`

## Installed package qualification

The same exact NSIS candidate passed:

1. package reservation and frozen dependency verification;
2. installed dependency resolution and SBOM generation;
3. Build Identity V3 readback;
4. exact-head NSIS build;
5. physical installation;
6. installed Browser + inert Guardian payload verification;
7. normal packaged UI boot;
8. second-instance activation into the existing primary process;
9. 190-second Sentinel startup-grace survival;
10. installed Client journal restart continuity;
11. one-shot Guardian machine bootstrap qualification;
12. source checkout immutability.

The package proof records:

- normal UI boot verified: true
- second-instance activation verified: true
- same primary PID across startup grace: true
- same Sentinel token across startup grace: true
- parent progress advanced across startup grace: true
- Sentinel relaunch attempted: false
- ME2 primary shell visible: true
- R97 DOM contract verified: true
- legacy shell used on normal startup: false

## Durable profile boundary

The installed binary reported its own exact Electron profile through the existing packaged profile probe:

`C:\Users\runneradmin\AppData\Roaming\@metaengine/browser-shell`

Journal:

`metaengine-client-goal-journal-v1.json`

Electron documents `app.getPath('userData')` as the conventional location for app configuration/user data. The gate therefore binds persistence to the installed application's real profile rather than a guessed product-name path or test temporary directory.

Reference:

https://www.electronjs.org/docs/latest/api/app

## Real installed process restart

Controlled valid journal digest:

`70f7931a09ee61d2f53ca1173241aae009b7fbfbc3a4cf28aa3afcce56123b60`

First installed read-only probe:

- PID: `6968`
- journal SHA before: exact valid digest
- journal SHA after: exact valid digest
- journal unchanged: true
- entry count: 1
- state: COMPLETED
- execution proof present: true
- useful-work proof present: true
- evidence class: SYNTHETIC
- evidence origin: CONTROLLED_FIXTURE
- user goal → verified artifact readback: true
- Client C5 useful work verified: false
- canonical C2 promotion authorized: false

Second installed read-only probe:

- PID: `6312`
- PID differs from first probe: true
- same exact profile: true
- same exact journal digest: true
- same request id: true
- same result digest: true
- same artifact digest: true
- useful-work proof restored: true

This proves process restart/readback on the installed binary. It does not infer continuity from a single long-lived process.

## Stale-binding rejection

A deliberately stale durable snapshot retained:

- execution lease generation: `1`
- useful-work lease generation: `2`

Stale journal digest:

`465c07705d21137b28d9bb531fb8c1022b379f9cf1caef6985a0cdf842a1dc89`

Installed stale probe:

- PID: `9068`
- execution proof present: true
- execution lease generation: 1
- useful-work proof present: false
- evidence class: null
- artifact digest: null
- user goal → verified artifact readback: false
- journal SHA unchanged before/after: true

Therefore the installed Client loads the same durable entry, preserves the still-valid execution proof, and discards only the stale derived useful-work proof.

The read-only probe does not rewrite the corrupt/stale durable bytes as a side effect of inspection.

## No-replay / no-authority proof

Every installed journal probe asserted:

- `local_read_only=true`
- `browser_runtime_started=false`
- `native_supervisor_started=false`
- `network_started=false`
- `submit_effect_attempted=false`
- `automatic_retry_allowed=false`
- `authority_effect=false`

The physical continuity receipt additionally records:

- `execution_proof_restored=true`
- `useful_work_proof_restored=true`
- `distinct_restart_processes=true`
- `stale_useful_work_binding_rejected=true`
- `stale_execution_proof_retained=true`
- `client_c5_useful_work_verified=false`
- `canonical_c2_promotion_authorized=false`

This is the required semantic boundary:

`restart/readback ≠ replay/effect`.

## Failure lineage and corrections

### Candidate 1

Source:

`0ca9f67c2a0d4901bdf4caa571170b82707782ae`

Package:

`0.7.0-dev.37396852910.1`

Package Smoke:

`37397781819`

The package physically built, installed and passed normal UI + Sentinel startup-grace.

The new restart step failed before the probe executed because Windows PowerShell parsed:

`$stem:`

as scoped-variable syntax inside a double-quoted diagnostic.

The identity was already reserved and therefore was retired rather than reused.

### Candidate 2

Source:

`cd5b06a0862288b46c5d300972af0829d5cd0e61`

Package:

`0.7.0-dev.37398594087.1`

Package Smoke:

`37398731953` — SUCCESS

Its installed restart mechanics passed, but post-run evidence audit detected an exact-head binding defect: the continuity receipt used the PR merge SHA rather than the package source head.

That identity was also consumed and not relabelled.

### Candidate 3 — accepted

Source:

`eee637fcba41906dc21e8d2dc44d214257fabae5`

Package:

`0.7.0-dev.37399755569.1`

The restart fixture and continuity receipt now bind to the package proof's exact `source_head`, and the physical step independently checks that package source against the pull-request head.

This candidate is the accepted evidence source.

## Regression fan-out

At exact head `eee637fcba41906dc21e8d2dc44d214257fabae5`, the following pull-request workflows are SUCCESS:

- Browser Meta Orchestrator V1 — `37399897850`
- Browser Typed Workspaces V1 — `37399897761`
- Browser Windows Installed Chat Qualification — `37399897699`
- Browser Windows Package Smoke — `37399897839`
- Browser Workspace Reincarnation V1 — `37399897868`
- Client V1 C4 Goal Contracts — `37399897813`
- METAENGINE Browser Critical Audit V1 — `37399897877`
- METAENGINE Browser Final Runtime Activation V1 — `37399897790`
- METAENGINE Browser Host Resilience Login Start V1 — `37399897924`
- METAENGINE Browser Self Update E2E — `37399898033`
- METAENGINE Browser Shell V1 — `37399897735`
- METAENGINE Browser Shell-First Dirty Profile V1 — `37399897756`
- METAENGINE Browser Windows Autonomous Soak V1 — `37399897697`
- R84 Desktop Convergence V1 — `37399897744`

Installed-restart preflight:

`37399894402` — SUCCESS

No known exact-head regression remains in this checkpoint.

## Evidence classification

**PREPARE_ONLY / NON-LIVE**

The journal content is a controlled synthetic fixture.

The physical Windows evidence proves:

- installed-process persistence;
- exact profile binding;
- process restart;
- durable readback;
- stale derived-proof rejection;
- no replay;
- no network/provider actuation;
- no authority escalation.

It does **not** prove that a real Agent/provider generated the useful work.

## Non-claims

This checkpoint does not prove:

- live Client goal submission;
- live ChatGPT/z.ai Agent origin;
- live repository modification by an Agent;
- live build/test repair caused by that Agent;
- live artifact acceptance;
- signed Supervisor C5 promotion;
- canonical C2 completion;
- release promotion;
- production user installation.

## Next roadmap boundary

The remaining material Client C5 exit is one bounded **LIVE Agent-driven useful-work run** whose evidence chain is:

`user goal → exact Agent origin → exact repo baseline → observed failing test → bounded edit → passing test/build → content-addressed artifact → independent verification → durable restart readback`.

The existing verifier/reference/restart/installed gates are now sufficient to consume such evidence without widening authority.

Executing that next step would create a real live Client goal/provider effect and therefore crosses the live mutation/actuation boundary.

## Checkpoint

Client C5 installed-process restart continuity:

**EVIDENCE_READY / PREPARE_ONLY**

Client C5 LIVE useful work:

**NOT_PROVEN**

Canonical C2:

**NOT_PROVEN**

Canonical promotion authority:

**false**
