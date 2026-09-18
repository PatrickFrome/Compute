# METAENGINE Development OS — Supervisor Mesh Continuity V1

Status: implementation checkpoint

Source parent: `work/devos-supervisor-continuity-v1` at `1e85355ad493cf4a0ca56ddfa478702cf62f62b8`.

## Purpose

Keep Development OS coordination available when the primary supervisor conversation is lost, rolling over, or has an ambiguous message delivery, without converting failover into blind replay.

## Contracts

- One coordinator peer is elected from exact live non-fleet ChatGPT conversation incarnations.
- Duplicate physical incarnations are `AMBIGUOUS_INCARNATION` and never coordinator eligible.
- Fleet tabs remain excluded from the normal supervisor mesh in this slice.
- A coordination `event_key` is durable and can be reserved only once.
- An ambiguous delivery is terminal for that event key; failover may create a new independent recovery event but cannot replay the ambiguous event.
- Standby recovery messages explicitly require reconciliation of prior ambiguity and prohibit repeating a physical effect unless trusted evidence proves `NO_EFFECT`.
- Physical Browser/deploy/merge/production effects continue to require the existing shared lease / typed authority plane.
- Pending logical coordination is restart-resumable state and must not become a new self-update quiescence requirement.

## Next integration slice

Wire `SupervisorMeshRuntime` into the current `NativeSupervisorClient`, publish its bounded snapshot in heartbeat telemetry, reconcile before/after supervisor cycles, and dispatch recovery only when the primary lifecycle is unavailable or blocked. Do not restore the older PR #90 model-quiescence updater gate.
