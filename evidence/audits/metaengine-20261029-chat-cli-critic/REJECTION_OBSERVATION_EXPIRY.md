# Expiry of cached rejection observation

A reproduced regression left VERIFIED_REJECTION in the native observer snapshot
indefinitely after the heartbeat stopped. The verifier initially reads physical
worktree and receipt state, so that observation is not a permanent proof about
mutable files. The snapshot now invalidates expired (>30 seconds), malformed or
future (>5 seconds) timestamps without launching any new read or operation.

Invalidated cache records remain READBACK_REQUIRED even if the wall clock moves
back into the former freshness window. Only a later ordinary private observation
can restore VERIFIED_REJECTION. Pending rereads and close clear the old timestamp
and digest. No repair, retry, checkpoint, permit or execution authority is added.
This is a prerequisite correction for the later repair transition, not that
transition's implementation.

Red regression: cached state remained VERIFIED_REJECTION after 30001 ms.
Green regression: expiry, clock regression/reset and NaN cannot revive it;
subsequent existing heartbeat-driven read refreshes it. Snapshot reads perform
zero additional Host calls. Combined checkpoint observer and actual runtime
composition tests: 45/45 pass. Windows qualification remains required.

Previous source 29faee4fc5d4c86042d5d4ea17f7ab0add07af3d is fully published.
Runtime Contracts run 40930273341 completed successfully for PostgreSQL,
Ubuntu and Windows. Windows Source run 40930273273 completed successfully:
component 452 total / 451 pass / 1 baseline skip; native PG17 47/47, no skips.
Those results qualify the previous source, not the expiry change.
