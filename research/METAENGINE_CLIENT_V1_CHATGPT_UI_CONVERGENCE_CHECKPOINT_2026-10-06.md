# METAENGINE Client V1 — ChatGPT Primary UI Convergence Checkpoint

Date: 2026-10-06  
Status: **SOURCE_REQUALIFICATION_REQUIRED — C4 STALE BRANDING ASSERTION REPAIRED / NOT YET PHYSICALLY INSTALLED**  
Branch: `work/client-v1-chatgpt-ui-convergence-v1`  
Qualified source head before package reservation: `2e6570ce69986a51caea3ed61dffb44644ec0310`  
Parent LIVE-development candidate: `e2e8f20e5d6abf0f84bf163066ed3ec15b69298a` / `0.7.0-dev.37416000001.1`

## Roadmap reconciliation

Canonical owner remains **C2 — First Serial Coding Loop**.

This slice corrects the primary ME2 presentation/execution alignment before the first real LIVE useful-work loop.

It does not change Client goal authority, wake/recovery semantics, signed useful-work proof schemas, Supervisor trust-root semantics, release authority or automatic retry behavior.

## Legacy shell retirement correction

The operator clarified that `metaengine-dark-workspace-v2` is not a supported recovery UI; it is an obsolete product UI that must not remain packaged.

The source successor therefore removes:

- `apps/metaengine-browser/ui/index.html`;
- `ui/app.js`;
- `ui/app.css`;
- `ui/dark-workspace.css`;
- obsolete tests and visual harnesses that asserted that renderer;
- `ui/**/*` from electron-builder package inputs;
- runtime `metaengine://shell/` routing;
- Package Smoke's legacy-shell visual capture.

Recovery is now a generated, read-only `metaengine://recovery/` document. It has no execution controls and is not a second product workspace.

## Root cause

The installed Browser candidate was not serving the dark recovery shell as its normal workspace.

Normal startup correctly selected the packaged ME2 gateway as primary.

The semantic regression was inside that primary ME2 bundle itself:

- hard-coded `GLM-5.3-Flash` label;
- visible `z.ai Agent` / `chat.z.ai` wording;
- primary workflow hint identifying a native z.ai fleet;
- command-palette entry for a native z.ai fleet;
- Supervisor page exposing active legacy `probe` and `upgrade fleet` mutations through `mcxOp("glm", ...)`;
- direct dependency on `z-ai-web-dev-sdk`;
- dead `agent-factory/bootstrap.ts` containing a GLM bootstrap and local vault/service-role/GitHub credential composition path.

The Browser execution/runtime plane had already converged to the ChatGPT/OpenAI-only fleet, so UI and execution semantics had diverged.

## Corrections

### Primary workspace

The primary shell now presents:

- `ChatGPT` as the stable product/provider label;
- `Verified ChatGPT Agent` for verified Agent-origin readback;
- `Open an existing ChatGPT agent conversation` in the session dialog.

No concrete GPT model/version is hard-coded into the primary UI.

The historical wire token:

`ZAI_AGENT_SURFACE_CAUSAL_V1`

is deliberately retained as a compatibility/readback contract token only. It is not user-facing branding.

### Workflow/store/palette

Primary workflow/store hints now describe the native **ChatGPT agent fleet**.

The command palette now opens the native ChatGPT agent fleet rather than a z.ai fleet.

### Agent chat panel

The historical `chat.z.ai` explanatory title was replaced with provider-neutral persistent-conversation wording.

### Legacy provider telemetry

The existing backend `GET /glm?XTransformPort=3041` readback remains available because it is historical telemetry.

The UI now labels the section:

`LEGACY PROVIDER · REVIEWS`

and explicitly marks it:

`legacy · read-only`

Removed from the UI:

- GLM probe mutation;
- GLM fleet upgrade mutation;
- `mcxOp("glm", ...)`;
- corresponding probe/upgrade buttons.

The independent review action remains intact and explicit.

### Dependency / dead source cleanup

Removed:

`z-ai-web-dev-sdk@0.0.18`

from both `package.json` and the exact Bun lock.

The package had no transitive dependency subtree in this lock and no active source import.

Deleted dead source:

`apps/me2-ui/src/lib/agent-factory/bootstrap.ts`

That file was not referenced by the current app tree and contained obsolete GLM/vault bootstrap logic.

## Fail-closed contract

New contract:

`apps/metaengine-browser/test/me2-ui-chatgpt-convergence.test.mjs`

It proves:

1. primary shell is ChatGPT-aligned;
2. no hard-coded GPT model version is present;
3. historical Agent-origin proof token remains wire-compatible;
4. legacy provider telemetry is GET/read-only;
5. no GLM probe/upgrade mutation remains;
6. source tree contains no banned legacy provider branding/actions;
7. Z.ai SDK is absent from package + lock;
8. dead agent-factory bootstrap is absent.

Compiled-output CI also scans `.next` for:

- `GLM-5.3-Flash`;
- `z.ai Agent`;
- `chat.z.ai`;
- `upgrade флот`;
- `Снять живую пробу GLM`;
- `z-ai-web-dev-sdk`.

## Qualification lineage

### First source run

Run:

`37433449834`

Result:

**FAIL**

The broad tree scan found one remaining legacy command-palette label:

`Open native z.ai Agent fleet`

No dependency install or build ran after that failure.

The test was not weakened.

### Corrected source run

Run:

`37433550089`

Job:

`112169785397`

Exact source:

`2e6570ce69986a51caea3ed61dffb44644ec0310`

Conclusion:

**SUCCESS**

All substantive steps succeeded:

- exact-head checkout;
- Node 24.21.0;
- Bun 1.3.3;
- ChatGPT UI source contract;
- `bun install --frozen-lockfile`;
- full Next build;
- compiled-output legacy-provider scan;
- source-input immutability check.

## Amplifier research — stable ChatGPT branding

Current OpenAI documentation explicitly notes that model availability and underlying model assignments vary by workspace, rollout and time.

Therefore the UI should not encode a concrete model version as product identity.

Applied rule:

`stable UI identity = ChatGPT / Agent`

while concrete model names, if needed, remain runtime telemetry.

References:

https://help.openai.com/en/articles/12003714-chatgpt-business-models-and-limits

https://help.openai.com/en/articles/11165333-chatgpt-enterprise-and-edu-models-limits

## Typed Workspaces stale-test correction

After reopening PR #1133, Browser Typed Workspaces run `37435008436` failed exactly one test.

The failing test still read the retired file:

`apps/metaengine-browser/ui/app.js`

This was a stale test dependency, not a runtime regression. The test is now rebound to the current architecture:

- `preload-shell.cjs` must accept only bounded, non-authority DevOS projections;
- current ME2 store may use the presentation bridge but may not reconstruct durable workspace bindings;
- `workspace_bindings`, `lease_current`, exact binding target/generation and current command payload remain absent from renderer-visible sources.

Because package identity `0.7.0-dev.37435000001.1` had already passed Package Smoke identity preflight, it is treated as consumed. The repaired source advances to `0.7.0-dev.37436000001.1`.

## C4 stale branding assertion correction

After the legacy-shell retirement source was reopened as PR #1133, exact-head C4 Goal Contracts run `37476944921` passed 87/88 tests.

The single failure was a stale presentation assertion in:

`apps/metaengine-browser/test/client-v1-agent-origin-result-proof.test.mjs`

It still required:

`Verified z.ai Agent`

while the primary ME2 product UI now intentionally renders:

`Verified ChatGPT Agent`

The underlying historical proof contract token `ZAI_AGENT_SURFACE_CAUSAL_V1` remains unchanged for wire/readback compatibility. Only the user-facing assertion is corrected.

Package Smoke run `37476944927` had already passed identity preflight for `0.7.0-dev.37436000001.1` before its Windows job stopped at duplicate source/version protection. No NSIS build from that run is accepted, but the identity is treated as consumed.

Fresh successor identity:

`0.7.0-dev.37437000001.1`

## Non-claims

This checkpoint does not prove:

- installed Windows behavior of the corrected ME2 bundle;
- physical UI appearance on the operator machine;
- real LIVE Agent useful work;
- recovery-state clearance;
- production release;
- canonical C2 completion.

## Package identity boundary

The previously qualified Browser package:

`0.7.0-dev.37416000001.1`

is immutable and remains bound to source:

`e2e8f20e5d6abf0f84bf163066ed3ec15b69298a`

It MUST NOT be rebuilt or relabelled with this UI correction.

Intermediate identity `0.7.0-dev.37434000001.1` reached PR Package Smoke preflight before complete legacy-shell retirement and is treated as potentially consumed.

Fresh final identity after the C4 stale-branding correction:

`0.7.0-dev.37437000001.1`

Before reopening PR #1133, the final source must re-pass the source-only convergence workflow with:

- full Browser `npm run check`;
- ChatGPT UI convergence contract;
- legacy shell bundle retirement contract;
- shell-first startup boundary;
- Browser navigation policy;
- frozen Bun install + full Next build;
- compiled-output legacy-provider scan.

Only that exact head may enter Package Smoke.

## Checkpoint

ChatGPT primary UI source convergence:

**EVIDENCE_READY / SOURCE_ONLY**

Legacy provider UI mutations:

**REMOVED**

Legacy telemetry:

**READ_ONLY**

Z.ai SDK dependency:

**REMOVED**

Installed corrected package:

**NOT_YET_PROVEN**

Real LIVE useful work:

**NOT_PROVEN**

Canonical C2:

**NOT_PROVEN**

Promotion authority:

**false**


## Final source-only gate and physical reservation

Final source before physical reservation:

`dc76192e9a8ed269c62355464c36b96048a67732`

Source-only workflow:

`Client V1 ChatGPT UI Convergence`

Run:

`37484297121`

Job:

`112340249904`

Conclusion:

**SUCCESS**

This exact source passed:

- Browser parse/check without retired shell inputs;
- ChatGPT UI + legacy-shell retirement contracts;
- full Browser Node regression;
- frozen Bun 1.3.3 dependency install;
- full ME2 Next build;
- compiled primary-UI scan proving no legacy provider branding/mutations;
- source-input immutability verification.

The earlier package identity `0.7.0-dev.37437000001.1` is now explicitly **CONSUMED** because Package Smoke run `37477684780` published and sealed its immutable reservation before failing at an old visual-evidence step. It must not represent the later source.

Fresh exact-source package reservation:

`0.7.0-dev.37485000001.1`

This reservation commit changes no ME2 or Browser runtime source. It only advances package identity, package-lock root metadata, convergence ledger and this checkpoint.

The deprecated `metaengine-dark-workspace-v2` is not a fallback and is not retained anywhere in the current source/package surface.


## Windows Electron materialization correction

Package Smoke run:

`37487078168`

Exact source:

`540f83c48501ca27a893cfcc4b62ea28e7c4f228`

Consumed package identity:

`0.7.0-dev.37485000001.1`

Immutable reservation artifact:

`11424395709`

Reservation digest:

`sha256:b370faf8f67ebfeca9c0ecab65825bc41479db5c2d4175389be4cd867cdea1c1`

The Windows producer passed identity preflight, duplicate protection, reservation publication/seal, package-lock proof and dependency install. It then failed before visual evidence at:

`Materialize exact Electron runtime for physical UI evidence`

Observed failure:

`$binaryVersion = [string](& $electron --version)`

returned a null value even though the executable invocation itself did not report a non-zero exit. PowerShell then failed on `$binaryVersion.Trim()`.

This is a harness defect: a Windows GUI-subsystem executable is not a reliable stdout version probe.

The corrected producer now requires:

- Electron package metadata version = `44.0.0`;
- materialized `electron.exe` exists;
- Windows PE `ProductVersion` matches `44.0.0` or `44.0.0.0`;
- SHA-256 of the materialized executable is a valid 64-hex digest;
- `authority_effect=false`.

Fresh successor identity:

`0.7.0-dev.37490000001.1`

No installer from `0.7.0-dev.37485000001.1` is accepted.


## Workflow validation correction before physical reservation

Commit:

`a5628c46c9632ef97ba9b1236be964fc40a12125`

GitHub run:

`37487828226`

Result:

**FAIL / WORKFLOW VALIDATION**

The run contained zero jobs, so it did not execute package identity preflight, did not publish a reservation artifact and did not start a Windows runner. Therefore `0.7.0-dev.37490000001.1` remains unconsumed.

Root cause: JavaScript replacement-string semantics interpreted the literal PowerShell `

Correction: reconstruct the workflow from the last valid `540f83c4…` file and apply the block with a function-valued replacer so `# METAENGINE Client V1 — ChatGPT Primary UI Convergence Checkpoint

Date: 2026-10-06  
Status: **SOURCE_REQUALIFICATION_REQUIRED — C4 STALE BRANDING ASSERTION REPAIRED / NOT YET PHYSICALLY INSTALLED**  
Branch: `work/client-v1-chatgpt-ui-convergence-v1`  
Qualified source head before package reservation: `2e6570ce69986a51caea3ed61dffb44644ec0310`  
Parent LIVE-development candidate: `e2e8f20e5d6abf0f84bf163066ed3ec15b69298a` / `0.7.0-dev.37416000001.1`

## Roadmap reconciliation

Canonical owner remains **C2 — First Serial Coding Loop**.

This slice corrects the primary ME2 presentation/execution alignment before the first real LIVE useful-work loop.

It does not change Client goal authority, wake/recovery semantics, signed useful-work proof schemas, Supervisor trust-root semantics, release authority or automatic retry behavior.

## Legacy shell retirement correction

The operator clarified that `metaengine-dark-workspace-v2` is not a supported recovery UI; it is an obsolete product UI that must not remain packaged.

The source successor therefore removes:

- `apps/metaengine-browser/ui/index.html`;
- `ui/app.js`;
- `ui/app.css`;
- `ui/dark-workspace.css`;
- obsolete tests and visual harnesses that asserted that renderer;
- `ui/**/*` from electron-builder package inputs;
- runtime `metaengine://shell/` routing;
- Package Smoke's legacy-shell visual capture.

Recovery is now a generated, read-only `metaengine://recovery/` document. It has no execution controls and is not a second product workspace.

## Root cause

The installed Browser candidate was not serving the dark recovery shell as its normal workspace.

Normal startup correctly selected the packaged ME2 gateway as primary.

The semantic regression was inside that primary ME2 bundle itself:

- hard-coded `GLM-5.3-Flash` label;
- visible `z.ai Agent` / `chat.z.ai` wording;
- primary workflow hint identifying a native z.ai fleet;
- command-palette entry for a native z.ai fleet;
- Supervisor page exposing active legacy `probe` and `upgrade fleet` mutations through `mcxOp("glm", ...)`;
- direct dependency on `z-ai-web-dev-sdk`;
- dead `agent-factory/bootstrap.ts` containing a GLM bootstrap and local vault/service-role/GitHub credential composition path.

The Browser execution/runtime plane had already converged to the ChatGPT/OpenAI-only fleet, so UI and execution semantics had diverged.

## Corrections

### Primary workspace

The primary shell now presents:

- `ChatGPT` as the stable product/provider label;
- `Verified ChatGPT Agent` for verified Agent-origin readback;
- `Open an existing ChatGPT agent conversation` in the session dialog.

No concrete GPT model/version is hard-coded into the primary UI.

The historical wire token:

`ZAI_AGENT_SURFACE_CAUSAL_V1`

is deliberately retained as a compatibility/readback contract token only. It is not user-facing branding.

### Workflow/store/palette

Primary workflow/store hints now describe the native **ChatGPT agent fleet**.

The command palette now opens the native ChatGPT agent fleet rather than a z.ai fleet.

### Agent chat panel

The historical `chat.z.ai` explanatory title was replaced with provider-neutral persistent-conversation wording.

### Legacy provider telemetry

The existing backend `GET /glm?XTransformPort=3041` readback remains available because it is historical telemetry.

The UI now labels the section:

`LEGACY PROVIDER · REVIEWS`

and explicitly marks it:

`legacy · read-only`

Removed from the UI:

- GLM probe mutation;
- GLM fleet upgrade mutation;
- `mcxOp("glm", ...)`;
- corresponding probe/upgrade buttons.

The independent review action remains intact and explicit.

### Dependency / dead source cleanup

Removed:

`z-ai-web-dev-sdk@0.0.18`

from both `package.json` and the exact Bun lock.

The package had no transitive dependency subtree in this lock and no active source import.

Deleted dead source:

`apps/me2-ui/src/lib/agent-factory/bootstrap.ts`

That file was not referenced by the current app tree and contained obsolete GLM/vault bootstrap logic.

## Fail-closed contract

New contract:

`apps/metaengine-browser/test/me2-ui-chatgpt-convergence.test.mjs`

It proves:

1. primary shell is ChatGPT-aligned;
2. no hard-coded GPT model version is present;
3. historical Agent-origin proof token remains wire-compatible;
4. legacy provider telemetry is GET/read-only;
5. no GLM probe/upgrade mutation remains;
6. source tree contains no banned legacy provider branding/actions;
7. Z.ai SDK is absent from package + lock;
8. dead agent-factory bootstrap is absent.

Compiled-output CI also scans `.next` for:

- `GLM-5.3-Flash`;
- `z.ai Agent`;
- `chat.z.ai`;
- `upgrade флот`;
- `Снять живую пробу GLM`;
- `z-ai-web-dev-sdk`.

## Qualification lineage

### First source run

Run:

`37433449834`

Result:

**FAIL**

The broad tree scan found one remaining legacy command-palette label:

`Open native z.ai Agent fleet`

No dependency install or build ran after that failure.

The test was not weakened.

### Corrected source run

Run:

`37433550089`

Job:

`112169785397`

Exact source:

`2e6570ce69986a51caea3ed61dffb44644ec0310`

Conclusion:

**SUCCESS**

All substantive steps succeeded:

- exact-head checkout;
- Node 24.21.0;
- Bun 1.3.3;
- ChatGPT UI source contract;
- `bun install --frozen-lockfile`;
- full Next build;
- compiled-output legacy-provider scan;
- source-input immutability check.

## Amplifier research — stable ChatGPT branding

Current OpenAI documentation explicitly notes that model availability and underlying model assignments vary by workspace, rollout and time.

Therefore the UI should not encode a concrete model version as product identity.

Applied rule:

`stable UI identity = ChatGPT / Agent`

while concrete model names, if needed, remain runtime telemetry.

References:

https://help.openai.com/en/articles/12003714-chatgpt-business-models-and-limits

https://help.openai.com/en/articles/11165333-chatgpt-enterprise-and-edu-models-limits

## Typed Workspaces stale-test correction

After reopening PR #1133, Browser Typed Workspaces run `37435008436` failed exactly one test.

The failing test still read the retired file:

`apps/metaengine-browser/ui/app.js`

This was a stale test dependency, not a runtime regression. The test is now rebound to the current architecture:

- `preload-shell.cjs` must accept only bounded, non-authority DevOS projections;
- current ME2 store may use the presentation bridge but may not reconstruct durable workspace bindings;
- `workspace_bindings`, `lease_current`, exact binding target/generation and current command payload remain absent from renderer-visible sources.

Because package identity `0.7.0-dev.37435000001.1` had already passed Package Smoke identity preflight, it is treated as consumed. The repaired source advances to `0.7.0-dev.37436000001.1`.

## C4 stale branding assertion correction

After the legacy-shell retirement source was reopened as PR #1133, exact-head C4 Goal Contracts run `37476944921` passed 87/88 tests.

The single failure was a stale presentation assertion in:

`apps/metaengine-browser/test/client-v1-agent-origin-result-proof.test.mjs`

It still required:

`Verified z.ai Agent`

while the primary ME2 product UI now intentionally renders:

`Verified ChatGPT Agent`

The underlying historical proof contract token `ZAI_AGENT_SURFACE_CAUSAL_V1` remains unchanged for wire/readback compatibility. Only the user-facing assertion is corrected.

Package Smoke run `37476944927` had already passed identity preflight for `0.7.0-dev.37436000001.1` before its Windows job stopped at duplicate source/version protection. No NSIS build from that run is accepted, but the identity is treated as consumed.

Fresh successor identity:

`0.7.0-dev.37437000001.1`

## Non-claims

This checkpoint does not prove:

- installed Windows behavior of the corrected ME2 bundle;
- physical UI appearance on the operator machine;
- real LIVE Agent useful work;
- recovery-state clearance;
- production release;
- canonical C2 completion.

## Package identity boundary

The previously qualified Browser package:

`0.7.0-dev.37416000001.1`

is immutable and remains bound to source:

`e2e8f20e5d6abf0f84bf163066ed3ec15b69298a`

It MUST NOT be rebuilt or relabelled with this UI correction.

Intermediate identity `0.7.0-dev.37434000001.1` reached PR Package Smoke preflight before complete legacy-shell retirement and is treated as potentially consumed.

Fresh final identity after the C4 stale-branding correction:

`0.7.0-dev.37437000001.1`

Before reopening PR #1133, the final source must re-pass the source-only convergence workflow with:

- full Browser `npm run check`;
- ChatGPT UI convergence contract;
- legacy shell bundle retirement contract;
- shell-first startup boundary;
- Browser navigation policy;
- frozen Bun install + full Next build;
- compiled-output legacy-provider scan.

Only that exact head may enter Package Smoke.

## Checkpoint

ChatGPT primary UI source convergence:

**EVIDENCE_READY / SOURCE_ONLY**

Legacy provider UI mutations:

**REMOVED**

Legacy telemetry:

**READ_ONLY**

Z.ai SDK dependency:

**REMOVED**

Installed corrected package:

**NOT_YET_PROVEN**

Real LIVE useful work:

**NOT_PROVEN**

Canonical C2:

**NOT_PROVEN**

Promotion authority:

**false**


## Final source-only gate and physical reservation

Final source before physical reservation:

`dc76192e9a8ed269c62355464c36b96048a67732`

Source-only workflow:

`Client V1 ChatGPT UI Convergence`

Run:

`37484297121`

Job:

`112340249904`

Conclusion:

**SUCCESS**

This exact source passed:

- Browser parse/check without retired shell inputs;
- ChatGPT UI + legacy-shell retirement contracts;
- full Browser Node regression;
- frozen Bun 1.3.3 dependency install;
- full ME2 Next build;
- compiled primary-UI scan proving no legacy provider branding/mutations;
- source-input immutability verification.

The earlier package identity `0.7.0-dev.37437000001.1` is now explicitly **CONSUMED** because Package Smoke run `37477684780` published and sealed its immutable reservation before failing at an old visual-evidence step. It must not represent the later source.

Fresh exact-source package reservation:

`0.7.0-dev.37485000001.1`

This reservation commit changes no ME2 or Browser runtime source. It only advances package identity, package-lock root metadata, convergence ledger and this checkpoint.

The deprecated `metaengine-dark-workspace-v2` is not a fallback and is not retained anywhere in the current source/package surface.


## Windows Electron materialization correction

Package Smoke run:

`37487078168`

Exact source:

`540f83c48501ca27a893cfcc4b62ea28e7c4f228`

Consumed package identity:

`0.7.0-dev.37485000001.1`

Immutable reservation artifact:

`11424395709`

Reservation digest:

`sha256:b370faf8f67ebfeca9c0ecab65825bc41479db5c2d4175389be4cd867cdea1c1`

The Windows producer passed identity preflight, duplicate protection, reservation publication/seal, package-lock proof and dependency install. It then failed before visual evidence at:

`Materialize exact Electron runtime for physical UI evidence`

Observed failure:

`$binaryVersion = [string](& $electron --version)`

returned a null value even though the executable invocation itself did not report a non-zero exit. PowerShell then failed on `$binaryVersion.Trim()`.

This is a harness defect: a Windows GUI-subsystem executable is not a reliable stdout version probe.

The corrected producer now requires:

- Electron package metadata version = `44.0.0`;
- materialized `electron.exe` exists;
- Windows PE `ProductVersion` matches `44.0.0` or `44.0.0.0`;
- SHA-256 of the materialized executable is a valid 64-hex digest;
- `authority_effect=false`.

Fresh successor identity:

`0.7.0-dev.37490000001.1`

No installer from `0.7.0-dev.37485000001.1` is accepted.


## Workflow validation correction before physical reservation

Commit:

`a5628c46c9632ef97ba9b1236be964fc40a12125`

GitHub run:

`37487828226`

Result:

**FAIL / WORKFLOW VALIDATION**

The run contained zero jobs, so it did not execute package identity preflight, did not publish a reservation artifact and did not start a Windows runner. Therefore `0.7.0-dev.37490000001.1` remains unconsumed.

Root cause: JavaScript replacement-string semantics interpreted the literal PowerShell `

 remains literal. `ProductVersion` is parsed as PowerShell `[version]`, requiring Major=44, Minor=0 and Build=0 while retaining executable presence and SHA-256 validation.
` sequence in the generated block as the special unmatched-suffix replacement token. This duplicated most of `.github/workflows/browser-windows-package-smoke.yml` and truncated the intended PE-version block, so GitHub rejected the workflow before jobs were created.

Correction: remove the fragile inline regex and parse `ProductVersion` as PowerShell `[version]`, requiring Major=44, Minor=0 and Build=0, while retaining executable presence and SHA-256 validation.


## DevOS bounded source snapshot packaging correction

Physical Package Smoke for exact head `92f9967324d5da2103c5c9d3f4b63e2b89e421f1` with consumed identity `0.7.0-dev.37490000001.1` entered run `37490042782` / Windows job `112360142997`.

The run passed exact-head checkout, package reservation publication/seal, frozen dependency proof, Electron materialization, SBOM/build-identity gates, legacy-shell retirement and the full ME2 build. It then failed at the NSIS native beforePack hook with:

`ENOENT: no such file or directory, stat 'apps/metaengine-browser/ui/app.js'`

Root cause: `apps/metaengine-browser/scripts/devos-source-snapshot-builder.cjs` still treated the deleted legacy renderer as a mandatory host-fixed source. The matching read-only descriptor in `apps/metaengine-browser/src/devos-repo-read-model.cjs` was stale as well.

This is a provenance/read-model dependency exposed by physical packaging, not a rollback of the product UI. The product/runtime/package surface already had no `apps/metaengine-browser/ui/**`.

Correction:
- the packaged source snapshot stays bounded to exactly two host-fixed files;
- the pair is now `apps/metaengine-browser/src/main.mjs` plus `apps/me2-ui/src/components/me2/shell/me2-shell.tsx`;
- DevOS read-only repo model uses the same exact pair;
- RSI/source-surface fixtures are updated;
- focused source convergence explicitly runs packaged snapshot/read-model contracts;
- tests fail closed if a fixed source path returns under `apps/metaengine-browser/ui/`.

Consumed reservation artifact: `11424936946`  
Consumed reservation digest: `sha256:a0ed8df6d7ba487de23d931a9ced8b82b7807f6e2c807b8f7148cc25552c6f1d`

Fresh successor identity: `0.7.0-dev.37491000001.1`

The failed `0.7.0-dev.37490000001.1` reservation remains immutable historical evidence and is not reused.

Checkpoint after this correction: **SOURCE_REQUALIFICATION_REQUIRED / PHYSICAL_SUCCESS_NOT_YET_PROVEN**.
