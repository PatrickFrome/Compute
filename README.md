# METAENGINE Compute Fabric

Authoritative repository for the recovered METAENGINE / H205F22 Compute Fabric.

## Governance

- Supabase `compute-fabric-roadmap-v1` is the authoritative execution DAG.
- Worker chats operate on isolated workstreams and stop at `EVIDENCE_READY`.
- The Analyst/Integrator reviews cross-workstream evidence and prepares integration recommendations.
- The Supervisor chat is the only mainline controller / checkpoint sealer.

Current supervision baseline: **CP071 — COMPUTE_FABRIC_SUPERVISION_PLANE_V1**.

Planned workstreams:
- `work/w1-linux-worker-safety`
- `work/t0-hermetic-toolchain`
- `work/f1-live-federation`
- `work/r1-continuity-plane`
- `work/a1-agent-workspace`
- `analysis/integration`
