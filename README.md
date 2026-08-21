# METAENGINE Compute Fabric

Authoritative repository for the recovered METAENGINE / H205F22 Compute Fabric.

## Roadmap authority

The project uses two linked roadmap layers:

- **Level-1 canonical architecture:** `docs/CANONICAL_ROADMAP.md` — stable roadmap `R1`, `C1…C17`, `F1+`. This is the architectural north star used to detect roadmap drift.
- **Level-2 execution DAG:** Supabase `compute-fabric-roadmap-v1` — implementation gates, dependencies and work claims used to execute Level-1 safely.

Level-2 may refine Level-1 but must not silently redefine, renumber or replace it.

The primary execution spine is:

`R1 → C1 First Real Linux Worker → C2 First Serial Coding Loop → C3 safe acceleration → C4…C17`

`F1+ Live Multi-CAT Federation` develops in parallel where dependency/trust gates permit.

## Governance

- Every workstream/PR must name its canonical Level-1 milestone and current Level-2 milestone.
- Worker chats operate on isolated workstreams and stop at `EVIDENCE_READY`.
- Every meaningful step performs `IMPLEMENT → VERIFY → ADVERSARIAL TEST → DEEP AMPLIFIER RESEARCH → EVIDENCE`.
- The Analyst/Integrator reviews cross-workstream evidence and roadmap drift.
- The Supervisor chat is the only mainline controller / checkpoint sealer and the only authority that can advance milestones to `VERIFIED` after a valid seal.
- Synthetic/control-plane/schema evidence never counts as live runtime evidence.

Current last verified supervision baseline recorded by the recovery effort: **CP071 — COMPUTE_FABRIC_SUPERVISION_PLANE_V1**. Always read the current Supabase semantic head before relying on this historical baseline.

Workstreams:
- `work/w1-linux-worker-safety` → canonical **C1**
- `work/t0-hermetic-toolchain` → canonical **C2**
- `work/f1-live-federation` → canonical **F1+**
- `work/r1-continuity-plane` → canonical **R1**
- `work/a1-agent-workspace` → canonical **C2** (`PREPARE_ONLY` until W1/C1 safety gate is verified)
- `analysis/integration` → cross-cutting Analyst/Integrator

See:
- `docs/CANONICAL_ROADMAP.md`
- `docs/ROADMAP_EXECUTION_PROTOCOL.md`
- `docs/CHAT_TOPOLOGY.md`
