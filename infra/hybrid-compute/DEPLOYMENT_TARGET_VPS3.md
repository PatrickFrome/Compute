# HCF-1 candidate: OVHcloud VPS-3 remote worker

Status: **SELECTED FOR EVALUATION, NOT ORDERED OR PROVISIONED**. Evaluated 2026-10-10. This is a deployment target, **not** an assertion of live remote-node readiness or a command to migrate the Windows database.

## Selected candidate and alternative

- Preferred economical **x86_64** worker: OVHcloud *VPS-3 2027*, advertised from **USD 12.32/month**, **6 vCores / 12 GB RAM / 100 GB NVMe**. Configure **Ubuntu Server 24.04 LTS**, minimal image, a region close to the physical Windows operator / client; actual price, term, region and stock **must be verified in checkout before any payment**.
- Capacity-upgrade fallback: *VPS-4 2027*, advertised from **USD 23.37/month**, **8 vCores / 24 GB RAM / 200 GB NVMe**. Prefer if initial benchmark shows 12 GB insufficient when running a database plus development workers.
- Alternate region/provider: Hetzner CX43 (8 vCPU, 16 GB RAM, 160 GB NVMe, EU list price EUR 15.99 before VAT/IPv4) is **marked unavailable** on the public product page at evaluation, so it is NOT selected for ordering.
- No commitment or paid purchase has been authorized. Never place an order autonomously.

Source references:
- https://us.ovhcloud.com/vps/
- https://www.hetzner.com/cloud/cost-optimized/
- https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/

## Intended workloads

The cloud node provides a restartable, stateless Linux worker for **typed** Git read, isolated checkout, source indexing, test jobs, builds and independent verification. Use cgroups/systemd with bounded CPU, memory, file descriptors, wall-clock time and disk quota, before accepting non-trivial tasks.

LLM inference is **not** provisioned by this x86 VPS; any model provider is a separate explicit integration and has its own budget and data policy. Do not describe 6 vCores as dedicated physical cores.

## Architectural boundary

The present METAENGINE PostgreSQL 17.6 is a private **Windows loopback-only** database with preserved state; it cannot serve as a 24/7 coordinator when the PC is powered off. A continuously active control plane requires **a separate, qualified cloud-primary database and service ownership transition**, with a verified backup/restore, Vault/role/grant and schema checks, a single writable-primary epoch, conflict fencing and zero automatic split-brain promotion.

Until then HCF-1 cloud work is **read-only staging** and remains subordinate to existing durable local coordinator authority when that authority is live. Cloud worker must not independently mint leases, interpret local command results as proof, or accept untrusted model/page text as an instruction.

## Production admission gates

1. Provision dedicated Ubuntu 24.04 LTS x86_64 VPS only after user account, final checkout price, region, security policies and payment are approved.
2. Authorize a non-root administrative login via an owner-supplied *public* SSH key. Disable password-based root SSH after validated independent access; no passwords/API tokens enter Git or chat.
3. Install a private overlay (WireGuard or Tailscale) with explicit node ACLs. Only the bootstrap access port should be internet-visible while enrolling. No public PostgreSQL, Docker socket, Browser/CDP or runtime API.
4. Enroll exact machine identity, incarnation, generation, OS/arch, source SHA and explicit allowed task capabilities in the existing trusted coordinator. Bind signed heartbeat and revocation to independently read-back registry state (HCF-0 typed planner alone is not trust proof).
5. Run an **unprivileged read-only** test worker with leases acquired through existing control plane, containing only checkout/test tools, not the user's Windows Vault/database credentials.
6. Independently verify a real task: task_id → claim → exact source artifact → result digest → verifier receipt → ledger readback. Test expiry, duplicate delivery, offline, restart, revocation, cross-workspace and stale-incarnation failure.
7. Produce latency/CPU/RAM/network measurements. Upgrade to VPS-4 only if bottlenecks merit additional monthly cost; separate heavy builds from the database before raising concurrent slots.
8. Design a second physical failure domain and independently witnessed primary fencing before promising high availability. A single VPS does not give uninterrupted hardware uptime.

## Suggested first-node resource budget (starting defaults, not verified capacity)

- Reserve about 2 GB RAM for OS/network/monitoring overhead and filesystem cache.
- Run one build/test job at a time initially; cap job memory at 4 GB, CPU at 2 cores and duration at 15 minutes.
- Keep at least 20 GB disk free. Store artifacts off-box after hashing, with retention quotas.
- Fail closed on missing leased authority, CPU/RAM exhaustion, stale heartbeat, unknown source identity, or unknown model budget.
- PostgreSQL remains local until a **separate migration/DR qualification**; never rsync a live PGDATA directory to the cloud.

## Evidence today

- HCF-0 pure placement: local Windows Node 23/23 tests pass; GitHub Actions Windows and Ubuntu checks successful on prior exact HCF-0 SHA.
- No physical Linux worker connected; no cloud health, SSH, tasks, latency, backup restore or uptime qualification.
- Hosting availability and price are *published offerings* only, not a reservation or deployment.
