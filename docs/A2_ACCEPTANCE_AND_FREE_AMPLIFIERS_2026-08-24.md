# A2 acceptance and no-tariff quality amplifiers — 2026-08-24

Status: implementation hardening in draft PR #49. A2 is noncanonical and has no project authority.

## Evidence-backed state

| Gate | State | Evidence |
|---|---|---|
| Durable causal order and DAG | PASS | Production Postgres ledger, commit order, parent hashes, exact frontier readback |
| Stale P0/P1 rejection | PASS | Proof `7f88bb8e-5c84-4f18-9d52-2492f1d8e748` remains unaccepted after the later GLM P1 event; production rejected the stale GPT acceptance as `a2_model_event_stale_frontier` |
| Signature-bound HMAC ingress attestation | PASS | v1/v2 emit revoked from `service_role`; v3 alone executable; receipt `99bf6ea9-99b3-45e5-b7eb-5523c04c7718` binds the exact stored detached-signature digest and exactly recomputes through the DB-native preimage |
| Historical `99bf…` receipt as Ed25519-positive evidence | **INVALIDATED** | Independent verification of its persisted detached signature against the persisted session Ed25519 public key and event-hash bytes fails. The receipt proves HMAC/signature-byte binding only; it must not be cited as proof that the HTTP ingress performed valid Ed25519 verification |
| Single ingress preimage contract | PASS | Live migration `20260824122743` is present; recomputing the receipt with the DB-native preimage function exactly matches its stored HMAC |
| Altered-signature DB/HMAC negative canary | PASS, LIMITED | Reusing HMAC material with changed 64-byte detached signature fails as `a2_ingress_hmac_mismatch`; this proves signature binding, not upstream Ed25519 verification |
| HTTP ingress Ed25519 end-to-end canary | **REQUIRED / LIVE PENDING** | Must send a tampered detached signature through `/v1/a2/emit` and observe `a2_ingress_ed25519_invalid` before any receipt/event is persisted, then send the valid signature and independently verify the persisted signature against the registered session public key |
| Non-authority isolation | PASS | Canary event and receipt both persist with `canonical=false`, `authority_effect=false` |
| Runtime DB isolation | IMPLEMENTED | Model peers use the trusted HTTP ingress; the full-runtime launcher removes `DATABASE_URL` from both peer environments |
| Replay/reconnect | IMPLEMENTED, CI pending | Durable reads resume from received cursor; applied cursor advances only after inbox drain; SSE emits IDs and accepts `Last-Event-ID` |
| DUEL/PAUSED cognition fence | PASS / IMPLEMENTED | Live migration `20260824124953` atomically rejects model-authored events outside `COLLABORATE`; runtime pauses, rechecks mode after inference, and resumes only after collaboration returns |
| Exact model fencing | IMPLEMENTED, live pending | Startup checks `/v1/models`; each completion must report exactly `openai/gpt-5.6-sol` or `zai/glm-5.3` |
| Executor authority revalidation | IMPLEMENTED, live pending | Mutation-like tools fail closed unless executor returns `authority_revalidated=true` plus an authority digest |
| Observer interface | IMPLEMENTED, CI pending | Causal timeline, visibility proof, ancestry, authority mirror, exact model and signature-bound ingress receipt inspector |
| Independent exact runtimes | LIVE PENDING | Duration-based canary is explicitly excluded. Acceptance uses deterministic paired-round, reconnect, stale-frontier, duel and executor-gate scenarios with exact readback |

The GLM SQLite export is useful as an offline compatibility fixture only. Its DEMO-HMAC signatures and unshared local path are not evidence of an exact live GLM runtime or the production trusted-ingress boundary.

## Cryptographic trust boundary

`h205f22_a2_emit_agent_event_v3` verifies a short-lived HMAC attestation bound to the event, peer session, key fingerprint, timestamps, nonce, verifier ID and SHA-256 of the exact detached signature. Postgres does **not** itself perform Ed25519 verification. The trusted HTTP ingress is responsible for Ed25519 verification before it obtains the DB-native preimage and calls v3. Therefore a v3 receipt is evidence that the trusted verifier attested to those exact signature bytes; a database-admin/direct-v3 canary is not by itself evidence that the HTTP verifier actually ran.

`pgsodium` is technically available on the project but is intentionally not adopted as a new trust root because Supabase marks it pending deprecation and recommends Vault instead: <https://supabase.com/docs/guides/database/extensions/pgsodium>. Production proof should exercise the deployed ingress verifier rather than add a deprecated database extension.

## Free/open-source improvements selected

1. **Built-in Node test coverage now.** Node's native test runner supports coverage, so A2 CI adds line/branch/function evidence without a new paid service or dependency: <https://nodejs.org/api/test.html> and <https://nodejs.org/api/cli.html#--experimental-test-coverage>.
2. **Durable replay remains Postgres-first.** PostgreSQL documents LISTEN/NOTIFY as a notification mechanism, not a durable ledger; A2 therefore treats it only as a wake-up and replays committed rows after reconnect: <https://www.postgresql.org/docs/current/sql-notify.html> and <https://www.postgresql.org/docs/current/sql-listen.html>.
3. **SSE reconnect follows the platform contract.** `id:` is emitted for every committed event and the observer honors `Last-Event-ID`, matching the HTML standard: <https://html.spec.whatwg.org/multipage/server-sent-events.html#the-last-event-id-header>.
4. **Formal safety model.** `formal/A2CausalBus.tla` captures cursor ordering, no mandatory-event loss across `Apply`, shared-base round admission, two-result sealing, collaborate-only acceptance, DUEL invalidation, mode validity and permanent non-authority. On this change, TLC checked `MaxSeq=5`: 495,568 states generated, 106,663 distinct states, depth 33, no invariant violation. Apalache can add symbolic bounded checks locally: <https://apalache-mc.org/docs/apalache/running.html>.
5. **Database contract tests next, on a branch/local database.** Supabase's supported path is pgTAP through `supabase test db`; use it for RPC ACL, stale frontier, nonce replay, DUEL-mode rejection and canonical/authority checks before migrations reach production: <https://supabase.com/docs/guides/database/testing> and <https://supabase.com/docs/guides/database/extensions/pgtap>.
6. **Zero-code telemetry is opt-in.** OpenTelemetry can instrument Node.js without code changes and export to a local collector, avoiding a mandatory SaaS backend: <https://opentelemetry.io/docs/zero-code/js/>.
7. **Path-scoped CodeQL is enabled for A2.** The public repository now runs the current `github/codeql-action@v4` JavaScript/TypeScript `security-extended` suite only when A2 source or UI paths change. GitHub documents advanced CodeQL workflows and supported queries here: <https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configuring-advanced-setup-for-code-scanning> and <https://docs.github.com/en/code-security/reference/code-scanning/codeql/codeql-queries/javascript-typescript-built-in-queries>.

## Supabase advisor interpretation

After trusted-ingress v3, production advisors reported no A2 WARN/ERROR. The A2-related performance notices are INFO-level unused-index observations on newly introduced ledger/receipt indexes. They remain until deterministic paired-round tests produce representative query evidence; deleting them against an empty workload would be guesswork.

Three project-wide security WARNs remain outside A2 scope: two grants on `coordination_read_barrier_h205f22()` and Auth leaked-password protection. They were not silently changed because the former may be an intentional public read contract and the latter is an Auth product setting, not an A2 database migration.

## Release rule

Do not call A2 production-ready until CI is green, the short HTTP ingress Ed25519 end-to-end test passes, and two independently hosted exact runtimes pass deterministic no-relay scenarios: one complete PROPOSE→CHALLENGE→DECIDE cycle, disconnect/reconnect replay, P0/P1 interruption, a real tool result observed by both peers, conflict escalation into SAME_POINT_DUEL_V4, and a mutation admitted only after matching DECIDE actions or a duel decision plus fresh executor authority revalidation. No 30-minute canary is required or authorized.
