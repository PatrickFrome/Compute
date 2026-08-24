# A2 acceptance and no-tariff quality amplifiers — 2026-08-24

Status: implementation hardening in draft PR #49. A2 is noncanonical and has no project authority.

## Evidence-backed state

| Gate | State | Evidence |
|---|---|---|
| Durable causal order and DAG | PASS | Production Postgres ledger, commit order, parent hashes, exact frontier readback |
| Stale P0/P1 rejection | PASS | Proof `7f88bb8e-5c84-4f18-9d52-2492f1d8e748` remains unaccepted after the later GLM P1 event; production rejected the stale GPT acceptance as `a2_model_event_stale_frontier` |
| Signature-bound trusted ingress | PASS | v1/v2 emit revoked from `service_role`; v3 alone executable; positive canary receipt `99bf6ea9-99b3-45e5-b7eb-5523c04c7718` has `signature_bound=true` |
| Single ingress preimage contract | PASS | Live migration `20260824122743` is present; recomputing the positive receipt with the DB-native preimage function exactly matches its stored HMAC |
| Altered-signature negative canary | PASS | Same HMAC material with changed 64-byte detached signature fails as `a2_ingress_hmac_mismatch` |
| Non-authority isolation | PASS | Canary event and receipt both persisted with `canonical=false`, `authority_effect=false` |
| Runtime DB isolation | IMPLEMENTED | Model peers use the trusted HTTP ingress; the full-runtime launcher removes `DATABASE_URL` from both peer environments |
| Replay/reconnect | IMPLEMENTED, CI pending | Durable reads resume from received cursor; applied cursor advances only after inbox drain; SSE emits IDs and accepts `Last-Event-ID` |
| Exact model fencing | IMPLEMENTED, live pending | Startup checks `/v1/models`; each completion must report exactly `openai/gpt-5.6-sol` or `zai/glm-5.3` |
| Executor authority revalidation | IMPLEMENTED, live pending | Mutation-like tools fail closed unless executor returns `authority_revalidated=true` plus an authority digest |
| Observer interface | IMPLEMENTED, CI pending | Causal timeline, visibility proof, ancestry, authority mirror, exact model and signature-bound ingress receipt inspector |
| Independent exact runtimes for 30 minutes | BLOCKED | No exact GPT/GLM runtime endpoints or credentials were available to this implementation session |

The GLM SQLite export is useful as an offline compatibility fixture only. Its DEMO-HMAC signatures and unshared local path are not evidence of an exact live GLM runtime or the production trusted-ingress boundary.

## Free/open-source improvements selected

1. **Built-in Node test coverage now.** Node's native test runner supports coverage, so A2 CI adds line/branch/function evidence without a new paid service or dependency: <https://nodejs.org/api/test.html> and <https://nodejs.org/api/cli.html#--experimental-test-coverage>.
2. **Durable replay remains Postgres-first.** PostgreSQL documents LISTEN/NOTIFY as a notification mechanism, not a durable ledger; A2 therefore treats it only as a wake-up and replays committed rows after reconnect: <https://www.postgresql.org/docs/current/sql-notify.html> and <https://www.postgresql.org/docs/current/sql-listen.html>.
3. **SSE reconnect follows the platform contract.** `id:` is emitted for every committed event and the observer honors `Last-Event-ID`, matching the HTML standard: <https://html.spec.whatwg.org/multipage/server-sent-events.html#the-last-event-id-header>.
4. **Formal safety model.** `formal/A2CausalBus.tla` captures cursor ordering, no mandatory-event loss, fresh acceptance, collaborate-only acceptance, mode validity and permanent non-authority. On current head, TLC checked the bounded model through `MaxSeq=5`: 13,993 states generated, 3,174 distinct states, depth 13, no invariant violation. Apalache can add symbolic bounded checks locally: <https://apalache-mc.org/docs/apalache/running.html>.
5. **Database contract tests next, on a branch/local database.** Supabase's supported path is pgTAP through `supabase test db`; use it for RPC ACL, stale frontier, nonce replay and canonical/authority checks before migrations reach production: <https://supabase.com/docs/guides/database/testing> and <https://supabase.com/docs/guides/database/extensions/pgtap>.
6. **Zero-code telemetry is opt-in.** OpenTelemetry can instrument Node.js without code changes and export to a local collector, avoiding a mandatory SaaS backend: <https://opentelemetry.io/docs/zero-code/js/>.
7. **Path-scoped CodeQL is enabled for A2.** The public repository now runs the current `github/codeql-action@v4` JavaScript/TypeScript `security-extended` suite only when A2 source or UI paths change. GitHub documents advanced CodeQL workflows and supported queries here: <https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configuring-advanced-setup-for-code-scanning> and <https://docs.github.com/en/code-security/reference/code-scanning/codeql/codeql-queries/javascript-typescript-built-in-queries>.

## Supabase advisor interpretation

After trusted-ingress v3, production advisors reported no A2 WARN/ERROR. The A2-related performance notices are INFO-level unused-index observations on newly introduced ledger/receipt indexes. They should remain until the 30-minute canary produces representative statistics; deleting them now would optimize against an empty workload.

Three project-wide security WARNs remain outside A2 scope: two grants on `coordination_read_barrier_h205f22()` and Auth leaked-password protection. They were not silently changed because the former may be an intentional public read contract and the latter is an Auth product setting, not an A2 database migration.

## Release rule

Do not mark PR #49 ready and do not call A2 production-ready until CI is green and the two independently hosted exact runtimes complete the 30-minute no-relay canary. The canary must include disconnect/reconnect, P0/P1 interruption, a real tool result observed by both peers, conflict escalation into SAME_POINT_DUEL_V4, and a mutation attempt that succeeds only after fresh executor authority revalidation.
