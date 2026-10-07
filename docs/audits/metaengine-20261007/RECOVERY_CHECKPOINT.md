# METAENGINE live recovery — 2026-10-07

Goal: continuous autonomous development through the existing durable scheduler, coordinated agents, verified artifacts and bounded self-improvement. Canonical compute order remains R1 → C1 → C2. Client C4_TYPED_PRODUCT_CONTROL is a separate namespace.

## Correction to the initial audit

The initial inventory queried public/private and omitted destruktion_meta. Its claim that the selected recovery project lacks roadmap authority/continuity is incorrect. Fresh readback in jhriwwsryeqsvvvufkok found the authority and fleet/plan/task substrate in destruktion_meta. Original Foundation connectivity was unavailable; the selected live project itself does have current authority.

Authority: METAENGINE_CLIENT_V1 / metaengine-client-v1; C4_TYPED_PRODUCT_CONTROL; integration work/client-v1-c4-typed-goal-bridge-v1; baseline 1fde1e53549eafefd6c28b50cdcd384e86d14512; alignment epoch 3. The durable plan watermark was 8 despite found=false. It was not reset to zero.

## Live repairs

Stable Edge v14 failed exact capability attestation because an old imported contract omitted computer_authority_plane_v1. Minimal v15 repaired runtime-capability-health and cognitive SYSTEM support pins to 6aeea9f68fa91ef38f4d0aea4eddaf1e4d29c0f9. v15 digest c684dbeec6d83a1fd407c786c4bf1ff42be25ee5843f6903701df4db299a70c0. Public health returned HTTP200, runtime_ready=true, ATTESTED / EXACT_DB_SOURCE_MATCH.

The cognitive acceptor RPC was absent. Added strict projected-event validation, service-only cursor with RLS, device/workspace/revocation binding, row-locked monotonic cursor, replay digest, exact duplicate ACK and gap/overlap fences. Production realtime.send swallows errors and assigns a row UUID independent of payload.id. Initial fail-closed probes exposed both behaviors.

The managed Realtime table initially had no message partitions and channel join returned MissingPartition. Later readback found five partitions and the service-role live cognitive probe persisted a broadcast. No managed Realtime DDL was applied. Recovery must not depend on permanent Realtime availability: one bounded latest batch and its cursor now persist atomically, while broadcast status remains explicit. Consumers outside the retained range require the existing full-state path; this is not a complete event history or subscriber-delivery proof.

Native issuer now includes ten already-implemented READ_ONLY actions while preserving existing mutation validation, exact client binding, freshness and idempotency. Six issued diagnostics completed on the installed Client.

Meta task admission previously discarded claim_class and queue defaulted to MUTATING. Primary READ_ONLY is now preserved, invalid classes are rejected, and audit companions are READ_ONLY. A BEGIN/ROLLBACK real-plan admission probe returned matching READ_ONLY in both row and task_spec.

The new Edge candidate projects durable fallback metadata and selects the actual live roadmap namespace metaengine-client-v1 for DevOS. It preserves the existing native scheduler and signed-device authentication.

## Client source changes

Installed Client remains immutable source be5e84a0524aece3f5ba1a5d84c09f38b05e4d8c / version 0.7.0-dev.37493000001.1. It had permanently disabled cognitive transport at startup after HTTP501.

New candidate version 0.7.0-dev.37591000001.1:
- event-triggered route recovery after a bounded cooldown; no new timer or command scheduler;
- exact durable ACK still advances a cursor, but absence of Realtime retains full-state fallback;
- typed objective compiler preserves READ_ONLY before RPC;
- inherited state-plane single-writer repair from #1137 is included in this source.

These changes require a newly built and physically qualified Client. Source/CI success is not installed proof.

## Trial

An operator-authorized three-node plan was compiled against fresh authority, generation 9:
1. PLANNER: fixed sum-of-squares test [2,3,5], COORDINATION_PLAN_OK.
2. RESEARCHER: independent computation/negative case, dependent on planner.
3. CRITIC: failure-mode review, dependent on researcher.

All nodes READ_ONLY, plain text only, <=120 words; no files/Git/DB/releases/navigation changes; no ambiguous-send retry. Existing client goal RPC only supports a single point. The official Meta activation/admission RPCs were used atomically for the graph and its first node.

First task 8167889f-6d9e-482c-a1d1-6895c0a510c9, point live.coordination.20261007.plan.v1, spec sha256 ea1e7021ea4899494a3846480381e1d3c7e803a4d8c80375e411805cc58f0016.

Admission resumed through devos_environment_resume_v1 with exact generation_floor=28. Earlier historical READY task 95169823-4662-4326-a4b1-c8975f3f7f92 is also a bounded READ_ONLY text smoke. Other eight historical tasks remain FENCED. No task was marked complete without execution proof.

Latest readback before publication: both tasks READY, lease_generation=0, no result. Four agents BOUND_UNVERIFIED / zero ACTIVE. Native DevOS dispatch and transport promotion remain unproven. Initial diagnosis suggests idle-work admission may be yielding before transport promotion; this is not yet a proven root cause.

## Validation matrix

| Mechanic | Evidence | Status |
|---|---|---|
| Stable capability contract | live HTTP200 exact DB match | PASS v15 |
| Device auth / enrolled ADMIN | signed installed command receipts, fresh heartbeat | PASS |
| Native issue → lease → result | six diagnostics COMPLETED / READ_ONLY | PASS |
| Browser composer/login observation | CAPTURE, signed-in composer | PASS; no sidebar content retained |
| Cognitive SQL validation/privacy/replay/gaps/RLS | PGlite PostgreSQL18.3, 36 cases | PASS |
| Read-only issuer parity/idempotency/freshness | real PG engine, 14 cases | PASS |
| Cognitive live service role | rollback probe with exact persisted batch and cursor | PASS |
| Typed read-only admission | real Meta-plan rollback probe | PASS |
| Client recovery/typed compiler | 31 targeted tests | PASS locally |
| Entire Browser suite | 4266 tests; 4252 pass, 10 fail, 4 skip | IPC failures in restricted environment; CI required |
| Guardian service ownership | EPERM named pipe; HOLD | BLOCKED |
| Agent transport bootstrap | BOUND_UNVERIFIED / dispatch zero | BLOCKED |
| Actual coordinated task/result | READY, no lease/result | UNPROVEN |
| Coding sandbox execution | sandbox_backend_bound=false, prepare_only=true | NOT IMPLEMENTED/BOUND |
| Candidate artifact promotion | no qualified physical candidate | UNPROVEN |
| RSI/model learning | source contracts only | No live continuous-learning proof |
| Continuous restart/soak | historical ambiguity remains | Physical qualification required |

Original local full-suite logs are in blocker-repair-20261007. Local exec-server became unavailable during development; source was reconstructed from exact GitHub base and current live function definitions, then saved through GitHub. Reconstructed files are to be re-qualified by exact-head CI; previous local counts are not automatically attributed to subsequent changes.

## Next verification

The new recovery workflow runs the entire Browser test directory on Ubuntu24 and Windows2025 and SQL fixtures on real PostgreSQL17.11. Existing package workflow is expected to build the fresh version and produce immutable artifact provenance. Inspect all jobs at the exact head; fix failures before declaring readiness.

Keep Guardian HOLD truthful. Native installation/UAC and service-account access cannot be simulated by unit tests. Require fresh installed source/version/installer evidence, successful transport bootstrap, RUNNING→COMPLETED with durable result, independent verifier evidence, and controlled restart/rollback before claiming autonomous continuous development. Sandbox execution C1/C2 still needs an actual admitted worker and isolated executable artifact environment.

## First exact-head CI readback

Head ee91bc3efb755bac6dc9ff34908b532ecc9d95b4: PostgreSQL17.11 SQL SUCCESS; Browser Linux 4264 PASS, one stale reservation mismatch, four platform skips; Windows 4268 PASS, the same reservation mismatch, zero skips. Real native IPC failures from the restricted environment did not reproduce. Corrected active reservation and advanced version again rather than reuse a source-changing candidate identity. New exact-head CI remains required.

Historical R83 v14 source-equivalence workflow failed its explicit full Edge/migration equality check against its older source pin. The old manifest is preserved. This new recovery subject is not qualified as the historical unchanged canary, and that failure is not counted as successful qualification.
