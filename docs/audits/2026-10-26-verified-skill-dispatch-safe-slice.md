# Verified-skill dispatch: narrow production composition

Status: **EVIDENCE_READY / SYNTHETIC composition verification**, not live activation or measured learning.

Roadmap: supports canonical **C2 — First Serial Coding Loop**, specifically the existing **A1_ISOLATED_WORKSPACE_AGENT_ADAPTER** dispatch/readback boundary. This does not seal C2, advance a roadmap checkpoint, assert current Supabase milestone state, or replace required live repo → edit → test → verified-artifact evidence. The Supervisor retains integration and semantic-head reconciliation.

## Traced production path and existing approval boundary

Before this change, `RsiRuntimeService.routeVerifiedSkills()` was consumed by shadow comparison only. No production task dispatch called it. `adoptVerifiedSkillLibrary()` already existed and persisted the current library through `RsiRuntimeSkillLifecycle`; existing anytime admission, exposure holds, graduation and governance still determine activity. Capsules contain immutable implementation/schema/component **digests**, not loadable instruction bodies or executable procedures.

The repository does **not** ship an independently approved verifier-checklist capsule/library or real exact-context skill-effect evidence. No such approval is manufactured here. The existing `RSI_APPROVE` operator decision is not treated as library admission or execution authority.

The new path is:

`main.mjs → NativeSupervisorClient.bindDevosVerifiedSkillDispatch → DevOsNativeTaskCycle wrapper → existing core #dispatchLease → existing renderDevosTaskPrompt → existing fenced ChatGPT submit`

The host-owned consumer reads the adopted library/governance, calls the existing router, and revalidates the same library/governance after asynchronous selection. It supports only CRITIC/FALSIFIER leases and one in-source verifier evidence-checklist implementation. Its descriptor is an **implementation adapter, not an approval manifest or trust root**.

## Admission and fail-closed behavior

Selection requires all of:

- current adopted, digest-verified library and active composition governance;
- exact immutable skill id/version and implementation/input/output-schema digests;
- exact existing read/check capabilities, installed-source identity, and sufficient capsule context budget;
- one existing router selection with positive exact-task/environment/model-policy evidence, zero exact-context negative evidence, no exploration;
- current `SKILL_ROUTING` permission from the existing operator steering surface.

Only fixed in-source instructions (less than 1,200 characters including identity) enter the prompt. Model/page/task/library text cannot supply instruction bodies, implementation code, skill approval, capability expansion or alternate policy. No eval, dynamic imports, new executor, scheduler, credentials, model weight changes, external writes or authority root were introduced. Existing task, transport, generation and effect-journal fences remain in force.

Absent, malformed, stale-source, unsupported, held, evidence-negative, paused or unavailable skill state uses the baseline prompt. Total prompt size remains capped at 24,000 characters; the optional block is omitted if it will not fit. Approval is rechecked before the existing write-ahead path. A revocation during typed-draft preparation refuses the send at the existing fence; it never retries or silently changes an already fenced draft.

The router's existing state-file writer is serialized to support parallel production callers without shared `.tmp` races. This is persistence serialization, not task/effect scheduling. A failed write poisons that writer until validated restart rather than blindly replaying an uncertain write.

## Lineage is not skill-effect acceptance

The existing durable RSI ledger receives bounded digest-only events:

1. `SELECTED` — current router/library selection;
2. `LOADED` — supported immutable instruction bytes resolved;
3. `APPLIED_TO_PROMPT` — actual composed prompt digest (not proof of model obedience);
4. `DELIVERY_OBSERVED` — existing browser send proof and matching prompt digest;
5. `OUTCOME_OBSERVED` — task result/transport observation, including ambiguity.

Every event explicitly says `independent_skill_effect_accepted:false`, `credit_assigned:false`, `weight_training:false` and zero authority. A sent prompt, RESULT_READY/COMPLETED claim or model text never earns helpfulness credit, changes governance or updates model weights. The in-memory pending lineage map is bounded to 128 observational rows, not 128 agents/tasks. Capacity eviction writes `TRACKING_RELEASED` with outcome `UNOBSERVED`, no task/effect change and `unknown_effect_resolved:false`; original durable lineage is retained. A late outcome/restart may recover only delivery-backed lineage from the last 256 verified runtime-ledger events. APPLIED-only, discarded, older or absent records remain unattributed; cache cleanup never resolves an unknown effect or authorizes replay.

## Evidence and remaining blocker

Tests instantiate the real RSI service, adopt **synthetic test-only** capsules, create existing receipt-bound credited evidence, and run the real task-cycle wrapper/core through fenced submit. They cover selection/application/delivery/outcome, no approval, no contextual evidence, negative/wrong-context evidence, unsupported implementation/version/capabilities, stale source, corrupted approval, pause, revocation before and during drafting, audit failure, uncertain send, and eight concurrent production compositions. These fixtures prove code composition and failure behavior only, never production skill quality or provenance.

**Exact live blocker:** a separately authorized library owner/evaluator must supply a real immutable approved capsule for the supported implementation and genuine task/environment/model-policy-bound evidence through the existing admission/credit custody. No authenticated production approval/content/evaluator producer for this adapter was found in the traced dispatch path. Independent skill-effect acceptance still requires the existing evaluator/holdout/credit gates; this consumer does not manufacture them. ChatGPT's account-selected model policy token is not proof of a particular underlying model version. Native Codex CLI dispatch and arbitrary skill execution are outside this narrow browser-verifier slice.

## Local verification

- `node --test apps/metaengine-browser/test/rsi-*.test.mjs apps/metaengine-browser/test/devos-native-task-cycle.test.mjs` — 831 passed, including 26 new composition/negative tests.
- Focused runtime/router/lifecycle/library/steering/native-supervisor regression set — passed.
- `node apps/metaengine-browser/scripts/check-source.mjs` — `source_checks_passed:240`; explicit `node --check` also covered the new adapter and changed main entry.
- `git diff --check` — clean.

Packaging/source inventory refresh and publication/CI remain the integrator's responsibility. No package version, release manifest, live DB, user PC, model, credentials or remote branch was modified by this workstream.


## Observational-cache follow-up

A production-composition regression reproduced a real availability leak: after `applied()` records the composed prompt, failure of the post-send `CAPTURE` exits dispatch without an outcome callback. Repeating that lifecycle for 128 distinct leases exhausted the old observation map; the 129th eligible task then used baseline forever. Abandoned/expired tasks could similarly leave observational rows behind. This is not task/effect-journal ownership.

The fix removes cache occupancy from skill eligibility. Serialized metadata bookkeeping releases oldest tracking when necessary and records an explicitly unresolved audit event without deleting durable earlier lineage. A failed release audit drops only ephemeral metadata in `finally` (the original APPLIED record was durable before insertion); it does not retry that write or claim an audit/effect outcome. Later healthy tasks can use a freed observation slot. No task-cycle, lease, scheduler, authority or effect-journal code changed in this follow-up.

Independent adversarial review exposed two important recovery boundaries, now covered: an evicted row must still accept a durable COMPOSITION_DISCARDED audit so it cannot resurrect; a crash after APPLIED but before send must not associate a restarted baseline result with the old skill prompt. Recovery therefore requires prior durable delivery evidence, or the existing delivery callback's exact original prompt-hash proof. Unknown APPLIED-only rows remain unobserved even if a later task result arrives, including retained rows when a new same-process cycle dispatches baseline after a pre-send failure. Only an AMBIGUOUS observation of a still-tracked attempt may be noted without a delivery binding. Successful delivery-backed recovery is observation only, never evidence that the skill helped or was followed.

Additional regressions cover 128 failed post-send readbacks plus subsequent eligible tasks, capacity bounds, release-write failure without permanent veto, evicted discard, late unproven outcomes, delivery-backed eviction/restart, source/lease/target mismatch, terminal non-resurrection, and the pre-send crash window.

An additional production-composition regression injects the real disposable DevOsEffectDeliveryJournal: post-send CAPTURE failure leaves DELIVERY_PENDING; subsequent observation eviction/discard leaves the journal file byte-identical, reload retains the unresolved candidate with automatic retry disabled, and exactly one synthetic click occurred. Independent review confirmed these boundaries.
