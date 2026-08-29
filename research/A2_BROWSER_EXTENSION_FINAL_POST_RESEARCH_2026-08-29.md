# A2 Browser Operator — Extension Final V1 Post-Research

Date: 2026-08-29
Branch: `work/a2-browser-extension-final`
Verified architecture base: `5fcd79c4b37e862c8fb8466dae7a9e182501b559` (`R16_ADAPTIVE_ROUTER_V1`)
Target runtime/package version: `0.7.1`
Canonical roadmap state: `R_ROADMAP_COMPLETE`

## Scope

This checkpoint finalizes the **Chrome Manifest V3 extension runtime itself**. It does not create R17, does not merge the work to `main`, and does not claim Chrome Web Store publication.

The finalization line is intentionally bounded to extension code, final extension tests, final extension research, and the exact-head final workflow. The verified R16 head remains the architecture/control-plane base.

## Source-of-truth defects found during finalization

### 1. Runtime identity drift

The extension manifest and package version were already `0.7.1`, while the runtime marker and package runtime still reported `0.7.1-dev.1` and an old R4 milestone. Because the bridge reports the runtime marker with command polling, this was a real runtime-attestation drift, not a cosmetic label.

Final contract:

- `manifest.version = 0.7.1`
- `runtime-package-manifest.package_version = 0.7.1`
- `runtime-package-manifest.operator_runtime = 0.7.1`
- runtime milestone = `EXTENSION_FINAL_V1`
- roadmap state = `R_ROADMAP_COMPLETE`
- release channel = `stable`
- runtime descriptor has `authority_effect = false`

### 2. Canonical package cardinality drift

The old R4 release contract expected 46 files. R8C subsequently added `operator-typed-click-outcome.js`, making the inherited canonical closure 47 files. Historical R8C/R8D gates already expected 47, so keeping the R4 cardinality in a final release test would have encoded stale truth.

Final contract: exactly **47 canonical package files**, unique paths, no versioned runtime filenames, generated semantic compiler derived from the shared source, and no unlisted runtime files.

### 3. MV3 update-drain state was volatile

`update-manager.js` persisted update state but kept the live `draining` gate only in a service-worker global. A Manifest V3 worker can terminate after inactivity, so a worker restart during `WAITING_SAFE_BOUNDARY` could recreate the worker with `draining=false`; this could stop alarm-driven drain progress and permit `/v1/commands/next` to reach the backend again.

Final contract:

- hydrate `DRAINING` / `WAITING_SAFE_BOUNDARY` from `chrome.storage.local` on worker startup;
- recreate the drain alarm when persisted drain state exists;
- command leasing waits for hydration;
- hydration failure is fail-closed for command leasing;
- durable blockers are re-evaluated after restart;
- reload happens only at the first safe boundary.

A dedicated restart lab starts from persisted `WAITING_SAFE_BOUNDARY`, proves command leasing remains suppressed, then removes the blocker and proves exactly one safe reload.

### 4. Chrome-update lifecycle could incorrectly clear extension drain

`runtime.onInstalled` can fire because Chrome itself was updated, not only because the extension was installed/updated. An unconditional handler could therefore overwrite a live extension update drain.

Final contract: update-drain reset is allowed only for `details.reason === "install"` or `details.reason === "update"`; `chrome_update` does not clear it.

## Research basis

Primary Chrome documentation used for the final hardening:

1. **The extension service worker lifecycle** — Chrome documents that MV3 service workers can terminate after inactivity and explicitly instructs extensions to persist data instead of relying on global variables. It also shows filtering `runtime.onInstalled` to install/update cases.
   - https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

2. **chrome.runtime** — the `OnInstalledReason` enum distinguishes `install`, `update`, `chrome_update`, and `shared_module_update`.
   - https://developer.chrome.com/docs/extensions/reference/api/runtime/

3. **chrome.alarms** — Chrome recommends checking/recreating important alarms when the service worker starts; the production repeating-alarm floor is 30 seconds.
   - https://developer.chrome.com/docs/extensions/reference/api/alarms

4. **Improve extension security / Manifest V3** — extension logic must be bundled; arbitrary-string execution and remotely hosted executable code are not part of the normal MV3 extension runtime model.
   - https://developer.chrome.com/docs/extensions/develop/migrate/improve-security
   - https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code

5. **Manifest description/version constraints** — the final manifest keeps a valid integer version and a description within Chrome's documented 132-character limit.
   - https://developer.chrome.com/docs/apps/manifest/version
   - https://developer.chrome.com/docs/apps/manifest/description/

## Final exact-head verification model

`.github/workflows/a2-browser-extension-final.yml` is the canonical final gate. It must run on the exact final source head and prove all of the following before the extension checkpoint can become authoritative:

- exact R16 ancestor;
- bounded release change surface;
- no new source dependency manifests;
- JS/Python syntax;
- stable runtime/package/manifest identity;
- legacy update-manager contract **and** MV3 restart contract;
- R8C typed outcomes and R8D durable/supervisor bridge regressions;
- target-registry, supervisor, disarm, remote-authority, debugger, perception, OOPIF, and semantic-action regressions;
- deterministic canonical MV3 build twice with byte-identical ZIP output;
- exactly 47 staged files;
- generated semantic compiler provenance;
- no staged `eval`, `new Function`, streaming Wasm execution, or non-local `importScripts`;
- pinned Chromium harness;
- real two-boot persistent-profile cold-restart proof;
- pairing secret absent from `chrome.storage.local`;
- real staged-extension physical click canary ending in typed `COMMITTED` and exactly one observed page click;
- `automatic_retry_allowed = false`;
- `authority_effect = false`;
- Chromium CRX pack;
- deterministic evidence bundle, hashes, build provenance attestation, and retained artifact.

## Safety invariants retained

- `MANY_AGENTS_MAY_THINK_ONE_ACTUATOR_MAY_EFFECT`
- `ONE_RESOURCE_ONE_ACTUATION_LEASE`
- `NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT`
- `PRE_ACTUATION_DURABLE_BEFORE_EFFECT`
- `PAGE_DATA_HAS_ZERO_AUTHORITY`
- `REMOTE_CODE_IS_NEVER_EVALLED_IN_EXTENSION`
- `TARGET_BINDING_IS_EXACT`
- `LIVE_REVALIDATION_BEFORE_ACTUATION`
- `MV3_IS_EXECUTOR_NOT_DURABLE_BRAIN`
- `PROVIDER_NAMES_ARE_POLICIES_NOT_ARCHITECTURE`

Additional final-extension invariants:

- `EXTENSION_RUNTIME_IDENTITY_IS_SINGLE_STABLE_VERSION`
- `FINAL_PACKAGE_CLOSURE_IS_EXACT_AND_REPRODUCIBLE`
- `UPDATE_DRAIN_SURVIVES_MV3_WORKER_RESTART`
- `UPDATE_DRAIN_HYDRATION_FAILS_CLOSED_FOR_NEW_COMMAND_LEASES`
- `CHROME_UPDATE_CANNOT_CLEAR_EXTENSION_UPDATE_DRAIN`
- `FINAL_GATE_TESTS_STAGED_EXTENSION_NOT_SOURCE_DIRECTORY_SHORTCUTS`
- `FINAL_GATE_RETAINS_REAL_PHYSICAL_EFFECT_PROOF`

## Explicit non-claims

This finalization does **not** claim:

- merge into protected `main`;
- Chrome Web Store publication or store review completion;
- arbitrary webpage exactly-once transaction semantics;
- that a Manifest V3 worker is the durable brain;
- that a successful `mousePressed`/`mouseReleased` acknowledgement proves an arbitrary webpage's business-level effect exactly once;
- automatic retry after an ambiguous effect.

The extension may be called canonical **source/CI/artifact final** only after the final documentation head itself passes the exact-head workflow and its artifact/provenance metadata are recorded.
