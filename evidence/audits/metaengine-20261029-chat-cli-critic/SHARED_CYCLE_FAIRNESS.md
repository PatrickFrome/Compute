# Do not discard allocated leases or starve later running work

Base9e45d19a44559c2652baae5482c03a4f2ab09a82.

The shared cycle limited both received lease arrays and dispatch batches with
slice(0, concurrency). With no browser tabs,9allocated native leases produced
only4dispatch calls. The remaining allocated leases were omitted from this
cycle. Two regressions reproduce this, with and without an individual failure.

The cycle now retains all server-allocated leases and uses a bounded worker
queue. Existing per-tab gates, native dispatch validation, failure aggregation
and concurrency scaling remain. It neither allocates new leases nor retries an
uncertain effect. Local concurrency is not a logical agent-count ceiling.

Running observations also always took the first budget-sized prefix. A stable
list of9running native leases yielded only4unique observed IDs after3cycles.
The bounded readback window now rotates over the complete server list. Its
cursor is scheduling fairness only, never durable effect/lease authority.

All3new regressions failed before their fixes. Related cycle, concurrent browser
dispatch, census and fleet-budget suites:49/49pass. An obsolete source assertion
was adjusted to the actual budget computation and now explicitly rejects lease
array truncation. Full suite and installed mixed-agent execution are separate.
