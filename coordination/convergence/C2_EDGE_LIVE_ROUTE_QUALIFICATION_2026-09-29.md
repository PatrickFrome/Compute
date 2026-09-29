# C2 EDGE LIVE ROUTE QUALIFICATION — 2026-09-29

## Evidence boundary
Client V1 successor branch:
`work/client-v1-c2-new-supabase-rehome-v1`

Current product head at this checkpoint:
`ec496df4f6d8b4817a755452b2bb8b9ef03be3e9`

New Supabase project:
`jhriwwsryeqsvvvufkok`

Frozen R109 remains unchanged:
`ff95e9c886fac35b9302ec5c04a4c6bf7b8e8551`.

## Live defect found
A public live probe proved that the new stable Edge endpoint initially returned
`401 {"error":"device_auth_required","reason":"CLIENT_ID_REQUIRED"}`
for `GET /health`.

After redeploying the exact successor Edge source, the stable endpoint became healthy,
but the canary still returned the same 401.

Bounded route telemetry then exposed the exact canary failure:
- runtime pathname: `/a2-browser-native-supervisor-v14-canary/health`
- old routed path: `4-canary/health`

Cause: fallback normalization used substring search for the stable
`/a2-browser-native-supervisor-v1` marker, which is a prefix of the v14 canary slug.

## Repair
The Edge route normalizer now:
- handles hosted `/functions/v1/<slug>/...` mount form,
- extracts the first runtime mount as an exact path segment,
- accepts only a bounded `a2-browser-native-supervisor-v<number>[-suffix]` mount pattern,
- removes substring matching against the stable service marker,
- preserves the canonical signed-request path as stable v1.

Regression coverage:
`apps/metaengine-browser/test/native-supervisor-deployment-slug-routing.test.mjs`.

The health contract was also made explicitly authority-free with
top-level `authority_effect:false`.

## Exact live readback
Current deployed bundles:
- stable `a2-browser-native-supervisor-v1` version 4
- canary `a2-browser-native-supervisor-v14-canary` version 7
- both bundle digest:
  `b6a280c00204e35ff0b24d118451d8b8cc7e43119b4f8624b477ba6625b07a5d`

Permanent live probe:
`.github/workflows/client-v1-supabase-edge-live-probe.yml`

Rerun after deployment:
- stable health = HTTP 200
- canary health = HTTP 200
- `ok=true`
- `authority_effect=false`
- capability health = `ATTESTED / EXACT_DB_SOURCE_MATCH`
- `runtime_ready=true`
- `physical_dispatch_allowed=false`
- `release_authority=false`

R83 manifest was rebound to canary v7 at source pin
`d0caf994fffb22a863a68d99255e181d1a3acbd3`.
R83 static qualification is SUCCESS on current product head.

## Remaining C2/C3 gate
This closes public Edge route reachability and exact DB capability attestation.
It does NOT yet claim physical Browser qualification.

Still required:
1. exact-head package/installed CI terminal green;
2. a real signed device enrollment request against the new project;
3. explicit approval of that exact request;
4. signed state/heartbeat readback from the activated device;
5. Postgres wake/result receipt readback and rollback drill;
6. only then set R83 live qualification complete / promotion authority.
