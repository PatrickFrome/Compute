# METAENGINE Client W44 — canonical native Owner / Source / Continuity wiring

Request: `metaengine-client-wave8-w44-20261015-001`.
Branch: `work/metaengine-client-wave8-w44-20261015`.
Status: **DRAFT / SOURCE-ONLY / REVIEW_REQUIRED**. No installed-machine, service, exe, Guardian, PostgreSQL, deployment, merge, or effect authority.

## Read independently on 2026-10-15

| Anchor | Exact observed SHA | Relation |
|---|---|---|
| main | `b26f2d4693e7bab3648e0930b7a9e2c75baef58e` | unchanged |
| integration/compute-unified-v1 | `a23b647220c6bdeaa4340f804575dc2009e434cb` | unchanged |
| #1216 W1–W7 | `881eb2e29882419921978910ec6c3f184f197801` | read |
| #1221 missing Owner | `85a11b2aa8777f5981a6cd5c4ed30de877417875` | read |
| #1262 W29 | `11c6f0e754d160f4d2c042da86c2cb88e4495298` | UI reference, not imported |
| #1263 W39 | `ee39b256e2b54f5dfddf4bff021977c0185fb744` | parallel |
| #1264 W40 | `ea1703cb6c4d0d15f1c7cd4cb4faf22ec2ac959d` | parallel |
| #1265 W42 | `37ce5d8407a1c1fa9702aa3aeb05133131f7a11a` | critic |
| #1266 W37 | `2557acd2ee11464c6f3f63b2e3b22bba74df142f` | **exact W44 Git parent** |
| #1267 W38 | `2e9018d14cfe55256ddc5a94693ff0a288b90318` | parallel |
| #1268 W41 | `33f97db8d03fb57c4a78fa2e5abcb08509725551` | parallel |

Read the **living** `coordination/operator-control/ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md` on
`work/roadmap-no-cloud-capsule-20261013` (not main). No applicable tracked AGENTS.md in the inspected source paths.

## Actual implementation

- `apps/metaengine-browser/src/main.mjs` now binds the W37 readContext constructor to a native-only verification **capability slot** on the existing Supervisor. It cannot use env/PID-only or caller-supplied input, API key, URL, or source SHA. If the existing Supervisor has no complete installed native verifier, there is no network request and the primary Observatory sees UNKNOWN.
- `operator-canonical-native-w44.mjs` accepts only a full independent in-process Owner record + kernel PID/creation time/incarnation readback + Owner-scoped Guardian proof + exact installed executable bytes/manifest verifier + secret-store Gateway credential + own-PG postmaster birth. It performs two Owner samples per read. A permissive `verified: true` alone is insufficient.
- Existing authenticated fixed-loopback Gateway adds optional `readInstalledSource` with Owner/run epoch/generation/incarnation/source/exe/proof validation **before and after** its own-PG and HTTP context readbacks. Drift rejects as 503; no alternate network or scheduler.
- Existing native bridge compares the Gateway Source receipt to native Source/Owner, project/run, generation, exact exe and witness, and existing own-PG continuity plane; only then can it expose `source_sha`, `owner_id`, `owner_epoch`, and `proof_identity` in the one canonical context. No ad-hoc computed digest. Negative Source freshness evidence is preserved. All seven W6 views use existing canonical reducer; no UI redesign.
- New hermetic cross-hop test uses an ephemeral authenticated HTTP server with fixed injected SELECTs, truly exercises original SQL+Gateway+native projection modules and W6 reducer; tests missing verifier, native restart, source drift, PG birth drift, redaction. **All test owners, kernel reads, install verifiers, Guardian flags, and PG data are SYNTHETIC fixtures.**

## Remaining non-negotiable physical/production blockers

1. Existing production `NativeSupervisorClient` has **no** implemented `getTrustedOperatorOwnerVerifier()` capability at this source SHA. W44 introduces the typed native slot, but does not manufacture it: production readContext deliberately stays **UNKNOWN** until a separately qualified native Host/Guardian/installed-exe reader is attached.
2. The own-PostgreSQL Gateway bootstrap has **no** independently attested production `readInstalledSource` adapter. The callback is a testable narrowly scoped seam, not verification itself. No guessed environment, Git HEAD, publisher signature, response `verified` flag, or PID substitutes for native EXE/proof.
3. No physical Windows Owner/Guardian, exact EXE/installer artifact signature+digest, own PostgreSQL 17 role/grant, package/restart/rollback, or true run/epoch/cursor monotonic proof was exercised. Source test success is **not** installed Client ACTIVE, VERIFIED_CURSOR in production, release approval, or effect authority.
4. #1262 W29 UI and W43 integration candidate have different branches. W44 does not own them; integrator must reconcile W44 hooks and their source/tree/version/CI separately.

Focused test: `node --test --test-concurrency=1 infra/client-state-runtime/operator-canonical-native-w44.test.mjs infra/client-state-runtime/operator-context-convergence-w37.test.mjs apps/metaengine-browser/test/operator-native-context-bridge.test.mjs`.
CI: `.github/workflows/operator-canonical-native-w44.yml` (Node 24 Windows+Ubuntu, source-only). Inspect **exact resulting SHA**; no install/release claims.
