# Keepalive checkpoint ordering — 2026-10-03

## Observed defect and source correction

An earlier full local regression failed the R82 blank-tab rollover scenario.
Repeated execution exposed a real Windows EPERM while concurrent writes renamed
their distinct temporary files onto the same keepalive.json. A fire-and-forget
rollover intent could overlap the cycle's awaited checkpoint. Unique temporary
names prevent shared-temp collisions but do not serialize destination replacement.

SupervisorKeepalive now captures an immutable snapshot immediately and queues
saveState calls in invocation order. Only one writer runs per instance. A failed
write still rejects the originating caller; the private ordering tail consumes
that rejection only to allow a later independent checkpoint. No failed snapshot
or external effect is retried. The bootstrap keepalive inherits this owner.

The newer CLOSED admission checkpoint must remain durable after an older rollover
intent. This correction adds no scheduler or admission authority and does not
claim cross-process filesystem locking.

## Verification

Three controlled overlapping-write tests fail before the correction and pass
after it: rollover/cycle order, later CLOSED fence, and EPERM without queue
poisoning or retry. Existing keepalive/bootstrap/admission group: 26/26 PASS.
R82/lifecycle group: 13/13 PASS, with its physical wait bounds unchanged.
Independent review approved the correction.

Full local Browser regression on Node 24.19.0: 4165/4165 PASS, zero failures,
cancellations or skips; duration 242084.733 ms. Exact-head Windows/Linux source
qualification, including frozen UI and SLSA topology, is required after commit.
Its terminal record will be stored outside the frozen source under outputs.

The preceding source 99c70f3f2a452ee3686636c22ee51d074975c9eb passed all four jobs
in run 37150164212. This is evidence for that revision, not the new correction.

## Physical integration boundary

Fresh readback found physical/build-slsa-provenance-v1 at
219ebe989a4f7ce2adfeb205a394a47ee55037cf, diverged from this source branch.
It contains a separate admission journal/UI implementation, fresh-readiness
submit fencing, version reservation and R97 visual qualification changes.
Neither branch may overwrite the other's work. Resolve the competing admission
owners and qualify the combined exact source before advancing the physical line.
The installed baseline remains 5048c82701f5836370c15000df74d9a12119d34a /
0.7.0-dev.37103459439.1, CLOSED at floor 28, Guardian HOLD and four unverified
sessions. No new installer or live admission effect is claimed here.

Node's filesystem documentation explains that concurrent promise-based changes
to the same file are unsynchronized:
https://nodejs.org/docs/latest-v24.x/api/fs.html#promises-api.
The specific EPERM and overlapping owner calls were reproduced locally.
