# METAENGINE H205F22 — Canonical Level-1 Roadmap

Status: **ARCHITECTURAL NORTH STAR / ANTI-DRIFT CONTRACT**

This document defines the stable, human-readable Level-1 roadmap for METAENGINE H205F22 Compute Fabric. It is intentionally more stable than the executable Supabase dependency DAG.

## Governance rule

Every implementation step, work claim, PR, evidence receipt, checkpoint and amplifier proposal MUST answer:

1. Which canonical Level-1 milestone does this advance?
2. Which acceptance criterion of that milestone does it satisfy?
3. Does it shorten or strengthen the path to a real Compute Fabric, or only add control-plane complexity?
4. Does it preserve the historical H-series invariants associated with that milestone?

The current Supabase `compute-fabric-roadmap-v1` remains the Level-2 execution DAG. Level-2 milestones are gates/submilestones and MUST NOT redefine, renumber or replace this Level-1 roadmap.

If Level-1 and Level-2 appear to conflict, work must stop at `EVIDENCE_READY` and the Supervisor must reconcile the execution DAG back to this document before mainline sealing.

## Canonical roadmap

| Order | Canonical milestone | Historical source | Required result |
| --- | --- | --- | --- |
| **R1** | Continuity Plane Adoption | H41–H49 | audit/repair, persisted-readback, restore quorum, retention |
| **C1** | **First Real Linux Worker** | H1–H13 + H175 | first real admitted `cpu-local` worker |
| **C2** | **First Serial Coding Loop** | H166/H169/H182/H188 | repo → edit → build/test → verified artifact |
| **C3** | Coding Accelerator Pack | H53/H54/H161 | uv + sccache + BuildKit/equivalent + test acceleration |
| **C4** | Cache Identity & Toolchain Equivalence | H53 | safe shared-cache reuse with explicit identity/equivalence |
| **C5** | Deterministic Parallel Planner | H55 | dependency-safe deterministic build/test shards |
| **C6** | Global Slot Broker | H56 | one CPU/RAM concurrency budget across nested tooling |
| **C7** | Trusted Telemetry | H58 | provenance-bound OTel/BEP/sccache observations |
| **C8** | Duration & Scheduler Tournament | H57/H59 | scheduling policy promoted by real evidence |
| **C9** | Transactional Work Stealing | H60 | dynamic load balancing with ownership generation/fencing |
| **C10** | Speculative Dynamic Execution | H61 | selective local/remote races only for safe work |
| **C11** | REAPI Build Farm | H40/H66/H88 | Bazel/REAPI + CAS + provider tournament + verified materialization |
| **C12** | Incremental Impact Graph | H89 | execute only affected build/tests |
| **C13** | GPU Worker Admission | H62/H90 | real admitted `gpu-local` / `gpu-remote` workers |
| **C14** | AI Serving Plane | late plan | vLLM/SGLang + optional LMCache after real GPU admission |
| **C15** | Distributed Compute | old H60+ direction | Ray/equivalent after multiple admitted workers |
| **C16** | Cluster Admission | later architecture | Kubernetes/Kueue only when real contention justifies it |
| **C17** | Economic Autoscaler | scheduler evolution | cost/perf/reliability/budget-aware scaling |
| **F1+** | Live Multi-CAT Federation | CP059–CP066 | external compute after cryptographic continuity |

## Canonical sequencing

The primary execution spine is:

`R1 → C1 → C2 → C3 → C4 → C5 → C6 → C7 → C8 → C9 → C10 → C11 → C12 → C13 → C14/C15 → C16 → C17`

`F1+` develops in parallel where safe, but production federation counts only with real external provider evidence and cryptographic continuity.

The most important near-term rule is:

> Do not substitute more scheduler/control-plane abstraction for C1 and C2. The project must first obtain a real Linux worker and then a real serial coding loop.

## Level-2 execution DAG mapping

The current Supabase roadmap is subordinate to this map:

| Level-2 milestone | Canonical Level-1 owner | Role |
| --- | --- | --- |
| `B0_CONTROL_TRUST_BASELINE` | precondition | trust baseline supporting all canonical milestones |
| `R1_CONTINUITY_PLANE_ADOPTION` | **R1** | implementation gate |
| `R2_TWO_DOMAIN_PERSISTED_READBACK` | **R1** | acceptance gate |
| `R3_RESTORE_DRILL_QUORUM` | **R1** | acceptance gate |
| `W1_PERSISTENT_LINUX_WORKER_SAFETY` | **C1** | worker safety/admission gate |
| `T0_HERMETIC_TOOLCHAIN_CONTRACT` | **C2** | toolchain contract gate |
| `T1_TOOLCHAIN_PARITY_VERIFICATION` | **C2** | real parity gate |
| `A1_ISOLATED_WORKSPACE_AGENT_ADAPTER` | **C2** | isolated workspace gate |
| `C1_FIRST_SERIAL_CODING_LOOP` | **C2** | canonical C2 acceptance event |
| `ACC1_BASE_ACCELERATORS` | **C3** | accelerator pack |
| `C2_CACHE_IDENTITY_EQUIVALENCE` | **C4** | cache identity/equivalence |
| `C3_DETERMINISTIC_SHARDING` | **C5** | deterministic parallel planner |
| `C4_GLOBAL_SLOT_BROKER` | **C6** | global concurrency budget |
| `C5_TRUSTED_TELEMETRY` | **C7** | trusted telemetry |
| `C6_DURATION_SCHEDULER_TOURNAMENT` | **C8** | scheduler tournament |
| `C7_TRANSACTIONAL_WORK_STEALING` | **C9** | transactional work stealing |
| `C8_SPECULATIVE_EXECUTION` | **C10** | speculative dynamic execution |
| `C9_REAPI_BUILD_FARM_TOURNAMENT` | **C11** | REAPI substrate tournament |
| `C10_REMOTE_OUTPUT_MATERIALIZATION` | **C11** | verified remote-output materialization |
| `C11_INCREMENTAL_IMPACT_GRAPH` | **C12** | affected-work graph |
| `G1_GPU_WORKER_ADMISSION` | **C13** | GPU admission |
| `AI1_AI_SERVING_PLANE` | **C14** | AI serving |
| `S1_DISTRIBUTED_COMPUTE_RAY` | **C15** | distributed compute |
| `K1_CLUSTER_ADMISSION_KUEUE` | **C16** | cluster admission |
| `E1_ECONOMIC_AUTOSCALER` | **C17** | economic autoscaling |
| `F1_LIVE_EXTERNAL_FEDERATION` | **F1+** | live Multi-CAT federation |
| `P1_PRODUCTION_CORE_ACCEPTANCE` | cross-cutting | production acceptance, not a replacement canonical milestone |
| `P2_SCALE_TIER_ACCEPTANCE` | cross-cutting | scale acceptance, not a replacement canonical milestone |

## Workstream bindings at bootstrap

| Workstream branch | Canonical milestone | Current Level-2 assignment |
| --- | --- | --- |
| `work/w1-linux-worker-safety` | **C1** | `W1_PERSISTENT_LINUX_WORKER_SAFETY` |
| `work/t0-hermetic-toolchain` | **C2** | `T0_HERMETIC_TOOLCHAIN_CONTRACT` |
| `work/a1-agent-workspace` | **C2** | `A1_ISOLATED_WORKSPACE_AGENT_ADAPTER` |
| `work/r1-continuity-plane` | **R1** | `R1_CONTINUITY_PLANE_ADOPTION` |
| `work/f1-live-federation` | **F1+** | `F1_LIVE_EXTERNAL_FEDERATION` |
| `analysis/integration` | cross-cutting | analyze all Level-1 milestones without implementation authority |

## Acceptance semantics

A canonical milestone is not complete because its schema exists.

Required evidence states remain distinct:

- `SCHEMA_ONLY`
- `CONTROL_PLANE_ONLY`
- `SYNTHETIC`
- `LIVE`
- `EVIDENCE_READY`
- `VERIFIED`

Only Supervisor-reviewed evidence sealed into a valid semantic checkpoint may advance a canonical milestone to `VERIFIED`.

## Amplifier rule

Every meaningful semantic step must perform:

`IMPLEMENT → VERIFY → ADVERSARIAL TEST → DEEP AMPLIFIER RESEARCH → EVIDENCE`

Amplifier research may propose changes to implementation technique, but must not silently change this Level-1 roadmap. A proposed Level-1 roadmap change requires an explicit architecture decision, Supervisor review and a versioned amendment to this document plus the matching Supabase canonical roadmap definition.
