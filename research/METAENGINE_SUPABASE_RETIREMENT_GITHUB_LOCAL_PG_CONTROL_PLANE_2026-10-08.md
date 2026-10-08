# METAENGINE — Supabase retirement and owner-hosted control plane (2026-10-08)

## Verified source inventory and migration objective

Requested end state: **no Supabase dependency** for any installed METAENGINE Browser, agents or PC control. Use an owner-controlled PostgreSQL 17 + authenticated local HTTP API and local Supervisor/Host Agent as the live control plane. Use GitHub as the **GitOps and audit distribution plane**, not as a trusted API execution source. Preserve original PGDATA, Vault and protected private config. Work in staged, exact-head PRs; do not infer physical user-PC success from CI.

Verified in successor source #1167:
- `infra/client-state-runtime/db-api.mjs`, `db-api-core.mjs` already emulate the required restricted REST/RPC surface with 40 allowed RPC names and five allowed tables, a local service-role identity and loopback-only listener.
- `infra/client-state-runtime/launcher.mjs`, `runtime-host.mjs`, `owned-postgres-process.mjs` already start an owned PG17+Node+Deno runtime with identity fencing.
- `apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/index.ts` has a *LOCAL_POSTGRES* branch and a **legacy Supabase** branch; historical folder naming does not prove that installed client calls Supabase.
- `apps/metaengine-browser/src/native-supervisor-endpoints.mjs` still contains historical hosted default and endpoint failover; the installed client must pin selected loopback provider and fail closed.
- `apps/metaengine-browser/src/remote-support-mcp.mjs` exposes local opt-in UI/metadata, and PR #1166 adds a double-approved restored provider operation. Stdio MCP by itself is not reachable from ChatGPT remotely.
- PR #1167 adds an installed first-run owner wizard but requires an independently pinned restore report and a *current* immutable offline bundle. Original PGDATA has an unresolved stale `postmaster.pid`/`in production` status; the known stopped snapshot was in `%TEMP%`. Both prohibit blind startup/automatic adoption.

## Deployment authority and routing

| Function | Supabase historic | Target and owner of truth | GitHub role |
| --- | --- | --- | --- |
| Durable task/goal/agent state | Hosted Postgres | **Owner PG17** with local schema/roles and backed-up WAL | Source migrations, review, non-secret contract fixtures |
| RPC and PostgREST | Hosted REST+RPC | **Local Node DB API** backed by allowlisted SQL RPC/table permissions | Build, test, release |
| Edge Functions/Supervisor | Hosted Deno Functions | **Bundled Deno local Supervisor** pinned to device instance and 127.0.0.1 | Code provenance and audited versions |
| Realtime and wake | Hosted realtime | **Postgres LISTEN/NOTIFY + durable cursor, replay-safe wake** | Integration test receipts only |
| Credential/session authority | Hosted API key/session | Device-bound local owner grants, session-scoped capability, DB leases and effect receipts | No credentials; never issues execution authority |
| Files and snapshots | Hosted storage | ACL-protected local storage, manifests, encrypted backups and Vault | Only consented, sanitized/non-secret release evidence |
| GitOps, collaboration | Not the state DB | Signed commits, review workflows, immutable artifacts | **Primary GitHub role** |
| ChatGPT → local PC | Hosted endpoint/browser | Paired outbound secure MCP/HTTPS or approved device gateway; explicit owner enrollment | Can ship gateway **source**, not impersonate a live paired device |

A GitHub event, PR merge, workflow completion, issue body, bot account or token must never act as a direct mouse/keyboard/admin grant. GitHub deliveries are **candidate goals or code changes only**. Runtime task admission requires the local authenticated API, an owner-approved policy, target device binding, DB lease with fencing token and durable idempotency/receipt. If host goes offline, GitHub can continue to hold source/review artifacts but must not fabricate task success.

## Sequence of independently qualified milestones

1. **Local-only transport enforce:** installed client sets `METAENGINE_LOCAL_ONLY_CLIENT=1` before supervisor modules, validates a pinned loopback URL and local instance, and rejects missing `LOCAL_STATE_RUNTIME` in self-hosted Supervisor. Keep historical cloud compatibility only for old migration tests, outside packaged execution. Do not yet delete code supporting historical documents.
2. **Repair packaged onboarding:** keep lazy Electron dialog modules behind an ownerless installed *primary* guard; preserve offline probe/singleton contract; use real installed package's sealed runtime. New build identity on each physical attempt.
3. **Safe restored PGDATA adoption:** inspect process identity, PG17 control state, physical symlinks/tablespaces and Vault hashes. Make independently verified non-overwriting permanent copy from SHUT_DOWN source. Rebind old private host config **locally only** to installed immutable bundle; retain independently verified restore report, restrict filesystem permissions. Fail closed on partial copy or existing owner.
4. **Cut remaining Supabase runtime paths:** move named route contracts out of `supabase/` hierarchy to first-class `local-supervisor/` modules behind compatibility re-exports; remove hosted branches only once all installed callsites and tests are local-only. Inventory and independently verify each API, functions, realtime, storage, auth and scheduler consumer; no substring-based mass rewrite.
5. **Remote access for ChatGPT:** ship separately paired encrypted outbound device gateway/MCP tunnel with revocation, key rotation, scoped operator permissions, nonces, replay fences and readiness; do not expose PostgreSQL port to the public network. GitHub identity or CI status is not remote enrollment.
6. **Autonomous multi-agent fleet:** signed goal admission → device/capability-scope → isolated agent lease → effect/readback/durable receipt → restart failover/reconcile. GitHub PR/CI source updates use this same task journal but require independent readback.
7. **Prove removed dependencies:** exact-source Windows package install, no-Supabase network test (including failures), private restored PG cold boot and restart, authenticated REST/RPC, 40 RPC/5 table grants, realtime wake, durable goal→lease→effect, agent/PC typed control, Update/E2E, 24-hour soak and signed release provenance.

## Explicit non-achievements at this checkpoint

New `client-control-plane-topology.mjs` is policy and admission modeling; the **real physical device authority** continues to live in the existing computer-authority executor/DB lease pipeline. It is not a new independent lease manager. The pinned local-only HTTP routing is wired into `native-supervisor-endpoints.mjs` and Deno's self-hosted configuration for installed clients, but the legacy hosted implementation still exists in source and uninstalled compatibility flows. No ChatGPT↔Windows live transport, cross-device authority, restored permanent PGDATA, secretless installer automatic credentials or agent end-to-end local device action is asserted. Track #1159 and PR #1167 chain.
