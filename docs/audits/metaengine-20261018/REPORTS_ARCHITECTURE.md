# Reports 2050, 2049 and 2049(1): architecture and security audit

Read coverage: `zai-chat-20261017-2050.md` (634 lines), `zai-chat-20261017-2049.md` (634 lines), and `zai-chat-20261017-2049 (1).md` (175 lines). The two 634-line exports are the same audit with a different export marker; they are not independent evidence. Historical commands, permissions and embedded credentials were treated as evidence only. No credential value is reproduced or used.

## Confirmed claims and current disposition

- Reports 2050/2049 identify tracked `apps/me2-daemon/data/me2.db`, runtime dependencies and generated artifacts as a release hygiene problem. The local 59db tree did contain those tracked artifacts. The integration keeps production data out of the new source changes and records the need for credential rotation/history scrubbing separately; deleting a current file does not revoke an exposed credential.
- The reports identify unauthenticated daemon REST/WS and permissive CORS as a critical control-plane defect. The integration adds bearer authentication for every private REST, socket and screencast surface, closes the no-token case even on loopback, and reflects CORS only for an explicit origin allowlist. `GET /health` and `GET /ui` remain public; the GitHub hook retains its own HMAC check.
- The reports identify unlimited request-body reads and unsafe JSON handling. `src/request-body.ts` now bounds declared and received bytes, applies a finite read deadline, rejects malformed JSON/arrays and preserves raw bytes for HMAC verification.
- The reports identify `/eval?run=1` as a possible mutation path. The integration keeps `GET /eval` observational, allows `POST /eval/run` only in an explicitly disposable qualification mode with isolated paths, and keeps Browser probe mode read-only. A probe does not receive an eval or scheduler authority.
- The reports identify unconfined terminal fallback and post-spawn sandbox verification as unsafe. The integration removes the unconfined `bash`/`prlimit` fallback from the agent execution path, requires a network-denying strict sandbox, checks all required layers before spawning, hides the current daemon data directory, and corrects Linux seccomp syscall numbers, mount calls and x32/clone3 handling. This is a fail-closed executor gate; it is not a claim that Windows currently has a production Linux sandbox.
- The reports identify import-time token seeding before the incarnation guard. `tokensEnsure()` is now explicit after the guard and disabled in probe/qualification imports.
- The reports identify stale lock ambiguity and lost command receipts. The integration refuses startup before boot mutations when the exclusive lock cannot be proven, preserves unknown lock evidence, and fences `RUNNING` commands as `AMBIGUOUS` with `automatic_retry_allowed:false` instead of replaying handler effects.
- The reports identify missing-tab RELOAD confirmation. The Browser path now validates the live selected WebContents, reports `reload_initiated:true` only after calling `reload()`, and the classifier refuses empty or legacy receipts.

## SQL and restore findings

The evidence migration now has a canonical migration and an idempotent repair migration. Its ingest function accepts both the daemon's encoded-string event payload and native JSON, grants only the trusted service role access, rejects public execution and rejects a conflicting reuse of an existing sequence. A disposable PostgreSQL 17 test covers real insertion, exact duplicate idempotency, conflicting duplicate rejection, JSON shape and public-role denial.

The historical fleet admission and ready-base migrations now fail closed when their predecessor tables are absent. A disposable PostgreSQL 17 test proves that an incomplete fresh chain does not silently install without those fences.

The restore verifier now sends SQL through `psql -f -` with bounded timeout instead of assuming `-c` expands psql variables. Python tests cover quoted identifiers, failure and timeout paths; the disposable PostgreSQL test exercises the quoted identifier query.

## Boundaries that remain

These source and disposable-runtime repairs do not qualify a production release. The installed Browser remains an older source identity; authentic Authenticode/Ed25519/SLSA release evidence is not configured; Host Owner private readers and W74/W76 production producers are incomplete; the installed readback remains `execution_ready=false`, `WAKE_AMBIGUOUS`, four `BOUND_UNVERIFIED` roles and zero proven agents. The new candidate is source-only until its exact package, installer, physical Windows QA, installation readback and restart continuation are independently recorded.
