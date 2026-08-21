# Compute Fabric Chat Topology

Supervisor baseline: **CP071**.

## Authority model

- The Supervisor chat is the only mainline controller and checkpoint sealer.
- Implementation chats work on isolated branches and finish at `EVIDENCE_READY`.
- The Analyst/Integrator reviews all workstreams and produces integration recommendations, but does not merge `main`, reserve checkpoints, or mark milestones `VERIFIED`.

## Workstreams

| Slot | Role | Roadmap milestone | Branch | Mode |
|---|---|---|---|---|
| CHAT-1 | Linux execution | `W1_PERSISTENT_LINUX_WORKER_SAFETY` | `work/w1-linux-worker-safety` | ACTIVE |
| CHAT-2 | Hermetic toolchain | `T0_HERMETIC_TOOLCHAIN_CONTRACT` | `work/t0-hermetic-toolchain` | ACTIVE |
| CHAT-3 | Federation | `F1_LIVE_EXTERNAL_FEDERATION` | `work/f1-live-federation` | READY |
| CHAT-4 | Durability | `R1_CONTINUITY_PLANE_ADOPTION` | `work/r1-continuity-plane` | READY |
| CHAT-5 | Isolated workspace | `A1_ISOLATED_WORKSPACE_AGENT_ADAPTER` | `work/a1-agent-workspace` | PREPARE_ONLY until W1 VERIFIED |
| CHAT-6 | Analyst / Integrator | cross-workstream analysis | `analysis/integration` | ACTIVE |

## Worker completion rule

A worker may submit code, migrations, tests, research and evidence, but its terminal state is `EVIDENCE_READY`. Only the Supervisor may accept integration and seal a semantic checkpoint.
