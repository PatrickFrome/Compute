# METAENGINE Client V1 — ChatGPT Primary UI Convergence Checkpoint

Date: 2026-10-06  
Status: **EVIDENCE_READY — SOURCE_ONLY / NOT YET PHYSICALLY INSTALLED**  
Branch: `work/client-v1-chatgpt-ui-convergence-v1`  
Qualified source head before package reservation: `2e6570ce69986a51caea3ed61dffb44644ec0310`  
Parent LIVE-development candidate: `e2e8f20e5d6abf0f84bf163066ed3ec15b69298a` / `0.7.0-dev.37416000001.1`

## Roadmap reconciliation

Canonical owner remains **C2 — First Serial Coding Loop**.

This slice corrects the primary ME2 presentation/execution alignment before the first real LIVE useful-work loop.

It does not change Client goal authority, wake/recovery semantics, signed useful-work proof schemas, Supervisor trust-root semantics, release authority or automatic retry behavior.

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

Fresh proposed identity for the physical successor:

`0.7.0-dev.37434000001.1`

The final collision check is delegated to the existing package-identity preflight before the sole physical producer runs.

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
