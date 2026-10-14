# DevFleet Mass Coding Wave Admission — V1

Status: source-only proposal, **not wired into the running native operator**.

This pure module is a bounded **admission recommendation**, not a second scheduler, new owner or background worker. The already-installed DevFleet operator retains all physical Send, Close, Create and receipt authority.

`proposeCodingWave(input)` selects independent source-backed CODE_ONLY jobs with distinct task/request identities, proven DONE dependencies, exact 40-hex source SHA, and an explicit researcher/implementer/critic role mix. Existing request IDs, external-effect jobs, incomplete dependencies and stale source are rejected or blocked.

It recommends a maximum of four jobs per wave. Projected hot-slot capacity is based on a caller-supplied list of tabs to retire, a maximum hot pool (default four), and conservative memory reserve (512 MiB + 256 MiB per additional tab). Every result has `dispatch_performed:false`, `authority_effect:false` and `automatic_retry_allowed:false`.

The input memory measurement and intended retirements are advisory only and must be acquired from the trusted native host before integration. No task is dispatched or persisted by this module.

## Evidence
- Five focused hermetic tests.
- Full DevFleet Windows Node 24 regression: 108/108 PASS.
- Next qualification: source-backed operator adapter under existing developer-only RPC, exact host memory readback, journal uniqueness on reincarnation, then canary wave with fresh task IDs.
- Keep separate draft PRs for duplicate coding outcomes; never replay release, database, payment or other irreversible effects.
