# W37 — Trusted Context Source Convergence (source-only)

Request: `metaengine-client-wave7-w37-20261015-001`
Branch: `work/metaengine-client-wave7-w37-20261015`
Status: **DRAFT / REVIEW_REQUIRED**, never installed ACTIVE, HEALTHY or effect-ready.

## Independently inspected exact source/ancestry ledger (2026-10-15)

| Source | Exact observed commit | Relation |
| --- | --- | --- |
| `main` | `b26f2d4693e7bab3648e0930b7a9e2c75baef58e` | inspected; not changed |
| `integration/compute-unified-v1` | `a23b647220c6bdeaa4340f804575dc2009e434cb` | inspected; not changed |
| #1216 unified W1–W7 | `881eb2e29882419921978910ec6c3f184f197801` | common source ancestor |
| #1221 Owner recovery baseline | `85a11b2aa8777f5981a6cd5c4ed30de877417875` | independent reference, not merged |
| #1251 W22 | `a02e2c6891a8feba246a44223138d417092def73` | ancestor of W35 |
| #1256 W35 | `3edbc1ada33371d6d65372381a1c28340c1315e1` | W37 branch parent |
| #1250 W28 | `3ceab9337b9f457cb89ed35f446b16f8fce90d41` | merged without modifying upstream |
| #1258 W25 | `ad25263d5c178074c030b98ba2ce5dcb9cbfdfc2` | merged without modifying upstream |
| #1260 W27 | `e1b98ecbbf7ab7f64c62386bd769f7b8d1f6b05c` | merged; package-test registration conflict resolved preserving both W28 and W27 |

Independently read the living `coordination/operator-control/ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md` at `work/roadmap-no-cloud-capsule-20261013` (not main). No tracked `AGENTS.md` at the checked source tree. No live service or installed runtime used for source evidence.

## Concrete composition defects repaired

1. **W22 → W28 native TOCTOU:** the native `readContext()` originally sampled the trusted binding only **before** the asynchronous authenticated Gateway GET, then accepted a response after a new Owner, PID/birth, generation, epoch, source SHA, gateway key/endpoint, or PostgreSQL postmaster had replaced the original. The reader now requires bounded typed provenance fields and re-reads the in-process binding after the response, rejecting any identity drift. An available run must match the native Owner epoch. Main remains deliberately unbound without real native Owner adapter, producing UNKNOWN.
2. **W25 own-PG ledger → Gateway Owner TOCTOU:** W25 already rejects postmaster restart, missing PG17 grants/schema, and wrong read-only transaction inside fixed SQL. However, the **Owner** could change during this transaction, leaving stale positive fleet and continuity data. The existing DB API now re-reads the internal Owner **after** SQL, checks owner/generation/incarnation/project/workspace/device/epoch/cursor identity, and discards positive lease/cursor observations on mismatch/timeout/absence. Existing expected one Owner callback becomes an intentional two-read contract, not a weakened assertion.
3. **W28/W27 cross-source CI:** merged Gateway generation/event fences and native Owner/Guardian two-sample recovery reducer on the W35/W22 base, with W25 PostgreSQL gate, preserving all upstream source tests in one package script. W37 tests exercise both real ephemeral authenticated loopback HTTP hops and injected own-PG SQL, not direct mocked Gateway JSON alone.

## Hard trust boundaries / remaining blockers

- W37 **does not provide** a physically attested native Owner adapter, OS process inventory, Guardian kernel-birth/SCM proof, or an authenticated production `getTrustedBinding` implementation. Main's existing `createOperatorNativeContextReader()` is deliberately unbound. Test callbacks with plausible `verified` flags, PID, birth and source SHA are fixtures, **not** authentic native provenance.
- The `operatorOwnerReadback` in own-PG is a trusted in-process seam only, not itself cryptographic attestation; physical readback/transactional generation CAS must be provided by the existing Owner/Guardian before making positive installed-state claims.
- `readRunIdentity` is still an optional independently trusted own-PG callback; absent it, native `run_id`, `event_seq` and `proof_identity` remain null. Neither a successful GET nor a positive facet authorizes scheduling, task mutation, lease release, repair, promotion, installation or replay.
- Hermetic source SQL adapters do not prove PostgreSQL 17 service/RLS/grants, Windows Supervisor physical birth, packaged application source/artifact digest, restart/rollback or installed Client ACTIVE/HEALTHY. All these remain **REVIEW_REQUIRED**.
- No Supabase, hosted fallback, arbitrary SQL/URL, second scheduler/executor, live database/Browser/Guardian/DevFleet touch, main merge, install or task effect.

## W37 focused verification

`operator-context-convergence-w37.test.mjs` uses the real W22 native reader and W28 authenticated fixed-loopback Gateway against the real W25 `startDbApi` handler with injected fixed own-PG SQL. Adversarial checks: absent native Owner, invalid binding, bad key, Owner swap during SQL, postmaster restart, in-flight owner PID/birth/generation/epoch/source SHA/PG rollover, run epoch mismatch, scope/auth flags and output redaction. It does **not** claim real OS proof.

Dedicated GitHub Actions `Client Operator Context Convergence W37` runs the W37 test plus W22, W35, W28, W25 and W27 hermetic suites under Node 24 on Ubuntu and Windows. Always inspect the **exact final W37 head** CI separately; upstream CI for older source SHA is not W37 combined evidence.
