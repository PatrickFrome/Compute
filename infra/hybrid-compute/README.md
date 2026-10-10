# METAENGINE Hybrid Compute Fabric — HCF-0

Status: source-only prototype; **not a deployed cloud**, no new scheduler, no live authority. Base: the current client/Browser source lineage. The legacy METAENGINE Windows Browser remains a local executor.

## Goal and physical topology

Client Browser/Host Agent (Windows) and one or more independent Linux cloud workers share a **single durable coordinator authority**. Control-plane intent, task claims, lease generations, results and independent verification remain in the project's existing PostgreSQL / Supervisor contracts. A remote node is merely another leased worker. Proxmox/KVM is optional: a physical remote Linux host or VPS can run the first worker. The database is not automatically replicated or promoted.

Local Windows may run BrowserCells, physical UI and trusted OS-specific actions. A cloud Linux worker is intended for source indexing, builds, isolated tests and bounded computations. Remote workers must **not** receive local Browser/CDP, Vault, Windows admin, local profile or private filesystem authority. No implicit egress from private data to cloud.

## Logical sequence

1. Trusted existing coordinator reads the exact workspace/task revision and current node registry; its own readback/lease authority is **not** implemented by this placement module.
2. Hybrid placement pure function filters unavailable, stale, generation-mismatched, overloaded, costly or incompatible nodes. It suggests an exact node incarnation and source SHA.
3. Existing durable task claim and actuation/VEF gates independently decide whether an effect is allowed. Placement **never grants** that permission; mutation tasks are held until integration with the existing verified lease consumer.
4. Existing executor performs the typed operation in an isolated worktree/container and writes a durable receipt with independent post-condition validation.
5. If the selected node disappears, existing lease expiry/reconcile produces an explicit outcome. An ambiguous mutation is not retried automatically. No second command scheduler or command queue is permitted.

## Prototype contracts

- Code: infra/hybrid-compute/placement.mjs. Tests: node --test infra/hybrid-compute/placement.test.mjs.
- A task has a pinned 40-hex source SHA, workspace ID, effect class, data residency policy, capabilities, cloud opt-in, and cost/latency budgets.
- A registry snapshot has the same workspace and SHA and is explicitly declared as readback by the existing control plane. **The declaration itself is not a signature or trust evidence**; real admission must verify signatures and database readback before calling the pure function.
- Nodes have exact incarnation ID, monotonic heartbeat sequence and generation, fresh observation (max 30 seconds), capacity and declared capabilities. A planner cannot upgrade a node's rights.
- Responses are PROPOSAL_ONLY or HOLD, with authority_effect=false, dispatch_allowed=false and automatic_retry_allowed=false. No API, SQL, process, shell, or network side effects.

## Production security invariants

- Never expose PostgreSQL port 5432/55432 on a public interface. Network overlay should be private with explicit per-node access policies. WireGuard is a vendor-independent option; Tailscale (or independently hosted Headscale with compatible clients) simplifies enrollment, but the policy must remain deny-by-default.
- Node enrollment keys and secrets live only on the node / trusted secret manager and must never be checked into GitHub or forwarded to model outputs.
- Pin and verify node identity + incarnation + source SHA + workspace + lease generation at dispatch **and immediately before every physical effect**.
- Only one database writer/primary may own authority at a time. A second cloud database must be physical/logical standby (as separately qualified), not a second writable master. Split-brain fencing and witnessed promotion are prerequisites to failover.
- A two-node installation cannot safely claim quorum-based unattended promotion. Keep cloud database promotion manual until an independent witness/fencing mechanism is qualified.
- Use encrypted off-host backups with tested restore. A successful pg_dump alone is not a tested DR/role/Vault restore.
- Apply egress restrictions and explicit CPU/memory/concurrency budgets. All remote worker side effects require scoped pre-approved identities; do not forward host/root Docker socket or raw shell to the Browser.

## Rollout gates

| Stage | Work | Acceptance proof |
|---|---|---|
| HCF-0 (this branch) | Pure placement, fail-closed policy, tests and architecture | Linux/Windows Node tests on exact SHA; no runtime activation |
| HCF-1 | Read-only Linux worker enrollment behind WireGuard/Tailscale + existing coordinator | Trusted identity/heartbeat, revocation and disappearance drills |
| HCF-2 | Existing task lease → cloud read-only test executor | Durable submit → claim → artifact → independent readback with exact revision |
| HCF-3 | Bounded mutating Git/build worker with VEF + effect journal | Chaos, lease expiry, duplicate delivery and ambiguous-effect tests |
| HCF-4 | Optional PostgreSQL 17 warm standby, encrypted backups and witness | Restore drill, RPO/RTO, split-brain prevention, separately authorized promotion |
| HCF-5 | Browser/DevOS dashboard with node health, pause, cost and capacity | Real installed UI and full Windows/remote E2E |

## Current local host status (observed 2026-10-10)

Owner Windows machine has a separate locally recovered PostgreSQL 17.6 cluster, listening on 127.0.0.1:55432, with authenticated METAENGINE schemas and an interactive-user scheduled keeper. That is **not** a registered Browser local-state provider, not an auto-start pre-logon Windows service, and is **not** remotely reachable. It must not be modified or silently synced by this experiment.

## Next deployment inputs

One authorized remote Linux host (or dedicated server) with SSH access, OS distribution, CPU/RAM/disk capacity, network domain and budget; then decide overlay topology and worker key enrollment. No host was supplied for HCF-0, so no VPS has been ordered, created, billed, or connected.

## Primary reference docs

- PostgreSQL 17 High Availability: https://www.postgresql.org/docs/17/high-availability.html
- PostgreSQL 17 Standby: https://www.postgresql.org/docs/17/warm-standby.html
- Tailscale device tags: https://tailscale.com/docs/features/tags
- Tailscale ACL grants and network policy: https://tailscale.com/docs/reference/syntax/policy-file
